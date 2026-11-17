"""Group Financial Intelligence.

Reads the existing consolidation agent, FX rates, posted UAE journals and bank
accounts. Does not recalculate those engines and does not substitute a missing
figure with zero.
"""

from __future__ import annotations

import hashlib
import re
from calendar import monthrange
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models.company_setup import AccountingPeriod, ConsolidationElimination, UaeCompanyProfile
from app.models.group_finance import GroupEntityOwnership, GroupFinancialSnapshot, GroupIntercompanyMatch
from app.models.uae_accounting_full import UAEBankAccount, UAEJournalEntry
from app.services.ai_close.consolidation_agent import consolidation
from app.services.ai_close.context import CloseContext, Entity
from app.services.ai_close.fx import rate as fx_rate
from app.services.ai_cfo.ledger import period_add
from app.services.audit_log_service import log_audit

_PERIOD = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_CURRENCY = re.compile(r"^[A-Z]{3}$")
_ENGINE = "app.services.ai_close.consolidation_agent.consolidation"
_IC_METHOD = (
    "Intercompany pairs are the consolidation agent's IC- reference match. "
    "Manual consolidation_eliminations are disclosed and are not added again."
)
_LIABILITY_KEYS = ("long_term_borrowings", "trade_payables", "other_current_liabilities")


class GroupIntelligenceError(ValueError):
    pass


def _period_end(period: str) -> date:
    if not _PERIOD.match(period or ""):
        raise GroupIntelligenceError("period must be YYYY-MM")
    year, month = int(period[:4]), int(period[5:7])
    return date(year, month, monthrange(year, month)[1])


def _period_start(period: str) -> date:
    end = _period_end(period)
    return date(end.year, end.month, 1)


def _currency(code: str | None) -> str:
    value = (code or "").strip().upper()
    if not _CURRENCY.match(value):
        raise GroupIntelligenceError("reporting_currency must be a 3-letter ISO code")
    return value


def _money(value: float | None, currency: str | None, method: str, reason: str | None = None) -> dict[str, Any]:
    available = value is not None and reason is None
    return {
        "value": None if not available else round(float(value), 2),
        "currency": currency,
        "available": available,
        "reason": reason,
        "method": method,
    }


def _unavailable(currency: str | None, method: str, reason: str) -> dict[str, Any]:
    return _money(None, currency, method, reason)


def _row(rows: list[dict[str, Any]], key: str) -> float | None:
    for row in rows:
        if row.get("key") == key and row.get("consolidated") is not None:
            return float(row["consolidated"])
    return None


def _companies(db: Session, workspace_id: str) -> list[UaeCompanyProfile]:
    return (
        db.query(UaeCompanyProfile)
        .filter_by(workspace_id=workspace_id)
        .order_by(UaeCompanyProfile.company_name)
        .all()
    )


def _active(companies: list[UaeCompanyProfile], company_ids: list[str] | None) -> list[UaeCompanyProfile]:
    active = [c for c in companies if c.status == "active"]
    if not company_ids:
        return active
    wanted = list(dict.fromkeys(company_ids))
    by_id = {c.id: c for c in active}
    missing = [cid for cid in wanted if cid not in by_id]
    if missing:
        raise GroupIntelligenceError("One or more companies are not active entities in this workspace")
    return [by_id[cid] for cid in wanted]


def _set_key(company_ids: list[str]) -> str:
    return hashlib.sha256(",".join(sorted(company_ids)).encode()).hexdigest()


def _ownership_on(db: Session, workspace_id: str, company_id: str, on: date) -> GroupEntityOwnership | None:
    rows = (
        db.query(GroupEntityOwnership)
        .filter(
            GroupEntityOwnership.workspace_id == workspace_id,
            GroupEntityOwnership.company_id == company_id,
            GroupEntityOwnership.effective_from <= on,
        )
        .all()
    )
    current = [r for r in rows if r.effective_to is None or r.effective_to >= on]
    if len(current) > 1:
        raise GroupIntelligenceError(f"Overlapping ownership records for company {company_id} on {on.isoformat()}")
    return current[0] if current else None


def _posted_lines(db: Session, workspace_id: str, company_id: str, period: str) -> int:
    return (
        db.query(UAEJournalEntry.id)
        .filter(
            UAEJournalEntry.tenant_id == workspace_id,
            UAEJournalEntry.company_id == company_id,
            UAEJournalEntry.period == period,
            UAEJournalEntry.status == "posted",
        )
        .count()
    )


def _manual_eliminations(db: Session, workspace_id: str, period: str) -> list[dict[str, Any]]:
    start, end = _period_start(period), _period_end(period)
    rows = (
        db.query(ConsolidationElimination, AccountingPeriod)
        .join(AccountingPeriod, ConsolidationElimination.period_id == AccountingPeriod.id)
        .filter(
            ConsolidationElimination.workspace_id == workspace_id,
            AccountingPeriod.end_date >= start,
            AccountingPeriod.end_date <= end,
        )
        .all()
    )
    return [
        {
            "id": elim.id,
            "period_id": elim.period_id,
            "account_category": elim.account_category,
            "amount": float(elim.amount or 0),
            "company_from_id": elim.company_from_id,
            "company_to_id": elim.company_to_id,
            "note": elim.note,
            "applied_to_group_kpis": False,
        }
        for elim, _period in rows
    ]


def _bank_cash(
    db: Session,
    workspace_id: str,
    companies: list[UaeCompanyProfile],
    period: str,
    reporting: str,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    ids = [c.id for c in companies]
    method = "uae_bank_accounts.last_reconciled_balance translated at ai_close_fx_rates.closing_rate"
    if not ids:
        return _unavailable(reporting, method, "No entities selected"), []
    accounts = (
        db.query(UAEBankAccount)
        .filter(
            UAEBankAccount.tenant_id == workspace_id,
            UAEBankAccount.company_id.in_(ids),
            UAEBankAccount.is_active.is_(True),
        )
        .all()
    )
    details: list[dict[str, Any]] = []
    total = 0.0
    blocked: str | None = None
    for account in accounts:
        local_currency = (account.currency or "").upper() or None
        balance = account.last_reconciled_balance
        item: dict[str, Any] = {
            "bank_account_id": account.id,
            "company_id": account.company_id,
            "currency": local_currency,
            "last_reconciled_date": account.last_reconciled_date.isoformat() if account.last_reconciled_date else None,
            "last_reconciled_balance": float(balance) if balance is not None else None,
            "reporting_amount": None,
            "fx_rate_id": None,
            "closing_rate": None,
        }
        if balance is None:
            blocked = blocked or f"Bank account {account.id} has no reconciled balance"
        elif not local_currency:
            blocked = blocked or f"Bank account {account.id} has no currency"
        elif local_currency == reporting:
            item["reporting_amount"] = round(float(balance), 2)
            item["closing_rate"] = 1.0
            total += item["reporting_amount"]
        else:
            row = fx_rate(db, workspace_id, period, local_currency, reporting)
            if row is None:
                blocked = blocked or (
                    f"No {period} {local_currency}/{reporting} closing rate for bank account {account.id}"
                )
            else:
                item["fx_rate_id"] = row.id
                item["closing_rate"] = row.closing_rate
                item["reporting_amount"] = round(float(balance) * row.closing_rate, 2)
                total += item["reporting_amount"]
        details.append(item)
    if not accounts:
        return _unavailable(reporting, method, "No active bank accounts for the selected entities"), details
    if blocked:
        return _unavailable(reporting, method, blocked), details
    return _money(total, reporting, method), details


def _statement(entity: dict[str, Any], kind: str) -> dict[str, float]:
    local = entity.get(f"{kind}_local")
    return local if isinstance(local, dict) else entity[kind]


def _liabilities(statement: dict[str, Any]) -> float | None:
    if any(statement.get(key) is None for key in _LIABILITY_KEYS):
        return None
    return sum(float(statement[key]) for key in _LIABILITY_KEYS)


def _net_assets(statement: dict[str, Any]) -> float | None:
    if statement.get("total_assets") is None:
        return None
    liabilities = _liabilities(statement)
    if liabilities is None:
        return None
    return float(statement["total_assets"]) - liabilities


def _entity_rows(
    db: Session,
    workspace_id: str,
    companies: list[UaeCompanyProfile],
    outcome_entities: list[dict[str, Any]],
    period: str,
    reporting: str,
    on: date,
) -> list[dict[str, Any]]:
    by_id = {e["entity_id"]: e for e in outcome_entities}
    rows = []
    for company in companies:
        source = by_id.get(company.id, {})
        translated = bool(source.get("translated"))
        local_pl = _statement(source, "pl") if source else {}
        local_bs = _statement(source, "bs") if source else {}
        reporting_pl = source.get("pl") if translated else {}
        reporting_bs = source.get("bs") if translated else {}
        own = _ownership_on(db, workspace_id, company.id, on)
        rate_row = None
        if company.base_currency and company.base_currency.upper() != reporting:
            rate_row = fx_rate(db, workspace_id, period, company.base_currency.upper(), reporting)
        fx_reason = None if translated else (
            f"No {period} {company.base_currency}/{reporting} rate, so reporting-currency figures are unavailable"
        )
        rows.append({
            "company_id": company.id,
            "company_name": company.company_name,
            "parent_company_id": company.parent_company_id,
            "base_currency": company.base_currency,
            "translated": translated,
            "posted_journal_count": _posted_lines(db, workspace_id, company.id, period),
            "ownership": {
                "ownership_percent": float(own.ownership_percent) if own else None,
                "owner_company_id": own.owner_company_id if own else None,
                "source": "group_entity_ownership" if own else "no_ownership_record",
                "effective_from": own.effective_from.isoformat() if own else None,
                "effective_to": own.effective_to.isoformat() if own and own.effective_to else None,
                "assumption": None if own else "Wholly owned. Minority interest is not calculated from this assumption.",
            },
            "fx": None if rate_row is None and (company.base_currency or "").upper() == reporting else {
                "fx_rate_id": rate_row.id if rate_row else None,
                "average_rate": rate_row.average_rate if rate_row else (1.0 if translated else None),
                "closing_rate": rate_row.closing_rate if rate_row else (1.0 if translated else None),
                "source": rate_row.source if rate_row else ("identity" if translated else None),
            },
            "local": _figures(local_pl, local_bs, company.base_currency, "entity currency"),
            "reporting": _figures(reporting_pl, reporting_bs, reporting, "reporting currency") if translated
            else {key: _unavailable(reporting, f"{key} in reporting currency", fx_reason or "Not translated")
                  for key in ("revenue", "gross_profit", "ebitda", "net_profit", "total_assets", "total_liabilities", "net_assets", "gl_cash")},
        })
    return rows


def _figures(pl: dict[str, Any], bs: dict[str, Any], currency: str | None, basis: str) -> dict[str, dict[str, Any]]:
    liabilities = _liabilities(bs)
    net = _net_assets(bs)
    return {
        "revenue": _money(pl.get("revenue"), currency, f"consolidation agent revenue, {basis}"),
        "gross_profit": _money(pl.get("gross_profit"), currency, f"consolidation agent gross profit, {basis}"),
        "ebitda": _money(pl.get("ebitda"), currency, f"consolidation agent EBITDA, {basis}"),
        "net_profit": _money(pl.get("net_profit"), currency, f"consolidation agent net profit, {basis}"),
        "total_assets": _money(bs.get("total_assets"), currency, f"consolidation agent total assets, {basis}"),
        "total_liabilities": _money(liabilities, currency, f"borrowings + trade payables + other current liabilities, {basis}"),
        "net_assets": _money(net, currency, f"total assets minus those liabilities, {basis}"),
        "gl_cash": _money(bs.get("cash_bank"), currency, f"consolidation agent cash_bank, {basis}"),
    }


def _nci(entities: list[dict[str, Any]], reporting: str) -> tuple[dict[str, Any], dict[str, Any]]:
    method = (
        "Sum of translated net profit, and of translated net assets, multiplied by "
        "(100 - ownership_percent) / 100. Only an ownership row below 100 percent creates minority interest."
    )
    profit = 0.0
    net_assets = 0.0
    used = False
    blocked = None
    for entity in entities:
        percent = entity["ownership"]["ownership_percent"]
        if percent is None or percent >= 100:
            continue
        used = True
        if not entity["translated"]:
            blocked = f"{entity['company_name']} is {percent}% owned and has no reporting-currency translation"
            continue
        share = (100.0 - float(percent)) / 100.0
        profit_value = entity["reporting"]["net_profit"]["value"]
        asset_value = entity["reporting"]["net_assets"]["value"]
        if profit_value is None or asset_value is None:
            blocked = f"{entity['company_name']} is missing a translated net profit or net assets figure"
            continue
        profit += float(profit_value) * share
        net_assets += float(asset_value) * share
    if not used:
        reason = "No ownership record is below 100 percent, so minority interest is not calculated"
        return _unavailable(reporting, method, reason), _unavailable(reporting, method, reason)
    if blocked:
        return _unavailable(reporting, method, blocked), _unavailable(reporting, method, blocked)
    return (
        _money(profit, reporting, method),
        _money(net_assets, reporting, method),
    )


def _group_kpis(
    complete: bool,
    output: dict[str, Any],
    reporting: str,
    bank: dict[str, Any],
    nci_profit: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    reason = "One or more selected entities have no exchange rate, so group totals are unavailable"
    if not complete:
        blank = _unavailable(reporting, _ENGINE, reason)
        return {
            "group_revenue": blank,
            "ebitda": blank,
            "net_profit": blank,
            "total_assets": blank,
            "total_liabilities": blank,
            "gl_cash": blank,
            "bank_cash": bank,
            "net_debt": _unavailable(reporting, "long_term_borrowings minus reconciled bank cash", reason),
            "working_capital": blank,
            "cash_runway": _unavailable(reporting, "not calculated", "Cash runway needs a forecast, which this phase does not calculate"),
            "nci_net_profit": nci_profit,
        }
    pl, bs = output["group_pl"], output["group_bs"]
    revenue = _row(pl, "revenue")
    ebitda = _row(pl, "ebitda")
    profit = _row(pl, "net_profit")
    assets = _row(bs, "total_assets")
    cash = _row(bs, "cash_bank")
    borrowings = _row(bs, "long_term_borrowings")
    current_assets = None
    current_liabilities = None
    asset_parts = [_row(bs, key) for key in ("inventory", "trade_receivables", "cash_bank", "other_current_assets")]
    liability_parts = [_row(bs, key) for key in ("trade_payables", "other_current_liabilities")]
    debt_parts = [_row(bs, key) for key in ("long_term_borrowings", "trade_payables", "other_current_liabilities")]
    if all(part is not None for part in asset_parts):
        current_assets = sum(asset_parts)
    if all(part is not None for part in liability_parts):
        current_liabilities = sum(liability_parts)
    total_liabilities = sum(debt_parts) if all(part is not None for part in debt_parts) else None
    working = None if current_assets is None or current_liabilities is None else current_assets - current_liabilities
    if borrowings is None or not bank["available"]:
        net_debt = _unavailable(
            reporting,
            "consolidated long_term_borrowings minus reconciled bank cash",
            None if borrowings is None else bank["reason"],
        )
        if borrowings is None:
            net_debt = _unavailable(reporting, "consolidated long_term_borrowings minus reconciled bank cash", "Borrowings were not returned by the consolidation agent")
    else:
        net_debt = _money(borrowings - bank["value"], reporting, "consolidated long_term_borrowings minus reconciled bank cash")
    return {
        "group_revenue": _money(revenue, reporting, f"{_ENGINE} group_pl.revenue.consolidated, after IC- eliminations"),
        "ebitda": _money(ebitda, reporting, f"{_ENGINE} group_pl.ebitda.consolidated, after IC- eliminations"),
        "net_profit": _money(profit, reporting, f"{_ENGINE} group_pl.net_profit.consolidated, after IC- eliminations"),
        "total_assets": _money(assets, reporting, f"{_ENGINE} group_bs.total_assets.consolidated"),
        "total_liabilities": _money(total_liabilities, reporting, "long_term_borrowings + trade_payables + other_current_liabilities, after eliminations"),
        "gl_cash": _money(cash, reporting, f"{_ENGINE} group_bs.cash_bank.consolidated. This is ledger cash, not the bank balance"),
        "bank_cash": bank,
        "net_debt": net_debt,
        "working_capital": _money(working, reporting, "current assets (inventory, receivables, GL cash, other) minus trade payables and other current liabilities"),
        "cash_runway": _unavailable(reporting, "not calculated", "Cash runway needs a forecast, which this phase does not calculate"),
        "nci_net_profit": nci_profit,
    }


def _matches(
    db: Session,
    workspace_id: str,
    company_ids: list[str],
    eliminations: list[dict[str, Any]],
    name_to_ids: dict[str, list[str]],
) -> list[dict[str, Any]]:
    out = []
    for row in eliminations:
        def _id_for(name: str | None) -> str | None:
            ids = name_to_ids.get(name or "")
            return ids[0] if ids and len(ids) == 1 else None

        reference = row.get("reference") or ""
        journals = (
            db.query(UAEJournalEntry)
            .filter(
                UAEJournalEntry.tenant_id == workspace_id,
                UAEJournalEntry.company_id.in_(company_ids),
                UAEJournalEntry.status == "posted",
                UAEJournalEntry.reference == reference,
            )
            .all()
            if reference and company_ids else []
        )
        out.append({
            "reference": reference,
            "seller_company_id": _id_for(row.get("seller")),
            "buyer_company_id": _id_for(row.get("buyer")),
            "seller_name": row.get("seller"),
            "buyer_name": row.get("buyer"),
            "seller_amount": row.get("seller_revenue"),
            "buyer_amount": row.get("buyer_expense"),
            "eliminated_amount": row.get("eliminated"),
            "difference": row.get("difference"),
            "status": row.get("status"),
            "source_refs": [
                {"journal_entry_id": journal.id, "company_id": journal.company_id, "period": journal.period}
                for journal in journals
            ],
            "methodology": _IC_METHOD,
        })
    return out


def _revenue_bridge(entities: list[dict[str, Any]], kpis: dict[str, Any], matches: list[dict[str, Any]], reporting: str, complete: bool) -> dict[str, Any]:
    method = "Entity reporting-currency revenue, minus IC- eliminations, equals consolidated group revenue."
    if not complete or not kpis["group_revenue"]["available"]:
        return {"revenue": _unavailable(reporting, method, "Group revenue is unavailable, so the bridge is not closed"), "reconciled": False}
    values = [entity["reporting"]["revenue"]["value"] for entity in entities]
    if any(value is None for value in values):
        return {"revenue": _unavailable(reporting, method, "An entity reporting-currency revenue figure is missing"), "reconciled": False}
    entity_sum = round(sum(float(value) for value in values), 2)
    eliminated = round(sum(float(match.get("eliminated_amount") or 0) for match in matches), 2)
    group = round(float(kpis["group_revenue"]["value"]), 2)
    difference = round(entity_sum - eliminated - group, 2)
    return {
        "revenue": {
            "entity_reporting_sum": entity_sum,
            "eliminations": eliminated,
            "group_consolidated": group,
            "difference": difference,
            "currency": reporting,
            "method": method,
        },
        "reconciled": abs(difference) < 0.05,
    }


def _health(entity: dict[str, Any], matches: list[dict[str, Any]], banks: list[dict[str, Any]], prior: dict[str, Any] | None) -> dict[str, Any]:
    """Transparent rules. Incomplete outranks Watch. There is no model score."""
    if not entity["translated"]:
        return {"status": "Incomplete", "rules": ["Reporting-currency figures are unavailable until an exchange rate is recorded."]}
    rules: list[str] = []
    gl = entity["reporting"]["gl_cash"]["value"]
    if gl is not None and gl < 0:
        rules.append("GL cash in the reporting currency is negative.")
    own_banks = [row for row in banks if row.get("company_id") == entity["company_id"]]
    if any(row.get("last_reconciled_balance") is None for row in own_banks):
        rules.append("A bank account has no reconciled balance.")
    elif own_banks and all(row.get("reporting_amount") is not None for row in own_banks):
        if sum(float(row["reporting_amount"]) for row in own_banks) < 0:
            rules.append("Reconciled bank cash in the reporting currency is negative.")
    for match in matches:
        if match.get("status") == "matched":
            continue
        if entity["company_id"] in (match.get("seller_company_id"), match.get("buyer_company_id")):
            rules.append(f"Intercompany reference {match.get('reference')} is {match.get('status')}.")
    current = entity["reporting"]["ebitda"]["value"] if entity["reporting"]["ebitda"]["available"] else None
    previous = None
    if prior and prior["reporting"]["ebitda"]["available"]:
        previous = prior["reporting"]["ebitda"]["value"]
    if previous is not None and previous > 0 and current is not None and current < previous * 0.9:
        rules.append("EBITDA is more than 10 percent below the previous month.")
    if not rules:
        rules.append("Translated figures are available, cash is not negative, and no intercompany mismatch is open.")
    return {"status": "Watch" if len(rules) > 1 or not rules[0].startswith("Translated") else "Healthy", "rules": rules}


def _alerts(position: dict[str, Any], prior: dict[str, Any] | None) -> list[dict[str, Any]]:
    alerts: list[dict[str, Any]] = []
    for entity in position["entities"]:
        if not entity["translated"]:
            alerts.append({
                "severity": "high",
                "title": f"{entity['company_name']} has no exchange rate",
                "detail": entity["reporting"]["revenue"]["reason"],
                "href": "/ai-cfo/executive-summary",
                "source": "ai_close_fx_rates",
            })
        if entity["health"]["status"] == "Watch":
            for rule in entity["health"]["rules"]:
                if "bank" in rule.lower():
                    alerts.append({
                        "severity": "high",
                        "title": f"{entity['company_name']}: {rule}",
                        "detail": "Bank cash is the reconciled balance, separate from GL cash.",
                        "href": "/uae-full/bank-recon",
                        "source": "uae_bank_accounts",
                    })
                elif rule.startswith("Intercompany"):
                    alerts.append({
                        "severity": "medium",
                        "title": f"{entity['company_name']}: {rule}",
                        "detail": "The consolidation agent left this reference unmatched.",
                        "href": "/consolidation",
                        "source": "group_intercompany_matches",
                    })
                elif rule.startswith("EBITDA"):
                    alerts.append({
                        "severity": "medium",
                        "title": f"{entity['company_name']}: {rule}",
                        "detail": "Compared with the previous month in the reporting currency.",
                        "href": "/cfo/group/entities",
                        "source": "group_financial_position",
                    })
                elif "GL cash" in rule:
                    alerts.append({
                        "severity": "high",
                        "title": f"{entity['company_name']}: {rule}",
                        "detail": "GL cash comes from the consolidated cash_bank line.",
                        "href": "/cfo/group/entities",
                        "source": "uae_journal_entries",
                    })
    if prior and position["kpis"]["ebitda"]["available"] and prior["kpis"]["ebitda"]["available"]:
        old, new = prior["kpis"]["ebitda"]["value"], position["kpis"]["ebitda"]["value"]
        if old and old > 0 and new is not None and new < old * 0.9:
            alerts.append({
                "severity": "medium",
                "title": "Group EBITDA is more than 10 percent below the previous month",
                "detail": f"Previous {old} {position['reporting_currency']}, current {new} {position['reporting_currency']}.",
                "href": "/cfo/group",
                "source": "consolidation_agent",
            })
    if position["status"] == "partial":
        alerts.append({
            "severity": "high",
            "title": "Group totals are withheld",
            "detail": "At least one selected entity could not be translated, so consolidated KPIs are unavailable.",
            "href": "/ai-cfo/executive-summary",
            "source": "ai_close_fx_rates",
        })
    return alerts


def _insights(position: dict[str, Any], prior: dict[str, Any] | None) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    missing = [entity["company_name"] for entity in position["entities"] if not entity["translated"]]
    if missing:
        items.append({
            "title": "Exchange rates are missing",
            "detail": f"{', '.join(missing)} cannot be included in group totals.",
            "figures": [{"label": "Group revenue", **position["kpis"]["group_revenue"]}],
            "action": "Enter the average and closing rates for the reporting period.",
            "href": "/ai-cfo/executive-summary",
        })
    open_matches = [match for match in position["intercompany"] if match.get("status") != "matched"]
    if open_matches:
        items.append({
            "title": "Intercompany references are unresolved",
            "detail": f"{len(open_matches)} reference(s) are not matched.",
            "figures": [{"label": match["reference"], "value": match.get("difference"), "currency": position["reporting_currency"], "available": True, "reason": None, "method": match.get("methodology")} for match in open_matches[:3]],
            "action": "Open the consolidation screen and clear the unmatched references.",
            "href": "/consolidation",
        })
    if prior and position["kpis"]["ebitda"]["available"] and prior["kpis"]["ebitda"]["available"]:
        old, new = prior["kpis"]["ebitda"]["value"], position["kpis"]["ebitda"]["value"]
        if old and old > 0 and new is not None and new < old * 0.9:
            items.append({
                "title": "Group EBITDA declined",
                "detail": "Current EBITDA is more than 10 percent below the previous month.",
                "figures": [
                    {"label": "Previous EBITDA", **prior["kpis"]["ebitda"]},
                    {"label": "Current EBITDA", **position["kpis"]["ebitda"]},
                ],
                "action": "Compare entity EBITDA on the entity performance screen.",
                "href": "/cfo/group/entities",
            })
    if not position["kpis"]["bank_cash"]["available"]:
        items.append({
            "title": "Reconciled bank cash is unavailable",
            "detail": position["kpis"]["bank_cash"]["reason"],
            "figures": [{"label": "GL cash", **position["kpis"]["gl_cash"]}, {"label": "Bank cash", **position["kpis"]["bank_cash"]}],
            "action": "Reconcile the bank accounts. GL cash is not a substitute.",
            "href": "/uae-full/bank-recon",
        })
    return items[:3]


def build_position(
    db: Session,
    workspace_id: str,
    period: str,
    reporting_currency: str | None = None,
    company_ids: list[str] | None = None,
    include_prior: bool = True,
) -> dict[str, Any]:
    """Calculate a group position. Does not write."""
    on = _period_end(period)
    selected = _active(_companies(db, workspace_id), company_ids)
    ids = [c.id for c in selected]
    if reporting_currency:
        reporting = _currency(reporting_currency)
    else:
        currencies = {(c.base_currency or "").upper() for c in selected}
        if len(currencies) == 1 and "" not in currencies:
            reporting = next(iter(currencies))
        elif not selected:
            reporting = ""
        else:
            raise GroupIntelligenceError("reporting_currency is required when the selected entities do not share one base currency")

    manual = _manual_eliminations(db, workspace_id, period) if ids else []
    if not selected:
        def empty() -> dict[str, Any]:
            return _unavailable(reporting or None, _ENGINE, "No active entities in this workspace")

        return {
            "workspace_id": workspace_id,
            "period": period,
            "reporting_currency": reporting or None,
            "company_ids": [],
            "status": "unavailable",
            "kpis": {key: empty() for key in (
                "group_revenue", "ebitda", "net_profit", "total_assets", "total_liabilities",
                "gl_cash", "bank_cash", "net_debt", "working_capital", "cash_runway",
                "nci_net_profit", "nci_net_assets",
            )},
            "entities": [],
            "intercompany": [],
            "bank_accounts": [],
            "limitations": ["No active entities in this workspace."],
            "bridge": {
                "revenue": {
                    "entity_reporting_sum": None,
                    "eliminations": None,
                    "group_consolidated": None,
                    "difference": None,
                    "currency": reporting or None,
                    "method": "No active entities, so the consolidation bridge is not closed.",
                },
                "reconciled": False,
            },
            "alerts": [],
            "insights": [],
            "methodology": {
                "engines": [_ENGINE],
                "fx_table": "ai_close_fx_rates",
                "manual_eliminations": manual,
                "notes": ["Group totals are not calculated without an active entity."],
            },
            "snapshot_id": None,
        }

    outcome = consolidation(CloseContext(
        db=db,
        workspace_id=workspace_id,
        company_id=ids[0],
        period=period,
        run_id=0,
        currency=reporting,
        entities=[Entity(c.id, c.company_name, (c.base_currency or "").upper() or reporting) for c in selected],
        scope_kind="group",
    ))
    output = outcome.output
    excluded = [e for e in output["entities"] if not e.get("translated")]
    complete = not excluded
    entity_rows = _entity_rows(db, workspace_id, selected, output["entities"], period, reporting, on)
    bank, bank_rows = _bank_cash(db, workspace_id, selected, period, reporting)
    nci_profit, nci_assets = _nci(entity_rows, reporting)
    kpis = _group_kpis(complete, output, reporting, bank, nci_profit)
    kpis["nci_net_assets"] = nci_assets
    names: dict[str, list[str]] = {}
    for company in selected:
        names.setdefault(company.company_name, []).append(company.id)
    limitations = list(output.get("limitations") or [])
    if manual:
        limitations.append("Manual elimination rows exist for this period and are not included in these KPIs.")
    if any(not row["translated"] for row in entity_rows):
        limitations.append("Group totals are unavailable until every selected entity has an exchange rate.")
    intercompany = _matches(db, workspace_id, ids, output.get("eliminations") or [], names)
    rates = []
    for row in entity_rows:
        currency = (row["base_currency"] or "").upper()
        fx = row.get("fx") or {}
        if fx.get("fx_rate_id") or fx.get("average_rate") is not None:
            rates.append({"company_id": row["company_id"], "currency": currency, **fx})
        elif currency == reporting:
            rates.append({
                "company_id": row["company_id"],
                "currency": currency,
                "fx_rate_id": None,
                "average_rate": 1.0,
                "closing_rate": 1.0,
                "source": "identity",
            })
    prior = None
    if include_prior and ids:
        prior = build_position(
            db, workspace_id, period_add(period, -1), reporting, ids, include_prior=False,
        )
    prior_entities = {entity["company_id"]: entity for entity in (prior or {}).get("entities", [])}
    for row in entity_rows:
        row["health"] = _health(row, intercompany, bank_rows, prior_entities.get(row["company_id"]))
    position = {
        "workspace_id": workspace_id,
        "period": period,
        "reporting_currency": reporting,
        "company_ids": ids,
        "status": "complete" if complete else "partial",
        "kpis": kpis,
        "entities": entity_rows,
        "intercompany": intercompany,
        "bank_accounts": bank_rows,
        "limitations": limitations,
        "methodology": {
            "engines": [_ENGINE],
            "fx_table": "ai_close_fx_rates",
            "fx_policy": "Income and expenses at the average rate. Assets and liabilities at the closing rate. Identity rate when the entity currency is the reporting currency.",
            "eliminations": _IC_METHOD,
            "nci_policy": "Minority interest is calculated only from an ownership row below 100 percent. A missing row is not treated as a calculated NCI of zero.",
            "cash_policy": "gl_cash is translated ledger cash_bank. bank_cash is the reconciled bank balance translated at the closing rate. Neither replaces the other.",
            "rates": rates,
            "checks": [{"name": c.name, "passed": c.passed, "detail": c.detail} for c in outcome.checks],
            "manual_eliminations": manual,
            "agent_messages": outcome.messages,
            "calculated_at": datetime.utcnow().isoformat() + "Z",
        },
        "bridge": _revenue_bridge(entity_rows, kpis, intercompany, reporting, complete),
        "snapshot_id": None,
    }
    position["methodology"]["bridge"] = position["bridge"]
    position["alerts"] = _alerts(position, prior)
    position["insights"] = _insights(position, prior)
    return position


def build_series(
    db: Session,
    workspace_id: str,
    start: str,
    end: str,
    reporting_currency: str | None = None,
    company_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Monthly group actuals. Does not store snapshots and does not read a forecast."""
    _period_end(start)
    _period_end(end)
    if start > end:
        raise GroupIntelligenceError("The series start is after the end")
    periods: list[str] = []
    cursor = start
    while cursor <= end:
        periods.append(cursor)
        cursor = period_add(cursor, 1)
        if len(periods) > 18:
            raise GroupIntelligenceError("A series can cover at most 18 months")
    points = []
    reporting = reporting_currency
    for period in periods:
        position = build_position(db, workspace_id, period, reporting, company_ids, include_prior=False)
        reporting = position["reporting_currency"]
        revenue = position["kpis"]["group_revenue"]
        profit = position["kpis"]["net_profit"]
        if revenue["available"] and profit["available"] and revenue["value"]:
            margin = {
                "value": round(float(profit["value"]) / float(revenue["value"]) * 100, 2),
                "available": True,
                "reason": None,
                "method": "Consolidated net profit divided by consolidated revenue, in the reporting currency.",
            }
        else:
            margin = {
                "value": None,
                "available": False,
                "reason": "Margin needs both consolidated revenue and net profit.",
                "method": "Consolidated net profit divided by consolidated revenue, in the reporting currency.",
            }
        points.append({
            "period": period,
            "status": position["status"],
            "reporting_currency": reporting,
            "revenue": revenue,
            "ebitda": position["kpis"]["ebitda"],
            "net_profit": profit,
            "margin_pct": margin,
            "budget": _unavailable(
                reporting,
                "FP&A budget versus actual",
                "Budgets are stored against AP companies and are not mapped to these legal entities, so budget versus actual is unavailable.",
            ),
        })
    return {
        "workspace_id": workspace_id,
        "start": start,
        "end": end,
        "reporting_currency": reporting,
        "currency_basis": "group reporting currency",
        "actuals_only": True,
        "points": points,
    }


def persist_snapshot(db: Session, position: dict[str, Any], user_email: str | None) -> dict[str, Any]:
    """Store the position, its intercompany matches and an audit row."""
    if position["status"] == "unavailable" and not position["company_ids"]:
        raise GroupIntelligenceError("Nothing to snapshot: the workspace has no active entities")
    ids = list(position["company_ids"])
    snapshot = GroupFinancialSnapshot(
        workspace_id=position["workspace_id"],
        period=position["period"],
        reporting_currency=position["reporting_currency"],
        company_set_key=_set_key(ids),
        company_ids=ids,
        status=position["status"],
        kpis=position["kpis"],
        methodology=position["methodology"],
        limitations=position["limitations"],
        created_by=user_email,
    )
    db.add(snapshot)
    db.flush()
    for match in position["intercompany"]:
        db.add(GroupIntercompanyMatch(
            workspace_id=position["workspace_id"],
            snapshot_id=snapshot.id,
            period=position["period"],
            reporting_currency=position["reporting_currency"],
            reference=match["reference"],
            seller_company_id=match["seller_company_id"],
            buyer_company_id=match["buyer_company_id"],
            seller_name=match["seller_name"],
            buyer_name=match["buyer_name"],
            seller_amount=_dec(match["seller_amount"]),
            buyer_amount=_dec(match["buyer_amount"]),
            eliminated_amount=_dec(match["eliminated_amount"]),
            difference=_dec(match["difference"]),
            status=match["status"] or "unknown",
            source_refs=match["source_refs"],
            methodology=match["methodology"],
        ))
    log_audit(
        db,
        workspace_id=position["workspace_id"],
        company_id=None,
        action="group_snapshot_created",
        entity_type="group_financial_snapshot",
        entity_id=snapshot.id,
        user_email=user_email,
        details={
            "period": position["period"],
            "reporting_currency": position["reporting_currency"],
            "company_ids": ids,
            "status": position["status"],
            "kpi_availability": {key: value.get("available") for key, value in position["kpis"].items()},
        },
    )
    db.commit()
    db.refresh(snapshot)
    return {**position, "snapshot_id": snapshot.id}


def _dec(value: Any) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(round(float(value), 2)))


def list_entities(db: Session, workspace_id: str) -> list[dict[str, Any]]:
    return [
        {
            "company_id": c.id,
            "company_name": c.company_name,
            "base_currency": c.base_currency,
            "status": c.status,
            "parent_company_id": c.parent_company_id,
        }
        for c in _companies(db, workspace_id)
    ]


def set_parent(db: Session, workspace_id: str, company_id: str, parent_company_id: str | None, user_email: str | None) -> dict[str, Any]:
    company = db.get(UaeCompanyProfile, company_id)
    if company is None or company.workspace_id != workspace_id:
        raise GroupIntelligenceError("Company is not in this workspace")
    if parent_company_id:
        if parent_company_id == company_id:
            raise GroupIntelligenceError("A company cannot be its own parent")
        parent = db.get(UaeCompanyProfile, parent_company_id)
        if parent is None or parent.workspace_id != workspace_id:
            raise GroupIntelligenceError("Parent company is not in this workspace")
        cursor = parent
        seen = {company_id}
        while cursor is not None:
            if cursor.id in seen:
                raise GroupIntelligenceError("That parent would create an ownership cycle")
            seen.add(cursor.id)
            cursor = db.get(UaeCompanyProfile, cursor.parent_company_id) if cursor.parent_company_id else None
    company.parent_company_id = parent_company_id
    log_audit(
        db,
        workspace_id=workspace_id,
        company_id=company_id,
        action="group_parent_set",
        entity_type="uae_company_profile",
        entity_id=company_id,
        user_email=user_email,
        details={"parent_company_id": parent_company_id},
    )
    db.commit()
    return {"company_id": company.id, "parent_company_id": company.parent_company_id}


def record_ownership(
    db: Session,
    workspace_id: str,
    company_id: str,
    ownership_percent: float,
    effective_from: date,
    effective_to: date | None,
    owner_company_id: str | None,
    user_email: str | None,
) -> dict[str, Any]:
    if ownership_percent < 0 or ownership_percent > 100:
        raise GroupIntelligenceError("ownership_percent must be from 0 to 100")
    if effective_to is not None and effective_to < effective_from:
        raise GroupIntelligenceError("effective_to is before effective_from")
    company = db.get(UaeCompanyProfile, company_id)
    if company is None or company.workspace_id != workspace_id:
        raise GroupIntelligenceError("Company is not in this workspace")
    if owner_company_id:
        if owner_company_id == company_id:
            raise GroupIntelligenceError("A company cannot own itself")
        owner = db.get(UaeCompanyProfile, owner_company_id)
        if owner is None or owner.workspace_id != workspace_id:
            raise GroupIntelligenceError("Owner company is not in this workspace")
    existing = db.query(GroupEntityOwnership).filter_by(workspace_id=workspace_id, company_id=company_id).all()
    for row in existing:
        row_end = row.effective_to or date.max
        new_end = effective_to or date.max
        if effective_from <= row_end and row.effective_from <= new_end:
            raise GroupIntelligenceError("Ownership dates overlap an existing record for this company")
    row = GroupEntityOwnership(
        workspace_id=workspace_id,
        company_id=company_id,
        owner_company_id=owner_company_id,
        ownership_percent=Decimal(str(ownership_percent)),
        effective_from=effective_from,
        effective_to=effective_to,
        created_by=user_email,
    )
    db.add(row)
    db.flush()
    log_audit(
        db,
        workspace_id=workspace_id,
        company_id=company_id,
        action="group_ownership_recorded",
        entity_type="group_entity_ownership",
        entity_id=row.id,
        user_email=user_email,
        details={
            "ownership_percent": ownership_percent,
            "effective_from": effective_from.isoformat(),
            "effective_to": effective_to.isoformat() if effective_to else None,
            "owner_company_id": owner_company_id,
        },
    )
    db.commit()
    db.refresh(row)
    return _ownership_dict(row)


def list_ownership(db: Session, workspace_id: str) -> list[dict[str, Any]]:
    rows = (
        db.query(GroupEntityOwnership)
        .filter_by(workspace_id=workspace_id)
        .order_by(GroupEntityOwnership.company_id, GroupEntityOwnership.effective_from)
        .all()
    )
    return [_ownership_dict(row) for row in rows]


def _ownership_dict(row: GroupEntityOwnership) -> dict[str, Any]:
    return {
        "id": row.id,
        "workspace_id": row.workspace_id,
        "company_id": row.company_id,
        "owner_company_id": row.owner_company_id,
        "ownership_percent": float(row.ownership_percent),
        "effective_from": row.effective_from.isoformat(),
        "effective_to": row.effective_to.isoformat() if row.effective_to else None,
    }


def list_snapshots(db: Session, workspace_id: str, period: str | None = None) -> list[dict[str, Any]]:
    query = db.query(GroupFinancialSnapshot).filter_by(workspace_id=workspace_id)
    if period:
        _period_end(period)
        query = query.filter_by(period=period)
    rows = query.order_by(GroupFinancialSnapshot.created_at.desc()).limit(50).all()
    return [_snapshot_dict(row) for row in rows]


def get_snapshot(db: Session, workspace_id: str, snapshot_id: str) -> dict[str, Any]:
    row = db.get(GroupFinancialSnapshot, snapshot_id)
    if row is None or row.workspace_id != workspace_id:
        raise GroupIntelligenceError("Snapshot not found")
    return _snapshot_dict(row)


def list_matches(db: Session, workspace_id: str, snapshot_id: str) -> list[dict[str, Any]]:
    snapshot = db.get(GroupFinancialSnapshot, snapshot_id)
    if snapshot is None or snapshot.workspace_id != workspace_id:
        raise GroupIntelligenceError("Snapshot not found")
    rows = (
        db.query(GroupIntercompanyMatch)
        .filter_by(workspace_id=workspace_id, snapshot_id=snapshot_id)
        .order_by(GroupIntercompanyMatch.reference)
        .all()
    )
    return [
        {
            "id": row.id,
            "snapshot_id": row.snapshot_id,
            "period": row.period,
            "reporting_currency": row.reporting_currency,
            "reference": row.reference,
            "seller_company_id": row.seller_company_id,
            "buyer_company_id": row.buyer_company_id,
            "seller_name": row.seller_name,
            "buyer_name": row.buyer_name,
            "seller_amount": float(row.seller_amount) if row.seller_amount is not None else None,
            "buyer_amount": float(row.buyer_amount) if row.buyer_amount is not None else None,
            "eliminated_amount": float(row.eliminated_amount) if row.eliminated_amount is not None else None,
            "difference": float(row.difference) if row.difference is not None else None,
            "status": row.status,
            "source_refs": row.source_refs or [],
            "methodology": row.methodology,
        }
        for row in rows
    ]


def _snapshot_dict(row: GroupFinancialSnapshot) -> dict[str, Any]:
    return {
        "snapshot_id": row.id,
        "workspace_id": row.workspace_id,
        "period": row.period,
        "reporting_currency": row.reporting_currency,
        "company_ids": row.company_ids,
        "status": row.status,
        "kpis": row.kpis,
        "methodology": row.methodology,
        "limitations": row.limitations or [],
        "created_by": row.created_by,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }
