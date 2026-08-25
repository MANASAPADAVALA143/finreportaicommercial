#!/usr/bin/env python3
"""Live E2E verification for AR customer risk on RDS (or --allow-sqlite partial)."""
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

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.models.client_data import ApCompany
from app.models.uae_accounting_full import UAECreditNote, UAECustomer, UAESalesInvoice
from app.services.ar_customer_risk_service import compute_customer_risk

E2E_PREFIX = "E2E-RISK-"
TENANT = "59818b25-a981-4fe4-9a1f-7ffaafecef13"
COMPANY_ID = "e26d6523-d86b-4e77-8e16-23f251304480"
AS_OF = date.today()


def _db_url(allow_sqlite: bool, force_sqlite: bool = False) -> tuple[str, str]:
    if force_sqlite and allow_sqlite:
        path = _BACKEND / "finreportai.db"
        return f"sqlite:///{path.as_posix()}", "sqlite"
    url = (os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL") or "").strip()
    if url.startswith("postgresql"):
        return url, "postgresql"
    if allow_sqlite:
        path = _BACKEND / "finreportai.db"
        return f"sqlite:///{path.as_posix()}", "sqlite"
    return "", "none"


def _ensure_schema(engine, dialect: str) -> None:
    ApCompany.__table__.create(engine, checkfirst=True)
    UAECreditNote.__table__.create(engine, checkfirst=True)
    if dialect == "postgresql":
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE uae_sales_invoices ADD COLUMN IF NOT EXISTS company_id VARCHAR(36)"))


def _seed(db) -> dict:
    existing = db.query(ApCompany).filter_by(id=COMPANY_ID).first()
    if not existing:
        db.add(
            ApCompany(
                id=COMPANY_ID,
                tenant_id=TENANT,
                name="ABC TRADING LLC",
                slug="abc-trading-e2e-risk",
            )
        )

    custs = {}
    for label, suffix in [("Low", "low"), ("High", "high"), ("Critical", "crit")]:
        c = UAECustomer(
            id=str(uuid.uuid4()),
            tenant_id=TENANT,
            name=f"{E2E_PREFIX}{label}",
        )
        db.add(c)
        custs[suffix] = c
    db.flush()

    inv_low = UAESalesInvoice(
        id=str(uuid.uuid4()),
        tenant_id=TENANT,
        company_id=COMPANY_ID,
        customer_id=custs["low"].id,
        invoice_number=f"{E2E_PREFIX}INV-LOW",
        invoice_date=AS_OF - timedelta(days=5),
        due_date=AS_OF + timedelta(days=25),
        subtotal=1000,
        vat_amount=50,
        total_amount=1050,
        outstanding=1050,
        status="sent",
    )
    inv_high = UAESalesInvoice(
        id=str(uuid.uuid4()),
        tenant_id=TENANT,
        company_id=COMPANY_ID,
        customer_id=custs["high"].id,
        invoice_number=f"{E2E_PREFIX}INV-HIGH",
        invoice_date=AS_OF - timedelta(days=70),
        due_date=AS_OF - timedelta(days=40),
        subtotal=2000,
        vat_amount=100,
        total_amount=2100,
        outstanding=2100,
        status="overdue",
    )
    inv_crit = UAESalesInvoice(
        id=str(uuid.uuid4()),
        tenant_id=TENANT,
        company_id=COMPANY_ID,
        customer_id=custs["crit"].id,
        invoice_number=f"{E2E_PREFIX}INV-CRIT",
        invoice_date=AS_OF - timedelta(days=120),
        due_date=AS_OF - timedelta(days=95),
        subtotal=500,
        vat_amount=25,
        total_amount=525,
        outstanding=525,
        status="overdue",
    )
    db.add_all([inv_low, inv_high, inv_crit])

    db.add(
        UAESalesInvoice(
            id=str(uuid.uuid4()),
            tenant_id=TENANT,
            company_id=COMPANY_ID,
            customer_id=custs["high"].id,
            invoice_number=f"{E2E_PREFIX}PAID",
            invoice_date=date(2026, 1, 1),
            due_date=date(2026, 1, 31),
            subtotal=100,
            vat_amount=5,
            total_amount=105,
            paid_amount=105,
            outstanding=0,
            status="paid",
            paid_date=date(2026, 1, 15),
        )
    )
    db.add(
        UAECreditNote(
            id=str(uuid.uuid4()),
            tenant_id=TENANT,
            company_id=COMPANY_ID,
            customer_id=custs["high"].id,
            parent_invoice_id=inv_high.id,
            credit_note_number=f"{E2E_PREFIX}CN-1",
            amount=250,
            status="issued",
            issued_date=AS_OF,
        )
    )
    db.commit()

    return {
        "customer_ids": {k: v.id for k, v in custs.items()},
        "invoice_ids": [inv_low.id, inv_high.id, inv_crit.id],
    }


def _cleanup(db, track: dict) -> None:
    for iid in track.get("invoice_ids", []):
        db.query(UAECreditNote).filter(UAECreditNote.parent_invoice_id == iid).delete()
    db.query(UAECreditNote).filter(UAECreditNote.credit_note_number.like(f"{E2E_PREFIX}%")).delete()
    db.query(UAESalesInvoice).filter(UAESalesInvoice.invoice_number.like(f"{E2E_PREFIX}%")).delete()
    for cid in track.get("customer_ids", {}).values():
        db.query(UAECustomer).filter_by(id=cid).delete()
    db.commit()


def run(allow_sqlite: bool, force_sqlite: bool = False) -> int:
    url, dialect = _db_url(allow_sqlite, force_sqlite)
    if dialect == "none":
        print("BLOCKED: Set DATABASE_URL to RDS PostgreSQL URI.")
        return 2

    print(f"=== E2E AR Customer Risk ===\nDatabase: {dialect}")
    connect_args = {"check_same_thread": False} if dialect == "sqlite" else {}
    engine = create_engine(url, connect_args=connect_args)
    _ensure_schema(engine, dialect)
    Session = sessionmaker(bind=engine)
    db = Session()
    track: dict = {}

    try:
        track = _seed(db)
        report = compute_customer_risk(db, TENANT, COMPANY_ID, AS_OF)
        e2e_rows = [c for c in report["customers"] if (c.get("customer_name") or "").startswith(E2E_PREFIX)]
        print(json.dumps({"dialect": dialect, "e2e_customers": e2e_rows, "full_report_count": report["customer_count"]}, indent=2))

        if len(e2e_rows) < 3:
            print("FAIL: expected 3 E2E customers in report", file=sys.stderr)
            return 1

        by_name = {r["customer_name"]: r for r in e2e_rows}
        high = by_name.get(f"{E2E_PREFIX}High")
        if not high or high["risk_tier"] != "high":
            print("FAIL: High customer risk tier", file=sys.stderr)
            return 1
        if high.get("credit_notes_count", 0) != 1 or high.get("total_credited") != 250:
            print("FAIL: credit note stats", high, file=sys.stderr)
            return 1
        if high.get("avg_days_to_pay") != 14.0:
            print("FAIL: avg_days_to_pay expected 14", high, file=sys.stderr)
            return 1

        crit = by_name.get(f"{E2E_PREFIX}Critical")
        if not crit or crit["risk_tier"] != "critical":
            print("FAIL: Critical customer", file=sys.stderr)
            return 1

        if dialect == "sqlite":
            print("\n*** PARTIAL - SQLite, not merge-ready ***")
            return 3
        return 0
    finally:
        try:
            _cleanup(db, track)
            print("\nCleanup: E2E data removed.")
        except Exception as exc:
            print(f"Cleanup warning: {exc}", file=sys.stderr)
        db.close()


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--allow-sqlite", action="store_true")
    p.add_argument(
        "--force-sqlite",
        action="store_true",
        help="Skip PostgreSQL even if DATABASE_URL is set (partial local verification)",
    )
    args = p.parse_args()
    return run(args.allow_sqlite or args.force_sqlite, args.force_sqlite)


if __name__ == "__main__":
    raise SystemExit(main())
