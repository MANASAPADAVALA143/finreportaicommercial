"""Aggregate UAE GL journal lines into FP&A / CFO summary metrics."""
from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.models.uae_accounting_full import UAEJournalEntry, UAEJournalLine


def _empty(period_start: str, period_end: str) -> dict[str, Any]:
    return {
        "has_data": False,
        "je_count": 0,
        "currency": "AED",
        "period": {"start": period_start, "end": period_end},
        "revenue": 0.0,
        "cogs": 0.0,
        "gross_profit": 0.0,
        "opex": 0.0,
        "ebitda": 0.0,
        "other_income": 0.0,
        "net_profit": 0.0,
        "gross_margin": 0.0,
        "ebitda_margin": 0.0,
        "net_margin": 0.0,
        "assets": 0.0,
        "liabilities": 0.0,
        "equity": 0.0,
        "cash": 0.0,
        "trade_receivables": 0.0,
        "trade_payables": 0.0,
        "ifrs16_rou_assets": 0.0,
        "ifrs16_lease_liability": 0.0,
        "ifrs15_contract_assets": 0.0,
        "ifrs15_contract_liabilities": 0.0,
        "ifrs9_ecl_provision": 0.0,
    }


def _code(line: UAEJournalLine) -> str:
    return (line.account_code or "").strip()


def _in_range(code: str, low: int, high: int) -> bool:
    try:
        n = int(code)
        return low <= n <= high
    except ValueError:
        return False


def build_gl_summary(
    db: Session,
    *,
    workspace_id: str,
    company_id: str,
    period_start: str,
    period_end: str,
) -> dict[str, Any]:
    start = date.fromisoformat(period_start)
    end = date.fromisoformat(period_end)

    je_q = db.query(UAEJournalEntry).filter(
        UAEJournalEntry.tenant_id == workspace_id,
        UAEJournalEntry.company_id == company_id,
        UAEJournalEntry.entry_date >= start,
        UAEJournalEntry.entry_date <= end,
        UAEJournalEntry.status == "posted",
    )
    je_count = je_q.count()
    if je_count == 0:
        return _empty(period_start, period_end)

    rows = (
        db.query(UAEJournalLine, UAEJournalEntry)
        .join(UAEJournalEntry, UAEJournalLine.journal_entry_id == UAEJournalEntry.id)
        .filter(
            UAEJournalEntry.tenant_id == workspace_id,
            UAEJournalEntry.company_id == company_id,
            UAEJournalEntry.entry_date >= start,
            UAEJournalEntry.entry_date <= end,
            UAEJournalEntry.status == "posted",
        )
        .all()
    )

    revenue = cogs = opex = other_income = 0.0
    assets = liabilities = equity = cash = 0.0
    trade_receivables = trade_payables = 0.0

    for line, _je in rows:
        code = _code(line)
        dr = float(line.debit or 0)
        cr = float(line.credit or 0)
        if not code:
            continue

        if code.startswith("4") and cr > 0:
            revenue += cr
        if code.startswith("5") and dr > 0:
            cogs += dr
        if code.startswith("6") and dr > 0:
            opex += dr
        if code.startswith("7") and cr > 0:
            other_income += cr
        if code.startswith("1") and dr > 0:
            assets += dr
        if code.startswith("2") and cr > 0:
            liabilities += cr
        if code.startswith("3") and cr > 0:
            equity += cr
        if _in_range(code, 1010, 1099) and dr > 0:
            cash += dr
        if code == "1200" and dr > 0:
            trade_receivables += dr
        if code == "2100" and cr > 0:
            trade_payables += cr

    gross_profit = revenue - cogs
    ebitda = gross_profit - opex
    net_profit = ebitda + other_income
    gross_margin = (gross_profit / revenue * 100) if revenue > 0 else 0.0
    ebitda_margin = (ebitda / revenue * 100) if revenue > 0 else 0.0
    net_margin = (net_profit / revenue * 100) if revenue > 0 else 0.0

    from app.services.ifrs_integration_service import ifrs_metrics
    ifrs = ifrs_metrics(db, workspace_id, company_id)

    return {
        "has_data": True,
        "je_count": je_count,
        "currency": "AED",
        "period": {"start": period_start, "end": period_end},
        **ifrs,
        "revenue": round(revenue, 2),
        "cogs": round(cogs, 2),
        "gross_profit": round(gross_profit, 2),
        "opex": round(opex, 2),
        "ebitda": round(ebitda, 2),
        "other_income": round(other_income, 2),
        "net_profit": round(net_profit, 2),
        "gross_margin": round(gross_margin, 2),
        "ebitda_margin": round(ebitda_margin, 2),
        "net_margin": round(net_margin, 2),
        "assets": round(assets, 2),
        "liabilities": round(liabilities, 2),
        "equity": round(equity, 2),
        "cash": round(cash, 2),
        "trade_receivables": round(trade_receivables, 2),
        "trade_payables": round(trade_payables, 2),
    }
