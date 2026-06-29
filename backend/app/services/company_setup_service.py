"""Company onboarding wizard — profile, COA, opening balances, controls, roles."""

from __future__ import annotations

import csv
import io
import json
import re
from calendar import monthrange
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models.company_setup import (
    AccountingControls,
    AccountingPeriod,
    UaeCompanyProfile,
    WorkspaceUserRole,
)
from app.models.uae_accounting_full import UAEAccount
from app.models.workspace import WorkspaceMember
from app.models.users import User
from app.services.uae_coa_service import seed_uae_chart_of_accounts
from app.services.uae_journal_service import create_journal_entry, post_journal_entry

TRN_RE = re.compile(r"^\d{15}$")

LEGAL_TYPES = {"LLC", "FZE", "Branch", "Sole Proprietor", "Other"}
INDUSTRIES = {"Trading", "Services", "Manufacturing", "Real Estate", "Other"}
REPORTING_STANDARDS = {"IFRS", "UAE GAAP"}
MODULE_ROLES = {
    "ap": ["AP Manager", "Viewer"],
    "ar": ["AR Manager", "Viewer"],
    "journals": ["Accountant", "CFO / Approver", "Viewer"],
    "cfo": ["CFO / Approver", "Viewer"],
    "viewer": ["Viewer"],
}


def validate_trn(trn: str | None) -> None:
    if trn and not TRN_RE.match(trn.strip()):
        raise ValueError("TRN must be exactly 15 digits")


def _profile_dict(p: UaeCompanyProfile) -> dict[str, Any]:
    return {
        "id": p.id,
        "workspace_id": p.workspace_id,
        "company_name": p.company_name,
        "trade_name": p.trade_name,
        "legal_type": p.legal_type,
        "trn": p.trn,
        "license_number": p.license_number,
        "license_authority": p.license_authority,
        "base_currency": p.base_currency,
        "reporting_standard": p.reporting_standard,
        "financial_year_start": p.financial_year_start,
        "industry": p.industry,
        "address": p.address,
        "phone": p.phone,
        "email": p.email,
        "website": p.website,
        "logo_url": p.logo_url,
        "status": p.status,
        "setup_step": p.setup_step,
        "coa_option": p.coa_option,
        "opening_balance_date": p.opening_balance_date.isoformat() if p.opening_balance_date else None,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


def get_setup_status(db: Session, workspace_id: str) -> dict[str, Any]:
    active = (
        db.query(UaeCompanyProfile)
        .filter_by(workspace_id=workspace_id, status="active")
        .order_by(UaeCompanyProfile.updated_at.desc())
        .first()
    )
    draft = (
        db.query(UaeCompanyProfile)
        .filter_by(workspace_id=workspace_id, status="setup")
        .order_by(UaeCompanyProfile.updated_at.desc())
        .first()
    )
    return {
        "has_active_company": active is not None,
        "active_company": _profile_dict(active) if active else None,
        "draft_company": _profile_dict(draft) if draft else None,
        "setup_required": active is None,
    }


def get_or_create_draft(db: Session, workspace_id: str) -> UaeCompanyProfile:
    draft = (
        db.query(UaeCompanyProfile)
        .filter_by(workspace_id=workspace_id, status="setup")
        .order_by(UaeCompanyProfile.updated_at.desc())
        .first()
    )
    if draft:
        return draft
    profile = UaeCompanyProfile(workspace_id=workspace_id, company_name="", status="setup", setup_step=1)
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


def save_profile_step(db: Session, workspace_id: str, data: dict[str, Any]) -> UaeCompanyProfile:
    validate_trn(data.get("trn"))
    profile = get_or_create_draft(db, workspace_id)

    for field in (
        "company_name", "trade_name", "legal_type", "trn", "license_number",
        "license_authority", "base_currency", "reporting_standard", "financial_year_start",
        "industry", "address", "phone", "email", "website", "logo_url",
    ):
        if field in data and data[field] is not None:
            setattr(profile, field, data[field])

    if data.get("legal_type") and data["legal_type"] not in LEGAL_TYPES:
        raise ValueError(f"legal_type must be one of {sorted(LEGAL_TYPES)}")
    if data.get("reporting_standard") and data["reporting_standard"] not in REPORTING_STANDARDS:
        raise ValueError(f"reporting_standard must be one of {sorted(REPORTING_STANDARDS)}")
    if not profile.company_name:
        raise ValueError("company_name is required")

    profile.setup_step = max(profile.setup_step, 2)
    profile.updated_at = datetime.utcnow()
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


def setup_coa(db: Session, workspace_id: str, option: str, csv_content: str | None = None) -> dict[str, Any]:
    if option not in {"default", "csv", "blank"}:
        raise ValueError("option must be default, csv, or blank")

    profile = get_or_create_draft(db, workspace_id)
    tenant_id = workspace_id
    profile.coa_option = option
    count = 0

    if option == "default":
        count = seed_uae_chart_of_accounts(tenant_id, db, company_id=profile.id)
    elif option == "csv":
        if not csv_content:
            raise ValueError("CSV content required for csv option")
        count = _import_coa_csv(tenant_id, csv_content, db, company_id=profile.id)
    # blank: no seed

    profile.setup_step = max(profile.setup_step, 3)
    profile.updated_at = datetime.utcnow()
    db.add(profile)
    db.commit()

    # Stamp company_id on accounts created during setup
    db.query(UAEAccount).filter(
        UAEAccount.tenant_id == tenant_id,
        UAEAccount.company_id.is_(None),
    ).update({UAEAccount.company_id: profile.id}, synchronize_session=False)
    db.commit()

    accounts = (
        db.query(UAEAccount)
        .filter_by(tenant_id=tenant_id, company_id=profile.id, is_active=True)
        .order_by(UAEAccount.code)
        .all()
    )
    return {
        "option": option,
        "imported": count,
        "accounts": [_account_dict(a) for a in accounts],
        "count": len(accounts),
    }


def _import_coa_csv(
    tenant_id: str,
    content: str,
    db: Session,
    *,
    company_id: str | None = None,
) -> int:
    reader = csv.DictReader(io.StringIO(content))
    q = db.query(UAEAccount.code).filter(UAEAccount.tenant_id == tenant_id)
    if company_id:
        q = q.filter(UAEAccount.company_id == company_id)
    existing = {a.code for a in q.all()}
    added = 0
    for row in reader:
        code = (row.get("code") or row.get("account_code") or "").strip()
        name = (row.get("name") or row.get("account_name") or "").strip()
        if not code or not name:
            continue
        if code in existing:
            continue
        acct = UAEAccount(
            tenant_id=tenant_id,
            company_id=company_id,
            code=code,
            name=name,
            account_type=row.get("type") or row.get("account_type") or "Expense",
            sub_type=row.get("sub_type") or row.get("account_sub_type") or row.get("sub") or "",
            currency=row.get("currency") or "AED",
            is_active=True,
        )
        db.add(acct)
        existing.add(code)
        added += 1
    db.commit()
    return added


def _account_dict(a: UAEAccount) -> dict[str, Any]:
    return {
        "id": a.id,
        "code": a.code,
        "name": a.name,
        "account_type": a.account_type,
        "sub_type": a.sub_type,
        "currency": a.currency,
        "is_active": a.is_active,
    }


def list_setup_accounts(db: Session, workspace_id: str) -> list[dict[str, Any]]:
    profile = get_or_create_draft(db, workspace_id)
    accounts = (
        db.query(UAEAccount)
        .filter_by(tenant_id=workspace_id, company_id=profile.id, is_active=True)
        .order_by(UAEAccount.code)
        .all()
    )
    return [_account_dict(a) for a in accounts]


def upsert_setup_account(db: Session, workspace_id: str, data: dict[str, Any], account_id: str | None = None) -> dict[str, Any]:
    profile = get_or_create_draft(db, workspace_id)
    if account_id:
        acct = db.query(UAEAccount).filter_by(id=account_id, tenant_id=workspace_id, company_id=profile.id).first()
        if not acct:
            raise ValueError("Account not found")
    else:
        acct = UAEAccount(tenant_id=workspace_id, company_id=profile.id)
        db.add(acct)

    for field, attr in [("code", "code"), ("name", "name"), ("account_type", "account_type"),
                        ("sub_type", "sub_type"), ("currency", "currency")]:
        if field in data and data[field] is not None:
            setattr(acct, attr, data[field])
    if "is_active" in data:
        acct.is_active = bool(data["is_active"])

    db.commit()
    db.refresh(acct)
    return _account_dict(acct)


def delete_setup_account(db: Session, workspace_id: str, account_id: str) -> None:
    profile = get_or_create_draft(db, workspace_id)
    acct = db.query(UAEAccount).filter_by(id=account_id, tenant_id=workspace_id, company_id=profile.id).first()
    if not acct:
        raise ValueError("Account not found")
    acct.is_active = False
    db.commit()


def save_opening_balances(
    db: Session,
    workspace_id: str,
    opening_date: date,
    lines: list[dict[str, Any]],
) -> dict[str, Any]:
    profile = get_or_create_draft(db, workspace_id)
    tenant_id = workspace_id

    total_dr = sum(float(l.get("debit") or 0) for l in lines)
    total_cr = sum(float(l.get("credit") or 0) for l in lines)
    has_amounts = any(float(l.get("debit") or 0) > 0 or float(l.get("credit") or 0) > 0 for l in lines)
    if has_amounts and abs(total_dr - total_cr) > 0.01:
        raise ValueError(f"Opening balances must balance: Dr {total_dr:.2f} ≠ Cr {total_cr:.2f}")

    je_lines = []
    for ln in lines:
        dr = float(ln.get("debit") or 0)
        cr = float(ln.get("credit") or 0)
        if dr == 0 and cr == 0:
            continue
        je_lines.append({
            "account_code": ln.get("account_code", ""),
            "account_name": ln.get("account_name", ""),
            "description": ln.get("description") or "Opening balance",
            "debit": dr,
            "credit": cr,
            "prior_year": ln.get("prior_year"),
        })

    if not je_lines:
        profile.opening_balance_date = opening_date
        profile.setup_step = max(profile.setup_step, 4)
        profile.updated_at = datetime.utcnow()
        db.add(profile)
        db.commit()
        return {
            "journal_entry_id": None,
            "entry_number": None,
            "total_debit": 0,
            "total_credit": 0,
            "opening_balance_date": opening_date.isoformat(),
            "skipped": True,
        }

    je = create_journal_entry(
        tenant_id=tenant_id,
        entry_date=opening_date,
        description="Opening balances",
        lines=je_lines,
        reference="OPENING_BALANCE",
        source="opening_balance",
        db=db,
        auto_post=True,
        company_id=profile.id,
    )

    profile.opening_balance_date = opening_date
    profile.setup_step = max(profile.setup_step, 4)
    profile.updated_at = datetime.utcnow()
    db.add(profile)
    db.commit()

    return {
        "journal_entry_id": je.id,
        "entry_number": je.entry_number,
        "total_debit": total_dr,
        "total_credit": total_cr,
        "opening_balance_date": opening_date.isoformat(),
    }


def save_controls(db: Session, workspace_id: str, company_id: str | None, data: dict[str, Any]) -> dict[str, Any]:
    profile = get_or_create_draft(db, workspace_id)
    controls = db.query(AccountingControls).filter_by(workspace_id=workspace_id).first()
    if not controls:
        controls = AccountingControls(workspace_id=workspace_id)
        db.add(controls)

    controls.company_id = company_id or profile.id
    if "je_approval_threshold_aed" in data:
        val = data["je_approval_threshold_aed"]
        controls.je_approval_threshold_aed = Decimal(str(val)) if val is not None else None
    if "allow_backdating" in data:
        controls.allow_backdating = bool(data["allow_backdating"])
    if "max_backdate_days" in data:
        controls.max_backdate_days = int(data["max_backdate_days"])
    if "require_docs_account_ids" in data:
        controls.require_docs_account_ids = json.dumps(data["require_docs_account_ids"])
    if "dual_approval_account_ids" in data:
        controls.dual_approval_account_ids = json.dumps(data["dual_approval_account_ids"])

    _generate_periods(db, workspace_id, profile)
    profile.setup_step = max(profile.setup_step, 5)
    profile.updated_at = datetime.utcnow()
    db.add(profile)
    db.add(controls)
    db.commit()
    db.refresh(controls)

    return _controls_dict(controls)


def _generate_periods(db: Session, workspace_id: str, profile: UaeCompanyProfile) -> None:
    fy_start = profile.financial_year_start or 1
    year = datetime.utcnow().year
    existing = db.query(AccountingPeriod).filter_by(workspace_id=workspace_id, company_id=profile.id).count()
    if existing >= 12:
        return

    db.query(AccountingPeriod).filter_by(workspace_id=workspace_id, company_id=profile.id).delete()

    month_names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    for i in range(12):
        m = ((fy_start - 1 + i) % 12) + 1
        y = year if m >= fy_start else year + 1
        last_day = monthrange(y, m)[1]
        start = date(y, m, 1)
        end = date(y, m, last_day)
        period = AccountingPeriod(
            workspace_id=workspace_id,
            company_id=profile.id,
            period_number=i + 1,
            period_name=f"{month_names[m - 1]} {y}",
            start_date=start,
            end_date=end,
            status="open",
        )
        db.add(period)


def _controls_dict(c: AccountingControls) -> dict[str, Any]:
    def _parse(raw: str | None) -> list:
        if not raw:
            return []
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return []

    return {
        "id": c.id,
        "workspace_id": c.workspace_id,
        "je_approval_threshold_aed": float(c.je_approval_threshold_aed) if c.je_approval_threshold_aed else None,
        "allow_backdating": c.allow_backdating,
        "max_backdate_days": c.max_backdate_days,
        "require_docs_account_ids": _parse(c.require_docs_account_ids),
        "dual_approval_account_ids": _parse(c.dual_approval_account_ids),
    }


def list_workspace_users_for_roles(db: Session, workspace_id: str) -> list[dict[str, Any]]:
    rows = (
        db.query(WorkspaceMember, User)
        .join(User, WorkspaceMember.user_id == User.id)
        .filter(WorkspaceMember.workspace_id == workspace_id)
        .all()
    )
    return [
        {"user_id": u.id, "name": u.name, "email": u.email, "workspace_role": m.role.value if hasattr(m.role, "value") else str(m.role)}
        for m, u in rows
    ]


def save_user_roles(db: Session, workspace_id: str, assignments: list[dict[str, str]]) -> list[dict[str, Any]]:
    profile = get_or_create_draft(db, workspace_id)
    db.query(WorkspaceUserRole).filter_by(workspace_id=workspace_id).delete()

    out = []
    for a in assignments:
        module = a.get("module", "")
        role = a.get("role", "")
        user_id = a.get("user_id", "")
        if not module or not role or not user_id:
            continue
        rec = WorkspaceUserRole(workspace_id=workspace_id, user_id=user_id, module=module, role=role)
        db.add(rec)
        out.append({"user_id": user_id, "module": module, "role": role})

    profile.setup_step = max(profile.setup_step, 6)
    profile.updated_at = datetime.utcnow()
    db.add(profile)
    db.commit()
    return out


def get_user_roles(db: Session, workspace_id: str) -> list[dict[str, Any]]:
    rows = db.query(WorkspaceUserRole).filter_by(workspace_id=workspace_id).all()
    return [{"user_id": r.user_id, "module": r.module, "role": r.role} for r in rows]


def get_review_summary(db: Session, workspace_id: str) -> dict[str, Any]:
    profile = get_or_create_draft(db, workspace_id)
    controls = db.query(AccountingControls).filter_by(workspace_id=workspace_id).first()
    periods = (
        db.query(AccountingPeriod)
        .filter_by(workspace_id=workspace_id, company_id=profile.id)
        .order_by(AccountingPeriod.period_number)
        .all()
    )
    accounts = list_setup_accounts(db, workspace_id)
    roles = get_user_roles(db, workspace_id)
    return {
        "profile": _profile_dict(profile),
        "controls": _controls_dict(controls) if controls else None,
        "periods": [
            {
                "period_number": p.period_number,
                "period_name": p.period_name,
                "start_date": p.start_date.isoformat(),
                "end_date": p.end_date.isoformat(),
                "status": p.status,
            }
            for p in periods
        ],
        "account_count": len(accounts),
        "role_assignments": roles,
    }


def list_active_companies(db: Session, workspace_id: str) -> list[dict[str, Any]]:
    from app.services.consolidation_service import list_active_companies as _list
    return _list(db, workspace_id)


def activate_company(db: Session, workspace_id: str) -> UaeCompanyProfile:
    profile = get_or_create_draft(db, workspace_id)
    if not profile.company_name:
        raise ValueError("Complete company profile before activation")
    if profile.setup_step < 6:
        raise ValueError("Complete all setup steps before activation")

    profile.status = "active"
    profile.setup_step = 6
    profile.updated_at = datetime.utcnow()
    db.add(profile)
    db.commit()
    db.refresh(profile)

    from app.services.audit_log_service import log_audit
    from app.services.consolidation_service import backfill_company_id

    log_audit(
        db, workspace_id=workspace_id, company_id=profile.id,
        action="company_setup_completed", entity_type="company", entity_id=profile.id,
        user_email=profile.email,
        details={"company_name": profile.company_name},
    )
    db.commit()
    backfill_company_id(db, workspace_id, profile.id)
    return profile
