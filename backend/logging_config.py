"""Structured JSON logging with request-context binding and PII redaction.

Contract for every log line:
  { ts, level, service, request_id, user_id, tenant_id, message, ...context }

- ``request_id`` is set per HTTP request via the FastAPI middleware in main.py.
- ``user_id`` and ``tenant_id`` are bound by the auth dependency once the
  caller is identified.
- Email addresses, full UUIDs in non-id fields, and bare bearer tokens are
  hashed to short fingerprints so they can be cross-referenced without
  leaking the raw value.
"""

from __future__ import annotations

import contextvars
import hashlib
import json
import logging
import os
import re
import sys
import time
import uuid
from typing import Any

SERVICE_NAME = os.getenv("SERVICE_NAME", "anonymizer-core")
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()

# Per-request context. FastAPI middleware sets these; they propagate into any
# logger.* call automatically.
request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "request_id", default=""
)
user_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "user_id", default=""
)
tenant_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "tenant_id", default=""
)


_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_BEARER_RE = re.compile(r"Bearer\s+[A-Za-z0-9._\-]+", re.IGNORECASE)
_UUID_RE = re.compile(
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b",
    re.IGNORECASE,
)


def _short_hash(value: str, prefix: str) -> str:
    """Return a stable 8-char fingerprint, prefixed for traceability."""
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:8]
    return f"{prefix}:{digest}"


def _redact_email(match: re.Match[str]) -> str:
    return _short_hash(match.group(0).lower(), "email")


def _redact_bearer(_match: re.Match[str]) -> str:
    return "Bearer <redacted>"


def _redact_uuid(match: re.Match[str]) -> str:
    return _short_hash(match.group(0).lower(), "id")


def redact(value: str) -> str:
    """Sanitise a string before it is emitted to logs."""
    if not value:
        return value
    value = _BEARER_RE.sub(_redact_bearer, value)
    value = _EMAIL_RE.sub(_redact_email, value)
    value = _UUID_RE.sub(_redact_uuid, value)
    return value


def hash_id(raw: str, prefix: str = "id") -> str:
    """Turn a raw id (uuid, supabase_auth_id, tenant_id, etc.) into a short
    fingerprint suitable for logging or tagging metrics.
    """
    if not raw:
        return ""
    return _short_hash(str(raw), prefix)


class _JsonFormatter(logging.Formatter):
    """Emit one JSON object per log line.

    Standard keys: ts, level, service, request_id, user_id, tenant_id,
    logger, message, plus anything passed via ``logger.*("msg", extra={...})``.
    """

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": int(time.time() * 1000),
            "level": record.levelname,
            "service": SERVICE_NAME,
            "request_id": request_id_var.get() or "",
            "user_id": user_id_var.get() or "",
            "tenant_id": tenant_id_var.get() or "",
            "logger": record.name,
            "message": redact(record.getMessage()),
        }

        # Attach any contextual fields supplied via logger.*("msg", extra=...)
        # but skip the LogRecord internals.
        reserved = set(logging.LogRecord("", 0, "", 0, "", None, None).__dict__.keys())
        reserved |= {"message", "asctime"}
        for k, v in record.__dict__.items():
            if k in reserved:
                continue
            if k.startswith("_"):
                continue
            try:
                # Only emit JSON-serialisable values.
                json.dumps(v)
                payload[k] = v
            except TypeError:
                payload[k] = repr(v)

        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        if record.stack_info:
            payload["stack"] = record.stack_info

        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging() -> None:
    """Replace the root logger's handlers with a single stdout JSON handler."""
    root = logging.getLogger()
    for handler in list(root.handlers):
        root.removeHandler(handler)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter())
    root.addHandler(handler)
    root.setLevel(LOG_LEVEL)

    # Quieten noisy 3rd-party loggers; we keep their warnings + errors.
    for name in ("uvicorn.access", "uvicorn.error", "botocore", "urllib3"):
        logging.getLogger(name).setLevel(logging.WARNING)


def new_request_id() -> str:
    return uuid.uuid4().hex
