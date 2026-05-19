"""Promote a user by email to admin, owner, or superadmin."""
import os
import sys

import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set")
    sys.exit(1)


def promote(email: str, role: str | None = None, superadmin: bool = False):
    conn = psycopg2.connect(DATABASE_URL, sslmode="require")
    cur = conn.cursor()

    # Find user by email via Supabase auth is not directly queryable,
    # so we list users and you pick. For now we use supabase_auth_id.
    # Since we can't query auth.users easily, show all profiles:
    cur.execute(
        """
        SELECT id, supabase_auth_id, display_name, role, is_platform_admin
        FROM user_profiles
        ORDER BY created_at DESC
        """
    )
    rows = cur.fetchall()

    print("\nCurrent users:")
    print("-" * 80)
    for i, (pid, auth_id, name, r, is_sa) in enumerate(rows, 1):
        print(f"  {i}. {name or 'Unnamed'}  |  role={r}  |  superadmin={is_sa}  |  id={pid}")
    print("-" * 80)

    if not rows:
        print("No users found.")
        return

    pick = input("\nEnter number of user to promote: ").strip()
    try:
        idx = int(pick) - 1
        profile_id = rows[idx][0]
    except (ValueError, IndexError):
        print("Invalid selection.")
        return

    updates = []
    params = []
    if role:
        updates.append("role = %s")
        params.append(role)
    if superadmin:
        updates.append("is_platform_admin = TRUE")

    if not updates:
        print("Nothing to update. Use --role or --superadmin.")
        return

    sql = f"UPDATE user_profiles SET {', '.join(updates)} WHERE id = %s"
    params.append(profile_id)
    cur.execute(sql, tuple(params))
    conn.commit()
    print(f"\nUpdated user #{pick}.")

    cur.close()
    conn.close()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Promote a user")
    parser.add_argument("--role", choices=["owner", "admin", "member", "viewer"], help="Org role")
    parser.add_argument("--superadmin", action="store_true", help="Set as platform superadmin")
    args = parser.parse_args()

    promote(role=args.role, superadmin=args.superadmin)
