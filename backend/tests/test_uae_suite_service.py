"""Unit tests for UAE Finance Suite summary service."""

from __future__ import annotations

import unittest
import uuid
from datetime import date
from unittest.mock import MagicMock, patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models.client_data import CtReturn
from app.services import uae_suite_service as svc


class UaeSuiteServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(cls.engine, tables=[CtReturn.__table__])
        cls.Session = sessionmaker(bind=cls.engine)

    def setUp(self):
        self.db = self.Session()
        self.tenant = str(uuid.uuid4())
        self.company = str(uuid.uuid4())

    def tearDown(self):
        self.db.close()

    def test_latest_ct_return_not_started(self):
        row = svc._latest_ct_return(self.db, self.tenant, self.company)
        self.assertEqual(row["status"], "not_started")

    def test_latest_ct_return_draft(self):
        self.db.add(
            CtReturn(
                tenant_id=self.tenant,
                company_id=self.company,
                period_start=date(2025, 1, 1),
                period_end=date(2025, 12, 31),
                status="draft",
                ct_payable_aed=5000,
            )
        )
        self.db.commit()
        row = svc._latest_ct_return(self.db, self.tenant, self.company)
        self.assertEqual(row["status"], "draft")
        self.assertEqual(row["ct_payable_aed"], 5000.0)

    def test_worst_ar_bucket(self):
        worst = svc._worst_ar_bucket({
            "buckets": [
                {"bucket": "current", "label": "Current", "amount": 100},
                {"bucket": "90_plus", "label": "90+ days", "amount": 50},
            ]
        })
        self.assertEqual(worst["bucket"], "90_plus")

    @patch.object(svc, "get_recon_status", return_value={"status": "matched", "difference_aed": 0})
    @patch.object(svc, "_einvoicing_readiness", return_value={"readiness_score": 72})
    @patch.object(svc, "_credit_notes_in_period", return_value={"count": 1, "total_amount": 500})
    @patch.object(svc, "_ap_metrics", return_value={"pending_approval_count": 2, "pending_amount": 1, "open_balance": 1, "overdue_amount": 1})
    @patch.object(svc, "compute_ap_aging", return_value={"total_outstanding": 10, "total_overdue": 2, "invoices": []})
    @patch.object(svc, "compute_ar_aging", return_value={"total_outstanding": 20, "total_overdue": 5, "buckets": []})
    @patch(
        "app.modules.gulftax.vat_return_service.fetch_all_vat_return_boxes",
        return_value={"box12_net_vat_payable_or_refundable": 999},
    )
    def test_build_summary_three_modules(self, *_mocks):
        profile = MagicMock(company_name="Test Co", trn="123")
        with patch.object(self.db, "query") as mock_q:
            mock_q.return_value.filter.return_value.first.return_value = profile
            result = svc.build_uae_suite_summary(
                self.db,
                MagicMock(),
                tenant_id=self.tenant,
                company_id=self.company,
            )
        self.assertEqual(result["ap"]["total_outstanding"], 10)
        self.assertEqual(result["ar"]["total_outstanding"], 20)
        self.assertEqual(result["uae_tax"]["estimated_vat_payable_aed"], 999)
        self.assertEqual(result["company"]["name"], "Test Co")


if __name__ == "__main__":
    unittest.main()
