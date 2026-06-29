"""Workspace validation middleware — enforces multi-tenant data isolation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import get_current_user
from app.models.users import User, UserRole
from app.models.workspace import Workspace, WorkspaceMember, WorkspaceRole


@dataclass
class WorkspaceContext:
    workspace_id: str
    workspace: Workspace
    user: User | None
    role: WorkspaceRole | None

    @property
    def tenant_id(self) -> str:
        """Alias used by UAE/India accounting modules."""
        return self.workspace_id


def _resolve_workspace_id(
    x_workspace_id: Annotated[str | None, Header(alias="X-Workspace-ID")] = None,
    x_tenant_id: Annotated[str | None, Header(alias="X-Tenant-ID")] = None,
) -> str | None:
    return (x_workspace_id or x_tenant_id or "").strip() or None


def get_workspace_context_optional(
    db: Session = Depends(get_db),
    workspace_id: str | None = Depends(_resolve_workspace_id),
) -> WorkspaceContext | None:
    if not workspace_id:
        return None
    ws = db.get(Workspace, workspace_id)
    if not ws or not ws.is_active:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return WorkspaceContext(workspace_id=ws.id, workspace=ws, user=None, role=None)


def validate_workspace(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    workspace_id: str | None = Depends(_resolve_workspace_id),
) -> WorkspaceContext:
    """Verify workspace access and inject workspace_id. Requires authentication."""
    if not workspace_id:
        workspace_id = user.company_id

    ws = db.get(Workspace, workspace_id)
    if not ws or not ws.is_active:
        raise HTTPException(status_code=404, detail="Workspace not found")

    if str(user.role) == UserRole.super_admin.value or user.role == UserRole.super_admin:
        return WorkspaceContext(workspace_id=ws.id, workspace=ws, user=user, role=WorkspaceRole.owner)

    member = (
        db.query(WorkspaceMember)
        .filter_by(workspace_id=ws.id, user_id=user.id)
        .first()
    )
    if not member:
        raise HTTPException(status_code=403, detail="No access to this workspace")

    return WorkspaceContext(
        workspace_id=ws.id,
        workspace=ws,
        user=user,
        role=member.role,
    )


def validate_workspace_read(
    ctx: WorkspaceContext = Depends(validate_workspace),
) -> WorkspaceContext:
    return ctx


def require_workspace_role(*roles: WorkspaceRole):
    wanted = {r.value if isinstance(r, WorkspaceRole) else r for r in roles}

    def _dep(ctx: WorkspaceContext = Depends(validate_workspace)) -> WorkspaceContext:
        if ctx.role and str(ctx.role.value if hasattr(ctx.role, "value") else ctx.role) in wanted:
            return ctx
        if ctx.user and str(ctx.user.role) in (UserRole.super_admin.value, UserRole.cfo.value):
            return ctx
        raise HTTPException(status_code=403, detail="Insufficient workspace permissions")

    return _dep


def validate_workspace_or_tenant(
    db: Session = Depends(get_db),
    workspace_id: str | None = Depends(_resolve_workspace_id),
    user: User | None = None,
) -> str:
    """Lightweight tenant resolver for routes that may run without auth (demo mode)."""
    tid = workspace_id or "demo"
    ws = db.get(Workspace, tid)
    if ws and ws.is_active:
        return ws.id
    return tid
