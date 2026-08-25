"""GulfTax — Economic Substance Regulations (ESR) filing assessment."""
from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.tenant import get_company_id, get_tenant_id

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

_ESR_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS esr_filings (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(64),
    company_id VARCHAR(64) NOT NULL,
    relevant_activity VARCHAR(128) NOT NULL,
    directed_managed_uae BOOLEAN NOT NULL DEFAULT FALSE,
    cigas_uae BOOLEAN NOT NULL DEFAULT FALSE,
    uae_employees INTEGER NOT NULL DEFAULT 0,
    uae_expenditure NUMERIC(15, 2) NOT NULL DEFAULT 0,
    uae_assets NUMERIC(15, 2) NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL,
    reasons JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
)
"""


class ESRCalculateRequest(BaseModel):
    """Accepts both GulfTax UI field names and the public API contract."""

    relevant_activity: Optional[str] = None
    activity_type: Optional[str] = None

    directed_managed_uae: Optional[bool] = None
    directors_meetings_in_uae: Optional[bool] = None

    cigas_uae: Optional[bool] = None
    ciga_in_uae: Optional[bool] = None

    uae_employees: Optional[int] = Field(None, ge=0)
    employee_count_uae: Optional[int] = Field(None, ge=0)

    uae_expenditure: Optional[float] = Field(None, ge=0)
    expenditure_uae_aed: Optional[float] = Field(None, ge=0)

    uae_assets: Optional[float] = Field(None, ge=0)
    assets_uae_aed: Optional[float] = Field(None, ge=0)

    company_id: Optional[str] = None
    financial_year_end: str = Field("12-31", description="MM-DD")

    @model_validator(mode="after")
    def _normalize(self) -> "ESRCalculateRequest":
        activity = (self.relevant_activity or self.activity_type or "").strip()
        if not activity:
            raise ValueError("relevant_activity (or activity_type) is required")
        self.relevant_activity = activity
        self.activity_type = activity

        dm = self.directed_managed_uae if self.directed_managed_uae is not None else self.directors_meetings_in_uae
        if dm is None:
            raise ValueError("directed_managed_uae (or directors_meetings_in_uae) is required")
        self.directed_managed_uae = bool(dm)
        self.directors_meetings_in_uae = bool(dm)

        ciga = self.cigas_uae if self.cigas_uae is not None else self.ciga_in_uae
        if ciga is None:
            raise ValueError("cigas_uae (or ciga_in_uae) is required")
        self.cigas_uae = bool(ciga)
        self.ciga_in_uae = bool(ciga)

        employees = self.uae_employees if self.uae_employees is not None else self.employee_count_uae
        self.uae_employees = int(employees or 0)
        self.employee_count_uae = self.uae_employees

        spend = self.uae_expenditure if self.uae_expenditure is not None else self.expenditure_uae_aed
        self.uae_expenditure = float(spend or 0)
        self.expenditure_uae_aed = self.uae_expenditure

        assets = self.uae_assets if self.uae_assets is not None else self.assets_uae_aed
        self.uae_assets = float(assets or 0)
        self.assets_uae_aed = self.uae_assets
        return self


class ESRStatusResponse(BaseModel):
    activities: list[str]
    notification_deadline: str
    filing_deadline: str
    message: str


def _ensure_esr_table(db: Session) -> None:
    try:
        db.execute(text(_ESR_TABLE_SQL))
        db.commit()
    except Exception:
        db.rollback()


def _persist_esr(
    db: Session,
    *,
    tenant_id: Optional[str],
    company_id: str,
    body: ESRCalculateRequest,
    status: str,
    reasons: list[str],
) -> None:
    _ensure_esr_table(db)
    payload = {
        "id": str(uuid4()),
        "tenant_id": tenant_id,
        "company_id": company_id,
        "relevant_activity": body.relevant_activity,
        "directed_managed_uae": bool(body.directed_managed_uae),
        "cigas_uae": bool(body.cigas_uae),
        "uae_employees": int(body.uae_employees or 0),
        "uae_expenditure": float(body.uae_expenditure or 0),
        "uae_assets": float(body.uae_assets or 0),
        "status": status,
        "reasons": json.dumps(reasons),
        "created_at": datetime.utcnow(),
    }
    try:
        db.execute(
            text(
                """
                INSERT INTO esr_filings (
                    id, tenant_id, company_id, relevant_activity,
                    directed_managed_uae, cigas_uae, uae_employees,
                    uae_expenditure, uae_assets, status, reasons, created_at
                ) VALUES (
                    :id, :tenant_id, :company_id, :relevant_activity,
                    :directed_managed_uae, :cigas_uae, :uae_employees,
                    :uae_expenditure, :uae_assets, :status, CAST(:reasons AS JSONB), :created_at
                )
                """
            ),
            payload,
        )
        db.commit()
    except Exception:
        db.rollback()
        try:
            db.execute(
                text(
                    """
                    INSERT INTO esr_filings (
                        id, tenant_id, company_id, relevant_activity,
                        directed_managed_uae, cigas_uae, uae_employees,
                        uae_expenditure, uae_assets, status, reasons, created_at
                    ) VALUES (
                        :id, :tenant_id, :company_id, :relevant_activity,
                        :directed_managed_uae, :cigas_uae, :uae_employees,
                        :uae_expenditure, :uae_assets, :status, :reasons, :created_at
                    )
                    """
                ),
                {**payload, "created_at": datetime.utcnow().isoformat()},
            )
            db.commit()
        except Exception:
            db.rollback()


def compute_esr_result(body: ESRCalculateRequest) -> dict[str, Any]:
    activity = body.relevant_activity or ""
    exempt = activity == "None / Not Applicable"
    fy = date.today().year

    if exempt:
        reasons = ["Not in a relevant activity — ESR report not required."]
        return {
            "activity_type": activity,
            "relevant_activity": activity,
            "passes_dm_test": True,
            "passes_ciga_test": True,
            "passes_adequacy_test": True,
            "overall_status": "EXEMPT",
            "substance_test_passed": True,
            "status": "PASS",
            "reasons": reasons,
            "recommendations": [],
            "filing_deadline": None,
            "notification_deadline": None,
            "explanations": {
                "dm": "Not in a relevant activity — ESR report not required.",
                "ciga": "N/A",
                "adequacy": "N/A",
            },
        }

    passes_dm = bool(body.directed_managed_uae)
    passes_ciga = bool(body.cigas_uae)
    employees_ok = (body.uae_employees or 0) > 0
    expenditure_ok = (body.uae_expenditure or 0) > 0
    assets_ok = (body.uae_assets or 0) > 0
    passes_adequacy = employees_ok and expenditure_ok and assets_ok

    substance_test_passed = passes_dm and passes_ciga and passes_adequacy
    status = "PASS" if substance_test_passed else "FAIL"

    reasons: list[str] = []
    recommendations: list[str] = []

    if not passes_dm:
        reasons.append("Directed & managed in UAE test failed — board meetings / management must occur in UAE.")
        recommendations.append("Hold board meetings in the UAE with a quorum of directors physically present.")
    if not passes_ciga:
        reasons.append("CIGA test failed — core income-generating activities must be performed in the UAE.")
        recommendations.append(
            "Ensure core income-generating activities for the relevant activity are carried out in the UAE."
        )
    if not employees_ok:
        reasons.append("Adequacy failed — UAE employee count must be greater than zero.")
        recommendations.append("Employ an adequate number of qualified full-time employees in the UAE.")
    if not expenditure_ok:
        reasons.append("Adequacy failed — UAE expenditure must be greater than zero.")
        recommendations.append("Incur adequate operating expenditure in the UAE for the relevant activity.")
    if not assets_ok:
        reasons.append("Adequacy failed — UAE assets must be greater than zero.")
        recommendations.append("Maintain adequate physical assets in the UAE (office, equipment, etc.).")
    if substance_test_passed:
        reasons.append("All ESR substance tests passed.")

    return {
        "activity_type": activity,
        "passes_dm_test": passes_dm,
        "passes_ciga_test": passes_ciga,
        "passes_adequacy_test": passes_adequacy,
        "overall_status": status,
        "notification_deadline": f"{fy}-06-30",
        "filing_deadline": f"{fy}-12-31",
        "explanations": {
            "dm": (
                "Passed — entity directed and managed in UAE."
                if passes_dm
                else "Failed — board meetings / management must occur in UAE."
            ),
            "ciga": (
                "Passed — CIGAs performed in UAE."
                if passes_ciga
                else "Failed — core income-generating activities must be in UAE."
            ),
            "adequacy": (
                "Passed — adequate UAE employees, expenditure and assets."
                if passes_adequacy
                else "Failed — UAE employees, expenditure and assets must all be greater than zero."
            ),
        },
        "relevant_activity": activity,
        "substance_test_passed": substance_test_passed,
        "status": status,
        "reasons": reasons,
        "recommendations": recommendations,
    }


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
def esr_calculate(
    body: ESRCalculateRequest,
    tenant_id: str = Depends(get_tenant_id),
    company_id: str = Depends(get_company_id),
    db: Session = Depends(get_db),
) -> dict:
    """Run ESR substance tests and persist to esr_filings."""
    result = compute_esr_result(body)
    cid = (body.company_id or company_id or "").strip() or company_id
    _persist_esr(
        db,
        tenant_id=tenant_id,
        company_id=cid,
        body=body,
        status=str(result.get("status") or "FAIL"),
        reasons=list(result.get("reasons") or []),
    )
    return result
