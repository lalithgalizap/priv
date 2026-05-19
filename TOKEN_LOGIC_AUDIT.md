# Token Logic Audit Report

## Current Model (Simplified Credits)

1. **Daily free quota** — every member gets `user_profiles.daily_budget` credits per day (default 50). Usage is tracked in `daily_used` and reset daily via `_maybe_reset_daily_tokens`.
2. **Org paid pool** — leaders/admins purchase perpetual credits into `tenants.extra_token_pool` using the dummy card flows. Credits never expire until allocated.
3. **Member paid allocations** — leaders allocate from the org pool into `user_profiles.paid_credit_balance`. Consumption burns `paid_credit_used` after the daily bucket is exhausted.
4. **Usage telemetry** — `tenant_usage_metrics` still records every API call for analytics/auditing but no longer drives quota math directly (no overdraft/baselines).

## Operating Rules

| Actor | Capability | Storage | Notes |
|-------|------------|---------|-------|
| System | Auto-reset daily usage | `user_profiles.daily_used` → reset nightly | Hard cap of daily budget (no overdraft)
| Leader/Admin | Buy credits | `tenants.extra_token_pool` via `/org/topup` or `/admin/.../topup` | Purchases recorded in ledger/topups
| Leader | Allocate credits to members | `user_profiles.paid_credit_balance += amount` | Debits org pool, updates ledger
| Member | Consume credits | `_maybe_reset_daily_tokens` | Burns daily first, then paid balance; error when insufficient
| Admin | Audit | `credit_ledger`, `topups` | Admin UI can view all top-ups globally

## Debug References

* `backend/db.py` — authoritative consumption helpers (`consume_user_credits`, `get_org_token_usage`).
* `backend/main.py` — leader/admin APIs for buying/allocating credits with dummy card tokens and for org/member quota lookups.
* `frontend/src/app/admin/companies/[id]/page.tsx` — admin experience for top-ups + audit.
* `frontend/src/app/org/page.tsx` — leader workflow for purchasing and distributing paid credits.

Historical `token_limit` / overdraft docs are deprecated. Use the paid credit terminology (`paid_credit_balance`, `paid_credit_used`, `extra_token_pool`) everywhere to avoid confusion.
