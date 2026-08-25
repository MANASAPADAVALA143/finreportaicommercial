"""AP aging — mirrors ar_aging_service.py's bucket scheme (Current/1-30/31-60/
61-90/90+, 0/30/60/90-day boundaries) so AR and AP report on identical
boundaries. Bucket/label/risk constants are imported, not redefined, so the
two can't drift apart the way the old AR implementations did.

AP invoice data lives in Supabase's `invoices` table — the same table
frontend/src/lib/ap-invoice/agingService.ts already queries directly from the
browser. It is NOT the UAEPurchaseInvoice Postgres model: that table is a
GL-posting mirror created only once an invoice is approved and posted
(see ap_invoice_post_service.py), so it structurally excludes drafts/pending/
unposted invoices and would under-report open AP if used for aging.

"Open for aging" mirrors frontend/src/lib/ap-invoice/paymentService.ts's
isInvoiceOpenForPayment(): status not in (Paid, Rejected) and payment_status
not in (paid, cancelled), plus a due_date present — same definition, just
evaluated server-side instead of in the browser.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from app.core.supabase import get_supabase
from app.services.ar_aging_service import BUCKET_ORDER, BUCKET_LABELS, BUCKET_RISK, bucket_key

_CLOSED_STATUSES = {"paid", "rejected"}
_CLOSED_PAYMENT_STATUSES = {"paid", "cancelled"}


def _parse_date(value: Any) -> Optional[date]:
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return datetime.fromisoformat(str(value)[:10]).date()
    except ValueError:
        return None


def _is_open_for_aging(row: dict[str, Any]) -> bool:
    if (row.get("status") or "").strip().lower() in _CLOSED_STATUSES:
        return False
    if (row.get("payment_status") or "").strip().lower() in _CLOSED_PAYMENT_STATUSES:
        return False
    return _parse_date(row.get("due_date")) is not None


def _fetch_open_ap_invoices(company_id: Optional[str] = None) -> list[dict[str, Any]]:
    sb = get_supabase()
    q = sb.table("invoices").select(
        "id,invoice_number,vendor_name,total_amount,invoice_date,due_date,"
        "payment_status,status,company_id"
    )
    if company_id:
        q = q.eq("company_id", company_id)
    res = q.execute()
    rows = list(res.data or [])
    return [r for r in rows if _is_open_for_aging(r)]


def compute_ap_aging(company_id: Optional[str] = None, as_of: Optional[date] = None) -> dict[str, Any]:
    as_of_date = as_of or date.today()
    rows = _fetch_open_ap_invoices(company_id)

    bucket_amounts = {k: 0.0 for k in BUCKET_ORDER}
    bucket_counts = {k: 0 for k in BUCKET_ORDER}
    details = []
    total_outstanding = 0.0

    for row in rows:
        amt = float(row.get("total_amount") or 0)
        if amt <= 0:
            continue
        due = _parse_date(row.get("due_date")) or as_of_date
        days = (as_of_date - due).days
        key = bucket_key(days)

        total_outstanding += amt
        bucket_amounts[key] += amt
        bucket_counts[key] += 1

        details.append({
            "id": row.get("id"),
            "invoice_number": row.get("invoice_number"),
            "vendor_name": row.get("vendor_name"),
            "amount": round(amt, 2),
            "invoice_date": row.get("invoice_date"),
            "due_date": row.get("due_date"),
            "payment_status": row.get("payment_status"),
            "days_overdue": max(days, 0),
            "aging_bucket": key,
            "bucket_label": BUCKET_LABELS[key],
        })

    # Overdue = everything outside the "not yet due" current bucket — same
    # definition as ar_aging_service.compute_ar_aging().
    total_overdue = round(total_outstanding - bucket_amounts["current"], 2)

    buckets = [
        {
            "key": key,
            "label": BUCKET_LABELS[key],
            "risk": BUCKET_RISK[key],
            "invoice_count": bucket_counts[key],
            "total_amount": round(bucket_amounts[key], 2),
        }
        for key in BUCKET_ORDER
    ]

    return {
        "as_of": str(as_of_date),
        "total_outstanding": round(total_outstanding, 2),
        "total_overdue": total_overdue,
        "buckets": buckets,
        "invoices": details,
    }
