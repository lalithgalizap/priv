/**
 * Server-side helper that calls the FastAPI backend from a Next.js API route.
 * Used after the wire envelope has been opened (the body is already plaintext
 * here). The hop from Next.js → FastAPI is on TLS in production (via
 * CloudFront/ALB) or loopback in development.
 *
 * In production we fail fast at startup if BACKEND_URL is missing, so a
 * misconfigured deployment surfaces immediately instead of silently routing
 * to localhost where there's no backend.
 */

const BACKEND_URL = (() => {
  const fromEnv = process.env.BACKEND_URL;
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    // Throw at module load time; better than silently 503'ing forever.
    throw new Error(
      "BACKEND_URL is required in production. Set it in your environment.",
    );
  }
  return "http://127.0.0.1:8000";
})();

interface BackendCallOptions {
  path: string;
  method?: string;
  body?: unknown;
  authHeader?: string | null;
  formData?: FormData;
  query?: Record<string, string | number | undefined | null>;
}

export interface BackendResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

export async function callBackend<T = unknown>(
  opts: BackendCallOptions
): Promise<BackendResult<T>> {
  const headers: Record<string, string> = {};
  if (opts.authHeader) headers["Authorization"] = opts.authHeader;

  let url = `${BACKEND_URL}${opts.path}`;
  if (opts.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== "") params.append(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  }

  const init: RequestInit = {
    method: (opts.method || "GET").toUpperCase(),
    headers,
  };

  if (opts.formData) {
    init.body = opts.formData;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return {
      ok: false,
      status: 503,
      data: { error: "Backend unreachable: " + (err as Error).message } as T,
    };
  }

  let data: unknown;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } else {
    const text = await res.text().catch(() => "");
    data = text ? { error: text.slice(0, 500) } : null;
  }

  return { ok: res.ok, status: res.status, data: data as T };
}
