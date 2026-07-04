"""Shared AR sales invoice → UAE GL journal + GulfTax output VAT (idempotent)."""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from app.exceptions.period_control import PeriodControlError
from app.models.uae_accounting_full import UAESalesInvoice
from app.services.ap_company_resolver import resolve_ap_company_id
from app.services.ar_gulftax_sync_service import sync_ar_invoice_to_gulftax
from app.services.uae_journal_service import create_journal_entry

logger = logging.getLogger(__name__)

# Canonical UAE AR CoA (single mapping across all AR paths)
AR_RECEIVABLE_CODE = "1200"
AR_RECEIVABLE_NAME = "Trade Receivables"
AR_REVENUE_CODE = "4100"
AR_REVENUE_NAME = "Sales Revenue"
AR_VAT_PAYABLE_CODE = "2200"
AR_VAT_PAYABLE_NAME = "VAT Payable"
AR_JE_SOURCE = "AR_INVOICE"


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _existing_gl_post(invoice_id: str, tenant_id: str, db: Session) -> dict[str, Any] | None:
    inv = db.query(UAESalesInvoice).filter_by(id=invoice_id, tenant_id=tenant_id).first()
    if inv and inv.journal_entry_id:
        from app.models.uae_accounting_full import UAEJournalEntry

        je = db.get(UAEJournalEntry, inv.journal_entry_id)
        je_ref = (je.entry_number if je else None) or inv.journal_entry_id
        if inv.status == "draft":
            inv.status = "posted"
            db.add(inv)
            db.commit()
        return {
            "skipped": True,
            "je_posted": True,
            "je_reference": je_ref,
            "je_id": inv.journal_entry_id,
            "status": inv.status,
            "message": "Sales invoice already posted to GL (journal_entry_id set).",
        }

    try:
        from app.models.uae_accounting_full import UAEJournalEntry

        existing = (
            db.query(UAEJournalEntry)
            .filter(
                UAEJournalEntry.tenant_id == tenant_id,
                UAEJournalEntry.reference == invoice_id,
                UAEJournalEntry.source.in_((AR_JE_SOURCE, "ar_invoice")),
            )
            .order_by(UAEJournalEntry.created_at.desc())
            .first()
        )
        if existing and inv:
            inv.journal_entry_id = existing.id
            if inv.status == "draft":
                inv.status = "posted"
            db.add(inv)
            db.commit()
            return {
                "skipped": True,
                "je_posted": True,
                "je_reference": existing.entry_number or existing.id,
                "je_id": existing.id,
                "status": inv.status,
                "message": "Sales invoice already posted to GL (existing journal entry).",
            }
    except Exception:
        logger.exception("AR GL idempotency check failed for %s", invoice_id)

    return None


def post_sales_invoice_to_gl_and_tax(
    sales_invoice_id: str,
    *,
    tenant_id: str,
    company_id: str | None,
    db: Session,
) -> dict[str, Any]:
    """
    Post AR sales invoice to uae_journal_entries and sync output VAT to GulfTax.
    Sets status to posted. Idempotent — safe to call from every finalize path.
    """
    inv = (
        db.query(UAESalesInvoice)
        .filter(UAESalesInvoice.id == sales_invoice_id, UAESalesInvoice.tenant_id == tenant_id)
        .first()
    )
    if not inv:
        return {"ok": False, "je_posted": False, "error": "sales_invoice_not_found"}

    cid = resolve_ap_company_id(db, tenant_id, company_id or inv.company_id or None)
    ws_id = tenant_id

    prior = _existing_gl_post(sales_invoice_id, tenant_id, db)
    if prior:
        if cid:
            sync_ar_invoice_to_gulftax(db, sales_invoice_id, cid, workspace_id=ws_id)
        return {"ok": True, **prior}

    if inv.status == "paid":
        return {"ok": False, "je_posted": False, "error": "cannot_post_paid_invoice"}

    subtotal = _f(inv.subtotal)
    vat_amount = _f(inv.vat_amount)
    total = _f(inv.total_amount)
    if total <= 0:
        return {"ok": False, "je_posted": False, "error": "invalid_total_amount"}

    if subtotal <= 0 and vat_amount > 0:
        subtotal = round(total - vat_amount, 2)
    elif subtotal <= 0:
        subtotal = round(total - vat_amount, 2) if vat_amount else total

    cust_name = inv.customer.name if inv.customer else "Customer"
    inv_date = inv.invoice_date
    if not inv_date:
        from datetime import date

        inv_date = date.today()

    je_lines = [
        {
            "account_code": AR_RECEIVABLE_CODE,
            "account_name": AR_RECEIVABLE_NAME,
            "debit": total,
            "credit": 0.0,
            "description": f"AR {inv.invoice_number}",
        },
        {
            "account_code": AR_REVENUE_CODE,
            "account_name": AR_REVENUE_NAME,
            "debit": 0.0,
            "credit": subtotal,
            "description": f"Sales {cust_name}",
        },
    ]
    if vat_amount > 0:
        je_lines.append({
            "account_code": AR_VAT_PAYABLE_CODE,
            "account_name": AR_VAT_PAYABLE_NAME,
            "debit": 0.0,
            "credit": vat_amount,
            "description": f"Output VAT {inv.invoice_number}",
        })

    je_id: str | None = None
    je_ref = ""
    je_posted = False

    try:
        je = create_journal_entry(
            tenant_id=tenant_id,
            entry_date=inv_date,
            description=f"Sales: {cust_name} - {inv.invoice_number}",
            lines=je_lines,
            reference=sales_invoice_id,
            source=AR_JE_SOURCE,
            company_id=cid,
            db=db,
            auto_post=True,
        )
        je_id = je.id
        je_ref = je.entry_number or je.id
        je_posted = True
    except PeriodControlError as exc:
        db.rollback()
        return {"ok": False, "je_posted": False, "error": str(exc)}
    except Exception as exc:
        logger.exception("Failed to post AR sales invoice %s to GL", inv.invoice_number)
        db.rollback()
        return {"ok": False, "je_posted": False, "error": str(exc)}

    inv.journal_entry_id = je_id
    inv.status = "posted"
    db.add(inv)
    db.commit()

    gulftax_result: dict[str, Any] = {}
    if cid:
        try:
            gulftax_result = sync_ar_invoice_to_gulftax(
                db, sales_invoice_id, cid, workspace_id=ws_id,
            )
        except Exception:
            logger.exception("GulfTax sync after AR post failed for %s", inv.invoice_number)

    logger.info(
        "AR post_sales_invoice_to_gl_and_tax: invoice=%s customer=%s JE=%s",
        inv.invoice_number,
        cust_name,
        je_ref,
    )

    return {
        "ok": True,
        "skipped": False,
        "je_posted": je_posted,
        "je_reference": je_ref,
        "je_id": je_id,
        "invoice_id": inv.id,
        "invoice_number": inv.invoice_number,
        "status": inv.status,
        "gulftax": gulftax_result,
        "message": f"Sales invoice {inv.invoice_number} posted to UAE GL.",
    }
