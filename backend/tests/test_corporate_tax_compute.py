"""Regression: CT compute uses exact AED (not thousands)."""
from __future__ import annotations

import unittest

from app.modules.gulftax.ported.services.corporate_tax_service import compute_ct


class CorporateTaxComputeExactAedTests(unittest.TestCase):
    def test_half_million_taxable_income_exact(self) -> None:
        result = compute_ct(
            accounting_profit=500_000,
            free_zone_status="mainland",
            revenue=5_000_000,
        )
        self.assertEqual(result["taxable_income_aed"], 500_000.0)
        self.assertEqual(result["ct_payable_aed"], 11_250.0)  # 9% × 125_000

    def test_one_million_ct_after_zero_band(self) -> None:
        result = compute_ct(
            accounting_profit=1_000_000,
            free_zone_status="mainland",
            revenue=5_000_000,
        )
        self.assertEqual(result["taxable_income_aed"], 1_000_000.0)
        # 9% on (1_000_000 − 375_000) = 56_250
        self.assertEqual(result["ct_payable_aed"], 56_250.0)

    def test_no_thousands_scaling(self) -> None:
        """Entering 500000 must not be treated as 500 (AED '000)."""
        result = compute_ct(
            accounting_profit=500_000,
            free_zone_status="mainland",
            revenue=5_000_000,
        )
        self.assertNotEqual(result["taxable_income_aed"], 500.0)
        self.assertGreater(result["taxable_income_aed"], 1000.0)


if __name__ == "__main__":
    unittest.main()
