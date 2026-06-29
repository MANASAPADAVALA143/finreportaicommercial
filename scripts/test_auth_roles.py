#!/usr/bin/env python3
"""Smoke-test Day-1 auth redirects and role path rules via Supabase login."""
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
    load_dotenv(ROOT / "frontend" / ".env")
    load_dotenv(ROOT / "frontend" / ".env.local")
except ImportError:
    pass

CASES = [
    ("test_uae@gnanova.pro", "uae_client", "/gulftax", ["/fpa", "/india-full"]),
    ("test_india@gnanova.pro", "india_client", "/dashboard", ["/gulftax", "/ap-invoices"]),
    ("test_full@gnanova.pro", "full_access", "/dashboard", []),
]
PASSWORD = os.getenv("AUTH_TEST_PASSWORD", "Test@123456")

# Mirror frontend productRole.ts
ROLE_PREFIXES: dict[str, list[str] | None] = {
    "uae_client": ["/ap-invoices", "/gulftax", "/ifrs/16"],
    "india_client": ["/india-full", "/fpa", "/ca-firm", "/dashboard"],
    "full_access": None,
}


def login(email: str) -> dict:
    url = (os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL") or "").strip().rstrip("/")
    anon = (os.getenv("SUPABASE_ANON_KEY") or os.getenv("VITE_SUPABASE_ANON_KEY") or "").strip()
    if not url or not anon:
        raise RuntimeError("Supabase URL/anon key not configured")

    resp = httpx.post(
        f"{url}/auth/v1/token?grant_type=password",
        headers={"apikey": anon, "Content-Type": "application/json"},
        json={"email": email, "password": PASSWORD},
        timeout=30,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Login failed for {email}: {resp.status_code} {resp.text}")
    data = resp.json()
    user = data.get("user") or {}
    meta = user.get("user_metadata") or {}
    return {
        "access_token": data["access_token"],
        "product_role": meta.get("product_role", "full_access"),
        "email": user.get("email"),
    }


def redirect_for(role: str) -> str:
    return {
        "uae_client": "/gulftax",
        "india_client": "/dashboard",
        "full_access": "/dashboard",
    }.get(role, "/dashboard")


def can_access(role: str, path: str) -> bool:
    prefixes = ROLE_PREFIXES.get(role)
    if prefixes is None:
        return True
    return any(path == p or path.startswith(f"{p}/") for p in prefixes)


def main() -> int:
    print("Day-1 auth smoke test\n" + "=" * 40)
    ok = True
    for email, expected_role, expected_redirect, blocked in CASES:
        try:
            sess = login(email)
            role = sess["product_role"]
            redir = redirect_for(role)
            print(f"\n{email}")
            print(f"  product_role: {role} (expected {expected_role})")
            print(f"  redirect:     {redir} (expected {expected_redirect})")
            if role != expected_role:
                print("  FAIL role mismatch")
                ok = False
            if redir != expected_redirect:
                print("  FAIL redirect mismatch")
                ok = False
            for path in blocked:
                if can_access(role, path):
                    print(f"  FAIL should NOT access {path}")
                    ok = False
                else:
                    print(f"  OK   blocked {path}")
            token = sess["access_token"][:20] + "..."
            print(f"  token: {token}")
        except Exception as exc:
            print(f"\n{email}\n  FAIL {exc}")
            ok = False
    print("\n" + ("ALL PASSED" if ok else "SOME TESTS FAILED"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
