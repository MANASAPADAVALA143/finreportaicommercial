"""Workspace audit log — GET /api/audit/log"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.workspace_audit import WorkspaceAuditLog

router = APIRouter(prefix="/api/audit", tags=["Audit Log"])


def _tenant(request: Request) -> str:
    return (
        request.headers.get("x-workspace-id")
        or request.headers.get("x-tenant-id")
        or "demo"
    )


@router.get("/log")
def get_audit_log(
    request: Request,
    workspace_id: Optional[str] = None,
    company_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    action: Optional[str] = None,
    page: int = 0,
    page_size: int = 50,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    tenant_id = workspace_id or _tenant(request)
    q = db.query(WorkspaceAuditLog).filter(WorkspaceAuditLog.workspace_id == tenant_id)

    if company_id:
        q = q.filter(WorkspaceAuditLog.company_id == company_id)
    if action:
        q = q.filter(WorkspaceAuditLog.action == action)
    if from_date:
        q = q.filter(WorkspaceAuditLog.created_at >= datetime.combine(date.fromisoformat(from_date), datetime.min.time()))
    if to_date:
        q = q.filter(WorkspaceAuditLog.created_at <= datetime.combine(date.fromisoformat(to_date), datetime.max.time()))

    total = q.count()
    rows = (
        q.order_by(WorkspaceAuditLog.created_at.desc())
        .offset(max(0, page) * page_size)
        .limit(min(page_size, 200))
        .all()
    )

    return {
        "entries": [
            {
                "id": r.id,
                "workspace_id": r.workspace_id,
                "company_id": r.company_id,
                "action": r.action,
                "entity_type": r.entity_type,
                "entity_id": r.entity_id,
                "user_email": r.user_email,
                "details": r.details or {},
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
