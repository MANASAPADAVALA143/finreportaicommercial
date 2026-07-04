"""AP aging — backend endpoint over Supabase invoices, replacing the direct
browser-to-Supabase queries in frontend/src/lib/ap-invoice/agingService.ts's
getAgingSummary/getAgingInvoices. See ap_aging_service.py for why AP invoice
data comes from Supabase rather than the UAEPurchaseInvoice Postgres model.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Request

from app.services.ap_aging_service import compute_ap_aging

router = APIRouter(prefix="/api/ap", tags=["ap-aging"])


def _company_id(request: Request, query_company_id: Optional[str] = None) -> Optional[str]:
    return query_company_id or request.headers.get("x-company-id")


@router.get("/aging")
def ap_aging(
    request: Request,
    company_id: Optional[str] = None,
    as_of: Optional[str] = None,
) -> dict:
    cid = _company_id(request, company_id)
    as_of_date = date.fromisoformat(as_of) if as_of else None
    return compute_ap_aging(company_id=cid, as_of=as_of_date)
