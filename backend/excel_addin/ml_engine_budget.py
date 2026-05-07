"""Department budget vs spend metrics."""

from __future__ import annotations

from typing import Any


def analyze_departments(departments: list[dict[str, Any]]) -> dict[str, Any]:
    enriched: list[dict[str, Any]] = []
    alerts: list[str] = []
    for raw in departments:
        name = str(raw.get("name", "") or "").strip()
        budget = float(raw.get("budget", 0) or 0)
        spent = float(raw.get("spent", 0) or 0)
        spend_pct = (spent / budget * 100.0) if budget else None
        remaining = budget - spent
        burn_rate = (spent / budget) if budget else None
        overspend = spent > budget and budget > 0
        if overspend:
            alerts.append(f"{name}: spend exceeds budget by {spent - budget:,.0f}")
        enriched.append(
            {
                "name": name,
                "budget": budget,
                "spent": spent,
                "spend_pct": spend_pct,
                "remaining": remaining,
                "burn_rate": burn_rate,
                "overspend": overspend,
            }
        )
    return {"departments": enriched, "alerts": alerts}
