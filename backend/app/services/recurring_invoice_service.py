"""AR recurring invoice templates — schedule and generate draft sales invoices."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from dateutil.relativedelta import relativedelta
from sqlalchemy.orm import Session

from app.models.uae_accounting_full import UAECustomer, UAERecurringInvoice, UAESalesInvoice
from app.services.ar_sales_invoice_service import create_draft_sales_invoice

RECURRENCE_TYPES = frozenset({"weekly", "monthly", "quarterly", "annually"})
STATUSES = frozenset({"active", "paused", "cancelled"})
MAX_CATCHUP = 24


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def advance_next_due_date(
    current: date,
    recurrence_type: str,
    interval: int,
) -> date:
    iv = max(1, int(interval or 1))
    if recurrence_type == "weekly":
        return current + relativedelta(days=7 * iv)
    if recurrence_type == "monthly":
        return current + relativedelta(months=iv)
    if recurrence_type == "quarterly":
        return current + relativedelta(months=3 * iv)
    if recurrence_type == "annually":
        return current + relativedelta(years=iv)
    raise ValueError(f"invalid recurrence_type: {recurrence_type}")


def _template_dict(t: UAERecurringInvoice, db: Session) -> dict[str, Any]:
    cust = db.query(UAECustomer).filter_by(id=t.customer_id).first()
    return {
        "id": t.id,
        "tenant_id": t.tenant_id,
        "company_id": t.company_id,
        "customer_id": t.customer_id,
        "customer_name": cust.name if cust else "Unknown",
        "description": t.description,
        "amount": round(_f(t.amount), 2),
        "vat_rate": round(_f(t.vat_rate), 2),
        "recurrence_type": t.recurrence_type,
        "interval": t.interval or 1,
        "start_date": str(t.start_date) if t.start_date else None,
        "next_due_date": str(t.next_due_date) if t.next_due_date else None,
        "end_date": str(t.end_date) if t.end_date else None,
        "status": t.status,
        "last_generated_at": t.last_generated_at.isoformat() if t.last_generated_at else None,
        "generated_count": t.generated_count or 0,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


def create_template(
    db: Session,
    *,
    tenant_id: str,
    company_id: str,
    customer_id: str,
    description: str,
    amount: float,
    vat_rate: float,
    recurrence_type: str,
    interval: int,
    start_date: date,
    end_date: date | None = None,
) -> dict[str, Any]:
    if recurrence_type not in RECURRENCE_TYPES:
        raise ValueError(f"recurrence_type must be one of {sorted(RECURRENCE_TYPES)}")
    if amount <= 0:
        raise ValueError("amount must be positive")

    cust = (
        db.query(UAECustomer)
        .filter(UAECustomer.id == customer_id, UAECustomer.tenant_id == tenant_id)
        .first()
    )
    if not cust:
        raise ValueError("customer not found")

    tpl = UAERecurringInvoice(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        company_id=company_id,
        customer_id=customer_id,
        description=description.strip(),
        amount=round(amount, 2),
        vat_rate=round(vat_rate, 2),
        recurrence_type=recurrence_type,
        interval=max(1, int(interval or 1)),
        start_date=start_date,
        next_due_date=start_date,
        end_date=end_date,
        status="active",
        generated_count=0,
    )
    db.add(tpl)
    db.commit()
    db.refresh(tpl)
    return _template_dict(tpl, db)


def list_templates(
    db: Session,
    tenant_id: str,
    company_id: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    q = db.query(UAERecurringInvoice).filter(UAERecurringInvoice.tenant_id == tenant_id)
    if company_id:
        q = q.filter(UAERecurringInvoice.company_id == company_id)
    if status:
        q = q.filter(UAERecurringInvoice.status == status.lower())
    rows = q.order_by(UAERecurringInvoice.next_due_date.asc()).all()
    return {
        "count": len(rows),
        "templates": [_template_dict(t, db) for t in rows],
    }


def pause_template(db: Session, template_id: str, tenant_id: str) -> dict[str, Any]:
    tpl = _get_template(db, template_id, tenant_id)
    if tpl.status == "cancelled":
        raise ValueError("cannot pause a cancelled template")
    tpl.status = "paused"
    db.add(tpl)
    db.commit()
    db.refresh(tpl)
    return _template_dict(tpl, db)


def resume_template(db: Session, template_id: str, tenant_id: str) -> dict[str, Any]:
    tpl = _get_template(db, template_id, tenant_id)
    if tpl.status == "cancelled":
        raise ValueError("cannot resume a cancelled template")
    tpl.status = "active"
    db.add(tpl)
    db.commit()
    db.refresh(tpl)
    return _template_dict(tpl, db)


def cancel_template(db: Session, template_id: str, tenant_id: str) -> dict[str, Any]:
    tpl = _get_template(db, template_id, tenant_id)
    tpl.status = "cancelled"
    db.add(tpl)
    db.commit()
    db.refresh(tpl)
    return _template_dict(tpl, db)


def _get_template(db: Session, template_id: str, tenant_id: str) -> UAERecurringInvoice:
    tpl = (
        db.query(UAERecurringInvoice)
        .filter(UAERecurringInvoice.id == template_id, UAERecurringInvoice.tenant_id == tenant_id)
        .first()
    )
    if not tpl:
        raise ValueError("template not found")
    return tpl


def _payment_due_date(cust: UAECustomer | None, invoice_date: date) -> date:
    days = int(cust.payment_terms_days or 30) if cust else 30
    return invoice_date + relativedelta(days=days)


def _generate_one_from_template(
    db: Session,
    tpl: UAERecurringInvoice,
    as_of: date,
) -> dict[str, Any] | None:
    if tpl.status != "active":
        return None
    if not tpl.next_due_date or tpl.next_due_date > as_of:
        return None
    if tpl.end_date and tpl.next_due_date > tpl.end_date:
        return None

    cust = db.query(UAECustomer).filter_by(id=tpl.customer_id).first()
    inv_date = tpl.next_due_date
    due_date = _payment_due_date(cust, inv_date)

    inv = create_draft_sales_invoice(
        db,
        tenant_id=tpl.tenant_id,
        company_id=tpl.company_id,
        customer_id=tpl.customer_id,
        invoice_date=inv_date,
        due_date=due_date,
        description=tpl.description,
        amount=_f(tpl.amount),
        vat_rate=_f(tpl.vat_rate),
        buyer_trn=cust.trn if cust else None,
        recurring_template_id=tpl.id,
    )

    tpl.last_generated_at = datetime.utcnow()
    tpl.generated_count = (tpl.generated_count or 0) + 1
    tpl.next_due_date = advance_next_due_date(
        tpl.next_due_date,
        tpl.recurrence_type,
        tpl.interval or 1,
    )
    if tpl.end_date and tpl.next_due_date > tpl.end_date:
        tpl.status = "cancelled"
    db.add(tpl)

    return {
        "template_id": tpl.id,
        "invoice_id": inv.id,
        "invoice_number": inv.invoice_number,
        "invoice_date": str(inv.invoice_date),
        "due_date": str(inv.due_date),
        "subtotal": round(_f(inv.subtotal), 2),
        "vat_amount": round(_f(inv.vat_amount), 2),
        "total": round(_f(inv.total_amount), 2),
        "status": inv.status,
        "next_due_date": str(tpl.next_due_date),
    }


def generate_due_invoices(
    db: Session,
    tenant_id: str,
    as_of: date | None = None,
    company_id: str | None = None,
) -> dict[str, Any]:
    """Generate draft invoices for all due active templates for a tenant."""
    as_of_date = as_of or date.today()
    q = db.query(UAERecurringInvoice).filter(
        UAERecurringInvoice.tenant_id == tenant_id,
        UAERecurringInvoice.status == "active",
        UAERecurringInvoice.next_due_date <= as_of_date,
    )
    if company_id:
        q = q.filter(UAERecurringInvoice.company_id == company_id)

    generated: list[dict[str, Any]] = []
    templates = q.all()
    for tpl in templates:
        iterations = 0
        while (
            tpl.status == "active"
            and tpl.next_due_date
            and tpl.next_due_date <= as_of_date
            and (not tpl.end_date or tpl.next_due_date <= tpl.end_date)
            and iterations < MAX_CATCHUP
        ):
            row = _generate_one_from_template(db, tpl, as_of_date)
            if not row:
                break
            generated.append(row)
            iterations += 1
            db.flush()

    db.commit()
    return {
        "as_of": str(as_of_date),
        "generated_count": len(generated),
        "generated": generated,
    }


def generate_due_invoices_all_tenants(db: Session, as_of: date | None = None) -> dict[str, Any]:
    as_of_date = as_of or date.today()
    tenant_ids = [
        r[0]
        for r in db.query(UAERecurringInvoice.tenant_id)
        .filter(UAERecurringInvoice.status == "active")
        .distinct()
        .all()
    ]
    all_generated: list[dict[str, Any]] = []
    for tid in tenant_ids:
        result = generate_due_invoices(db, tid, as_of_date)
        all_generated.extend(result.get("generated") or [])
    return {
        "as_of": str(as_of_date),
        "tenant_count": len(tenant_ids),
        "generated_count": len(all_generated),
        "generated": all_generated,
    }


def get_generated_invoices(db: Session, template_id: str, tenant_id: str) -> dict[str, Any]:
    tpl = _get_template(db, template_id, tenant_id)
    invoices = (
        db.query(UAESalesInvoice)
        .filter(
            UAESalesInvoice.tenant_id == tenant_id,
            UAESalesInvoice.recurring_template_id == template_id,
        )
        .order_by(UAESalesInvoice.invoice_date.desc())
        .all()
    )
    cust = db.query(UAECustomer).filter_by(id=tpl.customer_id).first()
    return {
        "template_id": template_id,
        "customer_name": cust.name if cust else "Unknown",
        "count": len(invoices),
        "invoices": [
            {
                "invoice_id": inv.id,
                "invoice_number": inv.invoice_number,
                "invoice_date": str(inv.invoice_date) if inv.invoice_date else None,
                "due_date": str(inv.due_date) if inv.due_date else None,
                "subtotal": round(_f(inv.subtotal), 2),
                "vat_amount": round(_f(inv.vat_amount), 2),
                "total": round(_f(inv.total_amount), 2),
                "status": inv.status,
            }
            for inv in invoices
        ],
    }
