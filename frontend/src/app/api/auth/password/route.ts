/**
 * Encrypted password change.
 *
 * Flow:
 *   1. Client sends an envelope with { current_password, new_password } and
 *      Authorization: Bearer <access_token>.
 *   2. We decode the JWT locally to get the user's email — never round-trip
 *      to Supabase ``/auth/v1/user`` here. That call has historically been
 *      flaky for fresh-but-valid tokens and was the source of the
 *      "Unauthorized" 401s on /settings.
 *   3. Re-authenticate with current_password (proves the user still owns
 *      the account), then ``PUT /auth/v1/user`` with the new password.
 *   4. Roll the session forward by setting the freshly-issued cookies, and
 *      send a confirmation email best-effort.
 */

import { NextRequest, NextResponse } from "next/server";
import { openRequest } from "@/lib/server-crypto";
import { signInWithPassword, updatePasswordWithToken } from "@/lib/supabase-admin";
import { cookieNames, setSessionCookies } from "@/lib/cookies";
import { sendEmail } from "@/lib/email";
import { passwordChangedTemplate } from "@/lib/email-templates";

interface ChangeBody {
  current_password?: string;
  new_password?: string;
}

interface DecodedJwt {
  exp?: number;
  sub?: string;
  email?: string;
}

function decodeJwtPayload(jwt: string): DecodedJwt | null {
  try {
    const part = jwt.split(".")[1];
    if (!part) return null;
    const padded = part + "=".repeat((4 - (part.length % 4)) % 4);
    const txt = Buffer.from(
      padded.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf-8");
    return JSON.parse(txt) as DecodedJwt;
  } catch {
    return null;
  }
}

const LEEWAY_SECONDS = 30;

export async function POST(request: NextRequest) {
  let envelope: { v?: number; epk?: string; n?: string; c?: string } | null = null;
  try {
    envelope = await request.json();
  } catch {
    envelope = null;
  }
  if (!envelope || !envelope.epk || !envelope.n || !envelope.c) {
    return NextResponse.json({ error: "Encrypted envelope required." }, { status: 400 });
  }

  let body: ChangeBody;
  let seal: (data: unknown) => { n: string; c: string };
  try {
    const url = new URL(request.url);
    const opened = openRequest(envelope, url.pathname);
    body = (opened.body || {}) as ChangeBody;
    seal = opened.seal;
  } catch (e) {
    return NextResponse.json({ error: "Bad envelope: " + (e as Error).message }, { status: 400 });
  }

  if (!body.current_password || !body.new_password) {
    return NextResponse.json(seal({ error: "Missing current or new password." }), { status: 400 });
  }
  if (body.new_password.length < 8) {
    return NextResponse.json(seal({ error: "New password must be at least 8 characters." }), { status: 400 });
  }
  if (!/[0-9]/.test(body.new_password)) {
    return NextResponse.json(seal({ error: "New password must contain at least one number." }), { status: 400 });
  }

  // Pull the access token. Authorization header wins; HttpOnly cookie is
  // the fallback (covers the case where the in-memory token has expired
  // but the long-lived cookie hasn't).
  const access =
    (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") ||
    request.cookies.get(cookieNames.access)?.value ||
    "";

  if (!access) {
    return NextResponse.json(
      seal({ error: "You're signed out. Sign in again to change your password." }),
      { status: 401 }
    );
  }

  // Decode the JWT locally for the email and the expiry check. We trust the
  // JWT here only to extract the claim it advertises (email); the actual
  // proof-of-identity comes from the re-authentication a few lines down.
  const claims = decodeJwtPayload(access);
  const now = Math.floor(Date.now() / 1000);
  if (
    !claims ||
    !claims.email ||
    typeof claims.exp !== "number" ||
    claims.exp <= now - LEEWAY_SECONDS
  ) {
    return NextResponse.json(
      seal({ error: "Your session expired. Sign in again to change your password." }),
      { status: 401 }
    );
  }
  const email = claims.email;

  const reauth = await signInWithPassword(email, body.current_password);
  if (!reauth.ok) {
    return NextResponse.json(
      seal({ error: "Current password is incorrect." }),
      { status: 400 }
    );
  }

  const updated = await updatePasswordWithToken(
    reauth.session.access_token,
    body.new_password,
    body.current_password,
  );
  if (!updated.ok) {
    return NextResponse.json(seal({ error: updated.message }), { status: updated.status });
  }

  // Best-effort confirmation email so users notice unexpected changes.
  try {
    const tpl = passwordChangedTemplate({ whenIso: new Date().toISOString() });
    void sendEmail({
      to: email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      template: "password_changed",
    });
  } catch {
    // Confirmation email is non-critical; never break the flow.
  }

  // Roll the session forward with the freshly authenticated tokens.
  const response = NextResponse.json(seal({ ok: true }));
  setSessionCookies(
    response,
    reauth.session.access_token,
    reauth.session.refresh_token,
    reauth.session.expires_in
  );
  return response;
}
