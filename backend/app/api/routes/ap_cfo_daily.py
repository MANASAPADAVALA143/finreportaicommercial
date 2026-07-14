"""Daily CFO email — POST /api/ap/cfo-daily-summary for n8n cron."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.services.ap_cfo_daily_summary_service import (
    build_cfo_daily_summary,
    send_cfo_daily_email,
)

router = APIRouter(prefix="/api/ap", tags=["ap-cfo-daily"])


class CfoDailySummaryRequest(BaseModel):
    company_id: Optional[str] = None
    days: int = Field(default=7, ge=1, le=90)
    send_email: bool = False
    to_email: Optional[str] = None
    market: Optional[str] = None  # "IN" | "AE"


def _company_id(request: Request, body_company_id: Optional[str] = None) -> Optional[str]:
    return body_company_id or request.headers.get("x-company-id")


@router.post("/cfo-daily-summary")
def cfo_daily_summary(request: Request, body: CfoDailySummaryRequest) -> dict:
    cid = _company_id(request, body.company_id)
    summary = build_cfo_daily_summary(company_id=cid, days=body.days, market=body.market)
    email_result = None
    if body.send_email:
        email_result = send_cfo_daily_email(summary, to_email=body.to_email)
    return {**summary, "email": email_result}


@router.get("/cfo-daily-summary")
def cfo_daily_summary_get(
    request: Request,
    company_id: Optional[str] = None,
    days: int = 7,
    send_email: bool = False,
    market: Optional[str] = None,
) -> dict:
    cid = _company_id(request, company_id)
    summary = build_cfo_daily_summary(company_id=cid, days=max(1, min(days, 90)), market=market)
    email_result = None
    if send_email:
        email_result = send_cfo_daily_email(summary)
    return {**summary, "email": email_result}
