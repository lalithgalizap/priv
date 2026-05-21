import { NextRequest, NextResponse } from "next/server";
import { openRequest } from "@/lib/server-crypto";
import { signUpWithPassword } from "@/lib/supabase-admin";
import { setSessionCookies } from "@/lib/cookies";

interface SignupBody {
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

  let body: SignupBody;
  let seal: (data: unknown) => { n: string; c: string };
  try {
    const opened = openRequest(envelope);
    body = (opened.body || {}) as SignupBody;
    seal = opened.seal;
  } catch (e) {
    return NextResponse.json({ error: "Bad envelope: " + (e as Error).message }, { status: 400 });
  }

  if (!body.email || !body.password) {
    return NextResponse.json(seal({ error: "Missing email or password." }), { status: 400 });
  }
  if (body.password.length < 6) {
    return NextResponse.json(seal({ error: "Password must be at least 6 characters." }), { status: 400 });
  }

  const result = await signUpWithPassword(body.email, body.password);
  if (!result.ok) {
    return NextResponse.json(seal({ error: result.message }), { status: result.status });
  }

  if (result.session) {
    const sealed = seal({
      access_token: result.session.access_token,
      expires_in: result.session.expires_in,
      user: { id: result.session.user.id, email: result.session.user.email },
      email_confirmation_required: false,
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

  // Email confirmation required — no session yet.
  return NextResponse.json(
    seal({
      access_token: null,
      user: { id: result.user.id, email: result.user.email },
      email_confirmation_required: true,
    })
  );
}
