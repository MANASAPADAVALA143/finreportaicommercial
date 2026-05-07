"""Aggregate FP&A module outputs into a simple health score."""

from __future__ import annotations

import json
from typing import Any


def _rag_to_points(rag: str | None) -> int:
    s = (rag or "").lower()
    if "green" in s:
        return 90
    if "amber" in s or "yellow" in s:
        return 65
    if "red" in s:
        return 40
    return 55


def aggregate(
    variance_summary: Any,
    kpi_summary: Any,
    forecast_summary: Any,
    cash_position: Any,
) -> dict[str, Any]:
    scores: list[int] = []

    if isinstance(kpi_summary, dict):
        ml = kpi_summary.get("ml_engine") or kpi_summary
        scores.append(_rag_to_points(ml.get("overall_rating")))
        if "overall_rating" in kpi_summary and isinstance(kpi_summary["overall_rating"], str):
            scores.append(_rag_to_points(kpi_summary["overall_rating"]))

    if isinstance(variance_summary, dict):
        rows = (variance_summary.get("ml_engine") or {}).get("rows") or []
        flagged = sum(1 for r in rows if r.get("flagged"))
        n = max(len(rows), 1)
        ratio = flagged / n
        scores.append(int(max(0, 100 - ratio * 120)))

    if isinstance(forecast_summary, dict):
        risks = forecast_summary.get("risks") or []
        if isinstance(risks, list) and len(risks) > 3:
            scores.append(55)
        elif isinstance(risks, list) and risks:
            scores.append(70)

    if isinstance(cash_position, dict):
        bal = float(cash_position.get("balance", 0) or 0)
        burn = float(cash_position.get("monthly_burn", 0) or 0)
        if burn > 0 and bal > 0:
            months = bal / burn
            scores.append(min(100, int(months * 15)))
        elif bal > 0:
            scores.append(75)

    if not scores:
        scores = [68]

    health_score = int(round(sum(scores) / len(scores)))
    health_score = max(0, min(100, health_score))

    return {
        "health_score": health_score,
        "score_components": scores,
        "summaries_received": {
            "has_variance": variance_summary is not None and variance_summary != "",
            "has_kpi": kpi_summary is not None and kpi_summary != "",
            "has_forecast": forecast_summary is not None and forecast_summary != "",
            "has_cash": cash_position is not None and cash_position != "",
        },
        "summaries_digest": {
            "variance": _digest(variance_summary),
            "kpi": _digest(kpi_summary),
            "forecast": _digest(forecast_summary),
            "cash": _digest(cash_position),
        },
    }


def _digest(obj: Any, max_len: int = 2000) -> str:
    if obj is None:
        return ""
    if isinstance(obj, str):
        return obj[:max_len]
    try:
        return json.dumps(obj, default=str)[:max_len]
    except Exception:
        return str(obj)[:max_len]
