#!/usr/bin/env python3
"""Live E2E verification for AR recurring invoices on RDS (or --force-sqlite partial)."""
from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from datetime import date
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv

load_dotenv(_BACKEND / ".env", override=True)

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.models.client_data import ApCompany
from app.models.uae_accounting_full import UAECustomer, UAERecurringInvoice, UAESalesInvoice
from app.services.recurring_invoice_service import create_template, generate_due_invoices

E2E_PREFIX = "E2E-REC-"
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
    UAECustomer.__table__.create(engine, checkfirst=True)
    UAERecurringInvoice.__table__.create(engine, checkfirst=True)
    UAESalesInvoice.__table__.create(engine, checkfirst=True)
    with engine.begin() as conn:
        if dialect == "sqlite":
            cols = {r[1] for r in conn.execute(text("PRAGMA table_info(uae_sales_invoices)")).fetchall()}
            if "recurring_template_id" not in cols:
                conn.execute(text("ALTER TABLE uae_sales_invoices ADD COLUMN recurring_template_id VARCHAR(36)"))
        else:
            conn.execute(text("ALTER TABLE uae_sales_invoices ADD COLUMN IF NOT EXISTS recurring_template_id VARCHAR(36)"))


def _seed(db) -> dict:
    existing = db.query(ApCompany).filter_by(id=COMPANY_ID).first()
    if not existing:
        db.add(
            ApCompany(
                id=COMPANY_ID,
                tenant_id=TENANT,
                name="ABC TRADING LLC",
                slug="abc-trading-e2e-rec",
            )
        )

    cust = UAECustomer(
        id=str(uuid.uuid4()),
        tenant_id=TENANT,
        name=f"{E2E_PREFIX}Customer",
        email="e2e-recurring@example.com",
        payment_terms_days=30,
    )
    db.add(cust)
    db.commit()

    tpl = create_template(
        db,
        tenant_id=TENANT,
        company_id=COMPANY_ID,
        customer_id=cust.id,
        description=f"{E2E_PREFIX}Monthly service",
        amount=2000.0,
        vat_rate=5.0,
        recurrence_type="monthly",
        interval=1,
        start_date=AS_OF,
    )
    return {"customer_id": cust.id, "template_id": tpl["id"]}


def _cleanup(db, track: dict) -> None:
    db.query(UAESalesInvoice).filter(UAESalesInvoice.invoice_number.like(f"{E2E_PREFIX}%")).delete(synchronize_session=False)
    db.query(UAESalesInvoice).filter(
        UAESalesInvoice.recurring_template_id.in_(
            db.query(UAERecurringInvoice.id).filter(UAERecurringInvoice.description.like(f"{E2E_PREFIX}%"))
        )
    ).delete(synchronize_session=False)
    db.query(UAERecurringInvoice).filter(UAERecurringInvoice.description.like(f"{E2E_PREFIX}%")).delete()
    db.query(UAECustomer).filter(UAECustomer.name.like(f"{E2E_PREFIX}%")).delete()
    db.commit()


def run(allow_sqlite: bool, force_sqlite: bool = False) -> int:
    url, dialect = _db_url(allow_sqlite, force_sqlite)
    if dialect == "none":
        print("BLOCKED: Set DATABASE_URL to RDS PostgreSQL URI.")
        return 2

    print(f"=== E2E AR Recurring Invoices ===\nDatabase: {dialect}")
    connect_args = {"check_same_thread": False} if dialect == "sqlite" else {}
    engine = create_engine(url, connect_args=connect_args)
    _ensure_schema(engine, dialect)
    Session = sessionmaker(bind=engine)
    db = Session()
    track: dict = {}

    try:
        _cleanup(db, {})
        track = _seed(db)
        result = generate_due_invoices(db, TENANT, AS_OF, COMPANY_ID)
        e2e_generated = [g for g in result["generated"] if g["template_id"] == track["template_id"]]

        tpl = db.query(UAERecurringInvoice).filter_by(id=track["template_id"]).first()
        inv = (
            db.query(UAESalesInvoice)
            .filter(UAESalesInvoice.recurring_template_id == track["template_id"])
            .first()
        )

        report = {
            "dialect": dialect,
            "generate_result": {**result, "e2e_generated": e2e_generated},
            "template": {
                "id": tpl.id if tpl else None,
                "next_due_date": str(tpl.next_due_date) if tpl else None,
                "generated_count": tpl.generated_count if tpl else None,
                "status": tpl.status if tpl else None,
            },
            "invoice": {
                "invoice_number": inv.invoice_number if inv else None,
                "customer_id": inv.customer_id if inv else None,
                "subtotal": float(inv.subtotal) if inv else None,
                "vat_amount": float(inv.vat_amount) if inv else None,
                "total_amount": float(inv.total_amount) if inv else None,
                "status": inv.status if inv else None,
                "recurring_template_id": inv.recurring_template_id if inv else None,
            },
        }
        print(json.dumps(report, indent=2, default=str))

        if len(e2e_generated) != 1:
            print(f"FAIL: expected 1 E2E invoice, got {len(e2e_generated)}", file=sys.stderr)
            return 1
        if not inv or inv.status != "draft":
            print("FAIL: invoice not draft", file=sys.stderr)
            return 1
        if float(inv.subtotal) != 2000.0 or float(inv.vat_amount) != 100.0:
            print("FAIL: amounts", file=sys.stderr)
            return 1
        if tpl.generated_count != 1:
            print("FAIL: generated_count on template", file=sys.stderr)
            return 1
        if str(tpl.next_due_date) <= str(AS_OF):
            print("FAIL: next_due_date not advanced", file=sys.stderr)
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
    p.add_argument("--force-sqlite", action="store_true")
    args = p.parse_args()
    return run(args.allow_sqlite or args.force_sqlite, args.force_sqlite)


if __name__ == "__main__":
    raise SystemExit(main())
