#!/usr/bin/env python3
"""
Live E2E verification for AR credit notes — real create_journal_entry + real GulfTax sync.

Requires PostgreSQL DATABASE_URL (preferred) or --allow-sqlite for partial local verification.
Exits non-zero if PostgreSQL was required but unavailable.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from datetime import date, timedelta
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv

load_dotenv(_BACKEND / ".env", override=True)

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models.client_data import ApCompany, GulftaxTransaction
from app.models.uae_accounting_full import (
    UAECreditNote,
    UAECustomer,
    UAEJournalEntry,
    UAEJournalLine,
    UAESalesInvoice,
    UAESalesInvoiceLine,
    UAEAccount,
)
from app.services.ar_aging_service import compute_ar_aging
from app.services.ar_gulftax_sync_service import _void_ap_invoice_id
from app.services.ar_invoice_post_service import post_sales_invoice_to_gl_and_tax
from app.services.credit_note_service import issue_credit_note, void_credit_note

E2E_PREFIX = "E2E-CN-"
TENANT = "59818b25-a981-4fe4-9a1f-7ffaafecef13"
COMPANY_ID = "e26d6523-d86b-4e77-8e16-23f251304480"  # ABC TRADING LLC in Supabase companies


def _db_url(allow_sqlite: bool) -> tuple[str, str]:
    url = (os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL") or "").strip()
    if url.startswith("postgresql"):
        return url, "postgresql"
    if allow_sqlite:
        path = _BACKEND / "finreportai.db"
        if not path.exists():
            path = _BACKEND / "e2e_credit_notes_live.db"
        return f"sqlite:///{path.as_posix()}", "sqlite"
    return "", "none"


def _ensure_schema(engine, dialect: str) -> None:
    # RDS may be bootstrap-managed without alembic_version; create only missing tables.
    ApCompany.__table__.create(engine, checkfirst=True)
    UAECreditNote.__table__.create(engine, checkfirst=True)
    GulftaxTransaction.__table__.create(engine, checkfirst=True)
    # Period control table — empty means all periods open (assert_period_open no-ops).
    # Avoid model create (FKs to workspaces / uae_company_profiles may be absent).
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS accounting_periods (
                    id VARCHAR(36) PRIMARY KEY,
                    workspace_id VARCHAR(36) NOT NULL,
                    company_id VARCHAR(36),
                    period_number INTEGER NOT NULL,
                    period_name VARCHAR(32) NOT NULL,
                    start_date DATE NOT NULL,
                    end_date DATE NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'open',
                    locked_by VARCHAR(36),
                    locked_at TIMESTAMP,
                    created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
                )
                """
            )
        )


def _seed_basics(db) -> UAECustomer:
    existing = db.query(ApCompany).filter_by(id=COMPANY_ID).first()
    if not existing:
        db.add(
            ApCompany(
                id=COMPANY_ID,
                tenant_id=TENANT,
                name="ABC TRADING LLC",
                slug="abc-trading-e2e",
            )
        )
    cust = UAECustomer(
        id=str(uuid.uuid4()),
        tenant_id=TENANT,
        name=f"{E2E_PREFIX}Customer",
    )
    db.add(cust)
    # JE lines carry account_code/name directly — no CoA seed required.
    db.commit()
    return cust


def _create_and_post_invoice(db, cust: UAECustomer, label: str) -> UAESalesInvoice:
    inv_date = date.today()
    subtotal = 1000.0
    vat = 50.0
    total = 1050.0
    inv = UAESalesInvoice(
        id=str(uuid.uuid4()),
        tenant_id=TENANT,
        company_id=COMPANY_ID,
        invoice_number=f"{E2E_PREFIX}{label}-{uuid.uuid4().hex[:8]}",
        customer_id=cust.id,
        invoice_date=inv_date,
        due_date=inv_date + timedelta(days=30),
        period=inv_date.strftime("%Y-%m"),
        subtotal=subtotal,
        vat_amount=vat,
        total_amount=total,
        paid_amount=0,
        outstanding=total,
        status="draft",
        supply_type="standard",
    )
    db.add(inv)
    db.flush()
    db.add(
        UAESalesInvoiceLine(
            id=str(uuid.uuid4()),
            invoice_id=inv.id,
            description="E2E line",
            quantity=1,
            unit_price=subtotal,
            vat_rate=5,
            vat_amount=vat,
            line_total=total,
        )
    )
    db.flush()

    result = post_sales_invoice_to_gl_and_tax(
        inv.id,
        tenant_id=TENANT,
        company_id=COMPANY_ID,
        db=db,
    )
    if not result.get("ok"):
        raise RuntimeError(f"post_sales_invoice_to_gl_and_tax failed: {result}")
    db.refresh(inv)
    return inv


def _fetch_je(db, je_id: str) -> dict:
    je = db.get(UAEJournalEntry, je_id)
    lines = (
        db.query(UAEJournalLine)
        .filter(UAEJournalLine.journal_entry_id == je_id)
        .order_by(UAEJournalLine.account_code)
        .all()
    )
    return {
        "id": je.id,
        "entry_number": je.entry_number,
        "source": je.source,
        "reference": je.reference,
        "status": je.status,
        "lines": [
            {
                "account_code": l.account_code,
                "account_name": l.account_name,
                "debit": float(l.debit or 0),
                "credit": float(l.credit or 0),
            }
            for l in lines
        ],
    }


def _fetch_gulftax(db, ap_invoice_id: str) -> list[dict]:
    rows = (
        db.query(GulftaxTransaction)
        .filter(GulftaxTransaction.ap_invoice_id == ap_invoice_id)
        .all()
    )
    return [
        {
            "id": r.id,
            "source": r.source,
            "ap_invoice_id": r.ap_invoice_id,
            "company_id": r.company_id,
            "tax_period": r.tax_period,
            "invoice_number": r.invoice_number,
            "gross_amount": float(r.gross_amount or 0),
            "vat_amount": float(r.vat_amount or 0),
            "direction": r.direction,
            "status": r.status,
        }
        for r in rows
    ]


def _gulftax_ar_count(db) -> int:
    return (
        db.query(GulftaxTransaction)
        .filter(
            GulftaxTransaction.source == "ar_sales",
            GulftaxTransaction.company_id == COMPANY_ID,
        )
        .count()
    )


def _cleanup(db, ids: dict) -> None:
    for ref in ids.get("gulftax_refs", []):
        db.query(GulftaxTransaction).filter(GulftaxTransaction.ap_invoice_id == ref).delete()
    for cn_id in ids.get("credit_note_ids", []):
        db.query(UAECreditNote).filter_by(id=cn_id).delete()
    for je_id in ids.get("je_ids", []):
        db.query(UAEJournalLine).filter(UAEJournalLine.journal_entry_id == je_id).delete()
        db.query(UAEJournalEntry).filter_by(id=je_id).delete()
    for inv_id in ids.get("invoice_ids", []):
        db.query(UAESalesInvoiceLine).filter_by(invoice_id=inv_id).delete()
        db.query(UAESalesInvoice).filter_by(id=inv_id).delete()
    if ids.get("customer_id"):
        db.query(UAECustomer).filter_by(id=ids["customer_id"]).delete()
    # Remove CoA accounts seeded for this company if they were E2E-only (skip — shared)
    db.commit()


def run(allow_sqlite: bool) -> int:
    url, dialect = _db_url(allow_sqlite)
    if dialect == "none":
        print("BLOCKED: No PostgreSQL DATABASE_URL or SUPABASE_DB_URL configured.")
        print("  Set DATABASE_URL=postgresql://... in backend/.env (RDS or local Postgres).")
        print("  Local Postgres 18 is running but credentials are unknown on this machine.")
        print("  Pass --allow-sqlite only for partial GL/GulfTax verification (not merge-ready).")
        return 2

    print(f"=== E2E Credit Notes Live Test ===")
    print(f"Database: {dialect} ({url.split('@')[-1] if '@' in url else url})")

    connect_args = {"check_same_thread": False} if dialect == "sqlite" else {}
    engine = create_engine(url, connect_args=connect_args)
    _ensure_schema(engine, dialect)
    Session = sessionmaker(bind=engine)
    db = Session()

    track: dict = {
        "invoice_ids": [],
        "credit_note_ids": [],
        "je_ids": [],
        "gulftax_refs": [],
        "customer_id": None,
    }
    report: dict = {"dialect": dialect, "steps": []}

    try:
        cust = _seed_basics(db)
        track["customer_id"] = cust.id
        gt_before = _gulftax_ar_count(db)
        report["gulftax_ar_sales_count_before"] = gt_before

        # --- Step 2+3: Posted invoice + partial credit note ---
        inv1 = _create_and_post_invoice(db, cust, "INV1")
        track["invoice_ids"].append(inv1.id)
        track["je_ids"].append(inv1.journal_entry_id)
        track["gulftax_refs"].append(inv1.id)

        orig_je = _fetch_je(db, inv1.journal_entry_id)
        inv1_gt = _fetch_gulftax(db, inv1.id)
        report["steps"].append({
            "step": "seed_invoice_1",
            "invoice": inv1.invoice_number,
            "orig_je": orig_je,
            "gulftax_rows": inv1_gt,
        })

        aging_before = compute_ar_aging(db, TENANT, COMPANY_ID)
        partial = issue_credit_note(
            db, inv1.id, 500.0, "E2E partial CN",
            tenant_id=TENANT, company_id=COMPANY_ID,
        )
        if not partial.get("ok"):
            raise RuntimeError(f"partial CN failed: {partial}")
        cn1_id = partial["credit_note"]["id"]
        track["credit_note_ids"].append(cn1_id)
        track["je_ids"].append(partial["je_id"])
        track["gulftax_refs"].append(cn1_id)

        db.refresh(inv1)
        cn_je = _fetch_je(db, partial["je_id"])
        gt_cn = _fetch_gulftax(db, cn1_id)
        aging_after_partial = compute_ar_aging(db, TENANT, COMPANY_ID)

        report["steps"].append({
            "step": "partial_credit_note",
            "outstanding_after": float(inv1.outstanding),
            "aging_total_before": aging_before["total_outstanding"],
            "aging_total_after": aging_after_partial["total_outstanding"],
            "aging_invoices_after": len(aging_after_partial["invoices"]),
            "cn_je": cn_je,
            "gulftax_rows": gt_cn,
            "gulftax_sync": partial.get("gulftax"),
        })

        # --- Step 4: Full credit note on second invoice ---
        inv2 = _create_and_post_invoice(db, cust, "INV2")
        track["invoice_ids"].append(inv2.id)
        track["je_ids"].append(inv2.journal_entry_id)
        track["gulftax_refs"].append(inv2.id)

        full = issue_credit_note(
            db, inv2.id, 1050.0, "E2E full CN",
            tenant_id=TENANT, company_id=COMPANY_ID,
        )
        if not full.get("ok"):
            raise RuntimeError(f"full CN failed: {full}")
        cn2_id = full["credit_note"]["id"]
        track["credit_note_ids"].append(cn2_id)
        track["je_ids"].append(full["je_id"])
        track["gulftax_refs"].append(cn2_id)

        db.refresh(inv2)
        aging_after_full = compute_ar_aging(db, TENANT, COMPANY_ID)
        report["steps"].append({
            "step": "full_credit_note",
            "invoice_status": inv2.status,
            "outstanding_after": float(inv2.outstanding),
            "aging_total": aging_after_full["total_outstanding"],
            "aging_invoice_count": len(aging_after_full["invoices"]),
            "cn_je": _fetch_je(db, full["je_id"]),
            "gulftax_rows": _fetch_gulftax(db, cn2_id),
            "gulftax_sync": full.get("gulftax"),
        })

        # --- Step 5: Void partial CN (inv1 still has outstanding) ---
        void_ok = void_credit_note(db, cn1_id, tenant_id=TENANT)
        if not void_ok.get("ok"):
            raise RuntimeError(f"void failed: {void_ok}")
        void_ref = _void_ap_invoice_id(cn1_id)
        track["je_ids"].append(void_ok["je_id"])
        track["gulftax_refs"].append(void_ref)
        db.refresh(inv1)
        report["steps"].append({
            "step": "void_credit_note",
            "outstanding_after_void": float(inv1.outstanding),
            "void_je": _fetch_je(db, void_ok["je_id"]),
            "void_ap_invoice_id": void_ref,
            "gulftax_void_rows": _fetch_gulftax(db, void_ref),
            "gulftax_sync": void_ok.get("gulftax"),
        })

        # --- Step 6: 409 block when paid after CN ---
        inv3 = _create_and_post_invoice(db, cust, "INV3")
        track["invoice_ids"].append(inv3.id)
        track["je_ids"].append(inv3.journal_entry_id)
        track["gulftax_refs"].append(inv3.id)

        issue3 = issue_credit_note(
            db, inv3.id, 500.0, "E2E block test CN",
            tenant_id=TENANT, company_id=COMPANY_ID,
        )
        cn3_id = issue3["credit_note"]["id"]
        track["credit_note_ids"].append(cn3_id)
        track["je_ids"].append(issue3["je_id"])
        track["gulftax_refs"].append(cn3_id)

        inv3.paid_amount = 550
        inv3.outstanding = 0
        inv3.status = "paid"
        db.commit()
        block = void_credit_note(db, cn3_id, tenant_id=TENANT)
        report["steps"].append({
            "step": "void_blocked_409",
            "ok": block.get("ok"),
            "error": block.get("error"),
            "message": block.get("message"),
        })

        gt_after = _gulftax_ar_count(db)
        report["gulftax_ar_sales_count_after"] = gt_after
        report["gulftax_ar_sales_rows_added"] = gt_after - gt_before

        print(json.dumps(report, indent=2, default=str))

        # Fail if any GulfTax write failed
        for step in report["steps"]:
            sync = step.get("gulftax_sync")
            if isinstance(sync, dict) and sync.get("ok") is False:
                print("\nFAIL: GulfTax sync returned ok=false", file=sys.stderr)
                return 1
            rows = step.get("gulftax_rows") or step.get("gulftax_void_rows")
            if rows is not None and step["step"] in (
                "seed_invoice_1",
                "partial_credit_note",
                "full_credit_note",
                "void_credit_note",
            ):
                if not rows or (isinstance(rows[0], dict) and rows[0].get("_fetch_error")):
                    print(f"\nFAIL: missing gulftax rows for {step['step']}", file=sys.stderr)
                    return 1

        if dialect == "sqlite":
            print("\n*** PARTIAL ONLY — SQLite fallback, NOT merge-ready per E2E spec (Postgres required) ***")
            return 3
        return 0

    finally:
        try:
            _cleanup(db, track)
            print("\nCleanup: test data removed.")
        except Exception as exc:
            print(f"\nCleanup warning: {exc}", file=sys.stderr)
        db.close()


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--allow-sqlite",
        action="store_true",
        help="Run against disposable SQLite if no PostgreSQL URL (partial — not merge-ready)",
    )
    args = p.parse_args()
    return run(args.allow_sqlite)


if __name__ == "__main__":
    raise SystemExit(main())
