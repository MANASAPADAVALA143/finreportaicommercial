"""Group consolidation API."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import get_current_user
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.users import User
from app.services import consolidation_service as svc
from app.services.consolidation_pdf import generate_consolidation_pdf

router = APIRouter(prefix="/api/consolidation", tags=["Consolidation"])


class EliminationBody(BaseModel):
    period_id: str
    account_category: str
    # UI-1: amount is required and must be positive; zero default removed.
    amount: float
    # ADJ-1: 'pl' | 'bs' | 'both' — inferred from account_category when omitted.
    elimination_type: str | None = None
    company_from_id: str | None = None
    company_to_id: str | None = None
    note: str | None = None


@router.get("/periods")
def consolidation_periods(
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return {"periods": svc.list_periods(db, ctx.workspace_id)}


@router.get("/summary")
def summary(
    period_id: str,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        return svc.get_summary_cards(db, ctx.workspace_id, period_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/pl")
def consolidation_pl(
    period_id: str,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        return svc.get_consolidation_pl(db, ctx.workspace_id, period_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/bs")
def consolidation_bs(
    period_id: str,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        return svc.get_consolidation_bs(db, ctx.workspace_id, period_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/comparison")
def company_comparison(
    period_id: str,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        return {"companies": svc.get_company_comparison(db, ctx.workspace_id, period_id)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/eliminations")
def get_eliminations(
    period_id: str,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return {"eliminations": svc.list_eliminations(db, ctx.workspace_id, period_id)}


@router.post("/eliminations")
def save_elimination(
    body: EliminationBody,
    ctx: WorkspaceContext = Depends(validate_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    # UI-1: validation errors from the service layer surface as HTTP 400.
    try:
        return svc.upsert_elimination_amount(
            db,
            ctx.workspace_id,
            body.period_id,
            body.account_category,
            body.amount,
            body.note,
            user.id,
            body.elimination_type,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/ic-reference")
def next_ic_reference(
    period: str,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """SVC-1: allocate the next collision-resistant IC reference for a period."""
    ref = svc.next_ic_reference(db, ctx.workspace_id, period)
    db.commit()
    return {"ic_reference": ref}


@router.post("/export")
def export_pdf(
    period_id: str,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> Response:
    try:
        pl = svc.get_consolidation_pl(db, ctx.workspace_id, period_id)
        bs = svc.get_consolidation_bs(db, ctx.workspace_id, period_id)
        pdf = generate_consolidation_pdf(
            period_name=pl["period_name"],
            companies=pl["companies"],
            pl=pl,
            bs=bs,
            generated_at=datetime.utcnow().strftime("%d %b %Y %H:%M UTC"),
        )
        return Response(
            content=pdf,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="group-consolidation-{period_id[:8]}.pdf"'},
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
