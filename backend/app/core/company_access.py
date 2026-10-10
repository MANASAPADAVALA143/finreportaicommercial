"""Company-level authorization for AP routes that use the Supabase service role.

Those routes bypass row-level security, so before any read or write the caller must
be a member of the workspace that owns the company, with a role that permits the
operation. Super admins pass every check.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterable, Iterator
from typing import Literal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.supabase import get_supabase
from app.middleware.workspace import WorkspaceContext
from app.models.users import UserRole
from app.models.workspace import WorkspaceMember, WorkspaceRole

logger = logging.getLogger(__name__)

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)

AccessLevel = Literal["read", "write", "manage"]

_ALLOWED_ROLES: dict[AccessLevel, set[str]] = {
    "read": {r.value for r in WorkspaceRole},
    "write": {WorkspaceRole.owner.value, WorkspaceRole.finance_manager.value, WorkspaceRole.accountant.value},
    "manage": {WorkspaceRole.owner.value, WorkspaceRole.finance_manager.value},
}

_LEVEL_LABEL: dict[AccessLevel, str] = {
    "read": "view",
    "write": "change",
    "manage": "perform destructive actions on",
}


def _value(role: object) -> str:
    return str(getattr(role, "value", role) or "")


def is_super_admin(ctx: WorkspaceContext) -> bool:
    return _value(getattr(ctx.user, "role", None)) == UserRole.super_admin.value


def _is_cfo(ctx: WorkspaceContext) -> bool:
    return _value(getattr(ctx.user, "role", None)) == UserRole.cfo.value


def _company_workspace_ids(db: Session, company_id: str) -> Iterator[str]:
    """Workspaces recorded as owning the company, cheapest source first."""
    from app.models.client_data import ApCompany
    from app.models.company_setup import UaeCompanyProfile

    row = db.get(ApCompany, company_id)
    if row is not None and row.tenant_id:
        yield str(row.tenant_id)

    profile = db.get(UaeCompanyProfile, company_id)
    if profile is not None and profile.workspace_id:
        yield str(profile.workspace_id)

    try:
        res = get_supabase().table("companies").select("workspace_id").eq("id", company_id).limit(1).execute()
        rows = res.data or []
        if rows and rows[0].get("workspace_id"):
            yield str(rows[0]["workspace_id"])
    except Exception as exc:
        logger.warning("company-access: company lookup failed for %s: %s", company_id, type(exc).__name__)


def _workspace_role(db: Session, ctx: WorkspaceContext, workspace_id: str) -> str | None:
    if workspace_id == ctx.workspace_id and ctx.role is not None:
        return _value(ctx.role)
    if ctx.user is None:
        return None
    member = db.query(WorkspaceMember).filter_by(workspace_id=workspace_id, user_id=ctx.user.id).first()
    return _value(member.role) if member else None


def require_company_access(
    db: Session, ctx: WorkspaceContext, company_id: str | None, level: AccessLevel = "read"
) -> str:
    """Return the normalised company id, or raise 403 if the caller may not act on it."""
    cid = (company_id or "").strip()
    if not UUID_RE.match(cid):
        raise HTTPException(status_code=422, detail="Invalid company_id")
    if is_super_admin(ctx):
        return cid

    role: str | None = None
    for ws_id in _company_workspace_ids(db, cid):
        role = _workspace_role(db, ctx, ws_id)
        if role is not None:
            break

    if role is None:
        logger.warning(
            "company-access: denied user=%s company=%s level=%s",
            getattr(ctx.user, "id", None), cid, level,
        )
        raise HTTPException(status_code=403, detail="No access to this company")
    if role not in _ALLOWED_ROLES[level] and not _is_cfo(ctx):
        raise HTTPException(
            status_code=403,
            detail=f"Your workspace role ({role}) cannot {_LEVEL_LABEL[level]} this company's invoices",
        )
    return cid


def require_invoice_access(
    db: Session, ctx: WorkspaceContext, invoice_ids: Iterable[str], level: AccessLevel = "read"
) -> dict[str, str]:
    """Map each invoice id to its company id after checking access to every company involved."""
    ids = list(dict.fromkeys(i.strip() for i in invoice_ids if (i or "").strip()))
    if not ids:
        raise HTTPException(status_code=422, detail="invoice_id required")
    bad = [i for i in ids if not UUID_RE.match(i)]
    if bad:
        raise HTTPException(status_code=422, detail="Invalid invoice_id")

    owners: dict[str, str] = {}
    sb = get_supabase()
    for start in range(0, len(ids), 200):
        chunk = ids[start:start + 200]
        rows = sb.table("invoices").select("id, company_id").in_("id", chunk).execute().data or []
        owners.update({str(r["id"]): str(r.get("company_id") or "") for r in rows})

    missing = [i for i in ids if i not in owners]
    if missing:
        raise HTTPException(status_code=404, detail=f"Invoice not found: {missing[0]}")
    for cid in set(owners.values()):
        require_company_access(db, ctx, cid, level)
    return owners


def resolve_workspace(db: Session, ctx: WorkspaceContext, requested: str | None) -> str:
    """Use the requested workspace only if the caller belongs to it; default to the active one."""
    ws = (requested or "").strip()
    if not ws or ws == ctx.workspace_id or is_super_admin(ctx):
        return ws or ctx.workspace_id
    if _workspace_role(db, ctx, ws) is None:
        raise HTTPException(status_code=403, detail="No access to this workspace")
    return ws
