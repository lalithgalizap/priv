# ADR 0003 — Bounded threadpools for blocking work

Status: Accepted, in production.

## Context

FastAPI uses an asyncio event loop. We use `psycopg2` (sync) for Postgres,
`boto3` (sync) for AWS Bedrock, and `PyPDF2` / `python-docx` for file
parsing. Calling these directly from `async def` handlers blocks the loop
and serialises every concurrent request.

Migrating to `asyncpg` is appealing but disruptive: a lot of psycopg2
code, no `RealDictCursor` analogue, and our SQL relies on a few
psycopg2-specific bits (jsonb composition, named cursors).

## Decision

Stay on psycopg2. Route every blocking call through the bounded
`async_io` module:

- `run_db(fn, *args, **kwargs)` — DB threadpool, 32 workers, semaphore
  cap of 20. Cap matches the DB pool's `DB_POOL_MAX` so a worker burst
  cannot saturate Postgres connections.
- `run_file(fn, *args, **kwargs)` — File-parser threadpool, 8 workers,
  semaphore cap of 4. Tighter cap because each in-flight PDF can pin
  tens of MB of memory.
- JWKS fetch and clock-drift HEAD use `httpx.AsyncClient`; no thread
  hop needed.

Bedrock invocations use the default executor; the boto3 client itself
is configured with `retries=adaptive, max_attempts=5,
max_pool_connections=50` so concurrent invocations don't queue inside
boto3.

## Consequences

- Event loop stays responsive even under load.
- Memory usage is predictable: at most 4 PDF parses + 20 DB calls
  in flight per worker.
- A future migration to `asyncpg` is still possible — the abstraction
  is `run_db(fn, ...)`, swapping the implementation is local.

## Considered alternatives

- **Migrate to `asyncpg`.** Rejected for now: high refactor cost, no
  customer-visible benefit at current scale.
- **Increase the default executor size.** Rejected: less control over
  per-workload caps. PDF parsing and DB calls have very different
  resource profiles.
