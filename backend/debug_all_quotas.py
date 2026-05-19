"""Debug all quotas for a tenant. Pass tenant name or 'all' for every tenant."""
import os
import sys

import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set")
    sys.exit(1)

conn = psycopg2.connect(DATABASE_URL, sslmode="require")
cur = conn.cursor()

# Get all tenants with members
print("\n=== ALL ORGANIZATIONS & MEMBER QUOTAS ===\n")

cur.execute(
    """
    SELECT t.id,
           t.company_name,
           COALESCE(t.extra_token_pool, 0) AS extra_pool,
           COALESCE((SELECT SUM(total_tokens_used) FROM tenant_usage_metrics WHERE tenant_id = t.id), 0) as raw_used
    FROM tenants t
    ORDER BY t.company_name
    """
)

for tenant_id, name, extra_pool, org_raw in cur.fetchall():
    print(f"\n{'='*60}")
    print(f"ORG: {name}")
    print(f"  Extra token pool: {int(extra_pool):,} credits")
    print(f"  Lifetime usage:  {int(org_raw):,} tokens")

    cur.execute(
        """
        SELECT COALESCE(SUM(paid_credit_balance), 0) AS allocated,
               COALESCE(SUM(GREATEST(paid_credit_balance - paid_credit_used, 0)), 0) AS remaining
        FROM user_profiles
        WHERE tenant_id = %s
        """,
        (tenant_id,),
    )
    alloc_row = cur.fetchone() or (0, 0)
    print(f"  Paid credits allocated: {int(alloc_row[0]):,}")
    print(f"  Paid credits still with members: {int(alloc_row[1]):,}")

    # Members
    cur.execute(
        """
        SELECT display_name,
               supabase_auth_id,
               role,
               COALESCE(daily_budget, 50) AS daily_budget,
               COALESCE(daily_used, 0) AS daily_used,
               COALESCE(paid_credit_balance, 0) AS paid_allocated,
               COALESCE(paid_credit_used, 0) AS paid_used,
               COALESCE((SELECT SUM(total_tokens_used) FROM tenant_usage_metrics WHERE supabase_auth_id = p.supabase_auth_id), 0) AS lifetime_tokens
        FROM user_profiles p
        WHERE tenant_id = %s
        ORDER BY p.role, p.supabase_auth_id
        """,
        (tenant_id,),
    )

    for m_name, m_id, m_role, daily_budget, daily_used, paid_alloc, paid_used, lifetime in cur.fetchall():
        daily_remaining = max(daily_budget - daily_used, 0)
        paid_remaining = max(paid_alloc - paid_used, 0)
        print(
            "    {name} ({role}, {uid}): daily {used}/{budget} ({remain} left), paid {paid_used}/{paid_alloc} ({paid_rem} left), lifetime {life} tokens".format(
                name=m_name or "Unnamed",
                role=m_role,
                uid=m_id[:8] + "...",
                used=int(daily_used),
                budget=int(daily_budget),
                remain=int(daily_remaining),
                paid_used=int(paid_used),
                paid_alloc=int(paid_alloc),
                paid_rem=int(paid_remaining),
                life=int(lifetime),
            )
        )

cur.close()
conn.close()
