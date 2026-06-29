"""Payment date prediction for open AR invoices."""

from __future__ import annotations

import statistics
from datetime import date, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.models.uae_accounting_full import UAESalesInvoice


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _customer_payment_stats(
    db: Session,
    tenant_id: str,
    company_id: str,
    customer_id: str | None,
) -> tuple[float, float, int]:
    """Return avg_days_late, stddev_days_late, paid_count for a customer."""
    if not customer_id:
        return 0.0, 0.0, 0

    paid = (
        db.query(UAESalesInvoice)
        .filter(
            UAESalesInvoice.tenant_id == tenant_id,
            UAESalesInvoice.company_id == company_id,
            UAESalesInvoice.customer_id == customer_id,
            UAESalesInvoice.status == "paid",
            UAESalesInvoice.paid_date.isnot(None),
            UAESalesInvoice.due_date.isnot(None),
        )
        .all()
    )
    if not paid:
        return 0.0, 0.0, 0

    days_late = [(i.paid_date - i.due_date).days for i in paid]
    avg = sum(days_late) / len(days_late)
    stddev = statistics.stdev(days_late) if len(days_late) >= 2 else 0.0
    return avg, stddev, len(paid)


def predict_invoice_payment(inv: UAESalesInvoice, today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    cust_name = inv.customer.name if inv.customer else "Unknown"
    total = _f(inv.outstanding or inv.total_amount)
    due = inv.due_date or today
    days_overdue = max(0, (today - due).days) if due < today else 0

    return {
        "invoice_id": inv.id,
        "invoice_number": inv.invoice_number,
        "customer_name": cust_name,
        "total_aed": round(total, 2),
        "due_date": str(due),
        "days_overdue": days_overdue,
    }


def _confidence(stddev: float, paid_count: int) -> str:
    if paid_count < 3:
        return "LOW"
    if stddev < 7:
        return "HIGH"
    if stddev < 15:
        return "MEDIUM"
    return "LOW"


def _risk_flag(predicted_date: date, today: date) -> str:
    days_ahead = (predicted_date - today).days
    if days_ahead > 60:
        return "HIGH"
    if days_ahead > 30:
        return "MEDIUM"
    return "LOW"


def predict_payments(
    db: Session,
    tenant_id: str,
    company_id: str,
    *,
    invoice_id: str | None = None,
) -> dict[str, Any]:
    today = date.today()
    q = db.query(UAESalesInvoice).filter(
        UAESalesInvoice.tenant_id == tenant_id,
        UAESalesInvoice.company_id == company_id,
        UAESalesInvoice.status.notin_(["paid"]),
    )
    if invoice_id:
        q = q.filter(UAESalesInvoice.id == invoice_id)
    invoices = q.all()

    predictions: list[dict[str, Any]] = []
    cash_30 = cash_60 = cash_90 = 0.0

    for inv in invoices:
        base = predict_invoice_payment(inv, today)
        avg_late, stddev, paid_count = _customer_payment_stats(
            db, tenant_id, company_id, inv.customer_id
        )
        due = inv.due_date or today

        if paid_count > 0:
            predicted = due + timedelta(days=int(round(avg_late)))
            confidence = _confidence(stddev, paid_count)
            basis = f"based on {paid_count} previous payments"
        else:
            predicted = due + timedelta(days=14)
            confidence = "LOW"
            basis = "no payment history — using default"

        risk = _risk_flag(predicted, today)
        days_to_collect = max(0, (predicted - today).days)
        amount = _f(inv.outstanding or inv.total_amount)

        if 0 <= days_to_collect <= 30:
            cash_30 += amount
        if 0 <= days_to_collect <= 60:
            cash_60 += amount
        if 0 <= days_to_collect <= 90:
            cash_90 += amount

        predictions.append({
            **base,
            "predicted_payment_date": str(predicted),
            "predicted_days_to_collect": days_to_collect,
            "confidence": confidence,
            "risk_flag": risk,
            "customer_avg_days_late": round(avg_late, 1),
            "basis": basis,
        })

    return {
        "predictions": predictions,
        "total_predicted_cash_next_30_days": round(cash_30, 2),
        "total_predicted_cash_next_60_days": round(cash_60, 2),
        "total_predicted_cash_next_90_days": round(cash_90, 2),
    }
