/**
 * Browser-side auth client.
 *
 * - Login/signup/logout/password-change all go through encrypted /api/auth/*
 *   routes, so plaintext credentials never appear in the network tab.
 * - The access JWT is held in a module-level variable plus mirrored as a
 *   non-HttpOnly companion cookie ("sb-access-shadow") so SSR middleware can
 *   read it. The HttpOnly cookies are the source of truth on the server.
 * - getAccessToken() refreshes silently if the in-memory token is missing or
 *   expired. After a 401 from the backend, authedFetch forces a refresh and
 *   retries once, so any race between login completion and the first
 *   authenticated call self-heals.
 */

"use client";

import { apiFetch, type ApiFetchOptions } from "@/lib/api";

interface LoginResponse {
  access_token: string;
  expires_in: number;
  user: { id: string; email: string };
}

interface SessionResponse {
  authenticated: boolean;
  access_token?: string;
  user?: { id: string; email: string };
}

interface SignupResponse {
  access_token: string | null;
  user: { id: string; email: string };
  email_confirmation_required: boolean;
}

let _token: string | null = null;
let _expiresAt = 0;
let _user: { id: string; email: string } | null = null;
let _refreshPromise: Promise<string | null> | null = null;
const _listeners = new Set<() => void>();

function notify() {
  _listeners.forEach((fn) => {
    try {
      fn();
    } catch (err) {
      console.warn("auth change listener threw:", err);
    }
  });
}

function setShadowCookie(token: string, expiresInSeconds: number): void {
  if (typeof document === "undefined") return;
  const maxAge = Math.max(60, expiresInSeconds);
  document.cookie = `sb-access-shadow=${token}; path=/; max-age=${maxAge}; SameSite=Lax${
    location.protocol === "https:" ? "; Secure" : ""
  }`;
}

function clearShadowCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = "sb-access-shadow=; path=/; max-age=0; SameSite=Lax";
}

function persistSession(
  token: string,
  expiresInSeconds: number,
  user: { id: string; email: string }
): void {
  _token = token;
  _expiresAt = Date.now() + Math.max(60, expiresInSeconds || 3600) * 1000;
  _user = user;
  setShadowCookie(token, expiresInSeconds || 3600);
  notify();
}

function clearSession(): void {
  _token = null;
  _expiresAt = 0;
  _user = null;
  clearShadowCookie();
  notify();
}

async function fetchSession(): Promise<string | null> {
  try {
    const data = await apiFetch<SessionResponse>("/api/auth/session", {
      method: "POST",
      body: {},
    });
    if (!data.authenticated || !data.access_token) {
      clearSession();
      return null;
    }
    persistSession(data.access_token, 3600, data.user || { id: "", email: "" });
    return data.access_token;
  } catch {
    clearSession();
    return null;
  }
}

/**
 * Verify the cached token works against /api/me. If the backend returns 401,
 * force-refresh from /api/auth/session (which reads the HttpOnly cookies and
 * re-validates with Supabase). After this returns successfully, subsequent
 * authedFetch calls use a token the backend has already accepted.
 */
async function verifyOrRefreshToken(): Promise<string | null> {
  const token = _token;
  if (!token) return fetchSession();

  try {
    await apiFetch("/api/me", {
      method: "POST", // wire method; /api/me handler dispatches X-Wire-Method=GET internally
      headers: { "X-Wire-Method": "GET", Authorization: `Bearer ${token}` },
    });
    return token;
  } catch (err) {
    const fe = err as { status?: number };
    if (fe?.status === 401 || fe?.status === 403) {
      _token = null;
      _expiresAt = 0;
      _refreshPromise = null;
      return fetchSession();
    }
    return token;
  }
}

/**
 * Force a session refresh by clearing the in-memory token and re-fetching
 * via /api/auth/session (which authoritatively reads the HttpOnly cookies).
 */
async function forceRefreshToken(): Promise<string | null> {
  _token = null;
  _expiresAt = 0;
  _refreshPromise = null;
  return getAccessToken();
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const data = await apiFetch<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  persistSession(data.access_token, data.expires_in, data.user);
  // Verify the freshly-issued token round-trips correctly through the
  // backend before any navigation. If the cached token is rejected we
  // fall back to /api/auth/session, which authoritatively reads the
  // HttpOnly cookies that this very response just set.
  try {
    await verifyOrRefreshToken();
  } catch (err) {
    console.warn("Post-login verification failed; authedFetch will retry on 401:", err);
  }
  return data;
}

export async function signup(email: string, password: string): Promise<SignupResponse> {
  const data = await apiFetch<SignupResponse>("/api/auth/signup", {
    method: "POST",
    body: { email, password },
  });
  if (data.access_token) {
    persistSession(data.access_token, 3600, data.user);
    try {
      await verifyOrRefreshToken();
    } catch (err) {
      console.warn("Post-signup verification failed:", err);
    }
  }
  return data;
}

export async function logout(): Promise<void> {
  try {
    await apiFetch("/api/auth/logout", { method: "POST", body: {} });
  } catch (err) {
    console.warn("Logout request failed; clearing local session anyway:", err);
  }
  clearSession();
}

export async function changePassword(current: string, next: string): Promise<void> {
  await apiFetch("/api/auth/password", {
    method: "POST",
    body: { current_password: current, new_password: next },
  });
}

/** Returns a usable access token, refreshing from the cookies if needed. */
export async function getAccessToken(): Promise<string | null> {
  if (_token && Date.now() < _expiresAt - 30_000) {
    return _token;
  }
  if (!_refreshPromise) {
    _refreshPromise = fetchSession().finally(() => {
      _refreshPromise = null;
    });
  }
  return _refreshPromise;
}

export function getCachedToken(): string | null {
  return _token;
}

export function getCachedUser(): { id: string; email: string } | null {
  return _user;
}

export function onAuthChange(listener: () => void): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

interface FetchError {
  status?: number;
}

/**
 * authedFetch — apiFetch wrapper that automatically attaches the current
 * session's access token. On a 401 response, force-refreshes the token and
 * retries the call once. This makes the bootstrap right after login robust
 * against any timing window between the response setting cookies and the
 * first authenticated call going out.
 */
export async function authedFetch<T = unknown>(
  path: string,
  opts: ApiFetchOptions = {}
): Promise<T> {
  const sendOnce = async (token: string | null): Promise<T> => {
    const headers: Record<string, string> = { ...(opts.headers || {}) };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return apiFetch<T>(path, { ...opts, headers });
  };

  const token = await getAccessToken();
  try {
    return await sendOnce(token);
  } catch (err) {
    const fe = err as FetchError;
    if (fe?.status !== 401 && fe?.status !== 403) throw err;

    const fresh = await forceRefreshToken();
    if (!fresh || fresh === token) throw err;

    return sendOnce(fresh);
  }
}
