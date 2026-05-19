"""Create a superadmin user in Supabase Auth + user_profiles."""
import os
import sys
import requests
import psycopg2

# Load .env
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

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
DB_URL = os.getenv("DATABASE_URL", "")
EMAIL = "lalithconnects@gmail.com"
PASSWORD = "Admin123!"  # Change after first login

if not SUPABASE_URL or not SERVICE_KEY or not DB_URL:
    print("Missing env vars")
    sys.exit(1)

# 1. Create user in Supabase Auth
auth_url = f"{SUPABASE_URL}/auth/v1/admin/users"
headers = {
    "Authorization": f"Bearer {SERVICE_KEY}",
    "apikey": SERVICE_KEY,
    "Content-Type": "application/json",
}
payload = {
    "email": EMAIL,
    "password": PASSWORD,
    "email_confirm": True,
    "app_metadata": {"role": "superadmin"},
}

print(f"Creating Supabase Auth user: {EMAIL}")
resp = requests.post(auth_url, headers=headers, json=payload)
if resp.status_code == 201:
    user = resp.json()
    auth_id = user["id"]
    print(f"  Auth user created: {auth_id}")
elif resp.status_code == 422 and "already been registered" in resp.text:
    # User exists — fetch them
    print("  User already exists, fetching...")
    list_resp = requests.get(f"{auth_url}?email={EMAIL}", headers=headers)
    if list_resp.status_code == 200:
        users = list_resp.json().get("users", [])
        if users:
            auth_id = users[0]["id"]
            print(f"  Found existing user: {auth_id}")
        else:
            print("  Could not find existing user")
            sys.exit(1)
    else:
        print(f"  List failed: {list_resp.status_code} {list_resp.text}")
        sys.exit(1)
else:
    print(f"  Auth create failed: {resp.status_code} {resp.text}")
    sys.exit(1)

# 2. Ensure default tenant exists + create profile
conn = psycopg2.connect(DB_URL)
cur = conn.cursor()

try:
    # Ensure default tenant
    DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001"
    cur.execute(
        """
        INSERT INTO tenants (id, company_name, tier)
        VALUES (%s, 'Default Corp', 'free')
        ON CONFLICT (id) DO NOTHING
        """,
        (DEFAULT_TENANT_ID,),
    )
    conn.commit()

    # Upsert user_profiles as superadmin
    cur.execute(
        """
        INSERT INTO user_profiles
          (supabase_auth_id, tenant_id, display_name, role, is_platform_admin)
        VALUES
          (%s, %s, %s, 'superadmin', TRUE)
        ON CONFLICT (supabase_auth_id) DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          role = EXCLUDED.role,
          is_platform_admin = EXCLUDED.is_platform_admin
        """,
        (auth_id, DEFAULT_TENANT_ID, EMAIL.split("@")[0]),
    )
    conn.commit()
    print(f"  Profile upserted as superadmin")
    print("\nDone!")
    print(f"  Email:    {EMAIL}")
    print(f"  Password: {PASSWORD}")
    print(f"  Role:     superadmin")
    print(f"  Tenant:   {DEFAULT_TENANT_ID}")
except Exception as e:
    conn.rollback()
    print(f"DB error: {e}")
finally:
    cur.close()
    conn.close()
