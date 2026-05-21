/**
 * Encrypted password change. Client sends { current_password, new_password }.
 * We verify by re-signing with the current credentials, then PUT /auth/v1/user
 * to update. Server-mediated so the password never appears in the browser's
 * network tab.
 */

import { NextRequest, NextResponse } from "next/server";
import { openRequest } from "@/lib/server-crypto";
import { signInWithPassword, updatePasswordWithToken, getUserFromToken } from "@/lib/supabase-admin";
import { cookieNames, setSessionCookies } from "@/lib/cookies";
import { sendEmail } from "@/lib/email";
import { passwordChangedTemplate } from "@/lib/email-templates";

interface ChangeBody {
  current_password?: string;
  new_password?: string;
}

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

  const access =
    request.cookies.get(cookieNames.access)?.value ||
    (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!access) {
    return NextResponse.json(seal({ error: "Unauthorized." }), { status: 401 });
  }

  const me = await getUserFromToken(access);
  if (!me || !me.email) {
    return NextResponse.json(seal({ error: "Unauthorized." }), { status: 401 });
  }

  const reauth = await signInWithPassword(me.email, body.current_password);
  if (!reauth.ok) {
    return NextResponse.json(seal({ error: "Current password is incorrect." }), { status: 400 });
  }

  const updated = await updatePasswordWithToken(reauth.session.access_token, body.new_password);
  if (!updated.ok) {
    return NextResponse.json(seal({ error: updated.message }), { status: updated.status });
  }

  // Best-effort confirmation email so users notice unexpected changes.
  try {
    const tpl = passwordChangedTemplate({ whenIso: new Date().toISOString() });
    void sendEmail({
      to: me.email,
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
