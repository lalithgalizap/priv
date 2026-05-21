/**
 * Server-side crypto for the wire-encryption envelope.
 * Runs in Next.js API route handlers (Node runtime).
 *
 * Protocol:
 *   - Server has a static ECDH P-256 keypair. Public key is shipped to the
 *     browser; private key stays in env (SERVER_ECDH_PRIV_HEX).
 *   - Per request, client generates an ephemeral keypair, performs ECDH,
 *     derives an AES-256-GCM key with HKDF-SHA256, and encrypts the body.
 *   - Server reverses the process. Same derived key is reused to encrypt the
 *     response (one-shot session, fresh nonce).
 *
 * Wire format:
 *   request:  { v:1, epk:b64, n:b64, c:b64 }
 *   response: { n:b64, c:b64 }
 */

import crypto from "node:crypto";

const HKDF_INFO = Buffer.from("quintal-wire-v1", "utf-8");

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

/**
 * Decrypt a request envelope and return the parsed JSON plaintext along with
 * a sealer that can be used to encrypt the corresponding response.
 */
export function openRequest(envelope: {
  v?: number;
  epk?: string;
  n?: string;
  c?: string;
}): { body: unknown; seal: (data: unknown) => { n: string; c: string } } {
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

  // ECDH shared secret
  const shared = getServerEcdh().computeSecret(clientPub);

  // HKDF-SHA256 → 32-byte AES-GCM key. Salt = client ephemeral pub key.
  const aesKey = Buffer.from(
    crypto.hkdfSync("sha256", shared, clientPub, HKDF_INFO, 32) as ArrayBuffer
  );

  // AES-256-GCM decrypt (last 16 bytes are the GCM tag)
  const tag = ct.subarray(ct.length - 16);
  const ctOnly = ct.subarray(0, ct.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, nonce);
  decipher.setAuthTag(tag);
  const ptBuf = Buffer.concat([decipher.update(ctOnly), decipher.final()]);

  let body: unknown = null;
  if (ptBuf.length > 0) {
    try {
      body = JSON.parse(ptBuf.toString("utf-8"));
    } catch {
      body = ptBuf.toString("utf-8");
    }
  }

  function seal(data: unknown): { n: string; c: string } {
    const respNonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, respNonce);
    const text = data === undefined ? "" : JSON.stringify(data);
    const enc = Buffer.concat([cipher.update(Buffer.from(text, "utf-8")), cipher.final()]);
    const t = cipher.getAuthTag();
    return { n: bufToB64(respNonce), c: bufToB64(Buffer.concat([enc, t])) };
  }

  return { body, seal };
}
