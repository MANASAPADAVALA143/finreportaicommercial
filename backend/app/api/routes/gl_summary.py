"""GET /api/integration/gl-summary — FP&A actuals from UAE GL."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.tenant_scope import request_workspace, workspace_reader
from app.services.gl_summary_service import build_gl_summary

router = APIRouter(prefix="/api/integration", tags=["GL Integration"], dependencies=[Depends(workspace_reader)])


@router.get("/gl-summary")
def gl_summary(
    request: Request,
    company_id: str,
    workspace_id: Optional[str] = None,
    period_start: str = "",
    period_end: str = "",
    db: Session = Depends(get_db),
):
    ws = request_workspace(request, workspace_id)
    return build_gl_summary(
        db,
        workspace_id=ws,
        company_id=company_id,
        period_start=period_start,
        period_end=period_end,
    )
