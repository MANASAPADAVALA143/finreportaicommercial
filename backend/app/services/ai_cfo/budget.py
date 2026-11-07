"""Monthly budgets from the FP&A master upload (fpa_master_data, section PL).

Budget rows are keyed by ap_companies.id, which the app creates with the same UUID as the
UAE company profile. Each row holds twelve calendar-month values (Jan..Dec) for a fiscal
year labelled "FY2026" or "2026"; the budget for "2026-03" is element 3 of that year.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models.fpa_master import FpaMasterRow


def budget_by_account(db: Session, company_id: str, period: str) -> dict[str, dict[str, Any]]:
    year, month_index = period[:4], int(period[5:7]) - 1
    rows = (
        db.query(FpaMasterRow)
        .filter(
            FpaMasterRow.company_id == company_id,
            FpaMasterRow.section == "PL",
            FpaMasterRow.fiscal_year.in_((f"FY{year}", year)),
        )
        .all()
    )
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        code = (row.account_code or "").strip()
        budgets = row.budgets_list()
        if not code or len(budgets) <= month_index:
            continue
        try:
            value = round(float(budgets[month_index] or 0), 2)
        except (TypeError, ValueError):
            continue
        entry = out.setdefault(code, {"account_name": row.account_name, "budget": 0.0, "fiscal_year": row.fiscal_year})
        entry["budget"] = round(entry["budget"] + value, 2)
    return out
