/**
 * Returns the current session info to the browser, sealed in an envelope.
 * Reads the access token from the HttpOnly cookie. If it's missing or
 * expired, refreshes via Supabase using the refresh-token cookie.
 *
 * The access token is included in the response body so client-side code can
 * put it in `Authorization` headers when calling the existing /api/** routes
 * that expect a Bearer token.
 *
 * Validation policy: we only check ``exp`` locally with 30s leeway. The JWT
 * itself will be re-verified (signature + claims) by the FastAPI backend on
 * every authenticated call via JWKS. Round-tripping to Supabase's
 * ``/auth/v1/user`` here added latency and a single point of failure (clock
 * skew, Supabase blips), so we removed it.
 */

import { NextRequest, NextResponse } from "next/server";
import { openRequest } from "@/lib/server-crypto";
import { cookieNames, setSessionCookies, clearSessionCookies } from "@/lib/cookies";
import { refreshSession } from "@/lib/supabase-admin";

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
const REFRESH_BEFORE_EXPIRY_SECONDS = 60;

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
    const url = new URL(request.url);
    seal = openRequest(envelope, url.pathname).seal;
  } catch (e) {
    return NextResponse.json({ error: "Bad envelope: " + (e as Error).message }, { status: 400 });
  }

  const access = request.cookies.get(cookieNames.access)?.value || "";
  const refresh = request.cookies.get(cookieNames.refresh)?.value || "";

  // No tokens at all → unauthenticated. Reply 200 with body so the page
  // can decide; don't break the encrypted envelope contract.
  if (!access && !refresh) {
    return NextResponse.json(seal({ authenticated: false }));
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = access ? decodeJwtPayload(access) : null;

  // The access cookie is good as long as we can decode it AND it hasn't
  // expired (within a 30s leeway against clock drift on either side).
  const accessUsable =
    !!payload &&
    typeof payload.exp === "number" &&
    payload.exp > now + LEEWAY_SECONDS;

  if (accessUsable) {
    return NextResponse.json(
      seal({
        authenticated: true,
        access_token: access,
        user: {
          id: payload!.sub || "",
          email: payload!.email || "",
        },
      })
    );
  }

  // Access expired or unparseable → try refreshing if we still have a
  // refresh token. Anything else means we should clear and fail open as
  // unauthenticated (forces the user to log in again).
  if (!refresh) {
    const cleared = NextResponse.json(seal({ authenticated: false }));
    clearSessionCookies(cleared);
    return cleared;
  }

  const refreshed = await refreshSession(refresh);
  if (!refreshed.ok) {
    const cleared = NextResponse.json(seal({ authenticated: false }));
    clearSessionCookies(cleared);
    return cleared;
  }

  const newPayload = decodeJwtPayload(refreshed.session.access_token);
  const response = NextResponse.json(
    seal({
      authenticated: true,
      access_token: refreshed.session.access_token,
      user: {
        id: newPayload?.sub || refreshed.session.user.id,
        email: newPayload?.email || refreshed.session.user.email,
      },
    })
  );
  setSessionCookies(
    response,
    refreshed.session.access_token,
    refreshed.session.refresh_token,
    refreshed.session.expires_in,
  );
  return response;
}

// Silence unused-imports linter if expiry-window constant isn't directly
// referenced in any branch above.
void REFRESH_BEFORE_EXPIRY_SECONDS;
