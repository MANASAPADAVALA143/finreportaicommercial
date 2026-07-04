"""
UAE Full Accounting Suite — API Routes
=======================================
Covers all 8 modules:
  1. Chart of Accounts
  2. Journal Entries
  3. AR / Sales Invoices
  4. Bank Reconciliation
  5. Fixed Assets
  6. Accruals
  7. Period-End Close
  8. Management Accounts
"""
from __future__ import annotations

import os
import uuid
from datetime import date, datetime
from typing import Any, Optional, Dict, List
from decimal import Decimal

from fastapi import APIRouter, Depends, Header, HTTPException, UploadFile, File, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.company_setup import AccountingPeriod, UaeCompanyProfile
from app.models.uae_accounting_full import (
    UAEAccount, UAEJournalEntry, UAEJournalLine,
    UAECustomer, UAESalesInvoice, UAESalesInvoiceLine,
    UAEBankAccount, UAEBankStatement, UAEBankStatementLine,
    UAEFixedAsset, UAEAccrual, UAEPeriodClose,
)
from app.services.uae_coa_service import seed_uae_chart_of_accounts, get_account_balances
from app.services.uae_journal_service import (
    create_journal_entry, post_journal_entry, reverse_journal_entry, get_trial_balance,
    import_journals_from_csv,
    coa_name_map, enrich_journal_lines, missing_journal_account_codes,
    _normalize_account_code,
)
from app.exceptions.period_control import PeriodControlError
from app.services.audit_log_service import log_audit
from app.services.uae_controls_service import get_controls, validate_journal_entry
from app.services.notification_service import get_workspace_role_email, scan_notifications, send_notification
from app.services.uae_fixed_assets_service import run_monthly_depreciation, get_depreciation_schedule
from app.services.uae_accruals_service import suggest_accruals, post_accrual, persist_accrual_suggestions
from app.services.uae_bank_recon_service import (
    import_bank_statement, run_reconciliation, get_reconciliation_summary,
)
from app.services.ar_aging_service import compute_ar_aging

router = APIRouter(prefix="/api/uae/full", tags=["UAE Full Accounting"])

# ===========================================================================
# UAE FX revaluation (functional currency: AED)
# ===========================================================================

fx_router = APIRouter(prefix="/api/uae/fx", tags=["UAE FX Revaluation"])


class FXRevalueRequest(BaseModel):
    workspace_id: str
    company_id: Optional[str] = None
    period: str
    revaluation_date: str
    exchange_rates: Dict[str, Any] = Field(default_factory=dict)


def _fx_rate_pair(rate_input: Any) -> tuple[float, float]:
    """
    Accept either:
      - { current_rate, original_rate } — AED book balance revaluation (AED per 1 FCY)
      - number — legacy: FCY units stored on GL (original defaults to 1.0)
    """
    if isinstance(rate_input, (int, float)):
        current = float(rate_input)
        if current <= 0:
            raise ValueError("Exchange rate must be > 0")
        return 1.0, current
    if isinstance(rate_input, dict):
        current = float(rate_input.get("current_rate", 0))
        original = float(rate_input.get("original_rate", 1.0))
        if current <= 0 or original <= 0:
            raise ValueError("current_rate and original_rate must be > 0")
        return original, current
    raise ValueError("Invalid exchange rate payload")


def _ensure_fx_gl_account(
    tenant_id: str,
    company_id: str | None,
    db: Session,
) -> UAEAccount:
    fx = (
        db.query(UAEAccount)
        .filter(
            UAEAccount.tenant_id == tenant_id,
            UAEAccount.code == "7202",
            or_(UAEAccount.company_id == company_id, UAEAccount.company_id.is_(None)),
        )
        .order_by(UAEAccount.company_id.desc())
        .first()
    )
    if fx:
        return fx
    fx = UAEAccount(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        company_id=company_id,
        code="7202",
        name="Foreign Exchange Loss/Gain",
        account_type="Expense",
        sub_type="Finance",
        currency="AED",
        is_active=True,
    )
    db.add(fx)
    db.flush()
    return fx


@fx_router.post("/revalue")
def run_fx_revaluation(
    body: FXRevalueRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Automated month-end FX revaluation.
    Revalues non-AED account balances and posts JE with source=FX_REVALUATION.
    """
    tenant_id = (body.workspace_id or "").strip() or _tenant(request.headers)
    company_id = body.company_id
    try:
        reval_date = date.fromisoformat(body.revaluation_date[:10])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="revaluation_date must be YYYY-MM-DD") from exc

    account_q = db.query(UAEAccount).filter(
        UAEAccount.tenant_id == tenant_id,
        UAEAccount.is_active == True,
        UAEAccount.currency.isnot(None),
        UAEAccount.currency != "AED",
    )
    account_q = _apply_company(account_q, UAEAccount, company_id)
    fx_accounts = account_q.order_by(UAEAccount.code).all()
    if not fx_accounts:
        return {
            "message": "No foreign currency GL accounts found",
            "period": body.period,
            "posted": False,
            "accounts_processed": 0,
            "total_adjustment_aed": 0.0,
            "journal_entry_id": None,
            "journal_entry_number": None,
            "details": [],
        }

    line_q = (
        db.query(UAEJournalLine, UAEJournalEntry)
        .join(UAEJournalEntry, UAEJournalLine.journal_entry_id == UAEJournalEntry.id)
        .filter(
            UAEJournalEntry.tenant_id == tenant_id,
            UAEJournalEntry.status == "posted",
            UAEJournalEntry.entry_date <= reval_date,
        )
    )
    line_q = _apply_company(line_q, UAEJournalEntry, company_id)
    rows = line_q.all()

    by_code: dict[str, Decimal] = {}
    for line, _je in rows:
        code = _normalize_account_code(line.account_code)
        if not code:
            continue
        signed = Decimal(str(line.debit or 0)) - Decimal(str(line.credit or 0))
        by_code[code] = by_code.get(code, Decimal("0")) + signed

    missing_currencies: set[str] = set()
    details: list[dict[str, Any]] = []
    je_lines: list[dict[str, Any]] = []

    _ensure_fx_gl_account(tenant_id, company_id, db)

    for acct in fx_accounts:
        code = _normalize_account_code(acct.code)
        ccy = (acct.currency or "").upper()
        book_aed = float(by_code.get(code, Decimal("0")))
        if abs(book_aed) < 0.000001:
            continue
        raw_rate = body.exchange_rates.get(ccy)
        if raw_rate is None:
            missing_currencies.add(ccy)
            continue
        try:
            original_rate, current_rate = _fx_rate_pair(raw_rate)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid exchange rate for {ccy}: {exc}") from exc

        # GL balances are in AED; derive FC units at original rate then revalue at current rate.
        foreign_units = book_aed / original_rate
        original_aed = book_aed
        revalued_aed = foreign_units * current_rate
        delta = round(revalued_aed - original_aed, 2)
        if abs(delta) < 0.01:
            continue

        desc = f"FX Revaluation {body.period} - {ccy} at {current_rate:g}"
        amount = abs(delta)

        if delta > 0:
            # Account increases in AED => FX gain
            je_lines.append({
                "account_code": code,
                "account_name": acct.name,
                "description": desc,
                "debit": amount,
                "credit": 0.0,
                "currency": "AED",
            })
            je_lines.append({
                "account_code": "7202",
                "account_name": "Foreign Exchange Loss/Gain",
                "description": desc,
                "debit": 0.0,
                "credit": amount,
                "currency": "AED",
            })
        else:
            # Account decreases in AED => FX loss
            je_lines.append({
                "account_code": "7202",
                "account_name": "Foreign Exchange Loss/Gain",
                "description": desc,
                "debit": amount,
                "credit": 0.0,
                "currency": "AED",
            })
            je_lines.append({
                "account_code": code,
                "account_name": acct.name,
                "description": desc,
                "debit": 0.0,
                "credit": amount,
                "currency": "AED",
            })

        details.append({
            "account_code": code,
            "account_name": acct.name,
            "currency": ccy,
            "book_balance_aed": round(book_aed, 2),
            "foreign_balance": round(book_aed, 2),
            "original_rate": original_rate,
            "current_rate": current_rate,
            "original_aed": round(original_aed, 2),
            "revalued_aed": round(revalued_aed, 2),
            "adjustment_aed": delta,
        })

    if missing_currencies:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Missing exchange rates for one or more currencies",
                "missing_currencies": sorted(missing_currencies),
                "hint": "Provide exchange_rates like {\"USD\": {\"current_rate\": 3.67, \"original_rate\": 3.65}}",
            },
        )

    if not je_lines:
        return {
            "message": "No FX revaluation adjustment required",
            "period": body.period,
            "posted": False,
            "accounts_processed": 0,
            "total_adjustment_aed": 0.0,
            "journal_entry_id": None,
            "journal_entry_number": None,
            "details": details,
        }

    try:
        je = create_journal_entry(
            tenant_id=tenant_id,
            company_id=company_id,
            entry_date=reval_date,
            description=f"FX Revaluation {body.period}",
            reference=f"FX-{body.period}",
            source="FX_REVALUATION",
            lines=je_lines,
            db=db,
            auto_post=True,
        )
    except PeriodControlError as exc:
        raise HTTPException(status_code=400, detail=exc.payload) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    run = (
        db.query(UAEPeriodClose)
        .filter(UAEPeriodClose.tenant_id == tenant_id, UAEPeriodClose.period == body.period)
        .first()
    )
    if run and run.status != "closed":
        run.multi_currency_revaluation = True
        checklist = _run_checklist(run)
        run.status = "ready_to_close" if all(checklist.values()) else "open"
        db.add(run)

    log_audit(
        db,
        workspace_id=tenant_id,
        company_id=company_id,
        action="fx_revaluation_posted",
        entity_type="journal_entry",
        entity_id=je.id,
        user_email=request.headers.get("x-user-email"),
        details={
            "period": body.period,
            "revaluation_date": body.revaluation_date,
            "accounts_processed": len(details),
            "source": "FX_REVALUATION",
        },
    )
    db.commit()

    return {
        "message": "FX revaluation posted",
        "period": body.period,
        "posted": True,
        "accounts_processed": len(details),
        "total_adjustment_aed": round(sum(abs(d["adjustment_aed"]) for d in details), 2),
        "journal_entry_id": je.id,
        "journal_entry_number": je.entry_number,
        "details": details,
    }


def _tenant(request_headers) -> str:
    return (
        request_headers.get("x-workspace-id")
        or request_headers.get("x-tenant-id")
        or "demo"
    )


def _tenant_dep(
    x_workspace_id: str | None = Header(default=None, alias="X-Workspace-ID"),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-ID"),
) -> str:
    return (x_workspace_id or x_tenant_id or "demo").strip()


def _apply_company(q, model, company_id: Optional[str]):
    """Filter by company_id when provided (multi-company support)."""
    if company_id and hasattr(model, "company_id"):
        return q.filter(model.company_id == company_id)
    return q


# ===========================================================================
# 1. CHART OF ACCOUNTS
# ===========================================================================

@router.post("/coa/seed")
def seed_chart_of_accounts(
    request: Request,
    company_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    tenant_id = _tenant(request.headers)
    count = seed_uae_chart_of_accounts(tenant_id, db, company_id=company_id)
    return {"seeded": count, "message": f"Seeded {count} accounts"}


@router.get("/setup-context")
def uae_setup_context(
    request: Request,
    company_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Company profile, accounting periods, and setup flags for /uae-full UI."""
    tenant_id = _tenant(request.headers)
    cid = company_id
    profile = None
    if cid:
        profile = db.query(UaeCompanyProfile).filter_by(id=cid, workspace_id=tenant_id).first()
    else:
        profile = (
            db.query(UaeCompanyProfile)
            .filter_by(workspace_id=tenant_id, status="active")
            .order_by(UaeCompanyProfile.updated_at.desc())
            .first()
        )
        cid = profile.id if profile else None

    periods_q = db.query(AccountingPeriod).filter_by(workspace_id=tenant_id)
    if cid:
        periods_q = periods_q.filter_by(company_id=cid)
    periods = periods_q.order_by(AccountingPeriod.period_number).all()

    coa_count = 0
    opening_je = False
    if cid:
        coa_count = db.query(UAEAccount).filter_by(
            tenant_id=tenant_id, company_id=cid, is_active=True,
        ).count()
        opening_je = db.query(UAEJournalEntry).filter_by(
            tenant_id=tenant_id, company_id=cid, source="opening_balance", status="posted",
        ).first() is not None

    open_period = next((p for p in periods if p.status == "open"), periods[0] if periods else None)

    return {
        "company": {
            "id": profile.id,
            "company_name": profile.company_name,
            "base_currency": profile.base_currency,
            "reporting_standard": profile.reporting_standard,
            "financial_year_start": profile.financial_year_start,
            "opening_balance_date": profile.opening_balance_date.isoformat() if profile and profile.opening_balance_date else None,
        } if profile else None,
        "periods": [
            {
                "id": p.id,
                "period_name": p.period_name,
                "period_number": p.period_number,
                "start_date": p.start_date.isoformat(),
                "end_date": p.end_date.isoformat(),
                "status": p.status,
            }
            for p in periods
        ],
        "coa_count": coa_count,
        "has_opening_balance": opening_je,
        "setup_complete": bool(profile and coa_count > 0),
        "default_period": open_period.start_date.strftime("%Y-%m") if open_period else date.today().strftime("%Y-%m"),
    }


@router.get("/coa")
def list_chart_of_accounts(
    request: Request,
    company_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    tenant_id = _tenant(request.headers)
    q = db.query(UAEAccount).filter_by(tenant_id=tenant_id, is_active=True)
    q = _apply_company(q, UAEAccount, company_id)
    accounts = q.order_by(UAEAccount.code).all()
    return {
        "accounts": [
            {
                "id":           a.id,
                "account_code": a.code,
                "account_name": a.name,
                "account_type": a.account_type,
                "sub_type":     a.sub_type,
                "parent_code":  None,
                "currency":     a.currency,
                "is_vat":       a.is_vat_applicable,
                "vat_rate":     float(a.vat_rate or 0),
                "is_ct":        False,
                "is_active":    a.is_active,
            }
            for a in accounts
        ],
        "count": len(accounts),
    }


class AccountCreate(BaseModel):
    account_code: str
    account_name: str
    account_type: str
    sub_type:     Optional[str] = None
    parent_code:  Optional[str] = None
    currency:     str = "AED"
    is_vat:       bool = False
    vat_rate:     float = 0.0
    is_ct:        bool = False


@router.post("/coa")
def create_account(body: AccountCreate, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    existing = db.query(UAEAccount).filter_by(tenant_id=tenant_id, account_code=body.account_code).first()
    if existing:
        raise HTTPException(status_code=409, detail="Account code already exists")
    acct = UAEAccount(
        id=str(uuid.uuid4()), tenant_id=tenant_id,
        code=body.account_code, name=body.account_name,
        account_type=body.account_type, sub_type=body.sub_type,
        currency=body.currency,
        is_vat_applicable=body.is_vat, vat_rate=body.vat_rate,
        is_active=True,
    )
    db.add(acct); db.commit(); db.refresh(acct)
    return {"id": acct.id, "account_code": acct.code}


@router.get("/coa/balances")
def account_balances(period: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    balances = get_account_balances(tenant_id, period, db)
    return {"period": period, "balances": balances}


# ===========================================================================
# 2. JOURNAL ENTRIES
# ===========================================================================

class JELineIn(BaseModel):
    account_code: str
    account_name: Optional[str] = ""
    description:  Optional[str] = ""
    debit:        float = 0.0
    credit:       float = 0.0


class JECreate(BaseModel):
    entry_date:  str
    description: str
    reference:   Optional[str] = None
    source:      str = "manual"
    lines:       list[JELineIn]
    auto_post:   bool = False
    company_id:  Optional[str] = None


def _account_name_map(tenant_id: str, db: Session, company_id: Optional[str] = None) -> dict[str, str]:
    return coa_name_map(tenant_id, db, company_id)


def _serialize_je_lines(je: UAEJournalEntry, names: dict[str, str]) -> list[dict]:
    return [
        {
            "id": l.id,
            "account_code": l.account_code,
            "account_name": (l.account_name or names.get(_normalize_account_code(l.account_code), "") or ""),
            "description": l.description,
            "debit": float(l.debit or 0),
            "credit": float(l.credit or 0),
        }
        for l in je.lines
    ]


@router.get("/journals")
def list_journals(
    request: Request,
    period: Optional[str] = None,
    source: Optional[str] = None,
    status: Optional[str] = None,
    company_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    tenant_id = _tenant(request.headers)
    q = db.query(UAEJournalEntry).filter_by(tenant_id=tenant_id)
    q = _apply_company(q, UAEJournalEntry, company_id)
    if period: q = q.filter(UAEJournalEntry.period == period)
    if source: q = q.filter(UAEJournalEntry.source == source)
    if status: q = q.filter(UAEJournalEntry.status == status)
    entries = q.order_by(UAEJournalEntry.entry_date.desc()).limit(200).all()
    names = _account_name_map(tenant_id, db)
    return {
        "entries": [
            {
                "id":          e.id,
                "entry_date":  str(e.entry_date),
                "period":      e.period,
                "description": e.description,
                "reference":   e.reference,
                "source":      e.source,
                "status":      e.status,
                "total_debit": sum(l.debit for l in e.lines),
                "lines":       _serialize_je_lines(e, names),
            }
            for e in entries
        ],
        "count": len(entries),
    }


@router.post("/journals")
def create_je(body: JECreate, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    entry_date = date.fromisoformat(body.entry_date)
    coa_names = coa_name_map(tenant_id, db, body.company_id)
    raw_lines = [
        {
            "account_code": l.account_code,
            "account_name": l.account_name or "",
            "description": l.description,
            "debit": l.debit,
            "credit": l.credit,
        }
        for l in body.lines
    ]
    lines = enrich_journal_lines(raw_lines, coa_names)
    missing = missing_journal_account_codes(lines, coa_names)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Account(s) not found in Chart of Accounts: {', '.join(missing)}",
        )
    check = validate_journal_entry(
        entry_date=entry_date, lines=lines, source=body.source,
        workspace_id=tenant_id, db=db,
    )
    if not check["ok"]:
        raise HTTPException(status_code=400, detail="; ".join(check["errors"]))
    initial_status = "pending_approval" if check["requires_approval"] else "draft"
    auto_post = body.auto_post and initial_status != "pending_approval"
    user_email = request.headers.get("x-user-email")
    try:
        je = create_journal_entry(
            tenant_id=tenant_id, entry_date=entry_date,
            description=body.description, lines=lines, reference=body.reference,
            source=body.source, company_id=body.company_id,
            db=db, auto_post=auto_post,
            initial_status=initial_status,
        )
    except PeriodControlError as exc:
        raise HTTPException(status_code=400, detail=exc.payload) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    total_dr = sum(l.debit for l in body.lines)
    if initial_status == "pending_approval":
        scan_notifications(db, tenant_id)
        controls = get_controls(db, tenant_id)
        threshold = float(controls.je_approval_threshold_aed or 0) if controls else 0
        cfo_email = get_workspace_role_email(db, tenant_id, ["CFO", "Approver", "cfo"])
        if cfo_email:
            send_notification(
                cfo_email,
                f"JE approval needed: AED {total_dr:,.2f}",
                (
                    f"Journal entry AED {total_dr:,.2f} posted by {user_email or 'user'} "
                    f"requires your approval.\n"
                    f"Description: {body.description}\n"
                    f"Approve at: /uae-full/journals"
                ),
            )
        log_audit(
            db, workspace_id=tenant_id,
            company_id=body.company_id,
            action="je_pending_approval", entity_type="journal_entry", entity_id=je.id,
            user_email=user_email,
            details={"total": total_dr, "threshold": threshold},
        )
        db.commit()
        return JSONResponse(
            status_code=202,
            content={
                "status": "pending_approval",
                "message": f"JE above AED {threshold:,.0f} — sent to CFO for approval",
                "je_id": je.id,
                "warnings": check.get("warnings", []),
            },
        )

    if je.status == "posted":
        log_audit(
            db, workspace_id=tenant_id,
            company_id=je.company_id,
            action="je_posted", entity_type="journal_entry", entity_id=je.id,
            user_email=user_email,
            details={"entry_number": je.entry_number, "source": body.source},
        )
        db.commit()

    return {
        "id": je.id,
        "status": je.status,
        "warnings": check.get("warnings", []),
        "requires_approval": check["requires_approval"],
    }


@router.post("/journals/import")
async def import_journals(
    request: Request,
    file: UploadFile = File(...),
    company_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Import journal entries from CSV. Accepts paired or multiline column formats."""
    tenant_id = _tenant(request.headers)
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are supported")

    raw = await file.read()
    csv_text = raw.decode("utf-8", errors="replace")
    if not csv_text.strip():
        raise HTTPException(status_code=400, detail="CSV file is empty")

    result = import_journals_from_csv(
        tenant_id,
        csv_text,
        db,
        company_id=company_id,
        auto_post=True,
    )
    return {
        "imported": result["imported"],
        "skipped": result["skipped"],
        "errors": result["errors"],
        "total_parsed": result["total_parsed"],
        "workspace_id": tenant_id,
        "company_id": company_id,
        "message": f"Imported {result['imported']} journal entries",
    }


@router.post("/journals/{je_id}/post")
def post_je(je_id: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    je = db.query(UAEJournalEntry).filter_by(id=je_id, tenant_id=tenant_id).first()
    if not je:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    if je.status == "pending_approval":
        raise HTTPException(status_code=400, detail="Use /api/uae/controls/journals/{id}/approve to post this entry")
    lines = [
        {"account_code": l.account_code, "debit": float(l.debit or 0), "credit": float(l.credit or 0)}
        for l in je.lines
    ]
    check = validate_journal_entry(
        entry_date=je.entry_date, lines=lines, source=je.source or "manual",
        workspace_id=tenant_id, db=db,
    )
    if not check["ok"]:
        raise HTTPException(status_code=400, detail="; ".join(check["errors"]))
    if check["requires_approval"]:
        je.status = "pending_approval"
        db.add(je)
        db.commit()
        scan_notifications(db, tenant_id, je.company_id)
        return {"id": je.id, "status": je.status, "requires_approval": True, "warnings": check.get("warnings", [])}
    try:
        post_journal_entry(je, db)
    except PeriodControlError as exc:
        raise HTTPException(status_code=400, detail=exc.payload) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    log_audit(
        db, workspace_id=tenant_id, company_id=je.company_id,
        action="je_posted", entity_type="journal_entry", entity_id=je.id,
        user_email=request.headers.get("x-user-email"),
        details={"entry_number": je.entry_number},
    )

    # Auto-sync to R2R historical baseline (non-critical — never blocks posting)
    r2r_synced = False
    try:
        from app.modules.r2r.historical import add_to_company_baseline
        lines = db.query(UAEJournalLine).filter_by(journal_id=je_id).all()
        je_rows = [
            {
                "je_id": f"{je.id}_{line.id}",
                "je_number": je.reference or je.id,
                "date": str(je.entry_date),
                "period": je.period or "",
                "description": je.description or "",
                "account_code": line.account_code or "",
                "account_name": line.account_name or "",
                "debit": float(line.debit or 0),
                "credit": float(line.credit or 0),
                "amount": float(line.debit or line.credit or 0),
                "source": je.source or "manual",
                "posted_by": je.posted_by or tenant_id,
            }
            for line in lines
        ] if lines else [{
            "je_id": je.id, "je_number": je.reference or je.id,
            "date": str(je.entry_date), "period": je.period or "",
            "description": je.description or "",
            "account_code": "", "account_name": "", "debit": 0, "credit": 0, "amount": 0,
            "source": je.source or "manual", "posted_by": je.posted_by or tenant_id,
        }]
        add_to_company_baseline(
            company_id=tenant_id, journal_entries=je_rows, country="UAE", db=db
        )
        r2r_synced = True
    except Exception:
        pass  # R2R sync is non-critical

    db.commit()
    return {"id": je.id, "status": je.status, "r2r_synced": r2r_synced}


@router.post("/journals/{je_id}/approve")
def approve_je(je_id: str, request: Request, db: Session = Depends(get_db)):
    """Approve a high-value JE in pending_approval and post it."""
    tenant_id = _tenant(request.headers)
    je = db.query(UAEJournalEntry).filter_by(id=je_id, tenant_id=tenant_id).first()
    if not je:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    if je.status != "pending_approval":
        raise HTTPException(status_code=400, detail="Journal is not pending approval")
    approver = request.headers.get("x-user-email") or "approver"
    try:
        post_journal_entry(je, db)
    except PeriodControlError as exc:
        raise HTTPException(status_code=400, detail=exc.payload) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    je.approved_by = approver
    je.approved_at = datetime.utcnow()
    db.add(je)
    log_audit(
        db, workspace_id=tenant_id, company_id=je.company_id,
        action="je_approved", entity_type="journal_entry", entity_id=je.id,
        user_email=approver,
        details={"entry_number": je.entry_number},
    )
    db.commit()
    scan_notifications(db, tenant_id, je.company_id)
    return {"id": je.id, "status": je.status}


@router.post("/journals/{je_id}/reverse")
def reverse_je(je_id: str, reversal_date: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    try:
        new_je = reverse_journal_entry(
            je_id=je_id, tenant_id=tenant_id,
            reversal_date=date.fromisoformat(reversal_date), db=db,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"id": new_je.id, "status": new_je.status}


DELETABLE_JE_STATUSES = frozenset({"draft", "pending_approval", "rejected"})


@router.delete("/journals/{je_id}")
def delete_je(je_id: str, request: Request, db: Session = Depends(get_db)):
    """Delete an unposted journal entry (draft / pending approval / rejected)."""
    tenant_id = _tenant(request.headers)
    je = db.query(UAEJournalEntry).filter_by(id=je_id, tenant_id=tenant_id).first()
    if not je:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    if je.status not in DELETABLE_JE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete a {je.status} journal entry — use Reverse for posted entries",
        )
    ref = je.reference or je.entry_number or je_id
    db.delete(je)
    log_audit(
        db, workspace_id=tenant_id, company_id=je.company_id,
        action="je_deleted", entity_type="journal_entry", entity_id=je_id,
        user_email=request.headers.get("x-user-email"),
        details={"reference": ref, "description": je.description},
    )
    db.commit()
    return {"id": je_id, "deleted": True}


@router.get("/journals/{je_id}")
def get_je(je_id: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    je = db.query(UAEJournalEntry).filter_by(id=je_id, tenant_id=tenant_id).first()
    if not je:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    names = _account_name_map(tenant_id, db)
    return {
        "id": je.id, "entry_date": str(je.entry_date), "period": je.period,
        "description": je.description, "reference": je.reference,
        "source": je.source, "status": je.status,
        "lines": _serialize_je_lines(je, names),
    }


@router.get("/trial-balance")
def full_trial_balance(
    period: str,
    request: Request,
    company_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    tenant_id = _tenant(request.headers)
    return get_trial_balance(tenant_id, period, db, company_id=company_id)


# ===========================================================================
# 3. AR / SALES INVOICES
# ===========================================================================

class CustomerCreate(BaseModel):
    name:          str
    trn:           Optional[str] = None
    email:         Optional[str] = None
    phone:         Optional[str] = None
    address:       Optional[str] = None
    credit_limit:  float = 0.0
    payment_terms: int = 30


@router.get("/customers")
def list_customers(request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    customers = db.query(UAECustomer).filter_by(tenant_id=tenant_id, is_active=True).all()
    return {
        "customers": [
            {"id": c.id, "name": c.name, "trn": c.trn, "email": c.email,
             "credit_limit": float(c.credit_limit or 0),
             "payment_terms": c.payment_terms_days}
            for c in customers
        ],
        "count": len(customers),
    }


@router.post("/customers")
def create_customer(body: CustomerCreate, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    c = UAECustomer(
        id=str(uuid.uuid4()), tenant_id=tenant_id,
        name=body.name, trn=body.trn, email=body.email,
        phone=body.phone, address=body.address,
        credit_limit=body.credit_limit, payment_terms_days=body.payment_terms, is_active=True,
    )
    db.add(c); db.commit(); db.refresh(c)
    return {"id": c.id}


class InvoiceLineIn(BaseModel):
    description:  str
    quantity:     float = 1.0
    unit_price:   float
    vat_rate:     float = 5.0
    account_code: Optional[str] = "4001"


class InvoiceCreate(BaseModel):
    customer_id:    str
    invoice_date:   str
    due_date:       str
    invoice_number: Optional[str] = None
    reference:      Optional[str] = None
    lines:          list[InvoiceLineIn]


@router.get("/invoices")
def list_invoices(
    request: Request,
    status: Optional[str] = None,
    customer_id: Optional[str] = None,
    company_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    tenant_id = _tenant(request.headers)
    q = db.query(UAESalesInvoice).filter_by(tenant_id=tenant_id)
    q = _apply_company(q, UAESalesInvoice, company_id)
    if status:      q = q.filter(UAESalesInvoice.status == status)
    if customer_id: q = q.filter(UAESalesInvoice.customer_id == customer_id)
    invoices = q.order_by(UAESalesInvoice.invoice_date.desc()).limit(200).all()
    return {
        "invoices": [
            {"id": i.id, "invoice_number": i.invoice_number, "customer_id": i.customer_id,
             "invoice_date": str(i.invoice_date), "due_date": str(i.due_date),
             "subtotal": i.subtotal, "vat_amount": i.vat_amount,
             "total_amount": float(i.total_amount or 0), "amount_due": float(i.outstanding or 0), "status": i.status}
            for i in invoices
        ],
        "count": len(invoices),
    }


@router.post("/invoices")
def create_invoice(body: InvoiceCreate, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    inv_count = db.query(UAESalesInvoice).filter_by(tenant_id=tenant_id).count()
    invoice_number = body.invoice_number or f"INV-{inv_count + 1:04d}"
    subtotal   = sum(l.quantity * l.unit_price for l in body.lines)
    vat_amount = sum(l.quantity * l.unit_price * l.vat_rate / 100 for l in body.lines)
    total      = subtotal + vat_amount
    inv = UAESalesInvoice(
        id=str(uuid.uuid4()), tenant_id=tenant_id,
        customer_id=body.customer_id, invoice_number=invoice_number,
        invoice_date=date.fromisoformat(body.invoice_date),
        due_date=date.fromisoformat(body.due_date), reference=body.reference,
        subtotal=subtotal, vat_amount=vat_amount,
        total_amount=total, outstanding=total, status="draft",
        period=body.invoice_date[:7],
    )
    db.add(inv); db.flush()
    for ln in body.lines:
        ls = ln.quantity * ln.unit_price
        lv = ls * ln.vat_rate / 100
        db.add(UAESalesInvoiceLine(
            id=str(uuid.uuid4()), invoice_id=inv.id,
            description=ln.description, quantity=ln.quantity, unit_price=ln.unit_price,
            vat_rate=ln.vat_rate, vat_amount=lv, line_total=ls + lv,
        ))
    db.commit(); db.refresh(inv)
    return {"id": inv.id, "invoice_number": invoice_number, "total_amount": total}


@router.post("/invoices/{inv_id}/post")
def post_invoice(inv_id: str, request: Request, db: Session = Depends(get_db)):
    from app.services.ar_invoice_post_service import post_sales_invoice_to_gl_and_tax

    tenant_id = _tenant(request.headers)
    inv = db.query(UAESalesInvoice).filter_by(id=inv_id, tenant_id=tenant_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    result = post_sales_invoice_to_gl_and_tax(
        inv_id,
        tenant_id=tenant_id,
        company_id=inv.company_id,
        db=db,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "post_failed"))
    return {
        "id": inv_id,
        "status": result.get("status", "posted"),
        "je_id": result.get("je_id"),
        "je_reference": result.get("je_reference"),
        "skipped": result.get("skipped", False),
        "gulftax": result.get("gulftax"),
    }


@router.get("/ar-aging")
def ar_aging(
    request: Request,
    as_of: Optional[str] = None,
    company_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    tenant_id = _tenant(request.headers)
    as_of_date = date.fromisoformat(as_of) if as_of else date.today()
    report = compute_ar_aging(db, tenant_id, company_id, as_of_date)

    # Preserve this endpoint's existing flat {bucket_key: amount} contract
    # (consumed by frontend/src/pages/uae-accounting/SalesInvoices.tsx via
    # aging.current / aging['1_30'] / … / aging['over_90']).
    canonical_to_legacy_key = {
        "current": "current", "1_30": "1_30", "31_60": "31_60",
        "61_90": "61_90", "90_plus": "over_90",
    }
    buckets = {canonical_to_legacy_key[b["bucket"]]: b["amount"] for b in report["buckets"]}
    invoices = [
        {
            "invoice_number": inv["invoice_number"],
            "customer_id": inv["customer_id"],
            "due_date": inv["due_date"],
            "amount_due": inv["amount_due"],
            "days_overdue": inv["days_overdue"],
            "bucket": inv["bucket_label"],
        }
        for inv in report["invoices"]
    ]
    return {"as_of": report["as_of"], "buckets": buckets, "invoices": invoices}


# ===========================================================================
# 4. BANK RECONCILIATION
# ===========================================================================

class BankAccountCreate(BaseModel):
    bank_name:       str
    account_number:  str
    account_name:    str
    currency:        str = "AED"
    gl_account_code: str = "1001"


@router.get("/bank-accounts")
def list_bank_accounts(
    request: Request,
    company_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    tenant_id = _tenant(request.headers)
    q = db.query(UAEBankAccount).filter_by(tenant_id=tenant_id, is_active=True)
    q = _apply_company(q, UAEBankAccount, company_id)
    accounts = q.all()
    return {
        "accounts": [
            {"id": a.id, "bank_name": a.bank_name, "account_number": a.account_number,
             "account_name": f"{a.bank_name} {a.account_number}",
             "currency": a.currency,
             "gl_account_code": a.gl_account_id or "",
             "current_balance": float(a.last_reconciled_balance or 0)}
            for a in accounts
        ]
    }


@router.post("/bank-accounts")
def create_bank_account(body: BankAccountCreate, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    ba = UAEBankAccount(
        id=str(uuid.uuid4()), tenant_id=tenant_id,
        bank_name=body.bank_name, account_number=body.account_number,
        currency=body.currency, is_active=True,
    )
    db.add(ba); db.commit(); db.refresh(ba)
    return {"id": ba.id}


@router.post("/bank-accounts/{account_id}/import-statement")
async def import_statement(
    account_id: str, bank_name: str, statement_date: str,
    opening_balance: float, closing_balance: float,
    file: UploadFile = File(...),
    request: Request = None,
    db: Session = Depends(get_db),
):
    tenant_id = _tenant(request.headers)
    _file_bytes = await file.read()
    try:
        from app.core.aws_config import upload_to_s3
        upload_to_s3(_file_bytes, file.filename, folder="uploads", country="UAE")
    except Exception:
        pass  # S3 save is non-critical — processing continues from memory
    csv_text = _file_bytes.decode("utf-8", errors="replace")
    stmt = import_bank_statement(
        tenant_id=tenant_id, bank_account_id=account_id,
        statement_date=date.fromisoformat(statement_date),
        opening_balance=opening_balance, closing_balance=closing_balance,
        csv_text=csv_text, bank_name=bank_name, db=db,
    )
    return {"statement_id": stmt.id,
            "lines": db.query(UAEBankStatementLine).filter_by(statement_id=stmt.id).count()}


@router.post("/bank-statements/{statement_id}/reconcile")
def reconcile_statement(statement_id: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    try:
        return run_reconciliation(tenant_id, statement_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/bank-statements/{statement_id}/summary")
def recon_summary(statement_id: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    try:
        return get_reconciliation_summary(tenant_id, statement_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/bank-statements")
def list_statements(
    request: Request, bank_account_id: Optional[str] = None, db: Session = Depends(get_db),
):
    tenant_id = _tenant(request.headers)
    q = db.query(UAEBankStatement).filter_by(tenant_id=tenant_id)
    if bank_account_id:
        q = q.filter_by(bank_account_id=bank_account_id)
    stmts = q.order_by(UAEBankStatement.statement_date.desc()).all()
    return {
        "statements": [
            {"id": s.id, "bank_account_id": s.bank_account_id,
             "statement_date": str(s.statement_date),
             "opening_balance": s.opening_balance, "closing_balance": s.closing_balance,
             "status": s.status}
            for s in stmts
        ]
    }


# ===========================================================================
# 5. FIXED ASSETS
# ===========================================================================

class AssetCreate(BaseModel):
    asset_name:              str
    asset_code:              Optional[str] = None
    asset_category:          str
    acquisition_date:        str
    cost:                    float
    residual_value:          float = 0.0
    useful_life_years:       int = 5
    depreciation_method:     str = "straight_line"
    location:                Optional[str] = None
    serial_number:           Optional[str] = None
    gl_asset_account:        str = "1500"
    gl_depreciation_account: str = "5500"


@router.get("/fixed-assets")
def list_assets(
    request: Request,
    status: Optional[str] = None,
    company_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    tenant_id = _tenant(request.headers)
    q = db.query(UAEFixedAsset).filter_by(tenant_id=tenant_id)
    if company_id and hasattr(UAEFixedAsset, "company_id"):
        q = q.filter(or_(UAEFixedAsset.company_id == company_id, UAEFixedAsset.company_id.is_(None)))
    if status:
        q = q.filter_by(status=status)
    assets = q.order_by(UAEFixedAsset.asset_code).all()
    return {
        "assets": [
            {"id": a.id, "asset_code": a.asset_code, "asset_name": a.name,
             "asset_category": a.category, "acquisition_date": str(a.purchase_date or ""),
             "cost": float(a.purchase_cost or 0),
             "accumulated_depreciation": float(a.accumulated_depreciation or 0),
             "net_book_value": float(a.net_book_value or 0),
             "ct_accumulated_dep": float(a.ct_accumulated_depreciation or 0),
             "ct_net_book_value": float(a.purchase_cost or 0) - float(a.ct_accumulated_depreciation or 0),
             "status": a.status}
            for a in assets
        ],
        "count": len(assets),
    }


@router.post("/fixed-assets")
def create_asset(
    body: AssetCreate,
    request: Request,
    db: Session = Depends(get_db),
    company_id: Optional[str] = None,
):
    tenant_id = _tenant(request.headers)
    asset_count = db.query(UAEFixedAsset).filter_by(tenant_id=tenant_id).count()
    asset = UAEFixedAsset(
        id=str(uuid.uuid4()), tenant_id=tenant_id, company_id=company_id,
        name=body.asset_name,
        asset_code=body.asset_code or f"FA-{asset_count + 1:04d}",
        category=body.asset_category,
        purchase_date=date.fromisoformat(body.acquisition_date),
        purchase_cost=body.cost, residual_value=body.residual_value,
        useful_life_years=body.useful_life_years,
        depreciation_method=body.depreciation_method,
        location=body.location,
        accumulated_depreciation=0.0,
        net_book_value=body.cost,
        ct_accumulated_depreciation=0.0, status="active",
    )
    db.add(asset); db.commit(); db.refresh(asset)
    return {"id": asset.id, "asset_code": asset.asset_code}


@router.post("/fixed-assets/run-depreciation")
def run_depreciation(period: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    return run_monthly_depreciation(tenant_id, period, db)


@router.get("/fixed-assets/{asset_id}/schedule")
def depreciation_schedule(asset_id: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    asset = db.query(UAEFixedAsset).filter_by(id=asset_id, tenant_id=tenant_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"asset_id": asset_id, "asset_name": asset.name,
            "schedule": get_depreciation_schedule(asset)}


# ===========================================================================
# 6. ACCRUALS
# ===========================================================================

class AccrualCreate(BaseModel):
    period:       str
    description:  str
    amount:       float
    account_code: str
    accrual_type: str = "expense"
    is_mandatory: bool = False
    ai_reasoning: Optional[str] = None


@router.get("/accruals")
def list_accruals(request: Request, period: Optional[str] = None, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    q = db.query(UAEAccrual).filter_by(tenant_id=tenant_id)
    if period:
        q = q.filter_by(period=period)
    accruals = q.order_by(UAEAccrual.created_at.desc()).all()
    return {
        "accruals": [
            {"id": a.id, "period": a.period, "description": a.description,
             "amount": float(a.amount or 0),
             "account_code": a.debit_account_code or "",
             "accrual_type": a.accrual_type, "is_mandatory": a.mandatory,
             "status": a.status,
             "ai_confidence": float(a.ai_confidence or 0) if a.ai_confidence else None,
             "ai_reasoning": a.ai_basis}
            for a in accruals
        ],
        "count": len(accruals),
    }


@router.post("/accruals")
def create_accrual(body: AccrualCreate, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    accrual = UAEAccrual(
        id=str(uuid.uuid4()), tenant_id=tenant_id,
        period=body.period, description=body.description,
        amount=body.amount,
        debit_account_code=body.account_code,
        credit_account_code=body.account_code,
        accrual_type=body.accrual_type, mandatory=body.is_mandatory,
        ai_basis=body.ai_reasoning, status="suggested",
    )
    db.add(accrual); db.commit(); db.refresh(accrual)
    return {"id": accrual.id}


@router.post("/accruals/suggest")
def suggest(period: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    suggestions = suggest_accruals(tenant_id, period, db)
    saved = persist_accrual_suggestions(tenant_id, period, suggestions, db)
    return {"period": period, "suggestions": suggestions, "count": len(suggestions), "saved": saved}


@router.post("/accruals/{accrual_id}/post")
def post_accrual_route(accrual_id: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    try:
        return post_accrual(accrual_id, tenant_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ===========================================================================
# 7. PERIOD-END CLOSE
# ===========================================================================

CLOSE_FIELDS = [
    "tb_reconciled", "bank_recon_done", "accruals_posted",
    "fixed_assets_depreciated", "vat_reconciled", "ar_reviewed",
    "ap_reviewed", "ifrs_statements_generated", "management_accounts_done",
    "multi_currency_revaluation",
    "intercompany_balances_reconciled", "ifrs_adjustments_posted", "audit_trail_exported",
]


def _run_checklist(run: UAEPeriodClose) -> dict[str, bool]:
    return {
        "bank_reconciliation":        bool(run.bank_recon_done),
        "ar_invoice_review":          bool(run.ar_reviewed),
        "accruals_posted":            bool(run.accruals_posted),
        "fixed_asset_depreciation":   bool(run.fixed_assets_depreciated),
        "vat_return_prepared":        bool(run.vat_reconciled),
        "intercompany_eliminations":  bool(run.ap_reviewed),
        "prepayments_amortised":      bool(run.tb_reconciled),
        "payroll_posted":             bool(run.ifrs_statements_generated),
        "management_accounts_reviewed": bool(run.management_accounts_done),
        "multi_currency_revaluation": bool(run.multi_currency_revaluation),
        "intercompany_balances_reconciled": bool(run.intercompany_balances_reconciled),
        "ifrs_adjustments_posted": bool(run.ifrs_adjustments_posted),
        "audit_trail_exported": bool(run.audit_trail_exported),
    }


@router.get("/period-close")
def list_close_runs(request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    runs = (
        db.query(UAEPeriodClose)
        .filter_by(tenant_id=tenant_id)
        .order_by(UAEPeriodClose.period.desc())
        .all()
    )
    return {
        "runs": [
            {"id": r.id, "period": r.period, "status": r.status,
             "is_locked": r.status == "closed",
             "checklist": _run_checklist(r),
             "closed_at": str(r.closed_at) if r.closed_at else None}
            for r in runs
        ]
    }


@router.post("/period-close/start")
def start_close(period: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    existing = db.query(UAEPeriodClose).filter_by(tenant_id=tenant_id, period=period).first()
    if existing:
        return {"id": existing.id, "period": period, "status": existing.status,
                "checklist": _run_checklist(existing)}
    run = UAEPeriodClose(
        id=str(uuid.uuid4()), tenant_id=tenant_id,
        period=period, status="open",
    )
    db.add(run); db.commit(); db.refresh(run)
    return {"id": run.id, "period": period, "status": "open", "checklist": _run_checklist(run)}


_ITEM_TO_FIELD = {
    "bank_reconciliation":          "bank_recon_done",
    "ar_invoice_review":            "ar_reviewed",
    "accruals_posted":              "accruals_posted",
    "fixed_asset_depreciation":     "fixed_assets_depreciated",
    "vat_return_prepared":          "vat_reconciled",
    "intercompany_eliminations":    "ap_reviewed",
    "prepayments_amortised":        "tb_reconciled",
    "payroll_posted":               "ifrs_statements_generated",
    "management_accounts_reviewed": "management_accounts_done",
    "multi_currency_revaluation":   "multi_currency_revaluation",
    "intercompany_balances_reconciled": "intercompany_balances_reconciled",
    "ifrs_adjustments_posted": "ifrs_adjustments_posted",
    "audit_trail_exported": "audit_trail_exported",
}


@router.patch("/period-close/{run_id}/check")
def update_checklist(run_id: str, item: str, done: bool, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    run = db.query(UAEPeriodClose).filter_by(id=run_id, tenant_id=tenant_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Close run not found")
    if run.status == "closed":
        raise HTTPException(status_code=400, detail="Period is locked")
    field = _ITEM_TO_FIELD.get(item)
    if field:
        setattr(run, field, done)
    checklist = _run_checklist(run)
    run.status = "ready_to_close" if all(checklist.values()) else "open"
    db.commit()
    return {"id": run.id, "checklist": _run_checklist(run), "status": run.status}


@router.post("/period-close/{run_id}/lock")
def lock_period(run_id: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    run = db.query(UAEPeriodClose).filter_by(id=run_id, tenant_id=tenant_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Close run not found")
    checklist = _run_checklist(run)
    incomplete = [k for k, v in checklist.items() if not v]
    if incomplete:
        raise HTTPException(status_code=400, detail=f"Incomplete items: {incomplete}")
    run.status = "closed"
    run.closed_at = datetime.utcnow()
    db.commit()
    return {"id": run.id, "period": run.period, "status": "closed", "is_locked": True}


# ===========================================================================
# 8. MANAGEMENT ACCOUNTS
# ===========================================================================

@router.post("/management-accounts")
def generate_management_accounts(
    period: str,
    request: Request,
    company_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    tenant_id = _tenant(request.headers)
    tb        = get_trial_balance(tenant_id, period, db, company_id=company_id)
    totals    = tb.get("totals", {})
    revenue   = abs(totals.get("revenue",   0))
    expenses  = abs(totals.get("expense",   0))
    assets    = abs(totals.get("asset",     0))
    liabs     = abs(totals.get("liability", 0))
    equity    = abs(totals.get("equity",    0))
    gross_profit = revenue - expenses * 0.6
    net_profit   = revenue - expenses
    gross_margin = round(gross_profit / revenue * 100, 1) if revenue else 0
    net_margin   = round(net_profit   / revenue * 100, 1) if revenue else 0
    narrative    = _generate_ai_narrative(period, revenue, expenses, net_profit, gross_margin)
    return {
        "period": period,
        "pnl": {"revenue": revenue, "gross_profit": gross_profit, "gross_margin": gross_margin,
                "net_profit": net_profit, "net_margin": net_margin, "total_expenses": expenses},
        "balance_sheet": {"total_assets": assets, "total_liabilities": liabs, "total_equity": equity},
        "narrative": narrative,
        "generated_at": datetime.utcnow().isoformat(),
    }


def _generate_ai_narrative(period, revenue, expenses, net_profit, gross_margin):
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return {
            "executive_summary": f"Revenue AED {revenue:,.0f} | Net Profit AED {net_profit:,.0f} | Margin {gross_margin:.1f}%",
            "revenue_analysis": "Connect AI for detailed analysis.",
            "cost_analysis":    "Connect AI for detailed analysis.",
            "balance_sheet":    "Connect AI for detailed analysis.",
            "outlook":          "Connect AI for detailed analysis.",
        }
    try:
        import anthropic
        import json
        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model="claude-3-5-sonnet-20241022", max_tokens=800,
            messages=[{"role": "user", "content": (
                f"Write a UAE CFO management accounts narrative for {period}.\n"
                f"Revenue: AED {revenue:,.0f}\nExpenses: AED {expenses:,.0f}\n"
                f"Net Profit: AED {net_profit:,.0f}\nGross Margin: {gross_margin:.1f}%\n\n"
                "Return JSON with keys: executive_summary, revenue_analysis, cost_analysis, "
                "balance_sheet, outlook. Each 1-3 sentences. Return ONLY valid JSON."
            )}],
        )
        text = msg.content[0].text
        return json.loads(text[text.find("{"):text.rfind("}") + 1])
    except Exception:
        return {
            "executive_summary": f"Revenue AED {revenue:,.0f} | Net Profit AED {net_profit:,.0f}",
            "revenue_analysis": "See trial balance.", "cost_analysis": "See trial balance.",
            "balance_sheet": "See trial balance.", "outlook": "See trial balance.",
        }


# ===========================================================================
# AP — VENDORS & PURCHASE INVOICES
# ===========================================================================

@router.get("/vendors")
def list_vendors(request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    from app.models.uae_ap import UAEVendor
    vendors = db.query(UAEVendor).filter_by(tenant_id=tenant_id, is_active=True).order_by(UAEVendor.name).all()
    return {
        "vendors": [
            {"id": v.id, "name": v.name, "trn": v.trn, "email": v.email, "emirate": v.emirate}
            for v in vendors
        ],
        "count": len(vendors),
    }


@router.get("/purchase-invoices")
def list_purchase_invoices(request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    from app.models.uae_ap import UAEPurchaseInvoice
    invoices = (
        db.query(UAEPurchaseInvoice)
        .filter_by(tenant_id=tenant_id)
        .order_by(UAEPurchaseInvoice.invoice_date.desc())
        .limit(200)
        .all()
    )
    return {
        "invoices": [
            {
                "id": i.id,
                "invoice_number": i.invoice_number,
                "vendor_id": i.vendor_id,
                "invoice_date": i.invoice_date.isoformat() if i.invoice_date else None,
                "total_amount": float(i.total_amount or 0),
                "outstanding": float(i.outstanding or 0),
                "status": i.status,
                "workspace_id": i.workspace_id,
            }
            for i in invoices
        ],
        "count": len(invoices),
    }


class PurchaseInvoiceCreate(BaseModel):
    invoice_number: str
    vendor_id: str
    invoice_date: str
    due_date: str
    subtotal: float
    vat_amount: float
    total_amount: float
    description: str = "AP Invoice"
    vat_treatment: str = "standard_rated"
    source: str = "manual"
    company_id: str = ""


@router.post("/purchase-invoices")
def create_purchase_invoice(body: PurchaseInvoiceCreate, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    from app.models.uae_ap import UAEPurchaseInvoice, UAEPurchaseInvoiceLine
    from app.services.ap_company_resolver import resolve_ap_company_id

    company_id = resolve_ap_company_id(db, tenant_id, body.company_id or None)
    pi = UAEPurchaseInvoice(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        workspace_id=tenant_id,
        company_id=company_id,
        invoice_number=body.invoice_number,
        vendor_id=body.vendor_id,
        invoice_date=date.fromisoformat(body.invoice_date),
        due_date=date.fromisoformat(body.due_date),
        subtotal=body.subtotal,
        vat_amount=body.vat_amount,
        total_amount=body.total_amount,
        outstanding=body.total_amount,
        status="approved",
        vat_treatment=body.vat_treatment,
        source=body.source,
    )
    db.add(pi)
    db.add(UAEPurchaseInvoiceLine(
        id=str(uuid.uuid4()),
        invoice_id=pi.id,
        description=body.description,
        quantity=1,
        unit_price=body.subtotal,
        line_total=body.subtotal,
        vat_rate=5,
        vat_amount=body.vat_amount,
    ))
    db.commit()
    db.refresh(pi)
    return {"id": pi.id, "invoice_number": pi.invoice_number, "workspace_id": pi.workspace_id}


# ===========================================================================
# DASHBOARD KPIs
# ===========================================================================

@router.get("/dashboard")
def dashboard_kpis(
    period: str,
    request: Request,
    company_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    tenant_id = _tenant(request.headers)
    coa_q = db.query(UAEAccount).filter_by(tenant_id=tenant_id, is_active=True)
    coa_q = _apply_company(coa_q, UAEAccount, company_id)
    coa_count = coa_q.count()
    je_q = db.query(UAEJournalEntry).filter_by(tenant_id=tenant_id, period=period, status="posted")
    je_q = _apply_company(je_q, UAEJournalEntry, company_id)
    je_count = je_q.count()
    asset_q = db.query(UAEFixedAsset).filter_by(tenant_id=tenant_id, status="active")
    asset_q = _apply_company(asset_q, UAEFixedAsset, company_id)
    asset_count = asset_q.count()
    inv_q = db.query(UAESalesInvoice).filter_by(tenant_id=tenant_id, period=period)
    inv_q = _apply_company(inv_q, UAESalesInvoice, company_id)
    inv_count = inv_q.count()
    accrual_count = db.query(UAEAccrual).filter_by(tenant_id=tenant_id, period=period).count()
    ar_q = db.query(UAESalesInvoice).filter_by(tenant_id=tenant_id).filter(UAESalesInvoice.outstanding > 0)
    ar_q = _apply_company(ar_q, UAESalesInvoice, company_id)
    ar_invoices = ar_q.all()
    ar_total = sum(float(i.outstanding or 0) for i in ar_invoices)
    tb = get_trial_balance(tenant_id, period, db, company_id=company_id)
    totals = tb.get("totals", {})
    return {
        "period":        period,
        "coa_count":     coa_count,
        "je_count":      je_count,
        "asset_count":   asset_count,
        "invoice_count": inv_count,
        "accrual_count": accrual_count,
        "ar_outstanding":ar_total,
        "revenue":       abs(totals.get("revenue",   0)),
        "expenses":      abs(totals.get("expense",   0)),
        "net_profit":    abs(totals.get("revenue",   0)) - abs(totals.get("expense", 0)),
        "total_assets":  abs(totals.get("asset",     0)),
    }
