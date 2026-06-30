"""Group consolidation — aggregate P&L and Balance Sheet across UAE companies."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.company_setup import (
    AccountingPeriod,
    ConsolidationElimination,
    UaeCompanyProfile,
)
from app.models.uae_accounting_full import UAEAccount, UAEJournalEntry, UAEJournalLine

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
    if code.startswith("300") or st == "current liability" and "payable" in st:
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
    account_meta: dict[str, tuple[str | None, str | None]] = {
        a.code: (a.account_type, a.sub_type)
        for a in db.query(UAEAccount).filter(
            UAEAccount.tenant_id == workspace_id,
            (UAEAccount.company_id == company_id) | (UAEAccount.company_id.is_(None)),
        ).all()
    }
    rows = (
        db.query(UAEJournalLine, UAEJournalEntry)
        .join(UAEJournalEntry, UAEJournalLine.journal_entry_id == UAEJournalEntry.id)
        .filter(
            UAEJournalEntry.tenant_id == workspace_id,
            UAEJournalEntry.period == period,
            UAEJournalEntry.status == "posted",
            (UAEJournalEntry.company_id == company_id) | (UAEJournalEntry.company_id.is_(None)),
        )
        .all()
    )
    totals: dict[str, float] = {}
    for line, _je in rows:
        code = line.account_code or ""
        meta = account_meta.get(code, (None, None))
        cat = mapper(code, meta[0], meta[1])
        if not cat:
            continue
        dr = float(line.debit or 0)
        cr = float(line.credit or 0)
        amt = _signed_pl_amount(dr, cr, cat) if mapper is _pl_category else _signed_bs_amount(dr, cr, cat)
        totals[cat] = totals.get(cat, 0.0) + amt
    return totals


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


def _elimination_map(db: Session, workspace_id: str, period_id: str) -> dict[str, float]:
    rows = db.query(ConsolidationElimination).filter_by(workspace_id=workspace_id, period_id=period_id).all()
    out: dict[str, float] = {}
    for r in rows:
        out[r.account_category] = out.get(r.account_category, 0.0) + float(r.amount or 0)
    return out


def _elimination_notes_map(db: Session, workspace_id: str, period_id: str) -> dict[str, str]:
    rows = db.query(ConsolidationElimination).filter_by(workspace_id=workspace_id, period_id=period_id).all()
    out: dict[str, str] = {}
    for r in rows:
        if r.note:
            out[r.account_category] = r.note
    return out


def get_consolidation_pl(db: Session, workspace_id: str, period_id: str) -> dict[str, Any]:
    period_str, period_obj = _period_str(db, period_id)
    companies = list_active_companies(db, workspace_id)
    company_ids = [c["id"] for c in companies]

    company_totals = {
        cid: _aggregate_categories(db, workspace_id, cid, period_str, _pl_category)
        for cid in company_ids
    }
    elim = _elimination_map(db, workspace_id, period_id)
    elim_notes = _elimination_notes_map(db, workspace_id, period_id)

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

    return {
        "period_id": period_id,
        "period_name": period_obj.period_name,
        "period": period_str,
        "companies": companies,
        "rows": rows_out,
    }


def get_consolidation_bs(db: Session, workspace_id: str, period_id: str) -> dict[str, Any]:
    period_str, period_obj = _period_str(db, period_id)
    companies = list_active_companies(db, workspace_id)
    company_ids = [c["id"] for c in companies]

    company_totals = {
        cid: _aggregate_categories(db, workspace_id, cid, period_str, _bs_category)
        for cid in company_ids
    }
    elim = _elimination_map(db, workspace_id, period_id)
    elim_notes = _elimination_notes_map(db, workspace_id, period_id)

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

    return {
        "period_id": period_id,
        "period_name": period_obj.period_name,
        "period": period_str,
        "companies": companies,
        "rows": rows_out,
        "total_assets": total_assets,
        "total_liabilities_equity": total_le,
        "is_balanced": balanced,
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


def save_elimination(db: Session, workspace_id: str, data: dict[str, Any], user_id: str | None) -> dict[str, Any]:
    rec = ConsolidationElimination(
        workspace_id=workspace_id,
        period_id=data["period_id"],
        account_category=data["account_category"],
        company_from_id=data.get("company_from_id"),
        company_to_id=data.get("company_to_id"),
        amount=data.get("amount", 0),
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
) -> dict[str, Any]:
    existing = (
        db.query(ConsolidationElimination)
        .filter_by(workspace_id=workspace_id, period_id=period_id, account_category=account_category)
        .first()
    )
    if existing:
        existing.amount = amount
        existing.note = note
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return _elim_dict(existing)
    return save_elimination(
        db,
        workspace_id,
        {"period_id": period_id, "account_category": account_category, "amount": amount, "note": note},
        user_id,
    )


def _elim_dict(r: ConsolidationElimination) -> dict[str, Any]:
    return {
        "id": r.id,
        "workspace_id": r.workspace_id,
        "period_id": r.period_id,
        "account_category": r.account_category,
        "company_from_id": r.company_from_id,
        "company_to_id": r.company_to_id,
        "amount": float(r.amount or 0),
        "note": r.note,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def backfill_company_id(db: Session, workspace_id: str, company_id: str) -> None:
    """Stamp company_id on existing UAE records for this workspace on activation."""
    for model in (UAEAccount, UAEJournalEntry):
        db.query(model).filter(
            model.tenant_id == workspace_id,
            model.company_id.is_(None),
        ).update({model.company_id: company_id}, synchronize_session=False)
    db.commit()
