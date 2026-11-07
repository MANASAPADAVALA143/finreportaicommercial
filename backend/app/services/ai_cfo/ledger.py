"""Deterministic reads over the UAE general ledger (uae_journal_entries / uae_journal_lines).

All figures the AI CFO layer reports come from here, never from the model. Only posted
entries count. Rows are matched on the exact company: lines stamped with no company are
excluded and reported by `coverage()` so answers can state the limitation.

Signs follow the account's natural balance: assets and expenses are debit minus credit,
income, liabilities and equity are credit minus debit.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.uae_accounting_full import UAEAccount, UAEJournalEntry, UAEJournalLine

ACCOUNT_TYPES = ("Asset", "Liability", "Equity", "Income", "Expense")
# First digit of the default UAE chart (uae_coa_service.UAE_COA) when an account has no type.
_TYPE_BY_PREFIX = {"1": "Asset", "2": "Asset", "3": "Liability", "4": "Liability", "5": "Equity", "6": "Income", "7": "Expense"}
_DEBIT_NATURAL = {"Asset", "Expense"}


@dataclass(frozen=True)
class LedgerScope:
    workspace_id: str
    company_id: str


def period_add(period: str, months: int) -> str:
    year, month = int(period[:4]), int(period[5:7])
    idx = year * 12 + (month - 1) + months
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def periods_between(start: str, end: str) -> list[str]:
    out, cur = [], start
    while cur <= end:
        out.append(cur)
        cur = period_add(cur, 1)
    return out


def _money(v: Any) -> float:
    return round(float(v or 0), 2)


def _normalise_type(raw: str | None) -> str | None:
    if not raw:
        return None
    t = raw.strip().lower()
    for name in ACCOUNT_TYPES:
        if t.startswith(name.lower()):
            return name
    if t in ("revenue", "sales"):
        return "Income"
    if t in ("cost", "cogs"):
        return "Expense"
    return None


def natural(account_type: str, debit: float, credit: float) -> float:
    return round(debit - credit, 2) if account_type in _DEBIT_NATURAL else round(credit - debit, 2)


def _posted_lines(db: Session, scope: LedgerScope):
    return (
        db.query(UAEJournalLine, UAEJournalEntry)
        .join(UAEJournalEntry, UAEJournalLine.journal_entry_id == UAEJournalEntry.id)
        .filter(
            UAEJournalEntry.tenant_id == scope.workspace_id,
            UAEJournalEntry.company_id == scope.company_id,
            UAEJournalEntry.status == "posted",
        )
    )


def account_catalog(db: Session, scope: LedgerScope) -> dict[str, dict[str, str]]:
    """code → {name, type}; company accounts override workspace-wide ones."""
    rows = (
        db.query(UAEAccount.code, UAEAccount.name, UAEAccount.account_type, UAEAccount.company_id)
        .filter(
            UAEAccount.tenant_id == scope.workspace_id,
            (UAEAccount.company_id == scope.company_id) | (UAEAccount.company_id.is_(None)),
        )
        .all()
    )
    catalog: dict[str, dict[str, str]] = {}
    for code, name, acct_type, company in sorted(rows, key=lambda r: r[3] is not None):
        if code:
            catalog[code] = {"name": name or code, "type": _normalise_type(acct_type) or _type_from_code(code)}
    return catalog


def _type_from_code(code: str | None) -> str:
    return _TYPE_BY_PREFIX.get((code or "?")[0], "Other")


def _resolve(catalog: dict[str, dict[str, str]], code: str | None, line_name: str | None) -> tuple[str, str]:
    info = catalog.get(code or "")
    if info:
        return info["name"], info["type"]
    return line_name or code or "Unknown", _type_from_code(code)


def latest_period(db: Session, scope: LedgerScope) -> str | None:
    row = (
        db.query(func.max(UAEJournalEntry.period))
        .filter(
            UAEJournalEntry.tenant_id == scope.workspace_id,
            UAEJournalEntry.company_id == scope.company_id,
            UAEJournalEntry.status == "posted",
        )
        .scalar()
    )
    return row or None


def coverage(db: Session, scope: LedgerScope) -> dict[str, Any]:
    periods = [
        p for (p,) in db.query(UAEJournalEntry.period)
        .filter(
            UAEJournalEntry.tenant_id == scope.workspace_id,
            UAEJournalEntry.company_id == scope.company_id,
            UAEJournalEntry.status == "posted",
        )
        .distinct()
        .order_by(UAEJournalEntry.period)
        if p
    ]
    lines = _posted_lines(db, scope).count()
    unassigned = (
        db.query(func.count(UAEJournalLine.id))
        .join(UAEJournalEntry, UAEJournalLine.journal_entry_id == UAEJournalEntry.id)
        .filter(
            UAEJournalEntry.tenant_id == scope.workspace_id,
            UAEJournalEntry.company_id.is_(None),
            UAEJournalEntry.status == "posted",
        )
        .scalar()
        or 0
    )
    limitations = []
    if not periods:
        limitations.append("No posted journal entries for this company.")
    elif len(periods) < 4:
        limitations.append(f"Only {len(periods)} month(s) of posted history; trend comparisons are weak.")
    if unassigned:
        limitations.append(
            f"{unassigned} posted journal line(s) in this workspace have no company and are excluded."
        )
    return {
        "periods": periods,
        "first_period": periods[0] if periods else None,
        "last_period": periods[-1] if periods else None,
        "posted_lines": lines,
        "unassigned_workspace_lines": unassigned,
        "limitations": limitations,
    }


def monthly_movements(
    db: Session,
    scope: LedgerScope,
    period_from: str,
    period_to: str,
    *,
    account_codes: list[str] | None = None,
    account_type: str | None = None,
) -> list[dict[str, Any]]:
    """Per account and month: debit, credit and natural-sign net movement."""
    q = (
        db.query(
            UAEJournalEntry.period,
            UAEJournalLine.account_code,
            func.max(UAEJournalLine.account_name),
            func.coalesce(func.sum(UAEJournalLine.debit), 0),
            func.coalesce(func.sum(UAEJournalLine.credit), 0),
            func.count(UAEJournalLine.id),
        )
        .join(UAEJournalEntry, UAEJournalLine.journal_entry_id == UAEJournalEntry.id)
        .filter(
            UAEJournalEntry.tenant_id == scope.workspace_id,
            UAEJournalEntry.company_id == scope.company_id,
            UAEJournalEntry.status == "posted",
            UAEJournalEntry.period >= period_from,
            UAEJournalEntry.period <= period_to,
        )
        .group_by(UAEJournalEntry.period, UAEJournalLine.account_code)
    )
    if account_codes:
        q = q.filter(UAEJournalLine.account_code.in_(account_codes))
    catalog = account_catalog(db, scope)
    out = []
    for period, code, line_name, debit, credit, count in q.all():
        name, acct_type = _resolve(catalog, code, line_name)
        if account_type and acct_type != account_type:
            continue
        d, c = _money(debit), _money(credit)
        out.append({
            "period": period, "account_code": code, "account_name": name, "account_type": acct_type,
            "debit": d, "credit": c, "net": natural(acct_type, d, c), "lines": int(count),
        })
    out.sort(key=lambda r: (r["account_code"] or "", r["period"]))
    return out


def balances_as_of(
    db: Session, scope: LedgerScope, period: str, *, account_type: str | None = None
) -> list[dict[str, Any]]:
    """Cumulative balance per account through the end of `period` (all posted history)."""
    q = (
        db.query(
            UAEJournalLine.account_code,
            func.max(UAEJournalLine.account_name),
            func.coalesce(func.sum(UAEJournalLine.debit), 0),
            func.coalesce(func.sum(UAEJournalLine.credit), 0),
        )
        .join(UAEJournalEntry, UAEJournalLine.journal_entry_id == UAEJournalEntry.id)
        .filter(
            UAEJournalEntry.tenant_id == scope.workspace_id,
            UAEJournalEntry.company_id == scope.company_id,
            UAEJournalEntry.status == "posted",
            UAEJournalEntry.period <= period,
        )
        .group_by(UAEJournalLine.account_code)
    )
    catalog = account_catalog(db, scope)
    out = []
    for code, line_name, debit, credit in q.all():
        name, acct_type = _resolve(catalog, code, line_name)
        if account_type and acct_type != account_type:
            continue
        d, c = _money(debit), _money(credit)
        out.append({
            "account_code": code, "account_name": name, "account_type": acct_type,
            "total_debit": d, "total_credit": c, "balance": natural(acct_type, d, c),
        })
    out.sort(key=lambda r: r["account_code"] or "")
    return out


def transactions(
    db: Session, scope: LedgerScope, account_code: str, period: str, *, limit: int = 20
) -> list[dict[str, Any]]:
    """Posted lines on one account in one month, largest first, with source references."""
    catalog = account_catalog(db, scope)
    rows = (
        _posted_lines(db, scope)
        .filter(UAEJournalLine.account_code == account_code, UAEJournalEntry.period == period)
        .all()
    )
    out = []
    for line, entry in rows:
        name, acct_type = _resolve(catalog, line.account_code, line.account_name)
        d, c = _money(line.debit), _money(line.credit)
        out.append({
            "ref": entry.entry_number or entry.id,
            "journal_entry_id": entry.id,
            "line_id": line.id,
            "date": entry.entry_date.isoformat() if entry.entry_date else None,
            "account_code": line.account_code,
            "account_name": name,
            "description": line.description or entry.description,
            "reference": entry.reference,
            "source": entry.source,
            "cost_center": line.cost_center,
            "debit": d,
            "credit": c,
            "net": natural(acct_type, d, c),
        })
    out.sort(key=lambda r: abs(r["net"]), reverse=True)
    return out[: max(1, min(limit, 200))]
