"""Debug token quota for a specific user."""
import os
import sys

import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set")
    sys.exit(1)

# Ask for user email or ID
email = input("Enter user email (or Supabase auth ID): ").strip()

conn = psycopg2.connect(DATABASE_URL, sslmode="require")
cur = conn.cursor()

# Find user
if "@" in email:
    cur.execute(
        "SELECT supabase_auth_id, tenant_id, display_name, daily_budget, daily_used, paid_credit_balance, paid_credit_used FROM user_profiles WHERE email = %s",
        (email,),
    )
else:
    cur.execute(
        "SELECT supabase_auth_id, tenant_id, display_name, daily_budget, daily_used, paid_credit_balance, paid_credit_used FROM user_profiles WHERE supabase_auth_id = %s",
        (email,),
    )

row = cur.fetchone()
if not row:
    print(f"User not found: {email}")
    sys.exit(1)

user_id, tenant_id, display_name, daily_budget, daily_used, paid_alloc, paid_used = row
daily_budget = int(daily_budget or 50)
daily_used = int(daily_used or 0)
paid_alloc = int(paid_alloc or 0)
paid_used = int(paid_used or 0)

# Get raw usage
cur.execute("SELECT COALESCE(SUM(total_tokens_used), 0) FROM tenant_usage_metrics WHERE supabase_auth_id = %s", (user_id,))
raw_used = int(cur.fetchone()[0])

# Get org info
cur.execute("SELECT company_name, COALESCE(extra_token_pool, 0) FROM tenants WHERE id = %s", (tenant_id,))
org_row = cur.fetchone()
org_name, extra_pool = org_row

# Get org raw usage
cur.execute("SELECT COALESCE(SUM(total_tokens_used), 0) FROM tenant_usage_metrics WHERE tenant_id = %s", (tenant_id,))
org_raw_used = int(cur.fetchone()[0])

daily_remaining = max(daily_budget - daily_used, 0)
paid_remaining = max(paid_alloc - paid_used, 0)

print(f"\n=== USER: {display_name or email} ===")
print(f"  User ID: {user_id}")
print(f"  Daily quota: {daily_used:,}/{daily_budget:,} (remaining {daily_remaining:,})")
print(f"  Paid credits: {paid_used:,}/{paid_alloc:,} (remaining {paid_remaining:,})")
print(f"  Lifetime usage (tokens): {raw_used:,}")

print(f"\n=== ORG: {org_name} ===")
print(f"  Extra token pool: {int(extra_pool):,}")
print(f"  Lifetime usage (tokens): {org_raw_used:,}")

# Show member allocations
print(f"\n=== MEMBERS IN ORG ===")
cur.execute(
    "SELECT display_name, email, daily_budget, daily_used, paid_credit_balance, paid_credit_used FROM user_profiles WHERE tenant_id = %s ORDER BY role, email",
    (tenant_id,),
)
for name, email_addr, d_budget, d_used, alloc, used in cur.fetchall():
    d_budget = int(d_budget or 50)
    d_used = int(d_used or 0)
    alloc = int(alloc or 0)
    used = int(used or 0)
    print(
        "  {label}: daily {used}/{budget} (rem {rem}), paid {used_paid}/{alloc} (rem {rem_paid})".format(
            label=f"{name or 'Unnamed'} ({email_addr or 'no-email'})",
            used=d_used,
            budget=d_budget,
            rem=max(d_budget - d_used, 0),
            used_paid=used,
            alloc=alloc,
            rem_paid=max(alloc - used, 0),
        )
    )

cur.close()
conn.close()
