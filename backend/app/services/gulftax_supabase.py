"""GulfTax Supabase helpers — vat_return_entries, ct_computations, einvoice_validations."""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


def _box_for_treatment(vat_treatment: str, blocked_input_vat: bool) -> int:
    """Map VAT treatment to FTA return box (9/10/11)."""
    if vat_treatment == "reverse_charge":
        return 10
    if blocked_input_vat:
        return 11  # non-recoverable VAT tracked in box 11 aggregate
    return 9


def insert_vat_return_entry(
    *,
    workspace_id: str,
    company_id: Optional[str],
    period: str,
    source: str,
    transaction_id: str,
    vendor_name: str,
    net_amount: float,
    vat_amount: float,
    vat_treatment: str,
    blocked_input_vat: bool = False,
) -> Optional[Dict[str, Any]]:
    """Insert approved AP invoice into vat_return_entries (FinReportAI Supabase)."""
    try:
        from app.core.supabase import get_supabase
        sb = get_supabase()
        box_number = _box_for_treatment(vat_treatment, blocked_input_vat)
        row = {
            "workspace_id": workspace_id,
            "company_id": company_id,
            "period": period,
            "source": source,
            "transaction_id": transaction_id,
            "vendor_name": vendor_name,
            "net_amount": net_amount,
            "vat_amount": vat_amount,
            "vat_treatment": vat_treatment,
            "box_number": box_number,
        }
        res = sb.table("vat_return_entries").insert(row).execute()
        return (res.data or [None])[0]
    except Exception:
        logger.exception("Failed to insert vat_return_entry for %s", transaction_id)
        return None


def fetch_vat_return_boxes(workspace_id: str, period: str) -> Dict[str, Any]:
    """Aggregate Box 9/10/11 from vat_return_entries for a workspace period."""
    try:
        from app.core.supabase import get_supabase
        sb = get_supabase()
        res = (
            sb.table("vat_return_entries")
            .select("*")
            .eq("workspace_id", workspace_id)
            .eq("period", period)
            .execute()
        )
        rows = res.data or []
    except Exception:
        logger.exception("Failed to fetch vat_return_entries")
        rows = []

    box9_net = sum(r.get("net_amount", 0) for r in rows if r.get("box_number") == 9)
    box10_net = sum(r.get("net_amount", 0) for r in rows if r.get("box_number") == 10)
    box11_vat = sum(r.get("vat_amount", 0) for r in rows if r.get("box_number") in (9, 10, 11))

    return {
        "period": period,
        "workspace_id": workspace_id,
        "entry_count": len(rows),
        "box9_standard_rated_expenses": round(box9_net, 2),
        "box10_reverse_charge_imports": round(box10_net, 2),
        "box11_recoverable_input_vat": round(box11_vat, 2),
        "entries": rows,
    }


def fetch_advance_payment_invoices(
    workspace_id: str,
    period: str,
    company_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Fetch advance payment AP invoices for a VAT period from Supabase."""
    from app.modules.gulftax.vat_return_service import parse_period

    period_start, period_end = parse_period(period)
    try:
        from app.core.supabase import get_supabase
        sb = get_supabase()
        q = (
            sb.table("invoices")
            .select(
                "id, invoice_number, vendor_name, total_amount, invoice_date, "
                "delivery_date, advance_vat_amount, remaining_vat_amount, "
                "contract_value, company_id, is_advance_payment"
            )
            .eq("is_advance_payment", True)
            .gte("invoice_date", period_start.isoformat())
            .lte("invoice_date", period_end.isoformat())
        )
        if company_id:
            q = q.eq("company_id", company_id)
        res = q.execute()
        rows = res.data or []
    except Exception:
        logger.exception("Failed to fetch advance payment invoices for %s", period)
        rows = []

    advance_rows = []
    total_advance_vat = 0.0
    for r in rows:
        vat_included = float(r.get("advance_vat_amount") or 0)
        if vat_included <= 0:
            amt = float(r.get("total_amount") or 0)
            vat_included = round(amt * 0.05, 2)
        total_advance_vat += vat_included
        advance_rows.append({
            "invoice_number": r.get("invoice_number"),
            "customer": r.get("vendor_name"),
            "advance_amount": float(r.get("total_amount") or 0),
            "vat_included": vat_included,
            "delivery_expected": r.get("delivery_date"),
            "invoice_id": r.get("id"),
        })

    return {
        "advance_payment_count": len(advance_rows),
        "advance_payment_vat_total": round(total_advance_vat, 2),
        "advance_payments": advance_rows,
    }


def mark_invoice_je_posted(invoice_id: str, je_reference: str) -> bool:
    """Mark AP invoice as GL-posted in FinReportAI Supabase (commercial project).

    Call ONLY after a real row exists in SQLAlchemy `uae_journal_entries`.
    Never set this flag from a generated reference alone.
    """
    if not invoice_id or not (je_reference or "").strip():
        return False
    try:
        from app.core.supabase import get_supabase
        sb = get_supabase()
        sb.table("invoices").update({
            "je_posted": True,
            "je_reference": je_reference,
        }).eq("id", invoice_id).execute()
        return True
    except Exception:
        logger.exception("Failed to update je_posted for invoice %s", invoice_id)
        return False


def clear_invoice_je_posted(invoice_id: str, *, reason: str = "") -> bool:
    """Clear a false-positive je_posted flag when no GL row exists."""
    if not invoice_id:
        return False
    try:
        from app.core.supabase import get_supabase
        sb = get_supabase()
        sb.table("invoices").update({
            "je_posted": False,
            "je_reference": None,
        }).eq("id", invoice_id).execute()
        if reason:
            logger.warning(
                "Cleared je_posted for invoice %s — %s",
                invoice_id,
                reason,
            )
        return True
    except Exception:
        logger.exception("Failed to clear je_posted for invoice %s", invoice_id)
        return False
