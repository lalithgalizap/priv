"""Reset all token quota and usage data from the database."""
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

print("Resetting token data...")

try:
    # 1. Truncate all usage metrics (historical API call data)
    cur.execute("TRUNCATE TABLE tenant_usage_metrics;")
    print("  - Truncated tenant_usage_metrics")

    # 2. Reset org-level paid pools
    cur.execute("UPDATE tenants SET extra_token_pool = 0;")
    print("  - Reset tenants extra_token_pool to 0")

    # 3. Reset user allocations/usage
    cur.execute(
        "UPDATE user_profiles SET paid_credit_balance = 0, paid_credit_used = 0, daily_used = 0, last_token_reset = NOW();"
    )
    print("  - Reset user paid credits and daily usage (daily budgets remain at configured values)")

    conn.commit()
    print("\nAll credit usage data cleared successfully.")
    print("  Org pools + member allocations have been zeroed out. Daily budgets remain at their configured defaults.")

except Exception as e:
    conn.rollback()
    print(f"\nFAILED: {e}")
    sys.exit(1)
finally:
    cur.close()
    conn.close()
