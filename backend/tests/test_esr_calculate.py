"""ESR calculate logic — no full app import required."""
from __future__ import annotations

import unittest

from app.modules.gulftax.esr_filing import ESRCalculateRequest, compute_esr_result, esr_status


class ESRCalculateTests(unittest.TestCase):
    def test_pass_contract(self):
        data = compute_esr_result(
            ESRCalculateRequest(
                relevant_activity="Banking",
                directed_managed_uae=True,
                cigas_uae=True,
                uae_employees=5,
                uae_expenditure=250000,
                uae_assets=100000,
            )
        )
        self.assertTrue(data["substance_test_passed"])
        self.assertEqual(data["status"], "PASS")
        self.assertEqual(data["overall_status"], "PASS")

    def test_frontend_payload_shape(self):
        data = compute_esr_result(
            ESRCalculateRequest(
                activity_type="Headquarters",
                directors_meetings_in_uae=True,
                ciga_in_uae=True,
                employee_count_uae=3,
                expenditure_uae_aed=10000,
                assets_uae_aed=5000,
            )
        )
        self.assertTrue(data["passes_dm_test"])
        self.assertTrue(data["passes_ciga_test"])
        self.assertTrue(data["passes_adequacy_test"])
        self.assertEqual(data["overall_status"], "PASS")

    def test_fail_missing_employees(self):
        data = compute_esr_result(
            ESRCalculateRequest(
                relevant_activity="Shipping",
                directed_managed_uae=True,
                cigas_uae=True,
                uae_employees=0,
                uae_expenditure=1000,
                uae_assets=1000,
            )
        )
        self.assertFalse(data["substance_test_passed"])
        self.assertEqual(data["status"], "FAIL")
        self.assertTrue(any("employee" in r.lower() for r in data["reasons"]))

    def test_status(self):
        data = esr_status()
        self.assertTrue(data.notification_deadline)


if __name__ == "__main__":
    unittest.main()
