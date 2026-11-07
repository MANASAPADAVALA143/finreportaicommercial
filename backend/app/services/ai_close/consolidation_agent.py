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

from app.models.uae_accounting_full import UAEAccount, UAEJournalEntry, UAEJournalLine
from app.services import consolidation_service as cs
from app.services.ai_close.context import AgentOutcome, Check, CloseContext, ExceptionItem, money, severity

PL_KEYS = [r["key"] for r in cs.PL_ROWS]
BS_KEYS = [r["key"] for r in cs.BS_ROWS]
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
                                                             "share_capital", "retained_earnings")), 2)
    return c


def _meta(ctx: CloseContext, entity_id: str) -> dict[str, tuple[str | None, str | None]]:
    return {a.code: (a.account_type, a.sub_type) for a in ctx.db.query(UAEAccount).filter(
        UAEAccount.tenant_id == ctx.workspace_id,
        (UAEAccount.company_id == entity_id) | (UAEAccount.company_id.is_(None)))}


def consolidation(ctx: CloseContext) -> AgentOutcome:
    db = ctx.db
    entities = ctx.entities
    names = {e.id: e.name for e in entities}
    exceptions: list[ExceptionItem] = []
    per_entity = []
    for e in entities:
        pl = _derive_pl(cs._aggregate_categories(db, ctx.workspace_id, e.id, ctx.period, cs._pl_category))
        bs = _derive_bs(cs._aggregate_categories(db, ctx.workspace_id, e.id, ctx.period, cs._bs_category))
        balanced = abs(bs["total_assets"] - bs["total_liabilities_equity"]) < 1
        per_entity.append({"entity_id": e.id, "entity_name": e.name, "currency": e.currency, "pl": pl, "bs": bs,
                           "bs_balanced": balanced})
        if not balanced:
            diff = round(bs["total_assets"] - bs["total_liabilities_equity"], 2)
            exceptions.append(ExceptionItem(f"consol:bs:{e.id}:{ctx.period}", "consolidation", "high",
                                            f"{e.name}: balance sheet out of balance by {diff:,.2f}",
                                            "Mapped assets differ from liabilities and equity.", diff, entity_id=e.id))
        if e.currency != ctx.currency:
            exceptions.append(ExceptionItem(f"consol:fx:{e.id}", "consolidation", "high",
                                            f"{e.name} reports in {e.currency}; translation to {ctx.currency} not performed",
                                            "IAS 21 translation is required before these figures can be added to the group.",
                                            entity_id=e.id))

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
    for line, entry in ic_rows:
        meta = metas[entry.company_id].get(line.account_code or "", (None, None))
        dr, cr = money(line.debit), money(line.credit)
        pl_cat = cs._pl_category(line.account_code or "", meta[0], meta[1])
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
                for r in cs.BS_ROWS]
    comparison = [{
        "entity": e["entity_name"], "revenue": e["pl"]["revenue"], "net_profit": e["pl"]["net_profit"],
        "net_margin_pct": round(e["pl"]["net_profit"] / e["pl"]["revenue"] * 100, 1) if e["pl"]["revenue"] else None,
        "total_assets": e["bs"]["total_assets"], "cash": e["bs"]["cash_bank"],
        "share_of_group_revenue_pct": round(e["pl"]["revenue"] / group_pl_raw["revenue"] * 100, 1) if group_pl_raw["revenue"] else None,
    } for e in per_entity]
    elim_rev = round(elim_pl["revenue"], 2)
    elim_cost = round(sum(v for k, v in elim_pl.items() if k != "revenue"), 2)
    group_balanced = abs(consolidated_bs["total_assets"] - consolidated_bs["total_liabilities_equity"]) < 1
    unassigned = cs.unassigned_journal_lines(db, ctx.workspace_id, ctx.period)
    limitations = []
    if unassigned:
        limitations.append(f"{unassigned} posted line(s) in the period have no company and are excluded from every entity.")
    return AgentOutcome(
        records_processed=len(entities) + len({e.id for _, e in ic_rows}),
        output={
            "entities": per_entity, "group_pl": group_pl, "group_bs": group_bs,
            "consolidated_revenue": consolidated_pl["revenue"], "consolidated_net_profit": consolidated_pl["net_profit"],
            "consolidated_total_assets": consolidated_bs["total_assets"], "group_bs_balanced": group_balanced,
            "eliminations": eliminations, "eliminated_revenue": elim_rev, "eliminated_costs": elim_cost,
            "intercompany_balances": {"receivable": rec, "payable": pay, "eliminated": bs_elim},
            "comparison": comparison, "unassigned_lines": unassigned, "limitations": limitations,
        },
        checks=[
            Check("entities_consolidated", len(per_entity) >= 2, f"{len(per_entity)} entities consolidated.", blocking=True),
            Check("eliminations_balanced", abs(elim_rev - elim_cost) < 0.05,
                  f"Revenue eliminated {elim_rev:,.2f} = costs eliminated {elim_cost:,.2f}.", blocking=True),
            Check("group_balance_sheet_balances", group_balanced, "Consolidated balance sheet balances."),
        ],
        exceptions=exceptions,
        messages=[f"Consolidated {len(per_entity)} entities; {len(eliminations)} intercompany reference(s), "
                  f"{elim_rev:,.2f} revenue eliminated; {sum(1 for r in eliminations if r['status'] != 'matched')} to resolve."],
    )
