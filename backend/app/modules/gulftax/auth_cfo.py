"""CFO auth adapter for ported GulfTax (uaetax) routers.

Maps FinReportAI X-Company-Id (UUID string) + X-Workspace-Id to the
string company_id used by the uaetax SQLAlchemy schema.
"""
from __future__ import annotations

import os
import uuid
from typing import Optional

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session


def _ported_db():
    from app.modules.gulftax.ported_mount import get_ported_db

    yield from get_ported_db()


async def get_current_company_id(
    x_company_id: Optional[str] = Header(default=None, alias="X-Company-Id"),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
    db: Session = Depends(_ported_db),
) -> str:
    """Resolve CFO company/workspace headers to uaetax company_id."""
    # Must use the same import path as ported routers (`from models import …`).
    # Absolute `app.modules.gulftax.ported.models` re-registers Company on the
    # same MetaData and raises InvalidRequestError: Table 'companies' is
    # already defined.
    from app.modules.gulftax.ported_mount import _ensure_ported_path

    _ensure_ported_path()
    from models import Company

    cid = (x_company_id or "").strip()
    if cid and db.query(Company).filter(Company.id == cid).first():
        return cid

    external = cid
    workspace = (x_workspace_id or "").strip()

    if external:
        row = db.query(Company).filter(Company.external_id == external).first()
        if row:
            return row.id

    if workspace:
        row = db.query(Company).filter(Company.workspace_id == workspace).first()
        if row:
            return row.id

    # Auto-provision a company row for this workspace/company pair
    name = f"Workspace {workspace[:8]}" if workspace else "FinReportAI Company"
    # Keep uniqueness stable per workspace so restarts do not collide on unique indexes
    suffix = (workspace or external or "demo")[:8]
    row = Company(
        id=str(uuid.uuid4()),
        name=name,
        trade_license_number=f"FR-{suffix}-{uuid.uuid4().hex[:6]}",
        trn=f"100{abs(hash(external or workspace or 'demo')) % 10**12:012d}"[:15],
        entity_type="mainland",
        vat_registered=True,
        ct_registered=True,
        external_id=external or None,
        workspace_id=workspace or None,
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
