"""Shared AR sales invoice → UAE GL journal + GulfTax output VAT (idempotent).

Canonical seeded UAE CoA (new posts):
  DR 1100 Trade Receivables     = total inc VAT
  CR revenue (classification)   = subtotal ex VAT
  CR 3010 VAT Payable           = VAT amount when applicable

Revenue is fail-closed / classification-aware (no silent 6001 default when
classification is missing). Historical JEs on 1200/4100/2200 are left unchanged.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session, joinedload

from app.exceptions.period_control import PeriodControlError
from app.models.uae_accounting_full import UAEAccount, UAESalesInvoice
from app.services.ap_company_resolver import resolve_ap_company_id
from app.services.ar_gulftax_sync_service import sync_ar_invoice_to_gulftax
from app.services.uae_journal_service import create_journal_entry

logger = logging.getLogger(__name__)

# Canonical UAE AR control / VAT accounts (seeded CoA)
AR_RECEIVABLE_CODE = "1100"
AR_RECEIVABLE_NAME = "Trade Receivables"
AR_VAT_PAYABLE_CODE = "3010"
AR_VAT_PAYABLE_NAME = "VAT Payable (Output Tax)"

# Classification-aware revenue codes (seeded Income accounts)
AR_REVENUE_STANDARD = ("6001", "Sales - Standard Rated (5% VAT)")
AR_REVENUE_ZERO = ("6002", "Sales - Zero Rated")
AR_REVENUE_EXEMPT = ("6003", "Sales - Exempt")
AR_REVENUE_SERVICE = ("6010", "Service Revenue")
AR_INCOME_CODES = frozenset({
    AR_REVENUE_STANDARD[0],
    AR_REVENUE_ZERO[0],
    AR_REVENUE_EXEMPT[0],
    AR_REVENUE_SERVICE[0],
})

# Legacy aliases retained for importers that still expect these names.
# New posts must call resolve_ar_posting_accounts() — do not hardcode revenue.
AR_REVENUE_CODE = AR_REVENUE_STANDARD[0]
AR_REVENUE_NAME = AR_REVENUE_STANDARD[1]

AR_JE_SOURCE = "ar_sales_invoice"
AR_JE_SOURCES = ("ar_sales_invoice", "AR_INVOICE", "ar_invoice")
AR_GULFTAX_SOURCE = "ar_approve_and_post"
POSTABLE_STATUSES = ("draft", "pending")

_STANDARD_TREATMENTS = frozenset({
    "standard_rated", "standard", "standard-rated", "taxable",
})
_ZERO_TREATMENTS = frozenset({
    "zero_rated", "zero-rated", "zero", "zero rated",
})
_EXEMPT_TREATMENTS = frozenset({
    "exempt", "out_of_scope", "out-of-scope", "oos",
})
_STANDARD_SUPPLY = frozenset({"standard", "standard_rated", "standard-rated", "taxable"})
_ZERO_SUPPLY = frozenset({"zero-rated", "zero_rated", "zero"})
_EXEMPT_SUPPLY = frozenset({"exempt", "out_of_scope", "out-of-scope"})


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _norm_token(v: Any) -> str:
    return str(v or "").strip().lower().replace(" ", "_")


def _treatment_from_vat_treatment(raw: Any) -> str | None:
    t = _norm_token(raw)
    if not t:
        return None
    if t in _STANDARD_TREATMENTS:
        return "standard"
    if t in _ZERO_TREATMENTS:
        return "zero"
    if t in _EXEMPT_TREATMENTS:
        return "exempt"
    if t in ("reverse_charge", "reverse-charge"):
        return "unsupported"
    return "unknown"


def _treatment_from_supply_type(raw: Any) -> str | None:
    t = _norm_token(raw).replace("_", "-") if raw else ""
    t2 = _norm_token(raw)
    if not t and not t2:
        return None
    if t2 in _STANDARD_SUPPLY or t in ("standard", "standard-rated"):
        return "standard"
    if t2 in _ZERO_SUPPLY or t in ("zero-rated", "zero"):
        return "zero"
    if t2 in _EXEMPT_SUPPLY or t in ("exempt", "out-of-scope"):
        return "exempt"
    return "unknown"


def _line_income_accounts(
    db: Session,
    inv: UAESalesInvoice,
    *,
    tenant_id: str,
    company_id: str | None,
) -> list[UAEAccount]:
    """Resolve invoice-line account_id values that are active Income accounts."""
    ids = [ln.account_id for ln in (inv.lines or []) if getattr(ln, "account_id", None)]
    if not ids:
        return []
    q = db.query(UAEAccount).filter(
        UAEAccount.id.in_(ids),
        UAEAccount.tenant_id == tenant_id,
        UAEAccount.is_active.is_(True),
    )
    if company_id:
        from sqlalchemy import or_

        q = q.filter(or_(UAEAccount.company_id == company_id, UAEAccount.company_id.is_(None)))
    accounts = q.all()
    income: list[UAEAccount] = []
    for acct in accounts:
        atype = (acct.account_type or "").strip().lower()
        if atype == "income" and acct.code:
            income.append(acct)
    return income


def resolve_ar_posting_accounts(
    db: Session,
    inv: UAESalesInvoice,
    *,
    tenant_id: str,
    company_id: str | None = None,
) -> dict[str, Any]:
    """Fail-closed CoA resolver for AR sales posting.

    Sequence: vat_treatment → supply_type → valid Income line account_id → reject.
    VAT and revenue classification must agree (zero/exempt never create output VAT).
    """
    vat_amount = _f(inv.vat_amount)
    treatment = _treatment_from_vat_treatment(getattr(inv, "vat_treatment", None))
    source = "vat_treatment"
    if treatment is None:
        treatment = _treatment_from_supply_type(getattr(inv, "supply_type", None))
        source = "supply_type"

    income_accts = _line_income_accounts(
        db, inv, tenant_id=tenant_id, company_id=company_id,
    )
    income_codes = sorted({(a.code or "").strip() for a in income_accts if a.code})

    if treatment in (None, "unknown", "unsupported"):
        if len(income_codes) == 1 and income_codes[0] in AR_INCOME_CODES:
            code = income_codes[0]
            if code == AR_REVENUE_ZERO[0]:
                treatment = "zero"
            elif code == AR_REVENUE_EXEMPT[0]:
                treatment = "exempt"
            else:
                treatment = "standard"
            source = "line_account_id"
        else:
            return {
                "ok": False,
                "error": "ambiguous_revenue_classification",
                "error_type": "validation",
                "message": (
                    "Cannot resolve revenue account: set vat_treatment or supply_type, "
                    "or a single valid Income line account_id (6001/6002/6003/6010)."
                ),
            }

    if treatment == "unsupported":
        return {
            "ok": False,
            "error": "unsupported_vat_treatment",
            "error_type": "validation",
            "message": "AR sales posting does not support reverse_charge classification.",
        }

    # VAT consistency with classification
    if treatment in ("zero", "exempt") and vat_amount > 0.01:
        return {
            "ok": False,
            "error": "vat_inconsistent_with_classification",
            "error_type": "validation",
            "message": (
                f"Classification '{treatment}' must not carry output VAT "
                f"(vat_amount={vat_amount})."
            ),
        }

    include_vat = treatment == "standard" and vat_amount > 0.01

    # Resolve revenue code
    if treatment == "zero":
        allowed = {AR_REVENUE_ZERO[0]}
        default = AR_REVENUE_ZERO
    elif treatment == "exempt":
        allowed = {AR_REVENUE_EXEMPT[0]}
        default = AR_REVENUE_EXEMPT
    else:
        allowed = {AR_REVENUE_STANDARD[0], AR_REVENUE_SERVICE[0]}
        default = AR_REVENUE_STANDARD

    if income_codes:
        matched = [c for c in income_codes if c in allowed]
        if len(set(income_codes)) > 1 and not matched:
            return {
                "ok": False,
                "error": "inconsistent_line_revenue_accounts",
                "error_type": "validation",
                "message": (
                    f"Invoice line Income accounts {income_codes} are inconsistent "
                    f"with classification '{treatment}' (allowed {sorted(allowed)})."
                ),
            }
        if income_codes and not any(c in allowed for c in income_codes):
            return {
                "ok": False,
                "error": "inconsistent_line_revenue_accounts",
                "error_type": "validation",
                "message": (
                    f"Invoice line Income accounts {income_codes} conflict with "
                    f"classification '{treatment}'."
                ),
            }
        if matched:
            # Prefer explicit service account when present under standard treatment.
            if AR_REVENUE_SERVICE[0] in matched and treatment == "standard":
                rev_code, rev_name = AR_REVENUE_SERVICE
            else:
                code = matched[0]
                name_map = {
                    AR_REVENUE_STANDARD[0]: AR_REVENUE_STANDARD[1],
                    AR_REVENUE_ZERO[0]: AR_REVENUE_ZERO[1],
                    AR_REVENUE_EXEMPT[0]: AR_REVENUE_EXEMPT[1],
                    AR_REVENUE_SERVICE[0]: AR_REVENUE_SERVICE[1],
                }
                rev_code, rev_name = code, name_map.get(code, code)
            if source != "line_account_id":
                source = f"{source}+line_account_id"
        else:
            rev_code, rev_name = default
    else:
        # Classification was resolved from vat_treatment/supply_type — map explicitly.
        rev_code, rev_name = default

    result: dict[str, Any] = {
        "ok": True,
        "treatment": treatment,
        "source": source,
        "ar_code": AR_RECEIVABLE_CODE,
        "ar_name": AR_RECEIVABLE_NAME,
        "revenue_code": rev_code,
        "revenue_name": rev_name,
        "include_vat": include_vat,
        "vat_code": AR_VAT_PAYABLE_CODE if include_vat else None,
        "vat_name": AR_VAT_PAYABLE_NAME if include_vat else None,
    }
    return result


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

    accounts = resolve_ar_posting_accounts(
        db, inv, tenant_id=tenant_id, company_id=cid,
    )
    if not accounts.get("ok"):
        return {
            "ok": False,
            "success": False,
            "je_posted": False,
            "error": accounts.get("error", "ambiguous_revenue_classification"),
            "error_type": accounts.get("error_type", "validation"),
            "message": accounts.get("message"),
        }

    cust_name = inv.customer.name if inv.customer else "Customer"
    inv_date = inv.invoice_date
    if not inv_date:
        from datetime import date as date_cls

        inv_date = date_cls.today()

    poster = (approved_by or "").strip() or "system"
    je_lines = [
        {
            "account_code": accounts["ar_code"],
            "account_name": accounts["ar_name"],
            "debit": total,
            "credit": 0.0,
            "description": f"AR {inv.invoice_number}",
        },
        {
            "account_code": accounts["revenue_code"],
            "account_name": accounts["revenue_name"],
            "debit": 0.0,
            "credit": subtotal,
            "description": f"Sales {cust_name}",
        },
    ]
    if accounts.get("include_vat") and vat_amount > 0:
        je_lines.append({
            "account_code": accounts["vat_code"],
            "account_name": accounts["vat_name"],
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
