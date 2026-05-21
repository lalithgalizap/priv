"""Provider-agnostic transactional email sender.

A single ``send_email(to, subject, html, text)`` entry point. The active
provider is selected by the ``EMAIL_PROVIDER`` env var:

- ``resend`` — production-friendly REST API. Requires ``RESEND_API_KEY``.
- ``console`` — local dev fallback. Logs the email instead of sending.

All sends:

- Use the bounded async-IO HTTP client (timeouts, connection pooling).
- Append an ``email_log`` row regardless of outcome (status, latency, error).
- Return a small dict so callers can decide what to do on failure (audit log,
  retry, etc.) but do not raise for non-2xx responses; the email path must
  never break the request that triggered it.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Optional

import httpx

import db
from logging_config import hash_id, request_id_var

logger = logging.getLogger("email")

EMAIL_PROVIDER = os.getenv("EMAIL_PROVIDER", "console").lower()
EMAIL_FROM = os.getenv("EMAIL_FROM", "Quintal AI <onboarding@resend.dev>")
EMAIL_REPLY_TO = os.getenv("EMAIL_REPLY_TO", "")
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
APP_BASE_URL = os.getenv("APP_BASE_URL", "https://d2pk46epz4i9kd.cloudfront.net").rstrip("/")


class EmailSendError(Exception):
    """Raised for unexpected provider failures we want bubbled to the caller."""


def _get_client() -> httpx.AsyncClient:
    """Reuse the application's shared httpx client so we keep keep-alive
    connections to Resend instead of opening a fresh TCP socket per send."""
    from async_io import get_http_client

    return get_http_client()


async def send_email(
    *,
    to: str,
    subject: str,
    html: str,
    text: str,
    template: str,
    metadata: Optional[dict] = None,
) -> dict:
    """Send a single transactional email and append an audit row.

    ``template`` is the canonical name of what we're sending (e.g.
    ``"invite_member"``). It's stored on the email_log row so support can
    answer "did the user get invite X?" without inspecting payload contents.

    Returns a dict like ``{"ok": True, "id": "..."}`` or
    ``{"ok": False, "error": "...", "status": 502}``. Never raises.
    """
    if not to or not subject:
        return {"ok": False, "error": "Missing recipient or subject."}

    started = time.monotonic()
    rid = request_id_var.get() or ""

    log_payload: dict = {
        "to_hash": hash_id(to.lower(), "email"),
        "template": template,
        "request_id": rid or None,
        "metadata": metadata or {},
    }

    if EMAIL_PROVIDER == "console":
        latency_ms = int((time.monotonic() - started) * 1000)
        logger.info(
            "email_sent_console",
            extra={**log_payload, "subject": subject, "latency_ms": latency_ms},
        )
        _log_to_db("sent", provider="console", latency_ms=latency_ms,
                   to=to, subject=subject, template=template, error=None,
                   metadata=metadata)
        return {"ok": True, "id": "console"}

    if EMAIL_PROVIDER == "resend":
        try:
            client = _get_client()
            payload = {
                "from": EMAIL_FROM,
                "to": [to],
                "subject": subject,
                "html": html,
                "text": text,
                "tags": [{"name": "template", "value": template}],
            }
            if EMAIL_REPLY_TO:
                payload["reply_to"] = EMAIL_REPLY_TO
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
                json=payload,
                timeout=10.0,
            )
            latency_ms = int((time.monotonic() - started) * 1000)
            if resp.status_code >= 400:
                err = resp.text[:500]
                logger.warning(
                    "email_send_failed",
                    extra={
                        **log_payload,
                        "provider": "resend",
                        "status": resp.status_code,
                        "latency_ms": latency_ms,
                        "error": err,
                    },
                )
                _log_to_db("failed", provider="resend", latency_ms=latency_ms,
                           to=to, subject=subject, template=template, error=err,
                           metadata=metadata)
                return {"ok": False, "error": err, "status": resp.status_code}
            data = resp.json()
            logger.info(
                "email_sent",
                extra={**log_payload, "provider": "resend",
                       "latency_ms": latency_ms, "provider_id": data.get("id")},
            )
            _log_to_db("sent", provider="resend", latency_ms=latency_ms,
                       to=to, subject=subject, template=template, error=None,
                       metadata=metadata, provider_id=data.get("id"))
            return {"ok": True, "id": data.get("id")}
        except Exception as exc:
            latency_ms = int((time.monotonic() - started) * 1000)
            logger.exception(
                "email_send_crashed",
                extra={**log_payload, "provider": "resend",
                       "latency_ms": latency_ms, "error": str(exc)},
            )
            _log_to_db("failed", provider="resend", latency_ms=latency_ms,
                       to=to, subject=subject, template=template,
                       error=str(exc), metadata=metadata)
            return {"ok": False, "error": str(exc)}

    msg = f"Unknown EMAIL_PROVIDER={EMAIL_PROVIDER}"
    logger.error(msg)
    return {"ok": False, "error": msg}


def _log_to_db(
    status: str,
    *,
    provider: str,
    latency_ms: int,
    to: str,
    subject: str,
    template: str,
    error: Optional[str],
    metadata: Optional[dict],
    provider_id: Optional[str] = None,
) -> None:
    """Best-effort write to email_log. Never bubbles up."""
    try:
        db.write_email_log(
            to_email=to,
            subject=subject,
            template=template,
            status=status,
            provider=provider,
            provider_id=provider_id,
            latency_ms=latency_ms,
            error=error,
            metadata=metadata,
            request_id=request_id_var.get() or None,
        )
    except Exception as exc:
        logger.warning("email_log_write_failed", extra={"error": str(exc)})


def is_configured() -> bool:
    """True if the active provider is fully set up and ready to send."""
    if EMAIL_PROVIDER == "console":
        return True
    if EMAIL_PROVIDER == "resend":
        return bool(RESEND_API_KEY)
    return False
