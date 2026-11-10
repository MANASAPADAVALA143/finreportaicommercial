"""Close agents. Each wraps existing deterministic services; no figure comes from a model.

Every agent returns counts, a validated output snapshot, unique exceptions (one per source
item, keyed by fingerprint) and, where an adjustment is evidenced by source data, journal
drafts that the orchestrator records as pending-approval journals.
"""
from __future__ import annotations

import re
from statistics import mean
from typing import Any, Callable

from app.models.ai_close import AiCloseJournalProposal, AiCloseTask
from app.models.company_setup import AccountingPeriod, UaeCompanyProfile
from app.models.uae_accounting_full import (
    UAEAccount,
    UAEBankAccount,
    UAEBankStatement,
    UAEBankStatementLine,
    UAEJournalEntry,
    UAEJournalLine,
    UAESalesInvoice,
)
from app.services.ai_cfo import ledger
from app.services.ai_cfo.budget import budget_by_account
from app.services.ai_close.context import (
    MATERIALITY_FLOOR,
    AgentOutcome,
    Check,
    CloseContext,
    ExceptionItem,
    JournalDraft,
    period_bounds,
)
from app.services.ai_close.context import money as _f
from app.services.ai_close.context import severity as _sev
from app.services.ar_aging_service import compute_ar_aging
from app.services.ar_customer_risk_service import compute_customer_risk
from app.services.uae_bank_recon_service import run_reconciliation

_CHARGE_RE = re.compile(r"\b(charge|charges|fee|fees|commission|swift)\b", re.I)
_INTEREST_RE = re.compile(r"\b(interest|profit credit|profit share)\b", re.I)
BANK_CHARGES = ("7160", "Bank Charges")
INTEREST_INCOME = ("6021", "Interest Income")
AR_CONTROL = "1100"


# ── Bank reconciliation ──────────────────────────────────────────────────────


def _cash_codes(ctx: CloseContext, accounts: list[UAEBankAccount]) -> dict[str, str]:
    """bank account id → GL cash account code (linked account, else the default bank code)."""
    out = {}
    for acct in accounts:
        code = None
        if acct.gl_account_id:
            linked = ctx.db.get(UAEAccount, acct.gl_account_id)
            code = linked.code if linked else None
        out[acct.id] = code or "1002"
    return out


def bank_reconciliation(ctx: CloseContext) -> AgentOutcome:
    db = ctx.db
    accounts = db.query(UAEBankAccount).filter(
        UAEBankAccount.tenant_id == ctx.workspace_id,
        UAEBankAccount.company_id == ctx.company_id,
        UAEBankAccount.is_active.is_(True),
    ).all()
    if not accounts:
        return AgentOutcome(
            records_processed=0,
            output={"accounts": [], "total_lines": 0, "matched": 0, "unmatched_bank": 0, "unmatched_ledger": 0},
            checks=[Check("bank_accounts_present", False, "No active bank account is set up for this company.")],
            exceptions=[ExceptionItem(f"data_gap:bank_accounts:{ctx.company_id}", "data_gap", "high",
                                      "No bank account set up", "Add the company's bank accounts before reconciling.")],
            messages=["No bank account found for this company."],
        )

    codes = _cash_codes(ctx, accounts)
    statements = db.query(UAEBankStatement).filter(
        UAEBankStatement.bank_account_id.in_([a.id for a in accounts]),
        UAEBankStatement.statement_date >= ctx.start,
        UAEBankStatement.statement_date <= ctx.end,
    ).order_by(UAEBankStatement.statement_date).all()

    exceptions: list[ExceptionItem] = []
    journals: list[JournalDraft] = []
    messages: list[str] = []
    per_account: list[dict[str, Any]] = []
    total = matched = 0
    unmatched_rows: list[dict[str, Any]] = []

    for acct in accounts:
        stmts = [s for s in statements if s.bank_account_id == acct.id]
        if not stmts:
            exceptions.append(ExceptionItem(
                f"data_gap:bank_statement:{acct.id}:{ctx.period}", "data_gap", "high",
                f"No {ctx.period} statement for {acct.bank_name} {acct.account_number or ''}".strip(),
                "Import the bank statement for the period to reconcile this account.",
            ))
            per_account.append({"bank_account_id": acct.id, "bank_name": acct.bank_name, "statement": None})
            continue
        for stmt in stmts:
            res = run_reconciliation(ctx.workspace_id, stmt.id, db, company_id=ctx.company_id, use_ai=False)
            messages.append(f"{acct.bank_name}: matched {res['exact'] + res['fuzzy']} new line(s) on the {stmt.statement_date} statement.")
        lines = db.query(UAEBankStatementLine).filter(UAEBankStatementLine.statement_id.in_([s.id for s in stmts])).all()
        acct_matched = [ln for ln in lines if ln.match_status == "matched"]
        acct_unmatched = [ln for ln in lines if ln.match_status != "matched"]
        total += len(lines)
        matched += len(acct_matched)
        code = codes[acct.id]
        gl_balance = sum(
            b["balance"] for b in ledger.balances_as_of(db, ctx.scope, ctx.period) if b["account_code"] == code
        )
        closing = _f(stmts[-1].closing_balance)
        unmatched_bank_net = round(sum(_f(ln.credit) - _f(ln.debit) for ln in acct_unmatched), 2)

        for ln in acct_unmatched:
            amount = round(_f(ln.credit) - _f(ln.debit), 2)
            ref = {"type": "bank_line", "id": ln.id, "date": str(ln.transaction_date), "description": ln.description,
                   "reference": ln.reference, "amount": amount}
            unmatched_rows.append({**ref, "side": "bank", "bank_account": acct.bank_name})
            desc = ln.description or ""
            if amount < 0 and _CHARGE_RE.search(desc):
                journals.append(JournalDraft(
                    f"bank_line:{ln.id}", f"Record bank charges {abs(amount):,.2f} ({ln.transaction_date})",
                    f"Bank statement line '{desc}' on {ln.transaction_date} has no ledger entry. Bank charges are "
                    "an expense of the period; recording them clears the reconciling item.",
                    ln.transaction_date,
                    [{"account_code": BANK_CHARGES[0], "account_name": BANK_CHARGES[1], "debit": abs(amount), "credit": 0, "description": desc},
                     {"account_code": code, "account_name": acct.bank_name, "debit": 0, "credit": abs(amount), "description": desc}],
                    [ref],
                ))
            elif amount > 0 and _INTEREST_RE.search(desc):
                journals.append(JournalDraft(
                    f"bank_line:{ln.id}", f"Record bank interest {amount:,.2f} ({ln.transaction_date})",
                    f"Bank statement line '{desc}' on {ln.transaction_date} is interest credited by the bank and is "
                    "not yet in the ledger.",
                    ln.transaction_date,
                    [{"account_code": code, "account_name": acct.bank_name, "debit": amount, "credit": 0, "description": desc},
                     {"account_code": INTEREST_INCOME[0], "account_name": INTEREST_INCOME[1], "debit": 0, "credit": amount, "description": desc}],
                    [ref],
                ))
            exceptions.append(ExceptionItem(
                f"bank_line:{ln.id}", "unmatched_bank", _sev(amount),
                f"Bank line not in ledger: {desc[:80] or 'no description'} ({amount:,.2f})",
                f"{acct.bank_name} statement line on {ln.transaction_date} has no matching posted ledger entry.",
                amount, [ref],
            ))

        matched_ids = {ln.matched_journal_line_id for ln in acct_matched}
        gl_unmatched = []
        for line, entry in (
            db.query(UAEJournalLine, UAEJournalEntry)
            .join(UAEJournalEntry, UAEJournalLine.journal_entry_id == UAEJournalEntry.id)
            .filter(
                UAEJournalEntry.tenant_id == ctx.workspace_id,
                UAEJournalEntry.company_id == ctx.company_id,
                UAEJournalEntry.status == "posted",
                UAEJournalEntry.period == ctx.period,
                UAEJournalLine.account_code == code,
            ).all()
        ):
            if line.id in matched_ids:
                continue
            already = db.query(UAEBankStatementLine.id).filter(UAEBankStatementLine.matched_journal_line_id == line.id).first()
            if already:
                continue
            amount = round(_f(line.debit) - _f(line.credit), 2)
            ref = {"type": "journal_line", "id": line.id, "journal_entry_id": entry.id, "ref": entry.entry_number,
                   "date": str(entry.entry_date), "description": line.description or entry.description, "amount": amount}
            gl_unmatched.append(ref)
            unmatched_rows.append({**ref, "side": "ledger", "bank_account": acct.bank_name})
            exceptions.append(ExceptionItem(
                f"gl_line:{line.id}", "unmatched_ledger", _sev(amount),
                f"Ledger cash entry not on statement: {entry.entry_number} ({amount:,.2f})",
                "Posted to the bank account in the ledger but not cleared on the statement: a timing item "
                "(outstanding payment or deposit in transit) or a possible duplicate posting.",
                amount, [ref],
            ))
        unmatched_gl_net = round(sum(r["amount"] for r in gl_unmatched), 2)
        unexplained = round(closing - gl_balance - (unmatched_bank_net - unmatched_gl_net), 2)
        if abs(unexplained) >= 1:
            exceptions.append(ExceptionItem(
                f"bank_difference:{acct.id}:{ctx.period}", "unexplained_difference", "high",
                f"Unexplained difference of {unexplained:,.2f} on {acct.bank_name}",
                "Statement closing balance less ledger balance is not fully explained by the reconciling items.",
                unexplained,
            ))
        per_account.append({
            "bank_account_id": acct.id, "bank_name": acct.bank_name, "account_number": acct.account_number,
            "gl_account_code": code, "statements": len(stmts), "lines": len(lines), "matched": len(acct_matched),
            "unmatched_bank": len(acct_unmatched), "unmatched_ledger": len(gl_unmatched),
            "statement_closing_balance": closing, "ledger_balance": round(gl_balance, 2),
            "unmatched_bank_net": unmatched_bank_net, "unmatched_ledger_net": unmatched_gl_net,
            "unexplained_difference": unexplained,
        })

    unmatched_bank = sum(a.get("unmatched_bank", 0) for a in per_account)
    unmatched_ledger = sum(a.get("unmatched_ledger", 0) for a in per_account)
    checks = [
        Check("statements_present", all(a.get("statement") is not None or a.get("statements") for a in per_account),
              "Every active bank account has a statement for the period."),
        Check("line_counts_consistent", matched + unmatched_bank == total,
              f"Matched {matched} + unmatched {unmatched_bank} = {total} statement lines.", blocking=True),
        Check("differences_explained", all(abs(a.get("unexplained_difference", 0)) < 1 for a in per_account if a.get("statements")),
              "Statement balance less ledger balance equals the net of reconciling items."),
    ]
    return AgentOutcome(
        records_processed=total,
        output={
            "accounts": per_account, "total_lines": total, "matched": matched,
            "unmatched_bank": unmatched_bank, "unmatched_ledger": unmatched_ledger,
            "match_rate_pct": round(matched / total * 100, 1) if total else None,
            "unmatched_items": unmatched_rows[:500],
        },
        checks=checks, exceptions=exceptions, journals=journals, messages=messages,
    )


# ── Receivables ──────────────────────────────────────────────────────────────

_ACTIONS = {
    "critical": "Escalate: stop further credit and send a final demand; consider provision for expected credit loss.",
    "high": "Call the customer this week and send a formal reminder with a payment date.",
    "medium": "Send a payment reminder.",
    "low": "No action; within terms.",
}


def ar_intelligence(ctx: CloseContext) -> AgentOutcome:
    db = ctx.db
    aging = compute_ar_aging(db, ctx.workspace_id, ctx.company_id, as_of=ctx.end)
    risk = compute_customer_risk(db, ctx.workspace_id, ctx.company_id, as_of=ctx.end)
    invoices = aging["invoices"]
    issued = db.query(UAESalesInvoice).filter(
        UAESalesInvoice.tenant_id == ctx.workspace_id,
        UAESalesInvoice.company_id == ctx.company_id,
        UAESalesInvoice.invoice_date >= ctx.start,
        UAESalesInvoice.invoice_date <= ctx.end,
    ).count()
    overdue = [i for i in invoices if i["days_overdue"] > 0]
    exceptions = [
        ExceptionItem(
            f"ar_invoice:{i['invoice_id']}", "overdue_receivable", "high" if i["days_overdue"] > 90 else "medium",
            f"{i['customer_name']}: {i['invoice_number']} {i['days_overdue']} days overdue ({i['amount_due']:,.2f})",
            f"Due {i['due_date']}; {i['bucket_label']} at {ctx.end}.", i["amount_due"],
            [{"type": "sales_invoice", "id": i["invoice_id"], "ref": i["invoice_number"], "amount": i["amount_due"]}],
        )
        for i in invoices if i["days_overdue"] > 60
    ]
    control = sum(b["balance"] for b in ledger.balances_as_of(db, ctx.scope, ctx.period) if b["account_code"] == AR_CONTROL)
    control_diff = round(control - aging["total_outstanding"], 2)
    if abs(control_diff) >= 1:
        exceptions.append(ExceptionItem(
            f"ar_control:{ctx.period}", "control_account_difference", "high",
            f"Receivables ledger differs from the invoice ageing by {control_diff:,.2f}",
            f"Account {AR_CONTROL} balance {control:,.2f} vs open invoices {aging['total_outstanding']:,.2f}.",
            control_diff,
        ))
    customers = [
        {**c, "recommended_action": _ACTIONS[c["risk_tier"]]} for c in risk["customers"]
    ]
    bucket_total = round(sum(b["amount"] for b in aging["buckets"]), 2)
    checks = [
        Check("buckets_sum_to_total", abs(bucket_total - aging["total_outstanding"]) < 0.05,
              f"Ageing buckets {bucket_total:,.2f} = total outstanding {aging['total_outstanding']:,.2f}.", blocking=True),
        Check("control_account_reconciled", abs(control_diff) < 1,
              f"Ledger {AR_CONTROL} {control:,.2f} vs ageing {aging['total_outstanding']:,.2f}."),
    ]
    return AgentOutcome(
        records_processed=len(invoices) + issued,
        output={
            "as_of": str(ctx.end), "open_invoices": len(invoices), "invoices_issued_in_period": issued,
            "total_outstanding": aging["total_outstanding"], "total_overdue": aging["total_overdue"],
            "overdue_invoice_count": len(overdue), "buckets": aging["buckets"], "invoices": invoices[:500],
            "customers": customers, "control_account_balance": round(control, 2), "control_difference": control_diff,
            "limitations": ["Outstanding amounts reflect payments recorded to date, not only those up to period end."],
        },
        checks=checks, exceptions=exceptions,
        messages=[f"Aged {len(invoices)} open invoice(s); {len(overdue)} overdue, {len(exceptions)} flagged for follow-up."],
    )


# ── FP&A ─────────────────────────────────────────────────────────────────────


def _variance(line_items: list[dict]) -> dict:
    from app.api.routes.fpa_variance import _calculate

    return _calculate(line_items)


def fpa(ctx: CloseContext) -> AgentOutcome:
    db = ctx.db
    lookback = ledger.period_add(ctx.period, -3)
    moves = ledger.monthly_movements(db, ctx.scope, lookback, ctx.period)
    pl = [m for m in moves if m["account_type"] in ("Income", "Expense")]
    current = {m["account_code"]: m for m in pl if m["period"] == ctx.period}
    revenue = round(sum(m["net"] for m in current.values() if m["account_type"] == "Income"), 2)
    expenses = round(sum(m["net"] for m in current.values() if m["account_type"] == "Expense"), 2)
    prior_periods = [ledger.period_add(ctx.period, -i) for i in (3, 2, 1)]
    prior_exp = [sum(m["net"] for m in pl if m["period"] == p and m["account_type"] == "Expense") for p in prior_periods]
    prior_rev = [sum(m["net"] for m in pl if m["period"] == p and m["account_type"] == "Income") for p in prior_periods]

    budgets = budget_by_account(db, ctx.company_id, ctx.period)
    items = []
    for code, b in budgets.items():
        if b["budget"] <= 0:
            continue
        m = current.get(code)
        items.append({
            "account": f"{code} {m['account_name'] if m else b['account_name']}",
            "account_code": code,
            "department": (m["account_type"] if m else "Expense"),
            "budget": b["budget"],
            "actual": m["net"] if m else 0.0,
        })
    variance = _variance(items) if items else None
    materiality = max(MATERIALITY_FLOOR, round(0.02 * expenses, 2))
    exceptions = []
    for li in (variance or {}).get("line_items", []):
        if li["department"] == "Expense" and li["variance"] >= materiality and li["variance_pct"] > 10:
            exceptions.append(ExceptionItem(
                f"budget_variance:{ctx.period}:{li['account_code']}", "budget_variance",
                "high" if li["variance_pct"] >= 50 else "medium",
                f"{li['account']} {li['variance_pct']:.0f}% over budget ({li['variance']:,.2f})",
                f"Actual {li['actual']:,.2f} vs budget {li['budget']:,.2f} for {ctx.period}.", round(li["variance"], 2),
                [{"type": "account", "ref": li["account_code"], "period": ctx.period}],
            ))

    cash = round(sum(
        b["balance"] for b in ledger.balances_as_of(db, ctx.scope, ctx.period)
        if (b["account_code"] or "").startswith("10")
    ), 2)
    ar = (ctx.upstream.get("ar_intelligence") or {}).get("buckets") or []
    by_bucket = {b["bucket"]: b["amount"] for b in ar}
    collections = [
        by_bucket.get("current", 0) + by_bucket.get("1_30", 0),
        by_bucket.get("31_60", 0),
        by_bucket.get("61_90", 0),
    ]
    monthly_cost = round(mean(prior_exp + [expenses]) if expenses or any(prior_exp) else 0.0, 2)
    scenarios = {}
    for name, coll_factor, cost_factor in (("base", 1.0, 1.0), ("downside", 0.8, 1.1), ("upside", 1.0, 0.95)):
        balance, path = cash, []
        for day, inflow in zip((30, 60, 90), collections):
            balance = round(balance + inflow * coll_factor - monthly_cost * cost_factor, 2)
            path.append({"day": day, "inflows": round(inflow * coll_factor, 2), "outflows": round(monthly_cost * cost_factor, 2),
                         "closing_cash": balance})
        scenarios[name] = path
    limitations = []
    if not items:
        limitations.append("No FP&A budget uploaded for this company and fiscal year; variance analysis skipped.")
    if not ar:
        limitations.append("Receivables ageing not available; the cash forecast has no collections.")
    ap_due = (ctx.upstream.get("ap_processing") or {}).get("due_schedule")
    if ap_due:
        limitations.append(
            "Cash outflows use the average monthly expense run-rate. Supplier invoices falling due (from AP) are shown "
            f"for reference and not added, to avoid double counting: {ap_due['0_30']:,.2f} / {ap_due['31_60']:,.2f} / "
            f"{ap_due['61_90']:,.2f} in the next 30/60/90 days.")
    else:
        limitations.append("Cash outflows use the average monthly expense; supplier payment schedules (AP) were not available.")

    checks = [Check("pl_totals_tie", abs(revenue - sum(m["net"] for m in current.values() if m["account_type"] == "Income")) < 0.01,
                    "Revenue equals the sum of income accounts for the period.", blocking=True)]
    if variance:
        sum_actual = round(sum(li["actual"] for li in variance["line_items"]), 2)
        checks.append(Check("variance_totals_tie", abs(sum_actual - variance["total_actual"]) < 0.05,
                            "Variance total equals the sum of its lines.", blocking=True))
    return AgentOutcome(
        records_processed=len(current),
        output={
            "period": ctx.period, "revenue": revenue, "expenses": expenses, "operating_profit": round(revenue - expenses, 2),
            "prior_three_months": [{"period": p, "revenue": round(r, 2), "expenses": round(e, 2)}
                                   for p, r, e in zip(prior_periods, prior_rev, prior_exp)],
            "variance": variance, "materiality": materiality, "opening_cash": cash,
            "monthly_cost_assumption": monthly_cost, "cash_forecast": scenarios, "limitations": limitations,
            "ap_due_schedule": ap_due,
            "accounts": sorted(current.values(), key=lambda m: m["account_code"] or ""),
        },
        checks=checks, exceptions=exceptions,
        messages=[f"Compared {len(items)} budgeted account(s); {len(exceptions)} material overrun(s). Forecast 30/60/90 days from {cash:,.2f} cash."],
    )


# ── Close manager ────────────────────────────────────────────────────────────

CHECKLIST = [
    ("bank_reconciled", "Bank accounts reconciled", "bank_reconciliation"),
    ("ap_reviewed", "Payables processed and matched", "ap_processing"),
    ("ar_reviewed", "Receivables aged and control account reconciled", "ar_intelligence"),
    ("ifrs_checks", "IFRS accounting checks completed", "ifrs"),
    ("budget_reviewed", "Budget variance and cash forecast prepared", "fpa"),
    ("investments_reviewed", "Investment portfolio valued and reviewed", "investment"),
    ("consolidated", "Group consolidated and intercompany agreed", "consolidation"),
    ("ledger_balanced", "Posted journals balance for the period", None),
    ("journals_approved", "No other journals awaiting approval in the period", None),
    ("proposals_decided", "Agent-proposed journals decided", None),
    ("prior_period_closed", "Prior period closed or locked", None),
]


def evaluate_checklist(db, run_id: int, workspace_id: str, company_ids: str | list[str], period: str,
                       scope_kind: str = "entity") -> dict[str, Any]:
    """Checklist across every entity in the run: an item is done only when it is done for all of them."""
    ids = [company_ids] if isinstance(company_ids, str) else list(company_ids)
    tasks = {t.agent: t for t in db.query(AiCloseTask).filter(AiCloseTask.run_id == run_id)}
    start, end = period_bounds(period)
    names = {p.id: p.company_name for p in db.query(UaeCompanyProfile).filter(UaeCompanyProfile.id.in_(ids))}

    def per_entity(fn) -> tuple[str, str]:
        results = [(cid, *fn(cid)) for cid in ids]
        status = "done" if all(ok for _, ok, _ in results) else "open"
        if len(ids) == 1:
            return status, results[0][2]
        return status, " ".join(f"{names.get(cid, cid[:8])}: {ev}" for cid, _, ev in results)

    def balanced(cid: str) -> tuple[bool, str]:
        totals = (
            db.query(UAEJournalLine.debit, UAEJournalLine.credit)
            .join(UAEJournalEntry, UAEJournalLine.journal_entry_id == UAEJournalEntry.id)
            .filter(UAEJournalEntry.tenant_id == workspace_id, UAEJournalEntry.company_id == cid,
                    UAEJournalEntry.status == "posted", UAEJournalEntry.period == period).all()
        )
        dr, cr = round(sum(_f(d) for d, _ in totals), 2), round(sum(_f(c) for _, c in totals), 2)
        if not totals:
            return False, "No posted journals in the period."
        return abs(dr - cr) < 0.01, f"Debits {dr:,.2f} / credits {cr:,.2f}."

    def no_other_pending(cid: str) -> tuple[bool, str]:
        proposed = db.query(AiCloseJournalProposal.journal_entry_id).filter(
            AiCloseJournalProposal.workspace_id == workspace_id, AiCloseJournalProposal.company_id == cid)
        pending = db.query(UAEJournalEntry).filter(
            UAEJournalEntry.tenant_id == workspace_id, UAEJournalEntry.company_id == cid,
            UAEJournalEntry.status.in_(("pending_approval", "draft")),
            UAEJournalEntry.entry_date >= start, UAEJournalEntry.entry_date <= end,
            ~UAEJournalEntry.id.in_(proposed),
        ).count()
        return pending == 0, f"{pending} other draft or pending journal(s) dated in the period (agent proposals are tracked separately)."

    def prior_closed(cid: str) -> tuple[bool, str]:
        prev_start, prev_end = period_bounds(ledger.period_add(period, -1))
        prev = db.query(AccountingPeriod).filter(
            AccountingPeriod.workspace_id == workspace_id,
            (AccountingPeriod.company_id == cid) | (AccountingPeriod.company_id.is_(None)),
            AccountingPeriod.start_date <= prev_start, AccountingPeriod.end_date >= prev_end,
        ).first()
        if prev is None:
            return False, "No accounting period record for the prior month."
        return prev.status in ("closed", "locked"), f"Prior period {prev.period_name} is {prev.status}."

    items = []
    for key, label, agent in CHECKLIST:
        if agent == "consolidation" and scope_kind != "group":
            status, evidence = "n/a", "Single-entity close."
        elif agent:
            task = tasks.get(agent)
            if task is None:
                status, evidence = "not_run", "Agent not part of this run."
            elif task.status == "completed":
                status, evidence = "done", f"{task.title}: completed with no exceptions."
            elif task.status in ("pending", "running"):
                status, evidence = "open", "Agent still running."
            else:
                status, evidence = "open", f"{task.title}: {task.status.replace('_', ' ')} ({task.exceptions_count or 0} exception(s))."
        elif key == "ledger_balanced":
            status, evidence = per_entity(balanced)
        elif key == "journals_approved":
            status, evidence = per_entity(no_other_pending)
        elif key == "proposals_decided":
            open_props = db.query(AiCloseJournalProposal).filter(
                AiCloseJournalProposal.run_id == run_id, AiCloseJournalProposal.status == "pending_approval").count()
            status = "done" if open_props == 0 else "open"
            evidence = f"{open_props} proposed journal(s) awaiting a decision."
        else:
            status, evidence = per_entity(prior_closed)
        items.append({"key": key, "label": label, "status": status, "evidence": evidence})
    applicable = [i for i in items if i["status"] != "n/a"]
    done = sum(1 for i in applicable if i["status"] == "done")
    return {
        "items": items, "done": done, "applicable": len(applicable),
        "completion_pct": round(done / len(applicable) * 100, 1) if applicable else 0.0,
        "definition": "Checklist items done / applicable items. Agents not run count as not done.",
    }


def close_manager(ctx: CloseContext) -> AgentOutcome:
    ids = [e.id for e in ctx.entities] or [ctx.company_id]
    checklist = evaluate_checklist(ctx.db, ctx.run_id, ctx.workspace_id, ids, ctx.period, ctx.scope_kind)
    open_items = [i for i in checklist["items"] if i["status"] not in ("done", "n/a")]
    return AgentOutcome(
        records_processed=len(checklist["items"]),
        output=checklist,
        checks=[Check("checklist_evaluated", checklist["applicable"] > 0, "Checklist items evaluated.", blocking=True)],
        messages=[f"Close checklist {checklist['completion_pct']}% complete; {len(open_items)} item(s) open."],
    )


from app.services.ai_close.ap_agent import ap_processing  # noqa: E402
from app.services.ai_close.cfo_agent import cfo_intelligence  # noqa: E402
from app.services.ai_close.consolidation_agent import consolidation  # noqa: E402
from app.services.ai_close.ifrs_agent import ifrs  # noqa: E402
from app.services.ai_close.investment_agent import investment  # noqa: E402

AgentFn = Callable[[CloseContext], AgentOutcome]
AGENTS: dict[str, tuple[str, AgentFn]] = {
    "bank_reconciliation": ("Bank Reconciliation Agent", bank_reconciliation),
    "ap_processing": ("AP Processing Agent", ap_processing),
    "ar_intelligence": ("AR Intelligence Agent", ar_intelligence),
    "ifrs": ("IFRS Accounting Agent", ifrs),
    "fpa": ("FP&A Agent", fpa),
    "investment": ("Investment Agent", investment),
    "consolidation": ("Consolidation Agent", consolidation),
    "close_manager": ("Close Manager Agent", close_manager),
    "cfo_intelligence": ("CFO Intelligence Agent", cfo_intelligence),
}
ENTITY_AGENTS = ("bank_reconciliation", "ap_processing", "ar_intelligence", "ifrs", "fpa", "investment")
