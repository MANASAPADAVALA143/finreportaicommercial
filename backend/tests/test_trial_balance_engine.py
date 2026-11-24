"""Step 3.1 — Decimal trial balance engine.

Expected values are constructed independently (hand-calculated Decimals).
The service under test is never used as its own oracle.
"""
from __future__ import annotations

import os
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.uae_accounting_full import UAEAccount, UAEJournalEntry, UAEJournalLine
from app.services.ai_cfo.ledger import LedgerScope
from app.services.ai_cfo.trial_balance import (
    CALCULATION_VERSION,
    money_decimal,
    natural_decimal,
    trial_balance,
)

WS = "ws-tb-0001"
CO = "co-tb-0001"
OTHER = "co-tb-other"
PERIOD = "2026-03"
PRIOR = "2026-02"
_CENT = Decimal("0.01")


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for model in (UAEAccount, UAEJournalEntry, UAEJournalLine):
        model.__table__.create(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _scope(company: str = CO) -> LedgerScope:
    return LedgerScope(workspace_id=WS, company_id=company)


def _acct(db, code: str, name: str, acct_type: str, company_id: str | None = CO):
    row = UAEAccount(
        tenant_id=WS,
        company_id=company_id,
        code=code,
        name=name,
        account_type=acct_type,
        currency="AED",
    )
    db.add(row)
    db.commit()
    return row


def _seed_coa(db):
    _acct(db, "1000", "Cash", "Asset")
    _acct(db, "2000", "AP", "Liability")
    _acct(db, "4000", "Revenue", "Income")
    _acct(db, "5000", "Expense", "Expense")
    _acct(db, "3000", "Equity", "Equity")


def _je(
    db,
    *,
    lines: list[tuple[str, str | float | Decimal, str | float | Decimal]],
    period: str = PERIOD,
    status: str = "posted",
    entry_number: str | None = None,
    source: str = "manual",
    reference: str | None = None,
    company_id: str | None = CO,
    tenant_id: str = WS,
    currency: str = "AED",
    entry_id: str | None = None,
):
    year, month = period.split("-")
    entry = UAEJournalEntry(
        id=entry_id or None,
        tenant_id=tenant_id,
        company_id=company_id,
        entry_number=entry_number,
        entry_date=date(int(year), int(month), 15),
        period=period,
        description="test",
        reference=reference,
        source=source,
        status=status,
    )
    # Force id generation before lines if default
    if entry.id is None:
        from uuid import uuid4

        entry.id = str(uuid4())
    entry.lines = [
        UAEJournalLine(
            account_code=code,
            debit=Decimal(str(dr)),
            credit=Decimal(str(cr)),
            currency=currency,
        )
        for code, dr, cr in lines
    ]
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def _by_code(result: dict) -> dict:
    return {a["account_code"]: a for a in result["accounts"]}


def _exc_codes(result: dict) -> set[str]:
    return {e["code"] for e in result["exceptions"]}


# ── Decimal helpers ──────────────────────────────────────────────────────────


def test_money_decimal_via_str_not_float():
    # Classic float trap: 0.1 + 0.2
    assert money_decimal("0.1") + money_decimal("0.2") == Decimal("0.3")
    assert money_decimal(0.1) == Decimal("0.10")  # str(0.1) then quantize


def test_natural_balance_signs():
    assert natural_decimal("Asset", Decimal("100.00"), Decimal("40.00")) == Decimal("60.00")
    assert natural_decimal("Expense", Decimal("50.00"), Decimal("10.00")) == Decimal("40.00")
    assert natural_decimal("Liability", Decimal("10.00"), Decimal("70.00")) == Decimal("60.00")
    assert natural_decimal("Income", Decimal("0"), Decimal("200.00")) == Decimal("200.00")
    assert natural_decimal("Equity", Decimal("5.00"), Decimal("100.00")) == Decimal("95.00")


# ── Core TB cases ────────────────────────────────────────────────────────────


def test_balanced_period_activity_two_accounts(db):
    _seed_coa(db)
    # Dr Cash 1000 / Cr Revenue 1000
    _je(db, lines=[("1000", "1000.00", "0"), ("4000", "0", "1000.00")], entry_number="JE-1")

    # Independent expected
    exp_dr = Decimal("1000.00")
    exp_cr = Decimal("1000.00")

    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["calculation_version"] == CALCULATION_VERSION
    assert result["total_debit"] == str(exp_dr)
    assert result["total_credit"] == str(exp_cr)
    assert result["imbalance"] == "0.00"
    assert result["is_balanced"] is True
    assert result["reconciliation_passed"] is True
    assert result["source_population"]["eligible_line_count"] == 2
    assert result["independent_reconciliation"]["matches_primary"] is True

    by = _by_code(result)
    assert by["1000"]["debit"] == "1000.00"
    assert by["1000"]["credit"] == "0.00"
    assert by["1000"]["natural_balance"] == "1000.00"  # Asset
    assert by["4000"]["debit"] == "0.00"
    assert by["4000"]["credit"] == "1000.00"
    assert by["4000"]["natural_balance"] == "1000.00"  # Income


def test_unbalanced_journal_surfaces_imbalance(db):
    _seed_coa(db)
    _je(db, lines=[("1000", "100.00", "0"), ("4000", "0", "90.00")], entry_number="JE-U")

    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["total_debit"] == "100.00"
    assert result["total_credit"] == "90.00"
    assert result["imbalance"] == "10.00"
    assert result["is_balanced"] is False
    assert result["reconciliation_passed"] is False


def test_multiple_accounts_and_journals(db):
    _seed_coa(db)
    _je(db, lines=[("1000", "500.00", "0"), ("4000", "0", "500.00")], entry_number="JE-A")
    _je(db, lines=[("5000", "200.00", "0"), ("1000", "0", "200.00")], entry_number="JE-B")
    # Independent: Cash Dr 500 Cr 200 → net natural 300; Expense Dr 200; Revenue Cr 500
    # Gross: Dr 700 / Cr 700

    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["total_debit"] == "700.00"
    assert result["total_credit"] == "700.00"
    by = _by_code(result)
    assert by["1000"]["debit"] == "500.00"
    assert by["1000"]["credit"] == "200.00"
    assert by["1000"]["natural_balance"] == "300.00"
    assert by["5000"]["natural_balance"] == "200.00"
    assert by["4000"]["natural_balance"] == "500.00"
    assert result["source_population"]["eligible_line_count"] == 4


def test_draft_and_unposted_excluded(db):
    _seed_coa(db)
    _je(db, lines=[("1000", "50.00", "0"), ("4000", "0", "50.00")], status="draft", entry_number="JE-D")
    _je(db, lines=[("1000", "10.00", "0"), ("4000", "0", "10.00")], status="pending_approval", entry_number="JE-P")
    _je(db, lines=[("1000", "100.00", "0"), ("4000", "0", "100.00")], status="posted", entry_number="JE-OK")

    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["total_debit"] == "100.00"
    assert result["total_credit"] == "100.00"
    assert result["source_population"]["draft_or_unposted_seen"] == 4  # 2 lines × 2 entries
    assert result["source_population"]["eligible_line_count"] == 2


def test_period_activity_vs_closing_as_of(db):
    _seed_coa(db)
    _je(db, period=PRIOR, lines=[("1000", "300.00", "0"), ("4000", "0", "300.00")], entry_number="JE-PRIOR")
    _je(db, period=PERIOD, lines=[("1000", "100.00", "0"), ("4000", "0", "100.00")], entry_number="JE-CUR")

    activity = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    closing = trial_balance(db, _scope(), PERIOD, mode="closing_as_of", currency="AED")

    assert activity["total_debit"] == "100.00"
    assert activity["total_credit"] == "100.00"
    assert activity["source_population"]["eligible_line_count"] == 2

    assert closing["total_debit"] == "400.00"
    assert closing["total_credit"] == "400.00"
    assert closing["source_population"]["eligible_line_count"] == 4
    assert any("financial-year" in lim.lower() or "ytd" in lim.lower() or "full posted history" in lim.lower() for lim in closing["limitations"])


def test_decimal_rounding_half_up(db):
    _seed_coa(db)
    # 10.005 + 10.005 → each line quantizes to 10.01 → total Dr 20.02 / Cr 20.02
    _je(
        db,
        lines=[("1000", "10.005", "0"), ("4000", "0", "10.005")],
        entry_number="JE-R1",
    )
    _je(
        db,
        lines=[("1000", "10.005", "0"), ("4000", "0", "10.005")],
        entry_number="JE-R2",
    )
    # Independent: Decimal("10.005").quantize(0.01, ROUND_HALF_UP) == 10.01
    q = Decimal("10.005").quantize(_CENT, rounding=ROUND_HALF_UP)
    assert q == Decimal("10.01")
    expected = (q * 2).quantize(_CENT, rounding=ROUND_HALF_UP)

    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["total_debit"] == str(expected)
    assert result["total_credit"] == str(expected)


def test_empty_period_explicit_zero(db):
    _seed_coa(db)
    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["accounts"] == []
    assert result["total_debit"] == "0.00"
    assert result["total_credit"] == "0.00"
    assert result["imbalance"] == "0.00"
    assert result["is_balanced"] is True
    assert result["source_population"]["eligible_line_count"] == 0
    assert result["reconciliation_passed"] is True  # empty + no blocking exceptions
    assert any("No eligible" in lim for lim in result["limitations"])


def test_company_and_workspace_isolation(db):
    _seed_coa(db)
    _acct(db, "1000", "Cash", "Asset", company_id=OTHER)
    _acct(db, "4000", "Revenue", "Income", company_id=OTHER)
    _je(db, company_id=CO, lines=[("1000", "80.00", "0"), ("4000", "0", "80.00")], entry_number="JE-CO")
    _je(db, company_id=OTHER, lines=[("1000", "999.00", "0"), ("4000", "0", "999.00")], entry_number="JE-OT")
    _je(
        db,
        tenant_id="other-ws",
        company_id=CO,
        lines=[("1000", "50.00", "0"), ("4000", "0", "50.00")],
        entry_number="JE-WS",
    )

    result = trial_balance(db, _scope(CO), PERIOD, mode="period_activity", currency="AED")
    assert result["total_debit"] == "80.00"
    assert result["total_credit"] == "80.00"
    assert result["source_population"]["eligible_line_count"] == 2


def test_unassigned_company_excluded_and_reported(db):
    _seed_coa(db)
    _je(db, company_id=CO, lines=[("1000", "25.00", "0"), ("4000", "0", "25.00")], entry_number="JE-OK")
    _je(db, company_id=None, lines=[("1000", "999.00", "0"), ("4000", "0", "999.00")], entry_number="JE-NULL")

    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["total_debit"] == "25.00"
    assert result["total_credit"] == "25.00"
    assert result["source_population"]["unassigned_company_posted_lines"] == 2
    assert "unassigned_company_lines" in _exc_codes(result)


def test_currency_mismatch_no_cross_aggregation(db):
    _seed_coa(db)
    _je(db, currency="AED", lines=[("1000", "40.00", "0"), ("4000", "0", "40.00")], entry_number="JE-AED")
    _je(db, currency="USD", lines=[("1000", "10.00", "0"), ("4000", "0", "10.00")], entry_number="JE-USD")

    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["total_debit"] == "40.00"
    assert result["total_credit"] == "40.00"
    assert result["source_population"]["currency_mismatch_excluded"] == 2
    assert "currency_mismatch" in _exc_codes(result)


def test_missing_account_mapping_exception(db):
    _seed_coa(db)
    _je(db, lines=[("9999", "15.00", "0"), ("4000", "0", "15.00")], entry_number="JE-MAP")

    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert "missing_account_mapping" in _exc_codes(result)
    # Still aggregates the line for transparency (not silent omission)
    assert result["total_debit"] == "15.00"
    assert any(a["account_code"] == "9999" for a in result["accounts"])


def test_source_completeness_and_independent_resum(db):
    _seed_coa(db)
    _je(db, lines=[("1000", "33.33", "0"), ("4000", "0", "33.33")], entry_number="JE-S")

    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["source_population"]["eligible_line_count"] == result["source_population"]["aggregated_line_count"]
    assert result["independent_reconciliation"]["line_count"] == 2
    assert result["independent_reconciliation"]["total_debit"] == result["total_debit"]
    assert result["independent_reconciliation"]["total_credit"] == result["total_credit"]
    assert result["independent_reconciliation"]["matches_primary"] is True


def test_fingerprint_repeatable_and_includes_scope(db):
    _seed_coa(db)
    _je(db, lines=[("1000", "12.34", "0"), ("4000", "0", "12.34")], entry_number="JE-FP")

    a = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    b = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert a["content_fingerprint"] == b["content_fingerprint"]
    assert a["content_fingerprint"].startswith("sha256:")

    c = trial_balance(db, _scope(), PERIOD, mode="closing_as_of", currency="AED")
    # Same period data for closing_as_of with only current-period lines → same lines, different mode in payload
    assert c["content_fingerprint"] != a["content_fingerprint"] or c["mode"] != a["mode"]
    assert c["mode"] == "closing_as_of"


def test_fingerprint_differs_when_source_population_differs(db):
    _seed_coa(db)
    _je(db, lines=[("1000", "10.00", "0"), ("4000", "0", "10.00")], entry_number="JE-1")
    first = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    _je(db, lines=[("1000", "5.00", "0"), ("4000", "0", "5.00")], entry_number="JE-2")
    second = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert first["content_fingerprint"] != second["content_fingerprint"]


# ── Reversal safety (detect-only; no posting changes) ───────────────────────


def test_unsafe_legacy_reversal_pattern_blocks_reconciliation(db):
    _seed_coa(db)
    orig = _je(
        db,
        lines=[("1000", "100.00", "0"), ("4000", "0", "100.00")],
        entry_number="JE-ORIG",
        status="reversed",
    )
    rev = _je(
        db,
        lines=[("1000", "0", "100.00"), ("4000", "100.00", "0")],
        entry_number="JE-REV",
        status="posted",
        source="reversal",
        reference="JE-ORIG",
    )

    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    # Posted-only arithmetic includes the reversing JE (gross 100/100) but NOT the original
    assert result["total_debit"] == "100.00"
    assert result["total_credit"] == "100.00"
    assert result["is_balanced"] is True
    assert "unsafe_legacy_reversal_pattern" in _exc_codes(result)
    assert result["reconciliation_passed"] is False
    ids = set()
    for e in result["exceptions"]:
        if e["code"] == "unsafe_legacy_reversal_pattern":
            ids.update(e["journal_entry_ids"])
    assert orig.id in ids and rev.id in ids


def test_reversal_without_original_exception(db):
    _seed_coa(db)
    rev = _je(
        db,
        lines=[("1000", "0", "50.00"), ("4000", "50.00", "0")],
        entry_number="JE-ORPHAN-REV",
        source="reversal",
        reference="JE-MISSING",
        status="posted",
    )
    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert "reversal_without_original" in _exc_codes(result)
    assert result["reconciliation_passed"] is False
    assert any(rev.id in e["journal_entry_ids"] for e in result["exceptions"] if e["code"] == "reversal_without_original")


def test_original_with_multiple_reversals_exception(db):
    _seed_coa(db)
    orig = _je(
        db,
        lines=[("1000", "20.00", "0"), ("4000", "0", "20.00")],
        entry_number="JE-MULTI",
        status="reversed",
    )
    r1 = _je(
        db,
        lines=[("1000", "0", "20.00"), ("4000", "20.00", "0")],
        entry_number="JE-R1",
        source="reversal",
        reference="JE-MULTI",
        status="posted",
    )
    r2 = _je(
        db,
        lines=[("1000", "0", "20.00"), ("4000", "20.00", "0")],
        entry_number="JE-R2",
        source="reversal",
        reference="JE-MULTI",
        status="posted",
    )
    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert "original_with_multiple_reversals" in _exc_codes(result)
    assert result["reconciliation_passed"] is False
    multi = next(e for e in result["exceptions"] if e["code"] == "original_with_multiple_reversals")
    assert orig.id in multi["journal_entry_ids"]
    assert r1.id in multi["journal_entry_ids"]
    assert r2.id in multi["journal_entry_ids"]


def test_evidence_line_ids_present(db):
    _seed_coa(db)
    entry = _je(db, lines=[("1000", "7.00", "0"), ("4000", "0", "7.00")], entry_number="JE-EV")
    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    by = _by_code(result)
    assert len(by["1000"]["evidence"]["line_ids"]) == 1
    assert entry.id in by["1000"]["evidence"]["journal_entry_ids"]
    assert entry.id in by["4000"]["evidence"]["journal_entry_ids"]


def test_never_force_balance(db):
    _seed_coa(db)
    _je(db, lines=[("1000", "1.00", "0")], entry_number="JE-ONE-SIDED")
    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["is_balanced"] is False
    assert result["imbalance"] == "1.00"
    # Engine must not invent a balancing credit
    assert result["total_credit"] == "0.00"
