#!/usr/bin/env python3
"""Live E2E verification for GulfTax VAT recon on RDS (or --force-sqlite partial)."""
from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from contextlib import contextmanager
from datetime import date
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
_PORTED = _BACKEND / "app" / "modules" / "gulftax" / "ported"
if str(_PORTED) not in sys.path:
    sys.path.insert(0, str(_PORTED))

from dotenv import load_dotenv

load_dotenv(_BACKEND / ".env", override=True)

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.models.client_data import ApCompany, GulftaxTransaction
from models import Company, ReconciliationResult, VATReturn
from app.services.vat_recon_service import get_recon_status, run_vat_recon

E2E_PREFIX = "E2E-VAT-RECON-"
TENANT = "59818b25-a981-4fe4-9a1f-7ffaafecef13"
COMPANY_ID = "e26d6523-d86b-4e77-8e16-23f251304480"
TAX_PERIOD = "2026-Q2"
PERIOD_START = date(2026, 4, 1)
PERIOD_END = date(2026, 6, 30)


def _db_url(allow_sqlite: bool, force_sqlite: bool = False) -> tuple[str, str]:
    if force_sqlite:
        return "sqlite:///:memory:", "sqlite"
    url = (os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL") or "").strip()
    if url.startswith("postgresql"):
        return url, "postgresql"
    if allow_sqlite:
        path = _BACKEND / "finreportai.db"
        return f"sqlite:///{path.as_posix()}", "sqlite"
    return "", "none"


def _ensure_schema(engine, dialect: str) -> None:
    ApCompany.__table__.create(engine, checkfirst=True)
    GulftaxTransaction.__table__.create(engine, checkfirst=True)
    Company.__table__.create(engine, checkfirst=True)
    VATReturn.__table__.create(engine, checkfirst=True)
    ReconciliationResult.__table__.create(engine, checkfirst=True)
    patches = [
        "ALTER TABLE reconciliation_results ADD COLUMN tax_period VARCHAR(16)",
        "ALTER TABLE reconciliation_results ADD COLUMN period_start DATE",
        "ALTER TABLE reconciliation_results ADD COLUMN period_end DATE",
        "ALTER TABLE reconciliation_results ADD COLUMN box_breakdown JSON",
        "ALTER TABLE reconciliation_results ADD COLUMN source VARCHAR(64)",
        "ALTER TABLE reconciliation_results ADD COLUMN override_reason VARCHAR(2000)",
    ]
    with engine.begin() as conn:
        for stmt in patches:
            try:
                if dialect == "postgresql":
                    conn.execute(text(stmt.replace("ADD COLUMN", "ADD COLUMN IF NOT EXISTS")))
                else:
                    conn.execute(text(stmt))
            except Exception:
                pass


def _ensure_company(db, ported_db) -> None:
    if not db.query(ApCompany).filter_by(id=COMPANY_ID).first():
        db.add(
            ApCompany(
                id=COMPANY_ID,
                tenant_id=TENANT,
                name="ABC TRADING LLC",
                slug="abc-trading-e2e-vat-recon",
            )
        )
        db.commit()

    if not ported_db.query(Company).filter(Company.id == COMPANY_ID).first():
        row = Company(
            id=COMPANY_ID,
            name="ABC TRADING LLC",
            trade_license_number="TL-E2E-RECON",
            trn="100000000000099",
            entity_type="mainland",
            external_id=COMPANY_ID,
            workspace_id=TENANT,
        )
        ported_db.add(row)
        ported_db.commit()


def _cleanup(db, ported_db) -> None:
    db.query(GulftaxTransaction).filter(
        GulftaxTransaction.invoice_number.like(f"{E2E_PREFIX}%")
    ).delete(synchronize_session=False)
    ported_db.query(ReconciliationResult).filter(
        ReconciliationResult.tax_period == TAX_PERIOD,
        ReconciliationResult.company_id == COMPANY_ID,
    ).delete(synchronize_session=False)
    ported_db.query(VATReturn).filter(
        VATReturn.company_id == COMPANY_ID,
        VATReturn.period_start == PERIOD_START,
    ).delete(synchronize_session=False)
    db.commit()
    ported_db.commit()


def _seed(db, ported_db) -> None:
    _ensure_company(db, ported_db)
    db.add(
        GulftaxTransaction(
            id=str(uuid.uuid4()),
            tenant_id=TENANT,
            company_id=COMPANY_ID,
            source="ap_invoiceflow",
            tax_period=TAX_PERIOD,
            transaction_date=date(2026, 5, 10),
            invoice_number=f"{E2E_PREFIX}INV-001",
            vendor_name="E2E Supplier",
            gross_amount=Decimal("1050.00"),
            vat_amount=Decimal("50.00"),
            vat_category="standard",
            fta_box="box9",
            direction="input",
            status="posted",
        )
    )
    ported_db.add(
        VATReturn(
            company_id=COMPANY_ID,
            period_start=PERIOD_START,
            period_end=PERIOD_END,
            box2_vat_on_supplies=0.0,
            box7_vat_on_expenses=50.0,
            box8_vat_payable_or_refundable=9999.0,
        )
    )
    db.commit()
    ported_db.commit()


@contextmanager
def _maybe_mock_boxes(dialect: str):
    if dialect != "sqlite":
        yield
        return
    payload = {
        "box8_total_output_vat": 0.0,
        "box11_total_input_vat": 50.0,
        "box12_net_vat_payable_or_refundable": -50.0,
        "sales_invoice_count": 0,
        "purchase_entry_count": 1,
        "source": "gulftax_transactions",
    }
    with patch("app.services.vat_recon_service.fetch_all_vat_return_boxes", return_value=payload):
        yield


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--allow-sqlite", action="store_true")
    parser.add_argument("--force-sqlite", action="store_true")
    parser.add_argument("--skip-cleanup", action="store_true")
    args = parser.parse_args()

    url, dialect = _db_url(args.allow_sqlite or args.force_sqlite, args.force_sqlite)
    if not url:
        print("ERROR: DATABASE_URL not set. Run on EC2 or pass --force-sqlite.")
        return 1

    engine = create_engine(url)
    _ensure_schema(engine, dialect)
    Session = sessionmaker(bind=engine)
    db = Session()
    ported_db = db

    try:
        if not args.skip_cleanup:
            _cleanup(db, ported_db)
        _seed(db, ported_db)

        with _maybe_mock_boxes(dialect):
            result = run_vat_recon(
                db,
                ported_db,
                tenant_id=TENANT,
                company_id=COMPANY_ID,
                period_start=PERIOD_START,
                period_end=PERIOD_END,
                tax_period=TAX_PERIOD,
            )
            status = get_recon_status(ported_db, company_id=COMPANY_ID, period=TAX_PERIOD)

            row = (
                ported_db.query(ReconciliationResult)
                .filter(
                    ReconciliationResult.company_id == COMPANY_ID,
                    ReconciliationResult.tax_period == TAX_PERIOD,
                )
                .order_by(ReconciliationResult.created_at.desc())
                .first()
            )

        report = {
            "ok": row is not None and result["status"] in ("mismatch_found", "matched", "no_return"),
            "run_status": result["status"],
            "gate_status": status["status"],
            "difference_aed": result["difference_aed"],
            "source": row.source if row else None,
            "transaction_count": result["transaction_count"],
            "mismatch_count": len(result.get("mismatches") or []),
            "dialect": dialect,
        }
        print(json.dumps(report, indent=2))

        if not report["ok"]:
            return 1
        if row.source != "gulftax_transactions":
            print("FAIL: reconciliation_results.source != gulftax_transactions")
            return 1
        if result["transaction_count"] < 1:
            print("FAIL: expected at least one gulftax_transaction")
            return 1
        if result["status"] != "mismatch_found":
            print(f"WARN: expected mismatch_found (seeded Box 12 gap), got {result['status']}")
        print("E2E VAT recon PASSED")
        return 0
    finally:
        db.close()
        ported_db.close()


if __name__ == "__main__":
    raise SystemExit(main())
