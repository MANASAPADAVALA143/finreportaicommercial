#!/usr/bin/env python3
"""Onboard a new production client — tenant in RDS + Supabase auth only.

Usage:
  python backend/scripts/create_client.py \\
    --name "Al Noor Real Estate LLC" \\
    --email finance@alnoor.ae \\
    --role uae_client \\
    --plan uae_finance_suite

Requires backend/.env: DATABASE_URL, SUPABASE_URL, SUPABASE_KEY (service role).
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Create production client tenant + auth user")
    parser.add_argument("--name", required=True, help="Legal entity name")
    parser.add_argument("--email", required=True, help="Login email")
    parser.add_argument("--role", default="uae_client", help="product_role metadata")
    parser.add_argument("--plan", default="starter", help="Subscription plan")
    parser.add_argument("--password", default="", help="Optional password (generated if empty)")
    args = parser.parse_args()

    password = args.password or secrets.token_urlsafe(12) + "A1!"
    tenant_id = str(uuid.uuid4())
    company_id = str(uuid.uuid4())
    slug = args.name.lower().replace(" ", "-")[:48]

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

    sb_url, sb_headers = _supabase_admin_headers()
    uid = create_supabase_user(
        sb_url,
        sb_headers,
        args.email.lower().strip(),
        password,
        {
            "full_name": args.name,
            "product_role": args.role,
            "role": "accountant",
            "tenant_id": tenant_id,
            "company_id": company_id,
        },
    )

    db = SessionLocal()
    try:
        user = User(
            id=uid,
            company_id=company_id,
            tenant_id=tenant_id,
            name=args.name,
            email=args.email.lower().strip(),
            password_hash=hash_password(password),
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
    print(f"  email:      {args.email}")
    print(f"  password:   {password}")
    print(f"  role:       {args.role}")
    print("\nSend welcome email with login URL and credentials (not stored in logs).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
