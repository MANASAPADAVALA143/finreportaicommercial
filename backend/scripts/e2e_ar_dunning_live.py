#!/usr/bin/env python3
"""Live E2E verification for AR dunning on RDS (or --force-sqlite partial)."""
from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv

load_dotenv(_BACKEND / ".env", override=True)

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.models.client_data import ApCompany
from app.models.uae_accounting_full import UAECustomer, UAESalesInvoice
from app.services.dunning_service import dunning_level, get_dunning_history, run_dunning

E2E_PREFIX = "E2E-DUN-"
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
    if dialect == "postgresql":
        with engine.begin() as conn:
            for col, ddl in [
                ("last_dunning_level", "INTEGER DEFAULT 0"),
                ("last_dunning_sent_at", "TIMESTAMP"),
                ("dunning_count", "INTEGER DEFAULT 0"),
                ("overdue_notified_at", "TIMESTAMP"),
                ("company_id", "VARCHAR(36)"),
            ]:
                conn.execute(text(f"ALTER TABLE uae_sales_invoices ADD COLUMN IF NOT EXISTS {col} {ddl}"))


def _seed(db) -> dict:
    existing = db.query(ApCompany).filter_by(id=COMPANY_ID).first()
    if not existing:
        db.add(
            ApCompany(
                id=COMPANY_ID,
                tenant_id=TENANT,
                name="ABC TRADING LLC",
                slug="abc-trading-e2e-dun",
            )
        )

    cust_email = UAECustomer(
        id=str(uuid.uuid4()),
        tenant_id=TENANT,
        name=f"{E2E_PREFIX}WithEmail",
        email="e2e-dunning@example.com",
    )
    cust_no_email = UAECustomer(
        id=str(uuid.uuid4()),
        tenant_id=TENANT,
        name=f"{E2E_PREFIX}NoEmail",
        email=None,
    )
    db.add_all([cust_email, cust_no_email])
    db.flush()

    bands = [
        ("L1", cust_email, 10, 1),
        ("L2", cust_email, 25, 2),
        ("L3", cust_email, 45, 3),
        ("L4", cust_email, 75, 4),
        ("SKIP", cust_no_email, 20, 2),
    ]
    invoice_ids = []
    for suffix, cust, days_od, expected_level in bands:
        due = AS_OF - timedelta(days=days_od)
        inv = UAESalesInvoice(
            id=str(uuid.uuid4()),
            tenant_id=TENANT,
            company_id=COMPANY_ID,
            customer_id=cust.id,
            invoice_number=f"{E2E_PREFIX}{suffix}",
            invoice_date=due - timedelta(days=30),
            due_date=due,
            subtotal=1000,
            vat_amount=50,
            total_amount=1050,
            outstanding=1050,
            status="overdue",
        )
        db.add(inv)
        invoice_ids.append((inv.id, suffix, expected_level, cust.email is not None))
    db.commit()
    return {"invoice_ids": [i[0] for i in invoice_ids], "bands": bands}


def _cleanup(db, track: dict) -> None:
    db.query(UAESalesInvoice).filter(UAESalesInvoice.invoice_number.like(f"{E2E_PREFIX}%")).delete()
    db.query(UAECustomer).filter(UAECustomer.name.like(f"{E2E_PREFIX}%")).delete()
    db.commit()


def run(allow_sqlite: bool, force_sqlite: bool = False) -> int:
    url, dialect = _db_url(allow_sqlite, force_sqlite)
    if dialect == "none":
        print("BLOCKED: Set DATABASE_URL to RDS PostgreSQL URI.")
        return 2

    print(f"=== E2E AR Dunning ===\nDatabase: {dialect}")
    connect_args = {"check_same_thread": False} if dialect == "sqlite" else {}
    engine = create_engine(url, connect_args=connect_args)
    _ensure_schema(engine, dialect)
    Session = sessionmaker(bind=engine)
    db = Session()
    track: dict = {}

    try:
        track = _seed(db)
        with patch("app.services.dunning_service.send_notification", return_value=True):
            result = run_dunning(db, TENANT, COMPANY_ID, AS_OF)

        hist = get_dunning_history(db, TENANT, COMPANY_ID, as_of=AS_OF)
        e2e_hist = [r for r in hist["invoices"] if r["invoice_number"].startswith(E2E_PREFIX)]

        report = {
            "dialect": dialect,
            "run_result": result,
            "history_rows": e2e_hist,
        }
        print(json.dumps(report, indent=2, default=str))

        if result["sent_count"] != 4:
            print(f"FAIL: expected sent_count=4, got {result['sent_count']}", file=sys.stderr)
            return 1
        if result["skipped_count"] != 1:
            print(f"FAIL: expected skipped_count=1, got {result['skipped_count']}", file=sys.stderr)
            return 1

        levels = {s["invoice_number"]: s["level"] for s in result["sent"]}
        expected = {
            f"{E2E_PREFIX}L1": 1,
            f"{E2E_PREFIX}L2": 2,
            f"{E2E_PREFIX}L3": 3,
            f"{E2E_PREFIX}L4": 4,
        }
        for num, lvl in expected.items():
            if levels.get(num) != lvl:
                print(f"FAIL: {num} expected L{lvl}, got L{levels.get(num)}", file=sys.stderr)
                return 1

        skip = result["skipped"][0]
        if skip["invoice_number"] != f"{E2E_PREFIX}SKIP" or skip["reason"] != "no_email":
            print("FAIL: skip row", skip, file=sys.stderr)
            return 1

        for row in e2e_hist:
            inv_num = row["invoice_number"]
            if inv_num == f"{E2E_PREFIX}SKIP":
                continue
            exp = expected[inv_num]
            if row["last_dunning_level"] != exp or row["dunning_count"] != 1:
                print(f"FAIL: history {inv_num}", row, file=sys.stderr)
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
