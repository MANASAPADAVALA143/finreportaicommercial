"""Deterministic budget vs actual variance math for the Excel add-in."""

from __future__ import annotations

import re
from typing import Any

_REV_HINT = re.compile(
    r"\b(revenue|sales|turnover|income|top\s*line|toi)\b",
    re.IGNORECASE,
)


def _is_revenue_account(account: str) -> bool:
    return bool(_REV_HINT.search(account or ""))


def _favorable(actual: float, budget: float, account: str) -> bool:
    """Heuristic: revenue lines favor actual >= budget; cost lines favor actual <= budget."""
    if _is_revenue_account(account):
        return actual >= budget
    return actual <= budget


def analyze_rows(
    rows: list[dict[str, Any]],
    variance_pct_threshold: float = 5.0,
) -> dict[str, Any]:
    """
    Takes rows with account, budget, actual.
    Returns enriched rows, flags, top 3 favorable / top 3 adverse by |variance_amount|.
    """
    thr = float(variance_pct_threshold) if variance_pct_threshold else 5.0
    enriched: list[dict[str, Any]] = []
    for raw in rows:
        account = str(raw.get("account", "") or "").strip()
        budget = float(raw.get("budget", 0) or 0)
        actual = float(raw.get("actual", 0) or 0)
        variance_amount = actual - budget
        if budget == 0:
            variance_pct: float | None = None
        else:
            variance_pct = (variance_amount / budget) * 100.0
        flagged = variance_pct is not None and abs(variance_pct) > thr
        favorable = _favorable(actual, budget, account)
        enriched.append(
            {
                "account": account,
                "budget": budget,
                "actual": actual,
                "variance_amount": variance_amount,
                "variance_pct": variance_pct,
                "flagged": flagged,
                "favorable": favorable,
            }
        )

    favorable_rows = [r for r in enriched if r["favorable"]]
    adverse_rows = [r for r in enriched if not r["favorable"]]

    def by_abs_amount(r: dict[str, Any]) -> float:
        return abs(float(r["variance_amount"]))

    top_3_fav = sorted(favorable_rows, key=by_abs_amount, reverse=True)[:3]
    top_3_adv = sorted(adverse_rows, key=by_abs_amount, reverse=True)[:3]

    return {
        "rows": enriched,
        "top_3_fav": top_3_fav,
        "top_3_adv": top_3_adv,
    }
