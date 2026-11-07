"""IFRS 16 monthly journals, prepared in uae_journal_entries for approval.

The three monthly entries (depreciation, interest, payment) are created as
'pending_approval'; they post only when a finance manager approves them.
"""
from __future__ import annotations

import json
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.models.ifrs16_lease import IFRS16Lease
from app.models.uae_accounting_full import UAEJournalEntry
from app.modules.ifrs16.ifrs16_repository import get_lease, update_lease
from app.services.uae_journal_service import create_journal_entry

DEPRECIATION = ("7112", "Depreciation - ROU Asset")
ACC_DEPRECIATION = ("2011", "Accumulated Depreciation - ROU")
LEASE_INTEREST = ("7170", "Interest Expense (IFRS 16)")
LEASE_LIABILITY = ("3030", "Lease Liability - Current (IFRS 16)")
BANK = ("1002", "Cash at Bank")


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
    return None


def monthly_amounts(lease: IFRS16Lease, period_date: date) -> dict[str, float]:
    """Depreciation, interest, payment and principal for the month, from the stored schedule when present."""
    calc: dict = {}
    if lease.calculation_json:
        try:
            calc = json.loads(lease.calculation_json)
        except json.JSONDecodeError:
            calc = {}
    schedule = calc.get("amortization_schedule") or []
    if isinstance(schedule, str):
        schedule = json.loads(schedule)
    monthly_dep = _f(lease.rou_asset_initial) / max(lease.lease_term_months or 1, 1)
    row = _find_schedule_row(schedule, period_date)
    if row:
        interest = _f(row.get("Interest") or row.get("interest"))
        principal = _f(row.get("Principal") or row.get("principal"))
        payment = _f(row.get("Payment") or row.get("payment"))
        closing = _f(row.get("Closing_Balance") or row.get("closing_liability"))
    else:
        opening = _f(lease.lease_liability_current)
        interest = opening * (_f(lease.incremental_borrowing_rate) / 12)
        payment = _f(lease.lease_payments_aed)
        principal = payment - interest
        closing = opening - principal
    return {
        "depreciation": round(monthly_dep, 2), "interest": round(interest, 2),
        "payment": round(payment, 2), "principal": round(principal, 2), "closing_liability": round(closing, 2),
    }


def journal_drafts(lease: IFRS16Lease, period_date: date) -> list[dict[str, Any]]:
    """The month's three entries; interest accrues to the liability, so the payment clears it in full."""
    a = monthly_amounts(lease, period_date)
    period = period_date.strftime("%Y-%m")
    name = lease.lease_name
    base = f"IFRS16-{lease.id[:8]}"
    drafts = [
        {"kind": "DEP", "description": f"IFRS 16 Depreciation: {name}", "amount": a["depreciation"], "lines": [
            {"account_code": DEPRECIATION[0], "account_name": DEPRECIATION[1], "debit": a["depreciation"], "credit": 0},
            {"account_code": ACC_DEPRECIATION[0], "account_name": ACC_DEPRECIATION[1], "debit": 0, "credit": a["depreciation"]},
        ]},
        {"kind": "INT", "description": f"IFRS 16 Interest: {name}", "amount": a["interest"], "lines": [
            {"account_code": LEASE_INTEREST[0], "account_name": LEASE_INTEREST[1], "debit": a["interest"], "credit": 0},
            {"account_code": LEASE_LIABILITY[0], "account_name": LEASE_LIABILITY[1], "debit": 0, "credit": a["interest"]},
        ]},
        {"kind": "PAY", "description": f"IFRS 16 Payment: {name}", "amount": a["payment"], "lines": [
            {"account_code": LEASE_LIABILITY[0], "account_name": LEASE_LIABILITY[1], "debit": a["payment"], "credit": 0},
            {"account_code": BANK[0], "account_name": BANK[1], "debit": 0, "credit": a["payment"]},
        ]},
    ]
    for d in drafts:
        d["reference"] = f"{base}-{d['kind']}-{period}"
    return [d for d in drafts if d["amount"] > 0]


def existing_journals(db: Session, workspace_id: str, lease_id: str, period: str) -> list[UAEJournalEntry]:
    return db.query(UAEJournalEntry).filter(
        UAEJournalEntry.tenant_id == workspace_id,
        UAEJournalEntry.reference.like(f"IFRS16-{lease_id[:8]}-%-{period}"),
        UAEJournalEntry.status.in_(("pending_approval", "posted", "draft")),
    ).all()


def apply_approved_lease_journal(db: Session, lease_id: str, kind: str, amount: float, entry_date: date) -> None:
    """Advance the lease register when a close-prepared lease journal is approved and posted."""
    lease = db.get(IFRS16Lease, lease_id)
    if lease is None:
        return
    if kind == "DEP":
        lease.rou_asset_current = max(_f(lease.rou_asset_current) - amount, 0)
        lease.accumulated_depreciation = _f(lease.accumulated_depreciation) + amount
        lease.depreciation_ytd = _f(lease.depreciation_ytd) + amount
    elif kind == "INT":
        lease.lease_liability_current = _f(lease.lease_liability_current) + amount
        lease.interest_ytd = _f(lease.interest_ytd) + amount
    elif kind == "PAY":
        lease.lease_liability_current = max(_f(lease.lease_liability_current) - amount, 0)
    lease.je_posted = True
    lease.last_je_date = entry_date
    db.add(lease)


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
    period = period_date.strftime("%Y-%m")
    if existing_journals(db, workspace_id, lease_id, period):
        raise ValueError(f"IFRS 16 journals for {lease.lease_name} in {period} already exist")

    a = monthly_amounts(lease, period_date)
    je_ids: list[str] = []
    for d in journal_drafts(lease, period_date):
        je = create_journal_entry(
            tenant_id=workspace_id, company_id=company_id, entry_date=period_date,
            description=d["description"], reference=d["reference"],
            source={"DEP": "IFRS16_DEPRECIATION", "INT": "IFRS16_INTEREST", "PAY": "IFRS16_PAYMENT"}[d["kind"]],
            lines=d["lines"], db=db, initial_status="pending_approval",
        )
        je_ids.append(je.id)

    new_ll = a["closing_liability"] if a["closing_liability"] else max(_f(lease.lease_liability_current) - a["principal"], 0)
    update_lease(
        db,
        lease,
        {
            "je_posted": True,
            "last_je_date": period_date.isoformat(),
            "lease_liability_current": new_ll,
            "rou_asset_current": max(_f(lease.rou_asset_current) - a["depreciation"], 0),
            "accumulated_depreciation": _f(lease.accumulated_depreciation) + a["depreciation"],
            "depreciation_ytd": _f(lease.depreciation_ytd) + a["depreciation"],
            "interest_ytd": _f(lease.interest_ytd) + a["interest"],
        },
    )

    return {
        "success": True,
        "status": "pending_approval",
        "je_ids": je_ids,
        "period_date": period_date.isoformat(),
        "lease_name": lease.lease_name,
        "amounts": {k: a[k] for k in ("depreciation", "interest", "payment", "principal")},
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
            results.append({**r, "lease_id": l["id"], "lease_name": l["lease_name"], "status": "success",
                            "journal_status": r["status"]})
        except Exception as exc:
            db.rollback()
            results.append({"lease_id": l["id"], "lease_name": l["lease_name"], "status": "error", "error": str(exc)})
    return {
        "period_date": period_date.isoformat(),
        "total": len(leases),
        "successful": sum(1 for r in results if r["status"] == "success"),
        "failed": sum(1 for r in results if r["status"] == "error"),
        "results": results,
    }
