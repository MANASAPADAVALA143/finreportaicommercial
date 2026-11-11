"""Exchange rates for group closes and translation of an entity agent's output into the
reporting currency.

Balances (bank, receivables, payables, investments, provisions) and forecasts translate at
the period's closing rate; flows of the period (revenue, expenses, invoices raised, income)
at the average rate. Counts, days, rates and percentages are not amounts and are left as
they are.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models.ai_close import AiCloseFxRate

AVERAGE_FIELDS = {
    "ap_processing": {"invoice_value", "register"},
    "ifrs": {"missing_accruals"},
    "fpa": {"revenue", "expenses", "operating_profit", "prior_three_months", "variance", "accounts",
            "materiality", "monthly_cost_assumption"},
    "investment": {"month_income", "month_movement"},
}
AVERAGE_KEYS = {"income", "expense", "profit_to_date"}
NOT_AMOUNTS = {
    "lines", "matched", "statements", "unmatched_bank", "unmatched_ledger", "total_lines", "goods_receipts_evaluated",
    "invoices_processed", "avg_days_to_pay", "days_overdue", "invoices_issued_in_period", "open_invoices",
    "checks_evaluated", "checks_failed", "checks_passed", "remaining_months", "term_months", "months_of_history",
    "history_months", "day", "holdings_count", "mismatch", "no_po", "partial", "three_way_matched", "year",
}
NOT_AMOUNT_TREES = {"ecl_rates", "limits", "match_summary", "seasonality"}


def rate(db: Session, workspace_id: str, period: str, currency: str, reporting: str) -> AiCloseFxRate | None:
    return db.query(AiCloseFxRate).filter(
        AiCloseFxRate.workspace_id == workspace_id, AiCloseFxRate.period == period,
        AiCloseFxRate.currency == currency, AiCloseFxRate.reporting_currency == reporting).first()


def _is_amount_key(key: str) -> bool:
    k = key.lower()
    return not (k in NOT_AMOUNTS or k.endswith("pct") or k.endswith("count") or k == "id" or k.endswith("_id")
                or k.endswith("number"))


def _scale(value: Any, factor: float, key: str, average: float) -> Any:
    if key in NOT_AMOUNT_TREES:
        return value
    if key in AVERAGE_KEYS:
        factor = average
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return round(value * factor, 2) if _is_amount_key(key) else value
    if isinstance(value, dict):
        return {k: _scale(v, factor, k, average) for k, v in value.items()}
    if isinstance(value, list):
        return [_scale(v, factor, key, average) for v in value]
    return value


def translate_output(agent: str | None, output: dict[str, Any], average: float, closing: float) -> dict[str, Any]:
    flows = AVERAGE_FIELDS.get(agent or "", set())
    return {k: _scale(v, average if k in flows else closing, k, average) for k, v in output.items()}
