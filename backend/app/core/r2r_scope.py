"""Workspace ownership checks for R2R clients."""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.company_access import AccessLevel, require_workspace_level
from app.middleware.workspace import WorkspaceContext
from app.models.r2r_learning import R2RClient


def owned_client_id(db: Session, ctx: WorkspaceContext, client_id: str | None, level: AccessLevel) -> str:
    """Return the client id if the caller's workspace owns it; 404 otherwise so ids are not probeable."""
    require_workspace_level(db, ctx, level)
    cid = (client_id or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="client_id is required")
    owned = (
        db.query(R2RClient.id)
        .filter(R2RClient.id == cid, R2RClient.workspace_id == ctx.workspace_id)
        .first()
    )
    if owned is None:
        raise HTTPException(status_code=404, detail="R2R client not found")
    return cid


def accounting_company_id(db: Session, ctx: WorkspaceContext, company_id: str | None, level: AccessLevel) -> str:
    """Accounting-synced R2R history is keyed by the UAE accounting tenant, which is the workspace id."""
    require_workspace_level(db, ctx, level)
    cid = (company_id or "").strip() or ctx.workspace_id
    if cid != ctx.workspace_id:
        raise HTTPException(status_code=404, detail="Company not found")
    return cid
