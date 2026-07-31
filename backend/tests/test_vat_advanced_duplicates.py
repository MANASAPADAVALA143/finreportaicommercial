"""Bad debt duplicate + designated zone explanation helpers."""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from fastapi import HTTPException

from app.api.routes.vat_advanced_rds import (
    DesignatedZoneIn,
    _assert_no_duplicate_bad_debt,
    _bad_debt_period_key,
    _dz_explanation,
)


class BadDebtDuplicateTests(unittest.TestCase):
    def test_period_key_prefers_vat_return_period(self):
        self.assertEqual(
            _bad_debt_period_key({"vat_return_period": "2025-Q4", "claim_period": "2026-Q1"}),
            "2025-Q4",
        )

    def test_duplicate_same_invoice_and_period(self):
        db = MagicMock()
        existing = MagicMock()
        existing.extra = {"vat_return_period": "2025-Q4"}
        existing.claim_period = "2026-Q1"
        db.query.return_value.filter_by.return_value.all.return_value = [existing]

        with self.assertRaises(HTTPException) as ctx:
            _assert_no_duplicate_bad_debt(
                tenant_id="ws",
                company_id="co",
                invoice_number="INV-2025-001",
                period_key="2025-Q4",
                db=db,
            )
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(ctx.exception.detail, "duplicate claim")

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


class EsrRouteImportTests(unittest.TestCase):
    def test_esr_module_calculate(self):
        from app.modules.gulftax.esr_filing import ESRCalculateRequest, esr_calculate

        out = esr_calculate(
            ESRCalculateRequest(
                activity_type="Banking",
                directors_meetings_in_uae=True,
                ciga_in_uae=True,
                employee_count_uae=2,
                expenditure_uae_aed=1000,
                assets_uae_aed=1000,
            )
        )
        self.assertEqual(out["overall_status"], "PASS")


if __name__ == "__main__":
    unittest.main()
