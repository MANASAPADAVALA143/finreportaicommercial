"""Workspace management API — CRUD, dashboard, members, seed."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.middleware.workspace import WorkspaceContext, validate_workspace, require_workspace_role
from app.models.users import User, UserRole
from app.models.workspace import Workspace, WorkspaceMember, WorkspaceRole, WorkspaceVATSettings
from app.services.ap_company_sync import sync_ap_company_for_workspace
from app.services.workspace_service import (
    add_workspace_member,
    create_workspace,
    get_workspace_dashboard,
    list_user_workspaces,
    seed_abc_trading_workspace,
)

router = APIRouter(prefix="/api/workspaces", tags=["Workspaces"])


class WorkspaceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=256)
    legal_entity_name: str = Field(..., min_length=1, max_length=256)
    trn_number: str | None = None
    country: str = "UAE"
    currency: str = "AED"
    fiscal_year_start_month: int = Field(default=1, ge=1, le=12)
    fiscal_year_end_month: int = Field(default=12, ge=1, le=12)
    industry: str | None = None


class WorkspaceUpdate(BaseModel):
    name: str | None = None
    legal_entity_name: str | None = None
    trn_number: str | None = None
    country: str | None = None
    currency: str | None = None
    fiscal_year_start_month: int | None = Field(default=None, ge=1, le=12)
    fiscal_year_end_month: int | None = Field(default=None, ge=1, le=12)
    industry: str | None = None


class MemberAdd(BaseModel):
    user_id: str
    role: str = "accountant"


@router.get("")
def list_workspaces(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    is_super = str(user.role) in (UserRole.super_admin.value, UserRole.super_admin)
    workspaces = list_user_workspaces(db, user.id, is_super_admin=is_super)
    return {"workspaces": workspaces, "count": len(workspaces)}


@router.post("")
def create_new_workspace(
    body: WorkspaceCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    ws = create_workspace(
        db,
        name=body.name,
        legal_entity_name=body.legal_entity_name,
        trn_number=body.trn_number,
        country=body.country,
        currency=body.currency,
        fiscal_year_start_month=body.fiscal_year_start_month,
        fiscal_year_end_month=body.fiscal_year_end_month,
        industry=body.industry,
        owner_user_id=user.id,
    )
    ap_company = sync_ap_company_for_workspace(ws)
    payload: dict[str, Any] = {"workspace": _detail(ws, db), "message": "Workspace created with UAE Chart of Accounts"}
    if ap_company:
        payload["ap_company_id"] = ap_company.get("id")
    return payload


@router.get("/{workspace_id}")
def get_workspace(
    workspace_id: str,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if ctx.workspace_id != workspace_id:
        raise HTTPException(status_code=403, detail="Workspace mismatch")
    return {"workspace": _detail(ctx.workspace, db)}


@router.patch("/{workspace_id}")
def update_workspace(
    workspace_id: str,
    body: WorkspaceUpdate,
    ctx: WorkspaceContext = Depends(require_workspace_role(WorkspaceRole.owner, WorkspaceRole.finance_manager)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if ctx.workspace_id != workspace_id:
        raise HTTPException(status_code=403, detail="Workspace mismatch")
    ws = ctx.workspace
    for field, attr in [
        ("name", "name"), ("legal_entity_name", "legal_entity_name"), ("trn_number", "trn_number"),
        ("country", "country"), ("currency", "currency"), ("industry", "industry"),
        ("fiscal_year_start_month", "fiscal_year_start_month"), ("fiscal_year_end_month", "fiscal_year_end_month"),
    ]:
        val = getattr(body, field)
        if val is not None:
            setattr(ws, attr, val)
    db.commit()
    db.refresh(ws)
    return {"workspace": _detail(ws, db)}


@router.delete("/{workspace_id}")
def delete_workspace(
    workspace_id: str,
    ctx: WorkspaceContext = Depends(require_workspace_role(WorkspaceRole.owner)),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    if ctx.workspace_id != workspace_id:
        raise HTTPException(status_code=403, detail="Workspace mismatch")
    ctx.workspace.is_active = False
    db.commit()
    return {"message": "Workspace deactivated"}


@router.post("/{workspace_id}/sync-ap-company")
def sync_ap_company(
    workspace_id: str,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Link this workspace to a Supabase AP companies row (service role)."""
    if ctx.workspace_id != workspace_id:
        raise HTTPException(status_code=403, detail="Workspace mismatch")
    company = sync_ap_company_for_workspace(ctx.workspace)
    if not company:
        raise HTTPException(
            status_code=503,
            detail="Could not sync AP company. Check SUPABASE_URL/SUPABASE_KEY and run migrations/003_companies_workspace_id.sql",
        )
    return {"company": company, "company_id": company.get("id")}


@router.get("/{workspace_id}/dashboard")
def workspace_dashboard(
    workspace_id: str,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if ctx.workspace_id != workspace_id:
        raise HTTPException(status_code=403, detail="Workspace mismatch")
    return get_workspace_dashboard(db, workspace_id)


@router.get("/{workspace_id}/users")
def list_workspace_users(
    workspace_id: str,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if ctx.workspace_id != workspace_id:
        raise HTTPException(status_code=403, detail="Workspace mismatch")
    rows = (
        db.query(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .filter(WorkspaceMember.workspace_id == workspace_id)
        .all()
    )
    return {
        "members": [
            {
                "id": m.id,
                "user_id": u.id,
                "name": u.name,
                "email": u.email,
                "role": m.role.value if m.role else None,
            }
            for m, u in rows
        ]
    }


@router.post("/{workspace_id}/users")
def add_user_to_workspace(
    workspace_id: str,
    body: MemberAdd,
    ctx: WorkspaceContext = Depends(require_workspace_role(WorkspaceRole.owner, WorkspaceRole.finance_manager)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if ctx.workspace_id != workspace_id:
        raise HTTPException(status_code=403, detail="Workspace mismatch")
    try:
        role = WorkspaceRole(body.role)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid role: {body.role}") from exc
    member = add_workspace_member(db, workspace_id, body.user_id, role)
    return {"member_id": member.id, "role": member.role.value}


@router.post("/seed/abc-trading")
def seed_abc_trading(
    db: Session = Depends(get_db),
    user: User = Depends(require_role(UserRole.super_admin, UserRole.cfo)),
) -> dict[str, Any]:
    ws = seed_abc_trading_workspace(db, user)
    return {
        "workspace_id": ws.id,
        "name": ws.name,
        "message": "ABC Trading LLC seeded with 20 vendors, 10 customers, 50 AP, 25 AR, 200 JEs, 20 FA, 100 bank txs",
    }


def _detail(ws: Workspace, db: Session) -> dict[str, Any]:
    vat = db.query(WorkspaceVATSettings).filter_by(workspace_id=ws.id).first()
    return {
        "id": ws.id,
        "name": ws.name,
        "legal_entity_name": ws.legal_entity_name,
        "trn_number": ws.trn_number,
        "country": ws.country,
        "currency": ws.currency,
        "fiscal_year_start_month": ws.fiscal_year_start_month,
        "fiscal_year_end_month": ws.fiscal_year_end_month,
        "industry": ws.industry,
        "is_active": ws.is_active,
        "vat_settings": {
            "entity_type": vat.entity_type if vat else "mainland",
            "vat_registered": vat.vat_registered if vat else True,
            "standard_rate": vat.standard_rate if vat else "5",
            "filing_frequency": vat.filing_frequency if vat else "quarterly",
        } if vat else None,
        "created_at": ws.created_at.isoformat() if ws.created_at else None,
    }
