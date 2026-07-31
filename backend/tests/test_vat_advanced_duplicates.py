"""Bad debt duplicate + designated zone + ESR helpers."""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from fastapi import HTTPException

from app.api.routes.vat_advanced_rds import (
    DesignatedZoneIn,
    _assert_no_duplicate_bad_debt,
    _dz_explanation,
)
from app.modules.gulftax.esr_filing import ESRCalculateRequest, compute_esr_result


class BadDebtDuplicateTests(unittest.TestCase):
    def test_duplicate_same_invoice_and_company(self):
        db = MagicMock()
        existing = MagicMock()
        db.query.return_value.filter_by.return_value.first.return_value = existing

        with self.assertRaises(HTTPException) as ctx:
            _assert_no_duplicate_bad_debt(
                tenant_id="ws",
                company_id="co",
                invoice_number="INV-2025-001",
                db=db,
            )
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(ctx.exception.detail, "Claim for this invoice already exists.")

    def test_dz_explanation_appends_zones(self):
        body = DesignatedZoneIn(
            supplier_location="designated_zone",
            customer_location="mainland",
            transaction_type="goods",
            vat_treatment="Import",
            vat_rate=5,
            explanation="DZ to mainland",
            supplier_zone_name="Jebel Ali Free Zone",
        )
        self.assertIn("Jebel Ali Free Zone", _dz_explanation(body))


class EsrCalculateTests(unittest.TestCase):
    def test_pass(self):
        out = compute_esr_result(
            ESRCalculateRequest(
                relevant_activity="Banking",
                directed_managed_uae=True,
                cigas_uae=True,
                uae_employees=5,
                uae_expenditure=250000,
                uae_assets=100000,
            )
        )
        self.assertTrue(out["substance_test_passed"])
        self.assertEqual(out["status"], "PASS")

    def test_fail_missing_employees(self):
        out = compute_esr_result(
            ESRCalculateRequest(
                relevant_activity="Shipping",
                directed_managed_uae=True,
                cigas_uae=True,
                uae_employees=0,
                uae_expenditure=1000,
                uae_assets=1000,
            )
        )
        self.assertEqual(out["status"], "FAIL")
        self.assertTrue(any("employee" in r.lower() for r in out["reasons"]))


if __name__ == "__main__":
    unittest.main()
