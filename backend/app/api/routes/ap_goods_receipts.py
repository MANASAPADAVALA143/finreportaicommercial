"""AP goods receipts — service-role bulk upsert (bypasses browser RLS)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.company_access import require_company_access
from app.core.database import get_db
from app.core.tenant_scope import workspace_member
from app.middleware.workspace import WorkspaceContext

router = APIRouter(prefix="/api/ap/goods-receipts", tags=["AP Goods Receipts"])


class BulkUpsertGrnsIn(BaseModel):
    company_id: str = Field(..., min_length=1)
    goods_receipts: list[dict[str, Any]] = Field(..., min_length=1)


@router.post("/bulk")
def bulk_upsert_goods_receipts(
    body: BulkUpsertGrnsIn,
    ctx: WorkspaceContext = Depends(workspace_member),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Excel / bulk import — Supabase service role, so the company check here is the only guard."""
    from app.services.ap_bulk_invoice_service import bulk_upsert_goods_receipts as _bulk

    cid = require_company_access(db, ctx, body.company_id, "write")
    return _bulk(company_id=cid, rows=body.goods_receipts)
