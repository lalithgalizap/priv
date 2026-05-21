import logging
import os
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from typing import Optional

import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor
from psycopg2.pool import SimpleConnectionPool

load_dotenv()

import encryption

logger = logging.getLogger("db")

DATABASE_URL = os.getenv("DATABASE_URL", "")
DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001"

# Default credit rates per 1K tokens. These seed the model_pricing table on
# first boot. After that, prices live in the DB and superadmins can edit
# them via the admin API without redeploys.
_DEFAULT_MODEL_CREDIT_RATES = {
    # OpenAI models (proxied via API gateway, not Bedrock)
    "gpt-4o-mini": {"input": 2, "output": 6},
    "gpt-4o": {"input": 25, "output": 100},
    # Moonshot AI
    "moonshotai.kimi-k2.5": {"input": 8, "output": 24},
    # Amazon Nova
    "amazon.nova-pro-v1:0": {"input": 8, "output": 32},
    "amazon.nova-lite-v1:0": {"input": 1, "output": 4},
    # Cohere
    "cohere.command-r-plus-v1:0": {"input": 30, "output": 150},
    # Meta Llama
    "meta.llama3-70b-instruct-v1:0": {"input": 10, "output": 30},
    # Mistral
    "mistral.mistral-large-2402-v1:0": {"input": 20, "output": 60},
    # Amazon Titan
    "amazon.titan-text-premier-v1:0": {"input": 4, "output": 12},
}
DEFAULT_CREDIT_RATE = {"input": 25, "output": 100}  # safety net

# In-process cache of pricing rows. Refreshed every PRICING_CACHE_TTL seconds
# or whenever a superadmin updates a price via the API.
import threading
_pricing_cache: dict[str, dict] = {}
_pricing_cache_loaded_at: float = 0.0
_pricing_cache_lock = threading.Lock()
PRICING_CACHE_TTL = 60.0


def _load_pricing_from_db() -> dict[str, dict]:
    """Load all rows from model_pricing into a dict. Falls back to defaults."""
    try:
        with get_db() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    "SELECT model_identifier, input_credits, output_credits FROM model_pricing"
                )
                rows = cur.fetchall()
        return {
            r["model_identifier"]: {
                "input": int(r["input_credits"]),
                "output": int(r["output_credits"]),
            }
            for r in rows
        }
    except Exception as e:
        logger.warning("Pricing load failed; using defaults: %s", e)
        return dict(_DEFAULT_MODEL_CREDIT_RATES)


def get_pricing() -> dict[str, dict]:
    """Return current pricing dict, refreshing the cache if stale."""
    import time as _time
    global _pricing_cache, _pricing_cache_loaded_at
    now = _time.time()
    if _pricing_cache and (now - _pricing_cache_loaded_at) < PRICING_CACHE_TTL:
        return _pricing_cache
    with _pricing_cache_lock:
        if _pricing_cache and (now - _pricing_cache_loaded_at) < PRICING_CACHE_TTL:
            return _pricing_cache
        _pricing_cache = _load_pricing_from_db() or dict(_DEFAULT_MODEL_CREDIT_RATES)
        _pricing_cache_loaded_at = now
    return _pricing_cache


def invalidate_pricing_cache() -> None:
    global _pricing_cache, _pricing_cache_loaded_at
    with _pricing_cache_lock:
        _pricing_cache = {}
        _pricing_cache_loaded_at = 0.0


def list_model_pricing() -> list[dict]:
    """Return all pricing rows for the admin UI."""
    pricing = get_pricing()
    return [
        {"model_identifier": mid, "input_credits": rates["input"], "output_credits": rates["output"]}
        for mid, rates in sorted(pricing.items())
    ]


def upsert_model_pricing(model_identifier: str, input_credits: int, output_credits: int) -> dict:
    """Insert or update a single pricing row. Invalidates the cache."""
    if input_credits < 0 or output_credits < 0:
        raise ValueError("Credit rates must be non-negative.")
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO model_pricing (model_identifier, input_credits, output_credits, updated_at)
                VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (model_identifier) DO UPDATE SET
                    input_credits = EXCLUDED.input_credits,
                    output_credits = EXCLUDED.output_credits,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING model_identifier, input_credits, output_credits
                """,
                (model_identifier, input_credits, output_credits),
            )
            row = cur.fetchone()
            conn.commit()
    invalidate_pricing_cache()
    return dict(row)


def calculate_request_credits(model_identifier: str, input_tokens: int, output_tokens: int) -> int:
    """Convert actual token usage to credits based on model pricing."""
    pricing = get_pricing()
    rates = pricing.get(model_identifier, DEFAULT_CREDIT_RATE)
    input_credits = (input_tokens / 1000) * rates["input"]
    output_credits = (output_tokens / 1000) * rates["output"]
    return max(1, int(input_credits + output_credits))


def estimate_request_credits(model_identifier: str, estimated_input_tokens: int, estimated_output_tokens: int) -> int:
    """Pre-flight estimate of request cost in credits."""
    return calculate_request_credits(model_identifier, estimated_input_tokens, estimated_output_tokens)


# Backwards-compat alias for any external imports.
MODEL_CREDIT_RATES = _DEFAULT_MODEL_CREDIT_RATES

_pool: Optional[SimpleConnectionPool] = None

DB_POOL_MIN = int(os.getenv("DB_POOL_MIN", "5"))
DB_POOL_MAX = int(os.getenv("DB_POOL_MAX", "40"))


def get_pool() -> SimpleConnectionPool:
    global _pool
    if _pool is None and DATABASE_URL:
        _pool = SimpleConnectionPool(
            minconn=DB_POOL_MIN,
            maxconn=DB_POOL_MAX,
            dsn=DATABASE_URL,
            sslmode="require",
            connect_timeout=5,
            keepalives=1,
            keepalives_idle=30,
            keepalives_interval=10,
            keepalives_count=3,
        )
    return _pool


@contextmanager
def get_db():
    pool = get_pool()
    if pool is None:
        raise RuntimeError("Database not configured")
    conn = pool.getconn()
    try:
        yield conn
    finally:
        # Always rollback to ensure connection is returned in a clean state.
        # If the caller committed successfully, rollback is a no-op.
        # If the transaction was aborted, this resets it so the next user
        # gets a fresh, usable connection.
        try:
            conn.rollback()
        except Exception:
            pass
        pool.putconn(conn)


def init_db():
    """Initialize database tables if they don't exist.

    Each DDL statement is executed separately so one failure does not
    poison the entire initialization.
    """
    statements = [
        'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"',
        """
        CREATE TABLE IF NOT EXISTS tenants (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            company_name VARCHAR(255) NOT NULL UNIQUE,
            tier VARCHAR(50) DEFAULT 'free',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT TRUE
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS user_profiles (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            supabase_auth_id UUID UNIQUE NOT NULL,
            tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
            display_name VARCHAR(150),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS tenant_usage_metrics (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
            supabase_auth_id UUID NOT NULL,
            model_identifier VARCHAR(150) NOT NULL,
            input_tokens_used BIGINT DEFAULT 0,
            output_tokens_used BIGINT DEFAULT 0,
            total_tokens_used BIGINT DEFAULT 0,
            execution_duration_ms BIGINT DEFAULT 0,
            credits_used BIGINT DEFAULT 0,
            api_call_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
        """,
        'CREATE INDEX IF NOT EXISTS idx_metrics_tenant_date ON tenant_usage_metrics (tenant_id, api_call_timestamp DESC)',
        'CREATE INDEX IF NOT EXISTS idx_metrics_user ON tenant_usage_metrics (supabase_auth_id)',
        # Model pricing table — superadmin-editable rates per 1k tokens
        """
        CREATE TABLE IF NOT EXISTS model_pricing (
            model_identifier VARCHAR(150) PRIMARY KEY,
            input_credits INTEGER NOT NULL CHECK (input_credits >= 0),
            output_credits INTEGER NOT NULL CHECK (output_credits >= 0),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
        """,
    ]

    with get_db() as conn:
        with conn.cursor() as cur:
            for stmt in statements:
                try:
                    cur.execute(stmt)
                except psycopg2.Error as e:
                    # Log but continue; many errors are benign (e.g. extension
                    # already exists, table already exists, index already exists).
                    logger.debug("DDL statement skipped: %s", e)
        conn.commit()

    # Seed model_pricing defaults if the table is empty.
    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM model_pricing")
                if int(cur.fetchone()[0]) == 0:
                    for mid, rates in _DEFAULT_MODEL_CREDIT_RATES.items():
                        cur.execute(
                            """
                            INSERT INTO model_pricing (model_identifier, input_credits, output_credits)
                            VALUES (%s, %s, %s)
                            ON CONFLICT (model_identifier) DO NOTHING
                            """,
                            (mid, rates["input"], rates["output"]),
                        )
                    conn.commit()
                    logger.info("Seeded model_pricing with %d defaults", len(_DEFAULT_MODEL_CREDIT_RATES))
    except Exception as e:
        logger.warning("model_pricing seed skipped: %s", e)


def ensure_default_tenant() -> bool:
    """Ensure the fallback default tenant exists and discover its actual UUID.

    If 'Default Corp' already exists with a different auto-generated ID
    (and has metrics referencing it), we adopt that ID as the default
    rather than forcing the hardcoded UUID.
    Safe to call multiple times.
    """
    global DEFAULT_TENANT_ID
    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                # 1. Check if Default Corp already exists
                cur.execute("SELECT id FROM tenants WHERE company_name = 'Default Corp'")
                row = cur.fetchone()
                if row:
                    existing_id = str(row[0])
                    if existing_id != DEFAULT_TENANT_ID:
                        # Check if metrics reference the existing row
                        cur.execute(
                            "SELECT COUNT(*) FROM tenant_usage_metrics WHERE tenant_id = %s",
                            (existing_id,),
                        )
                        metric_count = int(cur.fetchone()[0])
                        if metric_count > 0:
                            logger.info(
                                "Adopting existing Default Corp tenant %s (has %d metrics)",
                                existing_id, metric_count,
                            )
                            DEFAULT_TENANT_ID = existing_id
                        else:
                            # No metrics: safe to update to fixed UUID
                            cur.execute(
                                "UPDATE tenants SET id = %s WHERE company_name = 'Default Corp'",
                                (DEFAULT_TENANT_ID,),
                            )
                            conn.commit()
                            logger.info("Updated Default Corp tenant to fixed UUID %s", DEFAULT_TENANT_ID)
                    return True

                # 2. Insert with fixed UUID if no Default Corp exists
                cur.execute(
                    """
                    INSERT INTO tenants (id, company_name, tier)
                    VALUES (%s, 'Default Corp', 'free')
                    """,
                    (DEFAULT_TENANT_ID,),
                )
                conn.commit()
                logger.info("Created default tenant with UUID %s", DEFAULT_TENANT_ID)
        return True
    except psycopg2.Error as e:
        logger.warning("Could not ensure default tenant: %s", e)
        return False


def save_usage_metric(
    tenant_id: str,
    supabase_auth_id: str,
    model_identifier: str,
    input_tokens: int,
    output_tokens: int,
    total_tokens: int,
    duration_ms: int,
    credits_used: int,
) -> None:
    """Persist a usage metric row.  FK failures are caught and logged
    so that a missing tenant never blocks the AI response from reaching
    the user."""
    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO tenant_usage_metrics
                    (tenant_id, supabase_auth_id, model_identifier,
                     input_tokens_used, output_tokens_used, total_tokens_used,
                     execution_duration_ms, credits_used)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (tenant_id, supabase_auth_id, model_identifier,
                     input_tokens, output_tokens, total_tokens, duration_ms, credits_used),
                )
            conn.commit()
    except psycopg2.Error as e:
        logger.warning("Failed to persist usage metric: %s", e)


def get_analytics(tenant_id: str):
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Total tokens
            cur.execute(
                "SELECT COALESCE(SUM(total_tokens_used), 0) as total FROM tenant_usage_metrics WHERE tenant_id = %s",
                (tenant_id,),
            )
            row = cur.fetchone()
            total_tokens = int(row["total"]) if row else 0

            # Recent logs
            cur.execute(
                """
                SELECT tenant_id, model_identifier, input_tokens_used as input_tokens,
                       total_tokens_used as total_tokens,
                       execution_duration_ms as duration_ms,
                       api_call_timestamp as timestamp,
                       CASE WHEN execution_duration_ms > 500 THEN 'error' ELSE 'success' END as status
                FROM tenant_usage_metrics
                WHERE tenant_id = %s
                ORDER BY api_call_timestamp DESC
                LIMIT 50
                """,
                (tenant_id,),
            )
            logs = [dict(row) for row in cur.fetchall()]

            # Token trend: last 7 days grouped by day
            cur.execute(
                """
                SELECT DATE(api_call_timestamp) as day,
                       COALESCE(SUM(total_tokens_used), 0) as tokens
                FROM tenant_usage_metrics
                WHERE tenant_id = %s AND api_call_timestamp >= NOW() - INTERVAL '7 days'
                GROUP BY DATE(api_call_timestamp)
                ORDER BY day ASC
                """,
                (tenant_id,),
            )
            trend_rows = cur.fetchall()
            # Build 7-day array with 0s for missing days
            from datetime import date, timedelta
            today = date.today()
            token_trend = []
            trend_map = {str(r["day"]): int(r["tokens"]) for r in trend_rows}
            for i in range(6, -1, -1):
                day = today - timedelta(days=i)
                token_trend.append(trend_map.get(str(day), 0))

            # Model breakdown
            cur.execute(
                """
                SELECT model_identifier,
                       COALESCE(SUM(total_tokens_used), 0) as tokens,
                       COUNT(*) as calls
                FROM tenant_usage_metrics
                WHERE tenant_id = %s
                GROUP BY model_identifier
                ORDER BY tokens DESC
                """,
                (tenant_id,),
            )
            model_breakdown = [dict(row) for row in cur.fetchall()]

            # Active tenants count
            cur.execute("SELECT COUNT(*) as cnt FROM tenants WHERE is_active = TRUE")
            row = cur.fetchone()
            active_tenants = int(row["cnt"]) if row else 0

    return {
        "total_tokens": total_tokens,
        "active_tenants": max(active_tenants, 1),
        "compute_cost": round(total_tokens * 0.002 / 1000, 2),
        "logs": logs,
        "token_trend": token_trend,
        "model_breakdown": model_breakdown,
    }


# ── Role & Profile helpers ──────────────────────────────────────────

def get_user_role(supabase_auth_id: str) -> str:
    """Fetch role for a given Supabase auth user ID. Returns 'member' as default."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT role FROM user_profiles WHERE supabase_auth_id = %s",
                (supabase_auth_id,),
            )
            row = cur.fetchone()
            return row["role"] if row else "member"


# ── API Key management ──────────────────────────────────────────────

import secrets
import hashlib


def _hash_key(raw_key: str) -> str:
    """SHA-256 hash of an API key for storage comparison."""
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def create_api_key(tenant_id: str, created_by: str, name: str, scopes: list[str] | None = None, expires_days: int | None = None) -> tuple[str, str]:
    """Generate a new API key. Returns (raw_key, key_id)."""
    raw_key = "ak_" + secrets.token_urlsafe(32)
    key_hash = _hash_key(raw_key)
    key_preview = raw_key[:6] + "..." + raw_key[-4:]

    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            expires = None
            if expires_days:
                from datetime import datetime, timedelta
                expires = datetime.utcnow() + timedelta(days=expires_days)
            scope_json = scopes if scopes else ["mediate", "analytics"]
            cur.execute(
                """
                INSERT INTO api_keys (tenant_id, created_by, name, key_hash, key_preview, scopes, expires_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (tenant_id, created_by, name, key_hash, key_preview, json.dumps(scope_json), expires),
            )
            row = cur.fetchone()
            conn.commit()
            return raw_key, str(row["id"])


import json


def list_api_keys(tenant_id: str) -> list[dict]:
    """Return all active API keys for a tenant (without key_hash)."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, name, key_preview, scopes, expires_at, is_active, last_used_at, created_at
                FROM api_keys
                WHERE tenant_id = %s AND is_active = TRUE
                ORDER BY created_at DESC
                """,
                (tenant_id,),
            )
            return [dict(row) for row in cur.fetchall()]


def revoke_api_key(key_id: str, tenant_id: str) -> bool:
    """Soft-delete (deactivate) an API key. Returns True if a row was updated."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "UPDATE api_keys SET is_active = FALSE WHERE id = %s AND tenant_id = %s",
                (key_id, tenant_id),
            )
            conn.commit()
            return cur.rowcount > 0


def validate_api_key(raw_key: str) -> dict | None:
    """Validate a raw API key. Returns key metadata or None if invalid/expired."""
    if not raw_key or not raw_key.startswith("ak_"):
        return None
    key_hash = _hash_key(raw_key)
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, tenant_id, name, scopes, expires_at, is_active
                FROM api_keys
                WHERE key_hash = %s AND is_active = TRUE
                """,
                (key_hash,),
            )
            row = cur.fetchone()
            if not row:
                return None
            if row["expires_at"] and row["expires_at"] < __import__("datetime").datetime.utcnow():
                return None
            # Update last_used_at
            cur.execute(
                "UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = %s",
                (row["id"],),
            )
            conn.commit()
            return dict(row)


# ── Org Management ──────────────────────────────────────────────────

def list_org_members(tenant_id: str, search: str | None = None, limit: int = 50, offset: int = 0) -> dict:
    """Return paginated user_profiles for a given tenant."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            where = "WHERE tenant_id = %s"
            params: list = [tenant_id]
            if search:
                where += " AND display_name ILIKE %s"
                params.append(f"%{search}%")

            cur.execute(f"SELECT COUNT(*) as total FROM user_profiles {where}", params)
            total = int(cur.fetchone()["total"])

            cur.execute(
                f"""
                SELECT id, supabase_auth_id, display_name, role, created_at
                FROM user_profiles
                {where}
                ORDER BY
                  CASE role WHEN 'leader' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
                  created_at DESC
                LIMIT %s OFFSET %s
                """,
                params + [limit, offset],
            )
            members = [dict(r) for r in cur.fetchall()]
            return {"members": members, "total": total}


def update_member_role(tenant_id: str, profile_id: str, new_role: str) -> bool:
    """Update a member's role. Leaders can only set member. Returns True if updated."""
    if new_role not in ("leader", "member"):
        raise ValueError("Invalid role.")
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "UPDATE user_profiles SET role = %s WHERE id = %s AND tenant_id = %s",
                (new_role, profile_id, tenant_id),
            )
            conn.commit()
            return cur.rowcount > 0


def remove_org_member(tenant_id: str, profile_id: str) -> bool:
    """Remove a member from an org. Cannot remove the last leader."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Count remaining leaders
            cur.execute(
                "SELECT COUNT(*) as cnt FROM user_profiles WHERE tenant_id = %s AND role = 'leader'",
                (tenant_id,),
            )
            leader_count = int(cur.fetchone()["cnt"])
            # Check if target is a leader
            cur.execute(
                "SELECT role FROM user_profiles WHERE id = %s AND tenant_id = %s",
                (profile_id, tenant_id),
            )
            row = cur.fetchone()
            if not row:
                return False
            if row["role"] == "leader" and leader_count <= 1:
                raise ValueError("Cannot remove the last leader. Contact superadmin.")
            cur.execute(
                "DELETE FROM user_profiles WHERE id = %s AND tenant_id = %s",
                (profile_id, tenant_id),
            )
            conn.commit()
            return cur.rowcount > 0


def get_profile_id_by_auth(supabase_auth_id: str) -> str | None:
    """Get user_profiles.id from supabase_auth_id."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT id FROM user_profiles WHERE supabase_auth_id = %s",
                (supabase_auth_id,),
            )
            row = cur.fetchone()
            return str(row["id"]) if row else None


def create_invite(tenant_id: str, email: str, role: str, invited_by_auth_id: str) -> tuple[str, str]:
    """Create a tenant invite token. Looks up profile id from auth id. Returns (token, invite_id)."""
    profile_id = get_profile_id_by_auth(invited_by_auth_id)
    if not profile_id:
        raise ValueError("Inviter profile not found.")
    token = "inv_" + __import__("secrets").token_urlsafe(24)
    from datetime import datetime, timedelta
    expires = datetime.utcnow() + timedelta(days=7)
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO tenant_invites (tenant_id, email, role, invited_by, token, expires_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (tenant_id, email.lower().strip(), role, profile_id, token, expires),
            )
            row = cur.fetchone()
            conn.commit()
            return token, str(row["id"])


def list_invites(tenant_id: str) -> list[dict]:
    """Return pending (unused, unexpired) invites for a tenant."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT i.id, i.email, i.role, i.token, i.expires_at, i.created_at,
                       p.display_name as invited_by_name
                FROM tenant_invites i
                LEFT JOIN user_profiles p ON p.id = i.invited_by
                WHERE i.tenant_id = %s
                  AND i.used_at IS NULL
                  AND (i.expires_at IS NULL OR i.expires_at > CURRENT_TIMESTAMP)
                ORDER BY i.created_at DESC
                """,
                (tenant_id,),
            )
            return [dict(r) for r in cur.fetchall()]


def revoke_invite(invite_id: str, tenant_id: str) -> bool:
    """Mark an invite as used (soft revoke)."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "UPDATE tenant_invites SET used_at = CURRENT_TIMESTAMP WHERE id = %s AND tenant_id = %s",
                (invite_id, tenant_id),
            )
            conn.commit()
            return cur.rowcount > 0


def validate_invite_token(token: str) -> dict | None:
    """Check if an invite token is valid and unused. Returns invite details or None."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT i.id, i.tenant_id, i.email, i.role, i.expires_at,
                       t.company_name as tenant_name
                FROM tenant_invites i
                JOIN tenants t ON t.id = i.tenant_id
                WHERE i.token = %s
                  AND i.used_at IS NULL
                  AND (i.expires_at IS NULL OR i.expires_at > CURRENT_TIMESTAMP)
                """,
                (token,),
            )
            row = cur.fetchone()
            return dict(row) if row else None


def accept_invite(token: str, supabase_auth_id: str, display_name: str, user_email: str | None = None) -> dict | None:
    """Redeem an invite: create/update user profile with correct tenant/role, mark invite used.
    If user_email is provided, verifies it matches the invite email.
    """
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Get invite
            cur.execute(
                """
                SELECT id, tenant_id, email, role FROM tenant_invites
                WHERE token = %s AND used_at IS NULL
                  AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
                """,
                (token,),
            )
            invite = cur.fetchone()
            if not invite:
                return None

            # Verify email matches the invite
            if user_email and invite["email"] and user_email.lower().strip() != invite["email"].lower().strip():
                return None

            tenant_id = str(invite["tenant_id"])
            role = invite["role"]

            # Upsert user profile
            cur.execute(
                "SELECT id FROM user_profiles WHERE supabase_auth_id = %s",
                (supabase_auth_id,),
            )
            existing = cur.fetchone()
            if existing:
                cur.execute(
                    """
                    UPDATE user_profiles
                    SET tenant_id = %s, role = %s, display_name = %s
                    WHERE supabase_auth_id = %s
                    """,
                    (tenant_id, role, display_name, supabase_auth_id),
                )
            else:
                cur.execute(
                    """
                    INSERT INTO user_profiles (supabase_auth_id, tenant_id, display_name, role, is_platform_admin)
                    VALUES (%s, %s, %s, %s, FALSE)
                    """,
                    (supabase_auth_id, tenant_id, display_name, role),
                )

            # Mark invite as used
            cur.execute(
                "UPDATE tenant_invites SET used_at = CURRENT_TIMESTAMP WHERE id = %s",
                (str(invite["id"]),),
            )
            conn.commit()
            return {"tenant_id": tenant_id, "role": role, "email": invite["email"]}


def ensure_user_profile(supabase_auth_id: str, email: str, tenant_id: str | None = None) -> dict:
    """Ensure a user profile exists. Create with defaults if missing. Returns profile."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT id, tenant_id, display_name, role, is_platform_admin FROM user_profiles WHERE supabase_auth_id = %s",
                (supabase_auth_id,),
            )
            row = cur.fetchone()
            if row:
                return dict(row)
            # Create new profile with default tenant
            tid = tenant_id if tenant_id else DEFAULT_TENANT_ID
            cur.execute(
                """
                INSERT INTO user_profiles (supabase_auth_id, tenant_id, display_name, role, is_platform_admin)
                VALUES (%s, %s, %s, %s, FALSE)
                RETURNING id, tenant_id, display_name, role, is_platform_admin
                """,
                (supabase_auth_id, tid, email, "member"),
            )
            new = cur.fetchone()
            conn.commit()
            return dict(new)


# ── User Preferences ────────────────────────────────────────────

def get_user_preferences(supabase_auth_id: str) -> dict:
    """Return user's AI preferences. Decrypts system_prompt per-user."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT preferred_model, system_prompt, max_tokens FROM user_profiles WHERE supabase_auth_id = %s",
                (supabase_auth_id,),
            )
            row = cur.fetchone()
            if not row:
                return {"preferred_model": "moonshotai.kimi-k2.5", "system_prompt": "", "max_tokens": 1024}
            return {
                "preferred_model": row["preferred_model"] or "moonshotai.kimi-k2.5",
                "system_prompt": encryption.safe_decrypt(row["system_prompt"] or "", supabase_auth_id, placeholder=""),
                "max_tokens": int(row["max_tokens"] or 1024),
            }


def update_user_preferences(supabase_auth_id: str, updates: dict) -> dict:
    """Update user's AI preferences. Encrypts system_prompt per-user."""
    allowed = {"preferred_model", "system_prompt", "max_tokens"}
    filtered = {k: v for k, v in updates.items() if k in allowed}
    if not filtered:
        return {"status": "no changes"}
    if "system_prompt" in filtered and filtered["system_prompt"]:
        filtered["system_prompt"] = encryption.encrypt(filtered["system_prompt"], supabase_auth_id)
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            set_clauses = ", ".join(f"{k} = %s" for k in filtered)
            values = list(filtered.values()) + [supabase_auth_id]
            cur.execute(
                f"UPDATE user_profiles SET {set_clauses} WHERE supabase_auth_id = %s RETURNING preferred_model, system_prompt, max_tokens",
                values,
            )
            row = cur.fetchone()
            conn.commit()
            if not row:
                return {"status": "not found"}
            return {
                "preferred_model": row["preferred_model"] or "moonshotai.kimi-k2.5",
                "system_prompt": encryption.safe_decrypt(row["system_prompt"] or "", supabase_auth_id, placeholder=""),
                "max_tokens": int(row["max_tokens"] or 1024),
            }


def get_org_usage(tenant_id: str) -> dict:
    """Return aggregate usage for a tenant."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT COALESCE(SUM(total_tokens_used), 0) as total_tokens FROM tenant_usage_metrics WHERE tenant_id = %s",
                (tenant_id,),
            )
            raw_total = int(cur.fetchone()["total_tokens"])
            total_tokens = raw_total
            cur.execute(
                "SELECT COUNT(DISTINCT supabase_auth_id) as active_users FROM tenant_usage_metrics WHERE tenant_id = %s AND api_call_timestamp > CURRENT_TIMESTAMP - INTERVAL '30 days'",
                (tenant_id,),
            )
            active_users = int(cur.fetchone()["active_users"])
            cur.execute(
                "SELECT COUNT(*) as total_calls FROM tenant_usage_metrics WHERE tenant_id = %s",
                (tenant_id,),
            )
            total_calls = int(cur.fetchone()["total_calls"])
            cur.execute(
                """
                SELECT model_identifier, SUM(total_tokens_used) as tokens, COUNT(*) as calls
                FROM tenant_usage_metrics
                WHERE tenant_id = %s
                GROUP BY model_identifier
                ORDER BY tokens DESC
                """,
                (tenant_id,),
            )
            model_breakdown = [dict(r) for r in cur.fetchall()]
            return {
                "total_tokens": total_tokens,
                "active_users": active_users,
                "total_calls": total_calls,
                "compute_cost": round(total_tokens * 0.002 / 1000, 2),
                "model_breakdown": model_breakdown,
            }


def get_user_usage(supabase_auth_id: str) -> dict:
    """Return usage stats for a single user."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT COALESCE(SUM(total_tokens_used), 0) as total_tokens FROM tenant_usage_metrics WHERE supabase_auth_id = %s",
                (supabase_auth_id,),
            )
            total_tokens = int(cur.fetchone()["total_tokens"])
            cur.execute(
                "SELECT COUNT(*) as total_calls FROM tenant_usage_metrics WHERE supabase_auth_id = %s",
                (supabase_auth_id,),
            )
            total_calls = int(cur.fetchone()["total_calls"])
            cur.execute(
                """
                SELECT model_identifier, SUM(total_tokens_used) as tokens, COUNT(*) as calls
                FROM tenant_usage_metrics
                WHERE supabase_auth_id = %s
                GROUP BY model_identifier
                ORDER BY tokens DESC
                """,
                (supabase_auth_id,),
            )
            model_breakdown = [dict(r) for r in cur.fetchall()]
            cur.execute(
                """
                SELECT tenant_id, model_identifier, total_tokens_used as tokens,
                       execution_duration_ms as duration_ms,
                       api_call_timestamp as timestamp
                FROM tenant_usage_metrics
                WHERE supabase_auth_id = %s
                ORDER BY api_call_timestamp DESC
                LIMIT 20
                """,
                (supabase_auth_id,),
            )
            recent = [dict(r) for r in cur.fetchall()]
            return {
                "total_tokens": total_tokens,
                "total_calls": total_calls,
                "compute_cost": round(total_tokens * 0.002 / 1000, 2),
                "model_breakdown": model_breakdown,
                "recent": recent,
            }


def get_global_usage() -> dict:
    """Return aggregate usage across all tenants (superadmin view)."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT COALESCE(SUM(total_tokens_used), 0) as total_tokens FROM tenant_usage_metrics"
            )
            total_tokens = int(cur.fetchone()["total_tokens"])
            cur.execute(
                "SELECT COUNT(*) as total_calls FROM tenant_usage_metrics"
            )
            total_calls = int(cur.fetchone()["total_calls"])
            cur.execute(
                "SELECT COUNT(DISTINCT tenant_id) as active_tenants FROM tenant_usage_metrics"
            )
            active_tenants = int(cur.fetchone()["active_tenants"])
            cur.execute(
                "SELECT COUNT(*) as total_users FROM user_profiles"
            )
            total_users = int(cur.fetchone()["total_users"])
            cur.execute(
                """
                SELECT t.company_name, SUM(m.total_tokens_used) as tokens, COUNT(*) as calls
                FROM tenant_usage_metrics m
                JOIN tenants t ON t.id = m.tenant_id
                GROUP BY t.company_name
                ORDER BY tokens DESC
                LIMIT 20
                """
            )
            tenant_breakdown = [dict(r) for r in cur.fetchall()]
            cur.execute(
                """
                SELECT model_identifier, SUM(total_tokens_used) as tokens, COUNT(*) as calls
                FROM tenant_usage_metrics
                GROUP BY model_identifier
                ORDER BY tokens DESC
                """
            )
            model_breakdown = [dict(r) for r in cur.fetchall()]
            return {
                "total_tokens": total_tokens,
                "total_calls": total_calls,
                "active_tenants": active_tenants,
                "total_users": total_users,
                "compute_cost": round(total_tokens * 0.002 / 1000, 2),
                "tenant_breakdown": tenant_breakdown,
                "model_breakdown": model_breakdown,
            }


def is_platform_admin(supabase_auth_id: str) -> bool:
    """Check if a user is a platform-level superadmin."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT is_platform_admin FROM user_profiles WHERE supabase_auth_id = %s",
                (supabase_auth_id,),
            )
            row = cur.fetchone()
            return bool(row and row.get("is_platform_admin"))


def list_all_tenants(search: str | None = None, limit: int = 50, offset: int = 0, sort_by: str = "created_at", sort_dir: str = "desc") -> dict:
    """Return paginated tenants with member count and usage stats (superadmin only)."""
    allowed_sorts = {"created_at", "company_name", "member_count", "total_tokens", "extra_token_pool"}
    if sort_by not in allowed_sorts:
        sort_by = "created_at"
    if sort_dir not in ("asc", "desc"):
        sort_dir = "desc"

    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            where_clause = ""
            params: list = []
            if search:
                where_clause = "WHERE t.company_name ILIKE %s"
                params.append(f"%{search}%")

            # Count total
            cur.execute(f"SELECT COUNT(*) as total FROM tenants t {where_clause}", params)
            total = int(cur.fetchone()["total"])

            # Fetch page
            cur.execute(
                f"""
                SELECT t.id,
                       t.company_name,
                       t.tier,
                       t.is_active,
                       t.created_at,
                       COALESCE(t.extra_token_pool, 0) as extra_token_pool,
                       COALESCE((SELECT COUNT(*) FROM user_profiles WHERE tenant_id = t.id), 0) as member_count,
                       COALESCE((SELECT SUM(total_tokens_used) FROM tenant_usage_metrics WHERE tenant_id = t.id), 0) as total_tokens,
                       COALESCE(t.paid_credit_used, 0) as paid_credit_used
                FROM tenants t
                {where_clause}
                ORDER BY {sort_by} {sort_dir}
                LIMIT %s OFFSET %s
                """,
                params + [limit, offset],
            )
            companies = [dict(r) for r in cur.fetchall()]
            return {"companies": companies, "total": total, "limit": limit, "offset": offset}


def get_tenant_details(tenant_id: str) -> dict | None:
    """Get tenant info + members + usage."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id,
                       company_name,
                       tier,
                       is_active,
                       created_at,
                       COALESCE(extra_token_pool, 0) as extra_token_pool
                FROM tenants WHERE id = %s
                """,
                (tenant_id,),
            )
            tenant = cur.fetchone()
            if not tenant:
                return None
            members = list_org_members(tenant_id)
            usage = get_org_usage(tenant_id)
            usage_detail = get_tenant_usage_detail(tenant_id)
            return {
                "tenant": dict(tenant),
                "members": members,
                "usage": usage,
                "usage_detail": usage_detail,
            }


def get_tenant_usage_detail(tenant_id: str, days: int = 30) -> dict:
    """Detailed credit usage per tenant for billing dashboards."""
    since = datetime.now(timezone.utc) - timedelta(days=days - 1)
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT DATE(api_call_timestamp) as day,
                       COALESCE(SUM(credits_used), 0) as credits,
                       COALESCE(SUM(total_tokens_used), 0) as tokens
                FROM tenant_usage_metrics
                WHERE tenant_id = %s AND api_call_timestamp >= %s
                GROUP BY DATE(api_call_timestamp)
                ORDER BY day ASC
                """,
                (tenant_id, since),
            )
            daily_rows = [
                {
                    "day": row["day"].isoformat(),
                    "credits": int(row["credits"] or 0),
                    "tokens": int(row["tokens"] or 0),
                }
                for row in cur.fetchall()
            ]

            cur.execute(
                """
                SELECT u.supabase_auth_id,
                       u.display_name,
                       u.role,
                       u.created_at,
                       COALESCE(SUM(m.credits_used), 0) as total_credits,
                       COALESCE(SUM(m.total_tokens_used), 0) as total_tokens,
                       COALESCE(MAX(m.api_call_timestamp), u.created_at) as last_activity
                FROM user_profiles u
                LEFT JOIN tenant_usage_metrics m ON m.supabase_auth_id = u.supabase_auth_id
                WHERE u.tenant_id = %s
                GROUP BY u.supabase_auth_id, u.display_name, u.role, u.created_at
                ORDER BY total_credits DESC, u.created_at DESC
                """,
                (tenant_id,),
            )
            member_rows = [
                {
                    "supabase_auth_id": str(row["supabase_auth_id"]),
                    "display_name": row.get("display_name"),
                    "role": row.get("role", "member"),
                    "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
                    "total_credits": int(row["total_credits"] or 0),
                    "total_tokens": int(row["total_tokens"] or 0),
                    "last_activity": row["last_activity"].isoformat() if row.get("last_activity") else None,
                }
                for row in cur.fetchall()
            ]

            cur.execute(
                """
                SELECT supabase_auth_id,
                       DATE(api_call_timestamp) as day,
                       COALESCE(SUM(credits_used), 0) as credits
                FROM tenant_usage_metrics
                WHERE tenant_id = %s AND api_call_timestamp >= %s
                GROUP BY supabase_auth_id, DATE(api_call_timestamp)
                ORDER BY day DESC
                """,
                (tenant_id, since),
            )
            member_daily = [
                {
                    "supabase_auth_id": str(row["supabase_auth_id"]),
                    "day": row["day"].isoformat(),
                    "credits": int(row["credits"] or 0),
                }
                for row in cur.fetchall()
            ]

            return {
                "daily": daily_rows,
                "members": member_rows,
                "member_daily": member_daily,
            }


# ── Admin (Superadmin) Management ───────────────────────────────────

def create_tenant(company_name: str, tier: str = "standard") -> str:
    """Create a new tenant (company). Returns tenant_id."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "INSERT INTO tenants (company_name, tier, is_active) VALUES (%s, %s, TRUE) RETURNING id",
                (company_name, tier),
            )
            tenant_id = str(cur.fetchone()["id"])
            conn.commit()
            return tenant_id


def get_user_profile(profile_id: str) -> dict | None:
    """Get a single user profile by id."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, supabase_auth_id, tenant_id, display_name, role,
                       is_platform_admin, created_at
                FROM user_profiles WHERE id = %s
                """,
                (profile_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None


def update_any_user_role(profile_id: str, new_role: str) -> bool:
    """Superadmin can change any user's role globally."""
    if new_role not in ("superadmin", "leader", "member"):
        raise ValueError("Invalid role.")
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            is_admin = new_role == "superadmin"
            cur.execute(
                "UPDATE user_profiles SET role = %s, is_platform_admin = %s WHERE id = %s",
                (new_role, is_admin, profile_id),
            )
            conn.commit()
            return cur.rowcount > 0


def delete_any_user(profile_id: str) -> bool:
    """Superadmin can delete any user globally."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("DELETE FROM user_profiles WHERE id = %s", (profile_id,))
            conn.commit()
            return cur.rowcount > 0


def list_all_users(search: str | None = None, limit: int = 50, offset: int = 0, role_filter: str | None = None) -> dict:
    """Return paginated users across all companies with tenant name."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            conditions = []
            params: list = []
            if search:
                conditions.append("(p.display_name ILIKE %s OR t.company_name ILIKE %s)")
                params.extend([f"%{search}%", f"%{search}%"])
            if role_filter and role_filter in ("superadmin", "leader", "member"):
                if role_filter == "superadmin":
                    conditions.append("p.is_platform_admin = TRUE")
                else:
                    conditions.append("p.role = %s AND (p.is_platform_admin IS NULL OR p.is_platform_admin = FALSE)")
                    params.append(role_filter)

            where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""

            cur.execute(
                f"SELECT COUNT(*) as total FROM user_profiles p LEFT JOIN tenants t ON t.id = p.tenant_id {where_clause}",
                params,
            )
            total = int(cur.fetchone()["total"])

            cur.execute(
                f"""
                SELECT p.id, p.supabase_auth_id, p.display_name, p.role,
                       p.is_platform_admin, p.created_at,
                       t.company_name as tenant_name,
                       t.id as tenant_id
                FROM user_profiles p
                LEFT JOIN tenants t ON t.id = p.tenant_id
                {where_clause}
                ORDER BY p.created_at DESC
                LIMIT %s OFFSET %s
                """,
                params + [limit, offset],
            )
            users = [dict(r) for r in cur.fetchall()]
            return {"users": users, "total": total, "limit": limit, "offset": offset}


def assign_leader_to_tenant(tenant_id: str, email: str, invited_by: str) -> tuple[str, str]:
    """Invite someone to become the leader of a company. Returns (token, invite_id)."""
    return create_invite(tenant_id, email, "leader", invited_by)


# ── Chat Sessions (per-user, stored in DB) ───────────────────────

def create_chat_session(supabase_auth_id: str, title: str, model_id: str) -> dict:
    """Create a new chat session for a user."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO chat_sessions (supabase_auth_id, title, model_id)
                VALUES (%s, %s, %s)
                RETURNING id, title, model_id, created_at, updated_at
                """,
                (supabase_auth_id, title, model_id),
            )
            row = cur.fetchone()
            conn.commit()
            return dict(row)


def list_chat_sessions(supabase_auth_id: str) -> list[dict]:
    """List all chat sessions for a user, newest first."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, title, model_id, created_at, updated_at
                FROM chat_sessions
                WHERE supabase_auth_id = %s
                ORDER BY updated_at DESC
                """,
                (supabase_auth_id,),
            )
            return [dict(r) for r in cur.fetchall()]


def get_chat_session(session_id: str, supabase_auth_id: str) -> dict | None:
    """Get a single session with its messages. Verifies ownership. Decrypts per-user."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, title, model_id, created_at, updated_at
                FROM chat_sessions
                WHERE id = %s AND supabase_auth_id = %s
                """,
                (session_id, supabase_auth_id),
            )
            session = cur.fetchone()
            if not session:
                return None
            cur.execute(
                """
                SELECT id, role, content, created_at
                FROM chat_messages
                WHERE session_id = %s
                ORDER BY created_at ASC
                """,
                (session_id,),
            )
            messages = []
            for row in cur.fetchall():
                msg = dict(row)
                msg["content"] = encryption.safe_decrypt(msg["content"], supabase_auth_id)
                messages.append(msg)
            return {**dict(session), "messages": messages}


def add_chat_message(session_id: str, role: str, content: str, supabase_auth_id: str) -> dict | None:
    """Add a message to a session. Verifies ownership. Encrypts content per-user."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Verify ownership
            cur.execute(
                "SELECT id FROM chat_sessions WHERE id = %s AND supabase_auth_id = %s",
                (session_id, supabase_auth_id),
            )
            if not cur.fetchone():
                return None
            encrypted_content = encryption.encrypt(content, supabase_auth_id)
            cur.execute(
                """
                INSERT INTO chat_messages (session_id, role, content)
                VALUES (%s, %s, %s)
                RETURNING id, role, created_at
                """,
                (session_id, role, encrypted_content),
            )
            msg = cur.fetchone()
            cur.execute(
                "UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = %s",
                (session_id,),
            )
            conn.commit()
            return {"id": msg["id"], "role": msg["role"], "content": content, "created_at": msg["created_at"]}


def delete_chat_session(session_id: str, supabase_auth_id: str) -> bool:
    """Delete a session and all its messages. Verifies ownership."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "DELETE FROM chat_sessions WHERE id = %s AND supabase_auth_id = %s",
                (session_id, supabase_auth_id),
            )
            conn.commit()
            return cur.rowcount > 0


def update_chat_session_title(session_id: str, supabase_auth_id: str, title: str) -> bool:
    """Rename a session. Verifies ownership."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                UPDATE chat_sessions SET title = %s, updated_at = CURRENT_TIMESTAMP
                WHERE id = %s AND supabase_auth_id = %s
                """,
                (title, session_id, supabase_auth_id),
            )
            conn.commit()
            return cur.rowcount > 0


# ── Token Quota Management ────────────────────────────────────────

def _maybe_reset_daily_tokens(cur, supabase_auth_id: str) -> tuple[int, int, int, int]:
    """Check if daily reset is needed and return current state.
    Returns (daily_budget, daily_used, extra_allocated, extra_used)."""
    cur.execute(
        "SELECT daily_budget, daily_used, last_token_reset, paid_credit_balance, paid_credit_used FROM user_profiles WHERE supabase_auth_id = %s",
        (supabase_auth_id,),
    )
    row = cur.fetchone()
    if not row:
        return 100, 0, 0, 0

    daily_budget = int(row[0] or 100)
    daily_used = int(row[1] or 0)
    last_reset = row[2]
    extra_allocated = int(row[3] or 0) if row[3] is not None else 0
    extra_used = int(row[4] or 0) if row[4] is not None else 0

    now = datetime.now(timezone.utc)
    if last_reset and last_reset.date() < now.date():
        # Daily reset: clear daily_used
        cur.execute(
            "UPDATE user_profiles SET daily_used = 0, last_token_reset = %s WHERE supabase_auth_id = %s",
            (now, supabase_auth_id),
        )
        daily_used = 0

    return daily_budget, daily_used, extra_allocated, extra_used


def _warning_level(daily_budget: int, daily_used: int) -> str:
    """Return usage warning level based on daily budget consumption."""
    if daily_budget <= 0:
        return "exhausted"
    pct = daily_used / daily_budget
    if pct < 0.7:
        return "none"
    if pct < 0.9:
        return "caution"
    if pct < 1.0:
        return "warning"
    if pct < 1.1:
        return "critical"
    return "exhausted"


def get_user_token_usage(supabase_auth_id: str) -> dict:
    """Return user's daily budget and extra credit status."""
    with get_db() as conn:
        with conn.cursor() as cur:
            daily_budget, daily_used, extra_allocated, extra_used = _maybe_reset_daily_tokens(cur, supabase_auth_id)
            conn.commit()

    daily_remaining = max(daily_budget - daily_used, 0)
    extra_remaining = max(extra_allocated - extra_used, 0)
    total_available = daily_remaining + extra_remaining

    return {
        "daily_budget": daily_budget,
        "daily_used": daily_used,
        "daily_remaining": daily_remaining,
        "extra_allocated": extra_allocated,
        "extra_used": extra_used,
        "extra_remaining": extra_remaining,
        "total_available": total_available,
        "warning_level": _warning_level(daily_budget, daily_used),
    }


def get_org_token_usage(tenant_id: str) -> dict:
    """Return org's extra credit pool status."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT COALESCE(extra_token_pool, 0) as pool, COALESCE(auto_pool_draw, FALSE) as auto_pool_draw FROM tenants WHERE id = %s", (tenant_id,))
            row = cur.fetchone()
            pool = int(row["pool"] if row else 0)
            auto_draw = bool(row["auto_pool_draw"]) if row else False
            cur.execute(
                "SELECT COALESCE(SUM(paid_credit_balance), 0) as allocated FROM user_profiles WHERE tenant_id = %s",
                (tenant_id,),
            )
            allocated_row = cur.fetchone()
            allocated = int(allocated_row["allocated"] if allocated_row else 0)
            return {"extra_pool": pool, "extra_allocated": allocated, "auto_pool_draw": auto_draw}


def set_auto_pool_draw(tenant_id: str, enabled: bool) -> dict:
    """Toggle auto-pool-draw for a tenant."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "UPDATE tenants SET auto_pool_draw = %s WHERE id = %s RETURNING auto_pool_draw, COALESCE(extra_token_pool, 0) as extra_pool",
                (enabled, tenant_id),
            )
            row = cur.fetchone()
            conn.commit()
            return {"auto_pool_draw": bool(row["auto_pool_draw"]), "extra_pool": int(row["extra_pool"])} if row else {"auto_pool_draw": False, "extra_pool": 0}


def draw_from_org_pool(tenant_id: str, credits_needed: int) -> bool:
    """Atomically deduct credits from the org pool. Returns True if successful."""
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COALESCE(extra_token_pool, 0) as pool, COALESCE(auto_pool_draw, FALSE) as auto_draw FROM tenants WHERE id = %s FOR UPDATE",
                (tenant_id,),
            )
            row = cur.fetchone()
            if not row or not row[1]:  # auto_draw not enabled
                return False
            pool = int(row[0])
            if pool < credits_needed:
                return False
            cur.execute(
                "UPDATE tenants SET extra_token_pool = extra_token_pool - %s WHERE id = %s",
                (credits_needed, tenant_id),
            )
            conn.commit()
            return True


def get_org_quota_snapshot(tenant_id: str) -> dict:
    """Return org pool plus each member's quota in one call."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT COALESCE(extra_token_pool, 0) as pool, COALESCE(auto_pool_draw, FALSE) as auto_pool_draw FROM tenants WHERE id = %s", (tenant_id,))
            pool_row = cur.fetchone()
            pool = int(pool_row["pool"] if pool_row else 0)
            auto_draw = bool(pool_row["auto_pool_draw"]) if pool_row else False

            cur.execute(
                "SELECT COALESCE(SUM(paid_credit_balance), 0) as allocated FROM user_profiles WHERE tenant_id = %s",
                (tenant_id,),
            )
            allocated_row = cur.fetchone()
            allocated = int(allocated_row["allocated"] if allocated_row else 0)

            cur.execute(
                """
                SELECT supabase_auth_id,
                       display_name,
                       role,
                       created_at
                FROM user_profiles
                WHERE tenant_id = %s
                ORDER BY
                  CASE role
                    WHEN 'leader' THEN 1
                    WHEN 'member' THEN 2
                    ELSE 3
                  END,
                  created_at DESC
                """,
                (tenant_id,),
            )
            member_rows = [dict(r) for r in cur.fetchall()]

            member_quotas: list[dict] = []
            quota_cur = conn.cursor()
            try:
                for member in member_rows:
                    supabase_auth_id = member["supabase_auth_id"]
                    daily_budget, daily_used, extra_allocated_member, extra_used = _maybe_reset_daily_tokens(quota_cur, supabase_auth_id)
                    daily_remaining = max(daily_budget - daily_used, 0)
                    extra_remaining = max(extra_allocated_member - extra_used, 0)
                    member_quotas.append({
                        "supabase_auth_id": supabase_auth_id,
                        "name": member.get("display_name") or "",
                        "role": member.get("role", ""),
                        "quota": {
                            "daily_budget": daily_budget,
                            "daily_used": daily_used,
                            "daily_remaining": daily_remaining,
                            "extra_allocated": extra_allocated_member,
                            "extra_used": extra_used,
                            "extra_remaining": extra_remaining,
                            "total_available": daily_remaining + extra_remaining,
                        },
                    })
            finally:
                quota_cur.close()

            conn.commit()

            return {
                "org": {"extra_pool": pool, "extra_allocated": allocated, "auto_pool_draw": auto_draw},
                "members": member_quotas,
            }


def consume_user_credits(supabase_auth_id: str, tenant_id: str, credits_used: int) -> dict:
    """Deduct credits from daily budget first, then extra credits.
    Returns dict with credits_consumed and paid_credit_consumed.
    """
    with get_db() as conn:
        with conn.cursor() as cur:
            daily_budget, daily_used, extra_allocated, extra_used = _maybe_reset_daily_tokens(cur, supabase_auth_id)
            daily_remaining = max(daily_budget - daily_used, 0)
            paid_remaining = max(extra_allocated - extra_used, 0)
            total_available = daily_remaining + paid_remaining

            if credits_used > total_available:
                raise ValueError("Insufficient credits")

            use_daily = min(credits_used, daily_remaining)
            use_paid = max(credits_used - use_daily, 0)
            new_daily_used = daily_used + use_daily
            new_extra_used = extra_used + use_paid

            cur.execute(
                "UPDATE user_profiles SET daily_used = %s, paid_credit_used = %s WHERE supabase_auth_id = %s",
                (new_daily_used, new_extra_used, supabase_auth_id),
            )
            conn.commit()
            return {"credits_consumed": credits_used, "paid_credit_consumed": use_paid}


def check_credit_quota(supabase_auth_id: str, tenant_id: str, incoming_credits: int = 0) -> tuple[bool, str]:
    """Check if user has enough daily + extra credits.
    Returns (allowed: bool, reason: str).
    """
    user = get_user_token_usage(supabase_auth_id)

    # Normal case: within budget
    if incoming_credits <= user["total_available"]:
        return True, ""

    # Fully blocked
    return False, (
        f"Credit quota exceeded. Leaders can top up credits and allocate them to members. "
        f"Daily: {user['daily_used']:,}/{user['daily_budget']:,} used, "
        f"Extra: {user['extra_used']:,}/{user['extra_allocated']:,} used. "
        f"Available: {user['total_available']:,}"
    )

def reserve_credits(supabase_auth_id: str, tenant_id: str, estimated_credits: int, is_admin: bool = False) -> dict:
    """Atomically check quota and reserve credits using SELECT FOR UPDATE.
    Returns {"allowed": bool, "reason": str, "reserved_credits": int}.
    Platform admins bypass all quota checks.
    """
    # Admin bypass — unlimited usage
    if is_admin:
        return {"allowed": True, "reason": "", "reserved_credits": 0}

    with get_db() as conn:
        with conn.cursor() as cur:
            # Lock the user row to prevent concurrent modifications
            cur.execute(
                "SELECT daily_budget, daily_used, last_token_reset, paid_credit_balance, paid_credit_used "
                "FROM user_profiles WHERE supabase_auth_id = %s FOR UPDATE",
                (supabase_auth_id,),
            )
            row = cur.fetchone()
            if not row:
                conn.commit()
                return {"allowed": False, "reason": "User profile not found.", "reserved_credits": 0}

            daily_budget = int(row[0] or 100)
            daily_used = int(row[1] or 0)
            last_reset = row[2]
            extra_allocated = int(row[3] or 0) if row[3] is not None else 0
            extra_used = int(row[4] or 0) if row[4] is not None else 0

            # Check if daily reset is needed
            now = datetime.now(timezone.utc)
            if last_reset and last_reset.date() < now.date():
                cur.execute(
                    "UPDATE user_profiles SET daily_used = 0, last_token_reset = %s WHERE supabase_auth_id = %s",
                    (now, supabase_auth_id),
                )
                daily_used = 0

            daily_remaining = max(daily_budget - daily_used, 0)
            extra_remaining = max(extra_allocated - extra_used, 0)
            total_available = daily_remaining + extra_remaining

            if estimated_credits > total_available:
                # Try auto-draw from org pool if enabled
                if draw_from_org_pool(tenant_id, estimated_credits):
                    conn.commit()
                    return {
                        "allowed": True,
                        "reason": "",
                        "reserved_credits": 0,  # drawn from pool, not user balance
                    }
                conn.commit()
                return {
                    "allowed": False,
                    "reason": (
                        f"Insufficient credits. Available: {total_available:,} "
                        f"(daily: {daily_remaining:,}, extra: {extra_remaining:,}). "
                        f"Estimated cost: {estimated_credits:,}."
                    ),
                    "reserved_credits": 0,
                }

            # Reserve by consuming from daily first, then extra
            use_daily = min(estimated_credits, daily_remaining)
            use_extra = max(estimated_credits - use_daily, 0)
            new_daily_used = daily_used + use_daily
            new_extra_used = extra_used + use_extra

            cur.execute(
                "UPDATE user_profiles SET daily_used = %s, paid_credit_used = %s WHERE supabase_auth_id = %s",
                (new_daily_used, new_extra_used, supabase_auth_id),
            )
            conn.commit()
            return {
                "allowed": True,
                "reason": "",
                "reserved_credits": estimated_credits,
            }


def release_reserved_credits(supabase_auth_id: str, credits_to_release: int) -> None:
    """Release previously reserved credits back to the user (e.g., on upstream failure).
    Releases from extra first, then daily (reverse of reservation order).
    """
    if credits_to_release <= 0:
        return
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT daily_used, paid_credit_used FROM user_profiles WHERE supabase_auth_id = %s FOR UPDATE",
                (supabase_auth_id,),
            )
            row = cur.fetchone()
            if not row:
                conn.commit()
                return

            daily_used = int(row[0] or 0)
            extra_used = int(row[1] or 0)

            # Release from extra first (it was consumed last during reservation)
            release_extra = min(credits_to_release, extra_used)
            release_daily = min(credits_to_release - release_extra, daily_used)

            new_daily_used = daily_used - release_daily
            new_extra_used = extra_used - release_extra

            cur.execute(
                "UPDATE user_profiles SET daily_used = %s, paid_credit_used = %s WHERE supabase_auth_id = %s",
                (max(new_daily_used, 0), max(new_extra_used, 0), supabase_auth_id),
            )
            conn.commit()


def settle_credits(supabase_auth_id: str, tenant_id: str, reserved: int, actual: int) -> None:
    """Settle the difference between reserved and actual credits.
    If actual < reserved, release the difference back.
    If actual > reserved (shouldn't happen with good estimates), consume the extra.
    """
    diff = reserved - actual
    if diff > 0:
        # Over-reserved: give back the difference
        release_reserved_credits(supabase_auth_id, diff)
    elif diff < 0:
        # Under-reserved (rare): try to consume the extra
        try:
            consume_user_credits(supabase_auth_id, tenant_id, abs(diff))
        except (ValueError, Exception):
            logger.warning(
                "Credit under-reservation: user=%s diff=%d (response already sent)",
                supabase_auth_id, abs(diff),
            )


def _insert_credit_ledger(cur, tenant_id: str, entry_type: str, credits: int, unit_cost_cents: int, note: str | None, created_by: str | None):
    cur.execute(
        """
        INSERT INTO credit_ledger (tenant_id, entry_type, credits, unit_cost_cents, note, created_by)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id, created_at
        """,
        (tenant_id, entry_type, credits, unit_cost_cents, note, created_by),
    )
    return cur.fetchone()


def add_org_extra_credits(tenant_id: str, amount: int, created_by: str | None = None, note: str | None = None) -> dict:
    """Admin adds extra credits to an org's pool."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "UPDATE tenants SET extra_token_pool = COALESCE(extra_token_pool, 0) + %s WHERE id = %s RETURNING extra_token_pool",
                (amount, tenant_id),
            )
            row = cur.fetchone()
            _insert_credit_ledger(cur, tenant_id, "topup", amount, 0, note, created_by)
            conn.commit()
            return {"status": "updated", "tenant_id": tenant_id, "extra_token_pool": int(row["extra_token_pool"]) if row else 0}


def list_credit_ledger(tenant_id: str, limit: int = 50, offset: int = 0) -> list[dict]:
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, entry_type, credits, unit_cost_cents, note, created_by, created_at
                FROM credit_ledger
                WHERE tenant_id = %s AND entry_type = 'topup'
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s
                """,
                (tenant_id, limit, offset),
            )
            return [dict(r) for r in cur.fetchall()]


def list_all_topups(limit: int = 50, offset: int = 0, tenant_id: str | None = None) -> list[dict]:
    query = [
        """
        SELECT cl.id,
               cl.tenant_id,
               t.company_name,
               cl.credits,
               cl.note,
               cl.created_by,
               cl.created_at
        FROM credit_ledger cl
        JOIN tenants t ON t.id = cl.tenant_id
        WHERE cl.entry_type = 'topup'
        """
    ]
    params: list = []
    if tenant_id:
        query.append("AND cl.tenant_id = %s")
        params.append(tenant_id)
    query.append("ORDER BY cl.created_at DESC LIMIT %s OFFSET %s")
    params.extend([limit, offset])

    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("\n".join(query), params)
            return [dict(r) for r in cur.fetchall()]


def allocate_member_extra_credits(tenant_id: str, supabase_auth_id: str, amount: int) -> dict:
    """Leader allocates extra credits from org pool to a member."""
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Verify member is in the org
            cur.execute("SELECT tenant_id FROM user_profiles WHERE supabase_auth_id = %s", (supabase_auth_id,))
            row = cur.fetchone()
            if not row or str(row["tenant_id"]) != tenant_id:
                raise ValueError("Member not in organization")

            # Lock org row and check pool
            cur.execute(
                "SELECT COALESCE(extra_token_pool, 0) as pool FROM tenants WHERE id = %s FOR UPDATE",
                (tenant_id,),
            )
            pool = int(cur.fetchone()["pool"])
            if pool < amount:
                raise ValueError(f"Org extra pool has {pool} credits. Cannot allocate {amount}.")

            # Deduct from pool, add to member
            cur.execute(
                "UPDATE tenants SET extra_token_pool = extra_token_pool - %s WHERE id = %s",
                (amount, tenant_id),
            )
            cur.execute(
                "UPDATE user_profiles SET paid_credit_balance = COALESCE(paid_credit_balance, 0) + %s WHERE supabase_auth_id = %s RETURNING paid_credit_balance",
                (amount, supabase_auth_id),
            )
            member_row = cur.fetchone()
            conn.commit()
            return {
                "status": "allocated",
                "supabase_auth_id": supabase_auth_id,
                "extra_allocated": int(member_row["paid_credit_balance"]) if member_row else 0,
                "org_pool_remaining": pool - amount,
            }



# ── Audit Log ────────────────────────────────────────────────────


def init_audit_log_table() -> None:
    """Create the append-only audit_log table if it does not exist."""
    sql = """
    CREATE TABLE IF NOT EXISTS audit_log (
        id BIGSERIAL PRIMARY KEY,
        ts TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        actor_user_id VARCHAR(150),
        actor_email VARCHAR(255),
        actor_role VARCHAR(50),
        actor_ip VARCHAR(64),
        request_id VARCHAR(64),
        action VARCHAR(120) NOT NULL,
        target_type VARCHAR(80),
        target_id VARCHAR(150),
        before JSONB,
        after JSONB,
        metadata JSONB
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log (ts DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log (actor_user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log (target_type, target_id);
    """
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def write_audit_log(
    *,
    actor_user_id: str | None,
    actor_email: str | None,
    actor_role: str | None,
    actor_ip: str | None,
    request_id: str | None,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    before: dict | None = None,
    after: dict | None = None,
    metadata: dict | None = None,
) -> None:
    """Append a single audit row. Best-effort; never raises to the caller."""
    import json as _json
    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO audit_log (
                        actor_user_id, actor_email, actor_role, actor_ip,
                        request_id, action, target_type, target_id,
                        before, after, metadata
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb)
                    """,
                    (
                        actor_user_id,
                        actor_email,
                        actor_role,
                        actor_ip,
                        request_id,
                        action,
                        target_type,
                        target_id,
                        _json.dumps(before) if before is not None else None,
                        _json.dumps(after) if after is not None else None,
                        _json.dumps(metadata) if metadata is not None else None,
                    ),
                )
            conn.commit()
    except Exception as e:
        logger.warning("Audit log write failed: %s", e)


def list_audit_log(
    *,
    actor_user_id: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    """Read recent audit rows, newest first. Used by the admin UI."""
    where: list[str] = []
    params: list = []
    if actor_user_id:
        where.append("actor_user_id = %s")
        params.append(actor_user_id)
    if target_type:
        where.append("target_type = %s")
        params.append(target_type)
    if target_id:
        where.append("target_id = %s")
        params.append(target_id)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    sql = f"""
        SELECT id, ts, actor_user_id, actor_email, actor_role, actor_ip,
               request_id, action, target_type, target_id, before, after, metadata
        FROM audit_log
        {where_sql}
        ORDER BY ts DESC
        LIMIT %s OFFSET %s
    """
    params.extend([limit, offset])
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]



# ── Email Log ────────────────────────────────────────────────────


def init_email_log_table() -> None:
    """Create the append-only email_log table if it does not exist."""
    sql = """
    CREATE TABLE IF NOT EXISTS email_log (
        id BIGSERIAL PRIMARY KEY,
        ts TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        to_hash VARCHAR(64) NOT NULL,
        subject VARCHAR(255),
        template VARCHAR(80) NOT NULL,
        status VARCHAR(20) NOT NULL,
        provider VARCHAR(40),
        provider_id VARCHAR(120),
        latency_ms INTEGER,
        error TEXT,
        request_id VARCHAR(64),
        metadata JSONB
    );
    CREATE INDEX IF NOT EXISTS idx_email_log_ts ON email_log (ts DESC);
    CREATE INDEX IF NOT EXISTS idx_email_log_template ON email_log (template, status);
    CREATE INDEX IF NOT EXISTS idx_email_log_to_hash ON email_log (to_hash);
    """
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def write_email_log(
    *,
    to_email: str,
    subject: str | None,
    template: str,
    status: str,
    provider: str,
    provider_id: str | None,
    latency_ms: int | None,
    error: str | None,
    metadata: dict | None,
    request_id: str | None,
) -> None:
    """Append a row to email_log. Best-effort; never raises."""
    import hashlib
    import json as _json

    try:
        to_hash = hashlib.sha256(
            (to_email or "").lower().encode("utf-8")
        ).hexdigest()[:32]
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO email_log (
                        to_hash, subject, template, status, provider,
                        provider_id, latency_ms, error, request_id, metadata
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    """,
                    (
                        to_hash,
                        (subject or "")[:255],
                        template,
                        status,
                        provider,
                        provider_id,
                        latency_ms,
                        (error or "")[:5000] if error else None,
                        request_id,
                        _json.dumps(metadata) if metadata is not None else None,
                    ),
                )
            conn.commit()
    except Exception as e:
        logger.warning("email_log write failed: %s", e)



def get_tenant_name(tenant_id: str) -> str | None:
    """Lookup just the company_name for a tenant. Used by email templates."""
    try:
        with get_db() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    "SELECT company_name FROM tenants WHERE id = %s",
                    (tenant_id,),
                )
                row = cur.fetchone()
                return row["company_name"] if row else None
    except Exception:
        return None


def get_user_display_name(supabase_auth_id: str) -> str | None:
    """Lookup display_name from user_profiles. Used as the inviter name."""
    try:
        with get_db() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    "SELECT display_name FROM user_profiles WHERE supabase_auth_id = %s",
                    (supabase_auth_id,),
                )
                row = cur.fetchone()
                return row["display_name"] if row and row["display_name"] else None
    except Exception:
        return None
