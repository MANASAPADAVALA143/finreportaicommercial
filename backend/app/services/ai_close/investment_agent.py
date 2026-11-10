"""Investment Agent: month-end review of the company's investment portfolio.

From the recorded holdings and month-end valuations it computes allocation, month returns,
fair-value movements by IFRS 9 category, concentration against limits, currency exposure,
maturities and stale prices. It ties the portfolio to the investments account in the ledger and,
when exactly the month's fair-value movement is unrecorded, drafts the fair-value journals
(FVTPL through profit or loss, FVOCI through the fair value reserve). Nothing posts without approval.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import timedelta
from typing import Any

from app.models.investments import InvestmentHolding, InvestmentValuation
from app.services.ai_cfo import ledger
from app.services.ai_close.context import AgentOutcome, Check, CloseContext, ExceptionItem, JournalDraft, money, severity

INVESTMENTS = ("2040", "Investments")
FV_PROFIT_LOSS = ("6030", "Fair Value Gains/(Losses) on Investments")
FV_RESERVE = ("5030", "Fair Value Reserve (FVOCI)")
ISSUER_LIMIT = 0.25
ASSET_CLASS_LIMIT = 0.60
FOREIGN_CURRENCY_LIMIT = 0.30
DROP_ALERT = -0.10
MATURITY_WINDOW_DAYS = 30
FAIR_VALUE = ("fvtpl", "fvoci")


def _pct(part: float, whole: float) -> float:
    return round(part / whole * 100, 1) if whole else 0.0


def investment(ctx: CloseContext) -> AgentOutcome:
    db = ctx.db
    holdings = db.query(InvestmentHolding).filter(
        InvestmentHolding.workspace_id == ctx.workspace_id, InvestmentHolding.company_id == ctx.company_id).all()
    holdings = [h for h in holdings if not h.acquired_on or h.acquired_on <= ctx.end]
    holdings = [h for h in holdings if not h.maturity_date or h.maturity_date >= ctx.start]
    if not holdings:
        return AgentOutcome(
            records_processed=0,
            output={"applicable": False, "holdings_count": 0, "portfolio_value": 0.0,
                    "limitations": ["No investment holdings are recorded for this company."]},
            checks=[Check("portfolio_reviewed", True, "No investment portfolio for this company.")],
            messages=["No investment holdings recorded; nothing to review."],
        )

    valuations: dict[int, list[InvestmentValuation]] = defaultdict(list)
    for v in db.query(InvestmentValuation).filter(
            InvestmentValuation.holding_id.in_([h.id for h in holdings]), InvestmentValuation.as_of <= ctx.end
    ).order_by(InvestmentValuation.as_of):
        valuations[v.holding_id].append(v)

    exceptions: list[ExceptionItem] = []
    rows: list[dict[str, Any]] = []
    for h in holdings:
        vals = valuations.get(h.id, [])
        current = next((v for v in reversed(vals) if ctx.start <= v.as_of <= ctx.end), None)
        prior = next((v for v in reversed(vals) if v.as_of < ctx.start), None)
        acquired_in_period = bool(h.acquired_on and ctx.start <= h.acquired_on <= ctx.end)
        start_value = money(h.cost) if acquired_in_period or prior is None else money(prior.market_value)
        stale = current is None
        end_value = money(current.market_value) if current else start_value
        income = money(current.income) if current else 0.0
        movement = round(end_value - start_value, 2)
        ret = round((movement + income) / start_value * 100, 2) if start_value else None
        ref = {"type": "investment", "id": h.id, "ref": h.code, "description": h.name, "amount": end_value}
        rows.append({
            "code": h.code, "name": h.name, "asset_class": h.asset_class, "ifrs9_category": h.ifrs9_category,
            "issuer": h.issuer or h.name, "currency": h.currency, "cost": money(h.cost), "start_value": start_value,
            "market_value": end_value, "movement": movement, "income": income, "return_pct": ret,
            "unrealised": round(end_value - money(h.cost), 2), "maturity_date": str(h.maturity_date) if h.maturity_date else None,
            "price_date": str(current.as_of) if current else None, "stale_price": stale,
            "fair_value_movement": movement if h.ifrs9_category in FAIR_VALUE and (prior or acquired_in_period) else 0.0,
        })
        if stale:
            exceptions.append(ExceptionItem(
                f"invest_stale:{h.id}:{ctx.period}", "stale_price", "medium",
                f"No {ctx.period} valuation for {h.name}",
                f"The last price is {'from ' + str(prior.as_of) if prior else 'missing'}; the holding is shown at that value.",
                end_value, [ref]))
        if ret is not None and ret / 100 <= DROP_ALERT:
            exceptions.append(ExceptionItem(
                f"invest_drop:{h.id}:{ctx.period}", "valuation_drop", severity(movement),
                f"{h.name} fell {abs(ret):.1f}% in {ctx.period} ({movement:,.2f})",
                f"Value {start_value:,.2f} → {end_value:,.2f}. Review whether the position still fits the investment policy.",
                movement, [ref]))
        if h.maturity_date and ctx.end < h.maturity_date <= ctx.end + timedelta(days=MATURITY_WINDOW_DAYS):
            exceptions.append(ExceptionItem(
                f"invest_maturity:{h.id}", "investment_maturity", "low",
                f"{h.name} matures on {h.maturity_date} ({end_value:,.2f})",
                "Decide on reinvestment or cash use before maturity.", end_value, [ref]))

    total = round(sum(r["market_value"] for r in rows), 2)
    cost = round(sum(r["cost"] for r in rows), 2)

    def grouped(key: str) -> list[dict[str, Any]]:
        out: dict[str, float] = defaultdict(float)
        for r in rows:
            out[r[key]] += r["market_value"]
        return sorted(({key: k, "market_value": round(v, 2), "pct": _pct(v, total)} for k, v in out.items()),
                      key=lambda x: -x["market_value"])

    allocation, issuers, currencies = grouped("asset_class"), grouped("issuer"), grouped("currency")
    for i in issuers:
        if i["pct"] > ISSUER_LIMIT * 100:
            exceptions.append(ExceptionItem(
                f"invest_concentration:issuer:{i['issuer']}:{ctx.period}", "concentration_risk",
                "high" if i["pct"] > ISSUER_LIMIT * 150 else "medium",
                f"{i['issuer']} is {i['pct']}% of the portfolio (limit {ISSUER_LIMIT * 100:.0f}%)",
                "Single-issuer exposure above the policy limit.", i["market_value"]))
    for a in allocation:
        if a["pct"] > ASSET_CLASS_LIMIT * 100:
            exceptions.append(ExceptionItem(
                f"invest_concentration:class:{a['asset_class']}:{ctx.period}", "concentration_risk", "medium",
                f"{a['asset_class'].capitalize()} is {a['pct']}% of the portfolio (limit {ASSET_CLASS_LIMIT * 100:.0f}%)",
                "Asset-class exposure above the policy limit.", a["market_value"]))
    foreign = sum(c["market_value"] for c in currencies if c["currency"] != ctx.currency)
    if _pct(foreign, total) > FOREIGN_CURRENCY_LIMIT * 100:
        exceptions.append(ExceptionItem(
            f"invest_concentration:currency:{ctx.period}", "concentration_risk", "medium",
            f"Foreign-currency investments are {_pct(foreign, total)}% of the portfolio (limit {FOREIGN_CURRENCY_LIMIT * 100:.0f}%)",
            "Currency exposure above the policy limit.", round(foreign, 2)))

    by_category = {c: round(sum(r["fair_value_movement"] for r in rows if r["ifrs9_category"] == c), 2) for c in FAIR_VALUE}
    expected_book = round(sum(r["market_value"] for r in rows if r["ifrs9_category"] in FAIR_VALUE)
                          + sum(r["cost"] for r in rows if r["ifrs9_category"] not in FAIR_VALUE), 2)
    book = round(sum(b["balance"] for b in ledger.balances_as_of(db, ctx.scope, ctx.period)
                     if b["account_code"] == INVESTMENTS[0]), 2)
    difference = round(expected_book - book, 2)
    unrecorded = round(by_category["fvtpl"] + by_category["fvoci"], 2)
    journals: list[JournalDraft] = []
    if abs(difference) >= 1 and abs(difference - unrecorded) < 1:
        for category, target in (("fvtpl", FV_PROFIT_LOSS), ("fvoci", FV_RESERVE)):
            amount = by_category[category]
            if abs(amount) < 1:
                continue
            gain = amount > 0
            names = ", ".join(r["name"] for r in rows if r["ifrs9_category"] == category and abs(r["fair_value_movement"]) >= 1)
            lines = [{"account_code": INVESTMENTS[0], "account_name": INVESTMENTS[1], "debit": abs(amount) if gain else 0,
                      "credit": 0 if gain else abs(amount)},
                     {"account_code": target[0], "account_name": target[1], "debit": 0 if gain else abs(amount),
                      "credit": abs(amount) if gain else 0}]
            journals.append(JournalDraft(
                f"invest_fv:{category}:{ctx.period}",
                f"Record {ctx.period} fair value {'gain' if gain else 'loss'} on {category.upper()} investments {abs(amount):,.2f}",
                f"Month-end valuations moved {category.upper()} holdings by {amount:,.2f} ({names}). Under IFRS 9 "
                + ("fair value changes on FVTPL assets go to profit or loss (IFRS 9.5.7.1)." if category == "fvtpl"
                   else "fair value changes on FVOCI equity instruments go to other comprehensive income (IFRS 9.5.7.5)."),
                ctx.end, lines,
                [{"type": "investment", "ref": r["code"], "description": r["name"], "amount": r["fair_value_movement"]}
                 for r in rows if r["ifrs9_category"] == category and abs(r["fair_value_movement"]) >= 1],
            ))
        exceptions.append(ExceptionItem(
            f"invest_fv:unrecorded:{ctx.period}", "fair_value_unrecorded", severity(unrecorded),
            f"{ctx.period} fair value movement of {unrecorded:,.2f} not yet recorded",
            "The investments ledger equals last month's valuation; fair value journals proposed.", unrecorded))
    elif abs(difference) >= 1:
        exceptions.append(ExceptionItem(
            f"invest_ledger:{ctx.period}", "investment_ledger_difference", severity(difference),
            f"Investments ledger ({INVESTMENTS[0]}) differs from the portfolio by {difference:,.2f}",
            f"Portfolio carrying value {expected_book:,.2f} vs ledger {book:,.2f}; more than the month's fair value movement — reconcile holdings.",
            difference))

    month_income = round(sum(r["income"] for r in rows), 2)
    start_total = round(sum(r["start_value"] for r in rows), 2)
    month_return = round((total - start_total + month_income) / start_total * 100, 2) if start_total else None
    maturities = sorted(({"name": r["name"], "maturity_date": r["maturity_date"], "market_value": r["market_value"]}
                         for r in rows if r["maturity_date"]), key=lambda x: x["maturity_date"])
    checks = [
        Check("allocation_ties", abs(sum(a["market_value"] for a in allocation) - total) < 0.05,
              f"Asset-class allocation {total:,.2f} equals the portfolio value.", blocking=True),
        Check("all_holdings_valued", not any(r["stale_price"] for r in rows), "Every holding has a period-end valuation."),
        Check("ledger_agrees", abs(difference) < 1 or abs(difference - unrecorded) < 1,
              f"Ledger {book:,.2f} vs portfolio {expected_book:,.2f}" + (" (difference is the unrecorded month movement)." if abs(difference) >= 1 else ".")),
    ]
    return AgentOutcome(
        records_processed=len(rows) + sum(len(v) for v in valuations.values()),
        output={
            "applicable": True, "holdings_count": len(rows), "portfolio_value": total, "cost": cost,
            "unrealised": round(total - cost, 2), "month_movement": round(total - start_total, 2), "month_income": month_income,
            "month_return_pct": month_return, "holdings": rows, "allocation": allocation, "issuers": issuers,
            "currencies": currencies, "maturities": maturities, "fair_value_by_category": by_category,
            "ledger": {"account": INVESTMENTS[0], "balance": book, "expected": expected_book, "difference": difference},
            "limits": {"issuer_pct": ISSUER_LIMIT * 100, "asset_class_pct": ASSET_CLASS_LIMIT * 100,
                       "foreign_currency_pct": FOREIGN_CURRENCY_LIMIT * 100, "drop_alert_pct": DROP_ALERT * 100},
            "limitations": ["Valuations are the recorded month-end prices; the agent does not fetch market data.",
                            "Amortised-cost holdings are carried at cost; expected credit loss on debt holdings is not assessed here."],
        },
        checks=checks, exceptions=exceptions, journals=journals,
        messages=[f"Reviewed {len(rows)} holding(s) worth {total:,.2f}; month return "
                  f"{month_return if month_return is not None else 'n/a'}%; {len(journals)} fair value journal(s) proposed."],
    )
