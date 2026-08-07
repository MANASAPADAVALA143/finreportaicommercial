"""AP purchase orders — service-role bulk upsert (bypasses browser RLS)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db

router = APIRouter(prefix="/api/ap/purchase-orders", tags=["AP Purchase Orders"])


class BulkUpsertPosIn(BaseModel):
    company_id: str = Field(..., min_length=1)
    purchase_orders: list[dict[str, Any]] = Field(..., min_length=1)


@router.post("/bulk")
def bulk_upsert_purchase_orders(
    body: BulkUpsertPosIn,
    db: Session = Depends(get_db),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    x_workspace_id: str | None = Header(default=None, alias="X-Workspace-Id"),
) -> dict[str, Any]:
    """Excel / bulk import path — Supabase service role so browser RLS cannot block."""
    _ = db, x_tenant_id, x_workspace_id
    from app.services.ap_bulk_invoice_service import bulk_upsert_purchase_orders as _bulk

    return _bulk(company_id=body.company_id.strip(), rows=body.purchase_orders)
