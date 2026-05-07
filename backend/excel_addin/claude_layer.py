"""Shared CFO narrative layer (Anthropic Claude, JSON-only contracts per module)."""

from __future__ import annotations

import json
import os
import re
from typing import Any

from app.services import llm_service

_DEFAULT_MODEL = os.getenv("ANTHROPIC_EXCEL_ADDIN_VARIANCE_MODEL", "claude-sonnet-4-20250514")


def _strip_json_fence(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t, flags=re.IGNORECASE)
        t = re.sub(r"\s*```\s*$", "", t)
    return t.strip()


def invoke_cfo_json(system: str, user_payload: dict[str, Any], *, max_tokens: int = 4096) -> dict[str, Any]:
    """Call Claude with JSON-only system rules; return parsed dict or error envelope."""
    if not llm_service.is_configured():
        return {"error": "llm_not_configured", "raw": None}

    user_prompt = json.dumps(user_payload, indent=2, default=str)
    try:
        raw = llm_service.invoke(
            user_prompt,
            max_tokens=max_tokens,
            temperature=0.2,
            system=system,
            model_id=_DEFAULT_MODEL,
        )
        parsed = json.loads(_strip_json_fence(raw))
    except Exception as exc:  # noqa: BLE001
        return {"error": "claude_parse_or_api", "detail": str(exc), "raw": None}

    if not isinstance(parsed, dict):
        return {"error": "invalid_shape", "raw": None}
    return parsed


# --- Variance ---

_SYSTEM_VARIANCE = """You are a senior CFO analyst with Big 4 and FP&A experience.
Rules:
- Never recalculate variances, percentages, or flags; treat the provided JSON as ground truth.
- Use only the figures and row metadata given in the user message.
- Respond with a single JSON object only — no markdown fences, no prose before or after.
Required JSON shape:
{
  "executive_summary": string,
  "variances": [ { "account": string, "commentary": string, "action": string } ],
  "management_actions": [ string ]
}
Cover materially significant lines; you may omit trivial accounts."""


def narrate_variance(
    ml_output: dict[str, Any],
    company: str,
    period: str,
    currency: str,
) -> dict[str, Any]:
    if not llm_service.is_configured():
        return {
            "executive_summary": "ANTHROPIC_API_KEY is not configured; commentary unavailable.",
            "variances": [],
            "management_actions": [],
            "error": "llm_not_configured",
        }
    payload = {
        "company": company,
        "period": period,
        "currency": currency,
        "ml_engine": ml_output,
    }
    parsed = invoke_cfo_json(_SYSTEM_VARIANCE, payload)
    if parsed.get("error"):
        return {
            "executive_summary": f"Commentary unavailable: {parsed.get('detail', parsed['error'])}",
            "variances": [],
            "management_actions": [],
            "error": parsed["error"],
        }
    return {
        "executive_summary": str(parsed.get("executive_summary", "")),
        "variances": parsed.get("variances") if isinstance(parsed.get("variances"), list) else [],
        "management_actions": parsed.get("management_actions")
        if isinstance(parsed.get("management_actions"), list)
        else [],
    }


# --- Budget ---

_SYSTEM_BUDGET = """You are a senior CFO / FP&A lead.
Rules:
- Never recalculate spend_pct, remaining, burn_rate, or overspend flags; use ml_engine JSON as truth.
- Single JSON object only, no markdown fences.
Shape:
{
  "budget_health": string,
  "commentary": string
}
Use departments and alerts from the payload; add no new numeric fields."""


def narrate_budget(
    ml_output: dict[str, Any],
    company: str,
    period: str,
    currency: str,
) -> dict[str, Any]:
    payload = {"company": company, "period": period, "currency": currency, "ml_engine": ml_output}
    parsed = invoke_cfo_json(_SYSTEM_BUDGET, payload, max_tokens=3500)
    if parsed.get("error"):
        return {
            "budget_health": "Unavailable",
            "commentary": str(parsed.get("detail", parsed["error"])),
            "error": parsed["error"],
        }
    return {
        "budget_health": str(parsed.get("budget_health", "")),
        "commentary": str(parsed.get("commentary", "")),
    }


# --- KPI ---

_SYSTEM_KPI = """You are a CFO presenting KPIs to the board.
Rules:
- Never recalculate KPI values or RAG labels from ml_engine; treat them as ground truth.
- Single JSON object only, no markdown fences.
Shape:
{
  "narrative": string
}
Reference each KPI briefly with red/amber/green framing consistent with ml_engine rag."""


def narrate_kpi(
    ml_output: dict[str, Any],
    company: str,
    period: str,
    currency: str,
) -> dict[str, Any]:
    payload = {"company": company, "period": period, "currency": currency, "ml_engine": ml_output}
    parsed = invoke_cfo_json(_SYSTEM_KPI, payload, max_tokens=3500)
    if parsed.get("error"):
        return {"narrative": str(parsed.get("detail", parsed.get("error"))), "error": parsed.get("error")}
    return {"narrative": str(parsed.get("narrative", ""))}


# --- Forecast ---

_SYSTEM_FORECAST = """You are a CFO reviewing a quantitative forecast extension.
Rules:
- Never recalculate forecast_months, growth_rate_pct, or seasonality_index; ml_engine is truth.
- Single JSON object only, no markdown fences.
Shape:
{
  "narrative": string,
  "risks": [ string ]
}
"""


def narrate_forecast(
    ml_output: dict[str, Any],
    company: str,
    currency: str,
) -> dict[str, Any]:
    payload = {"company": company, "currency": currency, "ml_engine": ml_output}
    parsed = invoke_cfo_json(_SYSTEM_FORECAST, payload, max_tokens=3500)
    if parsed.get("error"):
        return {
            "narrative": str(parsed.get("detail", parsed.get("error"))),
            "risks": [],
            "error": parsed.get("error"),
        }
    return {
        "narrative": str(parsed.get("narrative", "")),
        "risks": parsed.get("risks") if isinstance(parsed.get("risks"), list) else [],
    }


# --- Scenarios ---

_SYSTEM_SCENARIOS = """You are a CFO choosing planning scenarios.
Rules:
- Never recalculate scenario revenue/cogs/opex/ebitda/net_profit; ml_engine is truth.
- Single JSON object only, no markdown fences.
Shape:
{
  "recommendation": string,
  "narrative": string
}
Pick one primary scenario to plan against (base / optimistic / pessimistic) with rationale."""


def narrate_scenarios(ml_output: dict[str, Any], company: str, currency: str) -> dict[str, Any]:
    payload = {"company": company, "currency": currency, "ml_engine": ml_output}
    parsed = invoke_cfo_json(_SYSTEM_SCENARIOS, payload, max_tokens=3000)
    if parsed.get("error"):
        return {
            "recommendation": "",
            "narrative": str(parsed.get("detail", parsed.get("error"))),
            "error": parsed.get("error"),
        }
    return {
        "recommendation": str(parsed.get("recommendation", "")),
        "narrative": str(parsed.get("narrative", "")),
    }


# --- Board pack / reports ---

_SYSTEM_REPORTS = """You are a CFO writing a board pack overview.
Rules:
- Never recalculate health_score; ml_engine aggregate is truth.
- Single JSON object only, no markdown fences.
Shape:
{
  "executive_summary": string,
  "sections": [ { "title": string, "body": string } ],
  "strategic_recommendations": [ string ],
  "email_summary": string
}
Use summaries_digest text only as context; do not invent new numeric KPIs."""


def narrate_reports(ml_output: dict[str, Any], company: str, period: str, currency: str) -> dict[str, Any]:
    payload = {
        "company": company,
        "period": period,
        "currency": currency,
        "ml_engine": ml_output,
    }
    parsed = invoke_cfo_json(_SYSTEM_REPORTS, payload, max_tokens=5000)
    if parsed.get("error"):
        return {
            "executive_summary": str(parsed.get("detail", parsed.get("error"))),
            "sections": [],
            "strategic_recommendations": [],
            "email_summary": "",
            "error": parsed.get("error"),
        }
    return {
        "executive_summary": str(parsed.get("executive_summary", "")),
        "sections": parsed.get("sections") if isinstance(parsed.get("sections"), list) else [],
        "strategic_recommendations": parsed.get("strategic_recommendations")
        if isinstance(parsed.get("strategic_recommendations"), list)
        else [],
        "email_summary": str(parsed.get("email_summary", "")),
    }


# --- Anomaly (unified analyze) ---

_SYSTEM_ANOMALY = """You are an audit / risk analyst.
Rules:
- Never recalculate z_score, severity, or flags; ml_engine JSON is ground truth.
- Single JSON object only, no markdown fences.
Shape:
{
  "executive_summary": string,
  "flagged_lines": [ { "label": string, "commentary": string } ],
  "management_actions": [ string ]
}
Reference only rows present in ml_engine.flagged."""


def narrate_anomaly(
    ml_output: dict[str, Any],
    company: str,
    period: str,
    currency: str,
) -> dict[str, Any]:
    if not llm_service.is_configured():
        return {
            "executive_summary": "ANTHROPIC_API_KEY is not configured; commentary unavailable.",
            "flagged_lines": [],
            "management_actions": [],
            "error": "llm_not_configured",
        }
    payload = {
        "company": company,
        "period": period,
        "currency": currency,
        "ml_engine": ml_output,
    }
    parsed = invoke_cfo_json(_SYSTEM_ANOMALY, payload, max_tokens=3500)
    if parsed.get("error"):
        return {
            "executive_summary": str(parsed.get("detail", parsed.get("error"))),
            "flagged_lines": [],
            "management_actions": [],
            "error": parsed.get("error"),
        }
    return {
        "executive_summary": str(parsed.get("executive_summary", "")),
        "flagged_lines": parsed.get("flagged_lines")
        if isinstance(parsed.get("flagged_lines"), list)
        else [],
        "management_actions": parsed.get("management_actions")
        if isinstance(parsed.get("management_actions"), list)
        else [],
    }


def narrate_for_analysis_type(
    analysis_type: str,
    ml_output: dict[str, Any],
    company: str,
    period: str,
    currency: str,
) -> dict[str, Any]:
    """Dispatch to the correct JSON narrator for POST /api/excel-addin/analyze."""
    at = (analysis_type or "").strip().lower()
    if at == "variance":
        return narrate_variance(ml_output, company, period, currency)
    if at == "anomaly":
        return narrate_anomaly(ml_output, company, period, currency)
    if at == "budget":
        return narrate_budget(ml_output, company, period, currency)
    if at == "kpi":
        return narrate_kpi(ml_output, company, period, currency)
    if at == "forecast":
        return narrate_forecast(ml_output, company, currency)
    if at == "scenario":
        return narrate_scenarios(ml_output, company, currency)
    if at == "report":
        return narrate_reports(ml_output, company, period, currency)
    return {
        "executive_summary": f"Unknown analysis_type: {analysis_type}",
        "error": "unknown_type",
    }
