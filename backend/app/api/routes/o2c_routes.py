"""O2C summary dashboard — complete order-to-cash picture for CFO."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.tenant_scope import request_workspace, workspace_member
from app.models.uae_accounting_full import UAESalesInvoice
from app.services.dso_service import build_dso_metrics
from app.services.payment_prediction_service import predict_payments

router = APIRouter(prefix="/api/o2c", tags=["O2C"], dependencies=[Depends(workspace_member)])


def _ws(request: Request, query_ws: str | None = None) -> str:
    return request_workspace(request, query_ws)


@router.get("/summary")
def o2c_summary(
    request: Request,
    company_id: str,
    workspace_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    today = date.today()
    month_start = today.replace(day=1)
    if month_start.month == 12:
        month_end = date(month_start.year, 12, 31)
    else:
        month_end = date(month_start.year, month_start.month + 1, 1) - timedelta(days=1)

    dso = build_dso_metrics(
        db, ws, company_id,
        month_start.isoformat(), month_end.isoformat(),
    )
    predictions = predict_payments(db, ws, company_id)

    invoices = (
        db.query(UAESalesInvoice)
        .filter(UAESalesInvoice.tenant_id == ws, UAESalesInvoice.company_id == company_id)
        .all()
    )
    status_counts: dict[str, int] = {}
    status_amounts: dict[str, float] = {}
    for inv in invoices:
        st = (inv.status or "draft").lower()
        status_counts[st] = status_counts.get(st, 0) + 1
        if st != "paid":
            status_amounts[st] = status_amounts.get(st, 0) + _f(inv.outstanding or inv.total_amount)

    aging_buckets = _aging_buckets(invoices, today)
    total_overdue = sum(
        _f(i.outstanding or i.total_amount)
        for i in invoices
        if (i.status or "").lower() != "paid" and i.due_date and i.due_date < today
    )

    week_ago = today - timedelta(days=7)
    recent_dunning = [
        {
            "invoice_number": i.invoice_number,
            "customer": i.customer.name if i.customer else "Customer",
            "level": i.last_dunning_level or 0,
            "sent_at": i.last_dunning_sent_at.isoformat() if i.last_dunning_sent_at else None,
        }
        for i in invoices
        if i.last_dunning_sent_at and i.last_dunning_sent_at.date() >= week_ago
    ][:10]

    payments_this_week = [
        {
            "invoice_number": i.invoice_number,
            "customer": i.customer.name if i.customer else "Customer",
            "amount": _f(i.paid_amount or i.total_amount),
            "paid_date": str(i.paid_date),
            "reference": i.payment_reference,
        }
        for i in invoices
        if i.status == "paid" and i.paid_date and i.paid_date >= week_ago
    ]

    return {
        "kpis": {
            "dso_current": dso["dso_current"],
            "dso_vs_benchmark": dso["dso_vs_benchmark"],
            "dso_vs_benchmark_label": dso["dso_vs_benchmark_label"],
            "industry_benchmark": dso["industry_benchmark"],
            "collections_efficiency_pct": dso["collections_efficiency_pct"],
            "expected_cash_30_days": predictions["total_predicted_cash_next_30_days"],
            "total_overdue_aed": round(total_overdue, 2),
            "total_outstanding_aed": dso["total_outstanding_aed"],
        },
        "ar_status": {
            "by_status": [
                {"status": k, "count": status_counts[k], "amount_aed": round(status_amounts.get(k, 0), 2)}
                for k in sorted(status_counts.keys())
            ],
            "aging_buckets": aging_buckets,
        },
        "cash_forecast": {
            "next_30_days": predictions["total_predicted_cash_next_30_days"],
            "next_60_days": predictions["total_predicted_cash_next_60_days"],
            "next_90_days": predictions["total_predicted_cash_next_90_days"],
            "chart": [
                {"period": "30 days", "amount": predictions["total_predicted_cash_next_30_days"]},
                {"period": "60 days", "amount": predictions["total_predicted_cash_next_60_days"]},
                {"period": "90 days", "amount": predictions["total_predicted_cash_next_90_days"]},
            ],
        },
        "collections_activity": {
            "recent_dunning": recent_dunning,
            "payments_this_week": payments_this_week,
            "payments_this_week_total": round(sum(p["amount"] for p in payments_this_week), 2),
        },
        "currency": "AED",
        "generated_at": datetime.utcnow().isoformat(),
    }


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _aging_buckets(invoices: list[UAESalesInvoice], today: date) -> list[dict[str, Any]]:
    buckets = {
        "Current": 0.0,
        "1-30 days": 0.0,
        "31-60 days": 0.0,
        "61-90 days": 0.0,
        "90+ days": 0.0,
    }
    for inv in invoices:
        if (inv.status or "").lower() == "paid":
            continue
        amt = _f(inv.outstanding or inv.total_amount)
        if amt <= 0:
            continue
        due = inv.due_date or today
        days = (today - due).days
        if due >= today:
            key = "Current"
        elif days <= 30:
            key = "1-30 days"
        elif days <= 60:
            key = "31-60 days"
        elif days <= 90:
            key = "61-90 days"
        else:
            key = "90+ days"
        buckets[key] += amt

    return [{"bucket": k, "amount_aed": round(v, 2)} for k, v in buckets.items()]
