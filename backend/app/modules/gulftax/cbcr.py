"""GulfTax — Country-by-Country Reporting (CbCR)."""
from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, Header
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/gulftax/cbcr", tags=["GulfTax CbCR"])

CBCR_THRESHOLD_AED = 3_150_000_000

_cbcr_store: dict[str, dict[str, Any]] = {}


class CbCRJurisdiction(BaseModel):
    country: str
    revenue_aed: float = 0
    profit_aed: float = 0
    tax_paid_aed: float = 0
    employees: int = 0
    assets_aed: float = 0


class CbCRGenerateRequest(BaseModel):
    group_revenue_aed: float = Field(..., ge=0)
    parent_entity: str = ""
    filing_entity: str = ""
    surrogate_filing: bool = False
    jurisdictions: list[CbCRJurisdiction] = Field(default_factory=list)
    filing_status: str = Field("not_filed", description="not_filed | filed | exempt")


@router.get("/status")
def cbcr_status(
    x_company_id: str | None = Header(default=None, alias="X-Company-Id"),
) -> dict[str, Any]:
    key = (x_company_id or "default").strip()
    saved = _cbcr_store.get(key, {})
    revenue = float(saved.get("group_revenue_aed", 0))
    return {
        "threshold_aed": CBCR_THRESHOLD_AED,
        "threshold_met": revenue >= CBCR_THRESHOLD_AED,
        "group_revenue_aed": revenue,
        "filing_deadline": f"{date.today().year}-12-31",
        "saved": saved or None,
    }


@router.post("/generate")
def cbcr_generate(
    body: CbCRGenerateRequest,
    x_company_id: str | None = Header(default=None, alias="X-Company-Id"),
) -> dict[str, Any]:
    key = (x_company_id or "default").strip()
    threshold_met = body.group_revenue_aed >= CBCR_THRESHOLD_AED
    payload = {
        "threshold_met": threshold_met,
        "group_revenue_aed": body.group_revenue_aed,
        "jurisdictions": [j.model_dump() for j in body.jurisdictions],
        "filing_deadline": f"{date.today().year}-12-31",
        "filing_entity": body.filing_entity or body.parent_entity,
        "parent_entity": body.parent_entity,
        "surrogate_filing": body.surrogate_filing,
        "filing_status": body.filing_status if threshold_met else "exempt",
        "message": (
            "CbCR filing required — group revenue exceeds AED 3.15B threshold."
            if threshold_met
            else "CbCR not required — group revenue below AED 3.15B."
        ),
    }
    _cbcr_store[key] = payload
    return payload
