"""Lightweight anomaly flags on tabular financial rows (no ML model — rules + z-scores)."""

from __future__ import annotations

import statistics
from typing import Any


def _amount(row: dict[str, Any]) -> float | None:
    for k in ("amount", "actual", "spent", "budget", "value", "balance"):
        if k in row and row[k] is not None and str(row[k]).strip() != "":
            try:
                return float(row[k])
            except (TypeError, ValueError):
                continue
    return None


def _label(row: dict[str, Any]) -> str:
    for k in ("account", "description", "vendor", "name", "id", "ref"):
        v = row.get(k)
        if v is not None and str(v).strip():
            return str(v).strip()
    return "row"


def analyze(rows: list[dict[str, Any]], filters: dict[str, Any]) -> dict[str, Any]:
    risk = str(filters.get("risk_level", "high") or "high").lower()
    amounts: list[float] = []
    labeled: list[tuple[str, float, dict[str, Any]]] = []
    for raw in rows or []:
        if not isinstance(raw, dict):
            continue
        amt = _amount(raw)
        if amt is None:
            continue
        amounts.append(amt)
        labeled.append((_label(raw), amt, raw))

    mean_a = statistics.mean(amounts) if amounts else 0.0
    stdev_a = statistics.stdev(amounts) if len(amounts) > 1 else 0.0

    items: list[dict[str, Any]] = []
    for label, amt, raw in labeled:
        round_flag = amt >= 10_000 and amt % 1000 == 0
        z = None
        if stdev_a > 1e-9:
            z = (amt - mean_a) / stdev_a
        severity = "low"
        if z is not None:
            if abs(z) >= 3 or (round_flag and amt >= 1_000_000):
                severity = "high"
            elif abs(z) >= 2:
                severity = "medium"
        elif round_flag and amt >= 100_000:
            severity = "medium"

        items.append(
            {
                "label": label,
                "amount": amt,
                "round_thousand_flag": round_flag,
                "z_score": round(z, 4) if z is not None else None,
                "severity": severity,
                "raw": {k: raw[k] for k in list(raw.keys())[:12]},
            }
        )

    def include(sev: str) -> bool:
        if risk in ("high", "h"):
            return sev == "high"
        if risk in ("medium", "med", "m"):
            return sev in ("high", "medium")
        return True

    flagged = [i for i in items if include(i["severity"])]

    return {
        "items": items,
        "flagged": flagged,
        "summary": {
            "rows_scanned": len(items),
            "flagged_count": len(flagged),
            "risk_filter": risk,
        },
    }
