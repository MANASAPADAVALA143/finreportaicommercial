"""KPI ratios from simplified financial actuals."""

from __future__ import annotations

from typing import Any


def _rag(name: str, value: float | None, *, higher_is_better: bool, ok_hi: float, warn_hi: float) -> str:
    if value is None:
        return "amber"
    if higher_is_better:
        if value >= ok_hi:
            return "green"
        if value >= warn_hi:
            return "amber"
        return "red"
    if value <= ok_hi:
        return "green"
    if value <= warn_hi:
        return "amber"
    return "red"


def analyze_kpis(actuals: dict[str, Any]) -> dict[str, Any]:
    rev = float(actuals.get("revenue", 0) or 0)
    cogs = float(actuals.get("cogs", 0) or 0)
    opex = float(actuals.get("opex", 0) or 0)
    cash = float(actuals.get("cash", 0) or 0)
    ar = float(actuals.get("ar", 0) or 0)
    ap = float(actuals.get("ap", 0) or 0)
    prior = actuals.get("prior_revenue")
    prior_rev = float(prior) if prior is not None else None

    gross_margin_pct = ((rev - cogs) / rev * 100.0) if rev else None
    ebitda_pct = ((rev - cogs - opex) / rev * 100.0) if rev else None
    net_margin_pct = ebitda_pct
    current_ratio = ((cash + ar) / ap) if ap > 0 else None
    dso = (ar / rev * 365.0) if rev > 0 else None
    dpo = (ap / cogs * 365.0) if cogs > 0 else None
    revenue_growth_pct = None
    if prior_rev and prior_rev > 0:
        revenue_growth_pct = (rev - prior_rev) / prior_rev * 100.0

    kpis: list[dict[str, Any]] = []
    kpis.append(
        {
            "name": "gross_margin_pct",
            "value": gross_margin_pct,
            "unit": "%",
            "rag": _rag("gm", gross_margin_pct, higher_is_better=True, ok_hi=35, warn_hi=20),
        }
    )
    kpis.append(
        {
            "name": "ebitda_pct",
            "value": ebitda_pct,
            "unit": "%",
            "rag": _rag("ebitda", ebitda_pct, higher_is_better=True, ok_hi=15, warn_hi=8),
        }
    )
    kpis.append(
        {
            "name": "net_margin_pct",
            "value": net_margin_pct,
            "unit": "%",
            "rag": _rag("net", net_margin_pct, higher_is_better=True, ok_hi=10, warn_hi=4),
        }
    )
    kpis.append(
        {
            "name": "current_ratio",
            "value": current_ratio,
            "unit": "x",
            "rag": _rag("cr", current_ratio, higher_is_better=True, ok_hi=1.5, warn_hi=1.0),
        }
    )
    kpis.append(
        {
            "name": "dso_days",
            "value": dso,
            "unit": "days",
            "rag": _rag("dso", dso, higher_is_better=False, ok_hi=45, warn_hi=60),
        }
    )
    kpis.append(
        {
            "name": "dpo_days",
            "value": dpo,
            "unit": "days",
            "rag": _rag("dpo", dpo, higher_is_better=True, ok_hi=35, warn_hi=25),
        }
    )
    kpis.append(
        {
            "name": "revenue_growth_pct",
            "value": revenue_growth_pct,
            "unit": "%",
            "rag": _rag("growth", revenue_growth_pct, higher_is_better=True, ok_hi=5, warn_hi=0)
            if revenue_growth_pct is not None
            else "amber",
        }
    )

    score_map = {"green": 3, "amber": 2, "red": 1}
    avg = sum(score_map.get(k["rag"], 2) for k in kpis) / max(len(kpis), 1)
    if avg >= 2.5:
        overall = "green"
    elif avg >= 1.9:
        overall = "amber"
    else:
        overall = "red"

    watch_list = [k["name"] for k in kpis if k.get("rag") == "red"]

    return {
        "kpis": kpis,
        "overall_rating": overall,
        "watch_list": watch_list,
        "inputs": {"revenue": rev, "cogs": cogs, "opex": opex, "cash": cash, "ar": ar, "ap": ap},
    }
