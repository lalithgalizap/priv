-- Anonymizer Core Database Schema
-- PostgreSQL / Supabase

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tenants (organizations)
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name VARCHAR(255) NOT NULL UNIQUE,
    tier VARCHAR(50) DEFAULT 'free',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);

-- User profiles (linked to Supabase Auth)
CREATE TABLE user_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supabase_auth_id UUID UNIQUE NOT NULL,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    display_name VARCHAR(150),
    role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- API Keys for programmatic access (scoped to tenant)
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    name VARCHAR(150) NOT NULL,
    key_hash VARCHAR(255) NOT NULL UNIQUE,
    key_preview VARCHAR(10) NOT NULL, -- e.g., "ak_...abcd"
    scopes JSONB DEFAULT '["mediate", "analytics"]'::jsonb,
    expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_api_keys_hash ON api_keys (key_hash);
CREATE INDEX idx_api_keys_tenant ON api_keys (tenant_id, is_active);

-- Usage metrics (no plain text stored)
CREATE TABLE tenant_usage_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    supabase_auth_id UUID NOT NULL,
    model_identifier VARCHAR(100) NOT NULL,
    input_tokens_used INT NOT NULL,
    output_tokens_used INT NOT NULL,
    total_tokens_used INT NOT NULL,
    execution_duration_ms INT NOT NULL,
    api_call_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for efficient querying by tenant and date
CREATE INDEX idx_metrics_tenant_date ON tenant_usage_metrics (tenant_id, api_call_timestamp DESC);

-- Sample tenant (for local development)
INSERT INTO tenants (company_name, tier) VALUES
    ('Default Corp', 'free')
ON CONFLICT (company_name) DO NOTHING;
