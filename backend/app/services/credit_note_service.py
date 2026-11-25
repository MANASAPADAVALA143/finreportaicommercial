"""AR credit notes — issue, GL reversal, GulfTax adjustment, void."""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Optional

from sqlalchemy.orm import Session, joinedload

from app.exceptions.period_control import PeriodControlError
from app.models.uae_accounting_full import (
    UAECreditNote,
    UAEJournalEntry,
    UAESalesInvoice,
)
from app.services.ap_company_resolver import resolve_ap_company_id
from app.services.ar_gulftax_sync_service import sync_ar_credit_note_to_gulftax
from app.services.ar_invoice_post_service import (
    AR_INCOME_CODES,
    AR_RECEIVABLE_CODE,
    AR_RECEIVABLE_NAME,
    AR_VAT_PAYABLE_CODE,
)
from app.services.uae_journal_service import create_journal_entry

logger = logging.getLogger(__name__)

CN_JE_SOURCE = "AR_CREDIT_NOTE"
CN_VOID_JE_SOURCE = "AR_CREDIT_NOTE_VOID"
_POSTED_STATUSES = frozenset({"posted", "sent", "partial", "overdue", "paid"})
_TWOPLACES = Decimal("0.01")
# Historical AR control / VAT codes that may appear on pre-Group-A sales JEs.
_AR_CONTROL_CODES = frozenset({AR_RECEIVABLE_CODE, "1200"})
_VAT_CODES = frozenset({AR_VAT_PAYABLE_CODE, "2200"})


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _aed(v: Any) -> Decimal:
    return Decimal(str(v or 0)).quantize(_TWOPLACES, rounding=ROUND_HALF_UP)


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


def _load_sales_je(db: Session, inv: UAESalesInvoice) -> UAEJournalEntry | None:
    if not inv.journal_entry_id:
        return None
    return (
        db.query(UAEJournalEntry)
        .options(joinedload(UAEJournalEntry.lines))
        .filter(UAEJournalEntry.id == inv.journal_entry_id)
        .first()
    )


def _classify_sales_je_lines(
    je: UAEJournalEntry,
) -> dict[str, Any]:
    """Identify AR / revenue / VAT credits on the original sales JE."""
    ar_lines = []
    revenue_lines = []
    vat_lines = []
    for ln in je.lines or []:
        code = (ln.account_code or "").strip()
        debit = _f(ln.debit)
        credit = _f(ln.credit)
        if debit > 0 and code in _AR_CONTROL_CODES:
            ar_lines.append(ln)
        elif credit > 0 and (code in _VAT_CODES):
            vat_lines.append(ln)
        elif credit > 0 and (code in AR_INCOME_CODES or code.startswith("6") or code == "4100"):
            # 4100 = legacy AR revenue mis-map; 6xxx = seeded Income.
            revenue_lines.append(ln)
    return {
        "ar_lines": ar_lines,
        "revenue_lines": revenue_lines,
        "vat_lines": vat_lines,
        "ar_total": round(sum(_f(l.debit) for l in ar_lines), 2),
        "revenue_total": round(sum(_f(l.credit) for l in revenue_lines), 2),
        "vat_total": round(sum(_f(l.credit) for l in vat_lines), 2),
    }


def _allocate_proportional(
    parts: list[tuple[str, str, float]],
    target: Decimal,
) -> list[tuple[str, str, float]]:
    """Allocate `target` across (code, name, weight) with remainder on last line."""
    if not parts:
        return []
    total_w = sum(Decimal(str(w)) for _, _, w in parts)
    if total_w <= 0:
        return []
    out: list[tuple[str, str, float]] = []
    allocated = Decimal("0.00")
    for i, (code, name, weight) in enumerate(parts):
        if i == len(parts) - 1:
            amt = (target - allocated).quantize(_TWOPLACES, rounding=ROUND_HALF_UP)
        else:
            amt = (target * Decimal(str(weight)) / total_w).quantize(
                _TWOPLACES, rounding=ROUND_HALF_UP
            )
            allocated += amt
        if amt > 0:
            out.append((code, name, float(amt)))
    return out


def build_credit_note_reversal_lines(
    db: Session,
    inv: UAESalesInvoice,
    *,
    gross: float,
    cn_number: str,
    cust_name: str,
) -> dict[str, Any]:
    """Build CN JE lines that reverse the original sales JE accounts proportionally.

    Fail-closed if the original sales JE cannot supply revenue (and VAT when needed).
    """
    je = _load_sales_je(db, inv)
    if not je:
        return {"ok": False, "error": "original_sales_je_not_found"}

    classified = _classify_sales_je_lines(je)
    if not classified["revenue_lines"]:
        return {
            "ok": False,
            "error": "original_sales_je_missing_revenue",
            "message": "Original sales journal has no identifiable revenue credit lines.",
        }

    gross_d = _aed(gross)
    ar_total = _aed(classified["ar_total"] or inv.total_amount)
    if ar_total <= 0:
        return {"ok": False, "error": "original_sales_je_invalid_ar"}

    # Proportional net / VAT from original JE weights (falls back to invoice split).
    orig_rev = _aed(classified["revenue_total"])
    orig_vat = _aed(classified["vat_total"])
    if orig_rev + orig_vat <= 0:
        return {"ok": False, "error": "original_sales_je_invalid_credits"}

    if orig_vat > 0:
        vat_part = (gross_d * orig_vat / (orig_rev + orig_vat)).quantize(
            _TWOPLACES, rounding=ROUND_HALF_UP
        )
        net = (gross_d - vat_part).quantize(_TWOPLACES, rounding=ROUND_HALF_UP)
    else:
        vat_part = Decimal("0.00")
        net = gross_d

    # AR control: prefer original AR code (supports historical 1200).
    ar_code = AR_RECEIVABLE_CODE
    ar_name = AR_RECEIVABLE_NAME
    if classified["ar_lines"]:
        ar_code = (classified["ar_lines"][0].account_code or AR_RECEIVABLE_CODE).strip()
        ar_name = classified["ar_lines"][0].account_name or AR_RECEIVABLE_NAME

    rev_parts = [
        (
            (ln.account_code or "").strip(),
            ln.account_name or "Revenue",
            _f(ln.credit),
        )
        for ln in classified["revenue_lines"]
    ]
    rev_alloc = _allocate_proportional(rev_parts, net)
    if not rev_alloc:
        return {"ok": False, "error": "revenue_allocation_failed"}

    je_lines: list[dict[str, Any]] = [
        {
            "account_code": ar_code,
            "account_name": ar_name,
            "debit": 0.0,
            "credit": float(gross_d),
            "description": f"CN {cn_number} — {inv.invoice_number}",
        },
    ]
    for code, name, amt in rev_alloc:
        je_lines.append({
            "account_code": code,
            "account_name": name,
            "debit": amt,
            "credit": 0.0,
            "description": f"Credit {cust_name}",
        })

    if vat_part > 0:
        if not classified["vat_lines"]:
            return {
                "ok": False,
                "error": "original_sales_je_missing_vat",
                "message": "Credit includes VAT but original sales JE has no VAT credit line.",
            }
        vat_parts = [
            (
                (ln.account_code or "").strip(),
                ln.account_name or "VAT Payable",
                _f(ln.credit),
            )
            for ln in classified["vat_lines"]
        ]
        for code, name, amt in _allocate_proportional(vat_parts, vat_part):
            je_lines.append({
                "account_code": code,
                "account_name": name,
                "debit": amt,
                "credit": 0.0,
                "description": f"Output VAT reversal {cn_number}",
            })

    # Balance check
    total_dr = round(sum(_f(l["debit"]) for l in je_lines), 2)
    total_cr = round(sum(_f(l["credit"]) for l in je_lines), 2)
    if abs(total_dr - total_cr) > 0.01:
        return {
            "ok": False,
            "error": "cn_je_imbalance",
            "message": f"CN JE does not balance: Dr {total_dr} ≠ Cr {total_cr}",
        }

    return {
        "ok": True,
        "lines": je_lines,
        "net": float(net),
        "vat_part": float(vat_part),
        "ar_code": ar_code,
        "revenue_codes": [c for c, _, _ in rev_alloc],
    }


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
    cust_name = inv.customer.name if inv.customer else "Customer"

    reversal = build_credit_note_reversal_lines(
        db, inv, gross=gross, cn_number=cn_number, cust_name=cust_name,
    )
    if not reversal.get("ok"):
        return {
            "ok": False,
            "error": reversal.get("error", "cn_reversal_failed"),
            "message": reversal.get("message"),
        }
    net = float(reversal["net"])
    vat_part = float(reversal["vat_part"])
    je_lines = reversal["lines"]

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
    cust_name = inv.customer.name if inv.customer else "Customer"
    void_date = date.today()
    cid = cn.company_id or inv.company_id

    # Prefer reversing the original CN JE lines (accounts already match sales JE).
    cn_je = (
        db.query(UAEJournalEntry)
        .options(joinedload(UAEJournalEntry.lines))
        .filter(
            UAEJournalEntry.tenant_id == tenant_id,
            UAEJournalEntry.reference == cn.id,
            UAEJournalEntry.source == CN_JE_SOURCE,
        )
        .order_by(UAEJournalEntry.created_at.desc())
        .first()
    )
    if cn_je and cn_je.lines:
        je_lines = [
            {
                "account_code": (ln.account_code or "").strip(),
                "account_name": ln.account_name or "",
                "debit": _f(ln.credit),
                "credit": _f(ln.debit),
                "description": f"Void CN {cn.credit_note_number}",
            }
            for ln in cn_je.lines
        ]
        # Reconstruct net/vat for GulfTax from swapped lines.
        net = round(sum(_f(l["credit"]) for l in je_lines
                        if (l["account_code"] in AR_INCOME_CODES
                            or (l["account_code"] or "").startswith("6")
                            or l["account_code"] == "4100")), 2)
        vat_part = round(sum(_f(l["credit"]) for l in je_lines
                             if l["account_code"] in _VAT_CODES), 2)
        if net <= 0 and vat_part <= 0:
            net, vat_part = _split_gross(gross, inv)
    else:
        # Fail closed: rebuild from original sales JE rather than hardcoded CoA.
        reversal = build_credit_note_reversal_lines(
            db, inv, gross=gross, cn_number=cn.credit_note_number, cust_name=cust_name,
        )
        if not reversal.get("ok"):
            return {
                "ok": False,
                "error": reversal.get("error", "cn_void_reversal_failed"),
                "message": reversal.get("message"),
            }
        net = float(reversal["net"])
        vat_part = float(reversal["vat_part"])
        # Swap the issue lines to void.
        je_lines = [
            {
                "account_code": ln["account_code"],
                "account_name": ln["account_name"],
                "debit": _f(ln["credit"]),
                "credit": _f(ln["debit"]),
                "description": f"Void CN {cn.credit_note_number}",
            }
            for ln in reversal["lines"]
        ]

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
