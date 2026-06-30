#!/usr/bin/env python3
"""Test backend API accepts Supabase JWT and enforces product roles."""
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

API = os.getenv("VITE_API_URL") or "http://127.0.0.1:8000"
URL = (os.getenv("SUPABASE_URL") or "").rstrip("/")
ANON = os.getenv("SUPABASE_ANON_KEY") or os.getenv("VITE_SUPABASE_ANON_KEY") or ""
PWD = os.getenv("AUTH_TEST_PASSWORD", "Test@123456")

CASES = [
    ("test_uae@gnanova.pro", "/api/fpa/variance", 403),
    ("test_india@gnanova.pro", "/api/gulftax/status", 403),
    ("test_full@gnanova.pro", "/api/gulftax/status", 200),
]


def login(email: str) -> str:
    resp = httpx.post(
        f"{URL}/auth/v1/token?grant_type=password",
        headers={"apikey": ANON, "Content-Type": "application/json"},
        json={"email": email, "password": PWD},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def main() -> int:
    ok = True
    for email, path, expect in CASES:
        token = login(email)
        ws = httpx.get(
            f"{API}/api/workspaces",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        print(f"{email}: workspaces={ws.status_code}")
        resp = httpx.get(
            f"{API}{path}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        passed = resp.status_code == expect
        print(f"  {path} -> {resp.status_code} (expect {expect}) {'OK' if passed else 'FAIL'}")
        ok = ok and passed
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
