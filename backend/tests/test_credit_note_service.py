"""Unit tests for AR credit note service."""

from __future__ import annotations

import unittest
import uuid
from datetime import date
from unittest.mock import MagicMock, patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models.uae_accounting_full import UAECreditNote, UAECustomer, UAESalesInvoice
from app.services.ar_aging_service import compute_ar_aging
from app.services.credit_note_service import issue_credit_note, void_credit_note


def _mock_je():
    je = MagicMock()
    je.id = str(uuid.uuid4())
    je.entry_number = "JE-CN-TEST"
    return je


class CreditNoteServiceTests(unittest.TestCase):
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
        self.cust = UAECustomer(
            id=str(uuid.uuid4()),
            tenant_id=self.tenant,
            name="Test Customer",
        )
        self.db.add(self.cust)
        self.db.flush()
        self.inv = UAESalesInvoice(
            id=str(uuid.uuid4()),
            tenant_id=self.tenant,
            company_id=self.company,
            customer_id=self.cust.id,
            invoice_number="INV-TEST-001",
            invoice_date=date.today(),
            due_date=date.today(),
            subtotal=1000,
            vat_amount=50,
            total_amount=1050,
            paid_amount=0,
            outstanding=1050,
            status="sent",
            journal_entry_id=str(uuid.uuid4()),
        )
        self.db.add(self.inv)
        self.db.commit()

    def tearDown(self):
        self.db.rollback()
        self.db.close()

    @patch("app.services.credit_note_service.resolve_ap_company_id")
    @patch("app.services.credit_note_service.sync_ar_credit_note_to_gulftax")
    @patch("app.services.credit_note_service.create_journal_entry")
    def test_issue_partial_credit_note_reduces_outstanding(self, mock_je, mock_gt, mock_cid):
        mock_cid.return_value = self.company
        mock_je.return_value = _mock_je()
        mock_gt.return_value = {"ok": True}

        result = issue_credit_note(
            self.db,
            self.inv.id,
            500,
            "Partial return",
            tenant_id=self.tenant,
            company_id=self.company,
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["outstanding_after"], 550.0)

        aging = compute_ar_aging(self.db, self.tenant, self.company)
        self.assertEqual(aging["total_outstanding"], 550.0)
        self.assertEqual(len(aging["invoices"]), 1)

    @patch("app.services.credit_note_service.resolve_ap_company_id")
    @patch("app.services.credit_note_service.sync_ar_credit_note_to_gulftax")
    @patch("app.services.credit_note_service.create_journal_entry")
    def test_issue_full_credit_note_removes_from_aging(self, mock_je, mock_gt, mock_cid):
        mock_cid.return_value = self.company
        mock_je.return_value = _mock_je()
        mock_gt.return_value = {"ok": True}

        result = issue_credit_note(
            self.db,
            self.inv.id,
            1050,
            "Full credit",
            tenant_id=self.tenant,
            company_id=self.company,
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["outstanding_after"], 0.0)
        self.assertEqual(result["invoice_status"], "paid")

        aging = compute_ar_aging(self.db, self.tenant, self.company)
        self.assertEqual(aging["total_outstanding"], 0.0)
        self.assertEqual(len(aging["invoices"]), 0)

    @patch("app.services.credit_note_service.sync_ar_credit_note_to_gulftax")
    @patch("app.services.credit_note_service.create_journal_entry")
    def test_reject_amount_over_outstanding(self, mock_je, mock_gt):
        result = issue_credit_note(
            self.db,
            self.inv.id,
            2000,
            "Too much",
            tenant_id=self.tenant,
            company_id=self.company,
        )
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "amount_exceeds_outstanding")
        mock_je.assert_not_called()

    @patch("app.services.credit_note_service.resolve_ap_company_id")
    @patch("app.services.credit_note_service.sync_ar_credit_note_to_gulftax")
    @patch("app.services.credit_note_service.create_journal_entry")
    def test_void_blocked_when_invoice_paid_after_credit_note(self, mock_je, mock_gt, mock_cid):
        mock_cid.return_value = self.company
        mock_je.return_value = _mock_je()
        mock_gt.return_value = {"ok": True}

        issue = issue_credit_note(
            self.db,
            self.inv.id,
            500,
            "Partial",
            tenant_id=self.tenant,
            company_id=self.company,
        )
        cn_id = issue["credit_note"]["id"]

        inv = self.db.query(UAESalesInvoice).filter_by(id=self.inv.id).first()
        inv.paid_amount = 550
        inv.outstanding = 0
        inv.status = "paid"
        self.db.commit()

        void = void_credit_note(self.db, cn_id, tenant_id=self.tenant)
        self.assertFalse(void["ok"])
        self.assertEqual(void["error"], "void_blocked_invoice_paid_after_credit_note")


if __name__ == "__main__":
    unittest.main()
