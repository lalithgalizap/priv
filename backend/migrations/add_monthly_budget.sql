-- Add monthly credit budget columns to tenants
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS monthly_credit_budget INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS monthly_credit_used INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_monthly_reset TIMESTAMPTZ DEFAULT NOW();

-- Set a reasonable default monthly budget for existing tenants (5M credits ≈ $500/mo)
UPDATE tenants SET monthly_credit_budget = 5000000 WHERE monthly_credit_budget = 0;
