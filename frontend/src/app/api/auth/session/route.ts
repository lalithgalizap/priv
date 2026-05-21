/**
 * Returns the current session info to the browser, sealed in an envelope.
 * Reads the access token from the HttpOnly cookie. If the access token is
 * missing or expired, refreshes it using the refresh-token cookie.
 *
 * The access token is included in the response so client-side code can put it
 * in `Authorization` headers when calling the existing /api/** routes that
 * expect a Bearer token.
 */

import { NextRequest, NextResponse } from "next/server";
import { openRequest } from "@/lib/server-crypto";
import { cookieNames, setSessionCookies, clearSessionCookies } from "@/lib/cookies";
import { refreshSession, getUserFromToken } from "@/lib/supabase-admin";

function decodeJwtPayload(jwt: string): { exp?: number; sub?: string; email?: string } | null {
  try {
    const part = jwt.split(".")[1];
    const padded = part + "=".repeat((4 - (part.length % 4)) % 4);
    const txt = Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
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
    return NextResponse.json({ error: "Encrypted envelope required." }, { status: 400 });
  }

  let seal: (data: unknown) => { n: string; c: string };
  try {
    seal = openRequest(envelope).seal;
  } catch (e) {
    return NextResponse.json({ error: "Bad envelope: " + (e as Error).message }, { status: 400 });
  }

  const access = request.cookies.get(cookieNames.access)?.value || "";
  const refresh = request.cookies.get(cookieNames.refresh)?.value || "";

  // No tokens at all → unauthenticated, but reply 200 so the page can decide.
  if (!access && !refresh) {
    return NextResponse.json(seal({ authenticated: false }));
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = access ? decodeJwtPayload(access) : null;
  const expired = !payload || (payload.exp && payload.exp <= now + 30);

  let activeAccess = access;
  let needsCookieUpdate = false;
  let activeRefresh = refresh;
  let activeExpiresIn = 3600;

  if (expired && refresh) {
    const refreshed = await refreshSession(refresh);
    if (!refreshed.ok) {
      const cleared = NextResponse.json(seal({ authenticated: false }));
      clearSessionCookies(cleared);
      return cleared;
    }
    activeAccess = refreshed.session.access_token;
    activeRefresh = refreshed.session.refresh_token;
    activeExpiresIn = refreshed.session.expires_in;
    needsCookieUpdate = true;
  }

  if (!activeAccess) {
    const cleared = NextResponse.json(seal({ authenticated: false }));
    clearSessionCookies(cleared);
    return cleared;
  }

  // Confirm with Supabase that the token is actually valid (cheap GET /auth/v1/user)
  const user = await getUserFromToken(activeAccess);
  if (!user) {
    const cleared = NextResponse.json(seal({ authenticated: false }));
    clearSessionCookies(cleared);
    return cleared;
  }

  const response = NextResponse.json(
    seal({
      authenticated: true,
      access_token: activeAccess,
      user: { id: user.id, email: user.email },
    })
  );
  if (needsCookieUpdate) {
    setSessionCookies(response, activeAccess, activeRefresh, activeExpiresIn);
  }
  return response;
}
