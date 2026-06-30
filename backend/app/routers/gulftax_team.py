"""GulfTax team invites — email invite with Admin/Viewer roles."""

from __future__ import annotations

import os
import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.users import AuditLog, User, UserRole
from app.services.auth_service import hash_password

router = APIRouter(prefix="/api/gulftax/team", tags=["GulfTax Team"])


class TeamInviteBody(BaseModel):
    email: EmailStr
    role: str  # admin | viewer


def _map_role(role: str) -> UserRole:
    if role == "admin":
        return UserRole.cfo
    if role == "viewer":
        return UserRole.auditor
    raise HTTPException(400, detail="role must be admin or viewer")


def _display_role(role: UserRole) -> str:
    if role == UserRole.cfo:
        return "admin"
    if role == UserRole.auditor:
        return "viewer"
    return role.value if hasattr(role, "value") else str(role)


@router.get("/members")
def list_members(
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.query(User).filter(User.company_id == current.company_id, User.is_active.is_(True)).all()
    return {
        "items": [
            {
                "id": u.id,
                "email": u.email,
                "name": u.name,
                "role": u.role.value if hasattr(u.role, "value") else str(u.role),
                "display_role": _display_role(u.role),
                "product_role": getattr(u, "product_role", None) or "full_access",
            }
            for u in rows
        ]
    }


@router.post("/invite")
def invite_member(
    body: TeamInviteBody,
    current: User = Depends(require_role(UserRole.super_admin, UserRole.cfo)),
    db: Session = Depends(get_db),
):
    email = body.email.lower().strip()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(400, detail="User already exists — they can sign in directly")

    temp_password = secrets.token_urlsafe(12)
    rbac_role = _map_role(body.role)
    row = User(
        id=str(uuid.uuid4()),
        company_id=current.company_id,
        name=email.split("@")[0],
        email=email,
        password_hash=hash_password(temp_password),
        role=rbac_role,
        product_role="uae_client",
        is_active=True,
    )
    db.add(row)
    db.add(
        AuditLog(
            id=str(uuid.uuid4()),
            user_id=current.id,
            action="gulftax_team_invite",
            module="gulftax",
            details={"email": email, "role": body.role},
            ip_address=None,
        )
    )
    db.commit()

    supabase_invited = False
    supabase_url = os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if supabase_url and service_key:
        try:
            import httpx

            with httpx.Client(timeout=15.0) as client:
                r = client.post(
                    f"{supabase_url.rstrip('/')}/auth/v1/invite",
                    headers={
                        "apikey": service_key,
                        "Authorization": f"Bearer {service_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "email": email,
                        "data": {"gulftax_role": body.role},
                        "redirect_to": os.getenv(
                            "FRONTEND_URL", "http://localhost:5173"
                        ).rstrip("/")
                        + "/gulftax/settings",
                    },
                )
                supabase_invited = r.status_code < 300
        except Exception:
            supabase_invited = False

    return {
        "status": "invited",
        "email": email,
        "role": body.role,
        "supabase_invite_sent": supabase_invited,
        "message": (
            f"Invite sent to {email} via Supabase auth"
            if supabase_invited
            else f"User created — share temporary password with {email} (reset on first login)"
        ),
        "temp_password": None if supabase_invited else temp_password,
    }
