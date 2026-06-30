"""Financial statement validation and export endpoints."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import io

from app.core.database import get_db
from app.services.uae_fs_validation_service import export_fs_excel, validate_financial_statements

router = APIRouter(prefix="/api/uae/fs", tags=["UAE Financial Statements"])


def _tenant(request: Request) -> str:
    return request.headers.get("X-Workspace-ID") or request.headers.get("X-Tenant-ID") or "demo"


@router.get("/validate")
def fs_validate(
    request: Request,
    workspace_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    period_start: str = Query(...),
    period_end: str = Query(...),
    db: Session = Depends(get_db),
):
    ws = workspace_id or _tenant(request)
    return validate_financial_statements(db, ws, company_id, period_start, period_end)


@router.post("/export-excel")
def fs_export_excel(
    request: Request,
    workspace_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    period_start: str = Query(...),
    period_end: str = Query(...),
    db: Session = Depends(get_db),
):
    ws = workspace_id or _tenant(request)
    data = export_fs_excel(db, ws, company_id, period_start, period_end)
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="financial_statements_{period_end[:7]}.xlsx"'},
    )
