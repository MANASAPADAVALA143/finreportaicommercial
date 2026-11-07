"""IFRS agent: deterministic accounting checks on the posted ledger, journal proposals for
missing period-end entries, and the supporting disclosure schedules.

Checks: trial balance (IAS 1), cumulative balance sheet (IAS 1), chart of accounts coverage,
revenue cut-off against sales invoices (IFRS 15), recurring accruals (IAS 37 / accrual
basis), end-of-service benefits (IAS 19), expected credit loss (IFRS 9, simplified provision
matrix) and IFRS 16 monthly lease entries. Each failed check that the data can quantify
produces a journal draft; nothing posts without approval.
"""
from __future__ import annotations

from datetime import date
from statistics import mean
from typing import Any

from app.models.ifrs16_lease import IFRS16Lease
from app.models.uae_accounting_full import UAEJournalEntry, UAEJournalLine, UAESalesInvoice
from app.modules.ifrs16.ifrs16_je_service import existing_journals, journal_drafts
from app.services.ai_cfo import ledger
from app.services.ai_close.context import (
    AgentOutcome,
    Check,
    CloseContext,
    ExceptionItem,
    JournalDraft,
    money,
    severity,
)

ACCRUED_EXPENSES = ("3020", "Accrued Expenses")
ACCRUED_RENT = ("3022", "Accrued Rent")
SALARIES = "7101"
EOSB_EXPENSE = ("7102", "End of Service Benefits")
EOSB_PROVISION = ("4010", "End of Service Benefits (EOSB)")
EOSB_RATE = round(21 / 30 / 12, 6)  # 21 days' basic pay per year of service (UAE Labour Law, first five years)
ECL_EXPENSE = ("7190", "Impairment Loss on Trade Receivables")
ALLOWANCE = ("1101", "Allowance for Doubtful Debts")
AR_CONTROL = "1100"
ECL_RATES = {"current": 0.01, "1_30": 0.03, "31_60": 0.08, "61_90": 0.20, "90_plus": 0.50}
ECL_THRESHOLD = 1000.0
NOT_ACCRUED = {"7102", "7111", "7112", "7160", "7170", "7190", "7200", "7202", "7210"}


def _check(cid: str, standard: str, title: str, status: str, detail: str, amount: float | None = None) -> dict[str, Any]:
    return {"id": cid, "standard": standard, "title": title, "status": status, "detail": detail, "amount": amount}


def _balances(ctx: CloseContext) -> list[dict[str, Any]]:
    return ledger.balances_as_of(ctx.db, ctx.scope, ctx.period)


def _bal(balances: list[dict[str, Any]], code: str) -> float:
    return round(sum(b["balance"] for b in balances if b["account_code"] == code), 2)


def ifrs(ctx: CloseContext) -> AgentOutcome:
    db = ctx.db
    checks: list[dict[str, Any]] = []
    exceptions: list[ExceptionItem] = []
    journals: list[JournalDraft] = []
    balances = _balances(ctx)
    moves = ledger.monthly_movements(db, ctx.scope, ledger.period_add(ctx.period, -3), ctx.period)
    current = {m["account_code"]: m for m in moves if m["period"] == ctx.period}

    lines = (
        db.query(UAEJournalLine.debit, UAEJournalLine.credit)
        .join(UAEJournalEntry, UAEJournalLine.journal_entry_id == UAEJournalEntry.id)
        .filter(UAEJournalEntry.tenant_id == ctx.workspace_id, UAEJournalEntry.company_id == ctx.company_id,
                UAEJournalEntry.status == "posted", UAEJournalEntry.period == ctx.period).all()
    )
    dr, cr = round(sum(money(d) for d, _ in lines), 2), round(sum(money(c) for _, c in lines), 2)
    checks.append(_check("tb_balanced", "IAS 1", "Trial balance for the period balances",
                         "passed" if abs(dr - cr) < 0.01 and lines else ("failed" if lines else "not_applicable"),
                         f"Debits {dr:,.2f} / credits {cr:,.2f}." if lines else "No posted journals in the period.", round(dr - cr, 2)))

    totals = {t: round(sum(b["balance"] for b in balances if b["account_type"] == t), 2)
              for t in ("Asset", "Liability", "Equity", "Income", "Expense")}
    profit_to_date = round(totals["Income"] - totals["Expense"], 2)
    bs_diff = round(totals["Asset"] - totals["Liability"] - totals["Equity"] - profit_to_date, 2)
    checks.append(_check("bs_balances", "IAS 1", "Balance sheet balances at period end",
                         "passed" if abs(bs_diff) < 1 else "failed",
                         f"Assets {totals['Asset']:,.2f} = liabilities {totals['Liability']:,.2f} + equity "
                         f"{totals['Equity']:,.2f} + profit to date {profit_to_date:,.2f} (difference {bs_diff:,.2f}).", bs_diff))
    if abs(bs_diff) >= 1:
        exceptions.append(ExceptionItem(f"ifrs:bs_difference:{ctx.period}", "ifrs_check_failed", "high",
                                        f"Balance sheet out of balance by {bs_diff:,.2f}",
                                        "Cumulative assets do not equal liabilities, equity and profit to date.", bs_diff))

    catalog = ledger.account_catalog(db, ctx.scope)
    unmapped = sorted({b["account_code"] for b in balances if b["account_code"] not in catalog and abs(b["balance"]) >= 0.01})
    checks.append(_check("coa_complete", "IAS 1", "Every posted account is in the chart of accounts",
                         "passed" if not unmapped else "failed",
                         "All posted accounts are mapped." if not unmapped else f"Unmapped accounts: {', '.join(unmapped)}."))
    for code in unmapped:
        exceptions.append(ExceptionItem(f"ifrs:unmapped:{code}", "ifrs_check_failed", "medium",
                                        f"Account {code} is not in the chart of accounts",
                                        "Posted balances on this code cannot be classified in the financial statements.",
                                        _bal(balances, code)))

    invoiced = db.query(UAESalesInvoice).filter(
        UAESalesInvoice.tenant_id == ctx.workspace_id, UAESalesInvoice.company_id == ctx.company_id,
        UAESalesInvoice.invoice_date >= ctx.start, UAESalesInvoice.invoice_date <= ctx.end,
        UAESalesInvoice.status.notin_(("draft", "cancelled", "void")),
    ).all()
    if invoiced:
        invoice_net = round(sum(money(i.subtotal) for i in invoiced), 2)
        ar_entries = [e for (e,) in db.query(UAEJournalLine.journal_entry_id).join(
            UAEJournalEntry, UAEJournalLine.journal_entry_id == UAEJournalEntry.id).filter(
            UAEJournalEntry.tenant_id == ctx.workspace_id, UAEJournalEntry.company_id == ctx.company_id,
            UAEJournalEntry.status == "posted", UAEJournalEntry.period == ctx.period,
            UAEJournalLine.account_code == AR_CONTROL, UAEJournalLine.debit > 0)]
        recognised = 0.0
        if ar_entries:
            for line in db.query(UAEJournalLine).filter(UAEJournalLine.journal_entry_id.in_(ar_entries)):
                if (line.account_code or "").startswith("6"):
                    recognised += money(line.credit) - money(line.debit)
        cutoff_diff = round(invoice_net - recognised, 2)
        checks.append(_check("revenue_cutoff", "IFRS 15", "Invoiced revenue recognised in the period",
                             "passed" if abs(cutoff_diff) < 1 else "failed",
                             f"Sales invoices dated in the period {invoice_net:,.2f} (net of VAT) vs revenue posted against "
                             f"receivables {recognised:,.2f}.", cutoff_diff))
        if abs(cutoff_diff) >= 1:
            exceptions.append(ExceptionItem(
                f"ifrs:revenue_cutoff:{ctx.period}", "revenue_cutoff", severity(cutoff_diff),
                f"Revenue cut-off difference of {cutoff_diff:,.2f}",
                "Sales invoices dated in the period do not agree to revenue recognised against receivables.", cutoff_diff,
                [{"type": "sales_invoice", "id": i.id, "ref": i.invoice_number, "amount": money(i.subtotal)} for i in invoiced[:20]]))
    else:
        checks.append(_check("revenue_cutoff", "IFRS 15", "Invoiced revenue recognised in the period", "not_applicable",
                             "No sales invoices dated in the period."))

    prior = [ledger.period_add(ctx.period, -i) for i in (3, 2, 1)]
    missing = []
    for code in sorted({m["account_code"] for m in moves if m["account_type"] == "Expense"}):
        history = [next((m["net"] for m in moves if m["account_code"] == code and m["period"] == p), 0.0) for p in prior]
        if code in NOT_ACCRUED or not all(h > 0 for h in history) or abs(current.get(code, {}).get("net", 0)) > 0.01:
            continue
        amount = round(mean(history), 2)
        name = next(m["account_name"] for m in moves if m["account_code"] == code)
        credit = ACCRUED_RENT if code == "7110" else ACCRUED_EXPENSES
        missing.append({"account_code": code, "account_name": name, "amount": amount, "history": history})
        refs = [{"type": "account", "ref": code, "period": p, "amount": h} for p, h in zip(prior, history)]
        journals.append(JournalDraft(
            f"ifrs:accrual:{code}:{ctx.period}", f"Accrue {name} {amount:,.2f} for {ctx.period}",
            f"{name} was charged in each of the last three months (average {amount:,.2f}) but nothing is recorded for "
            f"{ctx.period}. The expense was incurred in the period, so it is accrued (IAS 1.27-28; liability per IAS 37) "
            "and reversed when the invoice is posted.",
            ctx.end,
            [{"account_code": code, "account_name": name, "debit": amount, "credit": 0},
             {"account_code": credit[0], "account_name": credit[1], "debit": 0, "credit": amount}],
            refs,
        ))
        exceptions.append(ExceptionItem(f"ifrs:accrual:{code}:{ctx.period}", "missing_accrual", severity(amount),
                                        f"No {name} recorded for {ctx.period} (3-month average {amount:,.2f})",
                                        "Recurring monthly cost missing; accrual proposed.", amount, refs))
    checks.append(_check("accruals_complete", "IAS 37 / IAS 1", "Recurring monthly costs recorded or accrued",
                         "passed" if not missing else "failed",
                         "Every recurring expense account has a charge for the period." if not missing
                         else f"{len(missing)} recurring cost(s) missing; accruals proposed.",
                         round(sum(m["amount"] for m in missing), 2) if missing else None))

    salaries = current.get(SALARIES, {}).get("net", 0.0)
    eosb_posted = current.get(EOSB_EXPENSE[0], {}).get("net", 0.0)
    if salaries > 0:
        eosb_due = round(salaries * EOSB_RATE, 2)
        ok = eosb_posted > 0.01
        checks.append(_check("eosb_accrued", "IAS 19", "End-of-service benefit accrued for the period",
                             "passed" if ok else "failed",
                             f"Salaries {salaries:,.2f}; EOSB charged {eosb_posted:,.2f}"
                             + ("." if ok else f"; expected about {eosb_due:,.2f} (21 days per year of service)."),
                             None if ok else eosb_due))
        if not ok:
            refs = [{"type": "account", "ref": SALARIES, "period": ctx.period, "amount": salaries}]
            journals.append(JournalDraft(
                f"ifrs:eosb:{ctx.period}", f"Accrue end-of-service benefits {eosb_due:,.2f} for {ctx.period}",
                f"Salaries of {salaries:,.2f} were charged in {ctx.period} with no end-of-service charge. UAE gratuity "
                f"accrues at 21 days' basic pay per year of service (about {EOSB_RATE * 100:.2f}% of monthly pay); the "
                "obligation is recognised as employees render service (IAS 19). Assumes recorded salaries approximate basic pay.",
                ctx.end,
                [{"account_code": EOSB_EXPENSE[0], "account_name": EOSB_EXPENSE[1], "debit": eosb_due, "credit": 0},
                 {"account_code": EOSB_PROVISION[0], "account_name": EOSB_PROVISION[1], "debit": 0, "credit": eosb_due}],
                refs,
            ))
            exceptions.append(ExceptionItem(f"ifrs:eosb:{ctx.period}", "missing_accrual", severity(eosb_due),
                                            f"End-of-service benefits not accrued for {ctx.period} ({eosb_due:,.2f})",
                                            "Salaries charged without the related gratuity provision.", eosb_due, refs))
    else:
        checks.append(_check("eosb_accrued", "IAS 19", "End-of-service benefit accrued for the period", "not_applicable",
                             "No salaries charged in the period."))

    ar = ctx.upstream.get("ar_intelligence") or {}
    matrix = []
    if ar.get("buckets"):
        for b in ar["buckets"]:
            rate = ECL_RATES.get(b["bucket"], 0.0)
            matrix.append({"bucket": b["label"], "gross": money(b["amount"]), "rate_pct": round(rate * 100, 1),
                           "ecl": round(money(b["amount"]) * rate, 2)})
        required = round(sum(m["ecl"] for m in matrix), 2)
        held_allowance = round(-_bal(balances, ALLOWANCE[0]), 2)
        shortfall = round(required - held_allowance, 2)
        ok = shortfall < ECL_THRESHOLD
        checks.append(_check("ecl_allowance", "IFRS 9", "Expected credit loss allowance adequate",
                             "passed" if ok else "failed",
                             f"Provision matrix requires {required:,.2f}; allowance held {held_allowance:,.2f} "
                             f"({'shortfall' if shortfall > 0 else 'excess'} {abs(shortfall):,.2f}).", shortfall))
        if not ok:
            refs = [{"type": "account", "ref": AR_CONTROL, "period": ctx.period, "amount": ar.get("total_outstanding")}]
            journals.append(JournalDraft(
                f"ifrs:ecl:{ctx.period}", f"Increase expected credit loss allowance by {shortfall:,.2f}",
                f"Applying the simplified provision matrix (IFRS 9.5.5.15) to receivables aged at {ctx.end} gives a "
                f"lifetime ECL of {required:,.2f} against an allowance of {held_allowance:,.2f}. Loss rates are default "
                "assumptions and should be calibrated to the entity's own loss history.",
                ctx.end,
                [{"account_code": ECL_EXPENSE[0], "account_name": ECL_EXPENSE[1], "debit": shortfall, "credit": 0},
                 {"account_code": ALLOWANCE[0], "account_name": ALLOWANCE[1], "debit": 0, "credit": shortfall}],
                refs,
            ))
            exceptions.append(ExceptionItem(f"ifrs:ecl:{ctx.period}", "ecl_shortfall", severity(shortfall),
                                            f"Expected credit loss allowance short by {shortfall:,.2f}",
                                            f"Matrix requirement {required:,.2f} vs allowance {held_allowance:,.2f}.", shortfall, refs))
    else:
        checks.append(_check("ecl_allowance", "IFRS 9", "Expected credit loss allowance adequate", "not_applicable",
                             "Receivables ageing not available from the AR agent."))

    leases = db.query(IFRS16Lease).filter(
        IFRS16Lease.workspace_id == ctx.workspace_id, IFRS16Lease.company_id == ctx.company_id,
        IFRS16Lease.status == "active", IFRS16Lease.commencement_date <= ctx.end,
    ).all()
    lease_rows, maturity = [], {"within_1_year": 0.0, "1_to_5_years": 0.0, "over_5_years": 0.0}
    missing_leases = 0
    for lease in leases:
        elapsed = (ctx.end.year - lease.commencement_date.year) * 12 + ctx.end.month - lease.commencement_date.month + 1
        remaining = max((lease.lease_term_months or 0) - elapsed, 0)
        payment = money(lease.lease_payments_aed)
        maturity["within_1_year"] += payment * min(remaining, 12)
        maturity["1_to_5_years"] += payment * max(min(remaining, 60) - 12, 0)
        maturity["over_5_years"] += payment * max(remaining - 60, 0)
        present = {(je.reference or "").split("-")[2] for je in existing_journals(db, ctx.workspace_id, lease.id, ctx.period)
                   if len((je.reference or "").split("-")) >= 5}
        drafts = [d for d in journal_drafts(lease, ctx.end) if d["kind"] not in present] if remaining > 0 else []
        lease_rows.append({"lease": lease.lease_name, "commencement": str(lease.commencement_date),
                           "term_months": lease.lease_term_months, "remaining_months": remaining, "monthly_payment": payment,
                           "rou_asset": money(lease.rou_asset_current), "lease_liability": money(lease.lease_liability_current),
                           "period_journals": "present" if not drafts else "missing: " + ", ".join(d["kind"] for d in drafts)})
        if not drafts:
            continue
        missing_leases += 1
        for d in drafts:
            journals.append(JournalDraft(
                f"ifrs16:{lease.id}:{d['kind']}:{ctx.period}", f"{d['description']} ({ctx.period})",
                f"Monthly IFRS 16 entry for {lease.lease_name} from the lease schedule: "
                + {"DEP": "straight-line depreciation of the right-of-use asset over the lease term (IFRS 16.31-32).",
                   "INT": "interest on the lease liability at the incremental borrowing rate (IFRS 16.36).",
                   "PAY": "the lease payment, reducing the liability."}[d["kind"]],
                ctx.end, d["lines"],
                [{"type": "lease", "id": lease.id, "ref": lease.lease_name, "period": ctx.period, "amount": d["amount"]}],
                reference=d["reference"],
            ))
        labels = {"DEP": "depreciation", "INT": "interest", "PAY": "payment"}
        missing_kinds = ", ".join(labels[d["kind"]] for d in drafts)
        exceptions.append(ExceptionItem(f"ifrs16:{lease.id}:{ctx.period}", "missing_lease_entries", "medium",
                                        f"IFRS 16 {missing_kinds} for {lease.lease_name} not recorded for {ctx.period}",
                                        "Missing entries proposed from the lease schedule.",
                                        round(sum(d["amount"] for d in drafts), 2),
                                        [{"type": "lease", "id": lease.id, "ref": lease.lease_name}]))
    checks.append(_check("ifrs16_entries", "IFRS 16", "Monthly lease entries recorded",
                         "not_applicable" if not leases else ("passed" if not missing_leases else "failed"),
                         "No active leases." if not leases else
                         f"{len(leases)} active lease(s); {missing_leases} without entries for {ctx.period}."))

    evaluated = [c for c in checks if c["status"] != "not_applicable"]
    passed = [c for c in evaluated if c["status"] == "passed"]
    return AgentOutcome(
        records_processed=len(balances),
        output={
            "checks": checks, "checks_evaluated": len(evaluated), "checks_passed": len(passed),
            "checks_failed": len(evaluated) - len(passed),
            "balance_sheet": {**{k.lower(): v for k, v in totals.items()}, "profit_to_date": profit_to_date, "difference": bs_diff},
            "missing_accruals": missing, "ecl_matrix": matrix, "leases": lease_rows,
            "lease_maturity": {k: round(v, 2) for k, v in maturity.items()},
            "limitations": [
                "Expected credit loss uses default loss rates (1/3/8/20/50%); calibrate to historical loss experience.",
                "End-of-service accrual assumes recorded salaries approximate basic pay.",
            ],
        },
        checks=[
            Check("checks_evaluated", bool(evaluated), f"{len(evaluated)} accounting check(s) evaluated.", blocking=True),
            Check("balance_sheet_balances", abs(bs_diff) < 1, "Cumulative balance sheet balances."),
        ],
        exceptions=exceptions, journals=journals,
        messages=[f"Evaluated {len(evaluated)} accounting checks: {len(passed)} passed, {len(evaluated) - len(passed)} failed; "
                  f"{len(journals)} journal(s) proposed."],
    )
