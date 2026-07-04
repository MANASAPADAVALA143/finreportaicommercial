"""Sync AR sales invoices into GulfTax gulftax_transactions (output VAT)."""

from __future__ import annotations

import logging
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.models.uae_accounting_full import UAESalesInvoice

logger = logging.getLogger(__name__)


def _existing_ar_in_gulftax(sales_invoice_id: str) -> bool:
    try:
        from app.core.supabase import get_supabase

        sb = get_supabase()
        res = (
            sb.table("gulftax_transactions")
            .select("id")
            .eq("ap_invoice_id", sales_invoice_id)
            .eq("direction", "output")
            .eq("status", "posted")
            .limit(1)
            .execute()
        )
        return bool(res.data)
    except Exception:
        return False


def _supply_to_vat_treatment(supply_type: str | None) -> str:
    t = (supply_type or "standard").lower().replace("-", "_")
    if t in ("zero", "zero_rated"):
        return "zero_rated"
    if t == "exempt":
        return "exempt"
    return "standard_rated"


def build_ar_transaction_row(
    inv: UAESalesInvoice,
    *,
    customer_name: str,
    company_id: str,
    workspace_id: str,
) -> dict[str, Any]:
    from app.services.gulftax_sync_service import (
        _fetch_company_config,
        _fta_box,
        _norm_treatment,
        tax_period_for_date,
    )

    company = _fetch_company_config(company_id)
    ws_id = workspace_id or company.get("workspace_id") or company_id
    inv_date = inv.invoice_date or date.today()
    filing = company.get("vat_filing_frequency") or "quarterly"
    tax_period = tax_period_for_date(inv_date, filing)

    gross = round(float(inv.total_amount or 0), 2)
    vat = round(float(inv.vat_amount or 0), 2)
    subtotal = round(float(inv.subtotal or 0), 2)
    if vat <= 0 and gross > 0 and subtotal > 0:
        vat = round(gross - subtotal, 2)

    vat_category = _norm_treatment(_supply_to_vat_treatment(inv.supply_type))
    fta_box = _fta_box(vat_category, "output")

    return {
        "source": "ar_sales",
        "ap_invoice_id": inv.id,
        "company_id": company_id,
        "workspace_id": ws_id,
        "tax_period": tax_period,
        "transaction_date": inv_date.isoformat(),
        "vendor_name": customer_name,
        "vendor_trn": inv.buyer_trn,
        "invoice_number": inv.invoice_number,
        "gross_amount": gross,
        "vat_amount": vat,
        "vat_category": vat_category,
        "fta_box": fta_box,
        "direction": "output",
        "status": "posted",
        "updated_at": date.today().isoformat(),
    }


def sync_ar_invoice_to_gulftax(
    db: Session,
    sales_invoice_id: str,
    company_id: str,
    *,
    workspace_id: str | None = None,
) -> dict[str, Any]:
    """Insert one posted AR sales invoice into gulftax_transactions (idempotent)."""
    if not sales_invoice_id or not company_id:
        return {"ok": False, "error": "sales_invoice_id and company_id required"}

    if _existing_ar_in_gulftax(sales_invoice_id):
        return {"ok": True, "skipped": True, "reason": "already_synced"}

    inv = db.query(UAESalesInvoice).filter_by(id=sales_invoice_id).first()
    if not inv:
        return {"ok": False, "error": "sales_invoice_not_found"}

    if (inv.status or "") not in ("posted", "sent", "partial", "paid", "overdue"):
        return {"ok": False, "error": f"invoice_not_posted:{inv.status}"}

    customer_name = inv.customer.name if inv.customer else "Customer"
    row = build_ar_transaction_row(
        inv,
        customer_name=customer_name,
        company_id=company_id,
        workspace_id=workspace_id or inv.tenant_id,
    )

    try:
        from app.core.supabase import get_supabase

        sb = get_supabase()
        res = sb.table("gulftax_transactions").insert(row).execute()
        inserted = (res.data or [None])[0]
        return {
            "ok": True,
            "transaction_id": inserted.get("id") if inserted else None,
            "tax_period": row["tax_period"],
            "fta_box": row["fta_box"],
            "company_id": company_id,
        }
    except Exception as exc:
        logger.exception("AR gulftax sync failed for sales invoice %s", sales_invoice_id)
        return {"ok": False, "error": str(exc)}
