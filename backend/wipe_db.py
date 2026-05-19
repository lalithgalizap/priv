"""Wipe all application data while preserving table schemas."""
import psycopg2
import os
import sys

# Load .env manually
env_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, val = line.split("=", 1)
                os.environ.setdefault(key, val)

DB_URL = os.getenv("DATABASE_URL", "")
if not DB_URL:
    print("DATABASE_URL not set")
    sys.exit(1)

# Order matters: children before parents to avoid FK violations
TABLES = [
    "chat_messages",
    "chat_sessions",
    "api_keys",
    "tenant_invites",
    "tenant_usage_metrics",
    "user_profiles",
    "tenants",
]

conn = psycopg2.connect(DB_URL)
cur = conn.cursor()

try:
    for table in TABLES:
        print(f"  TRUNCATE {table} ...")
        cur.execute(f'TRUNCATE TABLE "{table}" RESTART IDENTITY CASCADE;')
    conn.commit()
    print("All tables wiped successfully.")
except Exception as e:
    conn.rollback()
    print(f"Error: {e}")
finally:
    cur.close()
    conn.close()
