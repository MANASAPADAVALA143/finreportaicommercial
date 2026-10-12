"""Tenant for routes whose rows are keyed by the X-Tenant-ID header (IFRS, IFRS agentic, board packs).

The header may carry the workspace id, a company UUID, or a free-text label; `history_key`
checks access for the first two and namespaces labels under the caller's workspace.
GET requests need read access, everything else write access.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.company_access import AccessLevel, require_workspace_level
from app.core.database import get_db
from app.core.history_scope import history_key
from app.middleware.workspace import WorkspaceContext, validate_workspace


def active_workspace(db: Session, ctx: WorkspaceContext, requested: Optional[str], level: AccessLevel) -> str:
    """A workspace id sent in a body or query string must be the active (header) workspace."""
    ws = (requested or "").strip()
    if ws and ws != ctx.workspace_id:
        raise HTTPException(status_code=403, detail="workspace_id does not match the active workspace")
    require_workspace_level(db, ctx, level)
    return ctx.workspace_id


def header_tenant(
    request: Request,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-ID"),
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> str:
    level = "read" if request.method == "GET" else "write"
    return history_key(db, ctx, x_tenant_id or ctx.workspace_id, level)
