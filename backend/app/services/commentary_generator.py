"""
IFRS board / narrative commentary — separate LLM call (context reset).

Input is validated statement numbers and headline TB facts only — never GL
mapping rows, codes, or mapping rationale so the model cannot rationalise
its own prior mapping decisions.
"""
from __future__ import annotations

import json
import re
from typing import Any

from app.services import llm_service


def _extract_json_object(text: str) -> dict[str, Any]:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t, flags=re.IGNORECASE)
        t = re.sub(r"\s*```$", "", t)
    start = t.find("{")
    end = t.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON object in model response")
    return json.loads(t[start : end + 1])


def _statement_snapshot(pl_lines: list[Any], fp_lines: list[Any], limit: int = 40) -> dict[str, Any]:
    """Serialise line items for the prompt (names + amounts only)."""

    def rows(lines: list[Any]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for li in lines[:limit]:
            out.append(
                {
                    "section": getattr(li, "ifrs_section", None),
                    "line_item": getattr(li, "ifrs_line_item", None),
                    "amount": float(getattr(li, "amount", 0) or 0),
                    "is_total": bool(getattr(li, "is_total", False)),
                }
            )
        return out

    return {"profit_loss": rows(pl_lines), "financial_position": rows(fp_lines)}


def try_generate_commentary_from_statements_only(
    *,
    company_name: str,
    period_label: str,
    currency: str,
    pl_lines: list[Any],
    fp_lines: list[Any],
    tb_headlines: dict[str, Any],
) -> dict[str, str] | None:
    """
    Optional second Claude call: commentary on validated statements only.

    Returns dict with keys ``executive_summary``, ``profit_loss``,
    ``financial_position`` or ``None`` if LLM unavailable / parse fails.
    """
    if not llm_service.is_configured():
        return None

    snapshot = _statement_snapshot(pl_lines, fp_lines)
    headlines = {
        k: tb_headlines.get(k)
        for k in (
            "revenue",
            "profit_before_tax",
            "total_assets",
            "total_equity",
            "total_borrowings",
            "cash",
        )
    }

    system = (
        "You are a senior financial reporting analyst. Write concise board-ready prose. "
        "Strict rules: (1) Base narrative ONLY on the JSON facts provided — statement line "
        "amounts and headline totals. (2) Do NOT mention GL accounts, mapping, confidence, "
        "AI, auditors, or how numbers were produced. (3) Do NOT infer transactions not "
        "implied by the figures. (4) Return a single JSON object with exactly three string "
        "fields: executive_summary, profit_loss, financial_position. Each value should be "
        "2–5 sentences of plain professional English."
    )
    user = json.dumps(
        {
            "company_name": company_name,
            "period_end": period_label,
            "currency": currency,
            "headline_totals": headlines,
            "statements": snapshot,
        },
        indent=2,
    )
    try:
        raw = llm_service.invoke(
            prompt=user,
            system=system,
            max_tokens=1200,
            temperature=0.25,
        )
        data = _extract_json_object(raw)
        out = {
            "executive_summary": str(data.get("executive_summary", "")).strip(),
            "profit_loss": str(data.get("profit_loss", "")).strip(),
            "financial_position": str(data.get("financial_position", "")).strip(),
        }
        if not all(out.values()):
            return None
        return out
    except Exception:
        return None
