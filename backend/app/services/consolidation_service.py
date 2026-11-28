"""Group consolidation — aggregate P&L and Balance Sheet across UAE companies.

Phase 9.7 accounting integrity:
  ADJ-1: eliminations are routed by elimination_type ('pl' | 'bs' | 'both').
         BS-only eliminations never alter revenue, expenses or net income.
         P&L eliminations never alter asset/liability balances.
  ENG-1: journal lines with no company_id are excluded from every company's
         figures AND reported as unassigned_lines so they surface in reporting.
"""

from __future__ import annotations

import math
import threading
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import exc as sa_exc
from sqlalchemy.orm import Session

from app.models.company_setup import (
    AccountingPeriod,
    ConsolidationElimination,
    IcReferenceSequence,
    UaeCompanyProfile,
)
from app.models.uae_accounting_full import UAEAccount, UAEJournalEntry, UAEJournalLine

# Valid elimination_type values (ADJ-1)
ELIM_TYPE_PL = "pl"
ELIM_TYPE_BS = "bs"
ELIM_TYPE_BOTH = "both"
VALID_ELIM_TYPES = {ELIM_TYPE_PL, ELIM_TYPE_BS, ELIM_TYPE_BOTH}

# CoA keys that belong to the P&L statement
PL_KEYS = {"revenue", "cost_of_sales", "gross_profit", "operating_expenses",
           "ebitda", "depreciation", "ebit", "finance_costs", "pbt", "tax", "net_profit"}

# CoA keys that belong to the Balance Sheet
BS_KEYS = {"fixed_assets_net", "inventory", "trade_receivables", "cash_bank",
           "other_current_assets", "total_assets", "long_term_borrowings",
           "trade_payables", "other_current_liabilities", "share_capital",
           "retained_earnings", "total_liabilities_equity"}

PL_ROWS = [
    {"key": "revenue", "label": "Revenue", "calculated": False},
    {"key": "cost_of_sales", "label": "Cost of Sales", "calculated": False},
    {"key": "gross_profit", "label": "Gross Profit", "calculated": True},
    {"key": "operating_expenses", "label": "Operating Expenses", "calculated": False},
    {"key": "ebitda", "label": "EBITDA", "calculated": True},
    {"key": "depreciation", "label": "Depreciation & Amortisation", "calculated": False},
    {"key": "ebit", "label": "EBIT", "calculated": True},
    {"key": "finance_costs", "label": "Finance Costs", "calculated": False},
    {"key": "pbt", "label": "Profit Before Tax", "calculated": True},
    {"key": "tax", "label": "Tax", "calculated": False},
    {"key": "net_profit", "label": "Net Profit", "calculated": True},
]

BS_ROWS = [
    {"key": "fixed_assets_net", "label": "Fixed Assets (Net)", "section": "assets"},
    {"key": "inventory", "label": "Inventory", "section": "assets"},
    {"key": "trade_receivables", "label": "Trade Receivables", "section": "assets"},
    {"key": "cash_bank", "label": "Cash & Bank", "section": "assets"},
    {"key": "other_current_assets", "label": "Other Current Assets", "section": "assets"},
    {"key": "total_assets", "label": "TOTAL ASSETS", "section": "assets", "calculated": True, "bold": True},
    {"key": "long_term_borrowings", "label": "Long-term Borrowings", "section": "liabilities"},
    {"key": "trade_payables", "label": "Trade Payables", "section": "liabilities"},
    {"key": "other_current_liabilities", "label": "Other Current Liabilities", "section": "liabilities"},
    {"key": "share_capital", "label": "Share Capital", "section": "equity"},
    {"key": "retained_earnings", "label": "Retained Earnings", "section": "equity"},
    {"key": "total_liabilities_equity", "label": "TOTAL LIABILITIES & EQUITY", "section": "total", "calculated": True, "bold": True},
]

SUMMARY_CARDS = [
    {"key": "revenue", "label": "Total Group Revenue"},
    {"key": "gross_profit", "label": "Total Group Gross Profit"},
    {"key": "ebitda", "label": "Total Group EBITDA"},
    {"key": "total_assets", "label": "Total Group Assets"},
    {"key": "cash_bank", "label": "Total Group Cash"},
]


def _pl_category(code: str, account_type: str | None, sub_type: str | None) -> str | None:
    code = (code or "").strip()
    at = (account_type or "").lower()
    st = (sub_type or "").lower()
    if at == "income" or code.startswith("6"):
        return "revenue"
    if st == "cogs" or code in ("7001", "7002") or (code.startswith("700") and int(code[:4]) <= 7002 if code.isdigit() else False):
        return "cost_of_sales"
    if "depreciation" in st or code in ("7111", "7112"):
        return "depreciation"
    if code in ("7160", "7170") or "finance" in st:
        return "finance_costs"
    if code == "7200" or st == "tax":
        return "tax"
    if at == "expense" or code.startswith("7"):
        return "operating_expenses"
    return None


def _bs_category(code: str, account_type: str | None, sub_type: str | None) -> str | None:
    code = (code or "").strip()
    at = (account_type or "").lower()
    st = (sub_type or "").lower()
    if st == "fixed asset" or code.startswith("20"):
        return "fixed_assets_net"
    if code == "1200" or st == "current asset" and "inventor" in (code + st):
        return "inventory"
    if code.startswith("110") or "receivable" in st:
        return "trade_receivables"
    if code.startswith("100") and code not in ("1000",):
        return "cash_bank"
    if at == "asset" and st == "current asset":
        return "other_current_assets"
    if code.startswith("40") or "non-current liability" in st or "long" in st:
        return "long_term_borrowings"
    if code.startswith("300") or code.startswith("31") or (st == "current liability" and "payable" in st):
        return "trade_payables"
    if at == "liability":
        return "other_current_liabilities"
    if code == "5001":
        return "share_capital"
    if code in ("5010", "5020") or at == "equity":
        return "retained_earnings"
    return None


def _signed_pl_amount(debit: float, credit: float, category: str) -> float:
    if category in ("revenue",):
        return credit - debit
    return debit - credit


def _signed_bs_amount(debit: float, credit: float, category: str) -> float:
    if category in ("share_capital", "retained_earnings", "long_term_borrowings", "trade_payables", "other_current_liabilities"):
        return credit - debit
    return debit - credit


def list_active_companies(db: Session, workspace_id: str) -> list[dict[str, Any]]:
    rows = (
        db.query(UaeCompanyProfile)
        .filter_by(workspace_id=workspace_id, status="active")
        .order_by(UaeCompanyProfile.company_name)
        .all()
    )
    return [
        {
            "id": r.id,
            "company_name": r.company_name,
            "trade_name": r.trade_name,
            "legal_type": r.legal_type,
            "logo_url": r.logo_url,
            "base_currency": r.base_currency,
        }
        for r in rows
    ]


def list_periods(db: Session, workspace_id: str) -> list[dict[str, Any]]:
    rows = (
        db.query(AccountingPeriod)
        .filter_by(workspace_id=workspace_id)
        .filter(AccountingPeriod.status.in_(["open", "closed"]))
        .order_by(AccountingPeriod.start_date)
        .all()
    )
    return [
        {
            "id": p.id,
            "period_name": p.period_name,
            "period_number": p.period_number,
            "start_date": p.start_date.isoformat(),
            "end_date": p.end_date.isoformat(),
            "status": p.status,
        }
        for p in rows
    ]


def _period_str(db: Session, period_id: str) -> tuple[str, AccountingPeriod]:
    p = db.query(AccountingPeriod).filter_by(id=period_id).first()
    if not p:
        raise ValueError("Period not found")
    return p.end_date.strftime("%Y-%m"), p


def _aggregate_categories(
    db: Session,
    workspace_id: str,
    company_id: str,
    period: str,
    mapper,
) -> dict[str, float]:
    """P&L: movements in the period. Balance sheet: balances to period end, with profit to date in
    retained earnings. Only the company's own journals count; company-less journals are reported
    separately (see unassigned_journal_lines) instead of being added to every company."""
    account_meta: dict[str, tuple[str | None, str | None]] = {
        a.code: (a.account_type, a.sub_type)
        for a in db.query(UAEAccount).filter(
            UAEAccount.tenant_id == workspace_id,
            (UAEAccount.company_id == company_id) | (UAEAccount.company_id.is_(None)),
        ).all()
    }
    is_pl = mapper is _pl_category
    rows = (
        db.query(UAEJournalLine, UAEJournalEntry)
        .join(UAEJournalEntry, UAEJournalLine.journal_entry_id == UAEJournalEntry.id)
        .filter(
            UAEJournalEntry.tenant_id == workspace_id,
            (UAEJournalEntry.period == period) if is_pl else (UAEJournalEntry.period <= period),
            UAEJournalEntry.status == "posted",
            UAEJournalEntry.company_id == company_id,
        )
        .all()
    )
    totals: dict[str, float] = {}
    for line, _je in rows:
        code = line.account_code or ""
        meta = account_meta.get(code, (None, None))
        dr = float(line.debit or 0)
        cr = float(line.credit or 0)
        if not is_pl and _pl_category(code, meta[0], meta[1]):
            totals["retained_earnings"] = totals.get("retained_earnings", 0.0) + cr - dr
            continue
        cat = mapper(code, meta[0], meta[1])
        if not cat:
            continue
        amt = _signed_pl_amount(dr, cr, cat) if is_pl else _signed_bs_amount(dr, cr, cat)
        totals[cat] = totals.get(cat, 0.0) + amt
    return totals


def unassigned_journal_lines(db: Session, workspace_id: str, period: str) -> int:
    """Posted lines in the period with no company: excluded from every company's figures."""
    return (
        db.query(UAEJournalLine.id)
        .join(UAEJournalEntry, UAEJournalLine.journal_entry_id == UAEJournalEntry.id)
        .filter(
            UAEJournalEntry.tenant_id == workspace_id,
            UAEJournalEntry.period == period,
            UAEJournalEntry.status == "posted",
            UAEJournalEntry.company_id.is_(None),
        )
        .count()
    )


def _calc_pl_row(key: str, company_totals: dict[str, dict[str, float]]) -> dict[str, float]:
    merged: dict[str, float] = {}
    for cid, cats in company_totals.items():
        c = cats.copy()
        c["gross_profit"] = c.get("revenue", 0) - c.get("cost_of_sales", 0)
        c["ebitda"] = c["gross_profit"] - c.get("operating_expenses", 0)
        c["ebit"] = c["ebitda"] - c.get("depreciation", 0)
        c["pbt"] = c["ebit"] - c.get("finance_costs", 0)
        c["net_profit"] = c["pbt"] - c.get("tax", 0)
        merged[cid] = c.get(key, 0)
    return merged


def _calc_bs_row(key: str, company_totals: dict[str, dict[str, float]]) -> dict[str, float]:
    merged: dict[str, float] = {}
    for cid, cats in company_totals.items():
        c = cats.copy()
        c["total_assets"] = sum(c.get(k, 0) for k in ("fixed_assets_net", "inventory", "trade_receivables", "cash_bank", "other_current_assets"))
        c["total_liabilities_equity"] = sum(
            c.get(k, 0) for k in ("long_term_borrowings", "trade_payables", "other_current_liabilities", "share_capital", "retained_earnings")
        )
        merged[cid] = c.get(key, 0)
    return merged


def _elimination_maps(
    db: Session, workspace_id: str, period_id: str, statement: str
) -> tuple[dict[str, float], dict[str, str]]:
    """ADJ-1: return elimination amount+notes filtered to the requested statement.

    statement must be 'pl' or 'bs'.  Rows with elimination_type='both' (legacy
    rows written before 9.7) apply to both statements.  Rows typed 'pl' apply
    only to the P&L; rows typed 'bs' apply only to the Balance Sheet.
    """
    rows = db.query(ConsolidationElimination).filter_by(workspace_id=workspace_id, period_id=period_id).all()
    amounts: dict[str, float] = {}
    notes: dict[str, str] = {}
    for r in rows:
        etype = (r.elimination_type or ELIM_TYPE_BOTH).lower()
        if etype != statement and etype != ELIM_TYPE_BOTH:
            continue
        cat = r.account_category
        amounts[cat] = amounts.get(cat, 0.0) + float(r.amount or 0)
        if r.note:
            notes[cat] = r.note
    return amounts, notes


def get_consolidation_pl(db: Session, workspace_id: str, period_id: str) -> dict[str, Any]:
    period_str, period_obj = _period_str(db, period_id)
    companies = list_active_companies(db, workspace_id)
    company_ids = [c["id"] for c in companies]

    company_totals = {
        cid: _aggregate_categories(db, workspace_id, cid, period_str, _pl_category)
        for cid in company_ids
    }
    # ADJ-1: only P&L-typed eliminations affect the income statement.
    elim, elim_notes = _elimination_maps(db, workspace_id, period_id, ELIM_TYPE_PL)

    rows_out = []
    for row in PL_ROWS:
        key = row["key"]
        if row.get("calculated"):
            by_company = _calc_pl_row(key, company_totals)
        else:
            by_company = {cid: company_totals[cid].get(key, 0) for cid in company_ids}
        elim_amt = elim.get(key, 0)
        group_total = sum(by_company.values()) - elim_amt
        rows_out.append({
            **row,
            "companies": by_company,
            "eliminations": elim_amt,
            "elimination_note": elim_notes.get(key),
            "group_total": group_total,
        })

    unassigned = unassigned_journal_lines(db, workspace_id, period_str)
    return {
        "period_id": period_id,
        "period_name": period_obj.period_name,
        "period": period_str,
        "companies": companies,
        "rows": rows_out,
        "unassigned_lines": unassigned,
        # ENG-1: surface unattributed lines so the UI can warn the user.
        "has_unassigned_lines": unassigned > 0,
    }


def get_consolidation_bs(db: Session, workspace_id: str, period_id: str) -> dict[str, Any]:
    period_str, period_obj = _period_str(db, period_id)
    companies = list_active_companies(db, workspace_id)
    company_ids = [c["id"] for c in companies]

    company_totals = {
        cid: _aggregate_categories(db, workspace_id, cid, period_str, _bs_category)
        for cid in company_ids
    }
    # ADJ-1: only BS-typed eliminations affect the balance sheet.
    elim, elim_notes = _elimination_maps(db, workspace_id, period_id, ELIM_TYPE_BS)

    rows_out = []
    for row in BS_ROWS:
        key = row["key"]
        if row.get("calculated"):
            by_company = _calc_bs_row(key, company_totals)
        else:
            by_company = {cid: company_totals[cid].get(key, 0) for cid in company_ids}
        elim_amt = elim.get(key, 0)
        group_total = sum(by_company.values()) - elim_amt
        rows_out.append({
            **row,
            "companies": by_company,
            "eliminations": elim_amt,
            "elimination_note": elim_notes.get(key),
            "group_total": group_total,
        })

    total_assets = next((r["group_total"] for r in rows_out if r["key"] == "total_assets"), 0)
    total_le = next((r["group_total"] for r in rows_out if r["key"] == "total_liabilities_equity"), 0)
    balanced = abs(total_assets - total_le) < 1.0
    unassigned = unassigned_journal_lines(db, workspace_id, period_str)

    return {
        "period_id": period_id,
        "period_name": period_obj.period_name,
        "period": period_str,
        "companies": companies,
        "rows": rows_out,
        "total_assets": total_assets,
        "total_liabilities_equity": total_le,
        "is_balanced": balanced,
        "unassigned_lines": unassigned,
        "has_unassigned_lines": unassigned > 0,
    }


def get_summary_cards(db: Session, workspace_id: str, period_id: str) -> dict[str, Any]:
    pl = get_consolidation_pl(db, workspace_id, period_id)
    bs = get_consolidation_bs(db, workspace_id, period_id)
    companies = pl["companies"]
    cards = []
    pl_map = {r["key"]: r for r in pl["rows"]}
    bs_map = {r["key"]: r for r in bs["rows"]}

    for card in SUMMARY_CARDS:
        src = pl_map if card["key"] in pl_map else bs_map
        row = src.get(card["key"], {})
        breakdown = [
            {"company_id": c["id"], "company_name": c["company_name"], "amount": row.get("companies", {}).get(c["id"], 0)}
            for c in companies
        ]
        cards.append({
            "key": card["key"],
            "label": card["label"],
            "total": row.get("group_total", 0),
            "breakdown": breakdown,
        })

    return {"cards": cards, "companies": companies}


def get_company_comparison(db: Session, workspace_id: str, period_id: str) -> list[dict[str, Any]]:
    pl = get_consolidation_pl(db, workspace_id, period_id)
    bs = get_consolidation_bs(db, workspace_id, period_id)
    pl_map = {r["key"]: r for r in pl["rows"]}
    bs_map = {r["key"]: r for r in bs["rows"]}
    out = []
    for c in pl["companies"]:
        cid = c["id"]
        assets = bs_map.get("total_assets", {}).get("companies", {}).get(cid, 0)
        ta = bs_map.get("total_assets", {}).get("companies", {})
        tle = bs_map.get("total_liabilities_equity", {}).get("companies", {})
        balanced = abs(ta.get(cid, 0) - tle.get(cid, 0)) < 1.0
        out.append({
            "company_id": cid,
            "company_name": c["company_name"],
            "legal_type": c.get("legal_type"),
            "revenue": pl_map.get("revenue", {}).get("companies", {}).get(cid, 0),
            "net_profit": pl_map.get("net_profit", {}).get("companies", {}).get(cid, 0),
            "total_assets": assets,
            "status": "Balanced" if balanced else "Review needed",
            "status_ok": balanced,
        })
    return out


def _validate_elimination_amount(amount: Any) -> float:
    """UI-1 / SVC-1: reject zero, negative, NaN, Infinity and non-numeric values."""
    try:
        v = float(amount)
    except (TypeError, ValueError):
        raise ValueError("Elimination amount must be a valid number.")
    if math.isnan(v):
        raise ValueError("Elimination amount must not be NaN.")
    if math.isinf(v):
        raise ValueError("Elimination amount must not be Infinity.")
    if v <= 0:
        raise ValueError("Elimination amount must be positive and non-zero.")
    return v


def _infer_elimination_type(account_category: str) -> str:
    """ADJ-1: infer default elimination_type from the account category key."""
    if account_category in PL_KEYS:
        return ELIM_TYPE_PL
    if account_category in BS_KEYS:
        return ELIM_TYPE_BS
    return ELIM_TYPE_BOTH


def save_elimination(db: Session, workspace_id: str, data: dict[str, Any], user_id: str | None) -> dict[str, Any]:
    # UI-1: validate amount — never silently accept zero, negative, NaN or Infinity.
    amount = _validate_elimination_amount(data.get("amount"))

    # ADJ-1: determine elimination_type from caller or infer from account category.
    raw_type = (data.get("elimination_type") or _infer_elimination_type(data["account_category"])).lower()
    if raw_type not in VALID_ELIM_TYPES:
        raise ValueError(f"elimination_type must be one of {sorted(VALID_ELIM_TYPES)}; got {raw_type!r}.")

    rec = ConsolidationElimination(
        workspace_id=workspace_id,
        period_id=data["period_id"],
        account_category=data["account_category"],
        elimination_type=raw_type,
        company_from_id=data.get("company_from_id"),
        company_to_id=data.get("company_to_id"),
        amount=amount,
        note=data.get("note"),
        created_by=user_id,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return _elim_dict(rec)


def list_eliminations(db: Session, workspace_id: str, period_id: str) -> list[dict[str, Any]]:
    rows = (
        db.query(ConsolidationElimination)
        .filter_by(workspace_id=workspace_id, period_id=period_id)
        .order_by(ConsolidationElimination.created_at.desc())
        .all()
    )
    return [_elim_dict(r) for r in rows]


def upsert_elimination_amount(
    db: Session,
    workspace_id: str,
    period_id: str,
    account_category: str,
    amount: float,
    note: str | None,
    user_id: str | None,
    elimination_type: str | None = None,
) -> dict[str, Any]:
    # UI-1: validate before touching the database.
    validated = _validate_elimination_amount(amount)

    # ADJ-1: resolve type.
    raw_type = (elimination_type or _infer_elimination_type(account_category)).lower()
    if raw_type not in VALID_ELIM_TYPES:
        raise ValueError(f"elimination_type must be one of {sorted(VALID_ELIM_TYPES)}; got {raw_type!r}.")

    existing = (
        db.query(ConsolidationElimination)
        .filter_by(workspace_id=workspace_id, period_id=period_id, account_category=account_category)
        .first()
    )
    if existing:
        existing.amount = validated
        existing.note = note
        existing.elimination_type = raw_type
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return _elim_dict(existing)
    return save_elimination(
        db,
        workspace_id,
        {
            "period_id": period_id,
            "account_category": account_category,
            "elimination_type": raw_type,
            "amount": validated,
            "note": note,
        },
        user_id,
    )


def _elim_dict(r: ConsolidationElimination) -> dict[str, Any]:
    return {
        "id": r.id,
        "workspace_id": r.workspace_id,
        "period_id": r.period_id,
        "account_category": r.account_category,
        "elimination_type": r.elimination_type or ELIM_TYPE_BOTH,
        "company_from_id": r.company_from_id,
        "company_to_id": r.company_to_id,
        "amount": float(r.amount or 0),
        "note": r.note,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


# Per-(workspace_id, period) threading locks for in-process serialization.
# PostgreSQL's SELECT...FOR UPDATE provides DB-level serialization across
# multiple processes; this lock handles concurrent threads within one process
# (and is the primary serialization mechanism for SQLite, which ignores FOR UPDATE).
_ic_seq_locks: dict[tuple[str, str], threading.Lock] = {}
_ic_seq_locks_meta = threading.Lock()


def _ic_seq_lock(workspace_id: str, period: str) -> threading.Lock:
    key = (workspace_id, period)
    with _ic_seq_locks_meta:
        if key not in _ic_seq_locks:
            _ic_seq_locks[key] = threading.Lock()
        return _ic_seq_locks[key]


def next_ic_reference(db: Session, workspace_id: str, period: str) -> str:
    """SVC-1: collision-resistant IC reference — YYYY-MM-NNNN, monotonically
    incrementing per workspace+period.

    Uses a per-(workspace, period) threading.Lock to prevent concurrent increments
    within the same process (required for SQLite; complementary to PostgreSQL's
    SELECT...FOR UPDATE row-level lock in multi-process deployments).
    """
    with _ic_seq_lock(workspace_id, period):
        seq = (
            db.query(IcReferenceSequence)
            .filter_by(workspace_id=workspace_id, period=period)
            .with_for_update()
            .first()
        )
        if seq is None:
            seq = IcReferenceSequence(
                id=str(uuid.uuid4()),
                workspace_id=workspace_id,
                period=period,
                last_seq=0,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            db.add(seq)
        seq.last_seq += 1
        seq.updated_at = datetime.utcnow()
        db.flush()
        return f"IC-{period}-{seq.last_seq:04d}"


def backfill_company_id(db: Session, workspace_id: str, company_id: str) -> None:
    """Stamp company_id on existing UAE records for this workspace on activation."""
    for model in (UAEAccount, UAEJournalEntry):
        db.query(model).filter(
            model.tenant_id == workspace_id,
            model.company_id.is_(None),
        ).update({model.company_id: company_id}, synchronize_session=False)
    db.commit()
