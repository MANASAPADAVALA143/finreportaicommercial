"""Consolidation agent (group closes): per-entity P&L and balance sheet using the
consolidation service's account mapping, intercompany matching and elimination, group
totals and subsidiary comparison.

Intercompany entries are identified by a shared reference starting with "IC-" posted in
two group entities. Matched pairs are eliminated (revenue against the counterpart's
expense; intercompany receivable against payable). Mismatches and one-sided entries are
reported once per reference; the smaller side is eliminated and the difference left visible.
"""
from __future__ import annotations

from typing import Any

from app.models.ai_close import AiCloseFxRate
from app.models.uae_accounting_full import UAEAccount, UAEJournalEntry, UAEJournalLine
from app.services import consolidation_service as cs
from app.services.ai_cfo.ledger import period_add
from app.services.ai_close import fx
from app.services.ai_close.context import AgentOutcome, Check, CloseContext, ExceptionItem, money, severity

BS_ROWS = [*cs.BS_ROWS[:-1], {"key": "translation_reserve", "label": "Translation reserve (OCI)", "section": "equity"},
           cs.BS_ROWS[-1]]
PL_KEYS = [r["key"] for r in cs.PL_ROWS]
BS_KEYS = [r["key"] for r in BS_ROWS]
IC_PREFIX = "IC-"


def _derive_pl(c: dict[str, float]) -> dict[str, float]:
    c = {k: round(c.get(k, 0.0), 2) for k in PL_KEYS}
    c["gross_profit"] = round(c["revenue"] - c["cost_of_sales"], 2)
    c["ebitda"] = round(c["gross_profit"] - c["operating_expenses"], 2)
    c["ebit"] = round(c["ebitda"] - c["depreciation"], 2)
    c["pbt"] = round(c["ebit"] - c["finance_costs"], 2)
    c["net_profit"] = round(c["pbt"] - c["tax"], 2)
    return c


def _derive_bs(c: dict[str, float]) -> dict[str, float]:
    c = {k: round(c.get(k, 0.0), 2) for k in BS_KEYS}
    c["total_assets"] = round(sum(c[k] for k in ("fixed_assets_net", "inventory", "trade_receivables", "cash_bank", "other_current_assets")), 2)
    c["total_liabilities_equity"] = round(sum(c[k] for k in ("long_term_borrowings", "trade_payables", "other_current_liabilities",
                                                             "share_capital", "retained_earnings", "translation_reserve")), 2)
    return c


def _months(period: str) -> int:
    return int(period[:4]) * 12 + int(period[5:7])


def _historical(ctx: CloseContext, e, periods: tuple[str, str], meta) -> tuple[dict[str, tuple[float, float]], list[str]]:
    """Share capital and retained earnings translated at historical rates (each posting at its month's
    average rate) to the end of each of `periods`, plus the months whose rate had to be estimated from
    the nearest month entered."""
    rates = {r.period: r.average_rate for r in ctx.db.query(AiCloseFxRate).filter(
        AiCloseFxRate.workspace_id == ctx.workspace_id, AiCloseFxRate.currency == e.currency,
        AiCloseFxRate.reporting_currency == ctx.currency)}
    estimated: set[str] = set()

    def hist(period: str) -> float:
        if period not in rates:
            estimated.add(period)
            return rates[min(rates, key=lambda p: (abs(_months(p) - _months(period)), p))]
        return rates[period]

    out = {p: [0.0, 0.0] for p in periods}
    for line, entry in (
        ctx.db.query(UAEJournalLine, UAEJournalEntry)
        .join(UAEJournalEntry, UAEJournalLine.journal_entry_id == UAEJournalEntry.id)
        .filter(UAEJournalEntry.tenant_id == ctx.workspace_id, UAEJournalEntry.company_id == e.id,
                UAEJournalEntry.status == "posted", UAEJournalEntry.period <= max(periods))
    ):
        code = line.account_code or ""
        account_type, sub_type = meta.get(code, (None, None))
        if cs._pl_category(code, account_type, sub_type):
            slot = 1
        else:
            cat = cs._bs_category(code, account_type, sub_type)
            if cat not in ("share_capital", "retained_earnings"):
                continue
            slot = 0 if cat == "share_capital" else 1
        amount = (money(line.credit) - money(line.debit)) * hist(entry.period)
        for p in periods:
            if entry.period <= p:
                out[p][slot] += amount
    return {p: (round(v[0], 2), round(v[1], 2)) for p, v in out.items()}, sorted(estimated)


def _meta(ctx: CloseContext, entity_id: str) -> dict[str, tuple[str | None, str | None]]:
    return {a.code: (a.account_type, a.sub_type) for a in ctx.db.query(UAEAccount).filter(
        UAEAccount.tenant_id == ctx.workspace_id,
        (UAEAccount.company_id == entity_id) | (UAEAccount.company_id.is_(None)))}


_rate = fx.rate


def consolidation(ctx: CloseContext) -> AgentOutcome:
    db = ctx.db
    entities = ctx.entities
    names = {e.id: e.name for e in entities}
    exceptions: list[ExceptionItem] = []
    per_entity = []
    translation = []
    historical_note: list[str] = []
    pl_rate: dict[str, float] = {}
    bs_rate: dict[str, float] = {}
    prior_period = period_add(ctx.period, -1)
    for e in entities:
        pl_local = _derive_pl(cs._aggregate_categories(db, ctx.workspace_id, e.id, ctx.period, cs._pl_category))
        bs_local = _derive_bs(cs._aggregate_categories(db, ctx.workspace_id, e.id, ctx.period, cs._bs_category))
        balanced = abs(bs_local["total_assets"] - bs_local["total_liabilities_equity"]) < 1
        if not balanced:
            diff = round(bs_local["total_assets"] - bs_local["total_liabilities_equity"], 2)
            exceptions.append(ExceptionItem(f"consol:bs:{e.id}:{ctx.period}", "consolidation", "high",
                                            f"{e.name}: balance sheet out of balance by {diff:,.2f}",
                                            "Mapped assets differ from liabilities and equity.", diff, entity_id=e.id))
        entry = {"entity_id": e.id, "entity_name": e.name, "currency": e.currency, "bs_balanced": balanced, "translated": True}
        if e.currency == ctx.currency:
            pl_rate[e.id] = bs_rate[e.id] = 1.0
            per_entity.append({**entry, "pl": pl_local, "bs": bs_local})
            continue
        rate = _rate(db, ctx.workspace_id, ctx.period, e.currency, ctx.currency)
        if rate is None:
            exceptions.append(ExceptionItem(
                f"consol:fx:{e.id}:{ctx.period}", "consolidation", "high",
                f"{e.name} reports in {e.currency}; no {ctx.period} {e.currency}/{ctx.currency} rates, so it is excluded from group totals",
                "Enter the closing and average rates for the month (IAS 21) and re-run the consolidation.", entity_id=e.id))
            zero_pl, zero_bs = {k: 0.0 for k in PL_KEYS}, {k: 0.0 for k in BS_KEYS}
            per_entity.append({**entry, "translated": False, "pl": zero_pl, "bs": zero_bs, "pl_local": pl_local, "bs_local": bs_local})
            pl_rate[e.id] = bs_rate[e.id] = 0.0
            continue
        prior = _rate(db, ctx.workspace_id, prior_period, e.currency, ctx.currency)
        pl_rate[e.id], bs_rate[e.id] = rate.average_rate, rate.closing_rate
        pl_t = _derive_pl({k: pl_local[k] * rate.average_rate for k in PL_KEYS})
        opening = _derive_bs(cs._aggregate_categories(db, ctx.workspace_id, e.id, prior_period, cs._bs_category))
        opening_net = opening["total_assets"] - (opening["long_term_borrowings"] + opening["trade_payables"] + opening["other_current_liabilities"])
        closing_net = bs_local["total_assets"] - (bs_local["long_term_borrowings"] + bs_local["trade_payables"] + bs_local["other_current_liabilities"])
        opening_rate = prior.closing_rate if prior else rate.closing_rate
        equity, estimated = _historical(ctx, e, (prior_period, ctx.period), _meta(ctx, e.id))
        capital, retained = equity[ctx.period]
        reserve = round(closing_net * rate.closing_rate - capital - retained, 2)
        opening_reserve = round(opening_net * opening_rate - sum(equity[prior_period]), 2)
        cta = round(reserve - opening_reserve, 2)
        bs_t = _derive_bs({**{k: bs_local[k] * rate.closing_rate for k in BS_KEYS},
                           "share_capital": capital, "retained_earnings": retained, "translation_reserve": reserve})
        if estimated:
            historical_note.append(f"{e.name}: no {e.currency} rate entered for {', '.join(estimated)}; equity postings in "
                                   "those months use the nearest month's average rate.")
        translation.append({"entity": e.name, "currency": e.currency, "average_rate": rate.average_rate,
                            "closing_rate": rate.closing_rate, "opening_rate": opening_rate,
                            "opening_rate_source": "prior month closing" if prior else "current closing (prior month rate missing)",
                            "net_profit_local": pl_local["net_profit"], "net_profit_translated": pl_t["net_profit"],
                            "net_assets_local": round(closing_net, 2), "net_assets_translated": round(closing_net * rate.closing_rate, 2),
                            "share_capital_historical": capital, "retained_earnings_historical": retained,
                            "translation_reserve": reserve, "opening_translation_reserve": opening_reserve,
                            "estimated_rate_months": estimated, "translation_difference": cta})
        per_entity.append({**entry, "pl": pl_t, "bs": bs_t, "pl_local": pl_local, "bs_local": bs_local,
                           "rates": {"average": rate.average_rate, "closing": rate.closing_rate}, "translation_difference": cta})

    ic_rows = (
        db.query(UAEJournalLine, UAEJournalEntry)
        .join(UAEJournalEntry, UAEJournalLine.journal_entry_id == UAEJournalEntry.id)
        .filter(UAEJournalEntry.tenant_id == ctx.workspace_id, UAEJournalEntry.company_id.in_(list(names)),
                UAEJournalEntry.status == "posted", UAEJournalEntry.period <= ctx.period,
                UAEJournalEntry.reference.like(f"{IC_PREFIX}%"))
        .all()
    )
    metas = {e.id: _meta(ctx, e.id) for e in entities}
    refs: dict[str, dict[str, dict[str, float]]] = {}
    balances = {"receivable": 0.0, "payable": 0.0}
    excluded = {cid for cid, r in pl_rate.items() if r == 0.0}
    skipped_refs = {entry.reference for _, entry in ic_rows if entry.company_id in excluded}
    for line, entry in ic_rows:
        if entry.reference in skipped_refs:
            continue
        meta = metas[entry.company_id].get(line.account_code or "", (None, None))
        pl_cat = cs._pl_category(line.account_code or "", meta[0], meta[1])
        factor = pl_rate[entry.company_id] if pl_cat else bs_rate[entry.company_id]
        dr, cr = money(line.debit) * factor, money(line.credit) * factor
        if pl_cat is None:
            bs_cat = cs._bs_category(line.account_code or "", meta[0], meta[1])
            if bs_cat in ("other_current_assets", "trade_receivables") and (line.account_code or "") != "1100":
                balances["receivable"] += dr - cr
            elif bs_cat in ("other_current_liabilities", "trade_payables"):
                balances["payable"] += cr - dr
            continue
        if entry.period != ctx.period:
            continue
        side = refs.setdefault(entry.reference, {}).setdefault(entry.company_id, {"revenue": 0.0, "expense": 0.0, "categories": {}})
        if pl_cat == "revenue":
            side["revenue"] += cr - dr
        else:
            side["expense"] += dr - cr
            side["categories"][pl_cat] = side["categories"].get(pl_cat, 0.0) + dr - cr

    eliminations: list[dict[str, Any]] = []
    elim_pl = {k: 0.0 for k in PL_KEYS}
    unexplained_ref_diff = 0.0
    for ref, sides in sorted(refs.items()):
        seller = next((cid for cid, s in sides.items() if s["revenue"] > 0.005), None)
        buyer = next((cid for cid, s in sides.items() if s["expense"] > 0.005 and cid != seller), None)
        rev = round(sides[seller]["revenue"], 2) if seller else 0.0
        exp = round(sides[buyer]["expense"], 2) if buyer else 0.0
        amount = round(min(rev, exp), 2)
        diff = round(rev - exp, 2)
        row = {"reference": ref, "seller": names.get(seller, "—"), "buyer": names.get(buyer, "—"),
               "seller_revenue": rev, "buyer_expense": exp, "eliminated": amount, "difference": diff,
               "status": "matched" if seller and buyer and abs(diff) < 1 else ("one-sided" if not (seller and buyer) else "mismatch")}
        eliminations.append(row)
        if amount > 0:
            elim_pl["revenue"] += amount
            cats = sides[buyer]["categories"]
            total = sum(cats.values()) or 1.0
            for cat, value in cats.items():
                elim_pl[cat] += round(amount * value / total, 2)
        if row["status"] != "matched":
            unexplained_ref_diff += diff if row["status"] == "mismatch" else 0.0
            who = names.get(seller or buyer, "one entity")
            exceptions.append(ExceptionItem(
                f"ic:{ref}", "intercompany_mismatch", severity(abs(diff) or max(rev, exp)),
                (f"Intercompany mismatch {ref}: {row['seller']} {rev:,.2f} vs {row['buyer']} {exp:,.2f}"
                 if row["status"] == "mismatch" else f"Intercompany entry {ref} recorded only by {who}"),
                "Both sides of an intercompany charge must agree before elimination; the smaller amount was eliminated "
                "and the difference remains in group results until corrected.",
                diff or max(rev, exp),
                [{"type": "journal_reference", "ref": ref, "entity": names.get(cid), "amount": round(s["revenue"] - s["expense"], 2)}
                 for cid, s in sides.items()],
            ))

    rec, pay = round(balances["receivable"], 2), round(balances["payable"], 2)
    bs_elim = round(min(rec, pay), 2) if rec > 0 and pay > 0 else 0.0
    balance_diff = round(rec - pay, 2)
    if abs(balance_diff - unexplained_ref_diff) >= 1 and (rec or pay):
        exceptions.append(ExceptionItem(
            f"ic_balance:{ctx.period}", "intercompany_mismatch", severity(balance_diff),
            f"Intercompany balances do not agree: receivable {rec:,.2f} vs payable {pay:,.2f}",
            "Cumulative intercompany receivables and payables differ by more than the mismatched charges explain.", balance_diff))
    elim_bs = {k: 0.0 for k in BS_KEYS}
    if bs_elim:
        elim_bs["other_current_assets"] = bs_elim
        elim_bs["other_current_liabilities"] = bs_elim

    group_pl_raw = {k: round(sum(e["pl"][k] for e in per_entity), 2) for k in PL_KEYS}
    group_bs_raw = {k: round(sum(e["bs"][k] for e in per_entity), 2) for k in BS_KEYS}
    consolidated_pl = _derive_pl({k: group_pl_raw[k] - elim_pl[k] for k in PL_KEYS})
    consolidated_bs = _derive_bs({k: group_bs_raw[k] - elim_bs[k] for k in BS_KEYS})
    group_pl = [{"key": r["key"], "label": r["label"], "aggregate": _derive_pl(group_pl_raw)[r["key"]],
                 "eliminations": round(elim_pl.get(r["key"], 0.0), 2) if not r.get("calculated") else None,
                 "consolidated": consolidated_pl[r["key"]], "by_entity": {e["entity_name"]: e["pl"][r["key"]] for e in per_entity}}
                for r in cs.PL_ROWS]
    group_bs = [{"key": r["key"], "label": r["label"], "aggregate": _derive_bs(group_bs_raw)[r["key"]],
                 "eliminations": round(elim_bs.get(r["key"], 0.0), 2) if not r.get("calculated") else None,
                 "consolidated": consolidated_bs[r["key"]], "by_entity": {e["entity_name"]: e["bs"][r["key"]] for e in per_entity}}
                for r in BS_ROWS]
    comparison = [{
        "entity": e["entity_name"] + ("" if e["translated"] else f" ({e['currency']}, not translated)"),
        "revenue": e["pl"]["revenue"], "net_profit": e["pl"]["net_profit"],
        "net_margin_pct": round(e["pl"]["net_profit"] / e["pl"]["revenue"] * 100, 1) if e["pl"]["revenue"] else None,
        "total_assets": e["bs"]["total_assets"], "cash": e["bs"]["cash_bank"],
        "share_of_group_revenue_pct": round(e["pl"]["revenue"] / group_pl_raw["revenue"] * 100, 1) if group_pl_raw["revenue"] else None,
    } for e in per_entity]
    translation_total = round(sum(t["translation_difference"] for t in translation), 2)
    elim_rev = round(elim_pl["revenue"], 2)
    elim_cost = round(sum(v for k, v in elim_pl.items() if k != "revenue"), 2)
    group_balanced = abs(consolidated_bs["total_assets"] - consolidated_bs["total_liabilities_equity"]) < 1
    unassigned = cs.unassigned_journal_lines(db, ctx.workspace_id, ctx.period)
    limitations = []
    if unassigned:
        limitations.append(f"{unassigned} posted line(s) in the period have no company and are excluded from every entity.")
    if translation:
        limitations.append(
            "Foreign-currency entities: income and expenses at the month's average rate, assets and liabilities at the "
            "closing rate (IAS 21.39); share capital and retained earnings at historical rates (each posting at the average "
            "rate of its month). The cumulative difference is the translation reserve in equity; the month's movement is the "
            "translation difference in other comprehensive income.")
        limitations += historical_note
    if excluded:
        limitations.append(f"{len(excluded)} entity(ies) excluded from group totals for missing exchange rates.")
    return AgentOutcome(
        records_processed=len(entities) + len({e.id for _, e in ic_rows}),
        output={
            "entities": per_entity, "group_pl": group_pl, "group_bs": group_bs,
            "consolidated_revenue": consolidated_pl["revenue"], "consolidated_net_profit": consolidated_pl["net_profit"],
            "consolidated_total_assets": consolidated_bs["total_assets"], "group_bs_balanced": group_balanced,
            "eliminations": eliminations, "eliminated_revenue": elim_rev, "eliminated_costs": elim_cost,
            "intercompany_balances": {"receivable": rec, "payable": pay, "eliminated": bs_elim},
            "comparison": comparison, "unassigned_lines": unassigned, "limitations": limitations,
            "reporting_currency": ctx.currency, "translation": translation, "translation_difference": translation_total,
            "excluded_entities": [names[c] for c in excluded],
        },
        checks=[
            Check("entities_consolidated", len(per_entity) >= 2, f"{len(per_entity)} entities consolidated.", blocking=True),
            Check("all_entities_translated", not excluded,
                  "Every entity is in the reporting currency or translated at the month's rates."),
            Check("eliminations_balanced", abs(elim_rev - elim_cost) < 0.05,
                  f"Revenue eliminated {elim_rev:,.2f} = costs eliminated {elim_cost:,.2f}.", blocking=True),
            Check("group_balance_sheet_balances", group_balanced, "Consolidated balance sheet balances."),
        ],
        exceptions=exceptions,
        messages=[f"Consolidated {len(per_entity)} entities; {len(eliminations)} intercompany reference(s), "
                  f"{elim_rev:,.2f} revenue eliminated; {sum(1 for r in eliminations if r['status'] != 'matched')} to resolve."],
    )
