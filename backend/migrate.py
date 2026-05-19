"""Run schema migrations for new RBAC + API Keys tables."""
import os
import sys

import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set")
    sys.exit(1)

MIGRATIONS = [
    """
    ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'member'
    CHECK (role IN ('owner', 'admin', 'member', 'viewer'));
    """,
    """
    CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        created_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
        name VARCHAR(150) NOT NULL,
        key_hash VARCHAR(255) NOT NULL UNIQUE,
        key_preview VARCHAR(10) NOT NULL,
        scopes JSONB DEFAULT '["mediate", "analytics"]'::jsonb,
        expires_at TIMESTAMP WITH TIME ZONE,
        is_active BOOLEAN DEFAULT TRUE,
        last_used_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash);
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys (tenant_id, is_active);
    """,
    """
    ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN DEFAULT FALSE;
    """,
    """
    CREATE TABLE IF NOT EXISTS tenant_invites (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'member',
        invited_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
        token VARCHAR(255) NOT NULL UNIQUE,
        expires_at TIMESTAMP WITH TIME ZONE,
        used_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_invites_tenant ON tenant_invites (tenant_id, used_at);
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_invites_token ON tenant_invites (token);
    """,
    # Role simplification: owner/admin -> leader, viewer -> member
    """
    ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
    """,
    """
    UPDATE user_profiles SET role = 'leader' WHERE role IN ('owner', 'admin');
    """,
    """
    UPDATE user_profiles SET role = 'member' WHERE role = 'viewer';
    """,
    """
    ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
      CHECK (role IN ('superadmin', 'leader', 'member'));
    """,
    """
    ALTER TABLE tenant_invites DROP CONSTRAINT IF EXISTS tenant_invites_role_check;
    """,
    """
    UPDATE tenant_invites SET role = 'leader' WHERE role IN ('owner', 'admin');
    """,
    """
    UPDATE tenant_invites SET role = 'member' WHERE role = 'viewer';
    """,
    """
    ALTER TABLE tenant_invites ADD CONSTRAINT tenant_invites_role_check
      CHECK (role IN ('leader', 'member'));
    """,
    # Fix: platform admins should have role = 'superadmin' not 'leader'
    """
    UPDATE user_profiles SET role = 'superadmin' WHERE is_platform_admin = TRUE AND role != 'superadmin';
    """,
    # Chat sessions scoped to user (supabase_auth_id)
    """
    CREATE TABLE IF NOT EXISTS chat_sessions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        supabase_auth_id UUID NOT NULL,
        title VARCHAR(255) NOT NULL DEFAULT 'New Session',
        model_id VARCHAR(150) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions (supabase_auth_id, updated_at DESC);
    """,
    # Chat messages scoped to session
    """
    CREATE TABLE IF NOT EXISTS chat_messages (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages (session_id, created_at ASC);
    """,
    # Token quota limits
    """
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS token_limit BIGINT DEFAULT NULL;
    """,
    """
    ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS token_limit BIGINT DEFAULT NULL;
    """,
    """
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS token_baseline BIGINT DEFAULT 0;
    """,
    """
    ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS token_baseline BIGINT DEFAULT 0;
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_metrics_user ON tenant_usage_metrics (supabase_auth_id);
    """,
    # Daily budget system
    """
    ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS daily_budget BIGINT DEFAULT 50,
    ADD COLUMN IF NOT EXISTS daily_used BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_token_reset TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    """,
    """
    ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS extra_token_pool BIGINT DEFAULT 0;
    """,
    # Clean slate: wipe old token limits/baselines, set 50 daily for everyone
    """
    UPDATE user_profiles SET token_limit = NULL, token_baseline = 0, daily_budget = 50, daily_used = 0, last_token_reset = NOW();
    """,
    """
    UPDATE tenants SET token_limit = NULL, token_baseline = 0, extra_token_pool = 0;
    """,
    # Monthly org credit budget + overdraft approval
    """
    ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS monthly_credit_budget BIGINT DEFAULT 5000000,
    ADD COLUMN IF NOT EXISTS monthly_credit_used BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_monthly_reset TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    """,
    """
    ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS overdraft_approved BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS overdraft_used BIGINT DEFAULT 0;
    """,
    """
    ALTER TABLE tenant_usage_metrics
    ADD COLUMN IF NOT EXISTS credits_used BIGINT DEFAULT 0;
    """,
    """
    CREATE TABLE IF NOT EXISTS credit_ledger (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        entry_type VARCHAR(30) NOT NULL CHECK (entry_type IN ('topup', 'overdraft', 'adjustment')),
        credits BIGINT NOT NULL DEFAULT 0,
        unit_cost_cents BIGINT NOT NULL DEFAULT 0,
        note TEXT,
        created_by UUID,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_credit_ledger_tenant ON credit_ledger (tenant_id, created_at DESC);
    """,
    """
    CREATE TABLE IF NOT EXISTS credit_requests (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        requested_by UUID NOT NULL,
        amount BIGINT NOT NULL CHECK (amount > 0),
        reason TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
        resolution_note TEXT,
        resolved_by UUID,
        resolved_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_credit_requests_tenant ON credit_requests (tenant_id, status);
    """,
    # Cleanup legacy overdraft/monthly budget + credit request tables
    """
    ALTER TABLE tenants
    DROP COLUMN IF EXISTS monthly_credit_budget,
    DROP COLUMN IF EXISTS monthly_credit_used,
    DROP COLUMN IF EXISTS last_monthly_reset,
    DROP COLUMN IF EXISTS overdraft_approved,
    DROP COLUMN IF EXISTS overdraft_used;
    """,
    """
    DROP TABLE IF EXISTS credit_requests;
    """,
    """
    ALTER TABLE user_profiles
    RENAME COLUMN token_limit TO paid_credit_balance;
    """,
    """
    ALTER TABLE tenants
    RENAME COLUMN token_limit TO paid_credit_balance;
    """,
    """
    ALTER TABLE user_profiles
    RENAME COLUMN token_baseline TO paid_credit_used;
    """,
    """
    ALTER TABLE tenants
    RENAME COLUMN token_baseline TO paid_credit_used;
    """,
]


def run():
    conn = psycopg2.connect(DATABASE_URL, sslmode="require")
    cur = conn.cursor()
    for i, sql in enumerate(MIGRATIONS, 1):
        try:
            cur.execute(sql)
            conn.commit()
            print(f"  [{i}/{len(MIGRATIONS)}] OK")
        except Exception as e:
            conn.rollback()
            print(f"  [{i}/{len(MIGRATIONS)}] FAILED: {e}")
    cur.close()
    conn.close()
    print("\nMigration complete.")


if __name__ == "__main__":
    run()
