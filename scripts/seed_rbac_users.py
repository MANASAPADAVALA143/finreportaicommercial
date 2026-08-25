#!/usr/bin/env python3
"""Seed core users into the EC2 RBAC backend (rbac_users table).

Calls POST /api/auth/register for each user — safe to re-run,
existing emails are skipped (backend returns 400 "Email already registered").

Usage (from repo root):
  python scripts/seed_rbac_users.py

Override the API URL:
  RBAC_API_URL=https://api.finreportai.com python scripts/seed_rbac_users.py
"""
from __future__ import annotations

import os
import sys

try:
    import httpx
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "httpx"])
    import httpx

API_URL = os.getenv("RBAC_API_URL", "https://api.finreportai.com").rstrip("/")

# Users to create in rbac_users — edit passwords before running
USERS = [
    {
        "company_name": "Gnanova",
        "name": "Admin",
        "email": "admin@gnanova.com",
        "password": "Admin@123",   # ← change if needed
    },
    {
        "company_name": "Gnanova",
        "name": "Manasa",
        "email": "manasa@gnanova.pro",
        "password": "Admin@123",   # ← change if needed
    },
    {
        "company_name": "Gnanova Test",
        "name": "Test Full Access",
        "email": "test_full@gnanova.pro",
        "password": "Test@123456",
    },
    {
        "company_name": "Gnanova Test",
        "name": "Test India Client",
        "email": "test_india@gnanova.pro",
        "password": "Test@123456",
    },
    {
        "company_name": "Gnanova Test",
        "name": "Test UAE Client",
        "email": "test_uae@gnanova.pro",
        "password": "Test@123456",
    },
]


def main() -> int:
    print(f"Seeding RBAC users at {API_URL}\n")
    ok = 0
    skipped = 0
    failed = 0

    for user in USERS:
        try:
            r = httpx.post(
                f"{API_URL}/api/auth/register",
                json=user,
                timeout=30,
            )
            if r.status_code in (200, 201):
                print(f"OK      {user['email']}")
                ok += 1
            elif r.status_code == 400 and "already" in r.text.lower():
                print(f"SKIP    {user['email']}  (already registered)")
                skipped += 1
            else:
                print(f"FAIL    {user['email']}  [{r.status_code}] {r.text[:200]}")
                failed += 1
        except Exception as exc:
            print(f"ERROR   {user['email']}  {exc}")
            failed += 1

    print(f"\nDone — {ok} created, {skipped} skipped, {failed} failed")
    if failed:
        print("\nIf you see 'Cannot connect': confirm https://api.finreportai.com is reachable")
        print("If you see '401 Incorrect': the backend DB may be SQLite with no users — check DATABASE_URL on EC2")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
