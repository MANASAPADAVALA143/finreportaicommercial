"""Unit tests for Advanced VAT integration in vat_return_service."""
from __future__ import annotations

import unittest
import uuid
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.client_data import (
    ApCompany,
    BadDebtReliefClaim,
    GulftaxTransaction,
    PartialExemptionCalculation,
)
from app.modules.gulftax.vat_return_service import (
    _aggregate_rds_gulftax_transactions,
    calculate_partial_exemption_adjustment,
    calculate_partial_exemption_recovery_pct,
    evaluate_designated_zone,
    fetch_all_vat_return_boxes,
)

TENANT = "59818b25-a981-4fe4-9a1f-7ffaafecef13"
COMPANY_ID = "e26d6523-d86b-4e77-8e16-23f251304480"
PERIOD = "2026-Q2"


class VatAdvancedIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        for table in (
            ApCompany.__table__,
            GulftaxTransaction.__table__,
            PartialExemptionCalculation.__table__,
            BadDebtReliefClaim.__table__,
        ):
            table.create(self.engine, checkfirst=True)
        Session = sessionmaker(bind=self.engine)
        self.db = Session()
        self.db.add(
            ApCompany(
                id=COMPANY_ID,
                tenant_id=TENANT,
                name="Test Co",
                slug="test-co",
            )
        )
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()

    def test_partial_exemption_recovery_pct(self) -> None:
        pct = calculate_partial_exemption_recovery_pct(8000, 2000)
        self.assertAlmostEqual(pct, 80.0, places=2)

    def test_partial_exemption_adjustment_approved(self) -> None:
        self.db.add(
            PartialExemptionCalculation(
                id=str(uuid.uuid4()),
                tenant_id=TENANT,
                company_id=COMPANY_ID,
                period=PERIOD,
                taxable_supplies=Decimal("8000"),
                exempt_supplies=Decimal("2000"),
                input_vat_paid=Decimal("500"),
                recovery_pct=Decimal("80"),
                recoverable_vat=Decimal("400"),
                irrecoverable_vat=Decimal("100"),
                status="approved",
            )
        )
        self.db.commit()
        adj = calculate_partial_exemption_adjustment(
            self.db, tenant_id=TENANT, company_id=COMPANY_ID, period=PERIOD
        )
        self.assertTrue(adj["partial_exemption_applied"])
        self.assertAlmostEqual(adj["recovery_percentage"], 80.0, places=2)

    def test_dz_dz_to_dz_goods_out_of_scope(self) -> None:
        self.db.add(
            GulftaxTransaction(
                id=str(uuid.uuid4()),
                tenant_id=TENANT,
                company_id=COMPANY_ID,
                source="ap_invoiceflow",
                tax_period=PERIOD,
                transaction_date=date(2026, 5, 1),
                invoice_number="DZ-DZ-001",
                gross_amount=Decimal("1050"),
                vat_amount=Decimal("50"),
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
        self.db.commit()
        agg = _aggregate_rds_gulftax_transactions(
            self.db, tenant_id=TENANT, company_id=COMPANY_ID, tax_period=PERIOD
        )
        self.assertEqual(agg["boxes"]["box9_standard_rated_expenses"], 0.0)
        self.assertEqual(agg["boxes"]["box11_recoverable_input_vat"], 0.0)

    def test_dz_import_to_box6(self) -> None:
        self.db.add(
            GulftaxTransaction(
                id=str(uuid.uuid4()),
                tenant_id=TENANT,
                company_id=COMPANY_ID,
                source="ap_invoiceflow",
                tax_period=PERIOD,
                transaction_date=date(2026, 5, 2),
                invoice_number="DZ-IMP-001",
                gross_amount=Decimal("1050"),
                vat_amount=Decimal("50"),
                vat_category="standard",
                fta_box="box9",
                direction="input",
                status="posted",
                designated_zone=True,
                transaction_kind="goods",
                dz_supplier_location="designated_zone",
                dz_customer_location="mainland",
            )
        )
        self.db.commit()
        agg = _aggregate_rds_gulftax_transactions(
            self.db, tenant_id=TENANT, company_id=COMPANY_ID, tax_period=PERIOD
        )
        self.assertEqual(agg["boxes"]["box6_imports_vat"], 50.0)
        self.assertEqual(agg["boxes"]["box11_recoverable_input_vat"], 50.0)

    def test_evaluate_designated_zone_services_standard(self) -> None:
        dz = evaluate_designated_zone(
            supplier_location="designated_zone",
            customer_location="mainland",
            transaction_type="services",
        )
        self.assertEqual(dz.vat_rate, 5.0)
        self.assertFalse(dz.outside_scope)

    @patch("app.services.gulftax_supabase.fetch_advance_payment_invoices")
    @patch("app.services.gulftax_supabase.fetch_vat_return_boxes")
    @patch("app.modules.gulftax.vat_return_service._sales_boxes")
    def test_fetch_boxes_applies_partial_exemption_and_bad_debt(
        self,
        mock_sales,
        mock_purchases,
        mock_advances,
    ) -> None:
        mock_sales.return_value = {
            "box1_standard_rated_sales_net": 0.0,
            "box1_standard_rated_sales_vat": 0.0,
            "box2_tourist_refunds": 0.0,
            "box3_reverse_charge_supplies_net": 0.0,
            "box3_reverse_charge_supplies_vat": 0.0,
            "box4_zero_rated_supplies": 0.0,
            "box5_exempt_supplies": 0.0,
            "box6_imports_vat": 0.0,
            "box7_output_adjustments": 0.0,
            "box8_total_output_vat": 0.0,
            "sales_invoice_count": 0,
        }
        mock_purchases.return_value = {"entries": [], "entry_count": 0}
        mock_advances.return_value = {"advance_payment_vat_total": 0, "advance_payment_count": 0}

        self.db.add(
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
        self.db.add(
            GulftaxTransaction(
                id=str(uuid.uuid4()),
                tenant_id=TENANT,
                company_id=COMPANY_ID,
                source="ap_invoiceflow",
                tax_period=PERIOD,
                transaction_date=date(2026, 5, 3),
                invoice_number="STD-001",
                gross_amount=Decimal("1050"),
                vat_amount=Decimal("100"),
                vat_category="standard",
                fta_box="box9",
                direction="input",
                status="posted",
            )
        )
        self.db.add(
            BadDebtReliefClaim(
                id=str(uuid.uuid4()),
                tenant_id=TENANT,
                company_id=COMPANY_ID,
                invoice_number="INV-BD-1",
                invoice_date=date(2025, 1, 1),
                due_date=date(2025, 6, 1),
                invoice_amount=Decimal("1000"),
                vat_amount=Decimal("25"),
                status="approved",
                eligible=True,
                claim_period=PERIOD,
            )
        )
        self.db.commit()

        result = fetch_all_vat_return_boxes(
            self.db,
            workspace_id=TENANT,
            company_id=COMPANY_ID,
            period=PERIOD,
        )
        self.assertTrue(result["partial_exemption_applied"])
        self.assertAlmostEqual(result["recovery_percentage"], 80.0, places=2)
        self.assertEqual(result["box11_total_input_vat_raw"], 100.0)
        self.assertEqual(result["box11_total_input_vat"], 80.0)
        self.assertEqual(result["bad_debt_relief_applied"], 25.0)
        self.assertEqual(result["box7_output_adjustments"], -25.0)


if __name__ == "__main__":
    unittest.main()
