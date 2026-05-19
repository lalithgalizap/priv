"""Promote lalithconnects@gmail.com to platform superadmin."""
import os
import sys

import requests
import psycopg2
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
DB_URL = os.getenv("DATABASE_URL", "")

if not all([SUPABASE_URL, SERVICE_KEY, DB_URL]):
    print("ERROR: Missing env vars (SUPABASE_URL, SUPABASE_SERVICE_KEY, DATABASE_URL)")
    sys.exit(1)

EMAIL = "lalithconnects@gmail.com"

# Step 1: Find user by email in Supabase Auth
headers = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"}
resp = requests.get(f"{SUPABASE_URL}/auth/v1/admin/users", headers=headers)
resp.raise_for_status()
users = resp.json().get("users", [])
target = next((u for u in users if u.get("email") == EMAIL), None)

if not target:
    print(f"User {EMAIL} not found in Supabase Auth.")
    sys.exit(1)

auth_id = target["id"]
print(f"Found user in Auth: {auth_id}")

# Step 2: Update or insert user_profiles
conn = psycopg2.connect(DB_URL, sslmode="require")
cur = conn.cursor()

# Check if profile exists
cur.execute("SELECT id FROM user_profiles WHERE supabase_auth_id = %s", (auth_id,))
row = cur.fetchone()

if row:
    cur.execute(
        "UPDATE user_profiles SET is_platform_admin = TRUE WHERE supabase_auth_id = %s",
        (auth_id,),
    )
    conn.commit()
    print(f"Updated existing profile. {EMAIL} is now superadmin.")
else:
    # Need default tenant
    cur.execute("SELECT id FROM tenants LIMIT 1")
    tenant = cur.fetchone()
    tenant_id = tenant[0] if tenant else "00000000-0000-0000-0000-000000000001"
    cur.execute(
        """
        INSERT INTO user_profiles (supabase_auth_id, tenant_id, display_name, role, is_platform_admin)
        VALUES (%s, %s, %s, %s, TRUE)
        """,
        (auth_id, tenant_id, EMAIL, "owner"),
    )
    conn.commit()
    print(f"Created profile and set superadmin for {EMAIL}.")

cur.close()
conn.close()
print("Done.")
