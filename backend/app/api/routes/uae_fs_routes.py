"""Financial statement validation and export endpoints."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import io

from app.core.database import get_db
from app.core.tenant_scope import company_guard, request_workspace, workspace_member
from app.services.uae_fs_validation_service import export_fs_excel, validate_financial_statements

router = APIRouter(prefix="/api/uae/fs", tags=["UAE Financial Statements"], dependencies=[Depends(workspace_member), Depends(company_guard)])


@router.get("/validate")
def fs_validate(
    request: Request,
    workspace_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    period_start: str = Query(...),
    period_end: str = Query(...),
    db: Session = Depends(get_db),
):
    ws = request_workspace(request, workspace_id)
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
    ws = request_workspace(request, workspace_id)
    data = export_fs_excel(db, ws, company_id, period_start, period_end)
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="financial_statements_{period_end[:7]}.xlsx"'},
    )
