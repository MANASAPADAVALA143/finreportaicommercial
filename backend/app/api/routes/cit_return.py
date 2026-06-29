"""UAE Corporate Tax Return — GL-backed Q&A form and voucher posting."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.company_setup import UaeCompanyProfile
from app.services.uae_journal_service import create_journal_entry, get_trial_balance

router = APIRouter(prefix="/api/gulftax/cit-return", tags=["CIT Return"])


def _tenant(request: Request) -> str:
    return request.headers.get("X-Workspace-ID") or request.headers.get("X-Tenant-ID") or "demo"


def _period_key(from_date: str, to_date: str) -> str:
    return to_date[:7]


def _gl_totals(tb: dict) -> dict[str, float]:
    totals = tb.get("totals", {})
    revenue = float(totals.get("revenue", 0))
    expense = float(totals.get("expense", 0))
    cogs = sum(
        line.get("net_balance", 0)
        for line in tb.get("lines", [])
        if line["account_code"].startswith("70")
    )
    opex = sum(
        line.get("net_balance", 0)
        for line in tb.get("lines", [])
        if line["account_code"].startswith("71") and not line["account_code"].startswith("717")
    )
    finance = sum(
        line.get("net_balance", 0)
        for line in tb.get("lines", [])
        if line["account_code"].startswith("717")
    )
    return {
        "revenue": revenue,
        "cogs": cogs,
        "opex": opex,
        "finance": finance,
        "expense": expense,
        "gross_profit": revenue - cogs,
        "net_profit": revenue - expense,
    }


@router.get("/generate")
def generate_cit_return(
    request: Request,
    workspace_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    from_date: str = Query(...),
    to_date: str = Query(...),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    ws = workspace_id or _tenant(request)
    period = _period_key(from_date, to_date)
    tb = get_trial_balance(ws, period, db, company_id=company_id)
    gl = _gl_totals(tb)

    profile: UaeCompanyProfile | None = None
    if company_id:
        profile = (
            db.query(UaeCompanyProfile)
            .filter(UaeCompanyProfile.id == company_id)
            .first()
        )

    try:
        end = date.fromisoformat(to_date[:10])
        due = end + timedelta(days=9 * 30)
    except ValueError:
        due = date.today()

    revenue = gl["revenue"]
    return {
        "entity_name": profile.company_name if profile else "",
        "trn": profile.trn if profile else "",
        "address": profile.address if profile else "",
        "ct_return_period": f"{from_date} to {to_date}",
        "ct_return_due_date": due.isoformat(),
        "filing_date": date.today().isoformat(),
        "session_1": {
            "info_correct": True,
            "is_partnership": False,
            "revenue_derived": round(revenue, 2),
            "financial_statements_basis": "Accrual",
            "is_mne_group": False,
            "uae_incorporated": True,
            "tax_resident_foreign": False,
        },
        "session_2": {
            "realisation_basis": False,
            "is_bank_insurer": False,
            "transitional_rules_immovable": False,
            "transitional_rules_intangible": False,
            "transitional_rules_financial": False,
            "small_business_relief": revenue < 3_000_000,
            "sbr_revenue": round(revenue, 2),
            "is_mne": False,
            "qualifying_group_transfers": False,
            "business_restructuring_relief": False,
            "foreign_permanent_establishment": False,
        },
        "session_2a": {"qualifies_as_qfzp": False},
        "session_3": {
            "operating_revenue": round(revenue, 2),
            "expenditure_operating": round(gl["cogs"] + gl["opex"], 2),
            "gross_profit": round(gl["gross_profit"], 2),
            "operating_expense": round(gl["opex"], 2),
            "net_interest": round(gl["finance"], 2),
            "net_gains_disposal": 0,
            "net_forex_gains": 0,
            "expenses_net_other": 0,
            "net_profit_loss": round(gl["net_profit"], 2),
            "other_comprehensive_income": 0,
        },
    }


class RecordVoucherBody(BaseModel):
    company_id: Optional[str] = None
    workspace_id: Optional[str] = None
    period_from: str
    period_to: str
    tax_amount_aed: float
    tax_expense_account: str
    tax_payable_account: str
    voucher_date: str
    remarks: Optional[str] = None


@router.post("/record-voucher")
def record_cit_voucher(
    body: RecordVoucherBody,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    ws = body.workspace_id or _tenant(request)
    period = _period_key(body.period_from, body.period_to)
    amount = round(body.tax_amount_aed, 2)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Tax amount must be positive")

    desc = body.remarks or f"Corporate tax provision {body.period_from} to {body.period_to}"
    try:
        vdate = date.fromisoformat(body.voucher_date[:10])
    except ValueError:
        vdate = date.today()

    je = create_journal_entry(
        tenant_id=ws,
        company_id=body.company_id,
        entry_date=vdate,
        description=desc,
        lines=[
            {"account_code": body.tax_expense_account, "debit": amount, "credit": 0, "description": desc},
            {"account_code": body.tax_payable_account, "debit": 0, "credit": amount, "description": desc},
        ],
        source="CIT_PROVISION",
        db=db,
        auto_post=True,
    )
    return {"je_id": je.id, "voucher_number": je.entry_number}
