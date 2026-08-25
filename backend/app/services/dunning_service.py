"""AR dunning — escalating payment reminders to customers."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.uae_accounting_full import UAESalesInvoice
from app.services.credit_risk_service import recalc_for_customer_name
from app.services.notification_service import send_notification

PAYMENT_LINK_BASE = "https://pay.example.com/invoices"


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def dunning_level(days_overdue: int) -> int:
    if days_overdue <= 15:
        return 1
    if days_overdue <= 30:
        return 2
    if days_overdue <= 60:
        return 3
    return 4


def _payment_link(invoice_number: str) -> str:
    return f"{PAYMENT_LINK_BASE}/{invoice_number}"


def build_dunning_email(
    level: int,
    *,
    invoice_number: str,
    customer_name: str,
    outstanding: float,
    due_date: date | None,
    days_overdue: int,
) -> tuple[str, str]:
    amt = f"AED {outstanding:,.2f}"
    due_str = due_date.isoformat() if due_date else "N/A"
    pay_link = _payment_link(invoice_number)

    if level == 1:
        subject = f"Friendly payment reminder — {invoice_number}"
        body = (
            f"Dear {customer_name},\n\n"
            f"This is a friendly reminder that invoice {invoice_number} for {amt} "
            f"was due on {due_str} ({days_overdue} day(s) overdue).\n\n"
            f"If you have already paid, please disregard this message. "
            f"Otherwise, we would appreciate prompt settlement at your earliest convenience.\n\n"
            f"Thank you for your business."
        )
    elif level == 2:
        subject = f"Payment reminder — {invoice_number}"
        body = (
            f"Dear {customer_name},\n\n"
            f"Invoice {invoice_number} for {amt} remains outstanding. "
            f"It was due on {due_str} and is now {days_overdue} day(s) overdue.\n\n"
            f"Please arrange payment using this link: {pay_link}\n\n"
            f"If payment has been sent, please share your remittance reference so we can reconcile your account."
        )
    elif level == 3:
        subject = f"Urgent: overdue invoice {invoice_number}"
        body = (
            f"Dear {customer_name},\n\n"
            f"URGENT: Invoice {invoice_number} for {amt} is {days_overdue} day(s) overdue "
            f"(due date {due_str}).\n\n"
            f"Late payment fees may apply if this balance is not cleared promptly. "
            f"Pay now: {pay_link}\n\n"
            f"Contact our accounts receivable team immediately if you need to discuss this invoice."
        )
    else:
        subject = f"Final notice — invoice {invoice_number}"
        body = (
            f"Dear {customer_name},\n\n"
            f"FINAL NOTICE: Invoice {invoice_number} for {amt} is {days_overdue} day(s) overdue "
            f"(due date {due_str}).\n\n"
            f"Unless payment is received within 7 days, we may escalate this matter for further collection action "
            f"and apply applicable late fees.\n\n"
            f"Pay immediately: {pay_link}\n\n"
            f"This is our final reminder before escalation."
        )
    return subject, body


def get_dunning_templates() -> list[dict[str, Any]]:
    """Sample templates for AR manager preview (placeholder customer/invoice values)."""
    sample = {
        "invoice_number": "INV-2026-0001",
        "customer_name": "Sample Customer LLC",
        "outstanding": 5250.00,
        "due_date": date(2026, 5, 1),
        "days_overdue": 35,
    }
    labels = {
        1: "L1 — Friendly reminder (≤15 days overdue)",
        2: "L2 — Firm reminder with payment link (≤30 days)",
        3: "L3 — Urgent notice (≤60 days)",
        4: "L4 — Final notice before escalation (60+ days)",
    }
    days_samples = {1: 10, 2: 25, 3: 45, 4: 75}
    out: list[dict[str, Any]] = []
    for lvl in (1, 2, 3, 4):
        subject, body = build_dunning_email(
            lvl,
            invoice_number=sample["invoice_number"],
            customer_name=sample["customer_name"],
            outstanding=sample["outstanding"],
            due_date=sample["due_date"],
            days_overdue=days_samples[lvl],
        )
        out.append({
            "level": lvl,
            "label": labels[lvl],
            "days_overdue_range": "<=15" if lvl == 1 else "<=30" if lvl == 2 else "<=60" if lvl == 3 else "60+",
            "subject": subject,
            "body": body,
        })
    return out


def _overdue_query(db: Session, tenant_id: str, company_id: str, as_of: date):
    return (
        db.query(UAESalesInvoice)
        .filter(
            UAESalesInvoice.tenant_id == tenant_id,
            UAESalesInvoice.company_id == company_id,
            UAESalesInvoice.status.in_(["sent", "overdue", "partial"]),
            UAESalesInvoice.due_date < as_of,
            UAESalesInvoice.outstanding > 0,
        )
        .all()
    )


def run_dunning(
    db: Session,
    tenant_id: str,
    company_id: str,
    as_of: date | None = None,
) -> dict[str, Any]:
    """Send escalating dunning emails for overdue invoices. Does not handle internal overdue alerts."""
    today = as_of or date.today()
    overdue = _overdue_query(db, tenant_id, company_id, today)

    sent: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    summary: list[str] = []

    for inv in overdue:
        days = (today - (inv.due_date or today)).days
        level = dunning_level(days)
        cust = inv.customer
        email = (cust.email or "").strip() if cust else ""
        cust_name = cust.name if cust else "Customer"
        outstanding = _f(inv.outstanding)

        if not email:
            skipped.append({
                "invoice_number": inv.invoice_number,
                "customer": cust_name,
                "amount": outstanding,
                "level": level,
                "reason": "no_email",
            })
            continue

        subject, body = build_dunning_email(
            level,
            invoice_number=inv.invoice_number,
            customer_name=cust_name,
            outstanding=outstanding,
            due_date=inv.due_date,
            days_overdue=days,
        )
        if not send_notification(email, subject, body):
            skipped.append({
                "invoice_number": inv.invoice_number,
                "customer": cust_name,
                "amount": outstanding,
                "level": level,
                "reason": "send_failed",
            })
            continue

        inv.last_dunning_level = level
        inv.last_dunning_sent_at = datetime.utcnow()
        inv.dunning_count = (inv.dunning_count or 0) + 1
        db.add(inv)
        if cust and cust.name:
            recalc_for_customer_name(db, tenant_id, company_id, cust.name)

        sent.append({
            "invoice_number": inv.invoice_number,
            "customer": cust_name,
            "amount": outstanding,
            "level": level,
            "email": email,
        })

    db.commit()

    if not overdue:
        summary.append("No overdue invoices to chase")
    else:
        summary.append(f"Sent {len(sent)} dunning reminder(s)")
        if skipped:
            summary.append(f"Skipped {len(skipped)} (no email or delivery failed)")

    return {
        "sent_count": len(sent),
        "skipped_count": len(skipped),
        "sent": sent,
        "skipped": skipped,
        "summary": summary,
    }


def get_dunning_history(
    db: Session,
    tenant_id: str,
    company_id: str,
    dunning_level: int | None = None,
    as_of: date | None = None,
) -> dict[str, Any]:
    """Return per-invoice dunning history from invoice tracking fields."""
    today = as_of or date.today()
    q = db.query(UAESalesInvoice).filter(
        UAESalesInvoice.tenant_id == tenant_id,
        UAESalesInvoice.company_id == company_id,
        UAESalesInvoice.last_dunning_sent_at.isnot(None),
    )
    if dunning_level is not None:
        q = q.filter(UAESalesInvoice.last_dunning_level == dunning_level)

    rows: list[dict[str, Any]] = []
    for inv in q.order_by(UAESalesInvoice.last_dunning_sent_at.desc()).all():
        due = inv.due_date
        days_overdue = (today - due).days if due and due < today else 0
        cust = inv.customer
        rows.append({
            "invoice_id": inv.id,
            "invoice_number": inv.invoice_number,
            "customer_name": cust.name if cust else "Unknown Customer",
            "last_dunning_level": inv.last_dunning_level or 0,
            "last_dunning_sent_at": inv.last_dunning_sent_at.isoformat() if inv.last_dunning_sent_at else None,
            "dunning_count": inv.dunning_count or 0,
            "outstanding": round(_f(inv.outstanding), 2),
            "days_overdue": days_overdue,
            "due_date": due.isoformat() if due else None,
        })

    return {
        "as_of": str(today),
        "count": len(rows),
        "invoices": rows,
        "dunning_level_filter": dunning_level,
    }
