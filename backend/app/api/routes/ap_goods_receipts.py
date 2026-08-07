"""AP goods receipts — service-role bulk upsert (bypasses browser RLS)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db

router = APIRouter(prefix="/api/ap/goods-receipts", tags=["AP Goods Receipts"])


class BulkUpsertGrnsIn(BaseModel):
    company_id: str = Field(..., min_length=1)
    goods_receipts: list[dict[str, Any]] = Field(..., min_length=1)


@router.post("/bulk")
def bulk_upsert_goods_receipts(
    body: BulkUpsertGrnsIn,
    db: Session = Depends(get_db),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    x_workspace_id: str | None = Header(default=None, alias="X-Workspace-Id"),
) -> dict[str, Any]:
    """Excel / bulk import — Supabase service role so browser RLS cannot block any company."""
    _ = db, x_tenant_id, x_workspace_id
    from app.services.ap_bulk_invoice_service import bulk_upsert_goods_receipts as _bulk

    return _bulk(company_id=body.company_id.strip(), rows=body.goods_receipts)
