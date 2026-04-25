"""Vectorised Monte Carlo cash simulation — POST /api/fpa/monte-carlo"""

from __future__ import annotations

import logging
from typing import Any, Optional

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.fpa_commentary import fpa_commentary
from app.services.fpa_result_store import store_fpa_result

logger = logging.getLogger(__name__)
router = APIRouter(tags=["FP&A Monte Carlo"])


class TriangularParams(BaseModel):
    low: float
    mode: float
    high: float


class MonteCarloRequest(BaseModel):
    revenue_growth: TriangularParams = Field(default_factory=lambda: TriangularParams(low=-0.05, mode=0.08, high=0.2))
    gross_margin: TriangularParams = Field(default_factory=lambda: TriangularParams(low=0.35, mode=0.5, high=0.65))
    fixed_costs_monthly: TriangularParams = Field(default_factory=lambda: TriangularParams(low=80_000, mode=120_000, high=200_000))
    variable_cost_pct: TriangularParams = Field(default_factory=lambda: TriangularParams(low=0.15, mode=0.22, high=0.35))
    starting_cash: TriangularParams = Field(default_factory=lambda: TriangularParams(low=400_000, mode=900_000, high=1_500_000))
    n_simulations: int = Field(5000, ge=500, le=20_000)
    months: int = 12
    user_id: Optional[str] = None


def _triangular(low: np.ndarray, mode: np.ndarray, high: np.ndarray, shape: tuple[int, ...]) -> np.ndarray:
    """Inverse-CDF sampler, vectorised over last dimension."""
    u = np.random.random(shape)
    c = (mode - low) / np.maximum(high - low, 1e-9)
    out = np.empty(shape, dtype=float)
    mask = u < c
    out[mask] = low + np.sqrt(u[mask] * (high[mask] - low[mask]) * (mode[mask] - low[mask]))
    inv = ~mask
    out[inv] = high - np.sqrt((1 - u[inv]) * (high[inv] - low[inv]) * (high[inv] - mode[inv]))
    return out


@router.post("/monte-carlo")
def monte_carlo(body: MonteCarloRequest, db: Session = Depends(get_db)):
    try:
        rng = np.random.default_rng()
        n = body.n_simulations
        m = body.months

        g = _triangular(
            np.full(n, body.revenue_growth.low),
            np.full(n, body.revenue_growth.mode),
            np.full(n, body.revenue_growth.high),
            (n,),
        )
        gm = _triangular(
            np.full(n, body.gross_margin.low),
            np.full(n, body.gross_margin.mode),
            np.full(n, body.gross_margin.high),
            (n,),
        )
        fix = _triangular(
            np.full(n, body.fixed_costs_monthly.low),
            np.full(n, body.fixed_costs_monthly.mode),
            np.full(n, body.fixed_costs_monthly.high),
            (n,),
        )
        varp = _triangular(
            np.full(n, body.variable_cost_pct.low),
            np.full(n, body.variable_cost_pct.mode),
            np.full(n, body.variable_cost_pct.high),
            (n,),
        )
        cash0 = _triangular(
            np.full(n, body.starting_cash.low),
            np.full(n, body.starting_cash.mode),
            np.full(n, body.starting_cash.high),
            (n,),
        )

        base_rev = 1_000_000 / 12.0
        cash_paths = np.zeros((n, m + 1))
        cash_paths[:, 0] = cash0
        rev = np.zeros((n, m))
        for t in range(m):
            noise = rng.normal(0, 0.02, size=n)
            growth_t = np.clip(g + noise, -0.5, 0.6)
            if t == 0:
                rev[:, t] = base_rev * (1 + growth_t)
            else:
                rev[:, t] = rev[:, t - 1] * (1 + growth_t / 12.0)
            gross_profit = rev[:, t] * gm
            var_cost = rev[:, t] * varp
            net = gross_profit - fix - var_cost
            cash_paths[:, t + 1] = cash_paths[:, t] + net

        ending = cash_paths[:, -1]
        p10_end = float(np.percentile(ending, 10))
        p50_end = float(np.percentile(ending, 50))
        p90_end = float(np.percentile(ending, 90))

        months_idx = np.arange(0, m + 1)
        p10_path = [float(np.percentile(cash_paths[:, t], 10)) for t in range(m + 1)]
        p50_path = [float(np.percentile(cash_paths[:, t], 50)) for t in range(m + 1)]
        p90_path = [float(np.percentile(cash_paths[:, t], 90)) for t in range(m + 1)]

        hist_bins = 24
        counts, edges = np.histogram(ending, bins=hist_bins)
        histogram_data = [{"bin_start": float(edges[i]), "bin_end": float(edges[i + 1]), "count": int(counts[i])} for i in range(len(counts))]

        runway_prob: dict[str, float] = {}
        for horizon in (3, 6, 9, 12):
            if horizon > m:
                continue
            sub = cash_paths[:, horizon]
            runway_prob[f"month_{horizon}_pct_negative"] = float(np.mean(sub < 0) * 100.0)

        # % sims where cash stays positive every month for 12m then still >=0 at 18m proxy: use ending>0 and min path >0
        min_along = np.min(cash_paths[:, 1 : m + 1], axis=1)
        runway_18_proxy = float(np.mean((min_along > 0) & (ending > 0)) * 100.0)

        metrics = {
            "p10_month_end": p10_end,
            "p50_month_end": p50_end,
            "p90_month_end": p90_end,
            "p10": p10_path,
            "p50": p50_path,
            "p90": p90_path,
            "months": [int(x) for x in months_idx.tolist()],
            "histogram_data": histogram_data,
            "runway_probability": runway_prob,
            "runway_positive_all_months_pct": runway_18_proxy,
            "n_simulations": n,
        }
        commentary = fpa_commentary(
            "Interpret this Monte Carlo cash simulation for a founder/CFO: downside, upside, and liquidity risk.",
            metrics,
        )
        out = {**metrics, "commentary": commentary}
        store_fpa_result(db, "monte_carlo", out, user_id=body.user_id)
        return out
    except Exception as e:
        logger.exception("monte-carlo failed")
        raise HTTPException(status_code=500, detail=str(e)) from e
