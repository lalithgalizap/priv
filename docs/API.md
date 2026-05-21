# API Reference

The FastAPI application exposes an OpenAPI spec at:

- Live: `https://<host>/api/v1/openapi.json` (proxied via Next.js if you
  expose it, or hit FastAPI directly on port 8000 in dev).
- Interactive Swagger UI: `https://<host>/api/v1/docs`.
- Redoc UI: `https://<host>/api/v1/redoc`.

Every route is prefixed with `/api/v1/`. The Next.js layer wraps each
route in an encrypted envelope (see [ADR 0001](./adr/0001-wire-encryption-envelope.md))
so browsers call `/api/<route>` and the Next.js handler relays to FastAPI.

## Authentication

Most routes require `Authorization: Bearer <Supabase access token>`.
For the encrypted browser flow, the token sits in HttpOnly cookies set
by `/api/auth/login`; the Next.js helper `authedFetch` reads it via the
in-memory cache populated by `/api/auth/session` and attaches it to the
backend call.

API keys (server-to-server) start with `ak_` and authenticate the same
header path; they map to a tenant but never to a specific user.

## Rate limiting

Per-IP rate limits are applied at the FastAPI layer via `slowapi`. The
mediation endpoint allows 30/minute; admin endpoints generally allow
30/minute; reads allow 60/minute. AWS WAF on CloudFront should be the
first line of defence against bot traffic.

## Auditing

Mutating admin and leader actions write to the `audit_log` table. Read
the log via `GET /api/v1/admin/audit-log?actor_user_id=...&target_type=...`.

## Wire envelope reference

```json
// Request
{
  "v": 1,
  "epk": "<base64 ephemeral X25519 public key>",
  "n":   "<base64 12-byte nonce>",
  "c":   "<base64 ciphertext+tag>"
}

// Response
{
  "n": "<base64 12-byte nonce>",
  "c": "<base64 ciphertext+tag>"
}
```

Plaintext payloads:

```json
// Inside the request envelope
{ "ts": 1716301200000, "body": <handler-specific> }

// Inside the response envelope
<handler-specific JSON>
```
