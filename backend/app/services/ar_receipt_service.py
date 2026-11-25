"""AR manual cash application — Decimal AED receipts with atomic JE + invoice update."""

from __future__ import annotations

import logging
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.exceptions.period_control import PeriodControlError
from app.models.uae_accounting_full import UAEJournalEntry, UAESalesInvoice
from app.services.ar_invoice_post_service import AR_RECEIVABLE_CODE, AR_RECEIVABLE_NAME
from app.services.uae_journal_service import create_journal_entry

logger = logging.getLogger(__name__)

AR_RECEIPT_SOURCE = "AR_RECEIPT"
_TWOPLACES = Decimal("0.01")


class ReceiptValidationError(ValueError):
    """Business validation failure for record-payment (maps to HTTP 400)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def aed(value: Any) -> Decimal:
    """Quantise to AED fils (2 dp, half-up)."""
    try:
        d = Decimal(str(value if value is not None else 0))
    except Exception as exc:
        raise ReceiptValidationError("invalid_amount", "Amount is not a valid number") from exc
    return d.quantize(_TWOPLACES, rounding=ROUND_HALF_UP)


def _idempotency_key(
    *,
    invoice_id: str,
    payment_date: date,
    amount: Decimal,
    bank_account_code: str,
    reference: str | None,
    idempotency_key: str | None,
) -> str:
    if idempotency_key and str(idempotency_key).strip():
        return str(idempotency_key).strip()[:100]
    if reference and str(reference).strip():
        return str(reference).strip()[:100]
    # Deterministic retry key when caller omits reference / idempotency_key.
    return (
        f"AR-RCPT-{invoice_id}-{payment_date.isoformat()}-"
        f"{amount}-{bank_account_code}"
    )[:100]


def _find_existing_receipt(
    db: Session,
    *,
    tenant_id: str,
    company_id: str,
    key: str,
) -> UAEJournalEntry | None:
    return (
        db.query(UAEJournalEntry)
        .filter(
            UAEJournalEntry.tenant_id == tenant_id,
            UAEJournalEntry.company_id == company_id,
            UAEJournalEntry.source == AR_RECEIPT_SOURCE,
            UAEJournalEntry.reference == key,
        )
        .order_by(UAEJournalEntry.created_at.desc())
        .first()
    )


def record_ar_receipt(
    db: Session,
    *,
    tenant_id: str,
    company_id: str,
    invoice_id: str,
    amount_received: Any,
    payment_date: date,
    bank_account_code: str,
    reference: str | None = None,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    """Record a manual AR receipt atomically.

    - Locks the invoice row (FOR UPDATE) for concurrency safety.
    - Outstanding is CN-aware (uses inv.outstanding, never total − paid).
    - Rejects overpayment; outstanding never goes negative.
    - Receipt JE is DR bank / CR 1100 only (no revenue/VAT).
    - JE create+post uses commit=False; single outer commit with invoice update.
    - Idempotent on reference / idempotency_key / deterministic payload key.
    """
    if not bank_account_code or not str(bank_account_code).strip():
        raise ReceiptValidationError("bank_account_required", "bank_account_code is required")

    amount = aed(amount_received)
    if amount <= Decimal("0.00"):
        raise ReceiptValidationError("amount_must_be_positive", "amount_received must be positive")

    key = _idempotency_key(
        invoice_id=invoice_id,
        payment_date=payment_date,
        amount=amount,
        bank_account_code=str(bank_account_code).strip(),
        reference=reference,
        idempotency_key=idempotency_key,
    )

    existing = _find_existing_receipt(
        db, tenant_id=tenant_id, company_id=company_id, key=key,
    )
    if existing:
        inv = (
            db.query(UAESalesInvoice)
            .filter_by(id=invoice_id, tenant_id=tenant_id, company_id=company_id)
            .first()
        )
        return {
            "success": True,
            "idempotent_replay": True,
            "receipt_je_id": existing.id,
            "status": inv.status if inv else None,
            "outstanding_after": float(aed(inv.outstanding)) if inv else None,
        }

    # Concurrency: serialise receipts against the same invoice.
    inv = (
        db.query(UAESalesInvoice)
        .filter_by(id=invoice_id, tenant_id=tenant_id, company_id=company_id)
        .with_for_update()
        .first()
    )
    if not inv:
        raise ReceiptValidationError("invoice_not_found", "Invoice not found")

    # Re-check idempotency after lock (lost-update / double-submit race).
    existing = _find_existing_receipt(
        db, tenant_id=tenant_id, company_id=company_id, key=key,
    )
    if existing:
        return {
            "success": True,
            "idempotent_replay": True,
            "receipt_je_id": existing.id,
            "status": inv.status,
            "outstanding_after": float(aed(inv.outstanding)),
        }

    due = aed(inv.outstanding)
    if amount > due:
        raise ReceiptValidationError(
            "overpayment",
            f"amount_received {amount} exceeds outstanding {due}",
        )

    cust_name = inv.customer.name if inv.customer else "Customer"
    bank_code = str(bank_account_code).strip()
    je_lines = [
        {
            "account_code": bank_code,
            "account_name": "Bank",
            "debit": float(amount),
            "credit": 0.0,
            "description": f"Receipt {inv.invoice_number}",
        },
        {
            "account_code": AR_RECEIVABLE_CODE,
            "account_name": AR_RECEIVABLE_NAME,
            "debit": 0.0,
            "credit": float(amount),
            "description": f"AR {inv.invoice_number}",
        },
    ]

    try:
        je = create_journal_entry(
            tenant_id=tenant_id,
            entry_date=payment_date,
            description=f"Receipt: {cust_name} - {inv.invoice_number}",
            lines=je_lines,
            reference=key,
            source=AR_RECEIPT_SOURCE,
            company_id=company_id,
            db=db,
            auto_post=True,
            commit=False,
        )

        new_outstanding = aed(due - amount)
        if new_outstanding < Decimal("0.00"):
            # Invariant — should be unreachable after overpayment guard.
            raise ReceiptValidationError(
                "negative_outstanding",
                "Outstanding would become negative",
            )

        inv.paid_amount = float(aed(aed(inv.paid_amount) + amount))
        inv.outstanding = float(new_outstanding)
        inv.payment_reference = (reference or key)[:100]
        inv.paid_date = payment_date
        if new_outstanding == Decimal("0.00"):
            inv.status = "paid"
        else:
            inv.status = "partial"
        db.add(inv)
        db.commit()
    except PeriodControlError:
        db.rollback()
        raise
    except ReceiptValidationError:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        logger.exception(
            "AR receipt failed for invoice %s — rolled back JE and invoice update",
            invoice_id,
        )
        raise

    return {
        "success": True,
        "idempotent_replay": False,
        "receipt_je_id": je.id,
        "status": inv.status,
        "outstanding_after": float(aed(inv.outstanding)),
        "paid_amount": float(aed(inv.paid_amount)),
    }
