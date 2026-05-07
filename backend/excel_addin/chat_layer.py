"""Controlled CFO chat: intent-aware locked prompts + Anthropic (FastAPI is the brain)."""

from __future__ import annotations

import json
import os
import re
from typing import Any

from anthropic import Anthropic

_DEFAULT_MODEL = os.getenv("ANTHROPIC_EXCEL_ADDIN_VARIANCE_MODEL", "claude-sonnet-4-20250514")

_MAX_HISTORY = 12


def _context_str(variance_context: Any) -> str:
    if isinstance(variance_context, str):
        return variance_context
    return json.dumps(variance_context, indent=2, default=str)


def _confidence(intent: str, variance_context: Any) -> str:
    if variance_context is None or variance_context == "":
        return "low"
    if isinstance(variance_context, dict):
        if not variance_context:
            return "low"
        if variance_context.get("ml_engine") or variance_context.get("rows"):
            return "high"
        if variance_context.get("forecast_months") or variance_context.get("kpis"):
            return "high"
        if len(json.dumps(variance_context)) > 80:
            return "medium"
        return "low"
    s = str(variance_context).strip()
    if len(s) > 200:
        return "medium"
    return "low" if not s else "medium"


# Locked system templates (user never sees raw templates from client).
_TEMPLATES: dict[str, str] = {
    "variance": """You are a CFO analyst.
Pre-calculated variance data:
{context}
Rules: Answer using ONLY the data provided. Be specific and cite the numbers. Maximum 3 sentences.
The user's current question is the final user message below.""",
    "anomaly": """You are an audit analyst.
Pre-calculated anomaly / risk context (may include variance flags, alerts, or uploaded summaries):
{context}
Rules: Explain only what is supported by this context. If nothing is flagged as anomalous, say so. Maximum 3 sentences.
The user's current question is the final user message below.""",
    "forecast": """You are an FP&A analyst.
Pre-calculated forecast / trend context:
{context}
Rules: Reference the trend or projection data only; do not invent new periods or figures. Maximum 3 sentences.
The user's current question is the final user message below.""",
    "kpi": """You are a CFO analyst focused on KPIs.
Pre-calculated KPI / performance context:
{context}
Rules: Use only the supplied metrics and labels. Maximum 3 sentences.
The user's current question is the final user message below.""",
    "scenario": """You are an FP&A analyst for scenario planning.
Pre-calculated scenario / sensitivity context:
{context}
Rules: Reference only the supplied scenario figures. Maximum 3 sentences.
The user's current question is the final user message below.""",
    "report": """You are a CFO preparing management / board narrative.
Pre-calculated reporting context:
{context}
Rules: Summarize using only this context; no new financial calculations. Maximum 3 sentences.
The user's current question is the final user message below.""",
}


def suggested_actions(intent: str) -> list[str]:
    """Short labels for Power Automate / UI buttons."""
    common = ["Export to Excel", "Generate board pack"]
    first = {
        "variance": "Run full variance analysis",
        "anomaly": "Run anomaly / risk review",
        "forecast": "Refresh forecast & runway",
        "kpi": "Open KPI dashboard",
        "scenario": "Run scenario planner",
        "report": "Build management report",
    }.get(intent, "Run full variance analysis")
    return [first, common[0], common[1]]


def handle_chat(
    message: str,
    intent: str,
    variance_context: Any,
    chat_history: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    intent should match detect_intent() values.
    Returns reply text, confidence, and echoes intent for the route layer.
    """
    intent_key = intent if intent in _TEMPLATES else "variance"
    template = _TEMPLATES[intent_key]
    ctx = _context_str(variance_context)
    system = template.format(context=ctx)
    conf = _confidence(intent_key, variance_context)

    if not os.environ.get("ANTHROPIC_API_KEY", "").strip():
        return {
            "reply": "ANTHROPIC_API_KEY is not configured on the server.",
            "confidence": "low",
            "intent": intent_key,
        }

    messages: list[dict[str, str]] = []
    for turn in (chat_history or [])[-_MAX_HISTORY:]:
        role = turn.get("role")
        content = turn.get("content")
        if role not in ("user", "assistant") or content is None:
            continue
        text = str(content).strip()
        if not text:
            continue
        messages.append({"role": role, "content": text})
    messages.append({"role": "user", "content": message.strip()})

    try:
        client = Anthropic()
        resp = client.messages.create(
            model=_DEFAULT_MODEL,
            max_tokens=1024,
            temperature=0.2,
            system=system,
            messages=messages,
        )
        text = resp.content[0].text
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        # Enforce max ~3 sentences if model runs long
        parts = re.split(r"(?<=[.!?])\s+", text)
        if len(parts) > 4:
            text = " ".join(parts[:3]).strip()
    except Exception as exc:  # noqa: BLE001
        return {
            "reply": f"Chat request failed: {exc}",
            "confidence": conf,
            "intent": intent_key,
        }

    return {"reply": text, "confidence": conf, "intent": intent_key}
