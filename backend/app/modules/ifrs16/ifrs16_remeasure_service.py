"""IFRS 16 CPI / index remeasurement with JE posting."""
from __future__ import annotations

import json
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.modules.ifrs16.ifrs16_cpi_remeasure import remeasure_cpi
from app.modules.ifrs16.ifrs16_repository import get_lease, update_lease
from app.services.uae_journal_service import create_journal_entry


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def remeasure_lease(
    db: Session,
    *,
    lease_id: str,
    remeasurement_date: date,
    new_cpi_rate: float,
    new_annual_payment_aed: float,
    workspace_id: str,
    company_id: str | None,
) -> dict[str, Any]:
    lease = get_lease(db, lease_id, workspace_id, company_id)
    if not lease:
        raise ValueError("Lease not found")

    end_date = lease.commencement_date + timedelta(days=lease.lease_term_months * 30)
    remaining_months = max(
        (end_date.year - remeasurement_date.year) * 12
        + (end_date.month - remeasurement_date.month),
        1,
    )

    monthly_pay = new_annual_payment_aed / 12
    ibr_pct = _f(lease.incremental_borrowing_rate) * 100

    result = remeasure_cpi({
        "original_monthly_payment": _f(lease.lease_payments_aed),
        "original_ibr": ibr_pct,
        "original_cpi": 100.0,
        "new_cpi": 100.0 + new_cpi_rate,
        "remeasurement_date": remeasurement_date.isoformat(),
        "remaining_term_months": remaining_months,
        "current_liability_balance": _f(lease.lease_liability_current),
        "current_rou_balance": _f(lease.rou_asset_current),
    })

    # Override with explicit new annual payment PV if provided
    ibr = _f(lease.incremental_borrowing_rate)
    monthly_rate = ibr / 12
    if monthly_rate == 0:
        new_ll = monthly_pay * remaining_months
    else:
        df = (1 - (1 + monthly_rate) ** -remaining_months) / monthly_rate
        new_ll = monthly_pay * df

    old_ll = _f(lease.lease_liability_current)
    difference = new_ll - old_ll
    new_rou = _f(lease.rou_asset_current) + difference

    je_id = None
    if abs(difference) > 0.01:
        if difference > 0:
            lines = [
                {"account_code": "1600", "account_name": "ROU Asset", "debit": difference, "credit": 0},
                {"account_code": "2300", "account_name": "Lease Liability", "debit": 0, "credit": difference},
            ]
        else:
            adj = abs(difference)
            lines = [
                {"account_code": "2300", "account_name": "Lease Liability", "debit": adj, "credit": 0},
                {"account_code": "1600", "account_name": "ROU Asset", "debit": 0, "credit": adj},
            ]
        je = create_journal_entry(
            tenant_id=workspace_id,
            company_id=company_id,
            entry_date=remeasurement_date,
            description=f"IFRS 16 CPI Remeasure: {lease.lease_name}",
            reference=f"IFRS16-{lease_id[:8]}-REM",
            source="IFRS16_REMEASUREMENT",
            lines=lines,
            db=db,
            auto_post=True,
        )
        je_id = je.id

    calc: dict = {}
    if lease.calculation_json:
        try:
            calc = json.loads(lease.calculation_json)
        except json.JSONDecodeError:
            calc = {}
    calc["amortization_schedule"] = result.get("updated_amortization_schedule", [])
    calc["remeasurement"] = {
        "date": remeasurement_date.isoformat(),
        "old_liability": old_ll,
        "new_liability": round(new_ll, 2),
        "difference": round(difference, 2),
    }

    next_rem = remeasurement_date + timedelta(days=365)
    update_lease(
        db,
        lease,
        {
            "lease_liability_current": round(new_ll, 2),
            "rou_asset_current": round(new_rou, 2),
            "lease_payments_aed": Decimal(str(monthly_pay)),
            "next_remeasurement_date": next_rem.isoformat(),
            "calculation_results": calc,
        },
    )

    return {
        "old_liability": round(old_ll, 2),
        "new_liability": round(new_ll, 2),
        "difference": round(difference, 2),
        "remeasurement_je_id": je_id,
        "new_schedule": result.get("updated_amortization_schedule", []),
        "new_rou_asset": round(new_rou, 2),
    }
