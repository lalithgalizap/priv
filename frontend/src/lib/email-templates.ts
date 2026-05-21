/**
 * Frontend-side email templates. Mirrors ``backend/email_templates.py`` for
 * the templates we send from Next.js (currently: password reset only).
 *
 * Each function returns ``{ subject, html, text }``. HTML uses inlined CSS
 * for email-client compatibility.
 */

const APP_NAME = process.env.APP_NAME || "Quintal AI";
const APP_BASE_URL = (
  process.env.APP_BASE_URL || "https://d2pk46epz4i9kd.cloudfront.net"
).replace(/\/+$/, "");
const APP_LOGO_URL = process.env.APP_LOGO_URL || `${APP_BASE_URL}/logo.png`;
const APP_SUPPORT_EMAIL = process.env.APP_SUPPORT_EMAIL || "";

function layout(args: { preheader: string; bodyHtml: string }): string {
  const supportLine = APP_SUPPORT_EMAIL
    ? `Need help? Email <a href="mailto:${APP_SUPPORT_EMAIL}" style="color:#b8c3ff;text-decoration:none;">${APP_SUPPORT_EMAIL}</a>.`
    : "";
  const year = new Date().getUTCFullYear();
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${APP_NAME}</title>
</head>
<body style="margin:0;padding:0;background:#0b0e14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e6e6f0;">
  <span style="display:none!important;visibility:hidden;mso-hide:all;font-size:1px;color:#0b0e14;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    ${args.preheader}
  </span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0b0e14;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background:#11141d;border:1px solid rgba(184,195,255,0.15);border-radius:14px;overflow:hidden;">
        <tr><td align="center" style="padding:28px 24px 12px 24px;">
          <img src="${APP_LOGO_URL}" alt="${APP_NAME}" width="44" height="44" style="display:block;border:0;">
        </td></tr>
        <tr><td style="padding:8px 32px 32px 32px;">${args.bodyHtml}</td></tr>
        <tr><td style="padding:18px 32px 28px 32px;border-top:1px solid rgba(184,195,255,0.08);font-size:12px;color:#8e90a0;line-height:1.5;">
          ${supportLine}
          <div style="margin-top:6px;">&copy; ${year} ${APP_NAME}. All rights reserved.</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function button(label: string, href: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0;">
  <tr><td bgcolor="#b8c3ff" style="border-radius:10px;">
    <a href="${href}" target="_blank" style="display:inline-block;padding:12px 22px;font-weight:600;font-size:14px;color:#002388;text-decoration:none;border-radius:10px;">${label}</a>
  </td></tr>
</table>`;
}

export function passwordResetTemplate(args: {
  resetUrl: string;
  expiresInMinutes?: number;
}): { subject: string; html: string; text: string } {
  const expiresIn = args.expiresInMinutes ?? 60;
  const subject = `Reset your ${APP_NAME} password`;
  const preheader = "Use this link to set a new password.";
  const intro = `<h1 style="margin:0 0 12px 0;font-size:22px;color:#e6e6f0;">Reset your password</h1>
<p style="margin:0 0 16px 0;font-size:14px;line-height:1.55;color:#c4c5d7;">
We received a request to reset your ${APP_NAME} password. Click below to choose a new one.
</p>`;
  const safety = `<p style="margin:8px 0 0 0;font-size:12px;color:#8e90a0;line-height:1.5;">
If you didn't request this, ignore this email — your password won't change. The link expires in ${expiresIn} minutes.
</p>
<p style="margin:18px 0 0 0;font-size:11px;color:#5d5f6c;word-break:break-all;">
Trouble clicking? Paste this link into your browser:<br>
<span style="color:#8e90a0;">${args.resetUrl}</span></p>`;

  const text = `Reset your ${APP_NAME} password.

Open this link to choose a new password: ${args.resetUrl}

If you didn't request this, ignore this email — your password won't change.
The link expires in ${expiresIn} minutes.
`;
  return {
    subject,
    html: layout({
      preheader,
      bodyHtml: intro + button("Reset password", args.resetUrl) + safety,
    }),
    text,
  };
}

export function passwordChangedTemplate(args: { whenIso: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `Your ${APP_NAME} password was changed`;
  const preheader = "Confirmation of a recent security change to your account.";
  const body = `<h1 style="margin:0 0 12px 0;font-size:22px;color:#e6e6f0;">Password updated</h1>
<p style="margin:0 0 16px 0;font-size:14px;line-height:1.55;color:#c4c5d7;">
Your ${APP_NAME} password was changed on <strong style="color:#e6e6f0;">${args.whenIso}</strong> (UTC).
</p>
<p style="margin:0 0 16px 0;font-size:14px;line-height:1.55;color:#c4c5d7;">
If this was you, no action is needed. If you don't recognise this change, sign in and reset your password right away.
</p>`;
  const text = `Your ${APP_NAME} password was changed on ${args.whenIso} (UTC).

If this wasn't you, sign in and reset your password immediately.
`;
  return {
    subject,
    html: layout({ preheader, bodyHtml: body }),
    text,
  };
}
