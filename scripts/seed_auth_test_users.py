#!/usr/bin/env python3
"""Create Day-1 auth test users in Supabase (no schema changes).

Requires in backend/.env or environment:
  SUPABASE_URL
  SUPABASE_KEY  (service role key)

Usage:
  python scripts/seed_auth_test_users.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / "backend" / ".env")
except ImportError:
    pass

USERS = [
    ("test_uae@gnanova.pro", "uae_client", "Test UAE Client"),
    ("test_india@gnanova.pro", "india_client", "Test India Client"),
    ("test_full@gnanova.pro", "full_access", "Test Full Access"),
]
PASSWORD = os.getenv("AUTH_TEST_PASSWORD", "Test@123456")


def main() -> int:
    url = (os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    key = (os.getenv("SUPABASE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not url or not key:
        print("Set SUPABASE_URL and SUPABASE_KEY (service role) in backend/.env")
        return 1

    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    for email, product_role, name in USERS:
        payload = {
            "email": email,
            "password": PASSWORD,
            "email_confirm": True,
            "user_metadata": {
                "full_name": name,
                "product_role": product_role,
                "role": "accountant",
            },
        }
        resp = httpx.post(f"{url}/auth/v1/admin/users", headers=headers, json=payload, timeout=30)
        if resp.status_code in (200, 201):
            print(f"OK  created/updated {email} -> {product_role}")
            continue
        if resp.status_code == 422 and "already" in resp.text.lower():
            # Update metadata on existing user
            list_resp = httpx.get(
                f"{url}/auth/v1/admin/users",
                headers=headers,
                params={"email": email},
                timeout=30,
            )
            users = list_resp.json().get("users") or []
            if not users:
                print(f"FAIL {email}: exists but could not list — {resp.text}")
                continue
            uid = users[0]["id"]
            upd = httpx.put(
                f"{url}/auth/v1/admin/users/{uid}",
                headers=headers,
                json={
                    "password": PASSWORD,
                    "user_metadata": {
                        "full_name": name,
                        "product_role": product_role,
                        "role": "accountant",
                    },
                },
                timeout=30,
            )
            if upd.status_code in (200, 201):
                print(f"OK  updated {email} -> {product_role}")
            else:
                print(f"FAIL update {email}: {upd.status_code} {upd.text}")
            continue
        print(f"FAIL {email}: {resp.status_code} {resp.text}")

    print(f"\nPassword for all test users: {PASSWORD}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
