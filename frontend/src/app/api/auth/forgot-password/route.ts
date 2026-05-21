/**
 * Encrypted forgot-password endpoint.
 *
 * Flow:
 *   1. Browser sends an envelope with { email }.
 *   2. We use Supabase admin generate_link (type=recovery) to mint a
 *      password-reset URL that lands on /reset-password with a recovery
 *      token in the URL fragment.
 *   3. We send that URL via Resend using our own branded template.
 *   4. The response is always a uniform 200 + ``{ ok: true }`` so we don't
 *      leak which addresses are registered.
 *
 * Note: rate limiting per IP relies on CloudFront/WAF in production. The
 * route itself enforces nothing; spamming the same email is benign because
 * Supabase rate-limits its own recovery flow.
 */

import { NextRequest, NextResponse } from "next/server";
import { openRequest } from "@/lib/server-crypto";
import { generatePasswordRecoveryLink } from "@/lib/supabase-admin";
import { sendEmail } from "@/lib/email";
import { passwordResetTemplate } from "@/lib/email-templates";

interface ForgotBody {
  email?: string;
}

const APP_BASE_URL = (
  process.env.APP_BASE_URL || "https://d2pk46epz4i9kd.cloudfront.net"
).replace(/\/+$/, "");

export async function POST(request: NextRequest) {
  let envelope: { v?: number; epk?: string; n?: string; c?: string } | null = null;
  try {
    envelope = await request.json();
  } catch {
    envelope = null;
  }
  if (!envelope || !envelope.epk || !envelope.n || !envelope.c) {
    return NextResponse.json(
      { error: "Encrypted envelope required." },
      { status: 400 }
    );
  }

  let body: ForgotBody;
  let seal: (data: unknown) => { n: string; c: string };
  try {
    const url = new URL(request.url);
    const opened = openRequest(envelope, url.pathname);
    body = (opened.body || {}) as ForgotBody;
    seal = opened.seal;
  } catch (e) {
    return NextResponse.json(
      { error: "Bad envelope: " + (e as Error).message },
      { status: 400 }
    );
  }

  const email = (body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    // Even on bad input, return the generic ok response to avoid leaking
    // anything about the email validation rules.
    return NextResponse.json(seal({ ok: true }));
  }

  // Where the user lands after clicking the link in the email. The
  // recovery token rides in the URL fragment, which is invisible to
  // CloudFront / nginx access logs and to the Next.js server.
  const redirectTo = `${APP_BASE_URL}/reset-password`;

  // Mint the link; failures are silently swallowed (consistent uniform
  // response). If we got a link, send the email through Resend.
  const { action_link } = await generatePasswordRecoveryLink(email, redirectTo);

  if (action_link) {
    const tpl = passwordResetTemplate({ resetUrl: action_link, expiresInMinutes: 60 });
    // Fire-and-forget: don't make the user wait on Resend's API.
    void sendEmail({
      to: email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      template: "password_reset",
    });
  }

  return NextResponse.json(seal({ ok: true }));
}
