"""AR customer risk — per-customer rollup from aging, credit notes, and payment history."""

from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.models.uae_accounting_full import UAECreditNote, UAESalesInvoice
from app.services.ar_aging_service import (
    BUCKET_LABELS,
    BUCKET_RISK,
    RISK_RANK,
    compute_ar_aging,
)


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _empty_customer(
    customer_id: str | None,
    customer_name: str,
) -> dict[str, Any]:
    return {
        "customer_id": customer_id,
        "customer_name": customer_name,
        "risk_tier": "low",
        "total_outstanding": 0.0,
        "total_overdue": 0.0,
        "worst_bucket": BUCKET_LABELS["current"],
        "credit_notes_count": 0,
        "total_credited": 0.0,
        "avg_days_to_pay": None,
        "open_invoice_count": 0,
    }


def compute_customer_risk(
    db: Session,
    tenant_id: str,
    company_id: str | None = None,
    as_of: date | None = None,
) -> dict[str, Any]:
    """Build per-customer risk rows from open AR aging + credit notes + paid history."""
    as_of_date = as_of or date.today()
    aging = compute_ar_aging(db, tenant_id, company_id, as_of_date)

    customers: dict[str, dict[str, Any]] = {}
    for row in aging.get("invoices") or []:
        cid = row.get("customer_id") or f"name:{row.get('customer_name', 'Unknown')}"
        if cid not in customers:
            customers[cid] = _empty_customer(
                row.get("customer_id"),
                row.get("customer_name") or "Unknown Customer",
            )
        c = customers[cid]
        amt = _f(row.get("amount_due"))
        bucket = row.get("bucket") or "current"
        risk = row.get("risk") or BUCKET_RISK.get(bucket, "low")

        c["total_outstanding"] = round(c["total_outstanding"] + amt, 2)
        c["open_invoice_count"] += 1
        if bucket != "current":
            c["total_overdue"] = round(c["total_overdue"] + amt, 2)
        if RISK_RANK.get(risk, 0) > RISK_RANK.get(c["risk_tier"], 0):
            c["risk_tier"] = risk
            c["worst_bucket"] = row.get("bucket_label") or BUCKET_LABELS.get(bucket, bucket)

    # Credit notes (issued only) — enrich customers already in aging rollup
    cn_q = db.query(UAECreditNote).filter(
        UAECreditNote.tenant_id == tenant_id,
        UAECreditNote.status == "issued",
    )
    if company_id:
        cn_q = cn_q.filter(UAECreditNote.company_id == company_id)

    id_to_key = {
        c["customer_id"]: k
        for k, c in customers.items()
        if c.get("customer_id")
    }
    for cn in cn_q.all():
        if not cn.customer_id:
            continue
        key = id_to_key.get(cn.customer_id)
        if not key:
            continue
        customers[key]["credit_notes_count"] += 1
        customers[key]["total_credited"] = round(
            customers[key]["total_credited"] + _f(cn.amount), 2
        )

    # Avg days to pay from fully paid invoices (paid_date on UAESalesInvoice)
    paid_q = db.query(UAESalesInvoice).filter(
        UAESalesInvoice.tenant_id == tenant_id,
        UAESalesInvoice.status == "paid",
        UAESalesInvoice.paid_date.isnot(None),
        UAESalesInvoice.invoice_date.isnot(None),
    )
    if company_id:
        paid_q = paid_q.filter(UAESalesInvoice.company_id == company_id)

    days_by_customer: dict[str, list[int]] = {}
    for inv in paid_q.all():
        if not inv.customer_id:
            continue
        days = (inv.paid_date - inv.invoice_date).days
        days_by_customer.setdefault(inv.customer_id, []).append(days)

    for c in customers.values():
        cid = c.get("customer_id")
        if not cid:
            continue
        days_list = days_by_customer.get(cid) or []
        if days_list:
            c["avg_days_to_pay"] = round(sum(days_list) / len(days_list), 1)

    rows = list(customers.values())
    rows.sort(
        key=lambda r: (-RISK_RANK.get(r["risk_tier"], 0), -r["total_outstanding"]),
    )

    return {
        "as_of": str(as_of_date),
        "currency": aging.get("currency", "AED"),
        "total_outstanding": aging.get("total_outstanding", 0),
        "total_overdue": aging.get("total_overdue", 0),
        "customer_count": len(rows),
        "customers": rows,
    }


def filter_by_risk_tier(
    report: dict[str, Any],
    risk_tier: str | None,
) -> dict[str, Any]:
    if not risk_tier:
        return report
    tier = risk_tier.strip().lower()
    filtered = [c for c in report.get("customers", []) if c.get("risk_tier") == tier]
    return {
        **report,
        "customer_count": len(filtered),
        "customers": filtered,
        "risk_tier_filter": tier,
    }
