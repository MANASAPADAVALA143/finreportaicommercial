#!/usr/bin/env python3
"""Live E2E — unified e-invoicing on RDS (AR post → submission → ASP submit)."""
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

from app.models.client_data import ApCompany, EinvoicingSubmission
from app.models.uae_accounting_full import UAEAccount, UAESalesInvoice, UAESalesInvoiceLine, UAECustomer
from app.services.ar_invoice_post_service import post_sales_invoice_to_gl_and_tax
from app.services.einvoicing_constants import PINT_AE_CUSTOMIZATION_ID, PINT_AE_PROFILE_ID
from app.services import einvoicing_service_unified as svc

E2E_PREFIX = "E2E-EINV-"
TENANT = "59818b25-a981-4fe4-9a1f-7ffaafecef13"
COMPANY_ID = "e26d6523-d86b-4e77-8e16-23f251304480"
VALID_TRN = "100000000000003"


def _db_url() -> str:
    url = (os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL") or "").strip()
    if not url.startswith("postgresql"):
        print("ERROR: DATABASE_URL not set. Run on EC2.")
        return ""
    return url


def _cleanup(db, invoice_id: str | None) -> None:
    if invoice_id:
        db.query(EinvoicingSubmission).filter(EinvoicingSubmission.invoice_id == invoice_id).delete(
            synchronize_session=False
        )
        db.query(UAESalesInvoiceLine).filter(UAESalesInvoiceLine.invoice_id == invoice_id).delete(
            synchronize_session=False
        )
        db.query(UAESalesInvoice).filter(UAESalesInvoice.id == invoice_id).delete(synchronize_session=False)
    db.commit()


def _ensure_company(db) -> None:
    if not db.query(ApCompany).filter_by(id=COMPANY_ID).first():
        db.add(
            ApCompany(
                id=COMPANY_ID,
                tenant_id=TENANT,
                name="ABC TRADING LLC",
                slug="abc-trading-e2e-einv",
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
    invoice_id = str(uuid.uuid4())
    result: dict = {"pass": False, "steps": []}

    try:
        _cleanup(db, None)
        _ensure_company(db)

        cust = UAECustomer(
            id=str(uuid.uuid4()),
            tenant_id=TENANT,
            name=f"{E2E_PREFIX}Customer",
            trn="100000000000004",
        )
        db.add(cust)
        db.flush()

        inv_date = date(2026, 6, 15)
        inv = UAESalesInvoice(
            id=invoice_id,
            tenant_id=TENANT,
            company_id=COMPANY_ID,
            invoice_number=f"{E2E_PREFIX}001",
            customer_id=cust.id,
            invoice_date=inv_date,
            due_date=date(2026, 7, 15),
            period=inv_date.strftime("%Y-%m"),
            subtotal=Decimal("1000.00"),
            vat_amount=Decimal("50.00"),
            total_amount=Decimal("1050.00"),
            paid_amount=Decimal("0"),
            outstanding=Decimal("1050.00"),
            status="draft",
            seller_trn=VALID_TRN,
            buyer_trn="100000000000004",
            supply_type="standard",
        )
        db.add(inv)
        db.add(
            UAESalesInvoiceLine(
                id=str(uuid.uuid4()),
                invoice_id=invoice_id,
                description="E2E consulting",
                quantity=Decimal("1"),
                unit_price=Decimal("1000.00"),
                line_total=Decimal("1000.00"),
                vat_rate=Decimal("5"),
                vat_amount=Decimal("50.00"),
            )
        )
        db.commit()

        post_result = post_sales_invoice_to_gl_and_tax(
            invoice_id, tenant_id=TENANT, company_id=COMPANY_ID, db=db,
        )
        result["steps"].append({"ar_post": post_result.get("ok"), "einvoicing": post_result.get("einvoicing")})
        assert post_result.get("ok"), post_result

        row = (
            db.query(EinvoicingSubmission)
            .filter(EinvoicingSubmission.invoice_id == invoice_id)
            .order_by(EinvoicingSubmission.created_at.desc())
            .first()
        )
        assert row is not None, "einvoicing_submissions row missing"
        assert row.xml_payload, "xml_payload empty"
        assert PINT_AE_CUSTOMIZATION_ID in row.xml_payload
        assert PINT_AE_PROFILE_ID in row.xml_payload
        result["rds_row"] = {
            "id": row.id,
            "submission_status": row.submission_status,
            "has_xml": bool(row.xml_payload),
        }

        asp_row = svc.submit_to_asp(
            db,
            tenant_id=TENANT,
            company_id=COMPANY_ID,
            invoice_number=inv.invoice_number,
            xml_payload=row.xml_payload or "",
            invoice_id=invoice_id,
            submission_id=row.id,
        )
        assert asp_row.submission_status == "pending"
        result["steps"].append({"asp_submit": asp_row.submission_status})

        accepted = svc.update_submission_status(
            db, asp_row.id, status="accepted", asp_reference="E2E-ASP-REF",
        )
        assert accepted is not None
        assert accepted.submission_status == "accepted"
        result["steps"].append({"asp_accepted": accepted.submission_status})

        persisted = db.query(EinvoicingSubmission).filter_by(id=row.id).first()
        assert persisted.submission_status == "accepted"
        assert persisted.asp_reference == "E2E-ASP-REF"
        result["pass"] = True
        print(json.dumps(result, indent=2))
        return 0
    except Exception as exc:
        result["error"] = str(exc)
        print(json.dumps(result, indent=2))
        return 1
    finally:
        _cleanup(db, invoice_id)
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
