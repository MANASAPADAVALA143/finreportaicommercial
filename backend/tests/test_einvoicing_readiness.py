"""E-invoicing readiness — ASP wiring and UAE suite inputs."""

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
            ReadinessRequest(annual_revenue_aed=60_000_000, asp_appointed=False)
        )
        company = _FakeCompany(
            annual_revenue_aed=60_000_000,
            asp_appointed=True,
            settings={"asp_provider": "Pagero"},
        )
        after = _compute_readiness(readiness_request_from_company(company))
        self.assertEqual(after["readiness_score"] - before["readiness_score"], 35)

    def test_peppol_participant_improves_format_score(self):
        company = _FakeCompany(
            annual_revenue_aed=60_000_000,
            asp_appointed=True,
            settings={
                "asp_provider": "Pagero",
                "peppol_participant_id": "0088:123456789",
            },
        )
        params = readiness_request_from_company(company)
        self.assertEqual(params.invoice_format, "Peppol PINT AE")
        result = _compute_readiness(params)
        pdf_only = _compute_readiness(
            ReadinessRequest(
                annual_revenue_aed=60_000_000,
                asp_appointed=True,
                invoice_format="PDF",
            )
        )
        self.assertGreater(result["readiness_score"], pdf_only["readiness_score"])

    @patch("app.modules.gulftax.gulftax_einvoicing.resolve_gulftax_company")
    def test_compute_company_readiness_matches_dashboard_path(self, mock_resolve):
        company = _FakeCompany(
            annual_revenue_aed=60_000_000,
            asp_appointed=True,
            settings={
                "asp_provider": "Pagero",
                "peppol_participant_id": "0088:123456789",
            },
        )
        mock_resolve.return_value = company
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = []

        result = compute_company_readiness(db, MagicMock(), "tenant-1", "co-1")
        self.assertEqual(result["readiness_score"], 80)
        self.assertTrue(result["inputs"]["asp_appointed"])
        self.assertEqual(result["inputs"]["invoice_format"], "Peppol PINT AE")
        self.assertEqual(result["inputs"]["integration_status"], "planning")


if __name__ == "__main__":
    unittest.main()
