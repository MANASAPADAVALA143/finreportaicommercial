"""Shared AR sales invoice → UAE GL journal + GulfTax output VAT (idempotent).

Canonical CoA (all AR paths):
  DR 1200 Accounts Receivable  = total inc VAT
  CR 4100 Revenue              = subtotal ex VAT
  CR 2200 VAT Output Payable   = VAT amount
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session, joinedload

from app.exceptions.period_control import PeriodControlError
from app.models.uae_accounting_full import UAESalesInvoice
from app.services.ap_company_resolver import resolve_ap_company_id
from app.services.ar_gulftax_sync_service import sync_ar_invoice_to_gulftax
from app.services.uae_journal_service import create_journal_entry

logger = logging.getLogger(__name__)

# Canonical UAE AR CoA (single mapping across all AR paths)
AR_RECEIVABLE_CODE = "1200"
AR_RECEIVABLE_NAME = "Accounts Receivable"
AR_REVENUE_CODE = "4100"
AR_REVENUE_NAME = "Revenue"
AR_VAT_PAYABLE_CODE = "2200"
AR_VAT_PAYABLE_NAME = "VAT Output Payable"
AR_JE_SOURCE = "ar_sales_invoice"
AR_JE_SOURCES = ("ar_sales_invoice", "AR_INVOICE", "ar_invoice")
AR_GULFTAX_SOURCE = "ar_approve_and_post"
POSTABLE_STATUSES = ("draft", "pending")


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
        if inv.status in POSTABLE_STATUSES:
            inv.status = "posted"
            db.add(inv)
            db.commit()
        return {
            "skipped": True,
            "success": True,
            "ok": True,
            "je_posted": True,
            "je_reference": je_ref,
            "je_id": inv.journal_entry_id,
            "journal_entry_id": inv.journal_entry_id,
            "invoice_id": inv.id,
            "status": inv.status,
            "message": "Sales invoice already posted to GL (journal_entry_id set).",
        }

    try:
        from app.models.uae_accounting_full import UAEJournalEntry

        # Savepoint so a schema mismatch does not abort the outer transaction.
        with db.begin_nested():
            existing = (
                db.query(UAEJournalEntry)
                .filter(
                    UAEJournalEntry.tenant_id == tenant_id,
                    UAEJournalEntry.reference.in_(
                        [invoice_id, (inv.invoice_number if inv else "") or ""]
                    ),
                    UAEJournalEntry.source.in_(AR_JE_SOURCES),
                )
                .order_by(UAEJournalEntry.created_at.desc())
                .first()
            )
        if existing and inv:
            inv.journal_entry_id = existing.id
            if inv.status in POSTABLE_STATUSES:
                inv.status = "posted"
            db.add(inv)
            db.commit()
            return {
                "skipped": True,
                "success": True,
                "ok": True,
                "je_posted": True,
                "je_reference": existing.entry_number or existing.id,
                "je_id": existing.id,
                "journal_entry_id": existing.id,
                "invoice_id": inv.id,
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
    approved_by: str | None = None,
) -> dict[str, Any]:
    """
    Post AR sales invoice to uae_journal_entries and sync output VAT to GulfTax.
    Sets status to posted. Idempotent — safe to call from every finalize path.

    Error contract:
      - JE failure → rollback, invoice stays draft/pending
      - GulfTax / classifier failure → log warning, JE kept (AP pattern)
    """
    inv = (
        db.query(UAESalesInvoice)
        .options(joinedload(UAESalesInvoice.lines), joinedload(UAESalesInvoice.customer))
        .filter(UAESalesInvoice.id == sales_invoice_id, UAESalesInvoice.tenant_id == tenant_id)
        .first()
    )
    if not inv:
        return {
            "ok": False,
            "success": False,
            "je_posted": False,
            "error": "sales_invoice_not_found",
            "error_type": "not_found",
        }

    cid = resolve_ap_company_id(db, tenant_id, company_id or inv.company_id or None)
    ws_id = tenant_id

    if (
        company_id
        and inv.company_id
        and str(company_id).strip()
        and str(inv.company_id).strip()
        and str(company_id).strip() != str(inv.company_id).strip()
    ):
        return {
            "ok": False,
            "success": False,
            "je_posted": False,
            "error": "company_id_mismatch",
            "error_type": "validation",
        }

    prior = _existing_gl_post(sales_invoice_id, tenant_id, db)
    if prior:
        gulftax_result: dict[str, Any] = {}
        if cid:
            gulftax_result = sync_ar_invoice_to_gulftax(
                db,
                sales_invoice_id,
                cid,
                workspace_id=ws_id,
                source=AR_GULFTAX_SOURCE,
            )
        einvoicing_result: dict[str, Any] = {}
        try:
            from app.services.einvoicing_service_unified import generate_and_store_ar_einvoice

            einvoicing_result = generate_and_store_ar_einvoice(
                db, sales_invoice_id, tenant_id=tenant_id, company_id=cid,
            )
        except Exception:
            logger.exception("E-invoice XML generation failed for %s", sales_invoice_id)
        return {
            **prior,
            "gulftax": gulftax_result,
            "gulftax_transaction_id": gulftax_result.get("transaction_id"),
            "einvoicing": einvoicing_result,
        }

    status = (inv.status or "draft").lower()
    if status not in POSTABLE_STATUSES:
        if status == "posted":
            return {
                "ok": False,
                "success": False,
                "je_posted": False,
                "error": "invoice_already_posted",
                "error_type": "validation",
            }
        if status == "paid":
            return {
                "ok": False,
                "success": False,
                "je_posted": False,
                "error": "cannot_post_paid_invoice",
                "error_type": "validation",
            }
        return {
            "ok": False,
            "success": False,
            "je_posted": False,
            "error": f"invalid_status:{status}",
            "error_type": "validation",
        }

    if not (inv.lines or []):
        return {
            "ok": False,
            "success": False,
            "je_posted": False,
            "error": "invoice_has_no_line_items",
            "error_type": "validation",
        }

    subtotal = _f(inv.subtotal)
    vat_amount = _f(inv.vat_amount)
    total = _f(inv.total_amount)
    if total <= 0:
        return {
            "ok": False,
            "success": False,
            "je_posted": False,
            "error": "invalid_total_amount",
            "error_type": "validation",
        }

    if subtotal <= 0 and vat_amount > 0:
        subtotal = round(total - vat_amount, 2)
    elif subtotal <= 0:
        subtotal = round(total - vat_amount, 2) if vat_amount else total

    cust_name = inv.customer.name if inv.customer else "Customer"
    inv_date = inv.invoice_date
    if not inv_date:
        from datetime import date as date_cls

        inv_date = date_cls.today()

    poster = (approved_by or "").strip() or "system"
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
    je_description = f"Sales Invoice: {inv.invoice_number} - {cust_name}"

    try:
        je = create_journal_entry(
            tenant_id=tenant_id,
            entry_date=inv_date,
            description=je_description,
            lines=je_lines,
            reference=inv.invoice_number or sales_invoice_id,
            source=AR_JE_SOURCE,
            company_id=cid,
            db=db,
            auto_post=True,
        )
        je_id = je.id
        je_ref = je.entry_number or je.id
        je_posted = True
        # Stamp JE poster when columns exist
        try:
            if hasattr(je, "approved_by"):
                je.approved_by = poster
            if hasattr(je, "approved_at"):
                je.approved_at = datetime.utcnow()
            db.add(je)
            db.commit()
        except Exception:
            logger.debug("Could not stamp JE approved_by for %s", je_id)
    except PeriodControlError as exc:
        db.rollback()
        return {
            "ok": False,
            "success": False,
            "je_posted": False,
            "error": str(exc),
            "error_type": "period_control",
        }
    except Exception as exc:
        logger.exception("Failed to post AR sales invoice %s to GL", inv.invoice_number)
        db.rollback()
        return {
            "ok": False,
            "success": False,
            "je_posted": False,
            "error": str(exc),
            "error_type": "journal_entry",
        }

    inv.journal_entry_id = je_id
    inv.status = "posted"
    inv.approved_at = datetime.utcnow()
    inv.approved_by = poster
    db.add(inv)
    db.commit()

    gulftax_result = {}
    if cid:
        try:
            gulftax_result = sync_ar_invoice_to_gulftax(
                db,
                sales_invoice_id,
                cid,
                workspace_id=ws_id,
                source=AR_GULFTAX_SOURCE,
            )
            if not gulftax_result.get("ok"):
                logger.warning(
                    "GulfTax sync after AR post returned error for %s: %s",
                    inv.invoice_number,
                    gulftax_result.get("error"),
                )
        except Exception:
            logger.exception(
                "GulfTax sync after AR post failed for %s — JE kept as source of truth",
                inv.invoice_number,
            )
            gulftax_result = {"ok": False, "error": "gulftax_sync_exception"}

    einvoicing_result = {}
    try:
        from app.services.einvoicing_service_unified import generate_and_store_ar_einvoice

        einvoicing_result = generate_and_store_ar_einvoice(
            db, sales_invoice_id, tenant_id=tenant_id, company_id=cid,
        )
    except Exception:
        logger.exception("E-invoice XML generation failed for %s", inv.invoice_number)

    logger.info(
        "AR approve-and-post: invoice=%s customer=%s JE=%s gulftax=%s",
        inv.invoice_number,
        cust_name,
        je_ref,
        gulftax_result.get("transaction_id"),
    )

    return {
        "success": True,
        "ok": True,
        "skipped": False,
        "je_posted": je_posted,
        "je_reference": je_ref,
        "je_id": je_id,
        "journal_entry_id": je_id,
        "invoice_id": inv.id,
        "invoice_number": inv.invoice_number,
        "status": "posted",
        "gulftax_transaction_id": gulftax_result.get("transaction_id"),
        "gulftax": gulftax_result,
        "einvoicing": einvoicing_result,
        "message": (
            f"Invoice {inv.invoice_number} posted → GL entry created + VAT recorded in GulfTax"
        ),
    }
