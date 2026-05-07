"""Map legacy /api/excel-addin/* POST bodies to analyze_service + legacy response shapes."""

from __future__ import annotations

from typing import Any


def to_analyze_variance(data: dict[str, Any]) -> dict[str, Any]:
    rows = data.get("rows") or []
    if isinstance(rows, list) and rows and not isinstance(rows[0], dict):
        rows = [r for r in rows if isinstance(r, dict)]
    return {
        "analysis_type": "variance",
        "company": data["company"],
        "period": data.get("period") or "",
        "currency": data.get("currency") or "USD",
        "thresholds": {},
        "filters": {},
        "rows": list(rows),
    }


def response_variance(out: dict[str, Any]) -> dict[str, Any]:
    n = out.get("narrative") or {}
    legacy: dict[str, Any] = {
        "company": out.get("company"),
        "period": out.get("period"),
        "currency": out.get("currency"),
        "ml_engine": out.get("ml_engine"),
        "executive_summary": n.get("executive_summary", ""),
        "variances": n.get("variances", []),
        "management_actions": n.get("management_actions", []),
    }
    if n.get("error"):
        legacy["claude_error"] = n["error"]
    return legacy


def to_analyze_budget(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "analysis_type": "budget",
        "company": data["company"],
        "period": data.get("period") or "",
        "currency": data.get("currency") or "USD",
        "thresholds": {},
        "filters": {},
        "rows": list(data.get("departments") or []),
    }


def response_budget(out: dict[str, Any]) -> dict[str, Any]:
    ml = out.get("ml_engine") or {}
    n = out.get("narrative") or {}
    legacy = {
        "company": out.get("company"),
        "period": out.get("period"),
        "currency": out.get("currency"),
        "departments": ml.get("departments", []),
        "alerts": ml.get("alerts", []),
        "budget_health": n.get("budget_health", ""),
        "commentary": n.get("commentary", ""),
    }
    if n.get("error"):
        legacy["claude_error"] = n["error"]
    return legacy


def to_analyze_kpi(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "analysis_type": "kpi",
        "company": data["company"],
        "period": data.get("period") or "",
        "currency": data.get("currency") or "USD",
        "thresholds": {},
        "filters": {"actuals": data.get("actuals") or {}},
        "rows": [],
    }


def response_kpi(out: dict[str, Any]) -> dict[str, Any]:
    ml = out.get("ml_engine") or {}
    n = out.get("narrative") or {}
    legacy = {
        "company": out.get("company"),
        "period": out.get("period"),
        "currency": out.get("currency"),
        "kpis": ml.get("kpis", []),
        "overall_rating": ml.get("overall_rating"),
        "watch_list": ml.get("watch_list", []),
        "narrative": n.get("narrative", ""),
    }
    if n.get("error"):
        legacy["claude_error"] = n["error"]
    return legacy


def to_analyze_forecast(data: dict[str, Any]) -> dict[str, Any]:
    monthly = data.get("monthly_actuals") or []
    return {
        "analysis_type": "forecast",
        "company": data["company"],
        "period": "",
        "currency": data.get("currency") or "USD",
        "thresholds": {},
        "filters": {},
        "rows": list(monthly),
    }


def response_forecast(out: dict[str, Any]) -> dict[str, Any]:
    ml = out.get("ml_engine") or {}
    n = out.get("narrative") or {}
    legacy = {
        "company": out.get("company"),
        "currency": out.get("currency"),
        "forecast_months": ml.get("forecast_months", []),
        "growth_rate": ml.get("growth_rate_pct"),
        "seasonality_index": ml.get("seasonality_index"),
        "narrative": n.get("narrative", ""),
        "risks": n.get("risks", []),
    }
    if n.get("error"):
        legacy["claude_error"] = n["error"]
    return legacy


def to_analyze_scenarios(data: dict[str, Any]) -> dict[str, Any]:
    base = data.get("base") or {}
    adj = data.get("adjustments") or {}
    return {
        "analysis_type": "scenario",
        "company": data["company"],
        "period": "",
        "currency": data.get("currency") or "USD",
        "thresholds": {},
        "filters": {"base": base, "adjustments": adj},
        "rows": [],
    }


def response_scenarios(out: dict[str, Any]) -> dict[str, Any]:
    ml = out.get("ml_engine") or {}
    n = out.get("narrative") or {}
    legacy = {
        "company": out.get("company"),
        "currency": out.get("currency"),
        "base": ml.get("base"),
        "optimistic": ml.get("optimistic"),
        "pessimistic": ml.get("pessimistic"),
        "recommendation": n.get("recommendation", ""),
        "narrative": n.get("narrative", ""),
    }
    if n.get("error"):
        legacy["claude_error"] = n["error"]
    return legacy


def to_analyze_reports(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "analysis_type": "report",
        "company": data["company"],
        "period": data.get("period") or "",
        "currency": data.get("currency") or "USD",
        "thresholds": {},
        "filters": {
            "variance_summary": data.get("variance_summary"),
            "kpi_summary": data.get("kpi_summary"),
            "forecast_summary": data.get("forecast_summary"),
            "cash_position": data.get("cash_position"),
        },
        "rows": [],
    }


def response_reports(out: dict[str, Any]) -> dict[str, Any]:
    ml = out.get("ml_engine") or {}
    n = out.get("narrative") or {}
    legacy = {
        "company": out.get("company"),
        "period": out.get("period"),
        "currency": out.get("currency"),
        "health_score": ml.get("health_score"),
        "executive_summary": n.get("executive_summary", ""),
        "sections": n.get("sections", []),
        "strategic_recommendations": n.get("strategic_recommendations", []),
        "email_summary": n.get("email_summary", ""),
    }
    if n.get("error"):
        legacy["claude_error"] = n["error"]
    return legacy
