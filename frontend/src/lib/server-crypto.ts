/**
 * Server-side crypto for the wire-encryption envelope.
 * Runs in Next.js API route handlers (Node runtime).
 *
 * Protocol:
 *   - Server has a static ECDH P-256 keypair. Public key is shipped to the
 *     browser; private key stays in env (SERVER_ECDH_PRIV_HEX).
 *   - Per request, client generates an ephemeral keypair, performs ECDH,
 *     derives an AES-256-GCM key with HKDF-SHA256, and encrypts the body.
 *   - The route's pathname is mixed into the AES-GCM Additional Authenticated
 *     Data (AAD), so an envelope captured at /api/me cannot be replayed at
 *     /api/auth/login — they decrypt to garbage.
 *   - The plaintext carries a Unix-millisecond timestamp; the server rejects
 *     anything outside ±60s, blocking replay attacks.
 *
 * Wire format:
 *   request:  { v:1, epk:b64, n:b64, c:b64 }
 *   plaintext (request): { ts: <number>, body: <unknown> }
 *   response: { n:b64, c:b64 }
 *   plaintext (response): the JSON-serialisable handler result
 */

import crypto from "node:crypto";

const HKDF_INFO = Buffer.from("quintal-wire-v1", "utf-8");
const REPLAY_WINDOW_MS = 60_000;

const SERVER_PRIV_HEX = process.env.SERVER_ECDH_PRIV_HEX || "";

let _serverEcdh: crypto.ECDH | null = null;

function getServerEcdh(): crypto.ECDH {
  if (_serverEcdh) return _serverEcdh;
  if (!SERVER_PRIV_HEX || SERVER_PRIV_HEX.length !== 64) {
    throw new Error("SERVER_ECDH_PRIV_HEX missing or malformed (need 64 hex chars).");
  }
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(SERVER_PRIV_HEX, "hex"));
  _serverEcdh = ecdh;
  return ecdh;
}

/** Returns the server's static ECDH P-256 public key, base64 (uncompressed). */
export function getServerPubKeyB64(): string {
  return getServerEcdh().getPublicKey(null, "uncompressed").toString("base64");
}

function b64ToBuf(s: string): Buffer {
  return Buffer.from(s, "base64");
}

function bufToB64(b: Buffer | Uint8Array): string {
  return Buffer.from(b).toString("base64");
}

function pathAad(path: string): Buffer {
  // Bind the request path into the AAD so an envelope can't be replayed
  // against a different endpoint. We strip query parameters because clients
  // (and our own apiFetch) can append cache-busters and the wire-method
  // fallback parameter.
  const noQuery = (path || "").split("?")[0] || "/";
  return Buffer.from(`path:${noQuery}`, "utf-8");
}

export interface OpenedEnvelope {
  body: unknown;
  seal: (data: unknown) => { n: string; c: string };
}

/**
 * Decrypt a request envelope, validate the embedded timestamp against the
 * replay window, and return both the parsed JSON plaintext and a sealer that
 * encrypts the corresponding response (with a fresh nonce, same key).
 *
 * Pass the route path as ``pathForAad`` so AAD-binding can reject envelopes
 * captured against a different URL.
 */
export function openRequest(
  envelope: { v?: number; epk?: string; n?: string; c?: string },
  pathForAad: string
): OpenedEnvelope {
  if (!envelope || !envelope.epk || !envelope.n || !envelope.c) {
    throw new Error("Bad envelope.");
  }

  const clientPub = b64ToBuf(envelope.epk);
  const nonce = b64ToBuf(envelope.n);
  const ct = b64ToBuf(envelope.c);

  if (clientPub.length !== 65 || clientPub[0] !== 0x04) {
    throw new Error("Bad client pubkey.");
  }
  if (nonce.length !== 12) throw new Error("Bad nonce.");
  if (ct.length < 16) throw new Error("Bad ciphertext.");

  const shared = getServerEcdh().computeSecret(clientPub);
  const aesKey = Buffer.from(
    crypto.hkdfSync("sha256", shared, clientPub, HKDF_INFO, 32) as ArrayBuffer
  );

  const aad = pathAad(pathForAad);
  const tag = ct.subarray(ct.length - 16);
  const ctOnly = ct.subarray(0, ct.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);

  let ptBuf: Buffer;
  try {
    ptBuf = Buffer.concat([decipher.update(ctOnly), decipher.final()]);
  } catch {
    // GCM tag mismatch -> wrong key, tampered ciphertext, or wrong AAD (replay).
    throw new Error("Envelope authentication failed.");
  }

  let plaintext: unknown = null;
  if (ptBuf.length > 0) {
    try {
      plaintext = JSON.parse(ptBuf.toString("utf-8"));
    } catch {
      plaintext = ptBuf.toString("utf-8");
    }
  }

  // Reject stale or forward-dated envelopes: replay protection.
  const ts =
    plaintext && typeof plaintext === "object" && "ts" in (plaintext as Record<string, unknown>)
      ? (plaintext as { ts?: unknown }).ts
      : undefined;
  if (typeof ts !== "number" || !Number.isFinite(ts)) {
    throw new Error("Missing or invalid timestamp.");
  }
  const skew = Math.abs(Date.now() - ts);
  if (skew > REPLAY_WINDOW_MS) {
    throw new Error("Envelope outside replay window.");
  }

  const body =
    plaintext && typeof plaintext === "object" && "body" in (plaintext as Record<string, unknown>)
      ? (plaintext as { body?: unknown }).body
      : null;

  function seal(data: unknown): { n: string; c: string } {
    const respNonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, respNonce);
    cipher.setAAD(aad);
    const text = data === undefined ? "" : JSON.stringify(data);
    const enc = Buffer.concat([cipher.update(Buffer.from(text, "utf-8")), cipher.final()]);
    const t = cipher.getAuthTag();
    return { n: bufToB64(respNonce), c: bufToB64(Buffer.concat([enc, t])) };
  }

  return { body, seal };
}
