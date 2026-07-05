"""Sync AR sales invoices / credit notes into RDS gulftax_transactions (output VAT).

AR documents live on RDS (uae_sales_invoices / uae_credit_notes). Supabase
gulftax_transactions.ap_invoice_id FKs to invoices(id), so AR IDs can never
satisfy that constraint. Writes go to the RDS GulftaxTransaction model instead
(no FK; ap_invoice_id is VARCHAR(36)).
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.client_data import GulftaxTransaction
from app.models.uae_accounting_full import UAESalesInvoice

logger = logging.getLogger(__name__)

# Deterministic UUID for void offsetting rows — valid UUID, not "{id}-void".
_VOID_NS = uuid.UUID("a7c3e9f1-4b2d-4e8a-9c1f-6d5e4b3a2c10")


def _void_ap_invoice_id(credit_note_id: str) -> str:
    return str(uuid.uuid5(_VOID_NS, f"ar-credit-note-void:{credit_note_id}"))


def _existing_ar_in_gulftax(db: Session, ap_invoice_id: str) -> GulftaxTransaction | None:
    return (
        db.query(GulftaxTransaction)
        .filter(
            GulftaxTransaction.ap_invoice_id == ap_invoice_id,
            GulftaxTransaction.direction == "output",
            GulftaxTransaction.status == "posted",
            GulftaxTransaction.source == "ar_sales",
        )
        .first()
    )


def _supply_to_vat_treatment(supply_type: str | None) -> str:
    t = (supply_type or "standard").lower().replace("-", "_")
    if t in ("zero", "zero_rated"):
        return "zero_rated"
    if t == "exempt":
        return "exempt"
    return "standard_rated"


def _company_filing_frequency(company_id: str) -> str:
    try:
        from app.services.gulftax_sync_service import _fetch_company_config

        company = _fetch_company_config(company_id)
        return company.get("vat_filing_frequency") or "quarterly"
    except Exception:
        return "quarterly"


def build_ar_transaction_row(
    inv: UAESalesInvoice,
    *,
    customer_name: str,
    company_id: str,
    workspace_id: str,
) -> dict[str, Any]:
    from app.services.gulftax_sync_service import (
        _fta_box,
        _norm_treatment,
        tax_period_for_date,
    )

    inv_date = inv.invoice_date or date.today()
    filing = _company_filing_frequency(company_id)
    tax_period = tax_period_for_date(inv_date, filing)

    gross = round(float(inv.total_amount or 0), 2)
    vat = round(float(inv.vat_amount or 0), 2)
    subtotal = round(float(inv.subtotal or 0), 2)
    if vat <= 0 and gross > 0 and subtotal > 0:
        vat = round(gross - subtotal, 2)

    vat_category = _norm_treatment(_supply_to_vat_treatment(inv.supply_type))
    fta_box = _fta_box(vat_category, "output")

    return {
        "tenant_id": workspace_id or inv.tenant_id,
        "source": "ar_sales",
        "ap_invoice_id": inv.id,
        "company_id": company_id,
        "tax_period": tax_period,
        "transaction_date": inv_date,
        "vendor_name": customer_name,
        "vendor_trn": inv.buyer_trn,
        "invoice_number": inv.invoice_number,
        "gross_amount": gross,
        "vat_amount": vat,
        "vat_category": vat_category,
        "fta_box": fta_box,
        "direction": "output",
        "status": "posted",
    }


def _insert_rds_row(db: Session, row: dict[str, Any]) -> GulftaxTransaction:
    tx = GulftaxTransaction(
        id=str(uuid.uuid4()),
        tenant_id=row["tenant_id"],
        company_id=row["company_id"],
        source=row["source"],
        ap_invoice_id=row["ap_invoice_id"],
        tax_period=row["tax_period"],
        transaction_date=row["transaction_date"],
        vendor_name=row.get("vendor_name"),
        vendor_trn=row.get("vendor_trn"),
        invoice_number=row.get("invoice_number"),
        gross_amount=row["gross_amount"],
        vat_amount=row["vat_amount"],
        vat_category=row["vat_category"],
        fta_box=row.get("fta_box"),
        direction=row.get("direction", "output"),
        status=row.get("status", "posted"),
        created_at=datetime.utcnow(),
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)
    return tx


def sync_ar_invoice_to_gulftax(
    db: Session,
    sales_invoice_id: str,
    company_id: str,
    *,
    workspace_id: str | None = None,
) -> dict[str, Any]:
    """Insert one posted AR sales invoice into RDS gulftax_transactions (idempotent)."""
    if not sales_invoice_id or not company_id:
        return {"ok": False, "error": "sales_invoice_id and company_id required"}

    existing = _existing_ar_in_gulftax(db, sales_invoice_id)
    if existing:
        return {
            "ok": True,
            "skipped": True,
            "reason": "already_synced",
            "transaction_id": existing.id,
        }

    inv = db.query(UAESalesInvoice).filter_by(id=sales_invoice_id).first()
    if not inv:
        return {"ok": False, "error": "sales_invoice_not_found"}

    if (inv.status or "") not in ("posted", "sent", "partial", "paid", "overdue"):
        return {"ok": False, "error": f"invoice_not_posted:{inv.status}"}

    customer_name = inv.customer.name if inv.customer else "Customer"
    row = build_ar_transaction_row(
        inv,
        customer_name=customer_name,
        company_id=company_id,
        workspace_id=workspace_id or inv.tenant_id,
    )

    try:
        tx = _insert_rds_row(db, row)
        return {
            "ok": True,
            "transaction_id": tx.id,
            "tax_period": row["tax_period"],
            "fta_box": row["fta_box"],
            "company_id": company_id,
            "store": "rds",
            "gross_amount": row["gross_amount"],
            "vat_amount": row["vat_amount"],
        }
    except Exception as exc:
        logger.exception("AR gulftax sync failed for sales invoice %s", sales_invoice_id)
        db.rollback()
        return {"ok": False, "error": str(exc)}


def sync_ar_credit_note_to_gulftax(
    db: Session,
    credit_note: Any,
    parent_invoice: UAESalesInvoice,
    *,
    customer_name: str,
    company_id: str,
    workspace_id: str,
    net_amount: float,
    vat_amount: float,
    void: bool = False,
) -> dict[str, Any]:
    """Post offsetting output VAT row for an AR credit note (negative on issue, positive on void).

    Issue uses credit_note.id as ap_invoice_id.
    Void uses a deterministic UUID5 derived from credit_note.id (never '{id}-void').
    """
    cn = credit_note
    gross_abs = round(abs(float(cn.amount or 0)), 2)
    vat_abs = round(abs(float(vat_amount or 0)), 2)
    sign = 1 if void else -1
    ref_id = _void_ap_invoice_id(cn.id) if void else cn.id

    try:
        from app.services.gulftax_sync_service import (
            _fta_box,
            _norm_treatment,
            tax_period_for_date,
        )

        existing = _existing_ar_in_gulftax(db, ref_id)
        if existing:
            return {
                "ok": True,
                "skipped": True,
                "reason": "already_synced",
                "transaction_id": existing.id,
            }

        tx_date = date.today() if void else (cn.issued_date or date.today())
        filing = _company_filing_frequency(company_id)
        tax_period = tax_period_for_date(tx_date, filing)
        vat_category = _norm_treatment(_supply_to_vat_treatment(parent_invoice.supply_type))
        fta_box = _fta_box(vat_category, "output")

        row = {
            "tenant_id": workspace_id or parent_invoice.tenant_id,
            "source": "ar_sales",
            "ap_invoice_id": ref_id,
            "company_id": company_id,
            "tax_period": tax_period,
            "transaction_date": tx_date,
            "vendor_name": customer_name,
            "vendor_trn": parent_invoice.buyer_trn,
            "invoice_number": (
                cn.credit_note_number if not void else f"VOID-{cn.credit_note_number}"
            ),
            "gross_amount": round(sign * gross_abs, 2),
            "vat_amount": round(sign * vat_abs, 2),
            "vat_category": vat_category,
            "fta_box": fta_box,
            "direction": "output",
            "status": "posted",
        }

        tx = _insert_rds_row(db, row)
        return {
            "ok": True,
            "transaction_id": tx.id,
            "tax_period": tax_period,
            "gross_amount": row["gross_amount"],
            "vat_amount": row["vat_amount"],
            "ap_invoice_id": ref_id,
            "store": "rds",
            "void": void,
        }
    except Exception as exc:
        logger.exception("AR credit note gulftax sync failed for %s", cn.credit_note_number)
        db.rollback()
        return {"ok": False, "error": str(exc)}
