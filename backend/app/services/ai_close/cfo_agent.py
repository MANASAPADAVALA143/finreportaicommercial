"""CFO Intelligence agent: the executive summary of a close run.

Every figure is assembled from the run's validated agent outputs, its exceptions and
journal proposals, and the posted ledger. Claude may phrase the commentary, but only from
those facts: any number in its text that is not in the facts discards the text and the
deterministic summary is used instead.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.models.ai_close import AiCloseException, AiCloseJournalProposal
from app.services.ai_cfo import ledger
from app.services.ai_cfo.ledger import LedgerScope
from app.services.ai_close.context import AgentOutcome, Check, CloseContext, money

logger = logging.getLogger(__name__)

SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2}
ROOT_CAUSES = {
    "unmatched_bank": ("Bank items not yet recorded or cleared", "Record evidenced bank items; chase uncleared and unidentified items."),
    "unmatched_ledger": ("Ledger cash entries not on the bank statement", "Confirm timing items clear next month; reverse any duplicate posting."),
    "unexplained_difference": ("Unexplained bank differences", "Investigate before close; do not approve with an unexplained difference."),
    "overdue_receivable": ("Customers paying late", "Escalate collections on critical accounts and review credit limits."),
    "control_account_difference": ("Receivables ledger does not agree to invoices", "Reconcile account 1100 to the invoice ageing."),
    "budget_variance": ("Spending above budget", "Obtain explanations from budget holders and update the forecast."),
    "ap_match_exception": ("Supplier invoices not agreeing to PO/GRN", "Resolve price or quantity differences before payment."),
    "vendor_exception": ("Supplier master or invoice data issues", "Correct vendor details before payment."),
    "ap_no_po": ("Purchases without purchase orders", "Enforce PO policy; obtain retrospective approval."),
    "ap_awaiting_grn": ("Invoices received before goods receipt", "Confirm receipt before payment."),
    "duplicate_invoice": ("Possible duplicate supplier invoices", "Hold payment and confirm with the supplier."),
    "goods_received_not_invoiced": ("Goods received without supplier invoices", "Approve the accruals; chase supplier invoices."),
    "missing_accrual": ("Period-end costs not recorded", "Approve the proposed accruals."),
    "ecl_shortfall": ("Credit loss allowance below the provision matrix", "Approve the allowance top-up; calibrate loss rates."),
    "missing_lease_entries": ("IFRS 16 lease entries not recorded", "Approve the lease journals."),
    "revenue_cutoff": ("Revenue not recognised in the invoiced period", "Correct the cut-off before reporting."),
    "ifrs_check_failed": ("Financial statement integrity check failed", "Fix the mapping or balance before reporting."),
    "intercompany_mismatch": ("Intercompany charges recorded differently by the two entities", "Agree both sides and correct the entity in error."),
    "consolidation": ("Consolidation data issues", "Resolve before issuing group figures."),
    "data_gap": ("Missing or unavailable source data", "Load the missing data and re-run the affected agent."),
    "concentration_risk": ("Portfolio concentration above policy limits", "Review exposure with the investment committee."),
    "valuation_drop": ("Sharp fall in an investment's value", "Confirm the price and whether the position still fits policy."),
    "stale_price": ("Investments without a period-end price", "Load the month-end valuation."),
    "fair_value_unrecorded": ("Investment fair value movement not recorded", "Approve the fair value journals."),
    "investment_ledger_difference": ("Investments ledger does not agree to the portfolio", "Reconcile holdings to account 2040."),
    "investment_maturity": ("Investments maturing soon", "Decide on reinvestment."),
    "journal_blocked": ("Journals could not be prepared (period controls)", "Review the period status."),
}


def _performance(ctx: CloseContext) -> dict[str, Any]:
    prior = ledger.period_add(ctx.period, -1)
    by_account: dict[str, dict[str, Any]] = {}
    totals = {"revenue": 0.0, "expenses": 0.0, "prior_revenue": 0.0, "prior_expenses": 0.0}
    entities = ctx.entities or []
    for e in entities:
        for m in ledger.monthly_movements(ctx.db, LedgerScope(ctx.workspace_id, e.id), prior, ctx.period):
            if m["account_type"] not in ("Income", "Expense"):
                continue
            key = "revenue" if m["account_type"] == "Income" else "expenses"
            totals[key if m["period"] == ctx.period else f"prior_{key}"] += m["net"]
            row = by_account.setdefault(m["account_code"], {"account": f"{m['account_code']} {m['account_name']}",
                                                            "type": m["account_type"], "current": 0.0, "prior": 0.0})
            row["current" if m["period"] == ctx.period else "prior"] += m["net"]
    movements = []
    for row in by_account.values():
        change = round(row["current"] - row["prior"], 2)
        movements.append({**row, "current": round(row["current"], 2), "prior": round(row["prior"], 2), "change": change,
                          "change_pct": round(change / row["prior"] * 100, 1) if row["prior"] else None})
    movements.sort(key=lambda r: abs(r["change"]), reverse=True)
    perf = {k: round(v, 2) for k, v in totals.items()}
    perf["profit"] = round(perf["revenue"] - perf["expenses"], 2)
    perf["prior_profit"] = round(perf["prior_revenue"] - perf["prior_expenses"], 2)
    perf["prior_period"] = prior
    return {"performance": perf, "key_movements": movements[:6]}


def _risks(up: dict[str, dict[str, Any]], open_items: int) -> list[dict[str, Any]]:
    risks = []
    ar = up.get("ar_intelligence") or {}
    if ar.get("total_outstanding"):
        overdue = money(ar.get("total_overdue"))
        pct = round(overdue / money(ar["total_outstanding"]) * 100, 1) if ar.get("total_outstanding") else 0
        critical = [c for c in ar.get("customers", []) if c.get("risk_tier") == "critical"]
        risks.append({"area": "Credit", "level": "high" if critical or pct > 40 else "medium",
                      "detail": f"{overdue:,.2f} overdue ({pct}% of receivables); {len(critical)} critical customer(s)."})
    fpa = up.get("fpa") or {}
    downside = (fpa.get("cash_forecast") or {}).get("downside") or []
    if downside:
        low = min(p["closing_cash"] for p in downside)
        risks.append({"area": "Liquidity", "level": "high" if low < 0 else "low",
                      "detail": f"Lowest downside-scenario cash in 90 days {low:,.2f}."})
    bank = up.get("bank_reconciliation") or {}
    if bank.get("total_lines") is not None:
        unexplained = sum(abs(a.get("unexplained_difference") or 0) for a in bank.get("accounts", []))
        unmatched = (bank.get("unmatched_bank") or 0) + (bank.get("unmatched_ledger") or 0)
        risks.append({"area": "Cash control", "level": "high" if unexplained >= 1 else ("medium" if unmatched else "low"),
                      "detail": f"{unmatched} unreconciled item(s); unexplained difference {unexplained:,.2f}."})
    ap = up.get("ap_processing") or {}
    if ap.get("source_available"):
        dup_value = round(sum(d.get("amount") or 0 for d in ap.get("duplicates", []) + ap.get("possible_duplicates", [])), 2)
        risks.append({"area": "Payables", "level": "high" if dup_value else "low",
                      "detail": f"{dup_value:,.2f} in possible duplicate invoices held; {money(ap.get('grni_total')):,.2f} received not invoiced."})
    ifrs_out = up.get("ifrs") or {}
    if ifrs_out.get("checks_evaluated"):
        risks.append({"area": "Reporting", "level": "medium" if ifrs_out.get("checks_failed") else "low",
                      "detail": f"{ifrs_out.get('checks_failed')} of {ifrs_out.get('checks_evaluated')} accounting checks failed."})
    inv = up.get("investment") or {}
    if inv.get("applicable"):
        breaches = [i for i in inv.get("issuers", []) if i.get("pct", 0) > (inv.get("limits") or {}).get("issuer_pct", 100)]
        risks.append({"area": "Investments", "level": "medium" if breaches else "low",
                      "detail": f"Portfolio {money(inv.get('portfolio_value')):,.2f}, month return {inv.get('month_return_pct')}%; "
                                f"{len(breaches)} issuer limit breach(es)."})
    consol = up.get("consolidation") or {}
    mismatched = [r for r in consol.get("eliminations", []) if r.get("status") != "matched"]
    if consol:
        risks.append({"area": "Group", "level": "medium" if mismatched else "low",
                      "detail": f"{len(mismatched)} intercompany reference(s) not agreed."})
    risks.append({"area": "Close", "level": "medium" if open_items else "low", "detail": f"{open_items} checklist item(s) open."})
    return risks


def _template(facts: dict[str, Any]) -> str:
    p = facts["performance"]
    parts = [
        f"{facts['entity']} — {facts['period']}. Revenue {p['revenue']:,.2f} (prior month {p['prior_revenue']:,.2f}); "
        f"expenses {p['expenses']:,.2f}; profit {p['profit']:,.2f} (prior month {p['prior_profit']:,.2f}).",
    ]
    if facts.get("group"):
        g = facts["group"]
        parts.append(f"After eliminating {g['eliminated_revenue']:,.2f} of intercompany revenue, consolidated revenue is "
                     f"{g['consolidated_revenue']:,.2f} and consolidated profit {g['consolidated_net_profit']:,.2f}.")
    o = facts.get("outlook_next_12_months")
    if o:
        parts.append(f"Over the next 12 months profit is forecast at {o['base']['profit']:,.2f} in the base case "
                     f"({o['worst']['profit']:,.2f} worst, {o['best']['profit']:,.2f} best).")
    h = facts["headline"]
    parts.append(f"The close is {h['close_completion_pct']}% complete with {h['open_exceptions']} open exception(s) and "
                 f"{h['pending_approvals']} journal(s) awaiting approval.")
    if facts["root_causes"]:
        top = facts["root_causes"][0]
        parts.append(f"The largest issue group is '{top['cause']}' ({top['count']} item(s)). {top['action']}")
    return " ".join(parts)


_NUM = re.compile(r"(?<![\w.])-?\d[\d,]*(?:\.\d+)?")


def _numbers(obj: Any, out: set[float]) -> set[float]:
    if isinstance(obj, bool):
        return out
    if isinstance(obj, (int, float)):
        out.add(round(abs(float(obj)), 2))
    elif isinstance(obj, dict):
        for v in obj.values():
            _numbers(v, out)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            _numbers(v, out)
    elif isinstance(obj, str):
        for m in _NUM.findall(obj):
            try:
                out.add(round(abs(float(m.replace(",", ""))), 2))
            except ValueError:
                pass
    return out


def unverified_numbers(text: str, facts: dict[str, Any]) -> list[str]:
    """Numbers in `text` that do not match a figure in `facts` (rounding to the unit allowed)."""
    known = _numbers(facts, set())
    bad = []
    for token in _NUM.findall(text):
        value = abs(float(token.replace(",", "")))
        if value < 100 and "." not in token and "," not in token:
            continue  # small counts and day numbers ("3 items", "90 days")
        if any(abs(value - k) <= max(0.51, k * 0.0005) for k in known):
            continue
        bad.append(token)
    return bad


def _ai_commentary(facts: dict[str, Any]) -> tuple[str | None, str | None]:
    from app.services import llm_service

    if not llm_service.is_configured():
        return None, "AI model not configured; deterministic summary used."
    prompt = (
        "Write a concise CFO executive commentary (3 short paragraphs, under 220 words) on this month-end close. "
        "Use ONLY figures that appear in the JSON, written exactly as given (two decimals, thousands separators). "
        "Do not compute new figures, percentages or totals. Cover performance, the main exceptions and their causes, "
        "risks, and the decisions required.\n\n" + json.dumps(facts, default=str)
    )
    try:
        text = llm_service.chat([{"role": "user", "content": prompt}],
                                system="You are a careful group CFO. Never invent numbers.", max_tokens=700).strip()
    except Exception as exc:  # noqa: BLE001 - commentary is optional
        logger.warning("ai-close CFO commentary failed: %s", exc)
        return None, f"AI commentary unavailable ({type(exc).__name__}); deterministic summary used."
    bad = unverified_numbers(text, facts)
    if bad:
        return None, f"AI commentary discarded: it cited figures not in the agent outputs ({', '.join(bad[:5])})."
    return text, None


def cfo_intelligence(ctx: CloseContext) -> AgentOutcome:
    db = ctx.db
    up = ctx.upstream
    names = {e.id: e.name for e in ctx.entities}
    exceptions = db.query(AiCloseException).filter(AiCloseException.run_id == ctx.run_id).all()
    proposals = db.query(AiCloseJournalProposal).filter(AiCloseJournalProposal.run_id == ctx.run_id).all()
    open_exc = [e for e in exceptions if e.status == "open"]
    checklist = up.get("close_manager") or {}
    open_items = sum(1 for i in checklist.get("items", []) if i.get("status") != "done")

    perf = _performance(ctx)
    major = sorted(open_exc, key=lambda e: (SEVERITY_RANK.get(e.severity, 9), -abs(e.amount or 0)))[:10]
    causes: dict[str, dict[str, Any]] = {}
    for e in open_exc:
        cause, action = ROOT_CAUSES.get(e.category, (e.category.replace("_", " ").capitalize(), "Review and resolve."))
        c = causes.setdefault(e.category, {"category": e.category, "cause": cause, "action": action, "count": 0, "amount": 0.0})
        c["count"] += 1
        c["amount"] = round(c["amount"] + abs(e.amount or 0), 2)
    root_causes = sorted(causes.values(), key=lambda c: (-c["count"], -c["amount"]))
    actions = [f"{c['action']} ({c['count']} item(s))" for c in root_causes[:6]]
    for c in (up.get("ar_intelligence") or {}).get("customers", []):
        if c.get("risk_tier") == "critical":
            actions.append(f"{c['customer_name']}: {c.get('recommended_action')}")
    pending = [p for p in proposals if p.status == "pending_approval"]
    decided = [p for p in proposals if p.status != "pending_approval"]
    entity_label = ", ".join(e.name for e in ctx.entities) if ctx.scope_kind == "group" else (ctx.entities[0].name if ctx.entities else ctx.company_id)
    facts: dict[str, Any] = {
        "entity": ("Group: " + entity_label) if ctx.scope_kind == "group" else entity_label,
        "period": ctx.period, "currency": ctx.currency,
        "headline": {"close_completion_pct": checklist.get("completion_pct"), "open_exceptions": len(open_exc),
                     "exceptions_identified": len(exceptions), "pending_approvals": len(pending),
                     "pending_approval_value": round(sum(p.amount or 0 for p in pending), 2), "open_checklist_items": open_items},
        **perf,
        "major_exceptions": [{"title": e.title, "agent": e.agent, "entity": names.get(e.entity_id or "", ""),
                              "severity": e.severity, "amount": e.amount} for e in major],
        "root_causes": root_causes,
        "risks": _risks(up, open_items),
        "recommended_actions": actions[:10],
        "approval_requirements": [{"journal": p.entry_number, "title": p.title, "amount": p.amount, "agent": p.agent,
                                   "entity": names.get(p.company_id, "")} for p in pending],
        "management_decisions": [{"journal": p.entry_number, "title": p.title, "decision": p.status, "by": p.decided_by,
                                  "note": p.decision_note} for p in decided],
    }
    outlook = ((up.get("fpa") or {}).get("rolling_forecast") or {}).get("totals")
    if outlook:
        facts["outlook_next_12_months"] = {name.replace("_case", ""): {"profit": v["profit"], "revenue": v["revenue"]}
                                           for name, v in outlook.items()}
    consol = up.get("consolidation")
    if consol:
        facts["group"] = {"consolidated_revenue": consol.get("consolidated_revenue"),
                          "consolidated_net_profit": consol.get("consolidated_net_profit"),
                          "consolidated_total_assets": consol.get("consolidated_total_assets"),
                          "eliminated_revenue": consol.get("eliminated_revenue")}
        facts["subsidiary_comparison"] = consol.get("comparison", [])
    text, note = _ai_commentary(facts)
    narrative = {"text": text or _template(facts), "source": "ai" if text else "template", "note": note}
    return AgentOutcome(
        records_processed=len(exceptions) + len(proposals),
        output={**facts, "narrative": narrative},
        checks=[
            Check("summary_from_records", True, "Every figure is taken from agent outputs, exceptions, proposals or the ledger.", blocking=True),
            Check("narrative_verified", True, "AI commentary used only if all cited figures match the facts." if text else (note or "")),
        ],
        messages=[f"Executive summary prepared: {len(open_exc)} open exception(s), {len(pending)} approval(s) required; "
                  f"commentary {'verified AI text' if text else 'deterministic'}."],
    )
