"""One-time internal seed endpoint for group consolidation demo data.

GET /api/internal/seed-consolidation?secret=<SEED_SECRET>

Protected by a secret key set in the SEED_SECRET env var (default: disabled).
Idempotent — safe to call multiple times.
"""
from __future__ import annotations

import os
import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db

router = APIRouter(prefix="/api/internal", tags=["Internal"])

_SECRET = os.getenv("SEED_SECRET", "")


def _id() -> str:
    return str(uuid.uuid4())


COA = [
    ("6001", "Revenue — Services",       "Income",    "Revenue"),
    ("6002", "Revenue — Products",       "Income",    "Revenue"),
    ("7001", "Cost of Goods Sold",       "Expense",   "COGS"),
    ("7100", "Salaries & Wages",         "Expense",   "Operating Expense"),
    ("7101", "Rent & Premises",          "Expense",   "Operating Expense"),
    ("7102", "Marketing & Advertising",  "Expense",   "Operating Expense"),
    ("7103", "General & Administrative", "Expense",   "Operating Expense"),
    ("7111", "Depreciation",             "Expense",   "Depreciation"),
    ("7160", "Interest Expense",         "Expense",   "Finance Cost"),
    ("7200", "Corporate Tax",            "Expense",   "Tax"),
    ("2001", "Office Equipment (Net)",   "Asset",     "Fixed Asset"),
    ("1001", "Cash at Bank — FAB",       "Asset",     "Current Asset"),
    ("1100", "Trade Receivables",        "Asset",     "Current Asset"),
    ("1200", "Inventory",               "Asset",     "Current Asset"),
    ("1300", "Prepayments",             "Asset",     "Current Asset"),
    ("3001", "Long-term Loan — FAB",    "Liability", "Non-current Liability"),
    ("3100", "Trade Payables",          "Liability", "Current Liability"),
    ("3200", "Accrued Liabilities",     "Liability", "Current Liability"),
    ("5001", "Share Capital",           "Equity",    "Equity"),
    ("5010", "Retained Earnings b/f",   "Equity",    "Equity"),
]


def _ensure_coa(db: Session, workspace_id: str, company_id: str) -> dict[str, str]:
    from app.models.uae_accounting_full import UAEAccount
    existing = {
        a.code: a.id
        for a in db.query(UAEAccount)
        .filter_by(tenant_id=workspace_id, company_id=company_id)
        .all()
    }
    result = dict(existing)
    for code, name, atype, stype in COA:
        if code in existing:
            continue
        acc = UAEAccount(
            id=_id(), tenant_id=workspace_id, company_id=company_id,
            code=code, name=name, account_type=atype, sub_type=stype,
            currency="AED", is_active=True,
        )
        db.add(acc)
        result[code] = acc.id
    db.flush()
    return result


def _je(db: Session, workspace_id: str, company_id: str,
        period: str, entry_date: date, description: str,
        lines: list[tuple[str, str, float, float]],
        acc_map: dict[str, str]) -> None:
    from app.models.uae_accounting_full import UAEJournalEntry, UAEJournalLine
    je = UAEJournalEntry(
        id=_id(), tenant_id=workspace_id, company_id=company_id,
        entry_number=f"SEED-{_id()[:6].upper()}",
        entry_date=entry_date, period=period,
        description=description, status="posted",
        posted_at=datetime.utcnow(),
    )
    db.add(je)
    db.flush()
    for code, name, dr, cr in lines:
        from app.models.uae_accounting_full import UAEJournalLine
        db.add(UAEJournalLine(
            id=_id(), journal_entry_id=je.id,
            account_id=acc_map.get(code), account_code=code, account_name=name,
            debit=dr, credit=cr, currency="AED",
        ))


def _seed_company(
    db: Session, workspace_id: str,
    company_name: str, legal_type: str,
    revenue: float, cogs: float,
    salaries: float, rent: float, marketing: float, gna: float,
    depreciation: float, finance_costs: float, tax: float,
) -> dict:
    from app.models.company_setup import UaeCompanyProfile, AccountingPeriod

    existing = (
        db.query(UaeCompanyProfile)
        .filter_by(workspace_id=workspace_id, company_name=company_name)
        .first()
    )
    if existing:
        company_id = existing.id
        action = "reused"
        if existing.status != "active":
            existing.status = "active"
            db.flush()
    else:
        c = UaeCompanyProfile(
            id=_id(), workspace_id=workspace_id,
            company_name=company_name, legal_type=legal_type,
            base_currency="AED", reporting_standard="IFRS",
            financial_year_start=1, industry="trading",
            status="active", setup_step=5,
        )
        db.add(c)
        db.flush()
        company_id = c.id
        action = "created"

    # Accounting period
    if not (db.query(AccountingPeriod)
            .filter_by(workspace_id=workspace_id, company_id=company_id, period_number=11)
            .first()):
        db.add(AccountingPeriod(
            id=_id(), workspace_id=workspace_id, company_id=company_id,
            period_number=11, period_name="November 2026",
            start_date=date(2026, 11, 1), end_date=date(2026, 11, 30),
            status="open",
        ))
        db.flush()

    # Skip if already seeded
    from app.models.uae_accounting_full import UAEJournalEntry
    already = (
        db.query(UAEJournalEntry.id)
        .filter_by(tenant_id=workspace_id, company_id=company_id, period="2026-11")
        .first()
    )
    journals_seeded = 0
    if not already:
        acc = _ensure_coa(db, workspace_id, company_id)
        nov, d = "2026-11", date(2026, 11, 30)

        _je(db, workspace_id, company_id, nov, d, "November 2026 — Revenue", [
            ("1100", "Trade Receivables",  revenue,       0),
            ("6001", "Revenue — Services", 0, revenue * 0.6),
            ("6002", "Revenue — Products", 0, revenue * 0.4),
        ], acc)
        _je(db, workspace_id, company_id, nov, d, "November 2026 — COGS", [
            ("7001", "Cost of Goods Sold", cogs, 0),
            ("1200", "Inventory",          0,    cogs),
        ], acc)
        _je(db, workspace_id, company_id, nov, d, "November 2026 — Payroll", [
            ("7100", "Salaries & Wages",   salaries, 0),
            ("1001", "Cash at Bank — FAB", 0,        salaries),
        ], acc)
        if rent:
            _je(db, workspace_id, company_id, nov, d, "November 2026 — Rent", [
                ("7101", "Rent & Premises",    rent, 0),
                ("1001", "Cash at Bank — FAB", 0,    rent),
            ], acc)
        _je(db, workspace_id, company_id, nov, d, "November 2026 — Marketing", [
            ("7102", "Marketing & Advertising", marketing, 0),
            ("3100", "Trade Payables",           0,         marketing),
        ], acc)
        _je(db, workspace_id, company_id, nov, d, "November 2026 — G&A", [
            ("7103", "General & Administrative", gna, 0),
            ("3200", "Accrued Liabilities",       0,   gna),
        ], acc)
        _je(db, workspace_id, company_id, nov, d, "November 2026 — Depreciation", [
            ("7111", "Depreciation",           depreciation, 0),
            ("2001", "Office Equipment (Net)", 0,            depreciation),
        ], acc)
        if finance_costs:
            _je(db, workspace_id, company_id, nov, d, "November 2026 — Interest", [
                ("7160", "Interest Expense",    finance_costs, 0),
                ("3200", "Accrued Liabilities", 0,             finance_costs),
            ], acc)
        if tax:
            _je(db, workspace_id, company_id, nov, d, "November 2026 — Corporate Tax", [
                ("7200", "Corporate Tax",       tax, 0),
                ("3200", "Accrued Liabilities", 0,   tax),
            ], acc)
        journals_seeded = 8 + (1 if rent else 0) + (1 if finance_costs else 0) + (1 if tax else 0)

    db.flush()
    return {"company_id": company_id, "action": action, "journals_seeded": journals_seeded}


@router.get("/seed-consolidation")
def seed_consolidation(
    secret: str = Query(..., description="Must match SEED_SECRET env var"),
    db: Session = Depends(get_db),
):
    """Seed two demo companies for group consolidation. Protected by SEED_SECRET."""
    if not _SECRET:
        raise HTTPException(status_code=503, detail="Seeding disabled: SEED_SECRET not configured")
    if secret != _SECRET:
        raise HTTPException(status_code=403, detail="Invalid secret")

    row = db.execute(text("SELECT id FROM workspaces ORDER BY created_at LIMIT 1")).first()
    if not row:
        raise HTTPException(status_code=404, detail="No workspaces found")
    workspace_id = str(row[0])

    try:
        holdings = _seed_company(
            db, workspace_id,
            company_name="Gnanova Holdings LLC", legal_type="LLC",
            revenue=4_200_000, cogs=1_680_000,
            salaries=620_000, rent=95_000, marketing=85_000, gna=72_000,
            depreciation=38_000, finance_costs=28_000, tax=118_000,
        )
        properties = _seed_company(
            db, workspace_id,
            company_name="Gnanova Properties FZE", legal_type="FZE",
            revenue=2_800_000, cogs=840_000,
            salaries=310_000, rent=0, marketing=42_000, gna=38_000,
            depreciation=55_000, finance_costs=61_000, tax=78_000,
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "ok": True,
        "workspace_id": workspace_id,
        "companies": {
            "Gnanova Holdings LLC": holdings,
            "Gnanova Properties FZE": properties,
        },
        "message": "Reload /consolidation to see group figures.",
    }
