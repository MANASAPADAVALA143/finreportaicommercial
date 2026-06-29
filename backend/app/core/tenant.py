"""Tenant isolation helpers — every data query must filter by tenant_id."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.middleware.auth import get_current_user
from app.models.users import User, UserRole
from app.models.workspace import Workspace, WorkspaceMember


def _resolve_workspace_id(
    x_workspace_id: Annotated[str | None, Header(alias="X-Workspace-ID")] = None,
    x_tenant_id: Annotated[str | None, Header(alias="X-Tenant-ID")] = None,
) -> str | None:
    return (x_workspace_id or x_tenant_id or "").strip() or None


def get_tenant_id(
    user: User = Depends(get_current_user),
    workspace_id: str | None = Depends(_resolve_workspace_id),
    db: Session = Depends(get_db),
) -> str:
    """Resolve and authorize tenant_id (workspace UUID) for the current request."""
    tenant_id = workspace_id or _tenant_id_from_user_metadata(user) or user.company_id
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant context required")

    if settings.ENVIRONMENT == "demo" and tenant_id != settings.DEMO_TENANT_ID:
        # Demo deployment: only the demo tenant is visible
        if not _is_super_admin(user):
            tenant_id = settings.DEMO_TENANT_ID

    ws = db.get(Workspace, tenant_id)
    if ws and not ws.is_active:
        raise HTTPException(status_code=404, detail="Workspace not found")

    if _is_super_admin(user):
        return tenant_id

    member = (
        db.query(WorkspaceMember)
        .filter_by(workspace_id=tenant_id, user_id=user.id)
        .first()
    )
    if not member and ws is None:
        # Legacy header-only tenant (pre-workspace row) — allow if user company matches
        if tenant_id != user.company_id:
            raise HTTPException(status_code=403, detail="No access to this tenant")
        return tenant_id
    if not member:
        raise HTTPException(status_code=403, detail="No access to this tenant")

    return tenant_id


def get_company_id(
    user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
    x_company_id: Annotated[str | None, Header(alias="X-Company-ID")] = None,
) -> str:
    """AP company scope — header, user record, or tenant workspace id."""
    cid = (x_company_id or user.company_id or tenant_id or "").strip()
    if not cid:
        raise HTTPException(status_code=403, detail="Company context required")
    return cid


def assert_write_allowed() -> None:
    """Block mutating operations in demo environment."""
    if settings.ENVIRONMENT == "demo":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Demo environment is read-only. Contact us for production access.",
        )


def _is_super_admin(user: User) -> bool:
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    return role == UserRole.super_admin.value


def _tenant_id_from_user_metadata(user: User) -> str | None:
    # Populated from Supabase user_metadata.tenant_id in ensure_rbac_user
    tid = getattr(user, "tenant_id", None)
    return str(tid).strip() if tid else None
