/**
 * Browser-side encrypted API client.
 *
 * Every encrypted call travels over an HTTP POST to a same-origin /api/**
 * route. The original logical verb (GET / PATCH / DELETE / POST) is sent in
 * the `X-Wire-Method` header so the route handler can dispatch internally.
 * This sidesteps the browser-side restriction that GET requests cannot carry
 * a body, while keeping a single uniform wire protocol.
 *
 * Body and response are sealed in an ECDH+AES-GCM envelope so DevTools shows
 * ciphertext only.
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

export async function apiFetch<T = unknown>(
  path: string,
  opts: ApiFetchOptions = {}
): Promise<T> {
  // Logical method as the caller intended.
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
  const { envelope, aesKey } = await sealRequest(serverPub, plaintext ?? {});

  headers["Content-Type"] = "application/json";
  headers["X-Wire-Version"] = "1";
  // Logical method travels via the X-Wire-Method header AND a query parameter.
  // CloudFront / proxies often strip non-allowlisted custom headers; the query
  // parameter is always forwarded as part of the path so the route handler can
  // dispatch correctly even when the header is missing.
  headers["X-Wire-Method"] = logicalMethod;
  const sep = path.includes("?") ? "&" : "?";
  const wirePath = `${path}${sep}_wm=${encodeURIComponent(logicalMethod)}`;

  // Wire method is always POST to allow a request body in every case.
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
      payload = await openResponse(respJson as ResponseEnvelope, aesKey);
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
