"""SaaS ARR / NRR metrics — POST /api/fpa/arr-dashboard"""

from __future__ import annotations

import logging
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.fpa_commentary import fpa_commentary
from app.services.fpa_result_store import store_fpa_result

logger = logging.getLogger(__name__)
router = APIRouter(tags=["FP&A ARR"])


class ARRMonthRow(BaseModel):
    month: str
    beginning_arr: float
    new_arr: float = 0.0
    expansion: float = 0.0
    contraction: float = 0.0
    churn: float = 0.0
    ending_arr: float = 0.0
    mrr: float = 0.0


class ARRDashboardRequest(BaseModel):
    months: List[ARRMonthRow] = Field(default_factory=list)
    total_headcount: float = 120.0
    total_sales_marketing_cost: float = 2_400_000.0
    new_customers_acquired: float = 48.0
    revenue_yoy_growth_pct: float = 0.32
    fcf_margin_pct: float = 0.08
    user_id: Optional[str] = None


def _synthetic_months() -> List[ARRMonthRow]:
    rows: list[ARRMonthRow] = []
    beg = 8_000_000.0
    for i in range(12):
        n = 400_000 + i * 5_000
        ex = 250_000
        ct = 80_000
        ch = 120_000 + i * 2000
        e = beg + n + ex - ct - ch
        rows.append(
            ARRMonthRow(
                month=f"M{i+1}",
                beginning_arr=beg,
                new_arr=n,
                expansion=ex,
                contraction=ct,
                churn=ch,
                ending_arr=e,
                mrr=e / 12.0,
            )
        )
        beg = e
    return rows


@router.post("/arr-dashboard")
def arr_dashboard(body: ARRDashboardRequest, db: Session = Depends(get_db)):
    try:
        months = body.months if body.months else _synthetic_months()
        if not months:
            raise HTTPException(status_code=400, detail="Provide months[] or rely on demo generator")

        last = months[-1]
        first = months[0]
        arr_total = last.ending_arr
        mrr = last.mrr if last.mrr else last.ending_arr / 12.0

        beg = first.beginning_arr
        exp = sum(m.expansion for m in months) / len(months)
        ch = sum(m.churn for m in months) / len(months)
        nrr = ((beg + exp - ch) / beg) * 100.0 if beg else 0.0
        grr = ((beg - ch) / beg) * 100.0 if beg else 0.0
        rule40 = body.revenue_yoy_growth_pct * 100.0 + body.fcf_margin_pct * 100.0
        cac = body.total_sales_marketing_cost / max(body.new_customers_acquired, 1e-6)
        acv = arr_total / max(body.total_headcount, 1e-6) * 0.25  # rough ACV proxy
        gross_churn_pct = (ch / beg) if beg else 0.0
        ltv = acv / max(gross_churn_pct, 1e-6) if gross_churn_pct else acv * 8
        cac_payback = cac / max(acv / 12.0, 1e-6)

        cohort: list[dict[str, Any]] = []
        for m in months:
            cohort.append(
                {
                    "month": m.month,
                    "expansion_pct_of_beg": (m.expansion / m.beginning_arr * 100) if m.beginning_arr else 0,
                    "churn_pct_of_beg": (m.churn / m.beginning_arr * 100) if m.beginning_arr else 0,
                }
            )

        waterfall = {
            "beginning": first.beginning_arr,
            "new": sum(m.new_arr for m in months) / len(months),
            "expansion": sum(m.expansion for m in months) / len(months),
            "contraction": sum(m.contraction for m in months) / len(months),
            "churn": sum(m.churn for m in months) / len(months),
            "ending": last.ending_arr,
        }

        benchmarks = {
            "nrr_target_pct": 110.0,
            "nrr_ok": nrr >= 110.0,
            "rule40_ok": rule40 >= 40.0,
        }

        metrics = {
            "arr_total": arr_total,
            "mrr": mrr,
            "nrr_pct": nrr,
            "grr_pct": grr,
            "rule_of_40": rule40,
            "cac_payback_months": cac_payback,
            "cac": cac,
            "ltv": ltv,
            "waterfall_avg_month": waterfall,
            "cohort": cohort,
            "benchmarks": benchmarks,
        }
        commentary = fpa_commentary(
            "Write an investor-style ARR narrative using these SaaS metrics and benchmarks.",
            metrics,
        )
        out = {**metrics, "commentary": commentary, "months_detail": [m.model_dump() for m in months]}
        store_fpa_result(db, "arr_dashboard", out, user_id=body.user_id)
        return out
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("arr-dashboard failed")
        raise HTTPException(status_code=500, detail=str(e)) from e
