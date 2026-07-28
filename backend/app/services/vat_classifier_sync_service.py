"""Bridge gulftax_transactions (VAT Return) → ported `transactions` (VAT Classifier UI).

The VAT Classifier Saved list reads RDS `transactions` filtered by GulfTax
`companies.id` (resolved via X-Company-Id → external_id). AP/AR sync only wrote
`gulftax_transactions`, so Saved stayed at 0 even when VAT Return had data.
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def _category_to_vat_treatment(raw: str | None) -> str:
    t = (raw or "standard").lower().replace("-", "_").strip()
    if t in ("standard", "standard_rated"):
        return "standard_rated"
    if t in ("zero", "zero_rated"):
        return "zero_rated"
    if t == "exempt":
        return "exempt"
    if t in ("reverse_charge", "rcm"):
        return "reverse_charge"
    if t in ("out_of_scope", "outofscope"):
        return "out_of_scope"
    return "standard_rated"


def _box_number(fta_box: str | None, vat_treatment: str, transaction_type: str) -> int | None:
    if fta_box:
        digits = "".join(ch for ch in str(fta_box) if ch.isdigit())
        if digits:
            try:
                return int(digits)
            except ValueError:
                pass
    if transaction_type == "sale":
        return {"standard_rated": 1, "zero_rated": 3, "exempt": 4, "reverse_charge": 3}.get(
            vat_treatment, 1
        )
    return {"standard_rated": 9, "zero_rated": 10, "exempt": 11, "reverse_charge": 10}.get(
        vat_treatment, 9
    )


def _ported_session() -> Session:
    """Open a session bound to the GulfTax ported ORM (same RDS, separate Base)."""
    from app.modules.gulftax.ported_mount import (
        _alias_ported_orm_modules,
        _ensure_database_url,
    )

    _alias_ported_orm_modules()
    _ensure_database_url()
    from database import SessionLocal as PortedSessionLocal

    return PortedSessionLocal()


def resolve_ported_company_id(
    db: Session,
    finreport_company_id: str,
    *,
    workspace_id: str | None = None,
) -> str | None:
    """Map FinReportAI company UUID → GulfTax `companies.id` used by VAT Classifier."""
    from models import Company

    cid = (finreport_company_id or "").strip()
    if not cid:
        return None

    row = db.query(Company).filter(Company.id == cid).first()
    if row:
        return row.id

    row = db.query(Company).filter(Company.external_id == cid).first()
    if row:
        return row.id

    ws = (workspace_id or "").strip()
    if ws:
        row = db.query(Company).filter(Company.workspace_id == ws).first()
        if row:
            return row.id

    return None


def upsert_classifier_transaction(
    *,
    finreport_company_id: str,
    workspace_id: str | None = None,
    invoice_number: str | None,
    vendor_or_customer: str | None,
    transaction_date: date | None,
    gross_amount: float,
    vat_amount: float,
    vat_category: str | None,
    direction: str = "input",
    source: str = "ap_invoiceflow",
    vendor_trn: str | None = None,
    fta_box: str | None = None,
    ap_invoice_id: str | None = None,
    confidence_score: float = 90.0,
    description: str | None = None,
) -> dict[str, Any]:
    """Insert (or skip if duplicate) one row into ported `transactions`."""
    db = _ported_session()
    try:
        from models import Transaction

        ported_cid = resolve_ported_company_id(
            db, finreport_company_id, workspace_id=workspace_id
        )
        if not ported_cid:
            logger.warning(
                "VAT Classifier sync skipped — no companies row for external_id/company_id=%s ws=%s",
                finreport_company_id,
                workspace_id,
            )
            return {"ok": False, "error": "ported_company_not_found"}

        tx_type = "sale" if (direction or "").lower() == "output" else "purchase"
        vat_treatment = _category_to_vat_treatment(vat_category)
        inv_no = (invoice_number or "").strip() or None
        party = (vendor_or_customer or "").strip() or None
        gross = round(float(gross_amount or 0), 2)
        vat = round(float(vat_amount or 0), 2)
        net = round(gross - vat, 2) if gross >= vat else round(gross, 2)
        if net < 0:
            net = round(gross, 2)

        tx_date = transaction_date or date.today()
        if isinstance(tx_date, datetime):
            tx_date = tx_date.date()
        elif isinstance(tx_date, str):
            tx_date = date.fromisoformat(tx_date[:10])

        q = db.query(Transaction).filter(
            Transaction.company_id == ported_cid,
            Transaction.transaction_type == tx_type,
            Transaction.source == source,
        )
        if inv_no:
            q = q.filter(Transaction.invoice_number == inv_no)
        if party:
            q = q.filter(Transaction.vendor_or_customer == party)
        existing = q.first()
        if existing:
            return {
                "ok": True,
                "skipped": True,
                "reason": "already_synced",
                "transaction_id": existing.id,
                "ported_company_id": ported_cid,
            }

        desc = (
            (description or "").strip()
            or party
            or (f"Invoice #{inv_no}" if inv_no else "Transaction")
        )
        tx = Transaction(
            company_id=ported_cid,
            date=tx_date,
            description=desc,
            amount_aed=net,
            vendor_or_customer=party,
            invoice_number=inv_no,
            vat_treatment=vat_treatment,
            transaction_type=tx_type,
            vat_amount_aed=vat,
            confidence_score=float(confidence_score or 90.0),
            ai_reasoning=f"Synced from {source} → VAT Classifier",
            box_number=_box_number(fta_box, vat_treatment, tx_type),
            is_verified=True,
            source=source,
            vendor_trn=(vendor_trn or None),
            source_metadata={
                "ap_invoice_id": ap_invoice_id,
                "finreport_company_id": finreport_company_id,
                "gross_amount": gross,
                "direction": direction,
                "fta_box": fta_box,
            },
        )
        db.add(tx)
        db.commit()
        db.refresh(tx)
        return {
            "ok": True,
            "transaction_id": tx.id,
            "ported_company_id": ported_cid,
            "vat_treatment": vat_treatment,
            "transaction_type": tx_type,
        }
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def sync_gulftax_orm_row_to_classifier(gt_row: Any) -> dict[str, Any]:
    """Mirror one GulftaxTransaction ORM row into Classifier `transactions`."""
    return upsert_classifier_transaction(
        finreport_company_id=str(gt_row.company_id or ""),
        workspace_id=str(getattr(gt_row, "tenant_id", None) or "") or None,
        invoice_number=gt_row.invoice_number,
        vendor_or_customer=gt_row.vendor_name,
        transaction_date=gt_row.transaction_date,
        gross_amount=float(gt_row.gross_amount or 0),
        vat_amount=float(gt_row.vat_amount or 0),
        vat_category=gt_row.vat_category,
        direction=gt_row.direction or "input",
        source=gt_row.source or "ap_invoiceflow",
        vendor_trn=gt_row.vendor_trn,
        fta_box=gt_row.fta_box,
        ap_invoice_id=gt_row.ap_invoice_id,
    )


def sync_ar_invoice_to_vat_classifier(
    *,
    finreport_company_id: str,
    workspace_id: str | None = None,
    invoice_number: str | None,
    customer_name: str | None,
    transaction_date: date | None,
    gross_amount: float,
    vat_amount: float,
    vat_category: str | None = None,
    vendor_trn: str | None = None,
    fta_box: str | None = None,
    sales_invoice_id: str | None = None,
    source: str = "ar_approve_and_post",
) -> dict[str, Any]:
    """Mirror an AR (output VAT) invoice into Classifier `transactions` (Saved tab).

    Always labels direction as output so VAT Classifier can distinguish AR vs AP.
    """
    return upsert_classifier_transaction(
        finreport_company_id=finreport_company_id,
        workspace_id=workspace_id,
        invoice_number=invoice_number,
        vendor_or_customer=customer_name,
        transaction_date=transaction_date,
        gross_amount=gross_amount,
        vat_amount=vat_amount,
        vat_category=vat_category,
        direction="output",
        source=source or "ar_approve_and_post",
        vendor_trn=vendor_trn,
        fta_box=fta_box,
        ap_invoice_id=sales_invoice_id,
        description=(
            f"AR sale {invoice_number}" if invoice_number else "AR sales invoice"
        ),
    )


def backfill_classifier_from_gulftax(
    db: Session,
    *,
    finreport_company_id: str | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    """Copy existing gulftax_transactions into Classifier `transactions`."""
    from app.models.client_data import GulftaxTransaction

    q = db.query(GulftaxTransaction).filter(GulftaxTransaction.status == "posted")
    if finreport_company_id:
        q = q.filter(GulftaxTransaction.company_id == finreport_company_id)
    q = q.order_by(GulftaxTransaction.transaction_date.asc())
    if limit:
        q = q.limit(limit)

    rows = q.all()
    created = skipped = failed = 0
    errors: list[str] = []
    for row in rows:
        try:
            result = sync_gulftax_orm_row_to_classifier(row)
            if result.get("ok") and result.get("skipped"):
                skipped += 1
            elif result.get("ok"):
                created += 1
            else:
                failed += 1
                errors.append(f"{row.invoice_number}:{result.get('error')}")
        except Exception as exc:
            failed += 1
            errors.append(f"{row.invoice_number}:{exc}")
            logger.exception(
                "Classifier backfill failed for gulftax row %s", getattr(row, "id", "?")
            )

    return {
        "ok": failed == 0,
        "scanned": len(rows),
        "created": created,
        "skipped": skipped,
        "failed": failed,
        "errors": errors[:20],
    }


CLASSIFIER_GULFTAX_SOURCE = "vat_classifier_approved"
_CLASSIFIER_TX_NS = uuid.UUID("b8d4f2a0-6c1e-4f9b-8d3a-7e5c4b2a1f09")


def _classifier_ap_invoice_id(classifier_txn_id: int | str) -> str:
    return str(uuid.uuid5(_CLASSIFIER_TX_NS, f"vat-classifier-txn:{classifier_txn_id}"))


def _finreport_ids_from_ported_company(ported_company: Any) -> tuple[str, str]:
    """Return (finreport_company_id, workspace/tenant_id) for gulftax_transactions."""
    if ported_company is None:
        return "", ""
    finreport_cid = (
        (getattr(ported_company, "external_id", None) or "").strip()
        or (getattr(ported_company, "id", None) or "")
    )
    tenant_id = (getattr(ported_company, "workspace_id", None) or "").strip() or finreport_cid
    return str(finreport_cid), str(tenant_id)


def sync_classifier_transaction_to_gulftax(
    db: Session,
    classifier_txn: Any,
    *,
    ported_company: Any | None = None,
    workspace_id: str | None = None,
) -> dict[str, Any]:
    """Insert one approved VAT Classifier transaction into RDS gulftax_transactions.

    Idempotent via source=vat_classifier_approved + deterministic ap_invoice_id.
    direction: output for sales, input for purchases.
    """
    from app.models.client_data import GulftaxTransaction
    from app.services.gulftax_sync_service import (
        _fta_box,
        _norm_treatment,
        tax_period_for_date,
    )

    txn_id = getattr(classifier_txn, "id", None)
    if txn_id is None:
        return {"ok": False, "error": "missing_classifier_txn_id"}

    ap_id = _classifier_ap_invoice_id(txn_id)
    existing = (
        db.query(GulftaxTransaction)
        .filter(
            GulftaxTransaction.source == CLASSIFIER_GULFTAX_SOURCE,
            GulftaxTransaction.ap_invoice_id == ap_id,
        )
        .first()
    )
    if existing:
        return {
            "ok": True,
            "skipped": True,
            "reason": "already_synced",
            "transaction_id": existing.id,
        }

    # Secondary dedupe: same company + invoice_number + direction + period
    finreport_cid, tenant_from_company = _finreport_ids_from_ported_company(ported_company)
    company_id = finreport_cid or str(getattr(classifier_txn, "company_id", "") or "")
    tenant_id = (workspace_id or "").strip() or tenant_from_company or company_id
    if not company_id or not tenant_id:
        return {"ok": False, "error": "company_id_or_tenant_missing"}

    tx_type = (getattr(classifier_txn, "transaction_type", None) or "purchase").lower()
    direction = "output" if tx_type == "sale" else "input"

    tx_date = getattr(classifier_txn, "date", None) or date.today()
    if isinstance(tx_date, datetime):
        tx_date = tx_date.date()
    elif isinstance(tx_date, str):
        tx_date = date.fromisoformat(tx_date[:10])

    filing = "quarterly"
    try:
        from app.services.gulftax_sync_service import _fetch_company_config

        cfg = _fetch_company_config(company_id)
        filing = cfg.get("vat_filing_frequency") or "quarterly"
    except Exception:
        pass

    tax_period = tax_period_for_date(tx_date, filing)
    inv_no = (getattr(classifier_txn, "invoice_number", None) or "").strip() or None
    if inv_no:
        dup = (
            db.query(GulftaxTransaction)
            .filter(
                GulftaxTransaction.company_id == company_id,
                GulftaxTransaction.invoice_number == inv_no,
                GulftaxTransaction.direction == direction,
                GulftaxTransaction.tax_period == tax_period,
                GulftaxTransaction.status == "posted",
            )
            .first()
        )
        if dup:
            return {
                "ok": True,
                "skipped": True,
                "reason": "duplicate_invoice_number",
                "transaction_id": dup.id,
            }

    net = round(float(getattr(classifier_txn, "amount_aed", 0) or 0), 2)
    vat = round(float(getattr(classifier_txn, "vat_amount_aed", 0) or 0), 2)
    gross = round(net + vat, 2) if vat > 0 else net

    vat_treatment = getattr(classifier_txn, "vat_treatment", None) or "standard_rated"
    vat_category = _norm_treatment(vat_treatment)
    stored_box = getattr(classifier_txn, "box_number", None)
    if stored_box is not None:
        fta_box = f"box{int(stored_box)}"
    else:
        fta_box = _fta_box(vat_category, direction)

    try:
        gt = GulftaxTransaction(
            id=str(uuid.uuid4()),
            tenant_id=tenant_id,
            company_id=company_id,
            source=CLASSIFIER_GULFTAX_SOURCE,
            ap_invoice_id=ap_id,
            tax_period=tax_period,
            transaction_date=tx_date,
            vendor_name=getattr(classifier_txn, "vendor_or_customer", None),
            vendor_trn=getattr(classifier_txn, "vendor_trn", None),
            invoice_number=inv_no,
            gross_amount=gross,
            vat_amount=vat,
            vat_category=vat_category,
            fta_box=fta_box,
            direction=direction,
            status="posted",
            designated_zone=False,
            transaction_kind="goods",
            created_at=datetime.utcnow(),
        )
        db.add(gt)
        db.commit()
        db.refresh(gt)
        return {
            "ok": True,
            "transaction_id": gt.id,
            "tax_period": tax_period,
            "fta_box": fta_box,
            "direction": direction,
            "company_id": company_id,
        }
    except Exception as exc:
        db.rollback()
        logger.exception(
            "Classifier→gulftax sync failed for txn id=%s", txn_id
        )
        return {"ok": False, "error": str(exc)}


def sync_approved_classifier_transactions_to_gulftax(
    *,
    classifier_txns: list[Any],
    ported_company: Any | None = None,
    workspace_id: str | None = None,
) -> dict[str, Any]:
    """Batch sync approved classifier transactions into gulftax_transactions."""
    from app.core.database import SessionLocal

    db = SessionLocal()
    synced = skipped = errors = 0
    try:
        for txn in classifier_txns:
            try:
                result = sync_classifier_transaction_to_gulftax(
                    db,
                    txn,
                    ported_company=ported_company,
                    workspace_id=workspace_id,
                )
                if result.get("ok") and result.get("skipped"):
                    skipped += 1
                elif result.get("ok"):
                    synced += 1
                else:
                    errors += 1
                    logger.warning(
                        "Classifier gulftax sync failed id=%s: %s",
                        getattr(txn, "id", None),
                        result.get("error"),
                    )
            except Exception:
                errors += 1
                logger.exception(
                    "Classifier gulftax sync exception id=%s",
                    getattr(txn, "id", None),
                )
        return {
            "ok": errors == 0,
            "synced": synced,
            "skipped": skipped,
            "errors": errors,
        }
    finally:
        db.close()

