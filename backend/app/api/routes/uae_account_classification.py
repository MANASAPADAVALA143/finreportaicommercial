"""UAE account classification API."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.uae_account_classification_service import (
    ai_classify_accounts,
    classification_summary,
    clear_classifications,
    list_accounts_with_status,
    manual_classify,
)

router = APIRouter(prefix="/api/uae/accounts", tags=["UAE Account Classification"])


def _tenant(request: Request) -> str:
    return (
        request.headers.get("X-Workspace-ID")
        or request.headers.get("X-Tenant-ID")
        or "demo"
    )


class AIClassifyBody(BaseModel):
    workspace_id: Optional[str] = None
    company_id: Optional[str] = None
    account_ids: list[str] = Field(default_factory=list)
    classifications: list[str] = Field(default_factory=lambda: ["bs_pl", "cash_flow", "cit", "fs_notes"])


class ManualClassifyBody(BaseModel):
    bs_pl_main: Optional[str] = None
    bs_pl_sub: Optional[str] = None
    fs_note_number: Optional[int] = None
    fs_note_heading: Optional[str] = None
    cash_flow_category: Optional[str] = None
    cit_category: Optional[str] = None
    cit_add_back: Optional[bool] = None


@router.get("/unclassified")
def get_unclassified(
    request: Request,
    workspace_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    period: Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    ws = workspace_id or _tenant(request)
    accounts = list_accounts_with_status(db, ws, company_id, period)
    return {"accounts": accounts, "summary": classification_summary(db, ws, company_id)}


@router.get("/classification-summary")
def get_summary(
    request: Request,
    workspace_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    ws = workspace_id or _tenant(request)
    return classification_summary(db, ws, company_id)


@router.post("/ai-classify")
def post_ai_classify(
    body: AIClassifyBody,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    ws = body.workspace_id or _tenant(request)
    ids = body.account_ids if body.account_ids else None
    try:
        return ai_classify_accounts(db, workspace_id=ws, company_id=body.company_id, account_ids=ids)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/manual-classify/{account_id}")
def post_manual_classify(
    account_id: str,
    body: ManualClassifyBody,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    ws = workspace_id or _tenant(request)
    try:
        return manual_classify(db, account_id, ws, company_id, body.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/clear")
def delete_clear(
    request: Request,
    workspace_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    ws = workspace_id or _tenant(request)
    count = clear_classifications(db, ws, company_id)
    return {"cleared": count}
