"""AR credit notes — issue, GL reversal, GulfTax adjustment, void."""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.exceptions.period_control import PeriodControlError
from app.models.uae_accounting_full import UAECreditNote, UAESalesInvoice
from app.services.ap_company_resolver import resolve_ap_company_id
from app.services.ar_gulftax_sync_service import sync_ar_credit_note_to_gulftax
from app.services.ar_invoice_post_service import (
    AR_RECEIVABLE_CODE,
    AR_RECEIVABLE_NAME,
    AR_REVENUE_CODE,
    AR_REVENUE_NAME,
    AR_VAT_PAYABLE_CODE,
    AR_VAT_PAYABLE_NAME,
)
from app.services.uae_journal_service import create_journal_entry

logger = logging.getLogger(__name__)

CN_JE_SOURCE = "AR_CREDIT_NOTE"
CN_VOID_JE_SOURCE = "AR_CREDIT_NOTE_VOID"
_POSTED_STATUSES = frozenset({"posted", "sent", "partial", "overdue", "paid"})


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _split_gross(amount: float, inv: UAESalesInvoice) -> tuple[float, float]:
    """Split gross credit amount into net + VAT using parent invoice ratio."""
    gross = round(amount, 2)
    total = _f(inv.total_amount)
    subtotal = _f(inv.subtotal)
    vat = _f(inv.vat_amount)
    if gross <= 0:
        return 0.0, 0.0
    if subtotal > 0 and vat > 0:
        rate = vat / subtotal
        net = round(gross / (1 + rate), 2)
        vat_part = round(gross - net, 2)
        return net, vat_part
    if total > 0 and vat > 0:
        rate = vat / (total - vat) if (total - vat) > 0 else 0.05
        net = round(gross / (1 + rate), 2)
        return net, round(gross - net, 2)
    return gross, 0.0


def _next_credit_note_number(db: Session, tenant_id: str, company_id: str | None) -> str:
    year = datetime.utcnow().year
    q = db.query(UAECreditNote).filter(UAECreditNote.tenant_id == tenant_id)
    if company_id:
        q = q.filter(UAECreditNote.company_id == company_id)
    count = q.count()
    return f"CN-{year}-{count + 1:04d}"


def _issued_credit_total(db: Session, invoice_id: str) -> float:
    rows = (
        db.query(UAECreditNote)
        .filter(
            UAECreditNote.parent_invoice_id == invoice_id,
            UAECreditNote.status == "issued",
        )
        .all()
    )
    return round(sum(_f(r.amount) for r in rows), 2)


def _credit_note_to_dict(cn: UAECreditNote, inv: UAESalesInvoice | None = None) -> dict[str, Any]:
    cust = cn.customer or (inv.customer if inv else None)
    return {
        "id": cn.id,
        "credit_note_number": cn.credit_note_number,
        "parent_invoice_id": cn.parent_invoice_id,
        "invoice_number": inv.invoice_number if inv else None,
        "customer_id": cn.customer_id,
        "customer_name": cust.name if cust else "Customer",
        "company_id": cn.company_id,
        "amount": _f(cn.amount),
        "reason": cn.reason,
        "status": cn.status,
        "issued_date": cn.issued_date.isoformat() if cn.issued_date else None,
        "created_at": cn.created_at.isoformat() if cn.created_at else None,
    }


def issue_credit_note(
    db: Session,
    invoice_id: str,
    amount: float,
    reason: str,
    *,
    tenant_id: str,
    company_id: str | None = None,
    issued_date: date | None = None,
) -> dict[str, Any]:
    """Issue credit note: validate, reduce outstanding, post GL + GulfTax."""
    gross = round(float(amount), 2)
    if gross <= 0:
        return {"ok": False, "error": "amount_must_be_positive"}

    inv = (
        db.query(UAESalesInvoice)
        .filter(UAESalesInvoice.id == invoice_id, UAESalesInvoice.tenant_id == tenant_id)
        .first()
    )
    if not inv:
        return {"ok": False, "error": "sales_invoice_not_found"}

    if (inv.status or "draft") == "draft" or not inv.journal_entry_id:
        return {"ok": False, "error": "invoice_not_posted_to_gl"}

    outstanding = _f(inv.outstanding)
    if gross > outstanding + 0.001:
        return {"ok": False, "error": "amount_exceeds_outstanding", "outstanding": outstanding}

    cid = resolve_ap_company_id(db, tenant_id, company_id or inv.company_id)
    issue_dt = issued_date or date.today()
    cn_number = _next_credit_note_number(db, tenant_id, cid)
    net, vat_part = _split_gross(gross, inv)
    cust_name = inv.customer.name if inv.customer else "Customer"

    cn = UAECreditNote(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        company_id=cid,
        customer_id=inv.customer_id,
        parent_invoice_id=inv.id,
        credit_note_number=cn_number,
        amount=gross,
        reason=(reason or "").strip() or None,
        status="issued",
        issued_date=issue_dt,
    )
    db.add(cn)
    db.flush()

    je_lines = [
        {
            "account_code": AR_RECEIVABLE_CODE,
            "account_name": AR_RECEIVABLE_NAME,
            "debit": 0.0,
            "credit": gross,
            "description": f"CN {cn_number} — {inv.invoice_number}",
        },
        {
            "account_code": AR_REVENUE_CODE,
            "account_name": AR_REVENUE_NAME,
            "debit": net,
            "credit": 0.0,
            "description": f"Credit {cust_name}",
        },
    ]
    if vat_part > 0:
        je_lines.append({
            "account_code": AR_VAT_PAYABLE_CODE,
            "account_name": AR_VAT_PAYABLE_NAME,
            "debit": vat_part,
            "credit": 0.0,
            "description": f"Output VAT reversal {cn_number}",
        })

    try:
        je = create_journal_entry(
            tenant_id=tenant_id,
            entry_date=issue_dt,
            description=f"Credit note: {cn_number} — {inv.invoice_number}",
            lines=je_lines,
            reference=cn.id,
            source=CN_JE_SOURCE,
            company_id=cid,
            db=db,
            auto_post=True,
        )
    except PeriodControlError as exc:
        db.rollback()
        return {"ok": False, "error": str(exc)}
    except Exception as exc:
        logger.exception("Credit note JE failed for %s", cn_number)
        db.rollback()
        return {"ok": False, "error": str(exc)}

    inv.outstanding = round(max(0.0, outstanding - gross), 2)
    if inv.outstanding <= 0.01:
        inv.outstanding = 0.0
        inv.status = "paid"
    db.add(inv)
    db.commit()

    gulftax_result: dict[str, Any] = {}
    if cid:
        try:
            gulftax_result = sync_ar_credit_note_to_gulftax(
                db,
                cn,
                inv,
                customer_name=cust_name,
                company_id=cid,
                workspace_id=tenant_id,
                net_amount=net,
                vat_amount=vat_part,
            )
        except Exception:
            logger.exception("GulfTax credit note sync failed for %s", cn_number)

    logger.info(
        "Issued credit note %s against invoice %s amount=%s JE=%s",
        cn_number,
        inv.invoice_number,
        gross,
        je.entry_number or je.id,
    )

    return {
        "ok": True,
        "credit_note": _credit_note_to_dict(cn, inv),
        "invoice_id": inv.id,
        "invoice_number": inv.invoice_number,
        "outstanding_after": _f(inv.outstanding),
        "invoice_status": inv.status,
        "je_id": je.id,
        "je_reference": je.entry_number or je.id,
        "gulftax": gulftax_result,
    }


def void_credit_note(
    db: Session,
    credit_note_id: str,
    *,
    tenant_id: str,
) -> dict[str, Any]:
    """Void an issued credit note — restore outstanding and post reversing JE."""
    cn = (
        db.query(UAECreditNote)
        .filter(UAECreditNote.id == credit_note_id, UAECreditNote.tenant_id == tenant_id)
        .first()
    )
    if not cn:
        return {"ok": False, "error": "credit_note_not_found"}
    if cn.status == "voided":
        return {"ok": False, "error": "credit_note_already_voided"}
    if cn.status != "issued":
        return {"ok": False, "error": f"cannot_void_status_{cn.status}"}

    inv = db.query(UAESalesInvoice).filter_by(id=cn.parent_invoice_id).first()
    if not inv:
        return {"ok": False, "error": "parent_invoice_not_found"}

    # OPEN QUESTION (surfaced, not auto-resolved):
    # If the customer paid the remaining balance after this credit note was issued,
    # voiding would inflate outstanding again while cash was already received.
    paid = _f(inv.paid_amount)
    if paid > 0 and (inv.status == "paid" or _f(inv.outstanding) <= 0.01):
        return {
            "ok": False,
            "error": "void_blocked_invoice_paid_after_credit_note",
            "message": (
                "This invoice was fully settled (payment received) after the credit note "
                "was issued. Voiding would restore AR outstanding while payment is already "
                "on record — manual review required before voiding."
            ),
            "paid_amount": paid,
            "credit_note_amount": _f(cn.amount),
        }

    gross = _f(cn.amount)
    net, vat_part = _split_gross(gross, inv)
    cust_name = inv.customer.name if inv.customer else "Customer"
    void_date = date.today()
    cid = cn.company_id or inv.company_id

    je_lines = [
        {
            "account_code": AR_RECEIVABLE_CODE,
            "account_name": AR_RECEIVABLE_NAME,
            "debit": gross,
            "credit": 0.0,
            "description": f"Void CN {cn.credit_note_number}",
        },
        {
            "account_code": AR_REVENUE_CODE,
            "account_name": AR_REVENUE_NAME,
            "debit": 0.0,
            "credit": net,
            "description": f"Void credit {cust_name}",
        },
    ]
    if vat_part > 0:
        je_lines.append({
            "account_code": AR_VAT_PAYABLE_CODE,
            "account_name": AR_VAT_PAYABLE_NAME,
            "debit": 0.0,
            "credit": vat_part,
            "description": f"Void VAT {cn.credit_note_number}",
        })

    try:
        je = create_journal_entry(
            tenant_id=tenant_id,
            entry_date=void_date,
            description=f"Void credit note: {cn.credit_note_number}",
            lines=je_lines,
            reference=f"{cn.id}-void",
            source=CN_VOID_JE_SOURCE,
            company_id=cid,
            db=db,
            auto_post=True,
        )
    except PeriodControlError as exc:
        db.rollback()
        return {"ok": False, "error": str(exc)}
    except Exception as exc:
        logger.exception("Void credit note JE failed for %s", cn.credit_note_number)
        db.rollback()
        return {"ok": False, "error": str(exc)}

    inv.outstanding = round(_f(inv.outstanding) + gross, 2)
    total = _f(inv.total_amount)
    if inv.outstanding > total:
        inv.outstanding = total
    if inv.status == "paid" and inv.outstanding > 0:
        inv.status = "partial" if paid > 0 else "sent"
    cn.status = "voided"
    db.add(inv)
    db.add(cn)
    db.commit()

    gulftax_result: dict[str, Any] = {}
    if cid:
        try:
            gulftax_result = sync_ar_credit_note_to_gulftax(
                db,
                cn,
                inv,
                customer_name=cust_name,
                company_id=cid,
                workspace_id=tenant_id,
                net_amount=-net,
                vat_amount=-vat_part,
                void=True,
            )
        except Exception:
            logger.exception("GulfTax void sync failed for %s", cn.credit_note_number)

    return {
        "ok": True,
        "credit_note": _credit_note_to_dict(cn, inv),
        "invoice_id": inv.id,
        "outstanding_after": _f(inv.outstanding),
        "invoice_status": inv.status,
        "je_id": je.id,
        "je_reference": je.entry_number or je.id,
        "gulftax": gulftax_result,
    }


def list_credit_notes(
    db: Session,
    tenant_id: str,
    *,
    company_id: str | None = None,
    customer_id: str | None = None,
    status: str | None = None,
    parent_invoice_id: str | None = None,
) -> dict[str, Any]:
    q = db.query(UAECreditNote).filter(UAECreditNote.tenant_id == tenant_id)
    if company_id:
        q = q.filter(UAECreditNote.company_id == company_id)
    if customer_id:
        q = q.filter(UAECreditNote.customer_id == customer_id)
    if status:
        q = q.filter(UAECreditNote.status == status.lower())
    if parent_invoice_id:
        q = q.filter(UAECreditNote.parent_invoice_id == parent_invoice_id)
    rows = q.order_by(UAECreditNote.created_at.desc()).limit(500).all()

    inv_ids = {r.parent_invoice_id for r in rows}
    inv_map = {
        i.id: i
        for i in db.query(UAESalesInvoice).filter(UAESalesInvoice.id.in_(inv_ids)).all()
    } if inv_ids else {}

    return {
        "credit_notes": [_credit_note_to_dict(r, inv_map.get(r.parent_invoice_id)) for r in rows],
        "count": len(rows),
    }
