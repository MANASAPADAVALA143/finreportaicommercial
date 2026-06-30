"""IFRS 16 monthly journal entry posting to uae_journal_entries."""
from __future__ import annotations

import json
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.models.ifrs16_lease import IFRS16Lease
from app.modules.ifrs16.ifrs16_repository import get_lease, update_lease
from app.services.uae_journal_service import create_journal_entry


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _find_schedule_row(schedule: list[dict], period_date: date) -> dict | None:
    target = period_date.strftime("%Y-%m")
    for row in schedule:
        row_date = str(row.get("Date") or row.get("date") or "")
        if row_date[:7] == target:
            return row
    # fallback: match by period number from months since commencement
    return schedule[0] if schedule else None


def post_monthly_jes(
    db: Session,
    lease_id: str,
    period_date: date,
    workspace_id: str,
    company_id: str | None,
) -> dict[str, Any]:
    lease = get_lease(db, lease_id, workspace_id, company_id)
    if not lease:
        raise ValueError("Lease not found")
    if lease.status != "active":
        raise ValueError("Only active leases can post journal entries")

    calc: dict = {}
    if lease.calculation_json:
        try:
            calc = json.loads(lease.calculation_json)
        except json.JSONDecodeError:
            calc = {}

    schedule = calc.get("amortization_schedule") or []
    if isinstance(schedule, str):
        schedule = json.loads(schedule)

    row = _find_schedule_row(schedule, period_date)
    if not row:
        term = lease.lease_term_months or 1
        monthly_dep = _f(lease.rou_asset_initial) / term
        ibr = _f(lease.incremental_borrowing_rate)
        opening_ll = _f(lease.lease_liability_current)
        interest = opening_ll * (ibr / 12)
        payment = _f(lease.lease_payments_aed)
        principal = payment - interest
        row = {
            "Opening_Balance": opening_ll,
            "Interest": interest,
            "Principal": principal,
            "Payment": payment,
            "Closing_Balance": opening_ll - principal,
        }
    else:
        monthly_dep = _f(lease.rou_asset_initial) / max(lease.lease_term_months, 1)
        interest = _f(row.get("Interest") or row.get("interest"))
        principal = _f(row.get("Principal") or row.get("principal"))
        payment = _f(row.get("Payment") or row.get("payment"))
        closing = _f(row.get("Closing_Balance") or row.get("closing_liability"))

    name = lease.lease_name
    period = period_date.strftime("%Y-%m")
    je_ids: list[str] = []

    # JE 1 — Depreciation
    je1 = create_journal_entry(
        tenant_id=workspace_id,
        company_id=company_id,
        entry_date=period_date,
        description=f"IFRS 16 Depreciation: {name}",
        reference=f"IFRS16-{lease_id[:8]}-DEP-{period}",
        source="IFRS16_DEPRECIATION",
        lines=[
            {"account_code": "7100", "account_name": "Depreciation Expense", "debit": monthly_dep, "credit": 0},
            {"account_code": "1650", "account_name": "Accumulated Depreciation — ROU", "debit": 0, "credit": monthly_dep},
        ],
        db=db,
        auto_post=True,
    )
    je_ids.append(je1.id)

    # JE 2 — Interest
    je2 = create_journal_entry(
        tenant_id=workspace_id,
        company_id=company_id,
        entry_date=period_date,
        description=f"IFRS 16 Interest: {name}",
        reference=f"IFRS16-{lease_id[:8]}-INT-{period}",
        source="IFRS16_INTEREST",
        lines=[
            {"account_code": "7200", "account_name": "Finance Cost — Lease Interest", "debit": interest, "credit": 0},
            {"account_code": "2300", "account_name": "Lease Liability", "debit": 0, "credit": interest},
        ],
        db=db,
        auto_post=True,
    )
    je_ids.append(je2.id)

    # JE 3 — Lease Payment
    je3 = create_journal_entry(
        tenant_id=workspace_id,
        company_id=company_id,
        entry_date=period_date,
        description=f"IFRS 16 Payment: {name}",
        reference=f"IFRS16-{lease_id[:8]}-PAY-{period}",
        source="IFRS16_PAYMENT",
        lines=[
            {"account_code": "2300", "account_name": "Lease Liability", "debit": principal, "credit": 0},
            {"account_code": "1010", "account_name": "Bank Account", "debit": 0, "credit": payment},
        ],
        db=db,
        auto_post=True,
    )
    je_ids.append(je3.id)

    new_acc_dep = _f(lease.accumulated_depreciation) + monthly_dep
    new_ll = closing if closing else max(_f(lease.lease_liability_current) - principal, 0)
    new_rou = max(_f(lease.rou_asset_current) - monthly_dep, 0)

    update_lease(
        db,
        lease,
        {
            "je_posted": True,
            "last_je_date": period_date.isoformat(),
            "lease_liability_current": new_ll,
            "rou_asset_current": new_rou,
            "accumulated_depreciation": new_acc_dep,
            "depreciation_ytd": _f(lease.depreciation_ytd) + monthly_dep,
            "interest_ytd": _f(lease.interest_ytd) + interest,
        },
    )

    return {
        "success": True,
        "je_ids": je_ids,
        "period_date": period_date.isoformat(),
        "lease_name": name,
        "amounts": {
            "depreciation": round(monthly_dep, 2),
            "interest": round(interest, 2),
            "payment": round(payment, 2),
            "principal": round(principal, 2),
        },
    }


def post_all_monthly_jes(
    db: Session,
    workspace_id: str,
    company_id: str | None,
    period_date: date,
) -> dict[str, Any]:
    from app.modules.ifrs16.ifrs16_repository import list_leases

    leases = list_leases(db, workspace_id, company_id, status="active")
    results = []
    for l in leases:
        try:
            r = post_monthly_jes(db, l["id"], period_date, workspace_id, company_id)
            results.append({"lease_id": l["id"], "lease_name": l["lease_name"], "status": "success", **r})
        except Exception as exc:
            results.append({"lease_id": l["id"], "lease_name": l["lease_name"], "status": "error", "error": str(exc)})
    return {
        "period_date": period_date.isoformat(),
        "total": len(leases),
        "successful": sum(1 for r in results if r["status"] == "success"),
        "failed": sum(1 for r in results if r["status"] == "error"),
        "results": results,
    }
