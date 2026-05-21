/**
 * Server-only helpers that talk to Supabase Auth from Next.js API routes.
 * NEVER import this from a client component — it uses the service key.
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

if (!SUPABASE_URL) {
  console.warn("SUPABASE_URL is not set. Auth routes will fail.");
}

export interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  expires_at?: number;
  user: { id: string; email: string };
}

export interface SupabaseUser {
  id: string;
  email: string;
}

interface AuthError {
  error: string;
  status: number;
}

function isAuthError(o: unknown): o is AuthError {
  return !!o && typeof o === "object" && typeof (o as AuthError).error === "string";
}

async function authPost(
  path: string,
  body: Record<string, unknown>,
  bearerKey?: string
): Promise<{ status: number; data: unknown }> {
  const url = `${SUPABASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: bearerKey || SUPABASE_ANON_KEY,
    Authorization: `Bearer ${bearerKey || SUPABASE_ANON_KEY}`,
  };
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

async function authGet(path: string, bearerKey?: string): Promise<{ status: number; data: unknown }> {
  const url = `${SUPABASE_URL}${path}`;
  const headers: Record<string, string> = {
    apikey: bearerKey || SUPABASE_ANON_KEY,
    Authorization: `Bearer ${bearerKey || SUPABASE_ANON_KEY}`,
  };
  const res = await fetch(url, { headers });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

export async function signInWithPassword(
  email: string,
  password: string
): Promise<{ ok: true; session: SupabaseSession } | { ok: false; status: number; message: string }> {
  const { status, data } = await authPost("/auth/v1/token?grant_type=password", { email, password });
  if (status >= 400) {
    const msg =
      (data as { error_description?: string; msg?: string; error?: string } | null)?.error_description ||
      (data as { msg?: string } | null)?.msg ||
      (isAuthError(data) ? data.error : "Invalid credentials.");
    return { ok: false, status, message: msg };
  }
  return { ok: true, session: data as SupabaseSession };
}

export async function signUpWithPassword(
  email: string,
  password: string,
  metadata?: Record<string, unknown>
): Promise<
  | { ok: true; session: SupabaseSession | null; user: SupabaseUser }
  | { ok: false; status: number; message: string }
> {
  const body: Record<string, unknown> = { email, password };
  if (metadata) body.data = metadata;
  const { status, data } = await authPost("/auth/v1/signup", body);
  if (status >= 400) {
    const msg =
      (data as { error_description?: string; msg?: string; error?: string } | null)?.error_description ||
      (data as { msg?: string } | null)?.msg ||
      (isAuthError(data) ? data.error : "Sign up failed.");
    return { ok: false, status, message: msg };
  }
  // /signup returns either a session (when email confirm disabled) or just the user.
  const obj = data as Record<string, unknown>;
  if (obj && typeof obj.access_token === "string") {
    return { ok: true, session: data as SupabaseSession, user: (data as SupabaseSession).user };
  }
  return {
    ok: true,
    session: null,
    user: (obj && obj.user
      ? (obj.user as unknown as SupabaseUser)
      : (obj as unknown as SupabaseUser)),
  };
}

export async function refreshSession(
  refresh_token: string
): Promise<{ ok: true; session: SupabaseSession } | { ok: false; status: number; message: string }> {
  const { status, data } = await authPost("/auth/v1/token?grant_type=refresh_token", { refresh_token });
  if (status >= 400) {
    return {
      ok: false,
      status,
      message: (data as { error_description?: string } | null)?.error_description || "Refresh failed.",
    };
  }
  return { ok: true, session: data as SupabaseSession };
}

export async function logout(access_token: string): Promise<void> {
  if (!access_token) return;
  // Supabase logout endpoint requires the user's access token in Authorization.
  const url = `${SUPABASE_URL}/auth/v1/logout`;
  await fetch(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${access_token}`,
    },
  }).catch(() => undefined);
}

export async function updatePasswordWithToken(
  access_token: string,
  new_password: string
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const url = `${SUPABASE_URL}/auth/v1/user`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: new_password }),
  });
  if (res.status >= 400) {
    const data = await res.json().catch(() => ({}));
    return {
      ok: false,
      status: res.status,
      message:
        (data as { msg?: string; error_description?: string }).msg ||
        (data as { msg?: string; error_description?: string }).error_description ||
        "Password update failed.",
    };
  }
  return { ok: true };
}

/**
 * Generate a recovery link for ``email`` via the Supabase Admin API.
 *
 * We use the admin generate-link endpoint instead of /auth/v1/recover so the
 * backend hands us the URL directly (Supabase doesn't auto-send when we use
 * its built-in mail templates AND we want to send via Resend with our own
 * branding). The action_link Supabase returns includes the recovery token
 * as a fragment; we route it through our own /reset-password page.
 *
 * Always succeeds with ok:true even on unknown email — we don't want to
 * leak which addresses exist. Provider-side errors are logged but the
 * response is uniform.
 */
export async function generatePasswordRecoveryLink(
  email: string,
  redirectTo: string
): Promise<{ ok: true; action_link: string | null }> {
  if (!SUPABASE_SERVICE_KEY) {
    console.warn("[supabase-admin] SUPABASE_SERVICE_KEY not set; cannot generate recovery link");
    return { ok: true, action_link: null };
  }
  try {
    const url = `${SUPABASE_URL}/auth/v1/admin/generate_link`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "recovery",
        email,
        options: { redirect_to: redirectTo },
      }),
    });
    if (res.status >= 400) {
      // Treat unknown-email and rate-limit identically to a successful call.
      // We log for ops visibility but don't surface to caller.
      const text = await res.text().catch(() => "");
      console.warn("[supabase-admin] generate_link non-2xx", res.status, text.slice(0, 200));
      return { ok: true, action_link: null };
    }
    const data = (await res.json().catch(() => ({}))) as {
      action_link?: string;
      properties?: { action_link?: string };
    };
    const link = data.action_link || data.properties?.action_link || null;
    return { ok: true, action_link: link };
  } catch (e) {
    console.warn("[supabase-admin] generate_link crashed", (e as Error).message);
    return { ok: true, action_link: null };
  }
}

export async function getUserFromToken(access_token: string): Promise<SupabaseUser | null> {
  if (!SUPABASE_URL) return null;
  const { status, data } = await authGet("/auth/v1/user", access_token);
  if (status >= 400) return null;
  const u = data as SupabaseUser;
  return u && u.id ? u : null;
}

export function hasServiceKey(): boolean {
  return !!SUPABASE_SERVICE_KEY;
}
