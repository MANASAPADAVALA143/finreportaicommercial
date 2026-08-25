"""Tests for AP → GulfTax sync helpers."""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from app.services.gulftax_sync_service import (
    _assert_invoice_company_match,
    sync_approved_invoice_to_gulftax,
    sync_period,
)


class TestGulftaxSyncCompanyValidation(unittest.TestCase):
    def test_assert_invoice_company_match_ok(self):
        self.assertIsNone(
            _assert_invoice_company_match({"company_id": "abc-123"}, "abc-123")
        )

    def test_assert_invoice_company_match_mismatch(self):
        self.assertEqual(
            _assert_invoice_company_match({"company_id": "real-co"}, "other-co"),
            "company_id_mismatch",
        )

    def test_assert_invoice_company_match_missing(self):
        self.assertEqual(
            _assert_invoice_company_match({"company_id": ""}, "other-co"),
            "invoice_missing_company_id",
        )

    @patch("app.services.gulftax_sync_service._existing_for_invoice", return_value=False)
    @patch("app.services.gulftax_sync_service._fetch_invoice")
    def test_sync_rejects_company_mismatch(self, fetch_invoice, _existing):
        fetch_invoice.return_value = {
            "id": "inv-1",
            "status": "Approved",
            "company_id": "company-a",
        }
        result = sync_approved_invoice_to_gulftax("inv-1", "company-b")
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "company_id_mismatch")


class TestSyncPeriodDualStore(unittest.TestCase):
    @patch("app.services.gulftax_sync_service.sync_approved_invoice_to_gulftax")
    @patch("app.services.ar_gulftax_sync_service.sync_ap_invoice_to_rds_gulftax")
    @patch("app.services.gulftax_sync_service._fetch_company_config", return_value={})
    @patch("app.core.supabase.get_supabase")
    @patch("app.services.gulftax_sync_service.parse_period_range")
    def test_sync_period_backfills_rds_when_supabase_already_synced(
        self,
        parse_period,
        get_supabase,
        _company_cfg,
        rds_sync,
        supabase_sync,
    ):
        parse_period.return_value = (__import__("datetime").date(2026, 4, 1), __import__("datetime").date(2026, 6, 30))
        sb = MagicMock()
        get_supabase.return_value = sb
        sb.table.return_value.select.return_value.eq.return_value.eq.return_value.gte.return_value.lte.return_value.execute.return_value = MagicMock(
            data=[{"id": "inv-1", "status": "Approved", "company_id": "co-1"}]
        )

        supabase_sync.return_value = {"ok": True, "skipped": True, "reason": "already_synced"}
        rds_sync.return_value = {"ok": True, "transaction_id": "tx-1"}

        db = MagicMock()
        result = sync_period("co-1", "2026-Q2", db=db)

        self.assertTrue(result["ok"])
        self.assertEqual(result["synced"], 1)
        self.assertEqual(result["skipped"], 0)
        rds_sync.assert_called_once_with(db, "inv-1", "co-1", workspace_id="co-1")


if __name__ == "__main__":
    unittest.main()
