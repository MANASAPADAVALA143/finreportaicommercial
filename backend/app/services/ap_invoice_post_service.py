"""Shared AP approve → UAE GL journal + GulfTax sync (idempotent)."""

from __future__ import annotations

import logging
from datetime import date
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.services.ap_company_resolver import resolve_ap_company_id

logger = logging.getLogger(__name__)

# Canonical UAE Accounting CoA (matches uae_coa_service.py)
AP_EXPENSE_DEFAULT = "7140"
AP_EXPENSE_NAME = "Professional Fees"
AP_PAYABLE_CODE = "3001"
AP_PAYABLE_NAME = "Trade Payables"
AP_VAT_INPUT_CODE = "1110"
AP_VAT_INPUT_NAME = "VAT Recoverable (Input Tax)"

# Legacy AP InvoiceFlow gl_accounts codes → UAE Accounting uae_accounts
AP_GL_CODE_ALIASES: dict[str, str] = {
    "6100": "7140",
    "6200": "7110",
    "6300": "7120",
    "6400": "7130",
    "6500": "7150",
    "6600": "7141",
    "7000": "7140",
    "7100": "7170",
    "5000": "7001",
    "1810": "1110",
    "2100": "3001",
    "2200": "3010",
    "7140": "7140",
    "3001": "3001",
    "1110": "1110",
}


def map_ap_gl_code(raw: str | None) -> str:
    """Map legacy AP gl_codes to canonical UAE Accounting account codes."""
    code = (raw or AP_EXPENSE_DEFAULT).strip() or AP_EXPENSE_DEFAULT
    return AP_GL_CODE_ALIASES.get(code, code)


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
    gl_code: str = AP_EXPENSE_DEFAULT
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
    raw_gl = str(inv.get("gl_code") or inv.get("gl_account") or AP_EXPENSE_DEFAULT)
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
        gl_code=map_ap_gl_code(raw_gl),
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


def _slugify(name: str) -> str:
    import re

    s = re.sub(r"[^a-z0-9]+", "-", (name or "company").lower()).strip("-")
    return (s or "company")[:120]


def _ensure_ap_company_for_profile(
    db: Session,
    tenant_id: str,
    profile,
) -> str:
    """Ensure an ap_companies row exists for a UAE profile; prefer same UUID as profile.id."""
    import uuid as _uuid

    from app.models.client_data import ApCompany
    from app.services.ap_company_resolver import list_ap_companies

    # 1) Same id as profile (UI active_company_id is usually the profile id)
    existing = db.get(ApCompany, profile.id)
    if existing:
        if existing.tenant_id != tenant_id:
            existing.tenant_id = tenant_id
            db.add(existing)
            db.commit()
        return existing.id

    # 2) Name match against existing ap_companies for tenant
    target = (profile.company_name or "").strip().lower()
    if target:
        for row in list_ap_companies(db, tenant_id):
            if (row.name or "").strip().lower() == target:
                return row.id

    # 3) Insert using profile.id so Journal Entries company filter matches
    slug = _slugify(profile.company_name or "company")
    # Avoid unique (tenant_id, slug) collisions
    clash = (
        db.query(ApCompany)
        .filter(ApCompany.tenant_id == tenant_id, ApCompany.slug == slug)
        .first()
    )
    if clash:
        slug = f"{slug}-{str(_uuid.uuid4())[:8]}"

    row = ApCompany(
        id=profile.id,
        tenant_id=tenant_id,
        name=(profile.company_name or "Default").strip() or "Default",
        slug=slug,
        market="uae",
        accounting_standard=getattr(profile, "reporting_standard", None) or "IFRS",
    )
    db.add(row)
    db.commit()
    logger.info(
        "Created ap_companies row id=%s name=%s for tenant=%s from uae_company_profiles",
        row.id,
        row.name,
        tenant_id,
    )
    return row.id


def _ensure_default_ap_company(db: Session, tenant_id: str, name: str = "Default") -> str:
    import uuid as _uuid

    from app.models.client_data import ApCompany
    from app.services.ap_company_resolver import list_ap_companies

    rows = list_ap_companies(db, tenant_id)
    if rows:
        return rows[0].id

    row = ApCompany(
        id=str(_uuid.uuid4()),
        tenant_id=tenant_id,
        name=(name or "Default").strip() or "Default",
        slug=_slugify(name or "default"),
        market="uae",
        accounting_standard="IFRS",
    )
    db.add(row)
    db.commit()
    logger.info("Created fallback ap_companies row id=%s for tenant=%s", row.id, tenant_id)
    return row.id


def _resolve_company_id_for_je(
    db: Session,
    tenant_id: str,
    raw_company_id: str | None,
    *,
    invoice_ref: str = "",
) -> str:
    """Resolve ap_companies.id for JE rows — never returns None."""
    from fastapi import HTTPException

    from app.models.company_setup import UaeCompanyProfile
    from app.services.ap_company_resolver import list_ap_companies

    raw = (raw_company_id or "").strip() or None

    # 1) Existing resolver (validates ap_companies / maps profile → ap_company)
    try:
        resolved = resolve_ap_company_id(db, tenant_id, raw)
        if resolved:
            if raw and resolved != raw:
                logger.warning(
                    "company_id remapped for JE: invoice=%s raw=%s resolved=%s",
                    invoice_ref,
                    raw,
                    resolved,
                )
            return resolved
    except HTTPException as exc:
        logger.warning(
            "ap_companies resolve rejected company_id=%s tenant=%s invoice=%s: %s — falling back",
            raw_company_id,
            tenant_id,
            invoice_ref,
            getattr(exc, "detail", exc),
        )
    except Exception:
        logger.warning(
            "ap_companies resolve failed for company_id=%s tenant=%s invoice=%s — falling back",
            raw_company_id,
            tenant_id,
            invoice_ref,
            exc_info=True,
        )

    # 2) uae_company_profiles fallback
    profiles = (
        db.query(UaeCompanyProfile)
        .filter(UaeCompanyProfile.workspace_id == tenant_id)
        .order_by(UaeCompanyProfile.created_at.asc())
        .all()
    )

    if raw:
        by_id = next((p for p in profiles if p.id == raw), None)
        if by_id:
            return _ensure_ap_company_for_profile(db, tenant_id, by_id)

    if len(profiles) == 1:
        return _ensure_ap_company_for_profile(db, tenant_id, profiles[0])

    if profiles and raw:
        # raw might be a display name
        target = raw.strip().lower()
        for p in profiles:
            if (p.company_name or "").strip().lower() == target:
                return _ensure_ap_company_for_profile(db, tenant_id, p)

    if profiles:
        # Prefer name match against any existing ap_companies, else first profile
        ap_rows = list_ap_companies(db, tenant_id)
        for p in profiles:
            pname = (p.company_name or "").strip().lower()
            for ap in ap_rows:
                if (ap.name or "").strip().lower() == pname:
                    return ap.id
        return _ensure_ap_company_for_profile(db, tenant_id, profiles[0])

    # 3) Last resort — any ap_companies row or create Default
    name = "Default"
    return _ensure_default_ap_company(db, tenant_id, name=name)


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


def _build_ap_je_lines(
    *,
    expense_acct: str,
    ap_acct: str,
    vat_acct: str,
    expense_debit: float,
    vat_amount: float,
    total_amount: float,
    recoverable_vat: bool,
    vendor_name: str,
    invoice_number: str,
    vat_treatment: str,
) -> list[dict[str, Any]]:
    """Single combined JE: Dr expense (+ input VAT) / Cr trade payables."""
    lines: list[dict[str, Any]] = [
        {
            "account_code": expense_acct,
            "account_name": AP_EXPENSE_NAME,
            "debit": expense_debit,
            "credit": 0.0,
            "description": f"{vendor_name} — {vat_treatment}",
        },
    ]
    if recoverable_vat:
        lines.append({
            "account_code": vat_acct,
            "account_name": AP_VAT_INPUT_NAME,
            "debit": vat_amount,
            "credit": 0.0,
            "description": f"Input VAT — {invoice_number}",
        })
    lines.append({
        "account_code": ap_acct,
        "account_name": AP_PAYABLE_NAME,
        "debit": 0.0,
        "credit": total_amount,
        "description": f"AP {invoice_number}",
    })
    return lines


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

    invoice_ref = body.invoice_id or body.invoice_number

    if body.invoice_id:
        prior = _existing_gl_post(body.invoice_id, tenant_id, db)
        if prior:
            ws_id = body.workspace_id or tenant_id
            company_id = _resolve_company_id_for_je(
                db, tenant_id, body.company_id or None, invoice_ref=invoice_ref,
            )
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
    company_id = _resolve_company_id_for_je(
        db, tenant_id, body.company_id or None, invoice_ref=invoice_ref,
    )

    recoverable_vat = (
        body.vat_treatment == "standard_rated"
        and vat_amount > 0
        and not body.blocked_input_vat
    )
    expense_debit = net_amount if recoverable_vat else round(body.total_amount, 2)

    expense_acct = map_ap_gl_code(body.gl_code)
    ap_acct = AP_PAYABLE_CODE
    vat_acct = AP_VAT_INPUT_CODE

    je_lines = _build_ap_je_lines(
        expense_acct=expense_acct,
        ap_acct=ap_acct,
        vat_acct=vat_acct,
        expense_debit=expense_debit,
        vat_amount=vat_amount,
        total_amount=body.total_amount,
        recoverable_vat=recoverable_vat,
        vendor_name=body.vendor_name,
        invoice_number=body.invoice_number,
        vat_treatment=body.vat_treatment,
    )

    purchase_invoice_id = None
    try:
        import uuid as _uuid
        from datetime import date as _date

        from sqlalchemy import text

        from app.models.uae_ap import UAEPurchaseInvoice, UAEPurchaseInvoiceLine, UAEVendor

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
                subtotal=expense_debit,
                vat_amount=vat_amount if recoverable_vat else 0.0,
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
                    unit_price=expense_debit,
                    line_total=expense_debit,
                    vat_rate=5,
                    vat_amount=vat_amount if recoverable_vat else 0.0,
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
            net_amount=expense_debit,
            vat_amount=vat_amount if recoverable_vat else 0.0,
            vat_treatment=body.vat_treatment,
            blocked_input_vat=body.blocked_input_vat,
        )
        if entry:
            vat_entry_id = entry.get("id")
    except Exception:
        logger.exception("vat_return_entries insert failed for %s", body.invoice_number)

    je_id: str | None = None
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

        je_reference = body.invoice_id or body.invoice_number

        je = create_journal_entry(
            tenant_id=tenant_id,
            entry_date=inv_date,
            description=f"AP: {body.vendor_name} - {body.invoice_number}",
            lines=je_lines,
            reference=je_reference,
            source="AP_INVOICE",
            company_id=company_id,
            db=db,
            auto_post=True,
        )
        db.expire_all()
        verified = _find_ap_journal(body.invoice_id, tenant_id, db) if body.invoice_id else je
        if body.invoice_id and not verified:
            raise RuntimeError(
                f"JE create returned {je.entry_number} but no uae_journal_entries "
                f"row found for invoice {body.invoice_id} / tenant {tenant_id}"
            )

        je_id = (verified.id if verified and hasattr(verified, "id") else None) or je.id
        je_ref = (
            (verified.entry_number if verified and getattr(verified, "entry_number", None) else None)
            or je.entry_number
            or je.id
        )

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
