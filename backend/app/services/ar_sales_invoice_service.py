"""Shared AR sales invoice creation — draft only (no GL post)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.uae_accounting_full import UAESalesInvoice, UAESalesInvoiceLine


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def next_invoice_number(db: Session, tenant_id: str, company_id: str | None) -> str:
    year = datetime.utcnow().year
    q = db.query(UAESalesInvoice).filter(UAESalesInvoice.tenant_id == tenant_id)
    if company_id:
        q = q.filter(UAESalesInvoice.company_id == company_id)
    count = q.count()
    return f"INV-{year}-{count + 1:04d}"


def create_draft_sales_invoice(
    db: Session,
    *,
    tenant_id: str,
    company_id: str | None,
    customer_id: str,
    invoice_date: date,
    due_date: date,
    description: str,
    amount: float,
    vat_rate: float = 5.0,
    buyer_trn: str | None = None,
    recurring_template_id: str | None = None,
) -> UAESalesInvoice:
    """Create a draft sales invoice with one line item — mirrors create-invoice without GL post."""
    subtotal = round(amount, 2)
    vat_amount = round(subtotal * vat_rate / 100, 2)
    total = round(subtotal + vat_amount, 2)
    invoice_number = next_invoice_number(db, tenant_id, company_id)

    inv = UAESalesInvoice(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        company_id=company_id,
        invoice_number=invoice_number,
        customer_id=customer_id,
        invoice_date=invoice_date,
        due_date=due_date,
        period=invoice_date.strftime("%Y-%m"),
        subtotal=subtotal,
        vat_amount=vat_amount,
        total_amount=total,
        paid_amount=0,
        outstanding=total,
        status="draft",
        buyer_trn=buyer_trn,
        recurring_template_id=recurring_template_id,
    )
    db.add(inv)
    db.flush()

    db.add(
        UAESalesInvoiceLine(
            id=str(uuid.uuid4()),
            invoice_id=inv.id,
            description=description,
            quantity=1,
            unit_price=subtotal,
            vat_rate=vat_rate,
            vat_amount=vat_amount,
            line_total=total,
        )
    )
    db.flush()
    return inv
