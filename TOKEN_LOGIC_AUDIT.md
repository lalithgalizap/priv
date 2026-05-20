# Token/Credit System — Enterprise Architecture

## Overview

The credit system uses an **atomic reservation pattern** to prevent race conditions and ensure accurate billing. Credits flow hierarchically: Platform → Org → User.

## Credit Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    PLATFORM (Superadmin)                         │
│  - Sets model pricing (MODEL_CREDIT_RATES in db.py)             │
│  - Manages org pools via /admin/tenants/{id}/topup              │
│  - Global rate limits via slowapi                               │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│                    ORG WALLET (tenants.extra_token_pool)         │
│  - Leaders purchase credits → org pool                          │
│  - Leaders allocate from pool → member paid_credit_balance      │
│  - Tracked in credit_ledger table                               │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│                    USER QUOTAS                                   │
│  - Daily budget: user_profiles.daily_budget (default 50)        │
│  - Daily used: user_profiles.daily_used (auto-reset at midnight)│
│  - Extra allocated: user_profiles.paid_credit_balance           │
│  - Extra used: user_profiles.paid_credit_used                   │
│  - Total available = daily_remaining + extra_remaining          │
└─────────────────────────────────────────────────────────────────┘
```

## Atomic Reservation Pattern (NEW)

The old system had a TOCTOU race condition:
1. `check_credit_quota()` — reads available credits
2. (gap where another request could consume credits)
3. `consume_user_credits()` — deducts credits

The new system uses **reserve → execute → settle**:

### 1. Reserve (`db.reserve_credits`)
- `SELECT ... FOR UPDATE` locks the user_profiles row
- Checks available credits atomically
- Deducts estimated cost immediately
- Returns `{"allowed": true, "reserved_credits": N}`

### 2. Execute
- Call AWS Bedrock with the prompt
- Get actual token usage from response

### 3. Settle (`db.settle_credits`)
- If actual < reserved → release difference back (`release_reserved_credits`)
- If actual > reserved → consume extra (rare, logged as warning)
- If upstream fails → release all reserved credits (`release_reserved_credits`)

## Consumption Order

Credits are always consumed in this order:
1. **Daily free credits** (daily_budget - daily_used)
2. **Paid extra credits** (paid_credit_balance - paid_credit_used)

Daily credits reset automatically at midnight UTC (lazy reset on next access).

## Credit Calculation

Credits are model-specific, calculated per 1K tokens:

| Model | Input/1K | Output/1K |
|-------|----------|-----------|
| moonshotai.kimi-k2.5 | 8 | 24 |
| claude-3-sonnet | 30 | 150 |
| claude-3-haiku | 4 | 15 |
| claude-3-opus | 150 | 750 |
| llama3-70b | 10 | 30 |
| mistral-large | 20 | 60 |
| titan-text-premier | 4 | 12 |
| gpt-4o | 25 | 100 |
| gpt-4o-mini | 2 | 6 |

Formula: `credits = max(1, (input_tokens/1000 * input_rate) + (output_tokens/1000 * output_rate))`

## Key Functions (db.py)

| Function | Purpose |
|----------|---------|
| `reserve_credits()` | Atomic check + deduct with row lock |
| `release_reserved_credits()` | Return credits on failure |
| `settle_credits()` | Reconcile reserved vs actual |
| `consume_user_credits()` | Direct consumption (mock mode) |
| `get_user_token_usage()` | Read user's quota state |
| `get_org_token_usage()` | Read org pool state |
| `allocate_member_extra_credits()` | Leader → member allocation |
| `add_org_extra_credits()` | Top-up org pool |

## Roles & Capabilities

| Role | Can Do |
|------|--------|
| Member | Use AI (within quota), view own usage |
| Leader | Buy credits, allocate to members, manage org |
| Superadmin | Manage all orgs, top-up any org, view global usage |

## Changes from Previous System

1. **Removed anonymizer** — prompts sent directly to LLM for full context
2. **Removed presidio/spacy** — 600MB+ dependency savings
3. **Atomic reservations** — no more race conditions on concurrent requests
4. **Row-level locking** — SELECT FOR UPDATE prevents double-spending
5. **Reserve-execute-settle** — credits released on upstream failure
