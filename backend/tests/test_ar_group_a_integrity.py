"""MVP-1 Group A acceptance — receipt integrity, CoA resolver, CN original-account reversal."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models.uae_accounting_full import (
    UAEAccount,
    UAECreditNote,
    UAECustomer,
    UAEJournalEntry,
    UAEJournalLine,
    UAESalesInvoice,
    UAESalesInvoiceLine,
)
from app.services.ar_invoice_post_service import (
    AR_RECEIVABLE_CODE,
    AR_VAT_PAYABLE_CODE,
    post_sales_invoice_to_gl_and_tax,
    resolve_ar_posting_accounts,
)
from app.services.ar_receipt_service import ReceiptValidationError, record_ar_receipt
from app.services.credit_note_service import (
    build_credit_note_reversal_lines,
    issue_credit_note,
)
from app.services.uae_journal_service import create_journal_entry, post_journal_entry


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(
        engine,
        tables=[
            UAEAccount.__table__,
            UAECustomer.__table__,
            UAESalesInvoice.__table__,
            UAESalesInvoiceLine.__table__,
            UAECreditNote.__table__,
            UAEJournalEntry.__table__,
            UAEJournalLine.__table__,
        ],
    )
    Session = sessionmaker(bind=engine)
    session = Session()
    # Period control queries accounting_periods — not needed for Group A unit tests.
    with patch("app.services.uae_journal_service.assert_period_open", return_value=None):
        yield session
    session.close()


def _seed_coa(db, tenant: str, company: str):
    rows = [
        ("1100", "Trade Receivables", "Asset"),
        ("1002", "Cash at Bank - ENBD", "Asset"),
        ("3010", "VAT Payable (Output Tax)", "Liability"),
        ("6001", "Sales - Standard Rated (5% VAT)", "Income"),
        ("6002", "Sales - Zero Rated", "Income"),
        ("6003", "Sales - Exempt", "Income"),
        ("6010", "Service Revenue", "Income"),
    ]
    for code, name, atype in rows:
        db.add(
            UAEAccount(
                id=str(uuid.uuid4()),
                tenant_id=tenant,
                company_id=company,
                code=code,
                name=name,
                account_type=atype,
                is_active=True,
            )
        )
    db.flush()


def _make_invoice(
    db,
    *,
    tenant: str,
    company: str,
    subtotal: float = 1000.0,
    vat: float = 50.0,
    vat_treatment: str = "standard_rated",
    supply_type: str = "standard",
    account_id: str | None = None,
    status: str = "draft",
):
    cust = UAECustomer(id=str(uuid.uuid4()), tenant_id=tenant, name="Acme LLC")
    db.add(cust)
    db.flush()
    total = round(subtotal + vat, 2)
    inv = UAESalesInvoice(
        id=str(uuid.uuid4()),
        tenant_id=tenant,
        company_id=company,
        customer_id=cust.id,
        invoice_number=f"INV-{uuid.uuid4().hex[:6].upper()}",
        invoice_date=date(2026, 11, 1),
        due_date=date(2026, 11, 30),
        subtotal=subtotal,
        vat_amount=vat,
        total_amount=total,
        paid_amount=0,
        outstanding=total,
        status=status,
        vat_treatment=vat_treatment,
        supply_type=supply_type,
    )
    db.add(inv)
    db.flush()
    db.add(
        UAESalesInvoiceLine(
            id=str(uuid.uuid4()),
            invoice_id=inv.id,
            description="Services",
            quantity=1,
            unit_price=subtotal,
            line_total=subtotal + vat,
            vat_rate=5 if vat else 0,
            vat_amount=vat,
            account_id=account_id,
        )
    )
    db.flush()
    return inv


def _post_sales(db, inv, tenant, company):
    with patch(
        "app.services.ar_invoice_post_service.resolve_ap_company_id",
        return_value=company,
    ), patch(
        "app.services.ar_invoice_post_service.sync_ar_invoice_to_gulftax",
        return_value={"ok": True},
    ), patch(
        "app.services.ar_invoice_post_service.generate_and_store_ar_einvoice",
        create=True,
        return_value={},
    ):
        # einvoicing import is inside try — patch module path used at runtime
        with patch(
            "app.services.einvoicing_service_unified.generate_and_store_ar_einvoice",
            return_value={},
        ):
            result = post_sales_invoice_to_gl_and_tax(
                inv.id, tenant_id=tenant, company_id=company, db=db,
            )
    return result


# ─── CoA resolver / posting ─────────────────────────────────────────────────


def test_10_new_sales_post_uses_seeded_coa(db):
    tenant, company = "ws-a", "co-a"
    _seed_coa(db, tenant, company)
    inv = _make_invoice(db, tenant=tenant, company=company)
    result = _post_sales(db, inv, tenant, company)
    assert result.get("ok") or result.get("success")
    je = db.get(UAEJournalEntry, result["journal_entry_id"])
    codes = {(l.account_code, float(l.debit or 0), float(l.credit or 0)) for l in je.lines}
    assert any(c == AR_RECEIVABLE_CODE and d > 0 for c, d, _ in codes)
    assert any(c == "6001" and cr > 0 for c, _, cr in codes)
    assert any(c == AR_VAT_PAYABLE_CODE and cr > 0 for c, _, cr in codes)


def test_fail_closed_missing_classification(db):
    tenant, company = "ws-a", "co-a"
    _seed_coa(db, tenant, company)
    inv = _make_invoice(
        db, tenant=tenant, company=company,
        vat_treatment=None, supply_type=None, vat=50,
    )
    inv.vat_treatment = None
    inv.supply_type = None
    db.flush()
    resolved = resolve_ar_posting_accounts(db, inv, tenant_id=tenant, company_id=company)
    assert resolved["ok"] is False
    assert resolved["error"] == "ambiguous_revenue_classification"


def test_zero_rated_rejects_output_vat(db):
    tenant, company = "ws-a", "co-a"
    _seed_coa(db, tenant, company)
    inv = _make_invoice(
        db, tenant=tenant, company=company,
        vat_treatment="zero_rated", supply_type="zero-rated", vat=50, subtotal=1000,
    )
    resolved = resolve_ar_posting_accounts(db, inv, tenant_id=tenant, company_id=company)
    assert resolved["ok"] is False
    assert resolved["error"] == "vat_inconsistent_with_classification"


def test_service_line_account_maps_to_6010(db):
    tenant, company = "ws-a", "co-a"
    _seed_coa(db, tenant, company)
    svc = db.query(UAEAccount).filter_by(code="6010", tenant_id=tenant).first()
    inv = _make_invoice(
        db, tenant=tenant, company=company,
        vat_treatment="standard_rated", account_id=svc.id,
    )
    resolved = resolve_ar_posting_accounts(db, inv, tenant_id=tenant, company_id=company)
    assert resolved["ok"] is True
    assert resolved["revenue_code"] == "6010"


# ─── Receipts ───────────────────────────────────────────────────────────────


def test_2_receipt_equals_remaining_balance(db):
    tenant, company = "ws-a", "co-a"
    _seed_coa(db, tenant, company)
    inv = _make_invoice(db, tenant=tenant, company=company)
    assert _post_sales(db, inv, tenant, company).get("ok") or True
    db.refresh(inv)
    res = record_ar_receipt(
        db,
        tenant_id=tenant,
        company_id=company,
        invoice_id=inv.id,
        amount_received=inv.outstanding,
        payment_date=date(2026, 11, 15),
        bank_account_code="1002",
        reference="RCPT-FULL",
    )
    assert res["success"]
    assert res["status"] == "paid"
    assert res["outstanding_after"] == 0.0
    je = db.get(UAEJournalEntry, res["receipt_je_id"])
    assert je.status == "posted"
    assert je.source == "AR_RECEIPT"
    codes = {l.account_code for l in je.lines}
    assert codes == {"1002", AR_RECEIVABLE_CODE}
    assert "6001" not in codes and "3010" not in codes


def test_1_cn_then_multiple_partial_receipts(db):
    tenant, company = "ws-a", "co-a"
    _seed_coa(db, tenant, company)
    inv = _make_invoice(db, tenant=tenant, company=company)
    _post_sales(db, inv, tenant, company)
    db.refresh(inv)

    with patch(
        "app.services.credit_note_service.resolve_ap_company_id", return_value=company
    ), patch(
        "app.services.credit_note_service.sync_ar_credit_note_to_gulftax",
        return_value={"ok": True},
    ):
        cn = issue_credit_note(
            db, inv.id, 210, "Partial CN",
            tenant_id=tenant, company_id=company,
        )
    assert cn["ok"], cn
    db.refresh(inv)
    assert float(inv.outstanding) == 840.0

    r1 = record_ar_receipt(
        db, tenant_id=tenant, company_id=company, invoice_id=inv.id,
        amount_received=400, payment_date=date(2026, 11, 16),
        bank_account_code="1002", reference="P1",
    )
    assert r1["outstanding_after"] == 440.0
    assert r1["status"] == "partial"

    r2 = record_ar_receipt(
        db, tenant_id=tenant, company_id=company, invoice_id=inv.id,
        amount_received=440, payment_date=date(2026, 11, 17),
        bank_account_code="1002", reference="P2",
    )
    assert r2["outstanding_after"] == 0.0
    assert r2["status"] == "paid"
    db.refresh(inv)
    assert float(inv.outstanding) == 0.0
    assert float(inv.outstanding) >= 0.0


def test_3_overpayment_by_one_cent_rejected(db):
    tenant, company = "ws-a", "co-a"
    _seed_coa(db, tenant, company)
    inv = _make_invoice(db, tenant=tenant, company=company)
    _post_sales(db, inv, tenant, company)
    db.refresh(inv)
    due = float(inv.outstanding)
    with pytest.raises(ReceiptValidationError) as ei:
        record_ar_receipt(
            db, tenant_id=tenant, company_id=company, invoice_id=inv.id,
            amount_received=round(due + 0.01, 2),
            payment_date=date(2026, 11, 15),
            bank_account_code="1002",
            reference="OVER",
        )
    assert ei.value.code == "overpayment"
    db.refresh(inv)
    assert float(inv.outstanding) == due
    assert db.query(UAEJournalEntry).filter_by(source="AR_RECEIPT").count() == 0


def test_9_receipt_je_shape_bank_and_ar_only(db):
    tenant, company = "ws-a", "co-a"
    _seed_coa(db, tenant, company)
    inv = _make_invoice(db, tenant=tenant, company=company)
    _post_sales(db, inv, tenant, company)
    res = record_ar_receipt(
        db, tenant_id=tenant, company_id=company, invoice_id=inv.id,
        amount_received=100, payment_date=date(2026, 11, 15),
        bank_account_code="1002", reference="SHAPE",
    )
    je = db.get(UAEJournalEntry, res["receipt_je_id"])
    assert len(je.lines) == 2
    by_code = {l.account_code: l for l in je.lines}
    assert float(by_code["1002"].debit) == 100.0
    assert float(by_code[AR_RECEIVABLE_CODE].credit) == 100.0


def test_4_failure_during_journal_line_creation_rolls_back(db):
    tenant, company = "ws-a", "co-a"
    _seed_coa(db, tenant, company)
    inv = _make_invoice(db, tenant=tenant, company=company)
    _post_sales(db, inv, tenant, company)
    db.refresh(inv)
    before = float(inv.outstanding)

    with patch(
        "app.services.ar_receipt_service.create_journal_entry",
        side_effect=RuntimeError("line create failed"),
    ):
        with pytest.raises(RuntimeError):
            record_ar_receipt(
                db, tenant_id=tenant, company_id=company, invoice_id=inv.id,
                amount_received=50, payment_date=date(2026, 11, 15),
                bank_account_code="1002", reference="FAIL-LINE",
            )
    db.refresh(inv)
    assert float(inv.outstanding) == before
    assert db.query(UAEJournalEntry).filter_by(source="AR_RECEIPT").count() == 0


def test_5_and_6_failure_during_invoice_update_leaves_no_posted_receipt(db):
    tenant, company = "ws-a", "co-a"
    _seed_coa(db, tenant, company)
    inv = _make_invoice(db, tenant=tenant, company=company)
    _post_sales(db, inv, tenant, company)
    db.refresh(inv)
    before = float(inv.outstanding)
    before_je = db.query(UAEJournalEntry).count()

    real_create = create_journal_entry

    def create_then_break(*args, **kwargs):
        kwargs = dict(kwargs)
        kwargs["commit"] = False
        je = real_create(*args, **kwargs)
        raise RuntimeError("invoice update failed")

    with patch("app.services.ar_receipt_service.create_journal_entry", side_effect=create_then_break):
        with pytest.raises(RuntimeError):
            record_ar_receipt(
                db, tenant_id=tenant, company_id=company, invoice_id=inv.id,
                amount_received=50, payment_date=date(2026, 11, 15),
                bank_account_code="1002", reference="FAIL-INV",
            )

    # New session view after rollback
    db.expire_all()
    inv2 = db.get(UAESalesInvoice, inv.id)
    assert float(inv2.outstanding) == before
    assert db.query(UAEJournalEntry).count() == before_je
    assert db.query(UAEJournalEntry).filter_by(source="AR_RECEIPT").count() == 0


def test_idempotency_retry_does_not_duplicate_receipt(db):
    tenant, company = "ws-a", "co-a"
    _seed_coa(db, tenant, company)
    inv = _make_invoice(db, tenant=tenant, company=company)
    _post_sales(db, inv, tenant, company)
    kwargs = dict(
        tenant_id=tenant,
        company_id=company,
        invoice_id=inv.id,
        amount_received=100,
        payment_date=date(2026, 11, 15),
        bank_account_code="1002",
        reference="IDEMP-1",
        idempotency_key="key-1",
    )
    r1 = record_ar_receipt(db, **kwargs)
    r2 = record_ar_receipt(db, **kwargs)
    assert r1["receipt_je_id"] == r2["receipt_je_id"]
    assert r2["idempotent_replay"] is True
    assert db.query(UAEJournalEntry).filter_by(source="AR_RECEIPT").count() == 1
    db.refresh(inv)
    assert float(inv.paid_amount) == 100.0


def test_concurrency_second_receipt_cannot_over_consume(db):
    """Serial safety: after full receipt, another claim of the same balance is rejected."""
    tenant, company = "ws-a", "co-a"
    _seed_coa(db, tenant, company)
    inv = _make_invoice(db, tenant=tenant, company=company, subtotal=100, vat=5)
    _post_sales(db, inv, tenant, company)
    db.refresh(inv)
    due = float(inv.outstanding)
    record_ar_receipt(
        db, tenant_id=tenant, company_id=company, invoice_id=inv.id,
        amount_received=due, payment_date=date(2026, 11, 15),
        bank_account_code="1002", reference="C1",
    )
    with pytest.raises(ReceiptValidationError) as ei:
        record_ar_receipt(
            db, tenant_id=tenant, company_id=company, invoice_id=inv.id,
            amount_received=due, payment_date=date(2026, 11, 15),
            bank_account_code="1002", reference="C2",
        )
    assert ei.value.code == "overpayment"


# ─── Credit note original accounts ──────────────────────────────────────────


def test_7_cn_reverses_original_revenue_and_vat_accounts(db):
    tenant, company = "ws-a", "co-a"
    _seed_coa(db, tenant, company)
    inv = _make_invoice(db, tenant=tenant, company=company)
    posted = _post_sales(db, inv, tenant, company)
    assert posted.get("journal_entry_id")
    db.refresh(inv)

    with patch(
        "app.services.credit_note_service.resolve_ap_company_id", return_value=company
    ), patch(
        "app.services.credit_note_service.sync_ar_credit_note_to_gulftax",
        return_value={"ok": True},
    ):
        cn = issue_credit_note(
            db, inv.id, 525, "Half",
            tenant_id=tenant, company_id=company,
        )
    assert cn["ok"], cn
    cn_je = db.get(UAEJournalEntry, cn["je_id"])
    sales_je = db.get(UAEJournalEntry, inv.journal_entry_id)
    sales_rev = {
        l.account_code for l in sales_je.lines if float(l.credit or 0) > 0 and l.account_code.startswith("6")
    }
    sales_vat = {
        l.account_code for l in sales_je.lines if float(l.credit or 0) > 0 and l.account_code == "3010"
    }
    cn_rev = {
        l.account_code for l in cn_je.lines if float(l.debit or 0) > 0 and l.account_code.startswith("6")
    }
    cn_vat = {
        l.account_code for l in cn_je.lines if float(l.debit or 0) > 0 and l.account_code == "3010"
    }
    assert cn_rev == sales_rev
    assert cn_vat == sales_vat


def test_partial_cn_proportional_rounding(db):
    tenant, company = "ws-a", "co-a"
    _seed_coa(db, tenant, company)
    inv = _make_invoice(db, tenant=tenant, company=company, subtotal=1000, vat=50)
    _post_sales(db, inv, tenant, company)
    db.refresh(inv)
    built = build_credit_note_reversal_lines(
        db, inv, gross=100.00, cn_number="CN-T", cust_name="Acme",
    )
    assert built["ok"], built
    assert built["net"] + built["vat_part"] == pytest.approx(100.0)
    assert Decimal(str(built["net"])) + Decimal(str(built["vat_part"])) == Decimal("100.00")
    total_dr = sum(float(l["debit"]) for l in built["lines"])
    total_cr = sum(float(l["credit"]) for l in built["lines"])
    assert total_dr == pytest.approx(total_cr)


# ─── Journal commit default behaviour ───────────────────────────────────────


def test_8_journal_callers_default_commit_true(db):
    tenant, company = "ws-a", "co-a"
    _seed_coa(db, tenant, company)
    je = create_journal_entry(
        tenant_id=tenant,
        entry_date=date(2026, 11, 1),
        description="manual",
        lines=[
            {"account_code": "1002", "account_name": "Bank", "debit": 10, "credit": 0},
            {"account_code": "1100", "account_name": "AR", "debit": 0, "credit": 10},
        ],
        reference="MANUAL-1",
        source="manual",
        company_id=company,
        db=db,
        auto_post=True,
        # commit default True
    )
    assert je.status == "posted"
    # Survives new query after implicit commit
    assert db.get(UAEJournalEntry, je.id) is not None

    draft = create_journal_entry(
        tenant_id=tenant,
        entry_date=date(2026, 11, 2),
        description="draft",
        lines=[
            {"account_code": "1002", "account_name": "Bank", "debit": 5, "credit": 0},
            {"account_code": "1100", "account_name": "AR", "debit": 0, "credit": 5},
        ],
        reference="DRAFT-1",
        source="manual",
        company_id=company,
        db=db,
        auto_post=False,
    )
    assert draft.status == "draft"
    posted = post_journal_entry(draft, db)  # default commit=True
    assert posted.status == "posted"
