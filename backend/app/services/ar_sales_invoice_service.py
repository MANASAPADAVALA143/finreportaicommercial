"""Shared AR sales invoice creation — classify, draft, and GL post."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.uae_accounting_full import UAECustomer, UAESalesInvoice, UAESalesInvoiceLine
from app.services.ar_classify_service import (
    apply_classification_to_invoice,
    classify_and_store_sales_invoice,
    classify_ar_invoice_sync,
)
from app.services.ar_invoice_post_service import post_sales_invoice_to_gl_and_tax
from app.services.credit_risk_service import recalc_for_customer_name


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


@dataclass
class ARLineItemInput:
    description: str
    qty: float = 1.0
    unit_price: float = 0.0
    vat_rate: float = 5.0


@dataclass
class CreateARInvoiceResult:
    success: bool
    skipped_hard_block: bool = False
    invoice_id: str | None = None
    invoice_number: str | None = None
    subtotal: float = 0.0
    vat_amount: float = 0.0
    total: float = 0.0
    status: str = "draft"
    posted: bool = False
    needs_manual_review: bool = False
    flag_for_review: bool = False
    gulftax_decision: str | None = None
    gulftax_reasoning: str | None = None
    vat_treatment: str | None = None
    gulftax_risk_score: float | None = None
    gulftax_confidence: float | None = None
    trn_valid: bool | None = None
    je_id: str | None = None
    je_reference: str | None = None
    gulftax: dict[str, Any] | None = None
    message: str | None = None
    error: str | None = None


def next_invoice_number(db: Session, tenant_id: str, company_id: str | None) -> str:
    year = datetime.utcnow().year
    q = db.query(UAESalesInvoice).filter(UAESalesInvoice.tenant_id == tenant_id)
    if company_id:
        q = q.filter(UAESalesInvoice.company_id == company_id)
    count = q.count()
    return f"INV-{year}-{count + 1:04d}"


def get_or_create_customer(
    db: Session,
    tenant_id: str,
    name: str,
    trn: str | None = None,
) -> UAECustomer:
    cust = (
        db.query(UAECustomer)
        .filter(UAECustomer.tenant_id == tenant_id, UAECustomer.name == name)
        .first()
    )
    if cust:
        if trn and not cust.trn:
            cust.trn = trn
            db.add(cust)
        return cust
    cust = UAECustomer(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        name=name,
        trn=trn,
    )
    db.add(cust)
    db.flush()
    return cust


def _recalc_credit(
    db: Session, tenant_id: str, company_id: str | None, customer_name: str,
) -> None:
    if customer_name:
        recalc_for_customer_name(db, tenant_id, company_id, customer_name)


def create_ar_invoice_with_classify(
    db: Session,
    *,
    tenant_id: str,
    company_id: str | None,
    customer_name: str,
    customer_trn: str | None,
    invoice_date: date,
    due_date: date,
    line_items: list[ARLineItemInput],
    skip_on_hard_block: bool = False,
    commit: bool = True,
) -> CreateARInvoiceResult:
    """
    Classify-before-persist AR invoice creation.

    skip_on_hard_block=True (bulk import): HARD_BLOCK returns skipped_hard_block, no DB row.
    skip_on_hard_block=False (single create): HARD_BLOCK saves draft, does not post.
    """
    if not line_items:
        return CreateARInvoiceResult(success=False, error="At least one line item required")

    customer_name = customer_name.strip()
    subtotal = sum(li.qty * li.unit_price for li in line_items)
    vat_amount = sum(li.qty * li.unit_price * li.vat_rate / 100 for li in line_items)
    total = subtotal + vat_amount
    invoice_number = next_invoice_number(db, tenant_id, company_id)

    primary_desc = next(
        (li.description for li in line_items if li.description),
        f"AR Sales Invoice to {customer_name}",
    )

    clf = classify_ar_invoice_sync(
        invoice_number=invoice_number,
        customer_name=customer_name,
        total_amount=float(total),
        invoice_date=invoice_date.isoformat(),
        description=primary_desc,
        buyer_trn=customer_trn,
        company_id=company_id or "default",
    )
    decision = str(clf.get("decision") or "AUTO_APPROVE")

    if decision == "HARD_BLOCK" and skip_on_hard_block:
        return CreateARInvoiceResult(
            success=False,
            skipped_hard_block=True,
            invoice_number=invoice_number,
            subtotal=round(subtotal, 2),
            vat_amount=round(vat_amount, 2),
            total=round(total, 2),
            gulftax_decision=decision,
            gulftax_reasoning=clf.get("reasoning"),
            vat_treatment=clf.get("vat_treatment"),
            gulftax_risk_score=clf.get("risk_score"),
            gulftax_confidence=clf.get("confidence_score"),
            trn_valid=clf.get("trn_valid"),
            message="Skipped — GulfTax HARD_BLOCK",
        )

    customer = get_or_create_customer(db, tenant_id, customer_name, customer_trn)

    inv = UAESalesInvoice(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        company_id=company_id,
        invoice_number=invoice_number,
        customer_id=customer.id,
        invoice_date=invoice_date,
        due_date=due_date,
        period=invoice_date.strftime("%Y-%m"),
        subtotal=subtotal,
        vat_amount=vat_amount,
        total_amount=total,
        paid_amount=0,
        outstanding=total,
        status="draft",
        buyer_trn=customer_trn,
    )
    db.add(inv)
    db.flush()

    for li in line_items:
        line_sub = li.qty * li.unit_price
        line_vat = line_sub * li.vat_rate / 100
        db.add(
            UAESalesInvoiceLine(
                id=str(uuid.uuid4()),
                invoice_id=inv.id,
                description=li.description,
                quantity=li.qty,
                unit_price=li.unit_price,
                vat_rate=li.vat_rate,
                vat_amount=line_vat,
                line_total=line_sub + line_vat,
            )
        )
    db.flush()

    apply_classification_to_invoice(inv, clf)
    db.add(inv)
    db.flush()

    if decision == "HARD_BLOCK":
        inv.status = "draft"
        inv.flag_for_review = True
        db.add(inv)
        _recalc_credit(db, tenant_id, company_id, customer_name)
        if commit:
            db.commit()
            db.refresh(inv)
        return CreateARInvoiceResult(
            success=True,
            invoice_id=inv.id,
            invoice_number=invoice_number,
            subtotal=round(subtotal, 2),
            vat_amount=round(vat_amount, 2),
            total=round(total, 2),
            status=inv.status,
            posted=False,
            needs_manual_review=True,
            flag_for_review=True,
            gulftax_decision=decision,
            gulftax_reasoning=clf.get("reasoning"),
            vat_treatment=clf.get("vat_treatment"),
            gulftax_risk_score=clf.get("risk_score"),
            gulftax_confidence=clf.get("confidence_score"),
            trn_valid=clf.get("trn_valid"),
            message=(
                "Invoice saved as draft and NOT posted — GulfTax HARD_BLOCK. "
                "Resolve VAT/TRN issues, then use Approve & Post."
            ),
        )

    post_result = post_sales_invoice_to_gl_and_tax(
        inv.id,
        tenant_id=tenant_id,
        company_id=company_id,
        db=db,
    )
    if not post_result.get("ok"):
        db.rollback()
        return CreateARInvoiceResult(
            success=False,
            invoice_id=inv.id,
            invoice_number=invoice_number,
            error=post_result.get("error", "post_failed"),
            gulftax_decision=decision,
            gulftax_reasoning=clf.get("reasoning"),
        )

    _recalc_credit(db, tenant_id, company_id, customer_name)
    if commit:
        db.commit()
        db.refresh(inv)

    return CreateARInvoiceResult(
        success=True,
        invoice_id=inv.id,
        invoice_number=invoice_number,
        subtotal=round(subtotal, 2),
        vat_amount=round(vat_amount, 2),
        total=round(total, 2),
        status=inv.status,
        posted=True,
        needs_manual_review=bool(inv.flag_for_review),
        flag_for_review=bool(inv.flag_for_review),
        gulftax_decision=inv.gulftax_decision,
        gulftax_reasoning=inv.gulftax_reasoning,
        vat_treatment=inv.vat_treatment,
        gulftax_risk_score=_f(inv.gulftax_risk_score) if inv.gulftax_risk_score is not None else None,
        gulftax_confidence=_f(inv.gulftax_confidence) if inv.gulftax_confidence is not None else None,
        trn_valid=inv.trn_valid,
        je_id=post_result.get("je_id"),
        je_reference=post_result.get("je_reference"),
        gulftax=post_result.get("gulftax"),
    )


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
    """Create a draft sales invoice with one line item — mirrors create-invoice without GL post.

    Runs GulfTax sale-direction classify after the draft is written and stores
    the result on the invoice. Does not post to GL (caller decides).
    """
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

    cust = db.query(UAECustomer).filter_by(id=customer_id).first()
    customer_name = cust.name if cust else "Customer"
    clf = classify_and_store_sales_invoice(
        db,
        inv,
        customer_name=customer_name,
        description=description,
    )
    if clf.get("decision") == "HARD_BLOCK":
        inv.flag_for_review = True
        inv.status = "draft"
        db.add(inv)
        db.flush()

    return inv
