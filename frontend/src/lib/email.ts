/**
 * Server-only email sender for Next.js API routes (forgot-password).
 *
 * Most transactional email lives on the FastAPI backend — invites, role
 * changes, billing notifications. Forgot-password is the one flow that has
 * to live on Next.js because it doesn't have a backend session yet, so we
 * keep this module narrow and provider-mirrored to ``backend/email_sender.py``.
 *
 * Provider selected by ``EMAIL_PROVIDER``:
 *   - ``resend``  — production REST API (requires ``RESEND_API_KEY``)
 *   - ``console`` — local dev fallback; logs the email instead of sending
 */

const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER || "console").toLowerCase();
const EMAIL_FROM = process.env.EMAIL_FROM || "Quintal AI <onboarding@resend.dev>";
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  template: string;
  metadata?: Record<string, unknown>;
}

interface SendResult {
  ok: boolean;
  id?: string | null;
  error?: string;
}

/**
 * Send a single transactional email. Never throws — returns ``{ok:false}``
 * on failure so the caller can decide whether to surface or swallow.
 */
export async function sendEmail(args: SendArgs): Promise<SendResult> {
  if (!args.to || !args.subject) {
    return { ok: false, error: "Missing recipient or subject" };
  }

  if (EMAIL_PROVIDER === "console") {
    console.info("[email:console]", {
      template: args.template,
      to: args.to,
      subject: args.subject,
      metadata: args.metadata,
    });
    return { ok: true, id: "console" };
  }

  if (EMAIL_PROVIDER === "resend") {
    if (!RESEND_API_KEY) {
      console.warn("[email] RESEND_API_KEY not set; skipping send");
      return { ok: false, error: "RESEND_API_KEY missing" };
    }
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to: [args.to],
          subject: args.subject,
          html: args.html,
          text: args.text,
          tags: [{ name: "template", value: args.template }],
          ...(EMAIL_REPLY_TO ? { reply_to: EMAIL_REPLY_TO } : {}),
        }),
      });
      if (resp.status >= 400) {
        const body = await resp.text().catch(() => "");
        console.warn("[email] resend send failed", resp.status, body.slice(0, 200));
        return { ok: false, error: body.slice(0, 200) };
      }
      const data = (await resp.json().catch(() => ({}))) as { id?: string };
      console.info("[email:resend]", {
        template: args.template,
        provider_id: data.id,
      });
      return { ok: true, id: data.id || null };
    } catch (e) {
      console.warn("[email] resend send crashed", (e as Error).message);
      return { ok: false, error: (e as Error).message };
    }
  }

  return { ok: false, error: `Unknown EMAIL_PROVIDER=${EMAIL_PROVIDER}` };
}
