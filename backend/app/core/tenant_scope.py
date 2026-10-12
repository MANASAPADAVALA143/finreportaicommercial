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


def workspace_member(
    request: Request,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> WorkspaceContext:
    """Router-level guard for routes keyed by the X-Workspace-ID / X-Tenant-ID header.

    `validate_workspace` falls back to another of the caller's workspaces when the header names
    an unknown one, so routes must read the tenant via `request_workspace`, never the raw header.
    GET/HEAD need read access, everything else write access.
    """
    require_workspace_level(db, ctx, "read" if request.method in ("GET", "HEAD") else "write")
    request.state.workspace_ctx = ctx
    return ctx


def workspace_writer(
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> WorkspaceContext:
    """Route guard for GET routes that change data."""
    require_workspace_level(db, ctx, "write")
    return ctx


def workspace_manager(
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> WorkspaceContext:
    """Route guard for approvals, control changes and bulk deletes: owner or finance manager only."""
    require_workspace_level(db, ctx, "manage")
    return ctx


def _request_ctx(request: Request) -> WorkspaceContext:
    ctx = getattr(request.state, "workspace_ctx", None)
    if ctx is None:
        raise RuntimeError("needs the workspace_member router dependency")
    return ctx


def request_workspace(request: Request, requested: Optional[str] = None) -> str:
    """Workspace validated by `workspace_member`; a body/query `workspace_id` must match it."""
    ws = _request_ctx(request).workspace_id
    asked = (requested or "").strip()
    if asked and asked != ws:
        raise HTTPException(status_code=403, detail="workspace_id does not match the active workspace")
    return ws


def request_user_email(request: Request) -> Optional[str]:
    """Signed-in user's email, for audit trails (never a client-supplied header)."""
    user = _request_ctx(request).user
    return getattr(user, "email", None) if user else None


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
