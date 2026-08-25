#!/usr/bin/env python3
"""One-time fix: give one account two properly-separated workspaces.

Problem this fixes:
  A single account's only workspace ("ABC Trading LLC") has country=UAE in
  the database even though the invoices under it are India GST data. The
  market toggle therefore thinks a UAE workspace already exists and never
  creates a real one, while India and UAE both point at the same mislabeled
  data.

What this script does:
  1. Logs in with the given email/password
  2. Finds the existing workspace and corrects its country/currency to match
     what it actually contains (India / INR) — pass --existing-market uae
     if it's actually UAE data mislabeled as something else instead
  3. Creates a brand-new, empty workspace for the OTHER market so the two
     are genuinely separate from here on

Usage:
  python scripts/fix_uae_india_workspaces.py \
    --email admin@gnanova.com --password Admin@123 \
    --existing-market india --existing-name "ABC Trading LLC"

Override the API URL:
  RBAC_API_URL=https://api.finreportai.com python scripts/fix_uae_india_workspaces.py ...
"""
from __future__ import annotations

import argparse
import os
import sys

try:
    import httpx
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "httpx"])
    import httpx

API_URL = os.getenv("RBAC_API_URL", "https://api.finreportai.com").rstrip("/")

MARKET_META = {
    "uae": {"country": "UAE", "currency": "AED"},
    "india": {"country": "India", "currency": "INR"},
}


def login(email: str, password: str) -> str:
    r = httpx.post(f"{API_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code >= 400:
        print(f"Login failed: {r.status_code} {r.text}")
        sys.exit(1)
    return r.json()["access_token"]


def list_workspaces(token: str) -> list[dict]:
    r = httpx.get(f"{API_URL}/api/workspaces", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    r.raise_for_status()
    return r.json().get("workspaces", [])


def fix_existing(token: str, ws_id: str, market: str) -> None:
    meta = MARKET_META[market]
    r = httpx.patch(
        f"{API_URL}/api/workspaces/{ws_id}",
        headers={"Authorization": f"Bearer {token}", "X-Workspace-ID": ws_id},
        json={"country": meta["country"], "currency": meta["currency"]},
        timeout=30,
    )
    if r.status_code >= 400:
        print(f"Failed to update existing workspace: {r.status_code} {r.text}")
        sys.exit(1)
    print(f"OK  corrected existing workspace -> country={meta['country']} currency={meta['currency']}")


def create_new(token: str, name: str, market: str) -> dict:
    meta = MARKET_META[market]
    r = httpx.post(
        f"{API_URL}/api/workspaces",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": name,
            "legal_entity_name": name,
            "country": meta["country"],
            "currency": meta["currency"],
        },
        timeout=30,
    )
    if r.status_code >= 400:
        print(f"Failed to create new workspace: {r.status_code} {r.text}")
        sys.exit(1)
    ws = r.json()["workspace"]
    print(f"OK  created new workspace '{name}' -> country={meta['country']} currency={meta['currency']} id={ws['id']}")
    return ws


def other_market(m: str) -> str:
    return "india" if m == "uae" else "uae"


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--email", required=True)
    p.add_argument("--password", required=True)
    p.add_argument("--existing-market", required=True, choices=["uae", "india"],
                    help="What the EXISTING workspace's data actually is (not what it's currently labeled)")
    p.add_argument("--existing-name", default=None, help="Only needed if the account has more than one workspace")
    p.add_argument("--new-name", default=None, help="Name for the new workspace (default: derived from existing)")
    args = p.parse_args()

    token = login(args.email, args.password)
    print(f"OK  logged in as {args.email}")

    workspaces = list_workspaces(token)
    if not workspaces:
        print("No workspaces found for this account — nothing to fix. Create one via the UI first.")
        return 1

    if len(workspaces) > 1 and not args.existing_name:
        print("Account has multiple workspaces — pass --existing-name to pick one:")
        for w in workspaces:
            print(f"  - {w['name']}  (country={w.get('country')}, id={w['id']})")
        return 1

    existing = (
        next((w for w in workspaces if w["name"] == args.existing_name), None)
        if args.existing_name
        else workspaces[0]
    )
    if not existing:
        print(f"No workspace named '{args.existing_name}' found.")
        return 1

    fix_existing(token, existing["id"], args.existing_market)

    new_market = other_market(args.existing_market)
    new_name = args.new_name or f"{existing['name']} ({new_market.upper()})"
    create_new(token, new_name, new_market)

    print("\nDone. Log out and back in (or hard refresh) — the two markets now point at genuinely separate workspaces.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
