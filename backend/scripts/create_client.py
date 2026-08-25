#!/usr/bin/env python3
"""Onboard a new production client — tenant in RDS + Supabase auth only.

Usage:
  python backend/scripts/create_client.py \\
    --name "Al Noor Real Estate LLC" \\
    --email finance@alnoor.ae \\
    --role uae_client \\
    --plan uae_finance_suite

  # User already created in Supabase dashboard — RDS records only:
  python backend/scripts/create_client.py \\
    --name "Gnanova Pro" \\
    --email manusmile0587@gmail.com \\
    --role uae_suite \\
    --plan uae_finance_suite_full \\
    --skip-supabase \\
    --user-id <supabase-auth-uuid>

Requires backend/.env: DATABASE_URL; SUPABASE_URL + SUPABASE_KEY unless --skip-supabase.
"""
from __future__ import annotations

import argparse
import os
import secrets
import sys
import uuid
from datetime import datetime
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1].parent
sys.path.insert(0, str(ROOT / "backend"))

try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / "backend" / ".env")
except ImportError:
    pass

from app.core.database import SessionLocal
from app.models.client_data import ApCompany, Tenant
from app.models.workspace import Workspace, WorkspaceMember, WorkspaceRole, WorkspaceVATSettings
from app.models.users import Company, User, UserRole
from app.services.auth_service import hash_password


def _supabase_admin_headers() -> tuple[str, dict]:
    url = (os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    key = (os.getenv("SUPABASE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not url or not key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_KEY (service role) in backend/.env")
    return url, {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def create_supabase_user(url: str, headers: dict, email: str, password: str, metadata: dict) -> str:
    payload = {
        "email": email,
        "password": password,
        "email_confirm": True,
        "user_metadata": metadata,
    }
    resp = httpx.post(f"{url}/auth/v1/admin/users", headers=headers, json=payload, timeout=30)
    if resp.status_code in (200, 201):
        return str(resp.json().get("id") or resp.json().get("user", {}).get("id"))
    if resp.status_code == 422 and "already" in resp.text.lower():
        listed = httpx.get(f"{url}/auth/v1/admin/users", headers=headers, params={"email": email}, timeout=30)
        users = listed.json().get("users") or []
        if not users:
            raise SystemExit(f"User exists but could not fetch: {resp.text}")
        uid = users[0]["id"]
        httpx.put(
            f"{url}/auth/v1/admin/users/{uid}",
            headers=headers,
            json={"password": password, "user_metadata": metadata},
            timeout=30,
        )
        return str(uid)
    raise SystemExit(f"Supabase user create failed: {resp.status_code} {resp.text}")


def _lookup_supabase_user_id(url: str, headers: dict, email: str) -> str | None:
    resp = httpx.get(f"{url}/auth/v1/admin/users", headers=headers, params={"email": email}, timeout=30)
    if resp.status_code != 200:
        return None
    users = resp.json().get("users") or []
    return str(users[0]["id"]) if users else None


def main() -> int:
    parser = argparse.ArgumentParser(description="Create production client tenant + auth user")
    parser.add_argument("--name", required=True, help="Legal entity name")
    parser.add_argument("--email", required=True, help="Login email")
    parser.add_argument("--role", default="uae_client", help="product_role metadata")
    parser.add_argument("--plan", default="starter", help="Subscription plan")
    parser.add_argument("--password", default="", help="Optional password (generated if empty)")
    parser.add_argument(
        "--skip-supabase",
        action="store_true",
        help="Skip Supabase user creation (user already exists in dashboard); RDS records only",
    )
    parser.add_argument(
        "--user-id",
        default="",
        help="Supabase auth user UUID (required with --skip-supabase if admin lookup fails)",
    )
    args = parser.parse_args()

    email = args.email.lower().strip()
    password = args.password or secrets.token_urlsafe(12) + "A1!"
    tenant_id = str(uuid.uuid4())
    company_id = str(uuid.uuid4())
    slug = args.name.lower().replace(" ", "-")[:48]
    user_metadata = {
        "full_name": args.name,
        "product_role": args.role,
        "role": "accountant",
        "tenant_id": tenant_id,
        "company_id": company_id,
    }

    db = SessionLocal()
    try:
        tenant = Tenant(id=tenant_id, name=args.name, plan=args.plan, is_demo=False)
        ws = Workspace(
            id=tenant_id,
            name=args.name,
            legal_entity_name=args.name,
            country="UAE",
            currency="AED",
        )
        ap_co = ApCompany(id=company_id, tenant_id=tenant_id, name=args.name, slug=slug)
        rbac_co = Company(id=company_id, name=args.name, plan=args.plan)
        vat = WorkspaceVATSettings(workspace_id=tenant_id)

        db.add(tenant)
        db.add(ws)
        db.add(ap_co)
        db.add(rbac_co)
        db.add(vat)
        db.commit()
    finally:
        db.close()

    if args.skip_supabase:
        uid = (args.user_id or "").strip()
        if not uid:
            sb_url, sb_headers = _supabase_admin_headers()
            uid = _lookup_supabase_user_id(sb_url, sb_headers, email) or ""
        if not uid:
            raise SystemExit(
                "With --skip-supabase, pass --user-id (Supabase auth UUID from Authentication → Users)."
            )
        password_hash = hash_password(args.password or secrets.token_urlsafe(32))
    else:
        sb_url, sb_headers = _supabase_admin_headers()
        uid = create_supabase_user(sb_url, sb_headers, email, password, user_metadata)
        password_hash = hash_password(password)

    db = SessionLocal()
    try:
        user = User(
            id=uid,
            company_id=company_id,
            tenant_id=tenant_id,
            name=args.name,
            email=email,
            password_hash=password_hash,
            role=UserRole.accountant,
            product_role=args.role,
            is_active=True,
            last_login=datetime.utcnow(),
        )
        member = WorkspaceMember(workspace_id=tenant_id, user_id=uid, role=WorkspaceRole.owner)
        db.add(user)
        db.add(member)
        db.commit()
    finally:
        db.close()

    print("OK — client created")
    print(f"  tenant_id:  {tenant_id}")
    print(f"  company_id: {company_id}")
    print(f"  user_id:    {uid}")
    print(f"  email:      {args.email}")
    print(f"  role:       {args.role}")
    if args.skip_supabase:
        print("\nSupabase user was not created/updated. Set user_metadata in Supabase dashboard:")
        print(f"  {user_metadata}")
    else:
        print(f"  password:   {password}")
        print("\nSend welcome email with login URL and credentials (not stored in logs).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
