"""Unit tests for VAT recon service."""

from __future__ import annotations

import sys
import unittest
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

_PORTED = Path(__file__).resolve().parents[1] / "app" / "modules" / "gulftax" / "ported"
if str(_PORTED) not in sys.path:
    sys.path.insert(0, str(_PORTED))

from app.core.database import Base
from app.models.client_data import GulftaxTransaction
from models import Company, ReconciliationResult, VATReturn
from app.services.vat_recon_service import (
    get_recon_status,
    get_vat_periods,
    run_vat_recon,
    set_recon_override,
)


def _mock_boxes(
    *,
    output: float = 500.0,
    input_vat: float = 100.0,
    net: float = 400.0,
) -> dict:
    return {
        "box8_total_output_vat": output,
        "box11_total_input_vat": input_vat,
        "box12_net_vat_payable_or_refundable": net,
        "sales_invoice_count": 2,
        "purchase_entry_count": 3,
        "source": "gulftax_transactions",
    }


class VatReconServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(
            cls.engine,
            tables=[
                GulftaxTransaction.__table__,
                Company.__table__,
                VATReturn.__table__,
                ReconciliationResult.__table__,
            ],
        )
        cls.Session = sessionmaker(bind=cls.engine)

    def setUp(self):
        self.db = self.Session()
        self.ported_db = self.Session()
        self.tenant = "ws-vat-recon"
        self.company_id = str(uuid.uuid4())
        self.period = "2026-Q2"
        self.period_start = date(2026, 4, 1)
        self.period_end = date(2026, 6, 30)

        self.ported_db.add(
            Company(
                id=self.company_id,
                name="Recon Test Co",
                trade_license_number="TL-RECON",
                trn="100000000000003",
                entity_type="mainland",
            )
        )
        self.ported_db.commit()

        self.db.add(
            GulftaxTransaction(
                tenant_id=self.tenant,
                company_id=self.company_id,
                tax_period=self.period,
                transaction_date=date(2026, 5, 15),
                gross_amount=Decimal("1050.00"),
                vat_amount=Decimal("50.00"),
                vat_category="standard",
                fta_box="box9",
                direction="input",
                status="posted",
            )
        )
        self.db.commit()

    def tearDown(self):
        self.ported_db.query(ReconciliationResult).delete()
        self.ported_db.query(VATReturn).delete()
        self.ported_db.query(Company).delete()
        self.ported_db.commit()
        self.db.query(GulftaxTransaction).delete()
        self.db.commit()
        self.db.close()
        self.ported_db.close()

    @patch("app.services.vat_recon_service.fetch_all_vat_return_boxes")
    def test_get_vat_periods(self, _mock_fetch):
        periods = get_vat_periods(self.db, tenant_id=self.tenant, company_id=self.company_id)
        self.assertEqual(len(periods), 1)
        self.assertEqual(periods[0]["tax_period"], self.period)
        self.assertEqual(periods[0]["transaction_count"], 1)

    @patch("app.services.vat_recon_service.fetch_all_vat_return_boxes")
    def test_run_vat_recon_no_return(self, mock_fetch):
        mock_fetch.return_value = _mock_boxes()
        result = run_vat_recon(
            self.db,
            self.ported_db,
            tenant_id=self.tenant,
            company_id=self.company_id,
            period_start=self.period_start,
            period_end=self.period_end,
            tax_period=self.period,
        )
        self.assertEqual(result["status"], "no_return")
        self.assertEqual(result["transaction_count"], 1)
        self.assertEqual(result["source"], "gulftax_transactions")

        row = self.ported_db.query(ReconciliationResult).one()
        self.assertEqual(row.status, "no_return")
        self.assertEqual(row.source, "gulftax_transactions")
        self.assertEqual(row.tax_period, self.period)

    @patch("app.services.vat_recon_service.fetch_all_vat_return_boxes")
    def test_run_vat_recon_matched(self, mock_fetch):
        mock_fetch.return_value = _mock_boxes(output=500.0, input_vat=100.0, net=400.0)
        self.ported_db.add(
            VATReturn(
                company_id=self.company_id,
                period_start=self.period_start,
                period_end=self.period_end,
                box2_vat_on_supplies=500.0,
                box7_vat_on_expenses=100.0,
                box8_vat_payable_or_refundable=400.0,
            )
        )
        self.ported_db.commit()

        result = run_vat_recon(
            self.db,
            self.ported_db,
            tenant_id=self.tenant,
            company_id=self.company_id,
            period_start=self.period_start,
            period_end=self.period_end,
            tax_period=self.period,
        )
        self.assertEqual(result["status"], "matched")
        self.assertEqual(result["difference_aed"], 0.0)
        self.assertEqual(len(result["mismatches"]), 0)

    @patch("app.services.vat_recon_service.fetch_all_vat_return_boxes")
    def test_run_vat_recon_mismatch_found(self, mock_fetch):
        mock_fetch.return_value = _mock_boxes(output=500.0, input_vat=100.0, net=400.0)
        self.ported_db.add(
            VATReturn(
                company_id=self.company_id,
                period_start=self.period_start,
                period_end=self.period_end,
                box2_vat_on_supplies=500.0,
                box7_vat_on_expenses=100.0,
                box8_vat_payable_or_refundable=900.0,
            )
        )
        self.ported_db.commit()

        result = run_vat_recon(
            self.db,
            self.ported_db,
            tenant_id=self.tenant,
            company_id=self.company_id,
            period_start=self.period_start,
            period_end=self.period_end,
            tax_period=self.period,
        )
        self.assertEqual(result["status"], "mismatch_found")
        self.assertGreater(result["difference_aed"], 100.0)
        self.assertTrue(any("Box 12" in m["issue"] for m in result["mismatches"]))

    @patch("app.services.vat_recon_service.fetch_all_vat_return_boxes")
    def test_get_recon_status_and_override(self, mock_fetch):
        mock_fetch.return_value = _mock_boxes(net=400.0)
        self.ported_db.add(
            VATReturn(
                company_id=self.company_id,
                period_start=self.period_start,
                period_end=self.period_end,
                box2_vat_on_supplies=500.0,
                box7_vat_on_expenses=100.0,
                box8_vat_payable_or_refundable=900.0,
            )
        )
        self.ported_db.commit()
        run_vat_recon(
            self.db,
            self.ported_db,
            tenant_id=self.tenant,
            company_id=self.company_id,
            period_start=self.period_start,
            period_end=self.period_end,
            tax_period=self.period,
        )

        status = get_recon_status(self.ported_db, company_id=self.company_id, period=self.period)
        self.assertEqual(status["status"], "mismatch_found")

        updated = set_recon_override(
            self.ported_db,
            company_id=self.company_id,
            period=self.period,
            reason="CFO approved manual FTA adjustment",
        )
        self.assertIn("CFO approved", updated["override_reason"])


if __name__ == "__main__":
    unittest.main()
