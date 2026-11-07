"""Fixes the month-end close depends on: accruals and IFRS 16 journals go through approval,
consolidation no longer double-counts company-less journals, and the shared 3-way match."""

from __future__ import annotations

import json
import os
from datetime import date

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models.users  # noqa: F401 - foreign-key targets
import app.models.workspace  # noqa: F401
from app.models.company_setup import AccountingPeriod, ConsolidationElimination, UaeCompanyProfile
from app.models.ifrs16_lease import IFRS16Lease
from app.models.uae_accounting_full import UAEAccount, UAEAccrual, UAEJournalEntry, UAEJournalLine
from app.modules.ifrs16.ifrs16_je_service import post_all_monthly_jes, post_monthly_jes
from app.services import consolidation_service as cs
from app.services.ap_bulk_invoice_service import classify_three_way
from app.services.uae_accruals_service import accrual_status, post_accrual
from app.services.uae_coa_service import seed_uae_chart_of_accounts
from app.services.uae_journal_service import create_journal_entry, post_journal_entry

WS = "aaaaaaaa-0000-4000-8000-000000000001"
TABLES = (UAEAccount, UAEJournalEntry, UAEJournalLine, UAEAccrual, AccountingPeriod, UaeCompanyProfile,
          ConsolidationElimination, IFRS16Lease)


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for model in TABLES:
        model.__table__.create(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _je(db, company, day, lines, status="posted"):
    entry = UAEJournalEntry(tenant_id=WS, company_id=company, entry_date=day, period=day.strftime("%Y-%m"),
                            description="test", status=status)
    entry.lines = [UAEJournalLine(account_code=c, debit=d, credit=k) for c, d, k in lines]
    db.add(entry)
    db.commit()
    return entry


def test_accrual_post_waits_for_approval(db):
    accrual = UAEAccrual(tenant_id=WS, period="2026-10", description="Audit fee accrual", amount=12000,
                         debit_account_code="7141", credit_account_code="3020", status="suggested")
    db.add(accrual)
    db.commit()
    res = post_accrual(accrual.id, WS, db)
    assert res["status"] == "pending_approval"
    je = db.get(UAEJournalEntry, res["je_id"])
    assert je.status == "pending_approval" and je.posted_at is None
    assert accrual_status(db.get(UAEAccrual, accrual.id), db) == "pending_approval"
    post_journal_entry(je, db)
    assert accrual_status(db.get(UAEAccrual, accrual.id), db) == "posted"
    with pytest.raises(ValueError):
        post_accrual(accrual.id, WS, db)


def _lease(db, company="c1"):
    rate, payment = 0.005, 10000.0
    schedule, balance = [], 300000.0
    for month in range(1, 13):
        interest = round(balance * rate, 2)
        closing = round(balance + interest - payment, 2)
        schedule.append({"Date": f"2026-{month:02d}-28", "Interest": interest, "Principal": round(payment - interest, 2),
                         "Payment": payment, "Closing_Balance": closing})
        balance = closing
    lease = IFRS16Lease(workspace_id=WS, company_id=company, lease_name="Warehouse", commencement_date=date(2026, 1, 1),
                        lease_term_months=36, lease_payments_aed=payment, incremental_borrowing_rate=0.06,
                        rou_asset_initial=300000, lease_liability_initial=300000, rou_asset_current=300000,
                        lease_liability_current=300000, status="active", calculation_json=json.dumps({"amortization_schedule": schedule}))
    db.add(lease)
    db.commit()
    return lease, schedule


def test_ifrs16_monthly_journals_are_balanced_pending_and_not_duplicated(db):
    lease, schedule = _lease(db)
    res = post_monthly_jes(db, lease.id, date(2026, 10, 31), WS, "c1")
    assert res["status"] == "pending_approval" and len(res["je_ids"]) == 3
    entries = {e.source: e for e in db.query(UAEJournalEntry).filter(UAEJournalEntry.id.in_(res["je_ids"]))}
    accounts = {src: {(l.account_code, float(l.debit), float(l.credit)) for l in e.lines} for src, e in entries.items()}
    row = schedule[9]
    assert accounts["IFRS16_DEPRECIATION"] == {("7112", 8333.33, 0), ("2011", 0, 8333.33)}
    assert accounts["IFRS16_INTEREST"] == {("7170", row["Interest"], 0), ("3030", 0, row["Interest"])}
    assert accounts["IFRS16_PAYMENT"] == {("3030", 10000, 0), ("1002", 0, 10000)}
    for e in entries.values():
        assert e.status == "pending_approval"
        assert sum(float(l.debit) for l in e.lines) == pytest.approx(sum(float(l.credit) for l in e.lines))
        post_journal_entry(e, db)
    with pytest.raises(ValueError, match="already exist"):
        post_monthly_jes(db, lease.id, date(2026, 10, 31), WS, "c1")
    bulk = post_all_monthly_jes(db, WS, "c1", date(2026, 11, 30))
    assert bulk["successful"] == 1 and bulk["results"][0]["journal_status"] == "pending_approval"


def test_consolidation_excludes_company_less_journals_and_uses_cumulative_balances(db):
    a = UaeCompanyProfile(workspace_id=WS, company_name="A Co", status="active")
    b = UaeCompanyProfile(workspace_id=WS, company_name="B Co", status="active")
    db.add_all([a, b])
    db.commit()
    for cid in (a.id, b.id):
        seed_uae_chart_of_accounts(WS, db, company_id=cid)
    period = AccountingPeriod(workspace_id=WS, period_number=202610, period_name="Oct 2026",
                              start_date=date(2026, 10, 1), end_date=date(2026, 10, 31), status="open")
    db.add(period)
    db.commit()
    _je(db, a.id, date(2026, 9, 5), [("1002", 100000, 0), ("5001", 0, 100000)])
    _je(db, a.id, date(2026, 10, 5), [("1100", 50000, 0), ("6010", 0, 50000)])
    _je(db, b.id, date(2026, 10, 6), [("1002", 20000, 0), ("6010", 0, 20000)])
    _je(db, None, date(2026, 10, 7), [("1002", 9999, 0), ("6010", 0, 9999)])

    pl = cs.get_consolidation_pl(db, WS, period.id)
    revenue = next(r for r in pl["rows"] if r["key"] == "revenue")
    assert revenue["companies"] == {a.id: 50000, b.id: 20000} and revenue["group_total"] == 70000
    assert pl["unassigned_lines"] == 2
    bs = cs.get_consolidation_bs(db, WS, period.id)
    assets = next(r for r in bs["rows"] if r["key"] == "total_assets")["companies"]
    assert assets == {a.id: 150000, b.id: 20000}
    assert bs["is_balanced"] and bs["total_assets"] == 170000


def test_classify_three_way():
    po = {"po_number": "PO-1", "po_amount": 1000, "vendor_name": "Acme Trading LLC"}
    grn = {"received_amount": 1000}
    inv = {"total_amount": 1050, "vat_amount": 50, "vendor_name": "Acme Trading"}
    assert classify_three_way(inv, po, grn)[0] == "three_way_matched"
    assert classify_three_way(inv, po, None)[0] == "matched"
    assert classify_three_way({**inv, "total_amount": 1500, "vat_amount": 0}, po, None)[0] == "partial"
    assert classify_three_way({**inv, "total_amount": 1500, "vat_amount": 0}, po, grn)[0] == "mismatch"
    status, notes, _ = classify_three_way({**inv, "vendor_name": "Other Supplies"}, po, grn)
    assert status == "mismatch" and notes.startswith("Vendor mismatch")
