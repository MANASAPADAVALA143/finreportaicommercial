"""User management routes (super_admin)."""

from __future__ import annotations

from datetime import datetime
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.users import AuditLog, Company, User, UserRole
from app.services.auth_service import hash_password

router = APIRouter(prefix="/api/users", tags=["rbac-users"])

VALID_PRODUCT_ROLES = (
    "uae_client",
    "uae_full",
    "india_client",
    "india_full",
    "fpa_client",
    "full_access",
)


class CreateUserBody(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: UserRole


class UpdateUserBody(BaseModel):
    name: str | None = None
    role: UserRole | None = None
    product_role: str | None = None
    is_active: bool | None = None


def _to_dict(u: User) -> dict:
    role = u.role.value if hasattr(u.role, "value") else str(u.role)
    return {
        "id": u.id,
        "name": u.name,
        "email": u.email,
        "role": role,
        "product_role": getattr(u, "product_role", None) or "full_access",
        "is_active": bool(u.is_active),
        "created_at": u.created_at.isoformat() if u.created_at else None,
        "last_login": u.last_login.isoformat() if u.last_login else None,
    }


def _audit(db: Session, actor: User, action: str, details: dict, ip: str | None) -> None:
    db.add(
        AuditLog(
            id=str(uuid.uuid4()),
            user_id=actor.id,
            action=action,
            module="users",
            details=details,
            ip_address=ip,
        )
    )


@router.get("")
def list_users(
    _: User = Depends(require_role(UserRole.super_admin)),
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.query(User).filter(User.company_id == current.company_id).order_by(User.created_at.desc()).all()
    return {"items": [_to_dict(u) for u in rows]}


@router.post("")
def create_user(
    body: CreateUserBody,
    request: Request,
    _: User = Depends(require_role(UserRole.super_admin)),
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if db.query(User).filter(User.email == body.email.lower().strip()).first():
        raise HTTPException(status_code=400, detail="Email already exists")
    row = User(
        id=str(uuid.uuid4()),
        company_id=current.company_id,
        name=body.name.strip(),
        email=body.email.lower().strip(),
        password_hash=hash_password(body.password),
        role=body.role,
        is_active=True,
    )
    db.add(row)
    _audit(db, current, "create_user", {"target": row.email, "role": row.role.value}, request.client.host if request.client else None)
    db.commit()
    invite = f"Invite created for {row.email}"
    return {"user": _to_dict(row), "invite": invite}


@router.put("/{user_id}")
def update_user(
    user_id: str,
    body: UpdateUserBody,
    request: Request,
    _: User = Depends(require_role(UserRole.super_admin)),
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(User, user_id)
    if not row or row.company_id != current.company_id:
        raise HTTPException(status_code=404, detail="User not found")
    if body.name is not None:
        row.name = body.name.strip()
    if body.role is not None:
        row.role = body.role
    if body.product_role is not None:
        if body.product_role not in VALID_PRODUCT_ROLES:
            raise HTTPException(status_code=400, detail="Invalid product_role")
        row.product_role = body.product_role
    if body.is_active is not None:
        row.is_active = body.is_active
    db.add(row)
    _audit(db, current, "update_user", {"target": row.email}, request.client.host if request.client else None)
    db.commit()
    return {"user": _to_dict(row)}


@router.delete("/{user_id}")
def deactivate_user(
    user_id: str,
    request: Request,
    _: User = Depends(require_role(UserRole.super_admin)),
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(User, user_id)
    if not row or row.company_id != current.company_id:
        raise HTTPException(status_code=404, detail="User not found")
    row.is_active = False
    db.add(row)
    _audit(db, current, "deactivate_user", {"target": row.email}, request.client.host if request.client else None)
    db.commit()
    return {"status": "deactivated", "user_id": row.id}


@router.get("/audit-log")
def audit_log(
    user_id: str | None = Query(default=None),
    module: str | None = Query(default=None),
    from_ts: str | None = Query(default=None, alias="from"),
    to_ts: str | None = Query(default=None, alias="to"),
    _: User = Depends(require_role(UserRole.super_admin)),
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(AuditLog).join(User, User.id == AuditLog.user_id).filter(User.company_id == current.company_id)
    if user_id:
        q = q.filter(AuditLog.user_id == user_id)
    if module:
        q = q.filter(AuditLog.module == module)
    if from_ts:
        q = q.filter(AuditLog.timestamp >= datetime.fromisoformat(from_ts))
    if to_ts:
        q = q.filter(AuditLog.timestamp <= datetime.fromisoformat(to_ts))
    rows = q.order_by(AuditLog.timestamp.desc()).limit(500).all()
    return {
        "items": [
            {
                "id": r.id,
                "user_id": r.user_id,
                "action": r.action,
                "module": r.module,
                "details": r.details,
                "ip_address": r.ip_address,
                "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            }
            for r in rows
        ]
    }


@router.get("/company")
def company_info(
    current: User = Depends(get_current_user),
    _: User = Depends(require_role(UserRole.super_admin)),
    db: Session = Depends(get_db),
):
    company = db.get(Company, current.company_id)
    users_count = db.query(User).filter(User.company_id == current.company_id, User.is_active.is_(True)).count()
    return {
        "id": company.id if company else current.company_id,
        "name": company.name if company else "",
        "plan": company.plan if company else "starter",
        "users_count": users_count,
    }
