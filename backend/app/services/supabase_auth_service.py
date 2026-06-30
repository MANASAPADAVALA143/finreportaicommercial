"""Verify Supabase JWTs and bridge users into RBAC tables for workspace APIs."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.users import Company, User, UserRole
from app.services.auth_service import hash_password


def verify_supabase_token(token: str) -> dict[str, Any]:
    """Validate a Supabase access token via the Auth REST API."""
    url = (settings.SUPABASE_URL or "").strip().rstrip("/")
    key = (settings.SUPABASE_KEY or "").strip()
    if not url or not key:
        raise ValueError("Supabase is not configured")

    resp = httpx.get(
        f"{url}/auth/v1/user",
        headers={"Authorization": f"Bearer {token}", "apikey": key},
        timeout=8,
    )
    if resp.status_code != 200:
        raise ValueError("Invalid or expired token")
    return resp.json()


def tenant_id_from_supabase(sb_user: dict[str, Any]) -> str | None:
    meta = sb_user.get("user_metadata") or {}
    app_meta = sb_user.get("app_metadata") or {}
    tid = meta.get("tenant_id") or app_meta.get("tenant_id")
    return str(tid).strip() if tid else None


def product_role_from_supabase(sb_user: dict[str, Any]) -> str:
    meta = sb_user.get("user_metadata") or {}
    app_meta = sb_user.get("app_metadata") or {}
    return str(meta.get("product_role") or app_meta.get("product_role") or "full_access")


def internal_role_from_supabase(sb_user: dict[str, Any]) -> str:
    meta = sb_user.get("user_metadata") or {}
    app_meta = sb_user.get("app_metadata") or {}
    return str(meta.get("role") or app_meta.get("role") or "accountant")


def ensure_rbac_user(db: Session, sb_user: dict[str, Any]) -> User:
    """Ensure a local RBAC user row exists for a Supabase-authenticated user."""
    uid = str(sb_user.get("id") or "")
    email = str(sb_user.get("email") or "").lower().strip()
    if not uid or not email:
        raise ValueError("Invalid Supabase user payload")

    user = db.get(User, uid)
    if not user:
        user = db.query(User).filter(User.email == email).first()

    meta = sb_user.get("user_metadata") or {}
    product_role = product_role_from_supabase(sb_user)
    name = str(meta.get("full_name") or meta.get("name") or email.split("@")[0])
    internal_role_name = internal_role_from_supabase(sb_user)

    try:
        internal_role = UserRole(internal_role_name)
    except ValueError:
        internal_role = UserRole.accountant

    tid = tenant_id_from_supabase(sb_user)

    if user:
        user.product_role = product_role
        user.name = name or user.name
        if tid:
            user.tenant_id = tid
        user.last_login = datetime.utcnow()
        db.commit()
        db.refresh(user)
        return user

    company = Company(
        id=str(uuid.uuid4()),
        name=str(meta.get("company") or "My Company"),
        plan="starter",
    )
    user = User(
        id=uid,
        company_id=company.id,
        tenant_id=tid,
        name=name,
        email=email,
        password_hash=hash_password(str(uuid.uuid4())),
        role=internal_role,
        product_role=product_role,
        is_active=True,
        last_login=datetime.utcnow(),
    )
    db.add(company)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
