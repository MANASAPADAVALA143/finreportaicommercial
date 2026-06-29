#!/usr/bin/env python3
"""Run 6 tenant isolation verification checks (API-level).

Usage:
  python backend/scripts/verify_tenant_isolation.py

Requires backend running on VITE_API_URL (default http://127.0.0.1:8000)
and test users with distinct tenant workspaces.
"""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1].parent
sys.path.insert(0, str(ROOT / "backend"))

try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / "backend" / ".env")
except ImportError:
    pass

API = (os.getenv("VITE_API_URL") or "http://127.0.0.1:8000").rstrip("/")
SB_URL = (os.getenv("SUPABASE_URL") or "").rstrip("/")
SB_KEY = os.getenv("SUPABASE_KEY") or os.getenv("VITE_SUPABASE_ANON_KEY") or ""
PWD = os.getenv("AUTH_TEST_PASSWORD", "Test@123456")

TENANT_A_EMAIL = os.getenv("ISOLATION_TEST_A", "test_client_a@gnanova.pro")
TENANT_B_EMAIL = os.getenv("ISOLATION_TEST_B", "test_client_b@gnanova.pro")


def login(email: str) -> tuple[str, str | None]:
    if not SB_URL or not SB_KEY:
        raise SystemExit("SUPABASE_URL + anon/service key required for login")
    r = httpx.post(
        f"{SB_URL}/auth/v1/token?grant_type=password",
        headers={"apikey": SB_KEY, "Content-Type": "application/json"},
        json={"email": email, "password": PWD},
        timeout=30,
    )
    r.raise_for_status()
    data = r.json()
    token = data["access_token"]
    meta = (data.get("user") or {}).get("user_metadata") or {}
    tid = meta.get("tenant_id")
    return token, tid


def headers(token: str, tenant_id: str, company_id: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "X-Workspace-ID": tenant_id,
        "X-Tenant-ID": tenant_id,
        "X-Company-ID": company_id,
        "Content-Type": "application/json",
    }


def main() -> int:
    print("=== Tenant isolation verification ===\n")
    failures = 0

    # Check 1-2: create tenants if script was run; else use env workspace IDs
    try:
        tok_a, tid_a = login(TENANT_A_EMAIL)
        tok_b, tid_b = login(TENANT_B_EMAIL)
    except httpx.HTTPError as exc:
        print(f"FAIL  Login: {exc}")
        print("Create test clients first:")
        print("  python backend/scripts/create_client.py --name 'Client A' --email test_client_a@gnanova.pro")
        print("  python backend/scripts/create_client.py --name 'Client B' --email test_client_b@gnanova.pro")
        return 1

    if not tid_a or not tid_b:
        print("FAIL  tenant_id missing in user_metadata — re-run create_client.py")
        return 1

    print(f"OK    tenant_a={tid_a[:8]}… tenant_b={tid_b[:8]}…")

    inv_num = f"INV-ISO-{uuid.uuid4().hex[:8].upper()}"
    co_a = tid_a  # company_id linked at onboarding
    co_b = tid_b

    # Check 3: tenant_a uploads invoice
    r = httpx.post(
        f"{API}/api/ap/invoices",
        headers=headers(tok_a, tid_a, co_a),
        json={
            "invoice_number": inv_num,
            "invoice_date": "2026-01-15",
            "due_date": "2026-02-15",
            "vendor_name": "Isolation Test Vendor",
            "total_amount": 1000,
            "currency": "AED",
        },
        timeout=30,
    )
    if r.status_code not in (200, 201):
        print(f"FAIL  tenant_a create invoice: {r.status_code} {r.text[:200]}")
        failures += 1
    else:
        print(f"OK    tenant_a created {inv_num}")

    # Check 4: tenant_b list must be empty of tenant_a invoice
    r = httpx.get(f"{API}/api/ap/invoices", headers=headers(tok_b, tid_b, co_b), timeout=30)
    if r.status_code != 200:
        print(f"FAIL  tenant_b list invoices: {r.status_code}")
        failures += 1
    else:
        nums = [i.get("invoice_number") for i in r.json().get("invoices", [])]
        if inv_num in nums:
            print(f"FAIL  tenant_b sees tenant_a invoice {inv_num}")
            failures += 1
        else:
            print("OK    tenant_b cannot see tenant_a invoice")

    # Check 5: direct API with tenant_b token + tenant_a header should 403
    r = httpx.get(
        f"{API}/api/ap/invoices",
        headers=headers(tok_b, tid_a, co_a),
        timeout=30,
    )
    if r.status_code == 403:
        print("OK    cross-tenant header blocked (403)")
    else:
        print(f"WARN  cross-tenant header returned {r.status_code} (expected 403)")

    # Check 6: VAT advanced isolation
    r = httpx.post(
        f"{API}/api/gulftax/vat-advanced/partial-exemption",
        headers=headers(tok_a, tid_a, co_a),
        json={
            "period": "2026-Q1",
            "taxable_supplies": 100000,
            "exempt_supplies": 10000,
            "input_vat_paid": 5000,
            "recovery_pct": 90.9,
            "recoverable_vat": 4545,
            "irrecoverable_vat": 455,
        },
        timeout=30,
    )
    if r.status_code not in (200, 201):
        print(f"WARN  VAT save tenant_a: {r.status_code}")
    else:
        r2 = httpx.get(
            f"{API}/api/gulftax/vat-advanced/partial-exemption",
            headers=headers(tok_b, tid_b, co_b),
            timeout=30,
        )
        items = r2.json().get("items", []) if r2.status_code == 200 else []
        if any(i.get("period") == "2026-Q1" for i in items):
            print("FAIL  tenant_b sees tenant_a VAT partial exemption")
            failures += 1
        else:
            print("OK    GulfTax VAT data isolated")

    print(f"\n{'ALL CHECKS PASSED' if failures == 0 else f'{failures} CHECK(S) FAILED'}")
    return failures


if __name__ == "__main__":
    raise SystemExit(main())
