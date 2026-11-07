"""Deterministic impact projection for one expense account (no model involved)."""
from __future__ import annotations

from statistics import mean
from typing import Any

from app.services.ai_cfo.ledger import period_add


def months_to_fiscal_year_end(period: str, fiscal_year_start_month: int) -> int:
    """Months after `period` up to and including the last month of its fiscal year."""
    month = int(period[5:7])
    last_month = (fiscal_year_start_month - 2) % 12 + 1
    return (last_month - month) % 12


def project_expense_impact(
    history: dict[str, float], period: str, months_ahead: int
) -> dict[str, Any]:
    """Compare 'spike is one-time' with 'spike recurs' over the next `months_ahead` months.

    `history` maps prior periods to the account's monthly expense; `period` is the month of
    the increase and must not be in `history`.
    """
    prior = [history[p] for p in sorted(history) if p < period]
    current = history.get(period)
    if current is None:
        raise ValueError("history must include the analysed period")
    baseline = round(mean(prior), 2) if prior else 0.0
    increase = round(current - baseline, 2)
    months = [period_add(period, i) for i in range(1, months_ahead + 1)]
    recurring_extra = round(increase * months_ahead, 2)
    return {
        "period": period,
        "baseline_monthly": baseline,
        "baseline_months_used": len(prior),
        "current_month": round(current, 2),
        "increase_this_month": increase,
        "projection_months": months,
        "scenarios": {
            "one_time": {
                "monthly_expense": baseline,
                "additional_cost_over_horizon": 0.0,
                "operating_profit_impact_this_year": -increase,
            },
            "recurring": {
                "monthly_expense": round(current, 2),
                "additional_cost_over_horizon": recurring_extra,
                "operating_profit_impact_this_year": -round(increase + recurring_extra, 2),
            },
        },
        "assumptions": [
            f"Baseline is the average of {len(prior)} prior month(s) of posted expense on this account.",
            "One-time scenario: spending returns to baseline from next month.",
            f"Recurring scenario: spending stays at this month's level for the next {months_ahead} month(s).",
            "Projection uses posted ledger activity only; open purchase orders and unposted accruals are not included.",
        ],
    }
