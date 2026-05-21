/**
 * Shared cookie helpers for our auth flow.
 * - sb-access-token: short-lived access JWT, HttpOnly. Used by middleware to gate routes.
 * - sb-refresh-token: long-lived refresh token, HttpOnly. Used by /api/auth/refresh.
 *
 * Both are HttpOnly so JavaScript cannot read them. The browser auto-sends them
 * with same-origin requests; our route handlers extract them from cookies and
 * forward to the FastAPI backend as a Bearer token.
 */

import { NextResponse } from "next/server";

const ACCESS_COOKIE = "sb-access-token";
const REFRESH_COOKIE = "sb-refresh-token";

const isProd = process.env.NODE_ENV === "production";

export function setSessionCookies(
  res: NextResponse,
  access: string,
  refresh: string,
  expiresInSeconds: number
): void {
  res.cookies.set(ACCESS_COOKIE, access, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(60, expiresInSeconds),
  });
  res.cookies.set(REFRESH_COOKIE, refresh, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    // Refresh tokens last roughly 30 days on Supabase by default.
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSessionCookies(res: NextResponse): void {
  res.cookies.set(ACCESS_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, "", { path: "/", maxAge: 0 });
}

export const cookieNames = {
  access: ACCESS_COOKIE,
  refresh: REFRESH_COOKIE,
};
