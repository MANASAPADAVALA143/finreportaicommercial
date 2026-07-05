"""Unit tests for recurring invoice service."""

from __future__ import annotations

import unittest
import uuid
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models.uae_accounting_full import UAECustomer, UAERecurringInvoice, UAESalesInvoice, UAESalesInvoiceLine
from app.services.recurring_invoice_service import (
    advance_next_due_date,
    create_template,
    generate_due_invoices,
)


class RecurringInvoiceServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(
            cls.engine,
            tables=[
                UAECustomer.__table__,
                UAERecurringInvoice.__table__,
                UAESalesInvoice.__table__,
                UAESalesInvoiceLine.__table__,
            ],
        )
        cls.Session = sessionmaker(bind=cls.engine)

    def setUp(self):
        self.db = self.Session()
        self.tenant = "ws-rec"
        self.company = "co-rec"
        self.as_of = date(2026, 7, 5)
        self.cust = UAECustomer(
            id=str(uuid.uuid4()),
            tenant_id=self.tenant,
            name="Recurring Customer",
            payment_terms_days=30,
        )
        self.db.add(self.cust)
        self.db.flush()

    def tearDown(self):
        self.db.query(UAESalesInvoiceLine).delete()
        self.db.query(UAESalesInvoice).delete()
        self.db.query(UAERecurringInvoice).delete()
        self.db.query(UAECustomer).delete()
        self.db.commit()
        self.db.close()

    def test_advance_next_due_date(self):
        base = date(2026, 1, 15)
        self.assertEqual(advance_next_due_date(base, "weekly", 1), date(2026, 1, 22))
        self.assertEqual(advance_next_due_date(base, "weekly", 2), date(2026, 1, 29))
        self.assertEqual(advance_next_due_date(base, "monthly", 1), date(2026, 2, 15))
        self.assertEqual(advance_next_due_date(base, "quarterly", 1), date(2026, 4, 15))
        self.assertEqual(advance_next_due_date(base, "annually", 1), date(2027, 1, 15))

    def test_generate_due_invoices_monthly(self):
        tpl = create_template(
            self.db,
            tenant_id=self.tenant,
            company_id=self.company,
            customer_id=self.cust.id,
            description="Monthly retainer",
            amount=1000.0,
            vat_rate=5.0,
            recurrence_type="monthly",
            interval=1,
            start_date=self.as_of,
        )
        self.assertEqual(tpl["next_due_date"], str(self.as_of))

        result = generate_due_invoices(self.db, self.tenant, self.as_of, self.company)
        self.assertEqual(result["generated_count"], 1)
        gen = result["generated"][0]
        self.assertEqual(gen["subtotal"], 1000.0)
        self.assertEqual(gen["vat_amount"], 50.0)
        self.assertEqual(gen["total"], 1050.0)
        self.assertEqual(gen["status"], "draft")
        self.assertEqual(gen["next_due_date"], "2026-08-05")

        inv = self.db.query(UAESalesInvoice).filter_by(id=gen["invoice_id"]).first()
        self.assertIsNotNone(inv)
        self.assertEqual(inv.recurring_template_id, tpl["id"])
        self.assertEqual(inv.status, "draft")
        self.assertIsNone(inv.journal_entry_id)

        refreshed = self.db.query(UAERecurringInvoice).filter_by(id=tpl["id"]).first()
        self.assertEqual(refreshed.generated_count, 1)
        self.assertEqual(str(refreshed.next_due_date), "2026-08-05")

    def test_generate_skips_paused(self):
        tpl = create_template(
            self.db,
            tenant_id=self.tenant,
            company_id=self.company,
            customer_id=self.cust.id,
            description="Paused plan",
            amount=500.0,
            vat_rate=5.0,
            recurrence_type="weekly",
            interval=1,
            start_date=self.as_of,
        )
        row = self.db.query(UAERecurringInvoice).filter_by(id=tpl["id"]).first()
        row.status = "paused"
        self.db.commit()

        result = generate_due_invoices(self.db, self.tenant, self.as_of, self.company)
        self.assertEqual(result["generated_count"], 0)


if __name__ == "__main__":
    unittest.main()
