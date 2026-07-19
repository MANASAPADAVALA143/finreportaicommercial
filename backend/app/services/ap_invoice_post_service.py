"""Shared AP approve → UAE GL journal + GulfTax sync (idempotent)."""

from __future__ import annotations

import logging
from datetime import date
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.services.ap_company_resolver import resolve_ap_company_id

logger = logging.getLogger(__name__)


class ApInvoicePostRequest(BaseModel):
    invoice_number: str
    vendor_name: str
    total_amount: float
    vat_amount_aed: float = 0.0
    vat_treatment: str = "standard_rated"
    decision: str = "AUTO_APPROVE"
    risk_score: float = 0.0
    invoice_date: str = ""
    notes: str = ""
    workspace_id: str = ""
    company_id: str = ""
    invoice_id: str = ""
    gl_code: str = "6100"
    blocked_input_vat: bool = False
    uploaded_by_email: str = ""
    due_date: str = ""


def request_from_supabase_invoice(inv: dict[str, Any], workspace_id: str = "") -> ApInvoicePostRequest:
    """Build post payload from a Supabase invoices row."""
    vat = float(inv.get("vat_amount") or inv.get("tax_amount") or 0)
    treatment = str(inv.get("vat_treatment") or "standard_rated")
    blocked = treatment in ("blocked", "non_recoverable")
    inv_date = inv.get("invoice_date") or ""
    if inv_date and "T" in str(inv_date):
        inv_date = str(inv_date)[:10]
    due = inv.get("due_date") or ""
    if due and "T" in str(due):
        due = str(due)[:10]
    return ApInvoicePostRequest(
        invoice_id=str(inv.get("id") or ""),
        invoice_number=str(inv.get("invoice_number") or ""),
        vendor_name=str(inv.get("vendor_name") or ""),
        total_amount=float(inv.get("total_amount") or 0),
        vat_amount_aed=vat,
        vat_treatment=treatment,
        decision=str(inv.get("gulftax_decision") or "AUTO_APPROVE"),
        risk_score=float(inv.get("gulftax_risk_score") or inv.get("risk_score") or 0),
        invoice_date=str(inv_date),
        company_id=str(inv.get("company_id") or ""),
        workspace_id=workspace_id,
        gl_code=str(inv.get("gl_code") or inv.get("gl_account") or "6100"),
        blocked_input_vat=blocked,
        uploaded_by_email=str(inv.get("uploaded_by_email") or inv.get("created_by_email") or ""),
        due_date=str(due),
    )


def _fetch_supabase_invoice(invoice_id: str) -> dict[str, Any] | None:
    try:
        from app.services.gulftax_sync_service import _fetch_invoice

        return _fetch_invoice(invoice_id)
    except Exception:
        logger.exception("Failed to load invoice %s from Supabase", invoice_id)
        return None


def _find_ap_journal(
    invoice_id: str,
    tenant_id: str,
    db: Session,
):
    """Return the AP expense JE for this invoice if it exists in the live GL DB."""
    from app.models.uae_accounting_full import UAEJournalEntry

    return (
        db.query(UAEJournalEntry)
        .filter(
            UAEJournalEntry.tenant_id == tenant_id,
            UAEJournalEntry.reference == invoice_id,
            UAEJournalEntry.source == "AP_INVOICE",
        )
        .order_by(UAEJournalEntry.created_at.desc())
        .first()
    )


def _existing_gl_post(
    invoice_id: str,
    tenant_id: str,
    db: Session,
) -> dict[str, Any] | None:
    """Return prior JE info only when a real uae_journal_entries row exists.

    Never trust invoices.je_posted alone — that flag has been set without a
    matching journal row (wrong DB / swallowed failure / orphan backfill).
    """
    if not invoice_id:
        return None

    try:
        existing = _find_ap_journal(invoice_id, tenant_id, db)
        if existing:
            je_ref = existing.entry_number or existing.id
            try:
                from app.services.gulftax_supabase import mark_invoice_je_posted

                mark_invoice_je_posted(invoice_id, je_ref)
            except Exception:
                pass
            return {
                "skipped": True,
                "je_posted": True,
                "je_reference": je_ref,
                "je_id": existing.id,
                "message": "Invoice already posted to GL (existing journal entry).",
            }

        # Orphan flag: Supabase says posted, but this GL database has no row.
        inv = _fetch_supabase_invoice(invoice_id)
        if inv and inv.get("je_posted"):
            from app.services.gulftax_supabase import clear_invoice_je_posted

            clear_invoice_je_posted(
                invoice_id,
                reason=(
                    f"orphan flag je_reference={inv.get('je_reference')!r} "
                    f"with no uae_journal_entries row for tenant={tenant_id}"
                ),
            )
    except Exception:
        logger.exception("GL idempotency check failed for invoice %s", invoice_id)

    return None


def post_invoice_to_gl_and_tax(
    body: ApInvoicePostRequest,
    *,
    tenant_id: str,
    db: Session,
) -> dict[str, Any]:
    """
    Post an approved AP invoice to uae_journal_entries and sync GulfTax.
    Idempotent — safe to call from bulk approve, auto-match, WhatsApp callback, etc.
    """
    if body.decision == "HARD_BLOCK":
        return {"ok": False, "je_posted": False, "error": "HARD_BLOCKED"}

    if body.invoice_id:
        prior = _existing_gl_post(body.invoice_id, tenant_id, db)
        if prior:
            ws_id = body.workspace_id or tenant_id
            try:
                company_id = resolve_ap_company_id(db, tenant_id, body.company_id or None)
            except Exception:
                company_id = (body.company_id or "").strip() or None
            if company_id:
                try:
                    from app.services.gulftax_sync_service import (
                        log_sync_failure,
                        sync_approved_invoice_to_gulftax,
                    )

                    sync_result = sync_approved_invoice_to_gulftax(
                        body.invoice_id,
                        company_id,
                        workspace_id=ws_id,
                    )
                    if not sync_result.get("ok") and not sync_result.get("skipped"):
                        logger.warning(
                            "Supabase GulfTax sync failed for invoice %s: %s",
                            body.invoice_id,
                            sync_result.get("error", "unknown"),
                        )
                        log_sync_failure(
                            invoice_id=body.invoice_id,
                            company_id=company_id,
                            error=str(sync_result.get("error", "unknown")),
                            workspace_id=ws_id,
                        )
                    try:
                        from app.services.ar_gulftax_sync_service import sync_ap_invoice_to_rds_gulftax

                        rds_result = sync_ap_invoice_to_rds_gulftax(
                            db,
                            body.invoice_id,
                            company_id,
                            workspace_id=ws_id,
                        )
                        if not rds_result.get("ok") and not rds_result.get("skipped"):
                            logger.warning(
                                "RDS GulfTax sync failed for invoice %s: %s",
                                body.invoice_id,
                                rds_result.get("error", "unknown"),
                            )
                    except Exception:
                        logger.exception("RDS GulfTax sync on idempotent skip failed for %s", body.invoice_id)
                except Exception:
                    logger.exception("GulfTax sync on idempotent skip failed for %s", body.invoice_id)
            return {"ok": True, **prior}

    je_ref = ""
    post_date = body.invoice_date or date.today().isoformat()

    net_amount = round(body.total_amount - body.vat_amount_aed, 2)
    vat_amount = round(body.vat_amount_aed, 2)

    ws_id = body.workspace_id or tenant_id
    # Prefer validated ap_companies row; fall back to Supabase company_id so JE
    # rows are never company-orphaned (NULL) when the UI filters by company.
    try:
        resolved = resolve_ap_company_id(db, tenant_id, body.company_id or None)
    except Exception:
        logger.warning(
            "ap_companies resolve failed for company_id=%s tenant=%s — using invoice company_id",
            body.company_id,
            tenant_id,
        )
        resolved = None
    company_id = resolved or ((body.company_id or "").strip() or None)

    je_lines = [
        {
            "account": "5001",
            "account_name": "Expenses / COGS",
            "debit": net_amount,
            "credit": 0.0,
            "description": f"{body.vendor_name} — {body.vat_treatment}",
        },
        {
            "account": "2001",
            "account_name": "Accounts Payable",
            "debit": 0.0,
            "credit": body.total_amount,
            "description": f"AP {body.invoice_number}",
        },
    ]
    if vat_amount > 0:
        je_lines.insert(
            1,
            {
                "account": "2301",
                "account_name": "Input VAT Recoverable",
                "debit": vat_amount,
                "credit": 0.0,
                "description": f"Input VAT @ {body.vat_amount_aed} AED — {body.vat_treatment}",
            },
        )

    purchase_invoice_id = None
    try:
        import uuid as _uuid
        from datetime import date as _date

        from sqlalchemy import text

        from app.models.uae_ap import UAEPurchaseInvoice, UAEPurchaseInvoiceLine, UAEVendor

        # Local SQLite schemas may pre-date company_id — add it so ORM inserts work.
        try:
            db.execute(text(
                "ALTER TABLE uae_purchase_invoices ADD COLUMN company_id VARCHAR(36)"
            ))
            db.commit()
        except Exception:
            db.rollback()

        existing_pi = (
            db.query(UAEPurchaseInvoice)
            .filter(
                UAEPurchaseInvoice.tenant_id == tenant_id,
                UAEPurchaseInvoice.invoice_number == body.invoice_number,
            )
            .first()
        )
        if existing_pi:
            purchase_invoice_id = existing_pi.id
        else:
            vendor = (
                db.query(UAEVendor)
                .filter(
                    UAEVendor.tenant_id == tenant_id,
                    UAEVendor.name.ilike(f"%{body.vendor_name[:20]}%"),
                )
                .first()
            )
            if not vendor:
                vendor = UAEVendor(
                    id=str(_uuid.uuid4()),
                    tenant_id=tenant_id,
                    workspace_id=ws_id,
                    name=body.vendor_name,
                )
                db.add(vendor)
                db.flush()

            inv_date = _date.fromisoformat(post_date) if post_date else _date.today()
            pi = UAEPurchaseInvoice(
                id=str(_uuid.uuid4()),
                tenant_id=tenant_id,
                workspace_id=ws_id,
                company_id=company_id,
                invoice_number=body.invoice_number,
                vendor_id=vendor.id,
                invoice_date=inv_date,
                due_date=inv_date,
                subtotal=net_amount,
                vat_amount=vat_amount,
                total_amount=body.total_amount,
                outstanding=body.total_amount,
                status="posted",
                vat_treatment=body.vat_treatment,
                source="ocr",
            )
            db.add(pi)
            db.add(
                UAEPurchaseInvoiceLine(
                    id=str(_uuid.uuid4()),
                    invoice_id=pi.id,
                    description=f"{body.vendor_name} — {body.vat_treatment}",
                    quantity=1,
                    unit_price=net_amount,
                    line_total=net_amount,
                    vat_rate=5,
                    vat_amount=vat_amount,
                )
            )
            db.commit()
            purchase_invoice_id = pi.id
    except Exception:
        logger.exception("Failed to persist AP purchase invoice for %s", body.invoice_number)
        db.rollback()

    period = post_date[:7] if post_date and len(post_date) >= 7 else date.today().strftime("%Y-%m")

    vat_entry_id = None
    try:
        from app.services.gulftax_supabase import insert_vat_return_entry

        entry = insert_vat_return_entry(
            workspace_id=ws_id,
            company_id=company_id or ws_id,
            period=period,
            source="ap_invoice",
            transaction_id=body.invoice_number,
            vendor_name=body.vendor_name,
            net_amount=net_amount,
            vat_amount=vat_amount if not body.blocked_input_vat else 0.0,
            vat_treatment=body.vat_treatment,
            blocked_input_vat=body.blocked_input_vat,
        )
        if entry:
            vat_entry_id = entry.get("id")
    except Exception:
        logger.exception("vat_return_entries insert failed for %s", body.invoice_number)

    je_id: str | None = None
    je_id_vat: str | None = None
    je_posted = False
    period_row = None
    gl_error: str | None = None

    try:
        from datetime import date as _date

        from app.models.company_setup import AccountingPeriod
        from app.services.uae_journal_service import create_journal_entry

        inv_date = _date.fromisoformat(post_date) if post_date else _date.today()
        period_q = db.query(AccountingPeriod).filter(
            AccountingPeriod.workspace_id == ws_id,
            AccountingPeriod.start_date <= inv_date,
            AccountingPeriod.end_date >= inv_date,
        )
        if company_id:
            period_q = period_q.filter(AccountingPeriod.company_id == company_id)
        period_row = period_q.first()

        expense_acct = (body.gl_code or "6100").strip() or "6100"
        ap_acct = "2100"
        vat_acct = "1810"
        je_reference = body.invoice_id or body.invoice_number

        je_expense = create_journal_entry(
            tenant_id=tenant_id,
            entry_date=inv_date,
            description=f"AP: {body.vendor_name} - {body.invoice_number}",
            lines=[
                {
                    "account_code": expense_acct,
                    "account_name": "Expenses",
                    "debit": net_amount,
                    "credit": 0.0,
                    "description": f"{body.vendor_name} — {body.vat_treatment}",
                },
                {
                    "account_code": ap_acct,
                    "account_name": "Accounts Payable",
                    "debit": 0.0,
                    "credit": net_amount,
                    "description": f"AP {body.invoice_number}",
                },
            ],
            reference=je_reference,
            source="AP_INVOICE",
            company_id=company_id,
            db=db,
            auto_post=True,
        )
        # create_journal_entry commits — re-read to prove the row exists before
        # flipping invoices.je_posted. Never trust the in-memory object alone.
        db.expire_all()
        verified = _find_ap_journal(body.invoice_id, tenant_id, db) if body.invoice_id else je_expense
        if body.invoice_id and not verified:
            raise RuntimeError(
                f"JE create returned {je_expense.entry_number} but no uae_journal_entries "
                f"row found for invoice {body.invoice_id} / tenant {tenant_id}"
            )

        je_id = (verified.id if verified and hasattr(verified, "id") else None) or je_expense.id
        je_ref = (
            (verified.entry_number if verified and getattr(verified, "entry_number", None) else None)
            or je_expense.entry_number
            or je_expense.id
        )

        if (
            body.vat_treatment == "standard_rated"
            and vat_amount > 0
            and not body.blocked_input_vat
        ):
            je_vat = create_journal_entry(
                tenant_id=tenant_id,
                entry_date=inv_date,
                description=f"VAT input: {body.vendor_name} - {body.invoice_number}",
                lines=[
                    {
                        "account_code": vat_acct,
                        "account_name": "Input VAT Recoverable",
                        "debit": vat_amount,
                        "credit": 0.0,
                        "description": f"Input VAT — {body.invoice_number}",
                    },
                    {
                        "account_code": ap_acct,
                        "account_name": "Accounts Payable",
                        "debit": 0.0,
                        "credit": vat_amount,
                        "description": f"AP VAT {body.invoice_number}",
                    },
                ],
                reference=je_reference,
                source="AP_INVOICE_VAT",
                company_id=company_id,
                db=db,
                auto_post=True,
            )
            je_id_vat = je_vat.id

        # Only after verified GL row — never set the flag earlier.
        je_posted = True
        if body.invoice_id:
            from app.services.gulftax_supabase import mark_invoice_je_posted

            if not mark_invoice_je_posted(body.invoice_id, je_ref):
                logger.error(
                    "GL row exists (%s) but failed to set je_posted on invoice %s",
                    je_ref,
                    body.invoice_id,
                )
    except Exception as exc:
        gl_error = str(exc)
        logger.exception("Failed to post AP invoice to UAE GL for %s", body.invoice_number)
        try:
            db.rollback()
        except Exception:
            pass
        je_posted = False
        je_id = None
        je_ref = ""

    try:
        from app.services.audit_log_service import log_audit
        from app.services.notification_service import send_notification

        log_audit(
            db,
            workspace_id=ws_id,
            company_id=company_id or None,
            action="invoice_approved",
            entity_type="invoice",
            entity_id=body.invoice_id or purchase_invoice_id or body.invoice_number,
            details={
                "invoice_number": body.invoice_number,
                "vendor_name": body.vendor_name,
                "total": body.total_amount,
                "je_reference": je_ref or None,
                "je_posted": je_posted,
                "gl_error": gl_error,
            },
        )
        if je_posted:
            log_audit(
                db,
                workspace_id=ws_id,
                company_id=company_id or None,
                action="je_posted",
                entity_type="journal_entry",
                entity_id=je_id,
                details={"source": "AP_INVOICE", "reference": je_ref},
            )
        if body.uploaded_by_email:
            if je_posted:
                send_notification(
                    body.uploaded_by_email,
                    f"Invoice {body.invoice_number} approved",
                    (
                        f"Your invoice from {body.vendor_name} AED {body.total_amount:,.2f} was approved.\n"
                        f"JE Reference: {je_ref}\n"
                        f"Payment due: {body.due_date or post_date}"
                    ),
                )
            else:
                send_notification(
                    body.uploaded_by_email,
                    f"Invoice {body.invoice_number} approved — GL post failed",
                    (
                        f"Invoice from {body.vendor_name} was approved but was NOT posted to the GL.\n"
                        f"Error: {gl_error or 'unknown'}\n"
                        f"Retry posting from My Approvals / GL post."
                    ),
                )
        db.commit()
    except Exception:
        logger.exception("Audit/notification after AP approve failed")

    if body.invoice_id and company_id:
        try:
            from app.services.gulftax_sync_service import (
                log_sync_failure,
                sync_approved_invoice_to_gulftax,
            )

            sync_result = sync_approved_invoice_to_gulftax(
                body.invoice_id,
                company_id,
                workspace_id=ws_id,
            )
            if not sync_result.get("ok") and not sync_result.get("skipped"):
                logger.warning(
                    "Supabase GulfTax sync failed for invoice %s: %s",
                    body.invoice_id,
                    sync_result.get("error", "unknown"),
                )
                log_sync_failure(
                    invoice_id=body.invoice_id,
                    company_id=company_id,
                    error=str(sync_result.get("error", "unknown")),
                    workspace_id=ws_id,
                )
            try:
                from app.services.ar_gulftax_sync_service import sync_ap_invoice_to_rds_gulftax

                rds_result = sync_ap_invoice_to_rds_gulftax(
                    db,
                    body.invoice_id,
                    company_id,
                    workspace_id=ws_id,
                )
                if not rds_result.get("ok") and not rds_result.get("skipped"):
                    logger.warning(
                        "RDS GulfTax sync failed for invoice %s: %s",
                        body.invoice_id,
                        rds_result.get("error", "unknown"),
                    )
            except Exception:
                logger.exception("RDS GulfTax sync failed for %s", body.invoice_id)
        except Exception as sync_exc:
            logger.exception("GulfTax sync after approve failed for %s", body.invoice_number)
            try:
                from app.services.gulftax_sync_service import log_sync_failure

                log_sync_failure(
                    invoice_id=body.invoice_id,
                    company_id=company_id,
                    error=str(sync_exc),
                    workspace_id=ws_id,
                )
            except Exception:
                pass

    logger.info(
        "AP post_invoice_to_gl_and_tax: invoice=%s vendor=%s JE=%s workspace=%s je_posted=%s err=%s",
        body.invoice_number,
        body.vendor_name,
        je_ref or "—",
        ws_id,
        je_posted,
        gl_error,
    )

    if not je_posted:
        return {
            "ok": False,
            "skipped": False,
            "je_reference": None,
            "je_id": None,
            "je_id_vat": None,
            "je_posted": False,
            "post_date": post_date,
            "invoice_number": body.invoice_number,
            "vendor_name": body.vendor_name,
            "decision": body.decision,
            "risk_score": body.risk_score,
            "vat_treatment": body.vat_treatment,
            "je_lines": je_lines,
            "workspace_id": ws_id,
            "purchase_invoice_id": purchase_invoice_id,
            "vat_return_entry_id": vat_entry_id,
            "period_id": period_row.id if period_row else None,
            "error": gl_error or "journal_entry_not_created",
            "message": (
                f"Invoice {body.invoice_number} was NOT posted to UAE GL. "
                f"{gl_error or 'Journal entry create failed.'}"
            ),
        }

    return {
        "ok": True,
        "skipped": False,
        "je_reference": je_ref,
        "je_id": je_id,
        "je_id_vat": je_id_vat,
        "je_posted": True,
        "post_date": post_date,
        "invoice_number": body.invoice_number,
        "vendor_name": body.vendor_name,
        "decision": body.decision,
        "risk_score": body.risk_score,
        "vat_treatment": body.vat_treatment,
        "je_lines": je_lines,
        "workspace_id": ws_id,
        "purchase_invoice_id": purchase_invoice_id,
        "vat_return_entry_id": vat_entry_id,
        "period_id": period_row.id if period_row else None,
        "message": f"Invoice {body.invoice_number} approved. JE {je_ref} posted to UAE GL.",
    }
