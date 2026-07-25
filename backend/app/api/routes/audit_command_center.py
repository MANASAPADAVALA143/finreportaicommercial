"""Unified Audit Command Center API."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.gulftax.ported_mount import get_ported_db
from app.services.audit_command_center_service import (
    compute_command_center_score,
    generate_audit_narrative,
    summarize_ap_anomaly,
    summarize_je_pattern,
)
from app.services.audit_pdf_report import build_command_center_memo_pdf
from app.services.llm_service import LLMNotConfiguredError, LLMRateLimitError

router = APIRouter(tags=["audit-command-center"])


class ScoreBody(BaseModel):
    period: str = Field(..., min_length=4)
    workspace_id: str = Field(..., min_length=1)
    company_id: Optional[str] = None


class NarrativeBody(BaseModel):
    period: str
    company_name: Optional[str] = None
    composite_score: float = 0
    je_score: float = 0
    je_flags: list[str] = Field(default_factory=list)
    ap_score: float = 0
    ap_flags: list[str] = Field(default_factory=list)
    vat_score: float = 0
    vat_flags: list[str] = Field(default_factory=list)


def _company_from_headers(
    body_company: str | None,
    x_company_id: str | None,
) -> str:
    cid = (body_company or x_company_id or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="company_id required (body or X-Company-Id)")
    return cid


@router.post("/api/audit/command-center/score")
def audit_command_center_score(
    body: ScoreBody,
    db: Session = Depends(get_db),
    ported_db: Session = Depends(get_ported_db),
    x_company_id: Optional[str] = Header(default=None, alias="X-Company-Id"),
) -> dict[str, Any]:
    company_id = _company_from_headers(body.company_id, x_company_id)
    try:
        return compute_command_center_score(
            db,
            ported_db,
            period=body.period.strip(),
            workspace_id=body.workspace_id.strip(),
            company_id=company_id,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Score computation failed: {exc}") from exc


@router.post("/api/audit/narrative")
def audit_narrative(body: NarrativeBody) -> dict[str, Any]:
    try:
        return generate_audit_narrative(body.model_dump())
    except LLMNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except LLMRateLimitError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Narrative failed: {exc}") from exc


class NarrativePdfBody(NarrativeBody):
    narrative: str = Field(..., min_length=1)
    generated_at: Optional[str] = None
    composite_risk: Optional[str] = None


@router.post("/api/audit/narrative/pdf")
def audit_narrative_pdf(body: NarrativePdfBody) -> Response:
    try:
        pdf = build_command_center_memo_pdf(
            company_name=body.company_name or "Company",
            period=body.period,
            narrative=body.narrative,
            generated_at=body.generated_at,
            composite_score=body.composite_score,
            composite_risk=body.composite_risk,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"PDF build failed: {exc}") from exc

    filename = f"audit_findings_{body.period.replace('/', '-')}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/api/r2r/pattern/summary")
def r2r_pattern_summary(
    period: str = Query(...),
    workspace_id: str = Query(...),
    company_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    x_company_id: Optional[str] = Header(default=None, alias="X-Company-Id"),
) -> dict[str, Any]:
    cid = (company_id or x_company_id or "").strip() or None
    return summarize_je_pattern(
        db, period=period, workspace_id=workspace_id, company_id=cid
    )


@router.get("/api/ap-invoices/anomaly/summary")
def ap_anomaly_summary(
    period: str = Query(...),
    workspace_id: str = Query(...),
    company_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    x_company_id: Optional[str] = Header(default=None, alias="X-Company-Id"),
) -> dict[str, Any]:
    cid = (company_id or x_company_id or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="company_id required")
    return summarize_ap_anomaly(
        db, period=period, workspace_id=workspace_id, company_id=cid
    )
