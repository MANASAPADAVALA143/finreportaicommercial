"""AP aging — backend endpoint over Supabase invoices, replacing the direct
browser-to-Supabase queries in frontend/src/lib/ap-invoice/agingService.ts's
getAgingSummary/getAgingInvoices. See ap_aging_service.py for why AP invoice
data comes from Supabase rather than the UAEPurchaseInvoice Postgres model.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.company_access import require_company_access
from app.core.database import get_db
from app.core.tenant_scope import workspace_member
from app.middleware.workspace import WorkspaceContext
from app.services.ap_aging_service import compute_ap_aging

router = APIRouter(prefix="/api/ap", tags=["ap-aging"])


@router.get("/aging")
def ap_aging(
    request: Request,
    company_id: Optional[str] = None,
    as_of: Optional[str] = None,
    ctx: WorkspaceContext = Depends(workspace_member),
    db: Session = Depends(get_db),
) -> dict:
    raw = company_id or request.headers.get("x-company-id")
    if not (raw or "").strip():
        raise HTTPException(status_code=400, detail="company_id required")
    cid = require_company_access(db, ctx, raw, "read")
    as_of_date = date.fromisoformat(as_of) if as_of else None
    return compute_ap_aging(company_id=cid, as_of=as_of_date)
