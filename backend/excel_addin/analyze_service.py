"""Single entry: route by analysis_type → ml engines → shared Claude narrators."""

from __future__ import annotations

from typing import Any

from excel_addin import (
    claude_layer,
    ml_engine_anomaly,
    ml_engine_budget,
    ml_engine_forecast,
    ml_engine_kpi,
    ml_engine_reports,
    ml_engine_scenarios,
    ml_engine_variance,
)

_ALLOWED = frozenset(
    {"variance", "anomaly", "forecast", "kpi", "scenario", "report", "budget"}
)


def _filter_department(rows: list[dict[str, Any]], dept: Any) -> list[dict[str, Any]]:
    if dept is None:
        return rows
    d = str(dept).strip().lower()
    if not d or d in ("all", "*", "any"):
        return rows
    out = []
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        acc = str(r.get("account", r.get("name", ""))).lower()
        if d in acc:
            out.append(r)
    return out


def run(data: dict[str, Any]) -> dict[str, Any]:
    at = str(data.get("analysis_type", "")).strip().lower()
    if at not in _ALLOWED:
        raise ValueError(f"analysis_type must be one of: {sorted(_ALLOWED)}")

    company = str(data.get("company", "") or "").strip() or "Unknown"
    period = str(data.get("period", "") or "").strip()
    currency = str(data.get("currency", "") or "USD").strip() or "USD"
    thresholds = data.get("thresholds") if isinstance(data.get("thresholds"), dict) else {}
    filters = data.get("filters") if isinstance(data.get("filters"), dict) else {}
    rows = data.get("rows") if isinstance(data.get("rows"), list) else []

    ml: dict[str, Any]

    if at == "variance":
        dept = filters.get("department")
        rows_f = _filter_department([r for r in rows if isinstance(r, dict)], dept)
        if not rows_f:
            raise ValueError("variance requires at least one row after department filter")
        thr = float(thresholds.get("variance_pct", 5) or 5)
        ml = ml_engine_variance.analyze_rows(rows_f, variance_pct_threshold=thr)

    elif at == "anomaly":
        ml = ml_engine_anomaly.analyze([r for r in rows if isinstance(r, dict)], filters)

    elif at == "budget":
        if not rows:
            raise ValueError("budget requires rows as [{name, budget, spent}, ...]")
        ml = ml_engine_budget.analyze_departments([r for r in rows if isinstance(r, dict)])

    elif at == "forecast":
        monthly = rows or filters.get("monthly_actuals") or []
        if not isinstance(monthly, list) or len(monthly) < 2:
            raise ValueError("forecast requires at least 2 monthly rows [{month, revenue, costs}]")
        ml = ml_engine_forecast.analyze_forecast([r for r in monthly if isinstance(r, dict)])

    elif at == "kpi":
        actuals: dict[str, Any] = {}
        if rows and isinstance(rows[0], dict) and "revenue" in rows[0]:
            actuals = dict(rows[0])
        elif isinstance(filters.get("actuals"), dict):
            actuals = dict(filters["actuals"])
        if not actuals:
            raise ValueError("kpi requires rows[0] with revenue/cogs/... or filters.actuals")
        ml = ml_engine_kpi.analyze_kpis(actuals)

    elif at == "scenario":
        base = filters.get("base")
        if not isinstance(base, dict):
            base = {}
        if rows and isinstance(rows[0], dict):
            for k in ("revenue", "cogs", "opex"):
                if k in rows[0]:
                    base[k] = float(rows[0][k])
        base.setdefault("revenue", 0.0)
        base.setdefault("cogs", 0.0)
        base.setdefault("opex", 0.0)
        adj = filters.get("adjustments") if isinstance(filters.get("adjustments"), dict) else {}
        scenario_name = str(filters.get("scenario", "") or "").lower()
        if "worst" in scenario_name or "pessim" in scenario_name:
            adj = {**adj, "pessimistic_rev_pct": float(adj.get("pessimistic_rev_pct", -10) or -10)}
        if "best" in scenario_name or "optim" in scenario_name:
            adj = {**adj, "optimistic_rev_pct": float(adj.get("optimistic_rev_pct", 10) or 10)}
        ml = ml_engine_scenarios.analyze_scenarios(base, adj)
        ml["controls_scenario"] = filters.get("scenario")

    elif at == "report":
        ml = ml_engine_reports.aggregate(
            filters.get("variance_summary"),
            filters.get("kpi_summary"),
            filters.get("forecast_summary"),
            filters.get("cash_position"),
        )

    else:
        raise ValueError(f"Unhandled analysis_type: {at}")

    narrative = claude_layer.narrate_for_analysis_type(at, ml, company, period, currency)

    return {
        "analysis_type": at,
        "company": company,
        "period": period,
        "currency": currency,
        "thresholds": thresholds,
        "filters": filters,
        "ml_engine": ml,
        "narrative": narrative,
    }
