"""UAE CT return API — generate, approve, file workflow on RDS."""
from __future__ import annotations

from datetime import date
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services import ct_return_service as svc

router = APIRouter(prefix="/api/gulftax/ct-return", tags=["CT Return"])


def _tenant(request: Request) -> str:
    return request.headers.get("X-Workspace-ID") or request.headers.get("X-Tenant-ID") or "demo"


class GenerateCtReturnBody(BaseModel):
    company_id: Optional[str] = None
    period_start: str = Field(..., description="ISO date YYYY-MM-DD")
    period_end: str = Field(..., description="ISO date YYYY-MM-DD")


class FileCtReturnBody(BaseModel):
    override_reason: Optional[str] = None


@router.post("/generate")
def generate_ct_return_endpoint(
    body: GenerateCtReturnBody,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    tenant = workspace_id or _tenant(request)
    company_id = body.company_id or request.headers.get("X-Company-ID")
    if not company_id:
        raise HTTPException(400, "company_id required")
    try:
        period_start = date.fromisoformat(body.period_start[:10])
        period_end = date.fromisoformat(body.period_end[:10])
    except ValueError as exc:
        raise HTTPException(400, "Invalid period dates") from exc
    if period_end < period_start:
        raise HTTPException(400, "period_end must be on or after period_start")
    try:
        return svc.generate_ct_return(db, tenant, company_id, period_start, period_end)
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc


@router.get("")
def list_ct_returns_endpoint(
    request: Request,
    company_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    workspace_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    tenant = workspace_id or _tenant(request)
    cid = company_id or request.headers.get("X-Company-ID")
    if not cid:
        raise HTTPException(400, "company_id required")
    items = svc.list_ct_returns(db, tenant, cid, status=status)
    return {"items": items}


@router.get("/{return_id}")
def get_ct_return_endpoint(
    return_id: str,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    row = svc.get_ct_return(db, return_id)
    if not row:
        raise HTTPException(404, "CT return not found")
    return row


@router.post("/{return_id}/approve")
def approve_ct_return_endpoint(
    return_id: str,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        return svc.approve_ct_return(db, return_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/{return_id}/file")
def file_ct_return_endpoint(
    return_id: str,
    body: FileCtReturnBody | None = None,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        return svc.file_ct_return(
            db,
            return_id,
            override_reason=body.override_reason if body else None,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
