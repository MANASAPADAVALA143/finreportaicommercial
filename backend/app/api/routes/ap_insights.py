"""AP AI insights — metrics from Supabase + Claude action cards."""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.company_access import require_company_access, resolve_workspace
from app.core.database import get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.services.ap_insights_service import generate_ap_insights

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ap", tags=["ap-insights"])


class GenerateInsightsBody(BaseModel):
    workspace_id: Optional[str] = None
    company_id: Optional[str] = None


@router.post("/generate-insights")
def post_generate_insights(
    body: GenerateInsightsBody,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
):
    company_id = require_company_access(db, ctx, body.company_id, "read")
    ws = resolve_workspace(db, ctx, body.workspace_id)
    try:
        return generate_ap_insights(workspace_id=ws, company_id=company_id)
    except RuntimeError as exc:
        # Supabase fetch failure — return degraded empty response instead of 503
        logger.warning("AP insights unavailable: %s", exc)
        return {
            "insights": [],
            "summary": {
                "total_billed": 0, "total_paid": 0, "open_balance": 0,
                "overdue_amount": 0, "dpo": 0, "payment_rate_pct": 0,
            },
            "empty": True,
            "degraded": True,
            "message": "AP insights temporarily unavailable — data could not be loaded",
        }
