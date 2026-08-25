#!/usr/bin/env python3
"""Live test — approved partial exemption / bad debt affect VAT return boxes."""
from __future__ import annotations

import json
import os
import sys
import uuid
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv

load_dotenv(_BACKEND / ".env", override=True)

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.client_data import BadDebtReliefClaim, PartialExemptionCalculation
from app.modules.gulftax.vat_return_service import fetch_all_vat_return_boxes

TENANT = "59818b25-a981-4fe4-9a1f-7ffaafecef13"
COMPANY_ID = "e26d6523-d86b-4e77-8e16-23f251304480"
PERIOD = "2026-Q2"


def main() -> int:
    url = (os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL") or "").strip()
    if not url.startswith("postgresql"):
        print(json.dumps({"pass": False, "error": "DATABASE_URL not set"}))
        return 1

    engine = create_engine(url)
    Session = sessionmaker(bind=engine)
    db = Session()

    pe_id = str(uuid.uuid4())
    bd_id = str(uuid.uuid4())

    try:
        db.query(PartialExemptionCalculation).filter(
            PartialExemptionCalculation.tenant_id == TENANT,
            PartialExemptionCalculation.company_id == COMPANY_ID,
            PartialExemptionCalculation.period == PERIOD,
        ).delete(synchronize_session=False)
        db.query(BadDebtReliefClaim).filter(
            BadDebtReliefClaim.tenant_id == TENANT,
            BadDebtReliefClaim.company_id == COMPANY_ID,
            BadDebtReliefClaim.claim_period == PERIOD,
        ).delete(synchronize_session=False)
        db.commit()

        db.add(
            PartialExemptionCalculation(
                id=pe_id,
                tenant_id=TENANT,
                company_id=COMPANY_ID,
                period=PERIOD,
                period_type="quarterly",
                taxable_supplies=Decimal("80000"),
                exempt_supplies=Decimal("20000"),
                input_vat_paid=Decimal("1000"),
                recovery_pct=Decimal("80"),
                recoverable_vat=Decimal("800"),
                irrecoverable_vat=Decimal("200"),
                status="draft",
                created_at=datetime.utcnow(),
            )
        )
        db.add(
            BadDebtReliefClaim(
                id=bd_id,
                tenant_id=TENANT,
                company_id=COMPANY_ID,
                invoice_number="E2E-BDR-001",
                invoice_date=date(2025, 1, 1),
                due_date=date(2025, 7, 1),
                invoice_amount=Decimal("1050"),
                vat_amount=Decimal("50"),
                status="eligible",
                eligible=True,
                claim_period=PERIOD,
                created_at=datetime.utcnow(),
            )
        )
        db.commit()

        before = fetch_all_vat_return_boxes(
            db, workspace_id=TENANT, company_id=COMPANY_ID, period=PERIOD
        )

        pe = db.query(PartialExemptionCalculation).filter_by(id=pe_id).first()
        pe.status = "approved"
        bd = db.query(BadDebtReliefClaim).filter_by(id=bd_id).first()
        bd.status = "approved"
        db.commit()

        after = fetch_all_vat_return_boxes(
            db, workspace_id=TENANT, company_id=COMPANY_ID, period=PERIOD
        )

        pe_applied_before = bool(before.get("partial_exemption_applied"))
        pe_applied_after = bool(after.get("partial_exemption_applied"))
        bdr_before = float(before.get("bad_debt_relief_applied") or 0)
        bdr_after = float(after.get("bad_debt_relief_applied") or 0)

        report = {
            "pass": pe_applied_after and not pe_applied_before and bdr_after > bdr_before,
            "period": PERIOD,
            "before": {
                "partial_exemption_applied": pe_applied_before,
                "recovery_percentage": before.get("recovery_percentage"),
                "box11_total_input_vat": before.get("box11_total_input_vat"),
                "bad_debt_relief_applied": bdr_before,
                "box7_output_adjustments": before.get("box7_output_adjustments"),
            },
            "after": {
                "partial_exemption_applied": pe_applied_after,
                "recovery_percentage": after.get("recovery_percentage"),
                "box11_total_input_vat": after.get("box11_total_input_vat"),
                "bad_debt_relief_applied": bdr_after,
                "box7_output_adjustments": after.get("box7_output_adjustments"),
            },
        }
        print(json.dumps(report, indent=2))
        return 0 if report["pass"] else 1
    except Exception as exc:
        print(json.dumps({"pass": False, "error": str(exc)}))
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
