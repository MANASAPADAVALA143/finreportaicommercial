"""Unit tests for CT return service — rate bands, SBR, QFZP, adjustments, status workflow."""

from __future__ import annotations

import unittest
import uuid
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models.client_data import CtReturn
from app.models.uae_account_classification import UAEAccountClassification
from app.models.uae_accounting_full import UAEAccount, UAEJournalEntry, UAEJournalLine
from app.services import ct_return_service as svc


def _mock_tb(*, revenue: float, expense: float, net_lines: list | None = None) -> dict:
    lines = net_lines or [
        {"account_code": "7010", "account_name": "Revenue", "debit": 0, "credit": revenue, "net_balance": -revenue},
        {"account_code": "7110", "account_name": "Opex", "debit": expense, "credit": 0, "net_balance": expense},
    ]
    return {
        "period": "2026-01..2026-12",
        "lines": lines,
        "total_debits": expense,
        "total_credits": revenue,
        "is_balanced": True,
        "totals": {"revenue": revenue, "expense": expense, "income": revenue},
    }


class CtReturnServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(
            cls.engine,
            tables=[
                CtReturn.__table__,
                UAEAccountClassification.__table__,
                UAEAccount.__table__,
                UAEJournalEntry.__table__,
                UAEJournalLine.__table__,
            ],
        )
        cls.Session = sessionmaker(bind=cls.engine)

    def setUp(self):
        self.db = self.Session()
        self.tenant = "ws-ct-return"
        self.company_id = str(uuid.uuid4())
        self.period_start = date(2026, 1, 1)
        self.period_end = date(2026, 12, 31)

    def tearDown(self):
        self.db.query(CtReturn).delete()
        self.db.query(UAEAccountClassification).delete()
        self.db.commit()
        self.db.close()

    @patch.object(svc, "_aggregate_trial_balance")
    @patch.object(svc, "_resolve_free_zone_status", return_value="mainland")
    def test_generate_rate_bands_mainland(self, _fz, mock_tb):
        """Taxable 500k → 375k @ 0%, 125k @ 9% = 11,250 CT."""
        mock_tb.return_value = _mock_tb(revenue=4_000_000, expense=3_500_000)
        row = svc.generate_ct_return(
            self.db, self.tenant, self.company_id, self.period_start, self.period_end
        )
        self.assertEqual(row["taxable_income"], 500_000)
        self.assertEqual(row["ct_payable_aed"], 11_250.0)
        self.assertEqual(row["status"], "draft")
        self.assertFalse(row["sbr_eligible"])

    @patch.object(svc, "_aggregate_trial_balance")
    @patch.object(svc, "_resolve_free_zone_status", return_value="mainland")
    def test_generate_sbr_eligible_flag(self, _fz, mock_tb):
        """Revenue ≤ 3M flags SBR eligibility; CT still uses rate bands until elected."""
        mock_tb.return_value = _mock_tb(revenue=2_000_000, expense=1_500_000)
        row = svc.generate_ct_return(
            self.db, self.tenant, self.company_id, self.period_start, self.period_end
        )
        self.assertTrue(row["sbr_eligible"])
        self.assertFalse(row["sbr_elected"])
        self.assertEqual(row["taxable_income"], 500_000)
        self.assertEqual(row["ct_payable_aed"], 11_250.0)

    @patch.object(svc, "_aggregate_trial_balance")
    @patch.object(svc, "_resolve_free_zone_status", return_value="mainland")
    def test_sbr_election_zero_ct(self, _fz, mock_tb):
        """Eligible entity with elect_sbr=True → CT payable = 0."""
        mock_tb.return_value = _mock_tb(revenue=2_000_000, expense=1_500_000)
        row = svc.generate_ct_return(
            self.db,
            self.tenant,
            self.company_id,
            self.period_start,
            self.period_end,
            elect_sbr=True,
        )
        self.assertTrue(row["sbr_eligible"])
        self.assertTrue(row["sbr_elected"])
        self.assertEqual(row["ct_payable_aed"], 0.0)
        self.assertTrue(row["breakdown"]["computation"]["small_business_relief_applied"])

    @patch.object(svc, "_aggregate_trial_balance")
    @patch.object(svc, "_resolve_free_zone_status", return_value="free_zone_qfzp")
    def test_generate_qfzp_split(self, _fz, mock_tb):
        """QFZP entity — qualifying income at 0%, breakdown includes QFZP line."""
        mock_tb.return_value = _mock_tb(revenue=1_000_000, expense=400_000)
        row = svc.generate_ct_return(
            self.db, self.tenant, self.company_id, self.period_start, self.period_end
        )
        self.assertTrue(row["qfzp_eligible"])
        self.assertEqual(row["free_zone_status"], "free_zone_qfzp")
        labels = [b["label"] for b in row["breakdown"]["computation"]["breakdown"]]
        self.assertTrue(any("QFZP" in label for label in labels))
        self.assertEqual(row["free_zone_income"], 600_000)

    @patch.object(svc, "_aggregate_trial_balance")
    @patch.object(svc, "_resolve_free_zone_status", return_value="mainland")
    def test_fines_100_percent_add_back(self, _fz, mock_tb):
        tb = _mock_tb(revenue=500_000, expense=200_000)
        tb["lines"].append(
            {"account_code": "7199", "account_name": "Fines", "debit": 50_000, "credit": 0, "net_balance": 50_000}
        )
        tb["totals"]["expense"] = 250_000
        mock_tb.return_value = tb
        self.db.add(
            UAEAccountClassification(
                workspace_id=self.tenant,
                company_id=self.company_id,
                account_code="7199",
                account_name="Fines",
                cit_category="Fines",
                cit_add_back=True,
            )
        )
        self.db.commit()
        row = svc.generate_ct_return(
            self.db, self.tenant, self.company_id, self.period_start, self.period_end
        )
        self.assertEqual(row["non_deductible_expenses"], 50_000)
        self.assertEqual(row["taxable_income"], 300_000)
        add_backs = [a for a in row["adjustments"] if a["type"] == "add_back"]
        self.assertEqual(len(add_backs), 1)
        self.assertEqual(add_backs[0]["add_back_pct"], 1.0)
        self.assertEqual(add_backs[0]["add_back_amount"], 50_000)
        self.assertIn("Art. 33", add_backs[0]["law_reference"])

    @patch.object(svc, "_aggregate_trial_balance")
    @patch.object(svc, "_resolve_free_zone_status", return_value="mainland")
    def test_entertainment_50_percent_add_back(self, _fz, mock_tb):
        tb = _mock_tb(revenue=500_000, expense=200_000)
        tb["lines"].append(
            {
                "account_code": "7188",
                "account_name": "Entertainment",
                "debit": 100_000,
                "credit": 0,
                "net_balance": 100_000,
            }
        )
        tb["totals"]["expense"] = 300_000
        mock_tb.return_value = tb
        self.db.add(
            UAEAccountClassification(
                workspace_id=self.tenant,
                company_id=self.company_id,
                account_code="7188",
                account_name="Entertainment",
                cit_category="Entertainment",
                cit_add_back=True,
            )
        )
        self.db.commit()
        row = svc.generate_ct_return(
            self.db, self.tenant, self.company_id, self.period_start, self.period_end
        )
        self.assertEqual(row["non_deductible_expenses"], 50_000)
        self.assertEqual(row["taxable_income"], 250_000)
        add_backs = [a for a in row["adjustments"] if a["type"] == "add_back"]
        self.assertEqual(add_backs[0]["add_back_pct"], 0.5)
        self.assertEqual(add_backs[0]["add_back_amount"], 50_000)
        self.assertIn("Art. 32", add_backs[0]["law_reference"])

    @patch.object(svc, "_aggregate_trial_balance")
    @patch.object(svc, "_resolve_free_zone_status", return_value="free_zone_qfzp")
    def test_qfzp_flagged_revenue_accounts(self, _fz, mock_tb):
        tb = _mock_tb(revenue=1_000_000, expense=400_000)
        tb["lines"].append(
            {
                "account_code": "7020",
                "account_name": "FZ Revenue",
                "debit": 0,
                "credit": 200_000,
                "net_balance": -200_000,
            }
        )
        mock_tb.return_value = tb
        self.db.add(
            UAEAccountClassification(
                workspace_id=self.tenant,
                company_id=self.company_id,
                account_code="7020",
                account_name="FZ Revenue",
                cit_category="QFZP Qualifying Income",
            )
        )
        self.db.commit()
        row = svc.generate_ct_return(
            self.db, self.tenant, self.company_id, self.period_start, self.period_end
        )
        self.assertEqual(row["free_zone_income"], 200_000)
        exempt = [a for a in row["adjustments"] if a["type"] == "exempt_deduction"]
        self.assertEqual(len(exempt), 1)
        self.assertEqual(exempt[0]["add_back_amount"], 200_000)

    def test_status_transitions_draft_approved_filed(self):
        row = CtReturn(
            tenant_id=self.tenant,
            company_id=self.company_id,
            period_start=self.period_start,
            period_end=self.period_end,
            revenue=Decimal("1000000"),
            accounting_profit=Decimal("500000"),
            taxable_income=Decimal("500000"),
            ct_payable_aed=Decimal("11250"),
            status="draft",
        )
        self.db.add(row)
        self.db.commit()

        approved = svc.approve_ct_return(self.db, row.id)
        self.assertEqual(approved["status"], "approved")
        self.assertIsNotNone(approved["approved_at"])

        filed = svc.file_ct_return(self.db, row.id)
        self.assertEqual(filed["status"], "filed")
        self.assertFalse(filed.get("blocked"))
        self.assertIsNotNone(filed["filed_at"])

    def test_file_blocked_without_approval(self):
        row = CtReturn(
            tenant_id=self.tenant,
            company_id=self.company_id,
            period_start=self.period_start,
            period_end=self.period_end,
            taxable_income=Decimal("100000"),
            ct_payable_aed=Decimal("0"),
            status="draft",
        )
        self.db.add(row)
        self.db.commit()

        result = svc.file_ct_return(self.db, row.id)
        self.assertTrue(result["blocked"])
        self.assertTrue(result["warning"])
        self.assertEqual(result["status"], "draft")

        override = svc.file_ct_return(self.db, row.id, override_reason="CFO expedited filing")
        self.assertEqual(override["status"], "filed")
        self.assertEqual(override["override_reason"], "CFO expedited filing")


if __name__ == "__main__":
    unittest.main()
