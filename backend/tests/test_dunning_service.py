"""Unit tests for AR dunning service."""

from __future__ import annotations

import unittest
import uuid
from datetime import date, timedelta
from unittest.mock import ANY, patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models.uae_accounting_full import UAECustomer, UAESalesInvoice
from app.services.dunning_service import (
    build_dunning_email,
    dunning_level,
    get_dunning_history,
    get_dunning_templates,
    run_dunning,
)


class DunningServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(
            cls.engine,
            tables=[UAECustomer.__table__, UAESalesInvoice.__table__],
        )
        cls.Session = sessionmaker(bind=cls.engine)

    def setUp(self):
        self.db = self.Session()
        self.tenant = "ws-dunning"
        self.company = "co-dunning"
        self.as_of = date(2026, 7, 5)

    def tearDown(self):
        self.db.query(UAESalesInvoice).delete()
        self.db.query(UAECustomer).delete()
        self.db.commit()
        self.db.close()

    def _customer(self, name: str, email: str | None) -> UAECustomer:
        c = UAECustomer(id=str(uuid.uuid4()), tenant_id=self.tenant, name=name, email=email)
        self.db.add(c)
        self.db.flush()
        return c

    def _invoice(
        self,
        cust: UAECustomer,
        number: str,
        days_overdue: int,
        *,
        email_sent_before: bool = False,
    ) -> UAESalesInvoice:
        due = self.as_of - timedelta(days=days_overdue)
        inv = UAESalesInvoice(
            id=str(uuid.uuid4()),
            tenant_id=self.tenant,
            company_id=self.company,
            customer_id=cust.id,
            invoice_number=number,
            invoice_date=due - timedelta(days=30),
            due_date=due,
            subtotal=1000,
            vat_amount=50,
            total_amount=1050,
            outstanding=1050,
            status="overdue",
        )
        if email_sent_before:
            inv.last_dunning_level = dunning_level(days_overdue)
            inv.last_dunning_sent_at = self.as_of - timedelta(days=1)
            inv.dunning_count = 1
        self.db.add(inv)
        self.db.flush()
        return inv

    def test_dunning_level_assignment(self):
        self.assertEqual(dunning_level(5), 1)
        self.assertEqual(dunning_level(15), 1)
        self.assertEqual(dunning_level(16), 2)
        self.assertEqual(dunning_level(30), 2)
        self.assertEqual(dunning_level(31), 3)
        self.assertEqual(dunning_level(60), 3)
        self.assertEqual(dunning_level(61), 4)

    def test_level_specific_templates(self):
        _, l1 = build_dunning_email(
            1, invoice_number="INV-1", customer_name="Acme", outstanding=100.0,
            due_date=date(2026, 6, 1), days_overdue=10,
        )
        _, l2 = build_dunning_email(
            2, invoice_number="INV-2", customer_name="Acme", outstanding=100.0,
            due_date=date(2026, 6, 1), days_overdue=25,
        )
        _, l3 = build_dunning_email(
            3, invoice_number="INV-3", customer_name="Acme", outstanding=100.0,
            due_date=date(2026, 6, 1), days_overdue=45,
        )
        _, l4 = build_dunning_email(
            4, invoice_number="INV-4", customer_name="Acme", outstanding=100.0,
            due_date=date(2026, 6, 1), days_overdue=90,
        )
        self.assertIn("friendly reminder", l1.lower())
        self.assertIn("pay.example.com", l2)
        self.assertIn("late payment fees", l3.lower())
        self.assertIn("final notice", l4.lower())

    @patch("app.services.dunning_service.send_notification", return_value=True)
    @patch("app.services.dunning_service.recalc_for_customer_name")
    def test_run_dunning_sent_and_skipped_counts(self, _recalc, mock_send):
        with_email = self._customer("With Email", "pay@acme.ae")
        no_email = self._customer("No Email Co", None)
        self._invoice(with_email, "INV-L1", 10)
        self._invoice(with_email, "INV-L3", 45)
        self._invoice(no_email, "INV-SKIP", 20)
        self.db.commit()

        result = run_dunning(self.db, self.tenant, self.company, self.as_of)

        self.assertEqual(result["sent_count"], 2)
        self.assertEqual(result["skipped_count"], 1)
        self.assertEqual(len(result["sent"]), 2)
        self.assertEqual(result["skipped"][0]["reason"], "no_email")
        self.assertEqual(mock_send.call_count, 2)

        levels_sent = {s["invoice_number"]: s["level"] for s in result["sent"]}
        self.assertEqual(levels_sent["INV-L1"], 1)
        self.assertEqual(levels_sent["INV-L3"], 3)

        l1_subject, _ = build_dunning_email(
            1, invoice_number="INV-L1", customer_name="With Email", outstanding=1050.0,
            due_date=self.as_of - timedelta(days=10), days_overdue=10,
        )
        mock_send.assert_any_call("pay@acme.ae", l1_subject, ANY)

    @patch("app.services.dunning_service.send_notification", return_value=True)
    @patch("app.services.dunning_service.recalc_for_customer_name")
    def test_get_dunning_history(self, _recalc, _mock_send):
        cust = self._customer("History Co", "hist@acme.ae")
        self._invoice(cust, "INV-HIST", 40, email_sent_before=True)
        self.db.commit()

        hist = get_dunning_history(self.db, self.tenant, self.company, as_of=self.as_of)
        self.assertEqual(hist["count"], 1)
        row = hist["invoices"][0]
        self.assertEqual(row["invoice_number"], "INV-HIST")
        self.assertEqual(row["last_dunning_level"], 3)
        self.assertEqual(row["dunning_count"], 1)
        self.assertGreater(row["days_overdue"], 0)

        filtered = get_dunning_history(
            self.db, self.tenant, self.company, dunning_level=1, as_of=self.as_of,
        )
        self.assertEqual(filtered["count"], 0)

    def test_get_dunning_templates_returns_four_levels(self):
        templates = get_dunning_templates()
        self.assertEqual(len(templates), 4)
        self.assertEqual([t["level"] for t in templates], [1, 2, 3, 4])


if __name__ == "__main__":
    unittest.main()
