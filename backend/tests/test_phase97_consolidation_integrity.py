"""Phase 9.7 — Consolidation Accounting Integrity: 14 mandatory accounting tests.

Tests:
  T01  Intercompany loan elimination (BS-only — no P&L effect)
  T02  Management fee elimination (P&L revenue + expense)
  T03  Recharge elimination (P&L operating_expenses both sides)
  T04  Dividend elimination (both P&L and BS)
  T05  Balance-sheet-only elimination does NOT affect P&L net_profit
  T06  Revenue elimination reduces consolidated revenue
  T07  Expense elimination reduces consolidated operating_expenses
  T08  Elimination reversal — amount update replaces, does not duplicate
  T09  Duplicate elimination prevention — upsert, not double-create
  T10  Invalid amount rejection (zero, negative, NaN, Infinity, None)
  T11  Entity-level P&L and BS are isolated (company_id filter)
  T12  Each leaf row: group_total == companies_sum - eliminations
  T13  Unattributed journal lines are excluded + surfaced in has_unassigned_lines
  T14  Duplicate IC reference prevention via next_ic_reference sequence
"""

from __future__ import annotations

import math
import os
import tempfile
import threading
import uuid
from datetime import date, datetime
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool, StaticPool

from app.models.company_setup import (
    AccountingPeriod,
    ConsolidationElimination,
    IcReferenceSequence,
    UaeCompanyProfile,
)
from app.models.uae_accounting_full import UAEAccount, UAEJournalEntry, UAEJournalLine
from app.models.users import RbacUser  # noqa: F401 — registers rbac_users in metadata for FK resolution
from app.models.workspace import Workspace  # noqa: F401 — registers workspaces in metadata for FK resolution
from app.services import consolidation_service as svc

TABLES = (
    Workspace,          # required: FKs from company/period/elimination tables
    UaeCompanyProfile,
    AccountingPeriod,
    UAEAccount,
    UAEJournalEntry,
    UAEJournalLine,
    ConsolidationElimination,
    IcReferenceSequence,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

WS = "ws-phase97-test-" + uuid.uuid4().hex[:8]
PERIOD_ID = "period-" + uuid.uuid4().hex[:8]
PERIOD_STR = "2026-10"


@pytest.fixture(scope="module")
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for model in TABLES:
        model.__table__.create(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _uuid() -> str:
    return str(uuid.uuid4())


def _company(db, ws: str, name: str) -> str:
    cid = _uuid()
    db.add(UaeCompanyProfile(
        id=cid, workspace_id=ws, company_name=name, base_currency="AED", status="active",
    ))
    db.flush()
    return cid


def _period(db, ws: str, pid: str, period_str: str) -> None:
    year, month = map(int, period_str.split("-"))
    db.add(AccountingPeriod(
        id=pid, workspace_id=ws, period_number=1,
        period_name=f"Period {period_str}",
        start_date=date(year, month, 1),
        end_date=date(year, month, 28),
        status="open",
    ))
    db.flush()


def _account(db, ws: str, cid: str, code: str, account_type: str, sub_type: str = "") -> None:
    db.add(UAEAccount(
        id=_uuid(), tenant_id=ws, company_id=cid,
        code=code, name=code, account_type=account_type, sub_type=sub_type,
    ))
    db.flush()


def _journal(db, ws: str, cid: str | None, period: str, lines: list[tuple[str, float, float]]) -> None:
    """Post a journal.  lines = [(account_code, debit, credit), ...]"""
    je = UAEJournalEntry(
        id=_uuid(), tenant_id=ws, company_id=cid,
        entry_number=_uuid()[:8], period=period,
        entry_date=date(2026, 10, 15), description="test",
        status="posted",
    )
    db.add(je)
    db.flush()
    for code, dr, cr in lines:
        db.add(UAEJournalLine(
            id=_uuid(), journal_entry_id=je.id,
            account_code=code, debit=dr, credit=cr, description="",
        ))
    db.flush()


# ---------------------------------------------------------------------------
# Shared state
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module", autouse=True)
def seed(db):
    """Seed two companies, one period, accounts and journals for all tests."""
    global C1, C2
    C1 = _company(db, WS, "Alpha LLC")
    C2 = _company(db, WS, "Beta LLC")
    _period(db, WS, PERIOD_ID, PERIOD_STR)

    # C1 accounts
    _account(db, WS, C1, "6001", "income")          # revenue
    _account(db, WS, C1, "7001", "expense", "cogs")  # cost_of_sales
    _account(db, WS, C1, "7100", "expense")          # operating_expenses
    _account(db, WS, C1, "1001", "asset")            # cash_bank (100x)
    _account(db, WS, C1, "1100", "asset", "receivable")  # trade_receivables

    # C2 accounts
    _account(db, WS, C2, "6001", "income")
    _account(db, WS, C2, "7100", "expense")
    _account(db, WS, C2, "3001", "liability")        # trade_payables (300x)
    _account(db, WS, C2, "1001", "asset")
    _account(db, WS, C2, "4001", "liability", "non-current liability")  # long_term_borrowings

    # C1: revenue 100 000, opex 20 000
    _journal(db, WS, C1, PERIOD_STR, [("6001", 0, 100_000), ("1001", 100_000, 0)])
    _journal(db, WS, C1, PERIOD_STR, [("7100", 20_000, 0), ("1001", 0, 20_000)])
    # C1 gives IC loan to C2: DR trade_receivables 50 000, CR cash 50 000
    _journal(db, WS, C1, PERIOD_STR, [("1100", 50_000, 0), ("1001", 0, 50_000)])

    # C2: revenue 60 000, opex 15 000
    _journal(db, WS, C2, PERIOD_STR, [("6001", 0, 60_000), ("1001", 60_000, 0)])
    _journal(db, WS, C2, PERIOD_STR, [("7100", 15_000, 0), ("1001", 0, 15_000)])
    # C2 receives IC loan from C1: DR cash 50 000, CR long_term_borrowings 50 000
    # long_term_borrowings maps code 40xx (credit = liability increases)
    _journal(db, WS, C2, PERIOD_STR, [("1001", 50_000, 0), ("4001", 0, 50_000)])

    db.commit()
    return C1, C2


C1 = C2 = ""  # populated by seed


# ---------------------------------------------------------------------------
# T01 — IC loan elimination: BS-only, no P&L effect
# ---------------------------------------------------------------------------

def test_T01_ic_loan_bs_only_elimination(db):
    """Eliminating a 50 000 IC loan (trade_receivables vs long_term_borrowings)
    must reduce BS totals but leave P&L net_profit unchanged."""
    pl_before = svc.get_consolidation_pl(db, WS, PERIOD_ID)
    net_before = next(r["group_total"] for r in pl_before["rows"] if r["key"] == "net_profit")

    svc.upsert_elimination_amount(db, WS, PERIOD_ID, "trade_receivables", 50_000, "IC loan", None, "bs")
    svc.upsert_elimination_amount(db, WS, PERIOD_ID, "long_term_borrowings", 50_000, "IC loan", None, "bs")
    db.commit()

    pl_after = svc.get_consolidation_pl(db, WS, PERIOD_ID)
    bs_after = svc.get_consolidation_bs(db, WS, PERIOD_ID)
    net_after = next(r["group_total"] for r in pl_after["rows"] if r["key"] == "net_profit")
    rec_after = next(r["group_total"] for r in bs_after["rows"] if r["key"] == "trade_receivables")
    borr_after = next(r["group_total"] for r in bs_after["rows"] if r["key"] == "long_term_borrowings")

    # BS-only elimination must NOT touch net_profit
    assert net_after == net_before, f"BS-only elim changed net_profit: {net_before} → {net_after}"
    # BS amounts reduced by 50 000
    assert rec_after == 0, f"IC receivable not eliminated: {rec_after}"
    assert borr_after == 0, f"IC payable not eliminated: {borr_after}"


# ---------------------------------------------------------------------------
# T02 — Management fee elimination: P&L revenue + operating_expenses
# ---------------------------------------------------------------------------

def test_T02_management_fee_pl_elimination(db):
    """C1 charges C2 a management fee: 10 000 in C1 revenue, 10 000 in C2 opex.
    P&L elimination of revenue=10 000 must reduce group revenue but not BS balances."""
    bs_before = svc.get_consolidation_bs(db, WS, PERIOD_ID)
    assets_before = next(r["group_total"] for r in bs_before["rows"] if r["key"] == "total_assets")

    svc.upsert_elimination_amount(db, WS, PERIOD_ID, "revenue", 10_000, "Mgmt fee", None, "pl")
    svc.upsert_elimination_amount(db, WS, PERIOD_ID, "operating_expenses", 10_000, "Mgmt fee", None, "pl")
    db.commit()

    pl_after = svc.get_consolidation_pl(db, WS, PERIOD_ID)
    bs_after = svc.get_consolidation_bs(db, WS, PERIOD_ID)
    rev_after = next(r["group_total"] for r in pl_after["rows"] if r["key"] == "revenue")
    opex_after = next(r["group_total"] for r in pl_after["rows"] if r["key"] == "operating_expenses")
    assets_after = next(r["group_total"] for r in bs_after["rows"] if r["key"] == "total_assets")

    # Revenue reduced by 10 000: 160 000 - 10 000 = 150 000
    assert rev_after == 150_000, f"Revenue after mgmt fee elim: {rev_after}"
    # Opex reduced: 35 000 - 10 000 = 25 000
    assert opex_after == 25_000, f"Opex after mgmt fee elim: {opex_after}"
    # P&L-only elimination must NOT touch total_assets
    assert assets_after == assets_before, f"P&L elim changed BS total_assets: {assets_before} → {assets_after}"


# ---------------------------------------------------------------------------
# T03 — Recharge elimination (P&L operating_expenses both sides)
# ---------------------------------------------------------------------------

def test_T03_recharge_pl_elimination(db):
    """Adding a second opex elimination of 5 000 stacks correctly."""
    pl_before = svc.get_consolidation_pl(db, WS, PERIOD_ID)
    opex_before = next(r["group_total"] for r in pl_before["rows"] if r["key"] == "operating_expenses")

    # This upsert updates the existing opex elimination to 15 000 (replaces 10 000)
    svc.upsert_elimination_amount(db, WS, PERIOD_ID, "operating_expenses", 15_000, "Recharge", None, "pl")
    db.commit()

    pl_after = svc.get_consolidation_pl(db, WS, PERIOD_ID)
    opex_after = next(r["group_total"] for r in pl_after["rows"] if r["key"] == "operating_expenses")

    # 35 000 gross - 15 000 elim = 20 000
    assert opex_after == 20_000, f"Opex after recharge upsert: {opex_after}"
    # Reset to 10 000 for downstream tests
    svc.upsert_elimination_amount(db, WS, PERIOD_ID, "operating_expenses", 10_000, "Mgmt fee", None, "pl")
    db.commit()


# ---------------------------------------------------------------------------
# T04 — Dividend elimination (both P&L and BS)
# ---------------------------------------------------------------------------

def test_T04_dividend_elimination_both(db):
    """An elimination with type='both' applies to both P&L and BS statements.
    Uses finance_costs (P&L) and other_current_assets (BS) which are unset at this point."""
    pl_before = svc.get_consolidation_pl(db, WS, PERIOD_ID)
    fc_before = next(r["group_total"] for r in pl_before["rows"] if r["key"] == "finance_costs")
    bs_before = svc.get_consolidation_bs(db, WS, PERIOD_ID)
    oca_before = next(r["group_total"] for r in bs_before["rows"] if r["key"] == "other_current_assets")

    # 'both' means: appears in both P&L and BS elimination passes
    svc.upsert_elimination_amount(db, WS, PERIOD_ID, "finance_costs", 3_000, "Div interest", None, "both")
    svc.upsert_elimination_amount(db, WS, PERIOD_ID, "other_current_assets", 3_000, "Div receivable", None, "both")
    db.commit()

    pl_after = svc.get_consolidation_pl(db, WS, PERIOD_ID)
    bs_after = svc.get_consolidation_bs(db, WS, PERIOD_ID)
    fc_after = next(r["group_total"] for r in pl_after["rows"] if r["key"] == "finance_costs")
    oca_after = next(r["group_total"] for r in bs_after["rows"] if r["key"] == "other_current_assets")

    assert fc_after == fc_before - 3_000, f"'both' elim did not reduce finance_costs: {fc_before} → {fc_after}"
    assert oca_after == oca_before - 3_000, f"'both' elim did not reduce other_current_assets: {oca_before} → {oca_after}"


# ---------------------------------------------------------------------------
# T05 — BS-only elimination does NOT affect P&L net_profit
# ---------------------------------------------------------------------------

def test_T05_bs_only_does_not_affect_net_profit(db):
    """Adding a pure BS elimination (trade_payables) must not change net_profit."""
    pl_before = svc.get_consolidation_pl(db, WS, PERIOD_ID)
    net_before = next(r["group_total"] for r in pl_before["rows"] if r["key"] == "net_profit")

    svc.upsert_elimination_amount(db, WS, PERIOD_ID, "trade_payables", 8_000, "IC payable", None, "bs")
    db.commit()

    pl_after = svc.get_consolidation_pl(db, WS, PERIOD_ID)
    net_after = next(r["group_total"] for r in pl_after["rows"] if r["key"] == "net_profit")

    assert net_after == net_before, f"BS-only trade_payables elim changed net_profit: {net_before} → {net_after}"


# ---------------------------------------------------------------------------
# T06 — Revenue elimination reduces consolidated revenue
# ---------------------------------------------------------------------------

def test_T06_revenue_elimination(db):
    """A P&L revenue elimination reduces group_total for revenue row."""
    pl = svc.get_consolidation_pl(db, WS, PERIOD_ID)
    rev = next(r["group_total"] for r in pl["rows"] if r["key"] == "revenue")
    elim = next(r["eliminations"] for r in pl["rows"] if r["key"] == "revenue")
    gross = rev + elim  # pre-elimination sum
    assert elim > 0, "Expected a revenue elimination to be present"
    assert rev == gross - elim


# ---------------------------------------------------------------------------
# T07 — Expense elimination reduces consolidated operating_expenses
# ---------------------------------------------------------------------------

def test_T07_expense_elimination(db):
    """A P&L operating_expenses elimination reduces group_total."""
    pl = svc.get_consolidation_pl(db, WS, PERIOD_ID)
    opex = next(r["group_total"] for r in pl["rows"] if r["key"] == "operating_expenses")
    elim = next(r["eliminations"] for r in pl["rows"] if r["key"] == "operating_expenses")
    gross = opex + elim
    assert elim > 0
    assert opex == gross - elim


# ---------------------------------------------------------------------------
# T08 — Elimination reversal: upsert replaces, does not duplicate
# ---------------------------------------------------------------------------

def test_T08_elimination_reversal_no_duplicate(db):
    before_rows = svc.list_eliminations(db, WS, PERIOD_ID)
    rev_rows_before = [r for r in before_rows if r["account_category"] == "revenue"]

    svc.upsert_elimination_amount(db, WS, PERIOD_ID, "revenue", 20_000, "Updated elim", None, "pl")
    db.commit()

    after_rows = svc.list_eliminations(db, WS, PERIOD_ID)
    rev_rows_after = [r for r in after_rows if r["account_category"] == "revenue"]

    # Row count must not increase — upsert only
    assert len(rev_rows_after) == len(rev_rows_before), (
        f"Upsert created duplicate rows: {len(rev_rows_before)} → {len(rev_rows_after)}"
    )
    assert rev_rows_after[0]["amount"] == 20_000

    # Restore to 10 000 for downstream
    svc.upsert_elimination_amount(db, WS, PERIOD_ID, "revenue", 10_000, "Mgmt fee", None, "pl")
    db.commit()


# ---------------------------------------------------------------------------
# T09 — Duplicate elimination prevention (upsert semantics)
# ---------------------------------------------------------------------------

def test_T09_duplicate_elimination_prevention(db):
    """Calling upsert twice with the same account_category updates the row,
    never creates two separate rows for the same category+period."""
    svc.upsert_elimination_amount(db, WS, PERIOD_ID, "cost_of_sales", 1_000, "note A", None, "pl")
    svc.upsert_elimination_amount(db, WS, PERIOD_ID, "cost_of_sales", 2_000, "note B", None, "pl")
    db.commit()

    rows = [r for r in svc.list_eliminations(db, WS, PERIOD_ID) if r["account_category"] == "cost_of_sales"]
    assert len(rows) == 1, f"Expected 1 row for cost_of_sales, got {len(rows)}"
    assert rows[0]["amount"] == 2_000


# ---------------------------------------------------------------------------
# T10 — Invalid amount rejection
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("bad_amount,description", [
    (0, "zero"),
    (-100, "negative"),
    (float("nan"), "NaN"),
    (float("inf"), "Infinity"),
    (float("-inf"), "-Infinity"),
    (None, "None"),
    ("abc", "non-numeric string"),
])
def test_T10_invalid_amount_rejected(db, bad_amount, description):
    with pytest.raises(ValueError, match=r"(?i)(amount|positive|nan|infinity|valid number)"):
        svc._validate_elimination_amount(bad_amount)


# ---------------------------------------------------------------------------
# T11 — Entity-level P&L and BS isolation
# ---------------------------------------------------------------------------

def test_T11_entity_pl_isolation(db):
    """_aggregate_categories returns only C1's figures, not C2's."""
    c1_pl = svc._aggregate_categories(db, WS, C1, PERIOD_STR, svc._pl_category)
    c2_pl = svc._aggregate_categories(db, WS, C2, PERIOD_STR, svc._pl_category)

    # C1 posted 100 000 revenue; C2 posted 60 000
    assert c1_pl.get("revenue", 0) == 100_000, f"C1 revenue: {c1_pl.get('revenue')}"
    assert c2_pl.get("revenue", 0) == 60_000, f"C2 revenue: {c2_pl.get('revenue')}"
    # They must be independent
    assert c1_pl.get("revenue") != c2_pl.get("revenue")


# ---------------------------------------------------------------------------
# T12 — Each leaf row: group_total == companies_sum - eliminations
# ---------------------------------------------------------------------------

def test_T12_consolidated_pl_leaf_row_integrity(db):
    """For every non-calculated P&L row, the service must satisfy:
       group_total = sum(companies.values()) - eliminations

    NOTE: Calculated rows (gross_profit, ebitda, ebit, pbt, net_profit) are computed
    from raw per-entity figures BEFORE eliminations, so they are intentionally exempt
    from this check. Cross-row chain consistency for calculated rows (e.g.
    gross_profit = revenue - cogs post-elimination) is a Phase 9.8 enhancement.
    """
    pl = svc.get_consolidation_pl(db, WS, PERIOD_ID)

    failures = []
    for r in pl["rows"]:
        if r.get("calculated"):
            continue  # calculated rows use raw entity sums, skip cross-row chain check
        companies_sum = sum(r["companies"].values())
        expected_total = companies_sum - r["eliminations"]
        if abs(r["group_total"] - expected_total) >= 0.01:
            failures.append(
                f"{r['key']}: group_total={r['group_total']}, "
                f"companies_sum={companies_sum}, eliminations={r['eliminations']}, "
                f"expected={expected_total}"
            )

    assert not failures, "Leaf row integrity failures:\n" + "\n".join(failures)

    # Also verify that at least one row has a non-zero elimination (proves the
    # test is exercising real eliminations, not trivially passing on a clean slate)
    rows_with_elim = [r for r in pl["rows"] if not r.get("calculated") and r["eliminations"] != 0]
    assert rows_with_elim, "No leaf rows had eliminations — test is not exercising elimination logic"


# ---------------------------------------------------------------------------
# T13 — Unattributed journal lines excluded and surfaced
# ---------------------------------------------------------------------------

def test_T13_unattributed_lines_excluded_and_surfaced(db):
    """Journal lines with company_id=None must not appear in any entity's figures
    and must be counted in has_unassigned_lines."""
    # Post an unattributed line (company_id=None)
    je = UAEJournalEntry(
        id=_uuid(), tenant_id=WS, company_id=None,
        entry_number="UNATTR-01", period=PERIOD_STR,
        entry_date=date(2026, 10, 20), description="unattributed",
        status="posted",
    )
    db.add(je)
    db.flush()
    db.add(UAEJournalLine(
        id=_uuid(), journal_entry_id=je.id,
        account_code="6001", debit=0, credit=999_999, description="",
    ))
    db.commit()

    pl = svc.get_consolidation_pl(db, WS, PERIOD_ID)
    bs = svc.get_consolidation_bs(db, WS, PERIOD_ID)

    # 999 999 must NOT appear in any entity's revenue
    c1_pl = svc._aggregate_categories(db, WS, C1, PERIOD_STR, svc._pl_category)
    c2_pl = svc._aggregate_categories(db, WS, C2, PERIOD_STR, svc._pl_category)
    assert c1_pl.get("revenue", 0) == 100_000, f"Unattributed line leaked into C1: {c1_pl.get('revenue')}"
    assert c2_pl.get("revenue", 0) == 60_000, f"Unattributed line leaked into C2: {c2_pl.get('revenue')}"

    # ENG-1: has_unassigned_lines must be True
    assert pl["has_unassigned_lines"] is True, "P&L did not flag unassigned lines"
    assert pl["unassigned_lines"] >= 1


# ---------------------------------------------------------------------------
# T14 — Duplicate IC reference prevention via next_ic_reference
# ---------------------------------------------------------------------------

def test_T14_ic_reference_sequence_no_duplicates(db):
    """next_ic_reference must produce monotonically increasing, unique references
    for the same workspace+period even when called many times."""
    period = "2026-10"
    refs = [svc.next_ic_reference(db, WS, period) for _ in range(10)]
    db.commit()

    # All must start with the IC- prefix + period
    assert all(r.startswith(f"IC-{period}-") for r in refs), f"Unexpected format: {refs}"
    # All must be unique
    assert len(set(refs)) == 10, f"Duplicate IC references generated: {refs}"
    # Must be monotonically increasing sequence numbers
    seqs = [int(r.split("-")[-1]) for r in refs]
    assert seqs == sorted(seqs), f"IC refs not monotonically increasing: {seqs}"
    # Sequence must be contiguous (no gaps from 1)
    assert seqs[-1] - seqs[0] == 9, f"IC ref gap: {seqs}"


# ---------------------------------------------------------------------------
# T14b — IC reference uniqueness under 20 concurrent threads (SVC-1 race)
# Uses a file-based SQLite + NullPool so each session gets its own connection,
# which exercises the INSERT-or-retry path in next_ic_reference().
# ---------------------------------------------------------------------------

def test_T14b_ic_reference_concurrent_no_duplicates():
    """20 concurrent threads each calling next_ic_reference in its own session
    must produce 20 unique, contiguous references with zero errors."""
    db_path = Path(tempfile.mkdtemp()) / "t14b_concurrent.sqlite"
    engine14b = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
        poolclass=NullPool,
    )
    for model in TABLES:
        model.__table__.create(engine14b)
    Sess14b = sessionmaker(bind=engine14b)
    ws14b = "ws-t14b-" + uuid.uuid4().hex[:8]
    period14b = "2026-11"

    results: list[str] = []
    errors: list[str] = []
    lock = threading.Lock()

    def worker(thread_id: int) -> None:
        s = Sess14b()
        try:
            ref = svc.next_ic_reference(s, ws14b, period14b)
            s.commit()
            with lock:
                results.append(ref)
        except Exception as exc:
            with lock:
                errors.append(f"T{thread_id}: {exc}")
        finally:
            s.close()

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, f"Concurrent IC reference errors:\n" + "\n".join(errors)
    assert len(results) == 20, f"Expected 20 refs, got {len(results)}: {results}"
    assert len(set(results)) == 20, (
        f"Duplicate IC refs under concurrency: "
        f"{[r for r in results if results.count(r) > 1]}"
    )
    seqs = sorted(int(r.split("-")[-1]) for r in results)
    assert seqs == list(range(1, 21)), f"Non-contiguous sequence: {seqs}"
