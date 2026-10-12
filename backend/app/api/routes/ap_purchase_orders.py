"""AP purchase orders — service-role bulk upsert (bypasses browser RLS)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.company_access import require_company_access
from app.core.database import get_db
from app.core.tenant_scope import workspace_member
from app.middleware.workspace import WorkspaceContext

router = APIRouter(prefix="/api/ap/purchase-orders", tags=["AP Purchase Orders"])


class BulkUpsertPosIn(BaseModel):
    company_id: str = Field(..., min_length=1)
    purchase_orders: list[dict[str, Any]] = Field(..., min_length=1)


@router.post("/bulk")
def bulk_upsert_purchase_orders(
    body: BulkUpsertPosIn,
    ctx: WorkspaceContext = Depends(workspace_member),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Excel / bulk import path — Supabase service role, so the company check here is the only guard."""
    from app.services.ap_bulk_invoice_service import bulk_upsert_purchase_orders as _bulk

    cid = require_company_access(db, ctx, body.company_id, "write")
    return _bulk(company_id=cid, rows=body.purchase_orders)


class EnsureWorkspacePosIn(BaseModel):
    company_id: str = Field(..., min_length=1)


@router.post("/ensure-workspace-matches")
def ensure_workspace_matches(
    body: EnsureWorkspacePosIn,
    ctx: WorkspaceContext = Depends(workspace_member),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Copy missing POs from sibling workspace companies and relink GRNs + fill property_ref."""
    from app.services.ap_bulk_invoice_service import ensure_workspace_pos_and_relink_grns

    cid = require_company_access(db, ctx, body.company_id, "write")
    return ensure_workspace_pos_and_relink_grns(company_id=cid)
