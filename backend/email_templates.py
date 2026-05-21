"""Transactional-email templates.

Pure functions — each returns ``{ "subject", "html", "text" }``. Templates
live in code so they're version-controlled, reviewable, and side-effect free
in tests.

Design rules:

- Every template ships HTML *and* plain-text. Many corporate filters reject
  HTML-only mail.
- HTML uses inline CSS only. Email clients ignore most of `<style>`.
- Single-column 600px-max layout — works in every client we'll see.
- Every link is full-URL absolute (no relative paths in email).
- Branding pulls the logo from the public CDN URL so it works across clients.
- ``preheader`` is the first line of plain text and the hidden inbox preview.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

APP_BASE_URL = os.getenv("APP_BASE_URL", "https://d2pk46epz4i9kd.cloudfront.net").rstrip("/")
APP_NAME = os.getenv("APP_NAME", "Quintal AI")
APP_LOGO_URL = os.getenv("APP_LOGO_URL", f"{APP_BASE_URL}/logo.png")
APP_SUPPORT_EMAIL = os.getenv("APP_SUPPORT_EMAIL", "")


def _layout(*, preheader: str, body_html: str) -> str:
    """Wrap a body fragment in our standard branded shell."""
    support_line = (
        f'Need help? Email <a href="mailto:{APP_SUPPORT_EMAIL}" style="color:#b8c3ff;text-decoration:none;">{APP_SUPPORT_EMAIL}</a>.'
        if APP_SUPPORT_EMAIL
        else ""
    )
    year = datetime.now(timezone.utc).year
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{APP_NAME}</title>
</head>
<body style="margin:0;padding:0;background:#0b0e14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e6e6f0;">
  <span style="display:none!important;visibility:hidden;mso-hide:all;font-size:1px;color:#0b0e14;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    {preheader}
  </span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0b0e14;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background:#11141d;border:1px solid rgba(184,195,255,0.15);border-radius:14px;overflow:hidden;">
          <tr>
            <td align="center" style="padding:28px 24px 12px 24px;">
              <img src="{APP_LOGO_URL}" alt="{APP_NAME}" width="44" height="44" style="display:block;border:0;">
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 32px 32px;">
              {body_html}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px 28px 32px;border-top:1px solid rgba(184,195,255,0.08);font-size:12px;color:#8e90a0;line-height:1.5;">
              {support_line}
              <div style="margin-top:6px;">&copy; {year} {APP_NAME}. All rights reserved.</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def _button(label: str, href: str) -> str:
    return f"""<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0;">
  <tr><td bgcolor="#b8c3ff" style="border-radius:10px;">
    <a href="{href}" target="_blank" style="display:inline-block;padding:12px 22px;font-weight:600;font-size:14px;color:#002388;text-decoration:none;border-radius:10px;">{label}</a>
  </td></tr>
</table>"""


# ── Templates ────────────────────────────────────────────────────


def invite_member(
    *,
    invitee_email: str,
    tenant_name: str,
    inviter_name: str | None,
    role: str,
    invite_url: str,
    expires_in_days: int = 7,
) -> dict:
    inviter_label = inviter_name or "your team"
    role_label = "leader" if role == "leader" else "member"
    subject = f"You've been invited to {tenant_name} on {APP_NAME}"
    preheader = f"{inviter_label} invited you to join {tenant_name} as a {role_label}."

    intro_html = (
        f"<h1 style=\"margin:0 0 12px 0;font-size:22px;color:#e6e6f0;\">"
        f"You've been invited to join {tenant_name}</h1>"
        f"<p style=\"margin:0 0 16px 0;font-size:14px;line-height:1.55;color:#c4c5d7;\">"
        f"{inviter_label} invited you to join <strong style=\"color:#e6e6f0;\">{tenant_name}</strong> "
        f"as a {role_label} on {APP_NAME}. Click below to accept the invitation."
        f"</p>"
    )
    button_html = _button("Accept invitation", invite_url)
    expiry_html = (
        f"<p style=\"margin:8px 0 0 0;font-size:12px;color:#8e90a0;line-height:1.5;\">"
        f"This link expires in {expires_in_days} days. If you didn't expect this invitation, you can ignore it."
        f"</p>"
        f"<p style=\"margin:18px 0 0 0;font-size:11px;color:#5d5f6c;word-break:break-all;\">"
        f"Trouble clicking? Paste this link into your browser:<br>"
        f"<span style=\"color:#8e90a0;\">{invite_url}</span></p>"
    )

    text = (
        f"You've been invited to join {tenant_name} as a {role_label}.\n\n"
        f"Accept here: {invite_url}\n\n"
        f"This link expires in {expires_in_days} days.\n"
    )
    return {
        "subject": subject,
        "html": _layout(preheader=preheader, body_html=intro_html + button_html + expiry_html),
        "text": text,
    }


def assign_leader(
    *,
    invitee_email: str,
    tenant_name: str,
    invite_url: str,
    expires_in_days: int = 7,
) -> dict:
    subject = f"You've been invited to lead {tenant_name} on {APP_NAME}"
    preheader = f"You're invited to be the organization leader for {tenant_name}."
    intro_html = (
        f"<h1 style=\"margin:0 0 12px 0;font-size:22px;color:#e6e6f0;\">"
        f"Lead {tenant_name} on {APP_NAME}</h1>"
        f"<p style=\"margin:0 0 16px 0;font-size:14px;line-height:1.55;color:#c4c5d7;\">"
        f"A platform admin has invited you to be the organization leader of "
        f"<strong style=\"color:#e6e6f0;\">{tenant_name}</strong>. As leader, you can invite "
        f"members, manage credits, and configure usage policies."
        f"</p>"
    )
    button_html = _button("Accept and continue", invite_url)
    expiry_html = (
        f"<p style=\"margin:8px 0 0 0;font-size:12px;color:#8e90a0;line-height:1.5;\">"
        f"This link expires in {expires_in_days} days."
        f"</p>"
        f"<p style=\"margin:18px 0 0 0;font-size:11px;color:#5d5f6c;word-break:break-all;\">"
        f"Trouble clicking? Paste this link into your browser:<br>"
        f"<span style=\"color:#8e90a0;\">{invite_url}</span></p>"
    )

    text = (
        f"You've been invited to lead {tenant_name} on {APP_NAME}.\n\n"
        f"Accept here: {invite_url}\n\n"
        f"This link expires in {expires_in_days} days.\n"
    )
    return {
        "subject": subject,
        "html": _layout(preheader=preheader, body_html=intro_html + button_html + expiry_html),
        "text": text,
    }


def password_reset(*, reset_url: str, expires_in_minutes: int = 60) -> dict:
    subject = f"Reset your {APP_NAME} password"
    preheader = "Use this link to set a new password."
    intro_html = (
        f"<h1 style=\"margin:0 0 12px 0;font-size:22px;color:#e6e6f0;\">"
        f"Reset your password</h1>"
        f"<p style=\"margin:0 0 16px 0;font-size:14px;line-height:1.55;color:#c4c5d7;\">"
        f"We received a request to reset your {APP_NAME} password. Click below "
        f"to choose a new one."
        f"</p>"
    )
    button_html = _button("Reset password", reset_url)
    safety_html = (
        f"<p style=\"margin:8px 0 0 0;font-size:12px;color:#8e90a0;line-height:1.5;\">"
        f"If you didn't request this, ignore this email — your password "
        f"won't change. The link expires in {expires_in_minutes} minutes."
        f"</p>"
        f"<p style=\"margin:18px 0 0 0;font-size:11px;color:#5d5f6c;word-break:break-all;\">"
        f"Trouble clicking? Paste this link into your browser:<br>"
        f"<span style=\"color:#8e90a0;\">{reset_url}</span></p>"
    )

    text = (
        f"Reset your {APP_NAME} password.\n\n"
        f"Open this link to choose a new password: {reset_url}\n\n"
        f"If you didn't request this, ignore this email — your password won't change.\n"
        f"The link expires in {expires_in_minutes} minutes.\n"
    )
    return {
        "subject": subject,
        "html": _layout(preheader=preheader, body_html=intro_html + button_html + safety_html),
        "text": text,
    }


def password_changed(*, when_iso: str) -> dict:
    subject = f"Your {APP_NAME} password was changed"
    preheader = "Confirmation of a recent security change to your account."
    body_html = (
        f"<h1 style=\"margin:0 0 12px 0;font-size:22px;color:#e6e6f0;\">"
        f"Password updated</h1>"
        f"<p style=\"margin:0 0 16px 0;font-size:14px;line-height:1.55;color:#c4c5d7;\">"
        f"Your {APP_NAME} password was changed on <strong style=\"color:#e6e6f0;\">{when_iso}</strong> (UTC)."
        f"</p>"
        f"<p style=\"margin:0 0 16px 0;font-size:14px;line-height:1.55;color:#c4c5d7;\">"
        f"If this was you, no action is needed. If you don't recognise this "
        f"change, sign in and reset your password right away."
        f"</p>"
    )
    text = (
        f"Your {APP_NAME} password was changed on {when_iso} (UTC).\n\n"
        f"If this wasn't you, sign in and reset your password immediately.\n"
    )
    return {
        "subject": subject,
        "html": _layout(preheader=preheader, body_html=body_html),
        "text": text,
    }
