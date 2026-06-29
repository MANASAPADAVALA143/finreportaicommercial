"""AP AI insights — metrics from Supabase + Claude action cards."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.services.ap_insights_service import generate_ap_insights

router = APIRouter(prefix="/api/ap", tags=["ap-insights"])


class GenerateInsightsBody(BaseModel):
    workspace_id: Optional[str] = None
    company_id: Optional[str] = None


def _tenant(request: Request) -> str | None:
    return request.headers.get("X-Workspace-ID") or request.headers.get("X-Tenant-ID")


@router.post("/generate-insights")
def post_generate_insights(body: GenerateInsightsBody, request: Request):
    ws = body.workspace_id or _tenant(request)
    try:
        return generate_ap_insights(workspace_id=ws, company_id=body.company_id)
    except RuntimeError as exc:
        msg = str(exc)
        if "ANTHROPIC" in msg.upper():
            raise HTTPException(status_code=503, detail=msg) from exc
        raise HTTPException(status_code=503, detail=msg) from exc
