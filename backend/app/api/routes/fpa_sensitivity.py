"""2D sensitivity grid + tornado — POST /api/fpa/sensitivity"""

from __future__ import annotations

import logging
from typing import Any, Literal, Optional

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.fpa_commentary import fpa_commentary
from app.services.fpa_result_store import store_fpa_result

logger = logging.getLogger(__name__)
router = APIRouter(tags=["FP&A Sensitivity"])


VarName = Literal["revenue", "cogs_pct", "opex_pct", "tax_rate"]


class SensitivityRequest(BaseModel):
    base_revenue: float = 10_000_000.0
    base_cogs_pct: float = 0.28
    base_opex_pct: float = 0.42
    tax_rate: float = 0.25
    variable1: VarName = "revenue"
    variable2: VarName = "opex_pct"
    v1_low_pct: float = -10.0
    v1_base_pct: float = 0.0
    v1_high_pct: float = 10.0
    v2_low_pct: float = -10.0
    v2_base_pct: float = 0.0
    v2_high_pct: float = 10.0
    steps: Literal[5, 9, 13] = 9
    user_id: Optional[str] = None


def _net_profit(rev: float, cogs_pct: float, opex_pct: float, tax: float) -> float:
    gp = rev * (1 - cogs_pct)
    ebit = gp - rev * opex_pct
    ni = ebit * (1 - tax)
    return float(ni)


@router.post("/sensitivity")
def sensitivity(body: SensitivityRequest, db: Session = Depends(get_db)):
    try:
        n = int(body.steps)
        v1_grid = np.linspace(body.v1_low_pct, body.v1_high_pct, n).tolist()
        v2_grid = np.linspace(body.v2_low_pct, body.v2_high_pct, n).tolist()

        matrix: list[list[dict[str, Any]]] = []
        base_np = _net_profit(body.base_revenue, body.base_cogs_pct, body.base_opex_pct, body.tax_rate)

        for i, a in enumerate(v1_grid):
            row: list[dict[str, Any]] = []
            for j, b in enumerate(v2_grid):
                r = body.base_revenue
                c = body.base_cogs_pct
                o = body.base_opex_pct
                if body.variable1 == "revenue":
                    r *= 1 + a / 100.0
                elif body.variable1 == "cogs_pct":
                    c = max(0.0, min(0.95, body.base_cogs_pct * (1 + a / 100.0)))
                elif body.variable1 == "opex_pct":
                    o = max(0.0, min(0.95, body.base_opex_pct * (1 + a / 100.0)))
                elif body.variable1 == "tax_rate":
                    pass

                if body.variable2 == "revenue":
                    r *= 1 + b / 100.0
                elif body.variable2 == "cogs_pct":
                    c = max(0.0, min(0.95, body.base_cogs_pct * (1 + b / 100.0)))
                elif body.variable2 == "opex_pct":
                    o = max(0.0, min(0.95, body.base_opex_pct * (1 + b / 100.0)))
                elif body.variable2 == "tax_rate":
                    pass

                tax = body.tax_rate
                if body.variable1 == "tax_rate":
                    tax = max(0.0, min(0.45, body.tax_rate * (1 + a / 100.0)))
                if body.variable2 == "tax_rate":
                    tax = max(0.0, min(0.45, tax * (1 + b / 100.0)))

                profit = _net_profit(r, c, o, tax)
                row.append(
                    {
                        "v1_pct": a,
                        "v2_pct": b,
                        "net_profit": profit,
                        "delta_vs_base": profit - base_np,
                    }
                )
            matrix.append(row)

        # Tornado: one-at-a-time ±10% on each driver
        drivers: list[tuple[str, float]] = [
            ("revenue", 10.0),
            ("cogs_pct", 10.0),
            ("opex_pct", 10.0),
            ("tax_rate", 10.0),
        ]
        tornado: list[dict[str, Any]] = []
        for name, shock in drivers:
            if name == "revenue":
                hi = _net_profit(body.base_revenue * (1 + shock / 100), body.base_cogs_pct, body.base_opex_pct, body.tax_rate)
                lo = _net_profit(body.base_revenue * (1 - shock / 100), body.base_cogs_pct, body.base_opex_pct, body.tax_rate)
            elif name == "cogs_pct":
                hi = _net_profit(
                    body.base_revenue,
                    min(0.95, body.base_cogs_pct * (1 + shock / 100)),
                    body.base_opex_pct,
                    body.tax_rate,
                )
                lo = _net_profit(
                    body.base_revenue,
                    max(0.0, body.base_cogs_pct * (1 - shock / 100)),
                    body.base_opex_pct,
                    body.tax_rate,
                )
            elif name == "opex_pct":
                hi = _net_profit(
                    body.base_revenue,
                    body.base_cogs_pct,
                    min(0.95, body.base_opex_pct * (1 + shock / 100)),
                    body.tax_rate,
                )
                lo = _net_profit(
                    body.base_revenue,
                    body.base_cogs_pct,
                    max(0.0, body.base_opex_pct * (1 - shock / 100)),
                    body.tax_rate,
                )
            else:
                hi = _net_profit(
                    body.base_revenue,
                    body.base_cogs_pct,
                    body.base_opex_pct,
                    min(0.45, body.tax_rate * (1 + shock / 100)),
                )
                lo = _net_profit(
                    body.base_revenue,
                    body.base_cogs_pct,
                    body.base_opex_pct,
                    max(0.0, body.tax_rate * (1 - shock / 100)),
                )
            tornado.append({"variable": name, "downside": lo, "upside": hi, "swing": hi - lo})

        breakeven_points: list[dict[str, Any]] = []
        threshold = max(abs(base_np) * 0.03, 25_000.0)
        for i, row in enumerate(matrix):
            for j, cell in enumerate(row):
                if abs(cell["net_profit"]) <= threshold:
                    breakeven_points.append({"i": i, "j": j, "net_profit": cell["net_profit"]})

        metrics = {
            "matrix": matrix,
            "tornado_data": sorted(tornado, key=lambda x: abs(x["swing"]), reverse=True),
            "breakeven_points": breakeven_points[:20],
            "base_net_profit": base_np,
            "variable1": body.variable1,
            "variable2": body.variable2,
        }
        commentary = fpa_commentary(
            "Summarise key sensitivities and how management should think about risk vs these drivers.",
            metrics,
        )
        out = {**metrics, "commentary": commentary}
        store_fpa_result(db, "sensitivity", out, user_id=body.user_id)
        return out
    except Exception as e:
        logger.exception("sensitivity failed")
        raise HTTPException(status_code=500, detail=str(e)) from e
