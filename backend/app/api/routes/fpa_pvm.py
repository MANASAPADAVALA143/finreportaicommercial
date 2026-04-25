"""PVM (Price–Volume–Mix) analysis — POST /api/fpa/pvm-analysis"""

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
router = APIRouter(tags=["FP&A PVM"])


class PVMLine(BaseModel):
    name: str = ""
    actual_units: float = 0.0
    actual_price: float = 0.0
    budget_units: float = 0.0
    budget_price: float = 0.0


class PVMAnalysisRequest(BaseModel):
    actual_revenue: float = Field(..., description="Company actual revenue (control total)")
    budget_revenue: float = Field(..., description="Company budget revenue (control total)")
    prior_year_revenue: float = 0.0
    products: List[PVMLine] = Field(default_factory=list)
    regions: List[PVMLine] = Field(default_factory=list)
    user_id: Optional[str] = None
    demo: bool = False


def _synthetic_products() -> List[PVMLine]:
    return [
        PVMLine(name="Product A", actual_units=1200, actual_price=95, budget_units=1000, budget_price=90),
        PVMLine(name="Product B", actual_units=800, actual_price=140, budget_units=900, budget_price=135),
    ]


def _calc_block(lines: List[PVMLine]) -> tuple[float, float, float, list[dict[str, Any]]]:
    price_eff = 0.0
    vol_eff = 0.0
    detail: list[dict[str, Any]] = []
    for row in lines:
        pe = (row.actual_price - row.budget_price) * row.actual_units
        ve = (row.actual_units - row.budget_units) * row.budget_price
        price_eff += pe
        vol_eff += ve
        detail.append(
            {
                "name": row.name,
                "price_effect": pe,
                "volume_effect": ve,
                "actual_revenue": row.actual_units * row.actual_price,
                "budget_revenue": row.budget_units * row.budget_price,
            }
        )
    return price_eff, vol_eff, detail


@router.post("/pvm-analysis")
def run_pvm_analysis(body: PVMAnalysisRequest, db: Session = Depends(get_db)):
    try:
        if body.demo:
            body = PVMAnalysisRequest(
                actual_revenue=250_000,
                budget_revenue=220_000,
                prior_year_revenue=200_000,
                products=_synthetic_products(),
                regions=[],
            )

        products = body.products
        regions = body.regions
        if not products and not regions:
            raise HTTPException(status_code=400, detail="Provide products and/or regions rows")

        pe_p, ve_p, by_product = _calc_block(products)
        pe_r, ve_r, by_region = _calc_block(regions) if regions else (0.0, 0.0, [])

        price_effect = pe_p + pe_r
        volume_effect = ve_p + ve_r
        total_variance = body.actual_revenue - body.budget_revenue
        mix_effect = total_variance - price_effect - volume_effect

        waterfall = [
            {"name": "Budget", "value": body.budget_revenue, "type": "total"},
            {"name": "Price", "value": price_effect, "type": "step"},
            {"name": "Volume", "value": volume_effect, "type": "step"},
            {"name": "Mix", "value": mix_effect, "type": "step"},
            {"name": "Actual", "value": body.actual_revenue, "type": "total"},
        ]

        metrics = {
            "price_effect": price_effect,
            "volume_effect": volume_effect,
            "mix_effect": mix_effect,
            "total_variance": total_variance,
            "by_product": by_product,
            "by_region": by_region,
            "waterfall_data": waterfall,
        }
        commentary = fpa_commentary(
            "Explain this PVM bridge for a CFO board pack. Reference budget, actual, price, volume, and mix.",
            metrics,
        )
        out = {**metrics, "commentary": commentary}
        store_fpa_result(db, "pvm", out, user_id=body.user_id)
        return out
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("PVM analysis failed")
        raise HTTPException(status_code=500, detail=str(e)) from e
