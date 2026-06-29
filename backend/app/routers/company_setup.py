"""Company onboarding wizard API."""

from __future__ import annotations

import os
import uuid
from datetime import date
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.services import company_setup_service as svc

router = APIRouter(prefix="/api/company-setup", tags=["Company Setup"])

_LOGO_DIR = Path(__file__).resolve().parent.parent.parent / "uploads" / "logos"
_LOGO_DIR.mkdir(parents=True, exist_ok=True)


class ProfileStep(BaseModel):
    company_name: str = Field(..., min_length=1)
    trade_name: str | None = None
    legal_type: str | None = None
    trn: str | None = None
    license_number: str | None = None
    license_authority: str | None = None
    base_currency: str = "AED"
    reporting_standard: str = "IFRS"
    financial_year_start: int = Field(default=1, ge=1, le=12)
    industry: str | None = None
    address: str | None = None
    phone: str | None = None
    email: str | None = None
    website: str | None = None
    logo_url: str | None = None


class CoaStep(BaseModel):
    option: str = Field(..., pattern="^(default|csv|blank)$")
    csv_content: str | None = None


class OpeningBalanceLine(BaseModel):
    account_code: str
    account_name: str = ""
    debit: float = 0
    credit: float = 0
    prior_year: float | None = None
    description: str | None = None


class OpeningBalancesStep(BaseModel):
    opening_date: date
    lines: list[OpeningBalanceLine]


class ControlsStep(BaseModel):
    je_approval_threshold_aed: float | None = None
    allow_backdating: bool = True
    max_backdate_days: int = 30
    require_docs_account_ids: list[str] = []
    dual_approval_account_ids: list[str] = []


class RoleAssignment(BaseModel):
    user_id: str
    module: str
    role: str


class RolesStep(BaseModel):
    assignments: list[RoleAssignment]


class AccountUpsert(BaseModel):
    code: str
    name: str
    account_type: str = "Expense"
    sub_type: str = ""
    currency: str = "AED"
    is_active: bool = True


def _handle_value_error(e: ValueError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(e))


@router.get("/status")
def setup_status(
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return svc.get_setup_status(db, ctx.workspace_id)


@router.get("/companies")
def list_companies(
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    companies = svc.list_active_companies(db, ctx.workspace_id)
    return {"companies": companies, "count": len(companies)}


@router.get("/periods")
def list_accounting_periods(
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    from app.services.consolidation_service import list_periods
    return {"periods": list_periods(db, ctx.workspace_id)}


@router.get("/profile")
def get_profile(
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    status = svc.get_setup_status(db, ctx.workspace_id)
    profile = status.get("draft_company") or status.get("active_company")
    if not profile:
        draft = svc.get_or_create_draft(db, ctx.workspace_id)
        profile = svc._profile_dict(draft)
    return {"profile": profile}


@router.post("/profile")
def save_profile(
    body: ProfileStep,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        profile = svc.save_profile_step(db, ctx.workspace_id, body.model_dump())
        return {"profile": svc._profile_dict(profile)}
    except ValueError as e:
        raise _handle_value_error(e)


@router.post("/logo")
async def upload_logo(
    file: UploadFile = File(...),
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    ext = os.path.splitext(file.filename or "logo.png")[1].lower() or ".png"
    if ext not in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
        raise HTTPException(status_code=400, detail="Logo must be PNG, JPG, or WebP")
    name = f"{ctx.workspace_id}_{uuid.uuid4().hex[:8]}{ext}"
    path = _LOGO_DIR / name
    content = await file.read()
    path.write_bytes(content)
    logo_url = f"/api/company-setup/logo/{name}"
    profile = svc.get_or_create_draft(db, ctx.workspace_id)
    profile.logo_url = logo_url
    db.add(profile)
    db.commit()
    return {"logo_url": logo_url}


@router.get("/logo/{filename}")
def serve_logo(filename: str) -> Any:
    from fastapi.responses import FileResponse
    path = _LOGO_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Logo not found")
    return FileResponse(path)


@router.post("/coa")
def setup_coa(
    body: CoaStep,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        return svc.setup_coa(db, ctx.workspace_id, body.option, body.csv_content)
    except ValueError as e:
        raise _handle_value_error(e)


@router.get("/coa")
def list_coa(
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    accounts = svc.list_setup_accounts(db, ctx.workspace_id)
    return {"accounts": accounts, "count": len(accounts)}


@router.post("/coa/accounts")
def create_account(
    body: AccountUpsert,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        return svc.upsert_setup_account(db, ctx.workspace_id, body.model_dump())
    except ValueError as e:
        raise _handle_value_error(e)


@router.put("/coa/accounts/{account_id}")
def update_account(
    account_id: str,
    body: AccountUpsert,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        return svc.upsert_setup_account(db, ctx.workspace_id, body.model_dump(), account_id)
    except ValueError as e:
        raise _handle_value_error(e)


@router.delete("/coa/accounts/{account_id}")
def delete_account(
    account_id: str,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    try:
        svc.delete_setup_account(db, ctx.workspace_id, account_id)
        return {"status": "deleted"}
    except ValueError as e:
        raise _handle_value_error(e)


@router.post("/opening-balances")
def save_opening_balances(
    body: OpeningBalancesStep,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        return svc.save_opening_balances(
            db,
            ctx.workspace_id,
            body.opening_date,
            [l.model_dump() for l in body.lines],
        )
    except ValueError as e:
        raise _handle_value_error(e)


@router.post("/controls")
def save_controls(
    body: ControlsStep,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        profile = svc.get_or_create_draft(db, ctx.workspace_id)
        return svc.save_controls(db, ctx.workspace_id, profile.id, body.model_dump())
    except ValueError as e:
        raise _handle_value_error(e)


@router.get("/controls")
def get_controls(
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    from app.models.company_setup import AccountingControls
    controls = db.query(AccountingControls).filter_by(workspace_id=ctx.workspace_id).first()
    if not controls:
        return {"controls": None}
    return {"controls": svc._controls_dict(controls)}


@router.get("/users")
def list_users(
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    users = svc.list_workspace_users_for_roles(db, ctx.workspace_id)
    roles = svc.get_user_roles(db, ctx.workspace_id)
    return {"users": users, "roles": roles, "module_options": svc.MODULE_ROLES}


@router.post("/roles")
def save_roles(
    body: RolesStep,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    assignments = svc.save_user_roles(db, ctx.workspace_id, [a.model_dump() for a in body.assignments])
    return {"assignments": assignments}


@router.get("/review")
def review(
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return svc.get_review_summary(db, ctx.workspace_id)


@router.post("/activate")
def activate(
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        profile = svc.activate_company(db, ctx.workspace_id)
        return {"profile": svc._profile_dict(profile), "redirect": "/uae-full"}
    except ValueError as e:
        raise _handle_value_error(e)
