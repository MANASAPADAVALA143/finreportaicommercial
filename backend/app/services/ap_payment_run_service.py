"""AP Payment Run Center — select, approve, execute, bank file."""

from __future__ import annotations

import csv
import io
import logging
import uuid
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.core.database import engine
from app.models.ap_payment_run import ApPaymentRun, ApPaymentRunItem
from app.models.client_data import ApInvoice, ApVendor
from app.services.uae_journal_service import create_journal_entry

logger = logging.getLogger(__name__)

AP_PAYABLE_CODE = "2100"
AP_PAYABLE_NAME = "Accounts Payable"
CASH_BANK_CODE = "1000"
CASH_BANK_NAME = "Cash/Bank"
PAYMENT_JE_SOURCE = "ap_payment_run"

VALID_STATUSES = {
    "draft",
    "pending_approval",
    "approved",
    "executed",
    "rejected",
    "cancelled",
}


def ensure_payment_runs_table() -> None:
    ApPaymentRun.__table__.create(bind=engine, checkfirst=True)
    ApPaymentRunItem.__table__.create(bind=engine, checkfirst=True)


def _property_id(inv: ApInvoice) -> str | None:
    ex = _extra(inv)
    raw = ex.get("property_id") or ex.get("propertyId") or ex.get("property")
    if raw is None:
        return None
    return str(raw).strip() or None


def _property_label(inv: ApInvoice) -> str | None:
    ex = _extra(inv)
    for key in ("property_name", "property", "property_label", "building"):
        if ex.get(key):
            return str(ex[key]).strip()
    pid = _property_id(inv)
    return pid


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _extra(inv: ApInvoice) -> dict[str, Any]:
    ex = inv.extra if isinstance(inv.extra, dict) else {}
    return dict(ex or {})


def _payment_status(inv: ApInvoice) -> str:
    ex = _extra(inv)
    ps = str(ex.get("payment_status") or "").strip().lower()
    if ps:
        return ps
    if str(inv.status or "").strip().lower() == "paid":
        return "paid"
    return "unpaid"


def _is_approved(inv: ApInvoice) -> bool:
    return str(inv.status or "").strip().lower() in {"approved", "posted"}


def _is_unpaid(inv: ApInvoice) -> bool:
    if str(inv.status or "").strip().lower() == "paid":
        return False
    return _payment_status(inv) not in {"paid", "cancelled", "canceled"}


def _vat_amount(inv: ApInvoice) -> float:
    if inv.vat_amount is not None:
        return _f(inv.vat_amount)
    return _f(inv.tax_amount)


def _net_amount(inv: ApInvoice) -> float:
    gross = _f(inv.total_amount)
    vat = _vat_amount(inv)
    if inv.subtotal_amount is not None and _f(inv.subtotal_amount) > 0:
        return _f(inv.subtotal_amount)
    return max(0.0, gross - vat)


def _category(inv: ApInvoice) -> str:
    ex = _extra(inv)
    return str(ex.get("category") or inv.vat_treatment or "Uncategorized")


def _discount_available(inv: ApInvoice) -> float | None:
    ex = _extra(inv)
    for key in ("early_payment_discount", "discount_available", "discount_amount"):
        if key in ex and ex[key] is not None:
            return _f(ex[key])
    return None


def _days_overdue(due: date | None, as_of: date | None = None) -> int:
    if not due:
        return 0
    today = as_of or date.today()
    return max(0, (today - due).days)


def mark_invoice_paid(inv: ApInvoice, *, run_id: str, run_number: str) -> None:
    """Mark invoice paid without touching AP approve-and-post paths."""
    ex = _extra(inv)
    ex["payment_status"] = "paid"
    ex["payment_run_id"] = run_id
    ex["payment_run_number"] = run_number
    ex["paid_at"] = datetime.utcnow().isoformat()
    inv.extra = ex
    inv.status = "Paid"
    # If RDS ever gains a top-level payment_status column, set it too.
    if hasattr(inv, "payment_status"):
        try:
            setattr(inv, "payment_status", "paid")
        except Exception:
            pass


def vendor_iban_map(
    db: Session,
    *,
    workspace_id: str,
    company_id: str,
    vendor_names: list[str],
) -> dict[str, str | None]:
    names = {n.strip().lower() for n in vendor_names if n}
    if not names:
        return {}
    rows = (
        db.query(ApVendor)
        .filter(ApVendor.tenant_id == workspace_id, ApVendor.company_id == company_id)
        .all()
    )
    out: dict[str, str | None] = {}
    for v in rows:
        key = (v.name or "").strip().lower()
        if key not in names:
            continue
        ex = v.extra if isinstance(v.extra, dict) else {}
        iban = ex.get("iban") or ex.get("vendor_iban") or ex.get("bank_iban") or None
        out[key] = str(iban).strip() if iban else None
    return out


def list_eligible_invoices(
    db: Session,
    *,
    workspace_id: str,
    company_id: str,
    due_from: date | None = None,
    due_to: date | None = None,
    vendor_search: str | None = None,
    amount_min: float | None = None,
    amount_max: float | None = None,
    category: str | None = None,
    property_id: str | None = None,
) -> list[dict[str, Any]]:
    q = db.query(ApInvoice).filter(
        ApInvoice.tenant_id == workspace_id,
        ApInvoice.company_id == company_id,
    )
    if due_from:
        q = q.filter(ApInvoice.due_date >= due_from)
    if due_to:
        q = q.filter(ApInvoice.due_date <= due_to)
    if vendor_search:
        q = q.filter(ApInvoice.vendor_name.ilike(f"%{vendor_search.strip()}%"))
    if amount_min is not None:
        q = q.filter(ApInvoice.total_amount >= amount_min)
    if amount_max is not None:
        q = q.filter(ApInvoice.total_amount <= amount_max)

    rows = q.order_by(ApInvoice.due_date.asc()).all()
    out: list[dict[str, Any]] = []
    today = date.today()
    cat_filter = (category or "").strip().lower()
    prop_filter = (property_id or "").strip().lower()
    for inv in rows:
        if not _is_approved(inv) or not _is_unpaid(inv):
            continue
        cat = _category(inv)
        if cat_filter and cat_filter not in {"all", ""} and cat.lower() != cat_filter:
            continue
        prop_id = _property_id(inv)
        prop_label = _property_label(inv) or ""
        if prop_filter and prop_filter not in {"all", ""}:
            hay = f"{prop_id or ''} {prop_label}".lower()
            if prop_filter not in hay:
                continue
        gross = _f(inv.total_amount)
        vat = _vat_amount(inv)
        out.append(
            {
                "id": inv.id,
                "invoice_number": inv.invoice_number,
                "vendor_name": inv.vendor_name,
                "due_date": inv.due_date.isoformat() if inv.due_date else None,
                "invoice_date": inv.invoice_date.isoformat() if inv.invoice_date else None,
                "amount": gross,
                "net_amount": _net_amount(inv),
                "vat_amount": vat,
                "days_overdue": _days_overdue(inv.due_date, today),
                "discount_available": _discount_available(inv),
                "category": cat,
                "property_id": prop_id,
                "property_name": prop_label or None,
                "currency": inv.currency or "AED",
                "status": inv.status,
                "payment_status": _payment_status(inv),
            }
        )
    return out


def next_run_number(db: Session, workspace_id: str, company_id: str) -> str:
    year = datetime.utcnow().year
    prefix = f"PR-{year}-"
    count = (
        db.query(ApPaymentRun)
        .filter(
            ApPaymentRun.workspace_id == workspace_id,
            ApPaymentRun.company_id == company_id,
            ApPaymentRun.run_number.like(f"{prefix}%"),
        )
        .count()
    )
    return f"{prefix}{count + 1:03d}"


def create_payment_run(
    db: Session,
    *,
    workspace_id: str,
    company_id: str,
    invoice_ids: list[str],
    created_by: str | None,
    payment_date: date | None = None,
    bank_account: str | None = None,
    notes: str | None = None,
) -> ApPaymentRun:
    ensure_payment_runs_table()
    ids = [str(i).strip() for i in invoice_ids if str(i).strip()]
    if not ids:
        raise ValueError("invoice_ids required")

    invoices = (
        db.query(ApInvoice)
        .filter(
            ApInvoice.tenant_id == workspace_id,
            ApInvoice.company_id == company_id,
            ApInvoice.id.in_(ids),
        )
        .all()
    )
    by_id = {i.id: i for i in invoices}
    missing = [i for i in ids if i not in by_id]
    if missing:
        raise ValueError(f"Invoices not found: {', '.join(missing[:5])}")

    selected: list[ApInvoice] = []
    for iid in ids:
        inv = by_id[iid]
        if not _is_approved(inv) or not _is_unpaid(inv):
            raise ValueError(
                f"Invoice {inv.invoice_number} is not eligible (must be approved and unpaid)"
            )
        selected.append(inv)

    total_gross = sum(_f(i.total_amount) for i in selected)
    total_vat = sum(_vat_amount(i) for i in selected)
    total_net = sum(_net_amount(i) for i in selected)

    run = ApPaymentRun(
        id=str(uuid.uuid4()),
        run_number=next_run_number(db, workspace_id, company_id),
        workspace_id=workspace_id,
        company_id=company_id,
        created_by=created_by,
        created_at=datetime.utcnow(),
        status="draft",
        payment_date=payment_date or date.today(),
        bank_account=(bank_account or "").strip() or None,
        notes=(notes or "").strip() or None,
        total_invoices=len(selected),
        total_net_aed=round(total_net, 2),
        total_vat_aed=round(total_vat, 2),
        total_gross_aed=round(total_gross, 2),
        invoice_ids=[i.id for i in selected],
        extra={},
    )
    db.add(run)
    db.flush()
    for inv in selected:
        db.add(
            ApPaymentRunItem(
                id=str(uuid.uuid4()),
                payment_run_id=run.id,
                invoice_id=inv.id,
                vendor_name=inv.vendor_name,
                amount_aed=round(_f(inv.total_amount), 2),
                property_id=_property_id(inv),
                created_at=datetime.utcnow(),
            )
        )
    db.commit()
    db.refresh(run)
    return run


def get_run(
    db: Session,
    *,
    run_id: str,
    workspace_id: str,
    company_id: str | None = None,
) -> ApPaymentRun | None:
    ensure_payment_runs_table()
    q = db.query(ApPaymentRun).filter(
        ApPaymentRun.id == run_id,
        ApPaymentRun.workspace_id == workspace_id,
    )
    if company_id:
        q = q.filter(ApPaymentRun.company_id == company_id)
    return q.first()


def list_runs(
    db: Session,
    *,
    workspace_id: str,
    company_id: str,
    status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[ApPaymentRun]:
    ensure_payment_runs_table()
    q = db.query(ApPaymentRun).filter(
        ApPaymentRun.workspace_id == workspace_id,
        ApPaymentRun.company_id == company_id,
    )
    if status and status.lower() != "all":
        q = q.filter(ApPaymentRun.status == status.lower())
    if date_from:
        q = q.filter(ApPaymentRun.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        q = q.filter(ApPaymentRun.created_at <= datetime.combine(date_to, datetime.max.time()))
    return q.order_by(ApPaymentRun.created_at.desc()).all()


def invoices_for_run(db: Session, run: ApPaymentRun) -> list[ApInvoice]:
    ids = list(run.invoice_ids or [])
    if not ids:
        return []
    rows = (
        db.query(ApInvoice)
        .filter(
            ApInvoice.tenant_id == run.workspace_id,
            ApInvoice.company_id == run.company_id,
            ApInvoice.id.in_(ids),
        )
        .all()
    )
    by_id = {r.id: r for r in rows}
    return [by_id[i] for i in ids if i in by_id]


def run_to_dict(run: ApPaymentRun, invoices: list[ApInvoice] | None = None) -> dict[str, Any]:
    vendor_count = len({(i.vendor_name or "").strip().lower() for i in (invoices or []) if i.vendor_name})
    if invoices is None:
        vendor_count = 0
    return {
        "id": run.id,
        "run_number": run.run_number,
        "workspace_id": run.workspace_id,
        "company_id": run.company_id,
        "created_by": run.created_by,
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "submitted_at": run.submitted_at.isoformat() if run.submitted_at else None,
        "approved_by": run.approved_by,
        "approved_at": run.approved_at.isoformat() if run.approved_at else None,
        "executed_at": run.executed_at.isoformat() if run.executed_at else None,
        "status": run.status,
        "rejection_reason": run.rejection_reason,
        "payment_date": run.payment_date.isoformat() if getattr(run, "payment_date", None) else None,
        "bank_account": getattr(run, "bank_account", None),
        "notes": getattr(run, "notes", None),
        "total_invoices": run.total_invoices,
        "invoice_count": run.total_invoices,
        "vendor_count": vendor_count,
        "total_net_aed": _f(run.total_net_aed),
        "total_vat_aed": _f(run.total_vat_aed),
        "total_gross_aed": _f(run.total_gross_aed),
        "total_amount_aed": _f(run.total_gross_aed),
        "invoice_ids": list(run.invoice_ids or []),
        "journal_entry_id": run.journal_entry_id,
    }


def invoice_row_dict(inv: ApInvoice) -> dict[str, Any]:
    return {
        "id": inv.id,
        "invoice_number": inv.invoice_number,
        "vendor_name": inv.vendor_name,
        "due_date": inv.due_date.isoformat() if inv.due_date else None,
        "amount": _f(inv.total_amount),
        "amount_aed": _f(inv.total_amount),
        "net_amount": _net_amount(inv),
        "vat_amount": _vat_amount(inv),
        "days_overdue": _days_overdue(inv.due_date),
        "discount_available": _discount_available(inv),
        "category": _category(inv),
        "property_id": _property_id(inv),
        "property_name": _property_label(inv),
        "status": inv.status,
        "payment_status": _payment_status(inv),
        "currency": inv.currency or "AED",
    }


def submit_run(db: Session, run: ApPaymentRun) -> ApPaymentRun:
    if run.status != "draft":
        raise ValueError("Only DRAFT runs can be submitted")
    run.status = "pending_approval"
    run.submitted_at = datetime.utcnow()
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def approve_run(db: Session, run: ApPaymentRun, *, approved_by: str | None) -> ApPaymentRun:
    if run.status != "pending_approval":
        raise ValueError("Only PENDING_APPROVAL runs can be approved")
    actor = (approved_by or "").strip().lower()
    creator = (run.created_by or "").strip().lower()
    if actor and creator and actor == creator:
        raise ValueError("Maker-checker: approver must be different from the creator")
    run.status = "approved"
    run.approved_by = approved_by
    run.approved_at = datetime.utcnow()
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def cancel_run(db: Session, run: ApPaymentRun, *, cancelled_by: str | None = None) -> ApPaymentRun:
    if run.status in {"executed", "cancelled"}:
        raise ValueError("Executed or already cancelled runs cannot be cancelled")
    run.status = "cancelled"
    ex = run.extra if isinstance(run.extra, dict) else {}
    ex = dict(ex or {})
    ex["cancelled_by"] = cancelled_by
    ex["cancelled_at"] = datetime.utcnow().isoformat()
    run.extra = ex
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def monthly_dashboard_stats(
    db: Session,
    *,
    workspace_id: str,
    company_id: str,
    as_of: date | None = None,
) -> dict[str, Any]:
    ensure_payment_runs_table()
    today = as_of or date.today()
    month_start = today.replace(day=1)
    week_end = today + timedelta(days=(6 - today.weekday()))
    runs = (
        db.query(ApPaymentRun)
        .filter(
            ApPaymentRun.workspace_id == workspace_id,
            ApPaymentRun.company_id == company_id,
        )
        .all()
    )
    executed = 0
    total_paid = 0.0
    pending = 0
    scheduled_week = 0
    for run in runs:
        st = str(run.status or "").lower()
        created = run.created_at.date() if run.created_at else None
        pay_d = run.payment_date if getattr(run, "payment_date", None) else created
        if st == "executed" and run.executed_at and run.executed_at.date() >= month_start:
            executed += 1
            total_paid += _f(run.total_gross_aed)
        if st == "pending_approval":
            pending += 1
        if st in {"draft", "pending_approval", "approved"} and pay_d and today <= pay_d <= week_end:
            scheduled_week += 1
    return {
        "runs_executed": executed,
        "total_paid_aed": round(total_paid, 2),
        "pending_approval": pending,
        "scheduled_this_week": scheduled_week,
        "month": month_start.strftime("%Y-%m"),
    }


def reject_run(
    db: Session,
    run: ApPaymentRun,
    *,
    reason: str,
    rejected_by: str | None = None,
) -> ApPaymentRun:
    if run.status != "pending_approval":
        raise ValueError("Only PENDING_APPROVAL runs can be rejected")
    run.status = "rejected"
    run.rejection_reason = (reason or "").strip() or "Rejected"
    ex = run.extra if isinstance(run.extra, dict) else {}
    ex = dict(ex or {})
    ex["rejected_by"] = rejected_by
    ex["rejected_at"] = datetime.utcnow().isoformat()
    run.extra = ex
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def execute_run(db: Session, run: ApPaymentRun) -> ApPaymentRun:
    if run.status != "approved":
        raise ValueError("Only APPROVED runs can be executed")

    invoices = invoices_for_run(db, run)
    if not invoices:
        raise ValueError("No invoices found on this payment run")

    for inv in invoices:
        mark_invoice_paid(inv, run_id=run.id, run_number=run.run_number)
        db.add(inv)

    gross = _f(run.total_gross_aed) or sum(_f(i.total_amount) for i in invoices)
    payment_date = date.today()
    je = create_journal_entry(
        tenant_id=run.workspace_id,
        entry_date=payment_date,
        description=f"AP Payment Run {run.run_number}",
        lines=[
            {
                "account_code": AP_PAYABLE_CODE,
                "account_name": AP_PAYABLE_NAME,
                "debit": round(gross, 2),
                "credit": 0,
                "description": f"Settle AP — {run.run_number}",
            },
            {
                "account_code": CASH_BANK_CODE,
                "account_name": CASH_BANK_NAME,
                "debit": 0,
                "credit": round(gross, 2),
                "description": f"Bank payment — {run.run_number}",
            },
        ],
        reference=run.run_number,
        source=PAYMENT_JE_SOURCE,
        company_id=run.company_id,
        db=db,
        auto_post=True,
        initial_status="posted",
    )

    run.status = "executed"
    run.executed_at = datetime.utcnow()
    run.journal_entry_id = je.id
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def build_bank_file_csv(db: Session, run: ApPaymentRun) -> str:
    invoices = invoices_for_run(db, run)
    ibans = vendor_iban_map(
        db,
        workspace_id=run.workspace_id,
        company_id=run.company_id,
        vendor_names=[i.vendor_name for i in invoices],
    )
    payment_date = (run.executed_at.date() if run.executed_at else date.today()).isoformat()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["vendor_name", "vendor_iban", "amount", "reference", "payment_date"])
    for inv in invoices:
        key = (inv.vendor_name or "").strip().lower()
        writer.writerow(
            [
                inv.vendor_name or "",
                ibans.get(key) or "",
                f"{_f(inv.total_amount):.2f}",
                inv.invoice_number or run.run_number,
                payment_date,
            ]
        )
    return buf.getvalue()


def build_remittance_csv(db: Session, run: ApPaymentRun) -> str:
    invoices = invoices_for_run(db, run)
    payment_date = (run.executed_at.date() if run.executed_at else date.today()).isoformat()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "run_number",
            "payment_date",
            "invoice_number",
            "vendor_name",
            "net_amount",
            "vat_amount",
            "gross_amount",
            "currency",
        ]
    )
    for inv in invoices:
        writer.writerow(
            [
                run.run_number,
                payment_date,
                inv.invoice_number,
                inv.vendor_name,
                f"{_net_amount(inv):.2f}",
                f"{_vat_amount(inv):.2f}",
                f"{_f(inv.total_amount):.2f}",
                inv.currency or "AED",
            ]
        )
    return buf.getvalue()


def default_due_window() -> tuple[date, date]:
    today = date.today()
    return today, today + timedelta(days=7)
