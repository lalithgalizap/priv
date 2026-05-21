# Runbook

When something breaks at 3am, this is the first place to look. Each entry
is structured: **detect → confirm → mitigate → recover → escalate**.

---

## Health endpoints

| URL | What it tells you |
|---|---|
| `https://<host>/api/v1/health` | Backend is up; DB is reachable; AI provider is configured; clock drift in ms; in-flight request count; whether shutdown is in progress. |
| `https://<host>/api/crypto/pubkey` | Frontend is up and the wire-encryption keypair is loaded. |

A 200 + `database: connected` + `ai_provider: configured` + `clock_drift_ms < 5000` means the box is healthy.

---

## "Login returns 401 / `Invalid token: ImmatureSignatureError (iat)`"

**Detect.** Logs show `Invalid token: ImmatureSignatureError`.

**Confirm.** SSH to the EC2 box and check:
```
date -u
curl -sI https://www.google.com | grep -i ^date:
```
If the two timestamps differ by more than ~30s, the local clock has drifted.

**Mitigate.** A 30s leeway is already built into JWT verification. Anything
beyond that means NTP is broken.

**Recover.**
```
sudo systemctl enable --now chronyd
chronyc sources -v
```
Restart the backend after the clock catches up: `pm2 restart backend`.

**Escalate.** If chrony cannot reach a time server, check the EC2 security
group's outbound UDP/123 rule. If the host is locked down, switch to AWS's
internal time service (`169.254.169.123`).

---

## "All `/api/*` calls 405"

**Detect.** Browser DevTools shows `Method POST not allowed.` from
`/api/me`, `/api/sessions`, etc. immediately after login.

**Confirm.** Look at the URL. The request should include `?_wm=GET`
(or PATCH/DELETE/POST). If the wire-method query parameter is missing,
the client sent a bare POST to a route that only accepts the logical
GET handler.

**Mitigate.** This usually means a stale browser tab on an old build.
Hard reload the tab (Cmd+Shift+R / Ctrl+F5).

**Recover.** If the URL is correct and you still see 405, the route's
build artifact is stale. SSH in and:
```
cd ~/priv/frontend
rm -rf .next
npm run build
pm2 restart frontend
```

**Escalate.** If `?_wm=` is being stripped between the browser and EC2,
the CloudFront origin request policy is dropping query parameters.
Verify in the AWS console: Distribution → Behaviors → All viewer
requests → query strings forwarded.

---

## "Bedrock `ThrottlingException` for everyone"

**Detect.** Mediation requests fail with HTTP 502 and `Upstream AI
provider error.` Logs show `ClientError ThrottlingException`.

**Confirm.** Check region quota in the AWS console (Bedrock → Service
Quotas). Default is 50 RPM for many models — easy to exceed.

**Mitigate.** boto3's adaptive retry already smooths short bursts.
Tell users to retry; the backend will return 502 not 500 so they know
it's upstream.

**Recover.** Submit a quota increase via AWS Support. Takes ~24h for
common model IDs.

**Escalate.** If the spike is bot traffic, enable AWS WAF rate limiting
on the CloudFront distribution.

---

## "Database connection failures"

**Detect.** Logs show `connection pool exhausted` or `psycopg2.OperationalError`.

**Confirm.** Connection counts:
```
SELECT count(*) FROM pg_stat_activity WHERE datname = 'postgres';
```
We use up to `DB_POOL_MAX × UVICORN_WORKERS` connections per box. With
the defaults that's `40 × 4 = 160`.

**Mitigate.** Restart the backend to recycle connections: `pm2 restart backend`.

**Recover.** If the pool is healthy but Supabase is rejecting, you may be
hitting the project's connection cap. Upgrade to Supabase Pro (200 conns
default, can request 500+).

**Escalate.** Look for long-running queries:
```
SELECT pid, age(clock_timestamp(), query_start), query
FROM pg_stat_activity
WHERE state != 'idle' ORDER BY 2 DESC LIMIT 20;
```
Kill any long-runner with `SELECT pg_cancel_backend(<pid>)`.

---

## "JWKS cache stuck on stale keys"

**Detect.** Logs show repeated `Using stale JWKS cache (age_s=…)` and
new tokens fail verification.

**Confirm.** Hit the JWKS endpoint manually from the EC2:
```
curl -s https://<your-supabase-url>/auth/v1/.well-known/jwks.json
```
If that fails, Supabase is unreachable.

**Mitigate.** The hard cap is 6h (`JWKS_MAX_STALE_SECONDS`); after that
we fail closed.

**Recover.** Once Supabase is reachable again the next request triggers
a refresh. To force one immediately: `pm2 restart backend`.

**Escalate.** Pin the expected JWK fingerprints (`SUPABASE_JWKS_FINGERPRINTS`)
so a compromised JWKS endpoint cannot serve us malicious keys.

---

## "Server returns 503 `Server is shutting down`"

**Detect.** During a deploy you see 503s with `Retry-After: 5`.

**Confirm.** This is **expected** behaviour. The graceful-shutdown
middleware refuses new traffic so the load balancer can drain the box.

**Mitigate.** None needed — the deploy script restarts the worker;
PM2 brings it back online; the next health check passes.

**Recover.** When we move to multi-instance + ALB, drain windows will
overlap with new instances coming up, so this 503 will never reach
end users.

**Escalate.** If shutdowns are taking longer than 30s, investigate
slow Bedrock calls — `GRACEFUL_SHUTDOWN_SECONDS` is the cap.

---

## "Wire envelope decryption fails"

**Detect.** Logs show `Envelope authentication failed` or `Envelope
outside replay window`.

**Confirm.** Two failure modes:
- **Tag mismatch:** key derivation is broken. Likely cause: the public
  key inlined into the frontend bundle does not match the server private
  key. Verify `NEXT_PUBLIC_SERVER_ECDH_PUB_B64` matches the public key
  derived from `SERVER_ECDH_PRIV_HEX`.
- **Replay window:** clock drift between browser and server > 60s.
  See "ImmatureSignatureError" above.

**Recover.** Rebuild and redeploy after fixing the env mismatch. If a
keypair rotation is needed, you must redeploy frontend and backend
simultaneously — there is no overlap window built in yet.

**Escalate.** When key rotation becomes routine, add support for a
"key v1 + v2" overlap window in `server-crypto.ts`.

---

## On-call contact tree

1. **First responder:** the engineer who pushed last on the affected
   service. Check `git log --since="2 hours ago"`.
2. **Backup:** anyone with `superadmin` access in the platform. Listed
   in the user_profiles table.
3. **External vendors:**
   - Supabase: support tier depends on plan; URL in their console.
   - AWS: enterprise support at https://console.aws.amazon.com/support.
   - CloudFront: same as AWS.

After every incident, write a postmortem in `incidents/YYYY-MM-DD-name.md`.
