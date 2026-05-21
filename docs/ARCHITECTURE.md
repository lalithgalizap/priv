# Architecture

This is a one-page tour of how a request flows through Quintal AI. For deeper
rationale on individual choices see [`adr/`](./adr/).

## High level

```
                    ┌──────────────────────────────────────────────────┐
                    │                  Browser                         │
                    │                                                  │
                    │   React (Next.js 16 App Router)                  │
                    │   TanStack Query                                 │
                    │   WebCrypto envelope (ECDH P-256 + AES-GCM)      │
                    └─────────────────┬────────────────────────────────┘
                                      │ HTTPS, encrypted body
                                      ▼
                    ┌──────────────────────────────────────────────────┐
                    │              CloudFront edge                     │
                    │  (CachingDisabled for /api, CachingOptimized     │
                    │   for /_next/static and /public assets)          │
                    └─────────────────┬────────────────────────────────┘
                                      │ HTTPS
                                      ▼
                    ┌──────────────────────────────────────────────────┐
                    │     EC2 (us-east-2) — single instance for now    │
                    │                                                  │
                    │   nginx :80  ──▶  Next.js :3000  ──▶  FastAPI    │
                    │                  (envelope close)     :8000      │
                    │                                                  │
                    │   PM2 manages both processes                     │
                    └─────────────────┬────────────────────────────────┘
                                      │
                              ┌───────┴───────┐
                              ▼               ▼
                  ┌────────────────┐    ┌──────────────────┐
                  │   Supabase     │    │   AI Providers   │
                  │   (Postgres,   │    │   (Kimi, Nova,   │
                  │    Auth, JWKS) │    │    Llama, etc.)  │
                  └────────────────┘    └──────────────────┘
```

## Request lifecycle (chat send)

1. **Browser** types a message. `apiFetch("/api/mediate", { body, method: "POST" })`:
   - Generates an ephemeral X25519 keypair.
   - Derives an AES-256-GCM key with HKDF-SHA256 against the server's static
     ECDH public key (inlined at build time as `NEXT_PUBLIC_SERVER_ECDH_PUB_B64`).
   - Wraps the body in `{ ts, body }` so the server can enforce a replay window.
   - Mixes the URL path into the AES-GCM AAD so the envelope can't be
     replayed against a different endpoint.
   - Sends an HTTP POST to `/api/mediate?_wm=POST` with `X-Wire-Method: POST`.
2. **CloudFront** forwards to nginx, which proxies to Next.js.
3. **Next.js API route** (`/api/mediate/route.ts`) calls `dispatchEnvelope`,
   reads `X-Wire-Method` (or `?_wm=`), opens the envelope (validates ts and
   AAD), and calls the matching handler. The handler relays to FastAPI over
   loopback, attaching the user's `Authorization: Bearer <jwt>` header.
4. **FastAPI** (`main.py`):
   - `request_context_middleware` mints a `request_id`, refuses traffic
     during graceful shutdown, and tracks in-flight count.
   - `get_current_user` fetches the Supabase JWKS via `httpx.AsyncClient`
     (cached 30 min, 6h hard stale window, optional fingerprint pin).
   - Validates the JWT (30s leeway), resolves tenant + role from Postgres
     via the bounded DB threadpool (`run_db`).
   - `_run_ai_mediation` reserves credits in Postgres → invokes Bedrock in
     the default executor → settles credits → writes a usage metric.
5. **Encrypted response** is sealed with the same AES key and AAD and
   returned through the proxy chain.

## Key paths

| Concern | File |
|---|---|
| Wire envelope (browser) | `frontend/src/lib/crypto.ts`, `lib/api.ts` |
| Wire envelope (server) | `frontend/src/lib/server-crypto.ts`, `lib/envelope.ts` |
| Authentication | `backend/middleware/auth.py` |
| At-rest encryption (per-user) | `backend/encryption.py` |
| Credit reservation | `backend/db.py` (reserve_credits → settle_credits) |
| Audit log | `backend/db.py` (write_audit_log), `main.py` `_audit` helper |
| Async-safe blocking | `backend/async_io.py` |
| Structured logging | `backend/logging_config.py` |
| Toast UX | `frontend/src/lib/toast.ts`, `components/ToastViewport.tsx` |
| Error boundaries | `frontend/src/app/error.tsx`, per-segment `error.tsx` |

## Concurrency model (backend)

- **Event loop** never blocks. Every blocking call (DB, file parsing,
  Bedrock invocation) is offloaded.
- **DB**: bounded threadpool (`DB_THREADPOOL_SIZE=32` workers,
  `DB_CONCURRENCY=20` semaphore). Connections come from the psycopg2
  pool (`DB_POOL_MIN=5`, `DB_POOL_MAX=40`).
- **Files**: tighter cap (`FILE_CONCURRENCY=4`) to bound peak memory from
  PDF/DOCX parsers.
- **Bedrock**: default executor, but `boto3.Config(retries=adaptive,
  max_pool_connections=50)` so concurrent prompts don't serialise.
- **Workers**: 4 uvicorn workers per box; each maintains its own pool.

## Encryption layers

| Layer | What's encrypted | Key |
|---|---|---|
| TLS | Everything on the wire | Per-connection (CloudFront, nginx) |
| Wire envelope | Request and response bodies | Ephemeral X25519 ECDH per request |
| At-rest | `chat_messages.content`, `user_profiles.system_prompt` | HMAC-SHA256(master, user_id) per user |

The wire envelope is independent of TLS: even if a CDN edge node is
compromised or someone tcpdumps inside our VPC, the body is ciphertext.

## Storage

- **Postgres (Supabase)** holds tenants, user_profiles, chat_sessions,
  chat_messages (encrypted), credit ledger, audit_log, model_pricing.
- **No Redis** in the current single-instance setup. When we move to ALB
  + multi-instance, Redis (ElastiCache) will hold rate-limit state, hot
  reads, and idempotency keys.

## What's not yet here

Tracked in the [enterprise-readiness report](./ENTERPRISE_READINESS.md):
HA across instances, auto-scaling, blue/green deploys, SSO/SAML, full
SOC 2 controls, multi-region failover.
