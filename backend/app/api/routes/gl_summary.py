"""GET /api/integration/gl-summary — FP&A actuals from UAE GL."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.gl_summary_service import build_gl_summary

router = APIRouter(prefix="/api/integration", tags=["GL Integration"])


def _tenant(request: Request) -> str:
    return (
        request.headers.get("x-workspace-id")
        or request.headers.get("x-tenant-id")
        or "demo"
    )


@router.get("/gl-summary")
def gl_summary(
    request: Request,
    company_id: str,
    workspace_id: Optional[str] = None,
    period_start: str = "",
    period_end: str = "",
    db: Session = Depends(get_db),
):
    ws = workspace_id or _tenant(request)
    return build_gl_summary(
        db,
        workspace_id=ws,
        company_id=company_id,
        period_start=period_start,
        period_end=period_end,
    )
