#!/usr/bin/env python3
"""Live E2E — Advanced VAT integration on RDS (partial exemption, DZ, bad debt)."""
from __future__ import annotations

import json
import os
import sys
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv

load_dotenv(_BACKEND / ".env", override=True)

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.client_data import (
    ApCompany,
    BadDebtReliefClaim,
    GulftaxTransaction,
    PartialExemptionCalculation,
)
from app.modules.gulftax.vat_return_service import fetch_all_vat_return_boxes

E2E_PREFIX = "E2E-ADV-VAT-"
TENANT = "59818b25-a981-4fe4-9a1f-7ffaafecef13"
COMPANY_ID = "e26d6523-d86b-4e77-8e16-23f251304480"
PERIOD = "2026-Q2"


def _db_url() -> str:
    url = (os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL") or "").strip()
    if not url.startswith("postgresql"):
        print("ERROR: DATABASE_URL not set. Run on EC2.")
        return ""
    return url


def _cleanup(db) -> None:
    db.query(GulftaxTransaction).filter(
        GulftaxTransaction.invoice_number.like(f"{E2E_PREFIX}%")
    ).delete(synchronize_session=False)
    db.query(PartialExemptionCalculation).filter(
        PartialExemptionCalculation.period == PERIOD,
        PartialExemptionCalculation.company_id == COMPANY_ID,
    ).delete(synchronize_session=False)
    db.query(BadDebtReliefClaim).filter(
        BadDebtReliefClaim.claim_period == PERIOD,
        BadDebtReliefClaim.company_id == COMPANY_ID,
        BadDebtReliefClaim.invoice_number.like(f"{E2E_PREFIX}%"),
    ).delete(synchronize_session=False)
    db.commit()


def _ensure_company(db) -> None:
    if not db.query(ApCompany).filter_by(id=COMPANY_ID).first():
        db.add(
            ApCompany(
                id=COMPANY_ID,
                tenant_id=TENANT,
                name="ABC TRADING LLC",
                slug="abc-trading-e2e-adv",
            )
        )
        db.commit()


def main() -> int:
    url = _db_url()
    if not url:
        return 1

    engine = create_engine(url)
    Session = sessionmaker(bind=engine)
    db = Session()

    try:
        _ensure_company(db)
        _cleanup(db)

        before = fetch_all_vat_return_boxes(
            db, workspace_id=TENANT, company_id=COMPANY_ID, period=PERIOD
        )

        db.add(
            GulftaxTransaction(
                id=str(uuid.uuid4()),
                tenant_id=TENANT,
                company_id=COMPANY_ID,
                source="ap_invoiceflow",
                tax_period=PERIOD,
                transaction_date=date(2026, 5, 10),
                invoice_number=f"{E2E_PREFIX}STD",
                gross_amount=Decimal("2100"),
                vat_amount=Decimal("100"),
                vat_category="standard",
                fta_box="box9",
                direction="input",
                status="posted",
            )
        )
        db.add(
            GulftaxTransaction(
                id=str(uuid.uuid4()),
                tenant_id=TENANT,
                company_id=COMPANY_ID,
                source="ap_invoiceflow",
                tax_period=PERIOD,
                transaction_date=date(2026, 5, 11),
                invoice_number=f"{E2E_PREFIX}DZ-DZ",
                gross_amount=Decimal("525"),
                vat_amount=Decimal("25"),
                vat_category="standard",
                fta_box="box9",
                direction="input",
                status="posted",
                designated_zone=True,
                transaction_kind="goods",
                dz_supplier_location="designated_zone",
                dz_customer_location="designated_zone",
            )
        )
        db.add(
            PartialExemptionCalculation(
                id=str(uuid.uuid4()),
                tenant_id=TENANT,
                company_id=COMPANY_ID,
                period=PERIOD,
                taxable_supplies=Decimal("8000"),
                exempt_supplies=Decimal("2000"),
                input_vat_paid=Decimal("100"),
                recovery_pct=Decimal("80"),
                recoverable_vat=Decimal("80"),
                irrecoverable_vat=Decimal("20"),
                status="approved",
            )
        )
        db.add(
            BadDebtReliefClaim(
                id=str(uuid.uuid4()),
                tenant_id=TENANT,
                company_id=COMPANY_ID,
                invoice_number=f"{E2E_PREFIX}BD",
                invoice_date=date(2025, 1, 1),
                due_date=date(2025, 6, 1),
                invoice_amount=Decimal("1000"),
                vat_amount=Decimal("30"),
                status="approved",
                eligible=True,
                claim_period=PERIOD,
            )
        )
        db.commit()

        after = fetch_all_vat_return_boxes(
            db, workspace_id=TENANT, company_id=COMPANY_ID, period=PERIOD
        )

        box11_raw = float(after.get("box11_total_input_vat_raw") or 0)
        box11_adj = float(after.get("box11_total_input_vat") or 0)
        box7 = float(after.get("box7_output_adjustments") or 0)
        bad_debt = float(after.get("bad_debt_relief_applied") or 0)
        before_box11 = float(before.get("box11_total_input_vat") or 0)

        # STD adds 100 recoverable VAT; DZ-DZ row is out of scope (excluded)
        expected_raw = round(before_box11 + 100.0, 2)
        expected_adj = round(expected_raw * 0.8, 2)

        report = {
            "ok": (
                after.get("partial_exemption_applied") is True
                and abs(box11_raw - expected_raw) < 0.02
                and abs(box11_adj - expected_adj) < 0.02
                and bad_debt == 30.0
                and box7 == -30.0
            ),
            "before": {
                "box11": before.get("box11_total_input_vat"),
                "box7": before.get("box7_output_adjustments"),
                "box12": before.get("box12_net_vat_payable_or_refundable"),
            },
            "after": {
                "box11_raw": box11_raw,
                "box11": box11_adj,
                "box11_expected_raw": expected_raw,
                "box11_expected_adj": expected_adj,
                "box7": box7,
                "box12": after.get("box12_net_vat_payable_or_refundable"),
                "recovery_percentage": after.get("recovery_percentage"),
                "bad_debt_relief_applied": bad_debt,
                "partial_exemption_applied": after.get("partial_exemption_applied"),
            },
            "dialect": "postgresql",
        }
        print(json.dumps(report, indent=2))

        if not report["ok"]:
            print("E2E Advanced VAT FAILED")
            return 1
        print("E2E Advanced VAT PASSED")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
