# ADR 0001 — Wire-encryption envelope

Status: Accepted, in production.

## Context

The product promise is "encrypted intelligence." TLS encrypts on the wire
between two endpoints, but DevTools' Network tab can always read what the
browser sent or received. Customers asked for ciphertext-looking bodies in
DevTools so even an internal observer (compromised CDN, sniffing inside our
VPC) cannot read prompts, system prompts, credentials, invite tokens, or
auth payloads.

## Decision

We add a per-request encryption layer between the browser and the Next.js
API routes:

- **Server static keypair**: ECDH P-256, generated once at deploy.
  Public key inlined in the frontend bundle as
  `NEXT_PUBLIC_SERVER_ECDH_PUB_B64`. Private key in `SERVER_ECDH_PRIV_HEX`
  on the Next.js server only.
- **Per-request key derivation**: client generates an ephemeral X25519
  keypair, performs ECDH, runs HKDF-SHA256 (salt = ephemeral public key,
  info = `quintal-wire-v1`) to a 32-byte AES-256-GCM key.
- **Encryption**: AES-256-GCM with a fresh 12-byte nonce. The request URL
  path is mixed into AAD; an envelope cannot be replayed against a
  different endpoint.
- **Replay protection**: plaintext is `{ ts, body }` where `ts` is Unix
  ms; server enforces ±60s.
- **Wire format**: HTTP POST always (so GETs can carry a body). Logical
  method travels in `X-Wire-Method` header (preferred) and `?_wm=` query
  parameter (fallback for proxies that strip custom headers).

## Consequences

- DevTools shows opaque `{ epk, n, c }` bodies for every API call.
- A CDN compromise no longer leaks user prompts or credentials.
- Failed decryption returns a 400 with a generic message; never leaks
  whether the failure was tag mismatch, replay window, or AAD.
- We pay roughly 0.3 ms CPU + ~150 bytes per request for this. Negligible.
- We added a moving piece (the keypair) that must rotate atomically with
  the frontend bundle. ADR 0002 covers rotation.

## Considered alternatives

- **TLS-only.** Rejected: doesn't address customer concern about
  observers between the browser and our origin.
- **Symmetric key shared via HKDF over JWT.** Rejected: would require the
  user to be authenticated for *every* request, including login and the
  pre-auth `/api/crypto/pubkey`. Per-request ephemeral ECDH solves this.
- **Server-side encryption only (SSE).** Doesn't help the DevTools
  visibility complaint.
