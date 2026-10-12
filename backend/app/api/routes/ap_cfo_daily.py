"""Daily CFO email — /api/ap/cfo-daily-summary for signed-in users,
POST /api/ap/n8n/cfo-daily-summary for the n8n cron (X-N8N-Signature)."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

from app.core.company_access import require_company_access
from app.core.database import get_db
from app.core.n8n_auth import require_n8n_signature
from app.core.tenant_scope import request_user_email, workspace_member
from app.middleware.workspace import WorkspaceContext
from app.services.ap_cfo_daily_summary_service import (
    build_cfo_daily_summary,
    send_cfo_daily_email,
)

router = APIRouter(prefix="/api/ap", tags=["ap-cfo-daily"])
n8n_router = APIRouter(prefix="/api/ap/n8n", tags=["ap-cfo-daily"])


class CfoDailySummaryRequest(BaseModel):
    company_id: Optional[str] = None
    days: int = Field(default=7, ge=1, le=90)
    send_email: bool = False
    to_email: Optional[str] = None  # ignored: signed-in users get their own copy, n8n sends to CFO_EMAIL
    market: Optional[str] = None  # "IN" | "AE"


def _company(db: Session, ctx: WorkspaceContext, request: Request, raw: Optional[str]) -> str:
    raw = raw or request.headers.get("x-company-id")
    if not (raw or "").strip():
        raise HTTPException(status_code=400, detail="company_id required")
    return require_company_access(db, ctx, raw, "read")


def _summary(request: Request, cid: str, days: int, send_email: bool, market: Optional[str]) -> dict:
    summary = build_cfo_daily_summary(company_id=cid, days=days, market=market)
    email_result = None
    if send_email:
        recipient = request_user_email(request)
        if not recipient:
            raise HTTPException(status_code=400, detail="Your account has no email address")
        email_result = send_cfo_daily_email(summary, to_email=recipient)
    return {**summary, "email": email_result}


@router.post("/cfo-daily-summary")
def cfo_daily_summary(
    request: Request,
    body: CfoDailySummaryRequest,
    ctx: WorkspaceContext = Depends(workspace_member),
    db: Session = Depends(get_db),
) -> dict:
    cid = _company(db, ctx, request, body.company_id)
    return _summary(request, cid, body.days, body.send_email, body.market)


@router.get("/cfo-daily-summary")
def cfo_daily_summary_get(
    request: Request,
    company_id: Optional[str] = None,
    days: int = 7,
    send_email: bool = False,
    market: Optional[str] = None,
    ctx: WorkspaceContext = Depends(workspace_member),
    db: Session = Depends(get_db),
) -> dict:
    cid = _company(db, ctx, request, company_id)
    return _summary(request, cid, max(1, min(days, 90)), send_email, market)


@n8n_router.post("/cfo-daily-summary")
async def cfo_daily_summary_n8n(
    request: Request,
    x_n8n_signature: Optional[str] = Header(default=None, alias="X-N8N-Signature"),
) -> dict:
    """Scheduled briefing for the deployment's own company (AP_COMPANY_ID in n8n), emailed to CFO_EMAIL."""
    raw = await request.body()
    require_n8n_signature(raw, x_n8n_signature)
    try:
        body = CfoDailySummaryRequest.model_validate_json(raw or b"{}")
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc
    cid = (body.company_id or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="company_id required")
    summary = build_cfo_daily_summary(company_id=cid, days=body.days, market=body.market)
    email_result = send_cfo_daily_email(summary) if body.send_email else None
    return {**summary, "email": email_result}
