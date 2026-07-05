"""Unit tests for unified e-invoicing service."""

from __future__ import annotations

import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models.client_data import EinvoicingSubmission
from app.services.einvoicing_constants import (
    PINT_AE_CUSTOMIZATION_ID,
    PINT_AE_PROFILE_ID,
    PHASE_1_MANDATORY,
    PHASE_1_THRESHOLD_AED,
)
from app.services import einvoicing_service_unified as svc

VALID_TRN = "100000000000003"


class EinvoicingUnifiedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(cls.engine, tables=[EinvoicingSubmission.__table__])
        cls.Session = sessionmaker(bind=cls.engine)

    def setUp(self):
        self.db = self.Session()

    def tearDown(self):
        self.db.query(EinvoicingSubmission).delete()
        self.db.commit()
        self.db.close()

    def _valid_invoice(self, **overrides):
        data = {
            "invoice_number": "INV-2026-001",
            "invoice_date": "2026-06-01",
            "supplier_name": "ABC Trading LLC",
            "seller_trn": VALID_TRN,
            "buyer_name": "Buyer Co",
            "buyer_trn": "100000000000004",
            "net_amount": 1000.0,
            "vat_amount": 50.0,
            "gross_amount": 1050.0,
            "vat_category": "S",
            "vat_rate": 5.0,
            "currency": "AED",
            "lines": [{
                "description": "Consulting",
                "quantity": 1,
                "unit_price": 1000.0,
                "line_extension_amount": 1000.0,
                "vat_rate": 5.0,
            }],
            "is_b2b": True,
        }
        data.update(overrides)
        return data

    def test_validate_all_rules_pass(self):
        result = svc.validate_pint_ae(self._valid_invoice())
        self.assertTrue(result["compliant"])
        self.assertGreaterEqual(result["rules_total"], 15)
        self.assertEqual(result["rules_passed"], result["rules_total"])

    def test_validate_fails_missing_trn(self):
        result = svc.validate_pint_ae(self._valid_invoice(seller_trn=""))
        self.assertFalse(result["compliant"])
        failed_ids = {r["id"] for r in result["rules"] if not r["passed"]}
        self.assertIn("supplier_trn", failed_ids)

    def test_validate_fails_bad_gross(self):
        result = svc.validate_pint_ae(self._valid_invoice(gross_amount=900.0))
        self.assertFalse(result["compliant"])
        failed_ids = {r["id"] for r in result["rules"] if not r["passed"]}
        self.assertIn("total", failed_ids)

    def test_xml_contains_pint_ae_elements(self):
        xml = svc.generate_pint_ae_xml(self._valid_invoice())
        self.assertIn(PINT_AE_CUSTOMIZATION_ID, xml)
        self.assertIn(PINT_AE_PROFILE_ID, xml)
        self.assertIn("cbc:CustomizationID", xml)
        self.assertIn("cbc:ProfileID", xml)
        self.assertIn("cac:TaxSubtotal", xml)
        self.assertIn("cac:InvoiceLine", xml)
        self.assertIn("cbc:InvoicedQuantity", xml)

    def test_xml_credit_note_type_381(self):
        xml = svc.generate_pint_ae_xml(self._valid_invoice(is_credit_note=True))
        self.assertIn("<cbc:InvoiceTypeCode>381</cbc:InvoiceTypeCode>", xml)

    def test_calculate_phase_1_jan_2027(self):
        phase = svc.calculate_phase(PHASE_1_THRESHOLD_AED)
        self.assertEqual(phase["phase"], "phase_1")
        self.assertEqual(phase["mandatory_date"], PHASE_1_MANDATORY.isoformat())

    def test_submission_persist_and_status_update(self):
        row = svc.create_pending_submission(
            self.db,
            tenant_id="ws-e2e",
            company_id="co-e2e",
            invoice_id="inv-1",
            invoice_number="INV-001",
            xml_payload="<Invoice/>",
        )
        self.assertEqual(row.submission_status, "pending")

        updated = svc.update_submission_status(
            self.db, row.id, status="accepted", asp_reference="ASP-REF-1",
        )
        assert updated is not None
        self.assertEqual(updated.submission_status, "accepted")
        self.assertEqual(updated.asp_reference, "ASP-REF-1")

        items = svc.list_submissions(self.db, "ws-e2e", company_id="co-e2e")
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["submission_status"], "accepted")


if __name__ == "__main__":
    unittest.main()
