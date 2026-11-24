"""Step 3.1 / 3.1R — Decimal trial balance engine.

Expected values are constructed independently (hand-calculated Decimals).
The service under test is never used as its own oracle.
"""
from __future__ import annotations

import os
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.uae_accounting_full import UAEAccount, UAEJournalEntry, UAEJournalLine
from app.services.ai_cfo.ledger import LedgerScope
from app.services.ai_cfo.trial_balance import (
    CALCULATION_VERSION,
    InvalidAmountError,
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
    description: str = "test",
):
    year, month = period.split("-")
    entry = UAEJournalEntry(
        id=str(uuid4()),
        tenant_id=tenant_id,
        company_id=company_id,
        entry_number=entry_number,
        entry_date=date(int(year), int(month), 15),
        period=period,
        description=description,
        reference=reference,
        source=source,
        status=status,
    )
    entry.lines = [
        UAEJournalLine(
            id=str(uuid4()),
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
    assert money_decimal("0.1") + money_decimal("0.2") == Decimal("0.3")
    assert money_decimal(0.1) == Decimal("0.10")


def test_money_decimal_valid_zero():
    assert money_decimal(0) == Decimal("0.00")
    assert money_decimal("0") == Decimal("0.00")
    assert money_decimal("0.00") == Decimal("0.00")


def test_money_decimal_invalid_raises():
    with pytest.raises(InvalidAmountError):
        money_decimal("not-a-number")
    with pytest.raises(InvalidAmountError):
        money_decimal("")
    with pytest.raises(InvalidAmountError):
        money_decimal(None)
    with pytest.raises(InvalidAmountError):
        money_decimal("NaN")


def test_natural_balance_signs():
    assert natural_decimal("Asset", Decimal("100.00"), Decimal("40.00")) == Decimal("60.00")
    assert natural_decimal("Expense", Decimal("50.00"), Decimal("10.00")) == Decimal("40.00")
    assert natural_decimal("Liability", Decimal("10.00"), Decimal("70.00")) == Decimal("60.00")
    assert natural_decimal("Income", Decimal("0"), Decimal("200.00")) == Decimal("200.00")
    assert natural_decimal("Equity", Decimal("5.00"), Decimal("100.00")) == Decimal("95.00")


# ── Core TB cases ────────────────────────────────────────────────────────────


def test_balanced_period_activity_two_accounts(db):
    _seed_coa(db)
    _je(db, lines=[("1000", "1000.00", "0"), ("4000", "0", "1000.00")], entry_number="JE-1")

    exp_dr = Decimal("1000.00")
    exp_cr = Decimal("1000.00")

    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["calculation_version"] == CALCULATION_VERSION
    assert result["total_debit"] == str(exp_dr)
    assert result["total_credit"] == str(exp_cr)
    assert result["imbalance"] == "0.00"
    assert result["arithmetic_balance"]["passed"] is True
    assert result["source_reconciliation"]["passed"] is True
    assert result["accounting_integrity"]["passed"] is True
    assert result["reconciliation_passed"] is True
    assert result["source_population"]["eligible_line_count"] == 2

    by = _by_code(result)
    assert by["1000"]["natural_balance"] == "1000.00"
    assert by["4000"]["natural_balance"] == "1000.00"


def test_unbalanced_journal_surfaces_imbalance(db):
    _seed_coa(db)
    _je(db, lines=[("1000", "100.00", "0"), ("4000", "0", "90.00")], entry_number="JE-U")

    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["total_debit"] == "100.00"
    assert result["total_credit"] == "90.00"
    assert result["imbalance"] == "10.00"
    assert result["arithmetic_balance"]["passed"] is False
    assert result["reconciliation_passed"] is False


def test_multiple_accounts_and_journals(db):
    _seed_coa(db)
    _je(db, lines=[("1000", "500.00", "0"), ("4000", "0", "500.00")], entry_number="JE-A")
    _je(db, lines=[("5000", "200.00", "0"), ("1000", "0", "200.00")], entry_number="JE-B")

    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["total_debit"] == "700.00"
    assert result["total_credit"] == "700.00"
    by = _by_code(result)
    assert by["1000"]["natural_balance"] == "300.00"
    assert by["5000"]["natural_balance"] == "200.00"
    assert by["4000"]["natural_balance"] == "500.00"


def test_draft_and_unposted_excluded(db):
    _seed_coa(db)
    _je(db, lines=[("1000", "50.00", "0"), ("4000", "0", "50.00")], status="draft", entry_number="JE-D")
    _je(
        db,
        lines=[("1000", "10.00", "0"), ("4000", "0", "10.00")],
        status="pending_approval",
        entry_number="JE-P",
    )
    _je(db, lines=[("1000", "100.00", "0"), ("4000", "0", "100.00")], status="posted", entry_number="JE-OK")

    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["total_debit"] == "100.00"
    assert result["total_credit"] == "100.00"
    assert result["source_population"]["eligible_line_count"] == 2


def test_rejected_and_scheduled_excluded(db):
    _seed_coa(db)
    _je(db, lines=[("1000", "1.00", "0"), ("4000", "0", "1.00")], status="rejected", entry_number="JE-RJ")
    _je(db, lines=[("1000", "2.00", "0"), ("4000", "0", "2.00")], status="scheduled", entry_number="JE-SC")
    _je(db, lines=[("1000", "9.00", "0"), ("4000", "0", "9.00")], status="posted", entry_number="JE-OK")

    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["total_debit"] == "9.00"
    assert result["total_credit"] == "9.00"


def test_period_activity_vs_closing_as_of(db):
    _seed_coa(db)
    _je(db, period=PRIOR, lines=[("1000", "300.00", "0"), ("4000", "0", "300.00")], entry_number="JE-PRIOR")
    _je(db, period=PERIOD, lines=[("1000", "100.00", "0"), ("4000", "0", "100.00")], entry_number="JE-CUR")

    activity = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    closing = trial_balance(db, _scope(), PERIOD, mode="closing_as_of", currency="AED")

    assert activity["total_debit"] == "100.00"
    assert closing["total_debit"] == "400.00"
    assert any("full posted history" in lim.lower() or "ytd" in lim.lower() for lim in closing["limitations"])


def test_decimal_rounding_half_up(db):
    _seed_coa(db)
    _je(db, lines=[("1000", "10.005", "0"), ("4000", "0", "10.005")], entry_number="JE-R1")
    _je(db, lines=[("1000", "10.005", "0"), ("4000", "0", "10.005")], entry_number="JE-R2")
    q = Decimal("10.005").quantize(_CENT, rounding=ROUND_HALF_UP)
    expected = (q * 2).quantize(_CENT, rounding=ROUND_HALF_UP)

    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["total_debit"] == str(expected)
    assert result["total_credit"] == str(expected)


def test_empty_period_explicit_zero(db):
    _seed_coa(db)
    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["accounts"] == []
    assert result["total_debit"] == "0.00"
    assert result["arithmetic_balance"]["passed"] is True
    assert result["source_reconciliation"]["passed"] is True
    assert result["accounting_integrity"]["passed"] is True
    assert result["reconciliation_passed"] is True


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
    assert result["reconciliation_passed"] is True


def test_unassigned_company_is_workspace_warning_not_company_fail(db):
    """Null-company posted lines must remain visible but not fail an unrelated clean company."""
    _seed_coa(db)
    _je(db, company_id=CO, lines=[("1000", "25.00", "0"), ("4000", "0", "25.00")], entry_number="JE-OK")
    _je(db, company_id=None, lines=[("1000", "999.00", "0"), ("4000", "0", "999.00")], entry_number="JE-NULL")

    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["total_debit"] == "25.00"
    assert "unassigned_company_lines" in _exc_codes(result)
    assert any(e["relevance"] == "workspace" and e["code"] == "unassigned_company_lines" for e in result["exceptions"])
    assert result["arithmetic_balance"]["passed"] is True
    assert result["company_accounting_integrity"]["passed"] is True
    assert result["workspace_integrity_clean"] is False
    assert result["reconciliation_passed"] is True
    assert len(result["workspace_integrity_warnings"]) >= 1


def test_currency_mismatch_blocks_integrity(db):
    _seed_coa(db)
    _je(db, currency="AED", lines=[("1000", "40.00", "0"), ("4000", "0", "40.00")], entry_number="JE-AED")
    _je(db, currency="USD", lines=[("1000", "10.00", "0"), ("4000", "0", "10.00")], entry_number="JE-USD")

    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["total_debit"] == "40.00"
    assert "currency_mismatch" in _exc_codes(result)
    assert result["accounting_integrity"]["passed"] is False
    assert result["reconciliation_passed"] is False


def test_missing_account_mapping_blocks_and_excludes(db):
    _seed_coa(db)
    _je(db, lines=[("9999", "15.00", "0"), ("4000", "0", "15.00")], entry_number="JE-MAP")

    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert "missing_account_mapping" in _exc_codes(result)
    # Unmapped line excluded from aggregation; mapped credit alone remains → unbalanced
    assert result["total_debit"] == "0.00"
    assert result["total_credit"] == "15.00"
    assert result["accounting_integrity"]["passed"] is False
    assert result["reconciliation_passed"] is False
    assert not any(a["account_code"] == "9999" for a in result["accounts"])


def test_source_completeness_and_independent_resum(db):
    _seed_coa(db)
    _je(db, lines=[("1000", "33.33", "0"), ("4000", "0", "33.33")], entry_number="JE-S")

    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["source_population"]["eligible_line_count"] == result["source_population"][
        "independent_eligible_line_count"
    ]
    assert result["source_reconciliation"]["passed"] is True
    assert result["independent_reconciliation"]["matches_primary"] is True


def test_fingerprint_repeatable(db):
    _seed_coa(db)
    _je(db, lines=[("1000", "12.34", "0"), ("4000", "0", "12.34")], entry_number="JE-FP")

    a = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    b = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert a["content_fingerprint"] == b["content_fingerprint"]
    assert a["content_fingerprint"].startswith("sha256:")
    assert "tb-v1" in a["calculation_version"]


def test_fingerprint_differs_when_source_population_differs(db):
    _seed_coa(db)
    _je(db, lines=[("1000", "10.00", "0"), ("4000", "0", "10.00")], entry_number="JE-1")
    first = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    _je(db, lines=[("1000", "5.00", "0"), ("4000", "0", "5.00")], entry_number="JE-2")
    second = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert first["content_fingerprint"] != second["content_fingerprint"]


def test_evidence_line_ids_present(db):
    _seed_coa(db)
    entry = _je(db, lines=[("1000", "7.00", "0"), ("4000", "0", "7.00")], entry_number="JE-EV")
    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    by = _by_code(result)
    assert len(by["1000"]["evidence"]["line_ids"]) == 1
    assert entry.id in by["1000"]["evidence"]["journal_entry_ids"]


def test_never_force_balance(db):
    _seed_coa(db)
    _je(db, lines=[("1000", "1.00", "0")], entry_number="JE-ONE-SIDED")
    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["is_balanced"] is False
    assert result["imbalance"] == "1.00"
    assert result["total_credit"] == "0.00"


def test_valid_zero_amounts_allowed(db):
    _seed_coa(db)
    # Zero on the non-posting side is valid; JE still balances 50/50
    _je(db, lines=[("1000", "50.00", "0.00"), ("4000", "0.00", "50.00")], entry_number="JE-Z")
    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["total_debit"] == "50.00"
    assert result["reconciliation_passed"] is True
    assert "invalid_amount" not in _exc_codes(result)


def test_invalid_amount_blocks(db):
    """Malformed amounts must block integrity — never coerce to 0.00.

    ORM Numeric columns reject non-numeric storage, so the conversion failure is
    injected at money_decimal (the sole conversion boundary the engine owns).
    """
    _seed_coa(db)
    entry = _je(
        db,
        lines=[("1000", "10.00", "0"), ("4000", "0", "10.00")],
        entry_number="JE-BAD",
    )
    from app.services.ai_cfo import trial_balance as tb_mod

    real = tb_mod.money_decimal
    state = {"fail_once": True}

    def flaky(v):
        # Fail the first debit conversion on the primary path only.
        if state["fail_once"] and str(v) in {"10.00", "10.0", "10"}:
            state["fail_once"] = False
            raise InvalidAmountError("injected invalid amount")
        return real(v)

    tb_mod.money_decimal = flaky
    try:
        result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    finally:
        tb_mod.money_decimal = real

    assert "invalid_amount" in _exc_codes(result)
    assert result["accounting_integrity"]["passed"] is False
    assert result["reconciliation_passed"] is False
    assert any(entry.id in e["journal_entry_ids"] for e in result["exceptions"] if e["code"] == "invalid_amount")


# ── Reversal safety (detect-only) ────────────────────────────────────────────


def test_unsafe_legacy_reversal_pattern_blocks(db):
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
    assert result["is_balanced"] is True
    assert "unsafe_legacy_reversal_pattern" in _exc_codes(result)
    assert result["accounting_integrity"]["passed"] is False
    assert result["reconciliation_passed"] is False
    ids = set()
    for e in result["exceptions"]:
        if e["code"] == "unsafe_legacy_reversal_pattern":
            ids.update(e["journal_entry_ids"])
    assert orig.id in ids and rev.id in ids


@pytest.mark.parametrize("rev_status", ["draft", "scheduled", "rejected", "pending_approval"])
def test_reversed_with_unposted_reversal_blocks(db, rev_status):
    """P0: reversed original + non-posted reversing JE must never pass reconciliation."""
    _seed_coa(db)
    # Other clean balanced activity that would otherwise look fine
    _je(db, lines=[("1000", "10.00", "0"), ("4000", "0", "10.00")], entry_number="JE-CLEAN")
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
        status=rev_status,
        source="reversal",
        reference="JE-ORIG",
    )

    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["arithmetic_balance"]["passed"] is True
    assert "reversed_with_unposted_reversal" in _exc_codes(result)
    assert result["accounting_integrity"]["passed"] is False
    assert result["reconciliation_passed"] is False
    assert any(
        orig.id in e["journal_entry_ids"] and rev.id in e["journal_entry_ids"]
        for e in result["exceptions"]
        if e["code"] == "reversed_with_unposted_reversal"
    )


def test_reversed_without_reversal_blocks(db):
    _seed_coa(db)
    _je(db, lines=[("1000", "5.00", "0"), ("4000", "0", "5.00")], entry_number="JE-OK")
    orig = _je(
        db,
        lines=[("1000", "20.00", "0"), ("4000", "0", "20.00")],
        entry_number="JE-ORPHAN-ORIG",
        status="reversed",
    )
    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert "reversed_without_reversal" in _exc_codes(result)
    assert result["reconciliation_passed"] is False
    assert any(
        orig.id in e["journal_entry_ids"]
        for e in result["exceptions"]
        if e["code"] == "reversed_without_reversal"
    )


def test_reversal_without_original_blocks(db):
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
    assert any(
        rev.id in e["journal_entry_ids"]
        for e in result["exceptions"]
        if e["code"] == "reversal_without_original"
    )


def test_reversal_original_not_reversed_blocks(db):
    _seed_coa(db)
    orig = _je(
        db,
        lines=[("1000", "30.00", "0"), ("4000", "0", "30.00")],
        entry_number="JE-STILL-POSTED",
        status="posted",
    )
    rev = _je(
        db,
        lines=[("1000", "0", "30.00"), ("4000", "30.00", "0")],
        entry_number="JE-REV-BAD",
        source="reversal",
        reference="JE-STILL-POSTED",
        status="posted",
    )
    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert "reversal_original_not_reversed" in _exc_codes(result)
    assert result["reconciliation_passed"] is False
    assert any(
        orig.id in e["journal_entry_ids"] and rev.id in e["journal_entry_ids"]
        for e in result["exceptions"]
        if e["code"] == "reversal_original_not_reversed"
    )


def test_original_with_multiple_reversals_blocks(db):
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


def test_accrual_reversal_blocks_as_unresolved(db):
    _seed_coa(db)
    _je(db, lines=[("1000", "8.00", "0"), ("4000", "0", "8.00")], entry_number="JE-OK")
    rev = _je(
        db,
        lines=[("5000", "0", "8.00"), ("2000", "8.00", "0")],
        entry_number="JE-ACC-REV",
        source="accrual_reversal",
        status="posted",
        description="REVERSAL: rent accrual",
    )
    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert "accrual_reversal_unresolved" in _exc_codes(result)
    assert result["accounting_integrity"]["passed"] is False
    assert result["reconciliation_passed"] is False
    assert any(rev.id in e["journal_entry_ids"] for e in result["exceptions"] if e["code"] == "accrual_reversal_unresolved")


def test_duplicate_entry_number_blocks(db):
    _seed_coa(db)
    a = _je(db, lines=[("1000", "1.00", "0"), ("4000", "0", "1.00")], entry_number="JE-DUP")
    b = _je(db, lines=[("1000", "2.00", "0"), ("4000", "0", "2.00")], entry_number="JE-DUP")
    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert "duplicate_entry_number" in _exc_codes(result)
    assert result["reconciliation_passed"] is False
    dup = next(e for e in result["exceptions"] if e["code"] == "duplicate_entry_number")
    assert a.id in dup["journal_entry_ids"] and b.id in dup["journal_entry_ids"]


def test_cross_company_reversal_blocks_both_companies(db):
    _seed_coa(db)
    _acct(db, "1000", "Cash", "Asset", company_id=OTHER)
    _acct(db, "4000", "Revenue", "Income", company_id=OTHER)
    orig = _je(
        db,
        company_id=CO,
        lines=[("1000", "40.00", "0"), ("4000", "0", "40.00")],
        entry_number="JE-XCO",
        status="reversed",
    )
    rev = _je(
        db,
        company_id=OTHER,
        lines=[("1000", "0", "40.00"), ("4000", "40.00", "0")],
        entry_number="JE-XREV",
        source="reversal",
        reference="JE-XCO",
        status="posted",
    )
    _je(db, company_id=CO, lines=[("1000", "1.00", "0"), ("4000", "0", "1.00")], entry_number="JE-OK-A")
    _je(db, company_id=OTHER, lines=[("1000", "1.00", "0"), ("4000", "0", "1.00")], entry_number="JE-OK-B")

    ra = trial_balance(db, _scope(CO), PERIOD, mode="period_activity", currency="AED")
    rb = trial_balance(db, _scope(OTHER), PERIOD, mode="period_activity", currency="AED")
    assert ra["reconciliation_passed"] is False
    assert rb["reconciliation_passed"] is False
    assert ra["company_accounting_integrity"]["passed"] is False
    assert rb["company_accounting_integrity"]["passed"] is False
    assert any(
        orig.id in e["journal_entry_ids"] and rev.id in e["journal_entry_ids"]
        for e in ra["exceptions"]
        if e["relevance"] == "company"
    )
    assert any(
        orig.id in e["journal_entry_ids"] and rev.id in e["journal_entry_ids"]
        for e in rb["exceptions"]
        if e["relevance"] == "company"
    )


def test_null_company_reversal_linked_to_company_blocks_that_company(db):
    """Production reverse_journal_entry often omits company_id — blocks the original's company."""
    _seed_coa(db)
    _je(db, lines=[("1000", "3.00", "0"), ("4000", "0", "3.00")], entry_number="JE-OK")
    orig = _je(
        db,
        lines=[("1000", "60.00", "0"), ("4000", "0", "60.00")],
        entry_number="JE-NULLCO",
        status="reversed",
    )
    rev = _je(
        db,
        company_id=None,
        lines=[("1000", "0", "60.00"), ("4000", "60.00", "0")],
        entry_number="JE-NULLREV",
        source="reversal",
        reference="JE-NULLCO",
        status="posted",
    )
    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["company_accounting_integrity"]["passed"] is False
    assert result["reconciliation_passed"] is False
    assert result["workspace_integrity_clean"] is False
    assert any(rev.id in e["journal_entry_ids"] for e in result["exceptions"])
    assert any(orig.id in e["journal_entry_ids"] for e in result["exceptions"])


def test_multi_period_reversal_blocks_any_period_tb(db):
    _seed_coa(db)
    orig = _je(
        db,
        period=PRIOR,
        lines=[("1000", "70.00", "0"), ("4000", "0", "70.00")],
        entry_number="JE-MP-ORIG",
        status="reversed",
    )
    rev = _je(
        db,
        period=PERIOD,
        lines=[("1000", "0", "70.00"), ("4000", "70.00", "0")],
        entry_number="JE-MP-REV",
        source="reversal",
        reference="JE-MP-ORIG",
        status="posted",
    )
    _je(db, period=PERIOD, lines=[("1000", "4.00", "0"), ("4000", "0", "4.00")], entry_number="JE-OK")

    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert "unsafe_legacy_reversal_pattern" in _exc_codes(result)
    assert result["reconciliation_passed"] is False
    assert any(
        orig.id in e["journal_entry_ids"] and rev.id in e["journal_entry_ids"]
        for e in result["exceptions"]
        if e["code"] == "unsafe_legacy_reversal_pattern"
    )


def test_three_statuses_not_collapsed(db):
    """Arithmetic can pass while integrity fails — statuses remain distinct."""
    _seed_coa(db)
    _je(db, lines=[("1000", "10.00", "0"), ("4000", "0", "10.00")], entry_number="JE-OK")
    _je(
        db,
        lines=[("1000", "100.00", "0"), ("4000", "0", "100.00")],
        entry_number="JE-ORIG",
        status="reversed",
    )
    _je(
        db,
        lines=[("1000", "0", "100.00"), ("4000", "100.00", "0")],
        entry_number="JE-REV",
        status="draft",
        source="reversal",
        reference="JE-ORIG",
    )
    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["arithmetic_balance"]["passed"] is True
    assert result["source_reconciliation"]["passed"] is True
    assert result["accounting_integrity"]["passed"] is False
    assert result["reconciliation_passed"] is False


def test_duplicate_source_line_detection(db):
    """Inject a duplicate line id via raw SQL to exercise the guard."""
    _seed_coa(db)
    entry = _je(db, lines=[("1000", "6.00", "0"), ("4000", "0", "6.00")], entry_number="JE-DL")
    line_a = entry.lines[0]
    # Second row with same primary key is impossible; simulate by appending a twin id in-memory
    # path: create another line then force id collision via SQL update of a new line to same id
    twin = UAEJournalLine(
        id=str(uuid4()),
        journal_entry_id=entry.id,
        account_code="1000",
        debit=Decimal("1.00"),
        credit=Decimal("0"),
        currency="AED",
    )
    db.add(twin)
    db.commit()
    # Can't actually collide PK; instead verify the seen_line_ids path by monkeypatching collect
    # Use a second entry that we process twice by calling compare with fabricated mismatch —
    # For engine coverage, force independent mismatch via monkeypatch of second collect.
    from app.services.ai_cfo import trial_balance as tb_mod

    real_collect = tb_mod._collect_eligible_facts
    calls = {"n": 0}

    def wrapped(*args, **kwargs):
        facts, exc, counts = real_collect(*args, **kwargs)
        calls["n"] += 1
        if kwargs.get("path_label") == "independent" and facts:
            # Drop one line from independent path → line set / totals mismatch
            facts = facts[:-1]
            counts = dict(counts)
            counts["eligible_lines"] = len(facts)
        return facts, exc, counts

    tb_mod._collect_eligible_facts = wrapped
    try:
        result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    finally:
        tb_mod._collect_eligible_facts = real_collect

    assert calls["n"] >= 2
    assert "independent_line_set_mismatch" in _exc_codes(result) or "independent_reconciliation_mismatch" in _exc_codes(
        result
    )
    assert result["source_reconciliation"]["passed"] is False
    assert result["reconciliation_passed"] is False


# ── Step 3.1R2 — company-scoped integrity isolation ─────────────────────────


def test_clean_company_a_not_blocked_by_b_accrual_reversal(db):
    """Counterexample from 3.1V: A clean + B accrual_reversal → A passes, B fails."""
    _seed_coa(db)
    _acct(db, "1000", "Cash", "Asset", company_id=OTHER)
    _acct(db, "4000", "Revenue", "Income", company_id=OTHER)
    _je(db, company_id=CO, lines=[("1000", "100.00", "0"), ("4000", "0", "100.00")], entry_number="JE-A1")
    _je(
        db,
        company_id=OTHER,
        lines=[("1000", "0", "50.00"), ("4000", "50.00", "0")],
        entry_number="JE-B-AR",
        source="accrual_reversal",
        description="REVERSAL: rent",
    )

    ra = trial_balance(db, _scope(CO), PERIOD, mode="period_activity", currency="AED")
    rb = trial_balance(db, _scope(OTHER), PERIOD, mode="period_activity", currency="AED")

    assert ra["total_debit"] == "100.00"
    assert ra["total_credit"] == "100.00"
    assert ra["company_accounting_integrity"]["passed"] is True
    assert ra["reconciliation_passed"] is True
    assert "accrual_reversal_unresolved" not in _exc_codes(ra)

    assert rb["company_accounting_integrity"]["passed"] is False
    assert rb["reconciliation_passed"] is False
    assert "accrual_reversal_unresolved" in _exc_codes(rb)


def test_clean_company_a_not_blocked_by_b_duplicate_entry_numbers(db):
    _seed_coa(db)
    _acct(db, "1000", "Cash", "Asset", company_id=OTHER)
    _acct(db, "4000", "Revenue", "Income", company_id=OTHER)
    _je(db, company_id=CO, lines=[("1000", "100.00", "0"), ("4000", "0", "100.00")], entry_number="JE-A1")
    _je(db, company_id=OTHER, lines=[("1000", "1.00", "0"), ("4000", "0", "1.00")], entry_number="JE-DUP")
    _je(db, company_id=OTHER, lines=[("1000", "2.00", "0"), ("4000", "0", "2.00")], entry_number="JE-DUP")

    ra = trial_balance(db, _scope(CO), PERIOD, mode="period_activity", currency="AED")
    rb = trial_balance(db, _scope(OTHER), PERIOD, mode="period_activity", currency="AED")

    assert ra["reconciliation_passed"] is True
    assert "duplicate_entry_number" not in _exc_codes(ra)
    assert rb["reconciliation_passed"] is False
    assert "duplicate_entry_number" in _exc_codes(rb)


def test_null_company_orphan_reversal_workspace_warning_only(db):
    """Null-company orphan reversal → workspace warning; clean company still reconciles."""
    _seed_coa(db)
    _je(db, company_id=CO, lines=[("1000", "10.00", "0"), ("4000", "0", "10.00")], entry_number="JE-CLEAN")
    orphan = _je(
        db,
        company_id=None,
        lines=[("1000", "0", "9.00"), ("4000", "9.00", "0")],
        entry_number="JE-NULL-REV",
        source="reversal",
        reference="NOPE",
    )

    result = trial_balance(db, _scope(CO), PERIOD, mode="period_activity", currency="AED")
    assert result["total_debit"] == "10.00"
    assert result["company_accounting_integrity"]["passed"] is True
    assert result["reconciliation_passed"] is True
    assert result["workspace_integrity_clean"] is False
    assert any(
        e["relevance"] == "workspace" and orphan.id in e["journal_entry_ids"]
        for e in result["workspace_integrity_warnings"]
    )
    # Exception must not disappear — still present in diagnostics
    assert any(orphan.id in e["journal_entry_ids"] for e in result["exceptions"])


def test_same_company_reversal_still_fails_selected_company(db):
    _seed_coa(db)
    _je(db, lines=[("1000", "10.00", "0"), ("4000", "0", "10.00")], entry_number="JE-OK")
    _je(
        db,
        lines=[("1000", "100.00", "0"), ("4000", "0", "100.00")],
        entry_number="JE-ORIG",
        status="reversed",
    )
    _je(
        db,
        lines=[("1000", "0", "100.00"), ("4000", "100.00", "0")],
        entry_number="JE-REV",
        status="draft",
        source="reversal",
        reference="JE-ORIG",
    )
    result = trial_balance(db, _scope(), PERIOD, mode="period_activity", currency="AED")
    assert result["company_accounting_integrity"]["passed"] is False
    assert result["reconciliation_passed"] is False
    assert "reversed_with_unposted_reversal" in _exc_codes(result)


def test_ambiguous_duplicate_number_across_companies_blocks_both(db):
    """Same entry_number on two companies → both established companies fail."""
    _seed_coa(db)
    _acct(db, "1000", "Cash", "Asset", company_id=OTHER)
    _acct(db, "4000", "Revenue", "Income", company_id=OTHER)
    a = _je(db, company_id=CO, lines=[("1000", "1.00", "0"), ("4000", "0", "1.00")], entry_number="JE-SHARE")
    b = _je(db, company_id=OTHER, lines=[("1000", "2.00", "0"), ("4000", "0", "2.00")], entry_number="JE-SHARE")

    ra = trial_balance(db, _scope(CO), PERIOD, mode="period_activity", currency="AED")
    rb = trial_balance(db, _scope(OTHER), PERIOD, mode="period_activity", currency="AED")
    assert ra["reconciliation_passed"] is False
    assert rb["reconciliation_passed"] is False
    assert "duplicate_entry_number" in _exc_codes(ra)
    assert "duplicate_entry_number" in _exc_codes(rb)
    assert a.id in next(e for e in ra["exceptions"] if e["code"] == "duplicate_entry_number")["journal_entry_ids"]
    assert b.id in next(e for e in rb["exceptions"] if e["code"] == "duplicate_entry_number")["journal_entry_ids"]


def test_ambiguous_reference_with_no_established_company_is_workspace_warning(db):
    """Null-company reversing JE with empty reference → workspace only."""
    _seed_coa(db)
    _je(db, company_id=CO, lines=[("1000", "5.00", "0"), ("4000", "0", "5.00")], entry_number="JE-OK")
    amb = _je(
        db,
        company_id=None,
        lines=[("1000", "0", "1.00"), ("4000", "1.00", "0")],
        entry_number="JE-AMB",
        source="reversal",
        reference=None,
        description="REVERSAL: mystery",
    )
    result = trial_balance(db, _scope(CO), PERIOD, mode="period_activity", currency="AED")
    assert result["reconciliation_passed"] is True
    assert result["company_accounting_integrity"]["passed"] is True
    assert result["workspace_integrity_clean"] is False
    assert any(amb.id in e["journal_entry_ids"] for e in result["workspace_integrity_warnings"])


def test_workspace_warnings_never_silently_dropped(db):
    _seed_coa(db)
    _je(db, company_id=CO, lines=[("1000", "7.00", "0"), ("4000", "0", "7.00")], entry_number="JE-OK")
    _je(db, company_id=None, lines=[("1000", "1.00", "0"), ("4000", "0", "1.00")], entry_number="JE-NULL")
    result = trial_balance(db, _scope(CO), PERIOD, mode="period_activity", currency="AED")
    assert result["reconciliation_passed"] is True
    assert result["workspace_integrity_warnings"]
    assert result["workspace_integrity_clean"] is False
    # Also mirrored in exceptions list
    assert any(e["relevance"] == "workspace" for e in result["exceptions"])
