"""E-invoicing readiness — honest Fix 5 checklist."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from app.modules.gulftax.gulftax_einvoicing import (
    ReadinessRequest,
    _compute_readiness,
    compute_company_readiness,
    readiness_request_from_company,
)
from app.services import einvoicing_service_unified as einv_svc
from app.services.einvoicing_constants import (
    PHASE_1_ASP_DEADLINE,
    PHASE_1_MANDATORY,
    VOLUNTARY_PILOT_START,
)


class _FakeCompany:
    def __init__(self, **kwargs):
        self.annual_revenue_aed = kwargs.get("annual_revenue_aed")
        self.asp_appointed = kwargs.get("asp_appointed", False)
        self.vat_registered = kwargs.get("vat_registered", True)
        self.trn = kwargs.get("trn", "")
        self.settings = kwargs.get("settings") or {}


class EinvoicingReadinessTests(unittest.TestCase):
    def test_peppol_phase_legacy_matches_constants(self):
        phase = einv_svc.calculate_phase(60_000_000)
        self.assertEqual(phase["phase_num"], 1)
        self.assertEqual(phase["mandatory_date"], PHASE_1_MANDATORY.isoformat())
        self.assertEqual(phase["asp_registration_deadline"], PHASE_1_ASP_DEADLINE.isoformat())
        self.assertEqual(phase["voluntary_pilot_start"], VOLUNTARY_PILOT_START.isoformat())
        self.assertNotEqual(phase["mandatory_date"], phase["voluntary_pilot_start"])

    def test_asp_provider_sets_appointed_in_readiness(self):
        before = _compute_readiness(
            ReadinessRequest(
                annual_revenue_aed=5_000_000,
                asp_appointed=False,
                trn_recorded=True,
                vat_registered=True,
                has_company_profile=True,
                has_einvoice_submissions_period=True,
            )
        )
        company = _FakeCompany(
            annual_revenue_aed=5_000_000,
            asp_appointed=True,
            trn="100234567890123",
            settings={"asp_provider": "Pagero"},
        )
        after = _compute_readiness(
            readiness_request_from_company(
                company,
                trn_recorded=True,
                has_company_profile=True,
                has_einvoice_submissions_period=True,
            )
        )
        self.assertEqual(after["readiness_score"] - before["readiness_score"], 20)

    def test_gnanova_like_score_missing_asp_and_trn(self):
        """No ASP (-20), no TRN (-15), has profile + submissions → 65."""
        result = _compute_readiness(
            ReadinessRequest(
                annual_revenue_aed=5_000_000,
                asp_appointed=False,
                trn_recorded=False,
                vat_registered=True,
                has_company_profile=True,
                has_einvoice_submissions_period=True,
            )
        )
        self.assertEqual(result["readiness_score"], 65)
        self.assertEqual(result["urgency"], "AMBER")

    def test_gnanova_like_score_no_submissions(self):
        """No ASP (-20), no TRN (-15), no submissions (-10) → 55."""
        result = _compute_readiness(
            ReadinessRequest(
                annual_revenue_aed=5_000_000,
                asp_appointed=False,
                trn_recorded=False,
                vat_registered=True,
                has_company_profile=True,
                has_einvoice_submissions_period=False,
            )
        )
        self.assertEqual(result["readiness_score"], 55)

    @patch("app.modules.gulftax.gulftax_einvoicing.resolve_gulftax_company")
    @patch("app.modules.gulftax.gulftax_einvoicing._einvoicing_submissions_this_quarter", return_value=0)
    @patch("app.modules.gulftax.gulftax_einvoicing._einvoicing_submission_counts", return_value=(0, 0))
    def test_compute_company_readiness_uses_checklist(
        self, _counts, _period, mock_resolve
    ):
        company = _FakeCompany(
            annual_revenue_aed=5_000_000,
            asp_appointed=False,
            vat_registered=True,
            trn="",
            settings={},
        )
        mock_resolve.return_value = company
        db = MagicMock()
        # No UAE profile
        db.query.return_value.filter.return_value.order_by.return_value.first.return_value = None
        db.query.return_value.filter.return_value.first.return_value = None

        result = compute_company_readiness(db, MagicMock(), "tenant-1", "co-1")
        # No ASP -20, no TRN -15, no profile -10, no submissions -10 = 45
        self.assertEqual(result["readiness_score"], 45)
        self.assertFalse(result["inputs"]["asp_appointed"])


if __name__ == "__main__":
    unittest.main()
