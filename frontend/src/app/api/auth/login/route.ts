/**
 * Encrypted login route. Browser sends an envelope with { email, password };
 * we exchange them with Supabase server-side and return the resulting session.
 * Plaintext credentials NEVER appear in the browser's network tab.
 */

import { NextRequest, NextResponse } from "next/server";
import { openRequest } from "@/lib/server-crypto";
import { signInWithPassword } from "@/lib/supabase-admin";
import { setSessionCookies } from "@/lib/cookies";

interface LoginBody {
  email?: string;
  password?: string;
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

  let body: LoginBody;
  let seal: (data: unknown) => { n: string; c: string };
  try {
    const url = new URL(request.url);
    const opened = openRequest(envelope, url.pathname);
    body = (opened.body || {}) as LoginBody;
    seal = opened.seal;
  } catch (e) {
    return NextResponse.json({ error: "Bad envelope: " + (e as Error).message }, { status: 400 });
  }

  if (!body.email || !body.password) {
    const sealed = seal({ error: "Missing email or password." });
    return NextResponse.json(sealed, { status: 400 });
  }

  const result = await signInWithPassword(body.email, body.password);
  if (!result.ok) {
    const sealed = seal({ error: result.message });
    return NextResponse.json(sealed, { status: result.status });
  }

  const sealed = seal({
    access_token: result.session.access_token,
    expires_in: result.session.expires_in,
    user: { id: result.session.user.id, email: result.session.user.email },
  });

  const response = NextResponse.json(sealed);
  setSessionCookies(
    response,
    result.session.access_token,
    result.session.refresh_token,
    result.session.expires_in
  );
  return response;
}
