/**
 * Browser-side crypto for the wire-encryption envelope.
 *
 * Uses the WebCrypto SubtleCrypto API (built into every modern browser).
 * No external dependencies.
 *
 *   - Generate ephemeral P-256 keypair per request
 *   - ECDH against the server's static public key
 *   - HKDF-SHA256 → 32-byte AES-256-GCM key
 *   - The request URL path is mixed into AES-GCM Additional Authenticated
 *     Data (AAD) so a captured envelope cannot be replayed against a
 *     different endpoint.
 *   - Plaintext carries a millisecond timestamp; the server enforces a
 *     ±60s replay window.
 */

const HKDF_INFO_BYTES = new TextEncoder().encode("quintal-wire-v1");

let _cachedServerPubB64: string | null = null;
let _cachedServerPubKey: CryptoKey | null = null;

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

function pathAad(path: string): Uint8Array {
  const noQuery = (path || "").split("?")[0] || "/";
  return new TextEncoder().encode(`path:${noQuery}`);
}

async function importServerPub(serverPubB64: string): Promise<CryptoKey> {
  if (_cachedServerPubB64 === serverPubB64 && _cachedServerPubKey) {
    return _cachedServerPubKey;
  }
  const raw = b64ToBytes(serverPubB64);
  const key = await crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  _cachedServerPubB64 = serverPubB64;
  _cachedServerPubKey = key;
  return key;
}

async function deriveAesKey(
  privKey: CryptoKey,
  pubKey: CryptoKey,
  salt: Uint8Array
): Promise<CryptoKey> {
  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: pubKey },
    privKey,
    256
  );
  const ikm = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as BufferSource,
      info: HKDF_INFO_BYTES as BufferSource,
    },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export interface RequestEnvelope {
  v: 1;
  epk: string;
  n: string;
  c: string;
}

export interface ResponseEnvelope {
  n: string;
  c: string;
}

/**
 * Seal a JSON-serialisable plaintext into a request envelope.
 *
 * The plaintext is wrapped as ``{ ts, body }`` so the server can enforce a
 * replay window. The route path is bound into AES-GCM AAD.
 */
export async function sealRequest(
  serverPubB64: string,
  pathForAad: string,
  body: unknown
): Promise<{ envelope: RequestEnvelope; aesKey: CryptoKey; aad: Uint8Array }> {
  const serverPub = await importServerPub(serverPubB64);

  const ephemeral = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"]
  );
  const ephPubRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", ephemeral.publicKey)
  );

  const aesKey = await deriveAesKey(ephemeral.privateKey, serverPub, ephPubRaw);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const aad = pathAad(pathForAad);

  const wrapped = { ts: Date.now(), body: body ?? null };
  const ptBytes = new TextEncoder().encode(JSON.stringify(wrapped));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: nonce as BufferSource,
        additionalData: aad as BufferSource,
      },
      aesKey,
      ptBytes as BufferSource
    )
  );

  return {
    envelope: {
      v: 1,
      epk: bytesToB64(ephPubRaw),
      n: bytesToB64(nonce),
      c: bytesToB64(ct),
    },
    aesKey,
    aad,
  };
}

/** Decrypt a response envelope using the AES key and AAD from sealRequest(). */
export async function openResponse(
  envelope: ResponseEnvelope,
  aesKey: CryptoKey,
  aad: Uint8Array
): Promise<unknown> {
  if (!envelope || !envelope.n || !envelope.c) {
    throw new Error("Bad response envelope.");
  }
  const nonce = b64ToBytes(envelope.n);
  const ct = b64ToBytes(envelope.c);
  const pt = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: nonce as BufferSource,
        additionalData: aad as BufferSource,
      },
      aesKey,
      ct as BufferSource
    )
  );
  if (pt.byteLength === 0) return null;
  const text = new TextDecoder().decode(pt);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
