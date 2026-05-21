/**
 * Encrypted reset-password endpoint.
 *
 * Flow:
 *   1. User clicks the link in the recovery email.
 *   2. /reset-password page reads ``access_token`` and ``refresh_token``
 *      from the URL fragment client-side and POSTs them here along with
 *      the new password.
 *   3. We call Supabase ``PUT /auth/v1/user`` using the recovery
 *      access_token to set the new password.
 *   4. Optionally we send a confirmation email.
 *
 * The recovery access_token is only good for one password change, so the
 * blast radius of a leaked token is limited.
 */

import { NextRequest, NextResponse } from "next/server";
import { openRequest } from "@/lib/server-crypto";
import { updatePasswordWithToken } from "@/lib/supabase-admin";
import { sendEmail } from "@/lib/email";
import { passwordChangedTemplate } from "@/lib/email-templates";

interface ResetBody {
  access_token?: string;
  new_password?: string;
}

function decodeJwtPayload(jwt: string): { email?: string; exp?: number } | null {
  try {
    const part = jwt.split(".")[1];
    if (!part) return null;
    const padded = part + "=".repeat((4 - (part.length % 4)) % 4);
    const txt = Buffer.from(
      padded.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf-8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

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

  let body: ResetBody;
  let seal: (data: unknown) => { n: string; c: string };
  try {
    const url = new URL(request.url);
    const opened = openRequest(envelope, url.pathname);
    body = (opened.body || {}) as ResetBody;
    seal = opened.seal;
  } catch (e) {
    return NextResponse.json(
      { error: "Bad envelope: " + (e as Error).message },
      { status: 400 }
    );
  }

  if (!body.access_token || !body.new_password) {
    return NextResponse.json(
      seal({ error: "Missing access_token or new_password." }),
      { status: 400 }
    );
  }
  if (body.new_password.length < 8) {
    return NextResponse.json(
      seal({ error: "Password must be at least 8 characters." }),
      { status: 400 }
    );
  }

  const updated = await updatePasswordWithToken(body.access_token, body.new_password);
  if (!updated.ok) {
    return NextResponse.json(
      seal({ error: updated.message || "Password reset failed." }),
      { status: updated.status || 400 }
    );
  }

  // Best-effort confirmation email (the same email that requested the reset).
  const claims = decodeJwtPayload(body.access_token);
  if (claims?.email) {
    const tpl = passwordChangedTemplate({ whenIso: new Date().toISOString() });
    void sendEmail({
      to: claims.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      template: "password_changed",
    });
  }

  return NextResponse.json(seal({ ok: true }));
}
