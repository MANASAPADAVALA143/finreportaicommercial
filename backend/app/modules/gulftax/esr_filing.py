"""GulfTax — Economic Substance Regulations (ESR) filing assessment."""
from __future__ import annotations

from datetime import date
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/gulftax/esr", tags=["GulfTax ESR"])

RELEVANT_ACTIVITIES = [
    "Banking",
    "Insurance",
    "Investment Fund Management",
    "Lease Finance",
    "Headquarters",
    "Shipping",
    "Holding Company",
    "Intellectual Property",
    "Distribution and Service Centre",
    "None / Not Applicable",
]

ActivityType = Literal[
    "Banking",
    "Insurance",
    "Investment Fund Management",
    "Lease Finance",
    "Headquarters",
    "Shipping",
    "Holding Company",
    "Intellectual Property",
    "Distribution and Service Centre",
    "None / Not Applicable",
]


class ESRCalculateRequest(BaseModel):
    activity_type: ActivityType
    directors_meetings_in_uae: bool = Field(..., description="Directed & managed in UAE")
    ciga_in_uae: bool = Field(..., description="Core income-generating activities in UAE")
    employee_count_uae: int = Field(0, ge=0)
    expenditure_uae_aed: float = Field(0, ge=0)
    assets_uae_aed: float = Field(0, ge=0)
    financial_year_end: str = Field("12-31", description="MM-DD")


class ESRStatusResponse(BaseModel):
    activities: list[str]
    notification_deadline: str
    filing_deadline: str
    message: str


@router.get("/status")
def esr_status() -> ESRStatusResponse:
    """ESR calendar and supported relevant activities."""
    fy = date.today().year
    return ESRStatusResponse(
        activities=RELEVANT_ACTIVITIES,
        notification_deadline=f"{fy}-06-30",
        filing_deadline=f"{fy}-12-31",
        message="ESR notification within 6 months and report within 12 months of financial year end.",
    )


@router.post("/calculate")
def esr_calculate(body: ESRCalculateRequest) -> dict:
    """Run ESR substance tests for a relevant activity."""
    exempt = body.activity_type == "None / Not Applicable"
    if exempt:
        return {
            "activity_type": body.activity_type,
            "passes_dm_test": True,
            "passes_ciga_test": True,
            "passes_adequacy_test": True,
            "overall_status": "EXEMPT",
            "filing_deadline": None,
            "notification_deadline": None,
            "explanations": {
                "dm": "Not in a relevant activity — ESR report not required.",
                "ciga": "N/A",
                "adequacy": "N/A",
            },
        }

    passes_dm = body.directors_meetings_in_uae
    passes_ciga = body.ciga_in_uae
  # Adequacy: simplified — employees OR meaningful UAE spend/assets
    passes_adequacy = (
        body.employee_count_uae >= 1
        and (body.expenditure_uae_aed >= 50_000 or body.assets_uae_aed >= 50_000)
    )

    if passes_dm and passes_ciga and passes_adequacy:
        overall = "PASS"
    else:
        overall = "FAIL"

    fy = date.today().year
    return {
        "activity_type": body.activity_type,
        "passes_dm_test": passes_dm,
        "passes_ciga_test": passes_ciga,
        "passes_adequacy_test": passes_adequacy,
        "overall_status": overall,
        "notification_deadline": f"{fy}-06-30",
        "filing_deadline": f"{fy}-12-31",
        "explanations": {
            "dm": "Passed — entity directed and managed in UAE."
            if passes_dm
            else "Failed — board meetings / management must occur in UAE.",
            "ciga": "Passed — CIGAs performed in UAE."
            if passes_ciga
            else "Failed — core income-generating activities must be in UAE.",
            "adequacy": "Passed — adequate employees, expenditure and assets in UAE."
            if passes_adequacy
            else "Failed — insufficient UAE employees, spend or assets for the activity.",
        },
    }
