"""AP companies — canonical company list (ap_companies.id)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.tenant import get_tenant_id
from app.middleware.auth import get_current_user
from app.models.users import User
from app.models.workspace import Workspace
from app.services.ap_company_resolver import list_ap_companies
from app.services.ap_company_sync import sync_ap_company_for_workspace, upsert_ap_company_rds

router = APIRouter(prefix="/api/ap/companies", tags=["AP Companies"])


@router.get("")
def get_ap_companies(
    tenant_id: str = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """List ap_companies rows for the active tenant — used by FPA upload and cross-module joins."""
    rows = list_ap_companies(db, tenant_id)
    if not rows:
        ws = db.get(Workspace, tenant_id)
        if ws:
            supabase_co = sync_ap_company_for_workspace(ws)
            if supabase_co:
                upsert_ap_company_rds(db, ws, supabase_co)
                rows = list_ap_companies(db, tenant_id)
    return {
        "companies": [
            {
                "id": c.id,
                "name": c.name,
                "slug": c.slug,
                "market": c.market,
                "accounting_standard": c.accounting_standard,
            }
            for c in rows
        ],
        "count": len(rows),
    }
