"""Credit risk scoring for CRM contacts based on AR payment history."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.crm import CRMContact
from app.models.uae_accounting_full import UAESalesInvoice

RISK_COLORS = {
    "LOW": "green",
    "MEDIUM": "amber",
    "HIGH": "orange",
    "CRITICAL": "red",
}


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _contact_names(contact: CRMContact) -> set[str]:
    names: set[str] = set()
    if contact.name:
        names.add(contact.name.strip().lower())
    if contact.company_name:
        names.add(contact.company_name.strip().lower())
    return names


def _invoices_for_contact(
    db: Session,
    tenant_id: str,
    company_id: str | None,
    contact: CRMContact,
) -> list[UAESalesInvoice]:
    names = _contact_names(contact)
    if not names:
        return []
    q = db.query(UAESalesInvoice).filter(UAESalesInvoice.tenant_id == tenant_id)
    if company_id:
        q = q.filter(UAESalesInvoice.company_id == company_id)
    result: list[UAESalesInvoice] = []
    for inv in q.all():
        cust = (inv.customer.name if inv.customer else "").strip().lower()
        if cust in names:
            result.append(inv)
    return result


def _risk_category(score: float) -> str:
    if score <= 25:
        return "LOW"
    if score <= 50:
        return "MEDIUM"
    if score <= 75:
        return "HIGH"
    return "CRITICAL"


def _recommended_limit(risk: str, avg_invoice: float) -> float:
    if risk == "LOW":
        return round(avg_invoice * 3, 2)
    if risk == "MEDIUM":
        return round(avg_invoice * 1.5, 2)
    if risk == "HIGH":
        return round(avg_invoice * 0.5, 2)
    return 0.0


def calculate_credit_score(
    db: Session,
    contact: CRMContact,
    *,
    tenant_id: str,
    company_id: str | None = None,
    persist: bool = True,
) -> dict[str, Any]:
    invoices = _invoices_for_contact(db, tenant_id, company_id, contact)
    paid = [i for i in invoices if (i.status or "").lower() == "paid" and i.paid_date and i.due_date]
    open_invs = [i for i in invoices if (i.status or "").lower() != "paid"]
    overdue_invs = [i for i in open_invs if (i.status or "").lower() == "overdue"]

    days_late_list: list[int] = []
    for inv in paid:
        days_late_list.append((inv.paid_date - inv.due_date).days)

    avg_days_late = sum(days_late_list) / len(days_late_list) if days_late_list else 0.0

    payment_history_score = 0.0
    if days_late_list:
        if avg_days_late <= 0:
            payment_history_score = 0
        elif avg_days_late <= 7:
            payment_history_score = 10
        elif avg_days_late <= 30:
            payment_history_score = 20
        elif avg_days_late <= 60:
            payment_history_score = 30
        else:
            payment_history_score = 40

    overdue_amount = sum(_f(i.outstanding or i.total_amount) for i in overdue_invs)
    total_ar = sum(_f(i.outstanding or i.total_amount) for i in open_invs)
    overdue_ratio = overdue_amount / total_ar if total_ar > 0 else 0.0
    overdue_score = overdue_ratio * 30

    max_dunning = max((i.last_dunning_level or 0 for i in invoices), default=0)
    dunning_score = min(20, max_dunning * 5)

    invoice_count = len(invoices)
    history_score = 0.0
    if invoice_count == 0:
        history_score = 10
    elif invoice_count == 1:
        history_score = 5
    elif invoice_count >= 5 and avg_days_late <= 7:
        history_score = 0

    credit_score = min(100, round(
        payment_history_score + overdue_score + dunning_score + history_score, 1
    ))
    risk = _risk_category(credit_score)

    paid_totals = [_f(i.total_amount) for i in paid if _f(i.total_amount) > 0]
    avg_invoice = sum(paid_totals) / len(paid_totals) if paid_totals else (
        sum(_f(i.total_amount) for i in invoices) / invoice_count if invoice_count else 0
    )
    recommended = _recommended_limit(risk, avg_invoice)
    total_outstanding = sum(_f(i.outstanding or i.total_amount) for i in open_invs)

    customer_name = contact.company_name or contact.name
    result = {
        "contact_id": contact.id,
        "customer_name": customer_name,
        "credit_score": credit_score,
        "risk_category": risk,
        "risk_color": RISK_COLORS[risk],
        "factors": {
            "payment_history_score": round(payment_history_score, 1),
            "overdue_score": round(overdue_score, 1),
            "dunning_score": round(dunning_score, 1),
            "history_score": round(history_score, 1),
        },
        "recommended_credit_limit_aed": recommended,
        "total_outstanding_aed": round(total_outstanding, 2),
        "overdue_amount_aed": round(overdue_amount, 2),
        "avg_days_late": round(avg_days_late, 1),
        "invoice_count": invoice_count,
        "last_calculated_at": datetime.utcnow().isoformat(),
        "recommendation": _recommendation_text(risk, recommended),
    }

    if persist:
        contact.credit_score = credit_score
        contact.risk_category = risk
        contact.credit_limit_aed = recommended
        db.add(contact)

    return result


def _recommendation_text(risk: str, limit: float) -> str:
    if risk == "CRITICAL":
        return "Require prepayment — no credit extended"
    if risk == "HIGH":
        return f"Reduce exposure — limit AED {limit:,.0f}"
    if risk == "MEDIUM":
        return f"Monitor closely — limit AED {limit:,.0f}"
    return f"Standard terms — limit AED {limit:,.0f}"


def recalc_for_customer_name(
    db: Session,
    tenant_id: str,
    company_id: str | None,
    customer_name: str,
) -> None:
    """Recalculate credit scores for CRM contacts matching an AR customer name."""
    name_lower = customer_name.strip().lower()
    q = db.query(CRMContact).filter(CRMContact.workspace_id == tenant_id)
    if company_id:
        q = q.filter(CRMContact.company_id == company_id)
    for contact in q.all():
        if name_lower in _contact_names(contact):
            calculate_credit_score(
                db, contact, tenant_id=tenant_id, company_id=company_id, persist=True
            )
    db.commit()


def credit_risk_summary(
    db: Session,
    workspace_id: str,
    company_id: str | None = None,
) -> dict[str, Any]:
    q = db.query(CRMContact).filter(CRMContact.workspace_id == workspace_id)
    if company_id:
        q = q.filter(CRMContact.company_id == company_id)
    contacts = q.all()

    customers: list[dict[str, Any]] = []
    counts = {"LOW": 0, "MEDIUM": 0, "HIGH": 0, "CRITICAL": 0}
    total_outstanding = 0.0
    total_overdue = 0.0
    weighted_sum = 0.0
    weight_total = 0.0

    for contact in contacts:
        score_data = calculate_credit_score(
            db, contact, tenant_id=workspace_id, company_id=company_id, persist=True
        )
        customers.append(score_data)
        risk = score_data["risk_category"]
        counts[risk] = counts.get(risk, 0) + 1
        total_outstanding += score_data["total_outstanding_aed"]
        total_overdue += score_data["overdue_amount_aed"]
        w = score_data["total_outstanding_aed"] or 1
        weighted_sum += score_data["credit_score"] * w
        weight_total += w

    db.commit()
    customers.sort(key=lambda c: c["credit_score"], reverse=True)

    portfolio_risk = round(weighted_sum / weight_total, 1) if weight_total > 0 else 0.0

    return {
        "customers": customers,
        "summary": {
            "total_customers": len(customers),
            "low_risk_count": counts["LOW"],
            "medium_risk_count": counts["MEDIUM"],
            "high_risk_count": counts["HIGH"],
            "critical_risk_count": counts["CRITICAL"],
            "total_outstanding_aed": round(total_outstanding, 2),
            "total_overdue_aed": round(total_overdue, 2),
            "portfolio_risk_score": portfolio_risk,
        },
    }
