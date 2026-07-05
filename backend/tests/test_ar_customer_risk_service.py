"""Unit tests for AR customer risk service."""

from __future__ import annotations

import unittest
import uuid
from datetime import date, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models.uae_accounting_full import UAECreditNote, UAECustomer, UAESalesInvoice
from app.services.ar_customer_risk_service import compute_customer_risk, filter_by_risk_tier


class ARCustomerRiskServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(
            cls.engine,
            tables=[
                UAECustomer.__table__,
                UAESalesInvoice.__table__,
                UAECreditNote.__table__,
            ],
        )
        cls.Session = sessionmaker(bind=cls.engine)

    def setUp(self):
        self.db = self.Session()
        self.tenant = "ws-test"
        self.company = "co-test"
        self.as_of = date(2026, 7, 5)

        self.cust_low = UAECustomer(id=str(uuid.uuid4()), tenant_id=self.tenant, name="Low Risk Co")
        self.cust_high = UAECustomer(id=str(uuid.uuid4()), tenant_id=self.tenant, name="High Risk Co")
        self.cust_crit = UAECustomer(id=str(uuid.uuid4()), tenant_id=self.tenant, name="Critical Co")
        self.db.add_all([self.cust_low, self.cust_high, self.cust_crit])
        self.db.flush()

        # Current — low
        self.db.add(
            UAESalesInvoice(
                id=str(uuid.uuid4()),
                tenant_id=self.tenant,
                company_id=self.company,
                customer_id=self.cust_low.id,
                invoice_number="INV-LOW",
                invoice_date=self.as_of - timedelta(days=10),
                due_date=self.as_of + timedelta(days=20),
                subtotal=1000,
                vat_amount=50,
                total_amount=1050,
                outstanding=1050,
                status="sent",
            )
        )
        # 45 days overdue — high
        inv_high = UAESalesInvoice(
            id=str(uuid.uuid4()),
            tenant_id=self.tenant,
            company_id=self.company,
            customer_id=self.cust_high.id,
            invoice_number="INV-HIGH",
            invoice_date=self.as_of - timedelta(days=75),
            due_date=self.as_of - timedelta(days=45),
            subtotal=2000,
            vat_amount=100,
            total_amount=2100,
            outstanding=2100,
            status="overdue",
        )
        self.db.add(inv_high)
        # 100 days overdue — critical
        self.db.add(
            UAESalesInvoice(
                id=str(uuid.uuid4()),
                tenant_id=self.tenant,
                company_id=self.company,
                customer_id=self.cust_crit.id,
                invoice_number="INV-CRIT",
                invoice_date=self.as_of - timedelta(days=130),
                due_date=self.as_of - timedelta(days=100),
                subtotal=500,
                vat_amount=25,
                total_amount=525,
                outstanding=525,
                status="overdue",
            )
        )
        # Paid history for high-risk customer: 10 and 20 days to pay
        self.db.add(
            UAESalesInvoice(
                id=str(uuid.uuid4()),
                tenant_id=self.tenant,
                company_id=self.company,
                customer_id=self.cust_high.id,
                invoice_number="INV-PAID-1",
                invoice_date=date(2026, 1, 1),
                due_date=date(2026, 1, 31),
                subtotal=100,
                vat_amount=5,
                total_amount=105,
                paid_amount=105,
                outstanding=0,
                status="paid",
                paid_date=date(2026, 1, 11),
            )
        )
        self.db.add(
            UAESalesInvoice(
                id=str(uuid.uuid4()),
                tenant_id=self.tenant,
                company_id=self.company,
                customer_id=self.cust_high.id,
                invoice_number="INV-PAID-2",
                invoice_date=date(2026, 2, 1),
                due_date=date(2026, 3, 3),
                subtotal=100,
                vat_amount=5,
                total_amount=105,
                paid_amount=105,
                outstanding=0,
                status="paid",
                paid_date=date(2026, 2, 21),
            )
        )
        self.db.flush()

        self.db.add(
            UAECreditNote(
                id=str(uuid.uuid4()),
                tenant_id=self.tenant,
                company_id=self.company,
                customer_id=self.cust_high.id,
                parent_invoice_id=inv_high.id,
                credit_note_number="CN-001",
                amount=300,
                status="issued",
                issued_date=self.as_of,
            )
        )
        self.db.flush()

    def tearDown(self):
        self.db.query(UAECreditNote).delete()
        self.db.query(UAESalesInvoice).delete()
        self.db.query(UAECustomer).delete()
        self.db.commit()
        self.db.close()

    def test_compute_customer_risk_tiers_and_sort(self):
        report = compute_customer_risk(
            self.db, self.tenant, self.company, as_of=self.as_of
        )
        self.assertEqual(report["customer_count"], 3)
        tiers = [c["risk_tier"] for c in report["customers"]]
        self.assertEqual(tiers, ["critical", "high", "low"])

        crit = report["customers"][0]
        self.assertEqual(crit["customer_name"], "Critical Co")
        self.assertEqual(crit["total_outstanding"], 525.0)
        self.assertEqual(crit["worst_bucket"], "90+ days")

        high = report["customers"][1]
        self.assertEqual(high["risk_tier"], "high")
        self.assertEqual(high["total_outstanding"], 2100.0)
        self.assertEqual(high["total_overdue"], 2100.0)
        self.assertEqual(high["credit_notes_count"], 1)
        self.assertEqual(high["total_credited"], 300.0)
        self.assertEqual(high["avg_days_to_pay"], 15.0)

        low = report["customers"][2]
        self.assertEqual(low["risk_tier"], "low")
        self.assertEqual(low["total_overdue"], 0.0)

    def test_filter_by_risk_tier(self):
        report = compute_customer_risk(
            self.db, self.tenant, self.company, as_of=self.as_of
        )
        filtered = filter_by_risk_tier(report, "high")
        self.assertEqual(filtered["customer_count"], 1)
        self.assertEqual(filtered["customers"][0]["customer_name"], "High Risk Co")


if __name__ == "__main__":
    unittest.main()
