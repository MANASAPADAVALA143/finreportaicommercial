"""Base / optimistic / pessimistic scenario P&L snapshots."""

from __future__ import annotations

from typing import Any


def _scenario(
    revenue: float,
    cogs: float,
    opex: float,
) -> dict[str, Any]:
    gross = revenue - cogs
    ebitda = gross - opex
    net_profit = ebitda
    return {
        "revenue": round(revenue, 2),
        "cogs": round(cogs, 2),
        "opex": round(opex, 2),
        "gross_profit": round(gross, 2),
        "ebitda": round(ebitda, 2),
        "net_profit": round(net_profit, 2),
    }


def analyze_scenarios(
    base: dict[str, Any],
    adjustments: dict[str, Any],
) -> dict[str, Any]:
    br = float(base.get("revenue", 0) or 0)
    bc = float(base.get("cogs", 0) or 0)
    bo = float(base.get("opex", 0) or 0)

    opt_rev_pct = float(adjustments.get("optimistic_rev_pct", 0) or 0)
    pes_rev_pct = float(adjustments.get("pessimistic_rev_pct", 0) or 0)
    cost_pct = float(adjustments.get("cost_change_pct", 0) or 0)

    base_s = _scenario(br, bc, bo)
    opt_rev = br * (1 + opt_rev_pct / 100.0)
    opt = _scenario(opt_rev, bc, bo)

    pes_rev = br * (1 + pes_rev_pct / 100.0)
    pes_cogs = bc * (1 + cost_pct / 100.0)
    pes_opex = bo * (1 + cost_pct / 100.0)
    pes = _scenario(pes_rev, pes_cogs, pes_opex)

    return {
        "base": base_s,
        "optimistic": opt,
        "pessimistic": pes,
        "adjustments_applied": {
            "optimistic_rev_pct": opt_rev_pct,
            "pessimistic_rev_pct": pes_rev_pct,
            "cost_change_pct": cost_pct,
        },
    }
