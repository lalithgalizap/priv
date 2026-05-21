/**
 * Browser-side encrypted API client.
 *
 * Every encrypted call travels over an HTTP POST to a same-origin /api/**
 * route. The original logical verb (GET/POST/PATCH/DELETE) is sent in the
 * ``X-Wire-Method`` header (preferred) and the ``_wm`` query parameter
 * (fallback for proxies that strip custom headers, e.g. CloudFront's
 * default origin request policy).
 *
 * Body and response are sealed in an ECDH+AES-GCM envelope so DevTools shows
 * ciphertext only. The route's path is bound into AES-GCM AAD; the plaintext
 * carries a millisecond timestamp; the server enforces a ±60s replay window.
 */

import { sealRequest, openResponse, type ResponseEnvelope } from "@/lib/crypto";

let _serverPubPromise: Promise<string> | null = null;

async function getServerPub(): Promise<string> {
  const inlined = process.env.NEXT_PUBLIC_SERVER_ECDH_PUB_B64;
  if (inlined) return inlined;
  if (!_serverPubPromise) {
    _serverPubPromise = fetch("/api/crypto/pubkey", { cache: "force-cache" })
      .then((r) => r.json())
      .then((j: { pub: string }) => j.pub);
  }
  return _serverPubPromise;
}

export interface ApiFetchOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  formData?: FormData;
  signal?: AbortSignal;
}

interface NormalizedBody {
  body: unknown;
}

async function fileToBase64(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = r.result as string;
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function normalizeFormData(fd: FormData): Promise<NormalizedBody> {
  const out: Record<string, unknown> = {};
  const entries = Array.from(fd.entries());
  for (const [key, value] of entries) {
    if (typeof value === "string") {
      out[key] = value;
      continue;
    }
    const file = value as File;
    const b64 = await fileToBase64(file);
    out[key] = {
      __file: true,
      name: file.name || "upload",
      type: file.type || "application/octet-stream",
      size: file.size,
      b64,
    };
  }
  return { body: out };
}

function pathnameOnly(path: string): string {
  const idx = path.indexOf("?");
  return (idx >= 0 ? path.slice(0, idx) : path) || "/";
}

export async function apiFetch<T = unknown>(
  path: string,
  opts: ApiFetchOptions = {}
): Promise<T> {
  const logicalMethod = (
    opts.method ||
    (opts.body !== undefined || opts.formData ? "POST" : "GET")
  ).toUpperCase();

  const headers: Record<string, string> = { ...(opts.headers || {}) };

  let plaintext: unknown = null;
  if (opts.formData) {
    plaintext = (await normalizeFormData(opts.formData)).body;
  } else if (opts.body !== undefined) {
    plaintext = opts.body;
  }

  const serverPub = await getServerPub();
  const aadPath = pathnameOnly(path);
  const { envelope, aesKey, aad } = await sealRequest(serverPub, aadPath, plaintext ?? {});

  headers["Content-Type"] = "application/json";
  headers["X-Wire-Version"] = "1";
  headers["X-Wire-Method"] = logicalMethod;
  const sep = path.includes("?") ? "&" : "?";
  const wirePath = `${path}${sep}_wm=${encodeURIComponent(logicalMethod)}`;

  const res = await fetch(wirePath, {
    method: "POST",
    headers,
    body: JSON.stringify(envelope),
    signal: opts.signal,
    credentials: "same-origin",
  });

  let respJson: unknown = null;
  try {
    respJson = await res.json();
  } catch {
    respJson = null;
  }

  const isEnv =
    respJson &&
    typeof respJson === "object" &&
    "n" in (respJson as Record<string, unknown>) &&
    "c" in (respJson as Record<string, unknown>);

  let payload: unknown;
  if (isEnv) {
    try {
      payload = await openResponse(respJson as ResponseEnvelope, aesKey, aad);
    } catch (e) {
      throw new Error(`Failed to decrypt response: ${(e as Error).message}`);
    }
  } else {
    payload = respJson;
  }

  if (!res.ok) {
    const detail =
      (payload as { error?: string; detail?: string } | null)?.error ||
      (payload as { error?: string; detail?: string } | null)?.detail ||
      `HTTP ${res.status}`;
    const err = new Error(detail) as Error & { status?: number; payload?: unknown };
    err.status = res.status;
    err.payload = payload;
    throw err;
  }

  return payload as T;
}
