"""CFO auth adapter for ported GulfTax (uaetax) routers.

Maps FinReportAI X-Company-Id (UUID string) to the string company_id used by the uaetax
SQLAlchemy schema. Requires a FinReportAI login and membership of the active workspace; a
company is only usable if it belongs to that workspace or is a company the caller can access.
"""
from __future__ import annotations

import uuid
from typing import Callable, Optional

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.company_access import UUID_RE, AccessLevel, require_company_access, require_workspace_level
from app.core.database import get_db
from app.core.tenant_scope import request_workspace
from app.middleware.workspace import WorkspaceContext, validate_workspace

WEBHOOK_MARKER = "/n8n/inbound/"


def _ported_db():
    from app.modules.gulftax.ported_mount import get_ported_db

    yield from get_ported_db()


def _level(request: Request) -> AccessLevel:
    return "read" if request.method in ("GET", "HEAD") else "write"


def _accessible(main_db: Session, ctx: WorkspaceContext, cid: Optional[str], level: AccessLevel) -> bool:
    if not cid or not UUID_RE.match(cid):
        return False
    try:
        require_company_access(main_db, ctx, cid, level)
    except HTTPException:
        return False
    return True


def _owned(row, main_db: Session, ctx: WorkspaceContext, level: AccessLevel) -> bool:
    ws = ctx.workspace_id
    if row.workspace_id == ws or row.id == ws:
        return True
    return _accessible(main_db, ctx, row.id, level) or _accessible(main_db, ctx, row.external_id, level)


def _provision(db: Session, Company, ws: str, external: Optional[str]) -> str:
    # Keep uniqueness stable per workspace so restarts do not collide on unique indexes
    suffix = (ws or external or "")[:8]
    row = Company(
        id=str(uuid.uuid4()),
        name=f"Workspace {ws[:8]}",
        trade_license_number=f"FR-{suffix}-{uuid.uuid4().hex[:6]}",
        trn=f"100{abs(hash(external or ws)) % 10**12:012d}"[:15],
        entity_type="mainland",
        vat_registered=True,
        ct_registered=True,
        external_id=external or None,
        workspace_id=ws,
    )
    try:
        db.add(row)
        db.commit()
        db.refresh(row)
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"GulfTax company provisioning failed: {exc}",
        ) from exc
    return row.id


def resolve_company(
    db: Session, main_db: Session, ctx: WorkspaceContext, raw: Optional[str], level: AccessLevel
) -> str:
    """uaetax company id for `raw` (uaetax id, FinReportAI company UUID, or empty = workspace default)."""
    # Must use the same import path as ported routers (`from models import …`).
    # Absolute `app.modules.gulftax.ported.models` re-registers Company on the
    # same MetaData and raises InvalidRequestError: Table 'companies' is
    # already defined.
    from app.modules.gulftax.ported_mount import _ensure_ported_path

    _ensure_ported_path()
    from models import Company

    ws = ctx.workspace_id
    cid = (raw or "").strip()

    if not cid:
        row = db.query(Company).filter(Company.workspace_id == ws).first()
        return row.id if row else _provision(db, Company, ws, None)

    row = db.query(Company).filter(Company.id == cid).first()
    if row:
        if _owned(row, main_db, ctx, level):
            return row.id
        raise HTTPException(status_code=403, detail="No access to this company")

    rows = db.query(Company).filter(Company.external_id == cid).all()
    for r in rows:
        if r.workspace_id == ws:
            return r.id
    if cid != ws and not _accessible(main_db, ctx, cid, level):
        raise HTTPException(status_code=403, detail="No access to this company")
    if rows:
        return rows[0].id
    return _provision(db, Company, ws, cid)


def get_current_company_id(
    request: Request,
    x_company_id: Optional[str] = Header(default=None, alias="X-Company-Id"),
    ctx: WorkspaceContext = Depends(validate_workspace),
    main_db: Session = Depends(get_db),
    db: Session = Depends(_ported_db),
) -> str:
    """Resolve the CFO company header to a uaetax company_id the caller may use."""
    level = _level(request)
    require_workspace_level(main_db, ctx, level)
    request.state.workspace_ctx = ctx
    return resolve_company(db, main_db, ctx, x_company_id, level)


def gulftax_guard(
    request: Request,
    ctx: WorkspaceContext = Depends(validate_workspace),
    main_db: Session = Depends(get_db),
    db: Session = Depends(_ported_db),
) -> None:
    """Router guard: login + membership, and any company_id in path/query/header must be usable."""
    level = _level(request)
    require_workspace_level(main_db, ctx, level)
    request.state.workspace_ctx = ctx
    raws = {
        request.path_params.get("company_id"),
        request.query_params.get("company_id"),
        request.headers.get("x-company-id"),
    }
    for raw in raws - {None, ""}:
        resolve_company(db, main_db, ctx, raw, level)


def company_check(
    request: Request,
    ctx: WorkspaceContext = Depends(validate_workspace),
    main_db: Session = Depends(get_db),
    db: Session = Depends(_ported_db),
) -> Callable[[Optional[str]], Optional[str]]:
    """Dependency returning `check(raw)` for company ids outside path/query/header (body fields,
    aliases): the stripped id if the caller may use it, None if empty, else 403."""
    level = _level(request)

    def check(raw: Optional[str]) -> Optional[str]:
        cid = (raw or "").strip()
        if not cid:
            return None
        resolve_company(db, main_db, ctx, cid, level)
        return cid

    return check


def tenant_and_company(
    request: Request, check: Callable[[Optional[str]], Optional[str]], body_company: Optional[str] = None
) -> tuple[str, str]:
    """Active workspace, and the body company or X-Company-ID (both checked), else the workspace."""
    tenant_id = request_workspace(request)
    cid = check(body_company) or check(request.headers.get("X-Company-ID"))
    return tenant_id, cid or tenant_id


def include_guarded(app: FastAPI, router: APIRouter, **kwargs) -> None:
    """Include `router` behind `gulftax_guard`; HMAC-signed n8n webhooks are included unguarded."""
    guarded, webhooks = APIRouter(), APIRouter()
    for route in router.routes:
        (webhooks if WEBHOOK_MARKER in getattr(route, "path", "") else guarded).routes.append(route)
    app.include_router(guarded, dependencies=[Depends(gulftax_guard)], **kwargs)
    if webhooks.routes:
        app.include_router(webhooks, **kwargs)
