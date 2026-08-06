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
    """Prefer side+treatment mapping; only trust fta_box when it agrees with side."""
    from app.services.vat_box_mapping import assign_box_number, normalize_transaction_side

    side = normalize_transaction_side(transaction_type)
    expected = assign_box_number(side, vat_treatment)
    if fta_box:
        digits = "".join(ch for ch in str(fta_box) if ch.isdigit())
        if digits:
            try:
                parsed = int(digits)
                # Never keep AR boxes on purchases (or vice versa) from a stale fta_box
                if side == "purchase" and parsed in (1, 2, 3, 4, 5):
                    return expected
                if side == "sale" and parsed in (6, 7, 9, 10, 11):
                    return expected
                return parsed
            except ValueError:
                pass
    return expected


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
INVOICE_FLOW_PDF_SOURCE = "invoice_flow_pdf"
_CLASSIFIER_TX_NS = uuid.UUID("b8d4f2a0-6c1e-4f9b-8d3a-7e5c4b2a1f09")


def _classifier_ap_invoice_id(classifier_txn_id: int | str) -> str:
    return str(uuid.uuid5(_CLASSIFIER_TX_NS, f"vat-classifier-txn:{classifier_txn_id}"))


def _simple_fta_box(transaction_type: str | None) -> str:
    """BUG 3: purchase → '9', sale → '1' (bare FTA box digits)."""
    side = (transaction_type or "purchase").strip().lower()
    return "1" if side == "sale" else "9"


def _simple_direction(transaction_type: str | None) -> str:
    side = (transaction_type or "purchase").strip().lower()
    return "output" if side == "sale" else "input"


def _upsert_supabase_gulftax_row(row: dict[str, Any]) -> dict[str, Any]:
    """Insert into Supabase gulftax_transactions; skip if invoice_number+source+company exists.

    Do not send net_amount — Supabase column is GENERATED.
    """
    try:
        from app.core.supabase import get_supabase

        sb = get_supabase()
        company_id = row.get("company_id")
        source = row.get("source")
        inv = (row.get("invoice_number") or "").strip() or None
        if company_id and source and inv:
            existing = (
                sb.table("gulftax_transactions")
                .select("id")
                .eq("company_id", company_id)
                .eq("source", source)
                .eq("invoice_number", inv)
                .limit(1)
                .execute()
            )
            if existing.data:
                return {"ok": True, "skipped": True, "id": existing.data[0].get("id")}

        payload = {k: v for k, v in row.items() if k != "net_amount" and v is not None}
        # Prefer workspace_id over tenant_id for Supabase schema
        if "tenant_id" in payload and "workspace_id" not in payload:
            payload["workspace_id"] = payload.pop("tenant_id")
        else:
            payload.pop("tenant_id", None)
        res = sb.table("gulftax_transactions").insert(payload).execute()
        inserted = (res.data or [None])[0]
        return {"ok": True, "id": (inserted or {}).get("id")}
    except Exception as exc:
        logger.exception("Supabase gulftax_transactions upsert failed")
        return {"ok": False, "error": str(exc)}


def _upsert_vat_classifier_transactions_row(row: dict[str, Any]) -> dict[str, Any]:
    """Mirror into Supabase + RDS vat_classifier_transactions (BUG 1 table)."""
    result: dict[str, Any] = {"supabase": None, "rds": None}
    inv_ref = (row.get("invoice_reference") or row.get("invoice_number") or "").strip() or None
    company_id = row.get("company_id")
    source = row.get("source") or CLASSIFIER_GULFTAX_SOURCE
    fta_box = row.get("fta_box") or _simple_fta_box(row.get("transaction_type"))
    payload = {
        "company_id": company_id,
        "workspace_id": row.get("workspace_id") or row.get("tenant_id"),
        "transaction_type": row.get("transaction_type") or "purchase",
        "fta_box": fta_box,
        "net_amount": row.get("net_amount"),
        "vat_amount": row.get("vat_amount"),
        "gross_amount": row.get("gross_amount"),
        "invoice_reference": inv_ref,
        "vendor_name": row.get("vendor_name"),
        "source": source,
        "transaction_date": row.get("transaction_date"),
        "vat_category": row.get("vat_category"),
    }
    # Dates as ISO for Supabase JSON
    td = payload.get("transaction_date")
    if hasattr(td, "isoformat"):
        payload["transaction_date"] = td.isoformat()

    try:
        from app.core.supabase import get_supabase

        sb = get_supabase()
        if company_id and source and inv_ref:
            existing = (
                sb.table("vat_classifier_transactions")
                .select("id")
                .eq("company_id", company_id)
                .eq("source", source)
                .eq("invoice_reference", inv_ref)
                .limit(1)
                .execute()
            )
            if existing.data:
                result["supabase"] = {"ok": True, "skipped": True}
            else:
                clean = {k: v for k, v in payload.items() if v is not None}
                sb.table("vat_classifier_transactions").insert(clean).execute()
                result["supabase"] = {"ok": True}
        else:
            clean = {k: v for k, v in payload.items() if v is not None}
            sb.table("vat_classifier_transactions").insert(clean).execute()
            result["supabase"] = {"ok": True}
    except Exception as exc:
        logger.exception("Supabase vat_classifier_transactions upsert failed")
        result["supabase"] = {"ok": False, "error": str(exc)}

    try:
        from sqlalchemy import text

        from app.core.database import SessionLocal

        rds = SessionLocal()
        try:
            if company_id and source and inv_ref:
                found = rds.execute(
                    text(
                        "SELECT id FROM vat_classifier_transactions "
                        "WHERE company_id = :cid AND source = :src "
                        "AND invoice_reference = :inv LIMIT 1"
                    ),
                    {"cid": str(company_id), "src": source, "inv": inv_ref},
                ).fetchone()
                if found:
                    result["rds"] = {"ok": True, "skipped": True}
                    return result
            new_id = str(uuid.uuid4())
            rds.execute(
                text(
                    """
                    INSERT INTO vat_classifier_transactions (
                      id, company_id, workspace_id, transaction_type, fta_box,
                      net_amount, vat_amount, gross_amount, invoice_reference,
                      vendor_name, source, transaction_date, vat_category, created_at
                    ) VALUES (
                      :id, :company_id, :workspace_id, :transaction_type, :fta_box,
                      :net_amount, :vat_amount, :gross_amount, :invoice_reference,
                      :vendor_name, :source, :transaction_date, :vat_category, NOW()
                    )
                    """
                ),
                {
                    "id": new_id,
                    "company_id": str(company_id) if company_id else None,
                    "workspace_id": payload.get("workspace_id"),
                    "transaction_type": payload.get("transaction_type"),
                    "fta_box": fta_box,
                    "net_amount": payload.get("net_amount"),
                    "vat_amount": payload.get("vat_amount"),
                    "gross_amount": payload.get("gross_amount"),
                    "invoice_reference": inv_ref,
                    "vendor_name": payload.get("vendor_name"),
                    "source": source,
                    "transaction_date": (
                        None
                        if td is None
                        else td
                        if not isinstance(td, str)
                        else date.fromisoformat(str(td)[:10])
                    ),
                    "vat_category": payload.get("vat_category"),
                },
            )
            rds.commit()
            result["rds"] = {"ok": True, "id": new_id}
        except Exception as exc:
            rds.rollback()
            logger.exception("RDS vat_classifier_transactions upsert failed")
            result["rds"] = {"ok": False, "error": str(exc)}
        finally:
            rds.close()
    except Exception as exc:
        result["rds"] = {"ok": False, "error": str(exc)}

    return result


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
    db: Session | None,
    classifier_txn: Any = None,
    *,
    ported_company: Any | None = None,
    workspace_id: str | None = None,
) -> dict[str, Any]:
    """Insert one approved VAT Classifier transaction into RDS gulftax_transactions.

    Idempotent via source=vat_classifier_approved + deterministic ap_invoice_id.
    direction: output for sales, input for purchases.

    ``db`` may be omitted — a short-lived SessionLocal is used (single-approve callers).
    Also accepts legacy keyword-only call: sync_classifier_transaction_to_gulftax(classifier_txn=...).
    """
    # Support legacy keyword call without positional db
    if classifier_txn is None and db is not None and not isinstance(db, Session):
        classifier_txn = db
        db = None

    owns_session = False
    if db is None:
        from app.core.database import SessionLocal

        db = SessionLocal()
        owns_session = True

    try:
        return _sync_classifier_transaction_to_gulftax_impl(
            db,
            classifier_txn,
            ported_company=ported_company,
            workspace_id=workspace_id,
        )
    finally:
        if owns_session:
            db.close()


def _sync_classifier_transaction_to_gulftax_impl(
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
        _norm_treatment,
        tax_period_for_date,
    )

    txn_id = getattr(classifier_txn, "id", None)
    if txn_id is None:
        return {"ok": False, "error": "missing_classifier_txn_id"}

    ap_id = _classifier_ap_invoice_id(txn_id)
    finreport_cid, tenant_from_company = _finreport_ids_from_ported_company(ported_company)
    company_id = finreport_cid or str(getattr(classifier_txn, "company_id", "") or "")
    tenant_id = (workspace_id or "").strip() or tenant_from_company or company_id
    if not company_id or not tenant_id:
        return {"ok": False, "error": "company_id_or_tenant_missing"}

    tx_type = (getattr(classifier_txn, "transaction_type", None) or "purchase").lower()
    if tx_type not in ("sale", "purchase"):
        tx_type = "purchase"

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

    net = round(float(getattr(classifier_txn, "amount_aed", 0) or 0), 2)
    vat = round(float(getattr(classifier_txn, "vat_amount_aed", 0) or 0), 2)
    gross = round(net + vat, 2) if vat > 0 else net

    # BUG 3 — simple box map: purchase→9, sale→1 (bare digits; VAT return normalizes)
    direction = _simple_direction(tx_type)
    vat_treatment = getattr(classifier_txn, "vat_treatment", None) or "standard_rated"
    vat_category = _norm_treatment(vat_treatment)
    fta_box = _simple_fta_box(tx_type)

    # Prefer invoice_number + source + company_id dedupe (user rule)
    if inv_no and company_id:
        dup_by_ref = (
            db.query(GulftaxTransaction)
            .filter(
                GulftaxTransaction.company_id == company_id,
                GulftaxTransaction.invoice_number == inv_no,
                GulftaxTransaction.source == CLASSIFIER_GULFTAX_SOURCE,
            )
            .first()
        )
        if dup_by_ref:
            changed = False
            if (dup_by_ref.fta_box or "") != fta_box:
                dup_by_ref.fta_box = fta_box
                changed = True
            if (dup_by_ref.direction or "").lower() != direction:
                dup_by_ref.direction = direction
                changed = True
            if (dup_by_ref.status or "") != "posted":
                dup_by_ref.status = "posted"
                changed = True
            if changed:
                db.add(dup_by_ref)
                db.commit()
                db.refresh(dup_by_ref)
            _upsert_supabase_gulftax_row(
                {
                    "company_id": company_id,
                    "workspace_id": tenant_id,
                    "source": CLASSIFIER_GULFTAX_SOURCE,
                    "invoice_number": inv_no,
                    "tax_period": dup_by_ref.tax_period,
                    "transaction_date": dup_by_ref.transaction_date.isoformat()
                    if hasattr(dup_by_ref.transaction_date, "isoformat")
                    else dup_by_ref.transaction_date,
                    "vendor_name": dup_by_ref.vendor_name,
                    "vendor_trn": dup_by_ref.vendor_trn,
                    "gross_amount": float(dup_by_ref.gross_amount or 0),
                    "vat_amount": float(dup_by_ref.vat_amount or 0),
                    "vat_category": dup_by_ref.vat_category,
                    "fta_box": fta_box,
                    "direction": direction,
                    "status": "posted",
                }
            )
            _upsert_vat_classifier_transactions_row(
                {
                    "company_id": company_id,
                    "workspace_id": tenant_id,
                    "transaction_type": tx_type,
                    "fta_box": fta_box,
                    "net_amount": net,
                    "vat_amount": vat,
                    "gross_amount": gross,
                    "invoice_reference": inv_no,
                    "vendor_name": getattr(classifier_txn, "vendor_or_customer", None),
                    "source": CLASSIFIER_GULFTAX_SOURCE,
                    "transaction_date": tx_date,
                    "vat_category": vat_category,
                }
            )
            return {
                "ok": True,
                "skipped": not changed,
                "updated": changed,
                "reason": "duplicate_invoice_reference",
                "transaction_id": dup_by_ref.id,
                "fta_box": fta_box,
            }

    existing = (
        db.query(GulftaxTransaction)
        .filter(
            GulftaxTransaction.source == CLASSIFIER_GULFTAX_SOURCE,
            GulftaxTransaction.ap_invoice_id == ap_id,
        )
        .first()
    )
    if existing:
        changed = False
        if (existing.fta_box or "") != fta_box:
            existing.fta_box = fta_box
            changed = True
        if (existing.direction or "").lower() != direction:
            existing.direction = direction
            changed = True
        if changed:
            db.add(existing)
            db.commit()
            db.refresh(existing)
            _upsert_supabase_gulftax_row(
                {
                    "company_id": company_id,
                    "workspace_id": tenant_id,
                    "source": CLASSIFIER_GULFTAX_SOURCE,
                    "invoice_number": inv_no,
                    "tax_period": existing.tax_period,
                    "transaction_date": existing.transaction_date.isoformat()
                    if hasattr(existing.transaction_date, "isoformat")
                    else existing.transaction_date,
                    "vendor_name": existing.vendor_name,
                    "vendor_trn": existing.vendor_trn,
                    "gross_amount": float(existing.gross_amount or 0),
                    "vat_amount": float(existing.vat_amount or 0),
                    "vat_category": existing.vat_category,
                    "fta_box": fta_box,
                    "direction": direction,
                    "status": "posted",
                }
            )
            return {
                "ok": True,
                "updated": True,
                "reason": "corrected_box_or_direction",
                "transaction_id": existing.id,
                "fta_box": fta_box,
            }
        return {
            "ok": True,
            "skipped": True,
            "reason": "already_synced",
            "transaction_id": existing.id,
        }

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
        _upsert_supabase_gulftax_row(
            {
                "company_id": company_id,
                "workspace_id": tenant_id,
                "source": CLASSIFIER_GULFTAX_SOURCE,
                "invoice_number": inv_no,
                "tax_period": tax_period,
                "transaction_date": tx_date.isoformat(),
                "vendor_name": gt.vendor_name,
                "vendor_trn": gt.vendor_trn,
                "gross_amount": gross,
                "vat_amount": vat,
                "vat_category": vat_category,
                "fta_box": fta_box,
                "direction": direction,
                "status": "posted",
            }
        )
        _upsert_vat_classifier_transactions_row(
            {
                "company_id": company_id,
                "workspace_id": tenant_id,
                "transaction_type": tx_type,
                "fta_box": fta_box,
                "net_amount": net,
                "vat_amount": vat,
                "gross_amount": gross,
                "invoice_reference": inv_no,
                "vendor_name": gt.vendor_name,
                "source": CLASSIFIER_GULFTAX_SOURCE,
                "transaction_date": tx_date,
                "vat_category": vat_category,
            }
        )
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


def sync_invoice_record_to_gulftax_pending(
    db: Session,
    invoice: Any,
    *,
    ported_company: Any | None = None,
    workspace_id: str | None = None,
) -> dict[str, Any]:
    """Write gulftax pending row from Invoice Flow `invoices` row (no classifier txn needed).

    Called after every classify-and-risk — including review/escalated — so
    source=invoice_flow_pdf appears immediately after PDF extraction.
    """
    from app.services.gulftax_sync_service import _norm_treatment, tax_period_for_date

    inv_id = getattr(invoice, "id", None)
    if inv_id is None:
        return {"ok": False, "error": "missing_invoice_id"}

    # Synthetic classifier-like object so we reuse the PDF pending writer
    class _PseudoTxn:
        pass

    pseudo = _PseudoTxn()
    pseudo.id = f"invflow:{inv_id}"
    pseudo.company_id = getattr(invoice, "company_id", None)
    pseudo.transaction_type = "purchase"
    pseudo.invoice_number = getattr(invoice, "invoice_number", None)
    pseudo.vendor_or_customer = getattr(invoice, "vendor_name", None)
    pseudo.vendor_trn = getattr(invoice, "vendor_trn", None)
    pseudo.vat_treatment = getattr(invoice, "vat_treatment", None) or "standard_rated"
    inv_date = getattr(invoice, "invoice_date", None)
    if isinstance(inv_date, str):
        try:
            inv_date = date.fromisoformat(inv_date[:10])
        except ValueError:
            inv_date = date.today()
    elif not inv_date:
        inv_date = date.today()
    pseudo.date = inv_date

    gross = round(float(getattr(invoice, "total_aed", 0) or 0), 2)
    vat = round(float(getattr(invoice, "vat_amount_aed", 0) or 0), 2)
    if vat > 0 and gross >= vat:
        net = round(gross - vat, 2)
    else:
        # total often stored as net; estimate VAT if standard
        if (pseudo.vat_treatment or "").startswith("standard") and vat <= 0 and gross > 0:
            net = round(gross / 1.05, 2)
            vat = round(gross - net, 2)
        else:
            net = gross
    pseudo.amount_aed = net
    pseudo.vat_amount_aed = vat

    # If amounts are zero, still attempt insert with zeros so the trail exists
    return sync_pdf_txn_to_gulftax_pending(
        db,
        pseudo,
        ported_company=ported_company,
        workspace_id=workspace_id,
    )


def sync_pdf_txn_to_gulftax_pending(
    db: Session,
    classifier_txn: Any,
    *,
    ported_company: Any | None = None,
    workspace_id: str | None = None,
) -> dict[str, Any]:
    """Invoice Flow PDF → gulftax_transactions immediately (status=pending).

    source='invoice_flow_pdf', purchase → fta_box='9', direction='input'.
    """
    from app.models.client_data import GulftaxTransaction
    from app.services.gulftax_sync_service import (
        _norm_treatment,
        tax_period_for_date,
    )

    txn_id = getattr(classifier_txn, "id", None)
    if txn_id is None:
        return {"ok": False, "error": "missing_classifier_txn_id"}

    ap_id = _classifier_ap_invoice_id(f"pdf:{txn_id}")
    finreport_cid, tenant_from_company = _finreport_ids_from_ported_company(ported_company)
    company_id = finreport_cid or str(getattr(classifier_txn, "company_id", "") or "")
    tenant_id = (workspace_id or "").strip() or tenant_from_company or company_id
    if not company_id or not tenant_id:
        return {"ok": False, "error": "company_id_or_tenant_missing"}

    tx_type = (getattr(classifier_txn, "transaction_type", None) or "purchase").lower()
    if tx_type not in ("sale", "purchase"):
        tx_type = "purchase"

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
    net = round(float(getattr(classifier_txn, "amount_aed", 0) or 0), 2)
    vat = round(float(getattr(classifier_txn, "vat_amount_aed", 0) or 0), 2)
    gross = round(net + vat, 2) if vat > 0 else net
    direction = _simple_direction(tx_type)
    fta_box = _simple_fta_box(tx_type)
    vat_category = _norm_treatment(
        getattr(classifier_txn, "vat_treatment", None) or "standard_rated"
    )

    if inv_no:
        existing = (
            db.query(GulftaxTransaction)
            .filter(
                GulftaxTransaction.company_id == company_id,
                GulftaxTransaction.invoice_number == inv_no,
                GulftaxTransaction.source == INVOICE_FLOW_PDF_SOURCE,
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

    try:
        gt = GulftaxTransaction(
            id=str(uuid.uuid4()),
            tenant_id=tenant_id,
            company_id=company_id,
            source=INVOICE_FLOW_PDF_SOURCE,
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
            status="pending",
            designated_zone=False,
            transaction_kind="goods",
            created_at=datetime.utcnow(),
        )
        db.add(gt)
        db.commit()
        db.refresh(gt)
        _upsert_supabase_gulftax_row(
            {
                "company_id": company_id,
                "workspace_id": tenant_id,
                "source": INVOICE_FLOW_PDF_SOURCE,
                "invoice_number": inv_no,
                "tax_period": tax_period,
                "transaction_date": tx_date.isoformat(),
                "vendor_name": gt.vendor_name,
                "vendor_trn": gt.vendor_trn,
                "gross_amount": gross,
                "vat_amount": vat,
                "vat_category": vat_category,
                "fta_box": fta_box,
                "direction": direction,
                "status": "pending",
            }
        )
        _upsert_vat_classifier_transactions_row(
            {
                "company_id": company_id,
                "workspace_id": tenant_id,
                "transaction_type": tx_type,
                "fta_box": fta_box,
                "net_amount": net,
                "vat_amount": vat,
                "gross_amount": gross,
                "invoice_reference": inv_no,
                "vendor_name": gt.vendor_name,
                "source": INVOICE_FLOW_PDF_SOURCE,
                "transaction_date": tx_date,
                "vat_category": vat_category,
            }
        )
        return {
            "ok": True,
            "transaction_id": gt.id,
            "tax_period": tax_period,
            "fta_box": fta_box,
            "status": "pending",
        }
    except Exception as exc:
        db.rollback()
        logger.exception("PDF→gulftax pending sync failed for txn id=%s", txn_id)
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
                elif result.get("ok") and result.get("updated"):
                    synced += 1
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

