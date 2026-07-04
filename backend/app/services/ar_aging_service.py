"""Canonical AR aging — single source of truth for all AR aging/collections callers.

Bucket scheme: Current / 1-30 / 31-60 / 61-90 / 90+ (day boundaries 0/30/60/90),
measured from due_date to as_of. uae_ar_routes.ar_aging, uae_full_routes.ar_aging,
and cfo_uae_data_service.build_ar_summary all call compute_ar_aging() and reshape
its output for their own response contracts — do not re-implement the bucketing
logic in any of those callers.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models.uae_accounting_full import UAESalesInvoice

BUCKET_ORDER = ["current", "1_30", "31_60", "61_90", "90_plus"]
BUCKET_LABELS = {
    "current": "Current",
    "1_30": "1-30 days",
    "31_60": "31-60 days",
    "61_90": "61-90 days",
    "90_plus": "90+ days",
}
# Ordinal risk tier per bucket — shared so CFO dashboard risk badges and
# per-customer risk escalation use one definition instead of duplicated day checks.
BUCKET_RISK = {
    "current": "low",
    "1_30": "medium",
    "31_60": "high",
    "61_90": "high",
    "90_plus": "critical",
}


def bucket_key(days_overdue: int) -> str:
    if days_overdue <= 0:
        return "current"
    if days_overdue <= 30:
        return "1_30"
    if days_overdue <= 60:
        return "31_60"
    if days_overdue <= 90:
        return "61_90"
    return "90_plus"


def compute_ar_aging(
    db: Session,
    tenant_id: str,
    company_id: Optional[str] = None,
    as_of: Optional[date] = None,
) -> dict[str, Any]:
    as_of_date = as_of or date.today()
    q = db.query(UAESalesInvoice).filter(
        UAESalesInvoice.tenant_id == tenant_id,
        UAESalesInvoice.outstanding > 0,
    )
    if company_id:
        q = q.filter(UAESalesInvoice.company_id == company_id)
    invoices = q.all()

    bucket_amounts = {k: 0.0 for k in BUCKET_ORDER}
    bucket_counts = {k: 0 for k in BUCKET_ORDER}
    bucket_customers: dict[str, list[str]] = {k: [] for k in BUCKET_ORDER}
    details = []
    total_outstanding = 0.0

    for inv in invoices:
        amt = float(inv.outstanding or 0)
        if amt <= 0:
            continue
        due = inv.due_date or as_of_date
        days = (as_of_date - due).days
        key = bucket_key(days)

        total_outstanding += amt
        bucket_amounts[key] += amt
        bucket_counts[key] += 1
        cust_name = inv.customer.name if inv.customer else "Unknown Customer"
        if cust_name not in bucket_customers[key]:
            bucket_customers[key].append(cust_name)

        details.append({
            "invoice_id": inv.id,
            "invoice_number": inv.invoice_number,
            "customer_id": inv.customer_id,
            "customer_name": cust_name,
            "due_date": str(due),
            "amount_due": round(amt, 2),
            "days_overdue": max(days, 0),
            "bucket": key,
            "bucket_label": BUCKET_LABELS[key],
            "risk": BUCKET_RISK[key],
        })

    buckets = [
        {
            "bucket": key,
            "label": BUCKET_LABELS[key],
            "risk": BUCKET_RISK[key],
            "invoice_count": bucket_counts[key],
            "amount": round(bucket_amounts[key], 2),
            "pct": round(bucket_amounts[key] / total_outstanding * 100, 1) if total_outstanding else 0,
            "customers": bucket_customers[key],
        }
        for key in BUCKET_ORDER
    ]

    # Overdue = everything outside the "not yet due" current bucket.
    total_overdue = round(total_outstanding - bucket_amounts["current"], 2)

    return {
        "as_of": str(as_of_date),
        "currency": "AED",
        "total_outstanding": round(total_outstanding, 2),
        "total_overdue": total_overdue,
        "buckets": buckets,
        "invoices": details,
    }
