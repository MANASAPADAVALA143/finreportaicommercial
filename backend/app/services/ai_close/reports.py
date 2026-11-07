"""Close deliverables (Excel + PDF, and JSON for on-screen viewing) built from a run's
validated agent outputs.

Every report states its entity (or group), period, responsible agent, execution time and
status, and lists the source references behind each figure. Approval statuses are read live
so a downloaded pack shows the current decision on each proposed journal.
"""
from __future__ import annotations

from datetime import datetime, timezone
from io import BytesIO
from typing import Any
from xml.sax.saxutils import escape

from sqlalchemy.orm import Session

from app.models.ai_close import AiCloseException, AiCloseJournalProposal, AiCloseRun, AiCloseTask
from app.models.company_setup import UaeCompanyProfile
from app.services.ai_close.agents import AGENTS
from app.services.ai_close.journals import journal_detail

REPORTS = {
    "bank_reconciliation": ("Bank Reconciliation Report", "bank_reconciliation"),
    "ap_processing": ("AP Processing Report", "ap_processing"),
    "ar_collections": ("AR Ageing & Collection Report", "ar_intelligence"),
    "ifrs_pack": ("IFRS Accounting Pack", "ifrs"),
    "fpa_intelligence": ("FP&A Variance & Forecast Report", "fpa"),
    "close_pack": ("Month-End Close Pack", "close_manager"),
    "cfo_summary": ("CFO Executive Summary", "cfo_intelligence"),
}
FORMATS = {key: ("pdf",) if key == "cfo_summary" else ("xlsx", "pdf") for key in REPORTS}


class ReportUnavailable(ValueError):
    pass


def _money(v: Any) -> str:
    return "" if v is None else f"{float(v):,.2f}"


def _ts(v: datetime | None) -> str:
    return v.strftime("%Y-%m-%d %H:%M UTC") if v else ""


def _refs(refs: list[dict[str, Any]] | None) -> str:
    return ", ".join(str(r.get("ref") or r.get("reference") or r.get("id")) for r in (refs or []))[:160]


def _tasks(db: Session, run: AiCloseRun) -> dict[str, AiCloseTask]:
    return {t.agent: t for t in db.query(AiCloseTask).filter(AiCloseTask.run_id == run.id)}


def _names(db: Session, run: AiCloseRun) -> dict[str, str]:
    ids = list(run.entity_ids or [run.company_id])
    return {p.id: p.company_name for p in db.query(UaeCompanyProfile).filter(UaeCompanyProfile.id.in_(ids))}


def _exceptions(db: Session, run: AiCloseRun, agent: str | None = None) -> list[AiCloseException]:
    q = db.query(AiCloseException).filter(AiCloseException.run_id == run.id)
    if agent:
        q = q.filter(AiCloseException.agent == agent)
    return q.order_by(AiCloseException.severity, AiCloseException.id).all()


class _Table:
    """Adds an Entity column to tables of a group run."""

    def __init__(self, group: bool, names: dict[str, str]):
        self.group, self.names = group, names

    def section(self, title: str, columns: list[str], rows: list[list[Any]], entities: list[str] | None = None) -> dict:
        if not self.group:
            return {"title": title, "columns": columns, "rows": rows}
        ents = entities or [""] * len(rows)
        return {"title": title, "columns": ["Entity", *columns], "rows": [[e, *r] for e, r in zip(ents, rows)]}

    def from_rows(self, title: str, columns: list[str], items: list[dict[str, Any]], fn) -> dict:
        return self.section(title, columns, [fn(i) for i in items], [i.get("entity", "") for i in items])

    def exceptions(self, rows: list[AiCloseException]) -> dict:
        return self.section(
            "Exceptions", ["Severity", "Category", "Issue", "Amount", "Source", "Status"],
            [[e.severity, e.category.replace("_", " "), e.title, _money(e.amount), _refs(e.source_refs), e.status] for e in rows],
            [self.names.get(e.entity_id or "", "") for e in rows],
        )

    def proposals(self, db: Session, run: AiCloseRun, agent: str | None = None, pending_only: bool = False) -> list[dict]:
        q = db.query(AiCloseJournalProposal).filter(AiCloseJournalProposal.run_id == run.id)
        if agent:
            q = q.filter(AiCloseJournalProposal.agent == agent)
        if pending_only:
            q = q.filter(AiCloseJournalProposal.status == "pending_approval")
        props = q.order_by(AiCloseJournalProposal.id).all()
        ents = [self.names.get(p.company_id, "") for p in props]
        summary = self.section(
            "Journals awaiting approval" if pending_only else "Proposed journals",
            ["Journal", "Description", "Amount", "Prepared by", "Source", "Status", "Decided by", "Decision note"],
            [[p.entry_number, p.title, _money(p.amount), AGENTS.get(p.agent, (p.agent,))[0], _refs(p.source_refs),
              p.status.replace("_", " "), p.decided_by or "", p.decision_note or ""] for p in props], ents,
        )
        line_rows, line_ents = [], []
        for p, ent in zip(props, ents):
            for ln in journal_detail(db, p)["lines"]:
                line_rows.append([p.entry_number, f"{ln['account_code']} {ln['account_name'] or ''}".strip(),
                                  ln["description"] or "", _money(ln["debit"] or None), _money(ln["credit"] or None)])
                line_ents.append(ent)
        lines = self.section("Journal lines", ["Journal", "Account", "Description", "Debit", "Credit"], line_rows, line_ents)
        rationale = self.section("Accounting rationale", ["Journal", "Rationale"],
                                 [[p.entry_number, p.rationale] for p in props], ents)
        return [summary, lines, rationale]


def build_report(db: Session, run: AiCloseRun, key: str) -> dict[str, Any]:
    if key not in REPORTS:
        raise ReportUnavailable("Unknown report")
    title, agent = REPORTS[key]
    tasks = _tasks(db, run)
    task = tasks.get(agent)
    if task is None:
        raise ReportUnavailable("This agent was not part of the run")
    if task.status not in ("completed", "completed_with_exceptions"):
        raise ReportUnavailable(f"{task.title} is {task.status.replace('_', ' ')}; no validated output to report")
    out = task.output_json or {}
    names = _names(db, run)
    group = (run.scope or "entity") == "group"
    t = _Table(group, names)
    profile = db.get(UaeCompanyProfile, run.company_id)
    entity = ("Group: " + ", ".join(names.get(i, i) for i in (run.entity_ids or [])) if group
              else (profile.company_name if profile else run.company_id))
    spec: dict[str, Any] = {
        "key": key, "title": title, "entity": entity,
        "currency": (profile.base_currency if profile else None) or "AED",
        "period": run.period, "agent": AGENTS[agent][0], "agent_status": task.status.replace("_", " "),
        "executed_at": _ts(task.finished_at), "run_id": run.id, "run_status": run.status.replace("_", " "),
        "approval_status": (f"Close approved by {run.close_approved_by} {_ts(run.close_approved_at)}" if run.status == "closed"
                            else "Draft - awaiting close approval"),
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "summary": [], "sections": [], "notes": [], "narrative": [],
    }
    if key == "bank_reconciliation":
        spec["summary"] = [
            ("Statement lines processed", out.get("total_lines")), ("Matched", out.get("matched")),
            ("Unmatched bank lines", out.get("unmatched_bank")), ("Unmatched ledger lines", out.get("unmatched_ledger")),
            ("Match rate %", out.get("match_rate_pct")),
        ]
        spec["sections"] = [
            t.from_rows("Accounts", ["Bank", "Account", "GL", "Statement balance", "Ledger balance", "Bank-only net",
                                     "Ledger-only net", "Unexplained"], out.get("accounts", []),
                        lambda a: [a.get("bank_name"), a.get("account_number"), a.get("gl_account_code"),
                                   _money(a.get("statement_closing_balance")), _money(a.get("ledger_balance")),
                                   _money(a.get("unmatched_bank_net")), _money(a.get("unmatched_ledger_net")),
                                   _money(a.get("unexplained_difference"))]),
            t.from_rows("Reconciling items", ["Side", "Date", "Description", "Reference", "Amount"], out.get("unmatched_items", []),
                        lambda r: [r.get("side"), r.get("date"), r.get("description"), r.get("reference") or r.get("ref"),
                                   _money(r.get("amount"))]),
            *t.proposals(db, run, agent),
            t.exceptions(_exceptions(db, run, agent)),
        ]
    elif key == "ap_processing":
        ms = out.get("match_summary") or {}
        spec["summary"] = [
            ("Invoices processed", out.get("invoices_processed")), ("Invoice value", _money(out.get("invoice_value"))),
            ("Three-way matched", ms.get("three_way_matched")), ("Two-way matched (no GRN)", ms.get("matched")),
            ("Awaiting goods receipt", ms.get("partial")), ("Mismatched", ms.get("mismatch")), ("No PO", ms.get("no_po")),
            ("Duplicates / possible duplicates", f"{len(out.get('duplicates', []))} / {len(out.get('possible_duplicates', []))}"),
            ("Proposed for payment", _money(out.get("payment_proposal_total"))),
            ("Open payables", _money(out.get("open_ap_total"))), ("Received not invoiced", _money(out.get("grni_total"))),
        ]
        spec["sections"] = [
            t.from_rows("Invoice register", ["Invoice", "Supplier", "Date", "Due", "Amount", "VAT", "PO", "Match", "Hold"],
                        out.get("register", []),
                        lambda r: [r.get("ref"), r.get("description"), r.get("date"), r.get("due_date"), _money(r.get("amount")),
                                   _money(r.get("vat")), r.get("po_number") or "", (r.get("match_status") or "").replace("_", " "),
                                   r.get("hold") or ""]),
            t.from_rows("PO and GRN matching", ["Invoice", "Match", "Detail"], out.get("register", []),
                        lambda r: [r.get("ref"), (r.get("match_status") or "").replace("_", " "), r.get("match_notes")]),
            t.from_rows("Duplicate invoices", ["Invoice", "Supplier", "Amount", "Duplicate of"],
                        out.get("duplicates", []) + out.get("possible_duplicates", []),
                        lambda r: [r.get("ref"), r.get("description"), _money(r.get("amount")),
                                   r.get("duplicate_of") or f"similar to {r.get('similar_to')}"]),
            t.exceptions([e for e in _exceptions(db, run, agent) if e.category in ("vendor_exception", "ap_no_po")]) | {"title": "Vendor exceptions"},
            t.from_rows("Payment proposals (not executed)", ["Invoice", "Supplier", "Due", "Amount", "Match", "Reason"],
                        out.get("payment_proposals", []),
                        lambda r: [r.get("ref"), r.get("description"), r.get("due_date"), _money(r.get("amount")),
                                   (r.get("match_status") or "").replace("_", " "), r.get("reason")]),
            t.from_rows("AP ageing", ["Bucket", "Invoices", "Amount"], out.get("buckets", []),
                        lambda b: [b.get("label"), b.get("invoice_count"), _money(b.get("amount"))]),
            t.from_rows("Goods received not invoiced", ["GRN", "PO", "Supplier", "Received", "Amount", "Expense account"],
                        out.get("grni", []),
                        lambda g: [g.get("grn_number"), g.get("po_number"), g.get("vendor"), g.get("received_date"),
                                   _money(g.get("amount")), g.get("expense_account")]),
            *t.proposals(db, run, agent),
            t.exceptions(_exceptions(db, run, agent)),
        ]
        spec["notes"] = out.get("limitations", [])
    elif key == "ar_collections":
        spec["summary"] = [
            ("As of", out.get("as_of")), ("Open invoices", out.get("open_invoices")),
            ("Total outstanding", _money(out.get("total_outstanding"))), ("Total overdue", _money(out.get("total_overdue"))),
            ("Overdue invoices", out.get("overdue_invoice_count")),
            ("Ledger control (1100)", _money(out.get("control_account_balance"))),
            ("Control difference", _money(out.get("control_difference"))),
        ]
        spec["sections"] = [
            {"title": "Ageing", "columns": ["Bucket", "Invoices", "Amount", "% of total", "Risk"],
             "rows": [[b["label"], b["invoice_count"], _money(b["amount"]), b.get("pct"), b["risk"]] for b in out.get("buckets", [])]},
            t.from_rows("Priority customers", ["Customer", "Risk", "Outstanding", "Overdue", "Worst bucket", "Avg days to pay",
                                               "Recommended action"], out.get("customers", []),
                        lambda c: [c["customer_name"], c["risk_tier"], _money(c["total_outstanding"]), _money(c["total_overdue"]),
                                   c["worst_bucket"], c.get("avg_days_to_pay") or "", c["recommended_action"]]),
            t.from_rows("Overdue invoices", ["Invoice", "Customer", "Due", "Days overdue", "Amount"],
                        [i for i in out.get("invoices", []) if i["days_overdue"] > 0],
                        lambda i: [i["invoice_number"], i["customer_name"], i["due_date"], i["days_overdue"], _money(i["amount_due"])]),
            t.exceptions(_exceptions(db, run, agent)),
        ]
        spec["notes"] = out.get("limitations", [])
    elif key == "ifrs_pack":
        bs = out.get("balance_sheet") or {}
        spec["summary"] = [
            ("Checks evaluated", out.get("checks_evaluated")), ("Passed", out.get("checks_passed")),
            ("Failed", out.get("checks_failed")), ("Total assets", _money(bs.get("asset"))),
            ("Total liabilities", _money(bs.get("liability"))), ("Equity", _money(bs.get("equity"))),
            ("Profit to date", _money(bs.get("profit_to_date"))), ("Balance sheet difference", _money(bs.get("difference"))),
        ]
        spec["sections"] = [
            t.from_rows("Accounting checks", ["Standard", "Check", "Result", "Detail", "Amount"], out.get("checks", []),
                        lambda c: [c["standard"], c["title"], c["status"].replace("_", " "), c["detail"], _money(c.get("amount"))]),
            *t.proposals(db, run, agent),
            t.from_rows("Accruals schedule", ["Account", "Amount", "Last three months"], out.get("missing_accruals", []),
                        lambda a: [f"{a['account_code']} {a['account_name']}", _money(a["amount"]),
                                   " / ".join(_money(h) for h in a.get("history", []))]),
            t.from_rows("Expected credit loss - provision matrix", ["Ageing bucket", "Gross receivable", "Loss rate %", "ECL"],
                        out.get("ecl_matrix", []),
                        lambda m: [m["bucket"], _money(m["gross"]), m["rate_pct"], _money(m["ecl"])]),
            t.from_rows("Lease register (IFRS 16)", ["Lease", "Commenced", "Term (months)", "Remaining", "Monthly payment",
                                                    "ROU asset", "Lease liability", "Period entries"], out.get("leases", []),
                        lambda r: [r["lease"], r["commencement"], r["term_months"], r["remaining_months"], _money(r["monthly_payment"]),
                                   _money(r["rou_asset"]), _money(r["lease_liability"]), r["period_journals"]]),
            {"title": "Lease liability maturity (undiscounted)", "columns": ["Within 1 year", "1 to 5 years", "Over 5 years"],
             "rows": [[_money((out.get("lease_maturity") or {}).get(k)) for k in ("within_1_year", "1_to_5_years", "over_5_years")]]},
            t.exceptions(_exceptions(db, run, agent)),
        ]
        spec["notes"] = out.get("limitations", [])
    elif key == "fpa_intelligence":
        var = out.get("variance") or {}
        spec["summary"] = [
            ("Revenue", _money(out.get("revenue"))), ("Expenses", _money(out.get("expenses"))),
            ("Operating profit", _money(out.get("operating_profit"))), ("Opening cash", _money(out.get("opening_cash"))),
            ("Budgeted actual", _money(var.get("total_actual"))), ("Budget", _money(var.get("total_budget"))),
            ("Variance", _money(var.get("total_variance"))),
        ]
        forecast = out.get("cash_forecast") or {}
        spec["sections"] = [
            t.from_rows("Budget vs actual", ["Account", "Budget", "Actual", "Variance", "Variance %", "Material"],
                        var.get("line_items", []),
                        lambda li: [li["account"], _money(li["budget"]), _money(li["actual"]), _money(li["variance"]),
                                    f"{li['variance_pct']:.1f}" if li.get("variance_pct") is not None else "",
                                    "yes" if li.get("material") else ""]),
            {"title": "Cash forecast", "columns": ["Scenario", "Day", "Inflows", "Outflows", "Closing cash"],
             "rows": [[name, p["day"], _money(p["inflows"]), _money(p["outflows"]), _money(p["closing_cash"])]
                      for name, path in forecast.items() for p in path]},
            {"title": "Trend", "columns": ["Period", "Revenue", "Expenses"],
             "rows": [[p["period"], _money(p["revenue"]), _money(p["expenses"])] for p in out.get("prior_three_months", [])]
                     + [[out.get("period"), _money(out.get("revenue")), _money(out.get("expenses"))]]},
            t.exceptions(_exceptions(db, run, agent)),
        ]
        spec["notes"] = out.get("limitations", []) + [
            "Downside = collections -20%, costs +10%; upside = costs -5%; outflows use the average monthly cost.",
        ]
    elif key == "close_pack":
        spec["summary"] = [
            ("Close completion %", out.get("completion_pct")), ("Checklist items done", f"{out.get('done')}/{out.get('applicable')}"),
            ("Run status", run.status.replace("_", " ")), ("Close approved by", run.close_approved_by or ""),
            ("Close approved at", _ts(run.close_approved_at)),
        ]
        items = out.get("items", [])
        spec["sections"] = [
            {"title": "Closing checklist", "columns": ["Item", "Status", "Evidence"],
             "rows": [[i["label"], i["status"].replace("_", " "), i["evidence"]] for i in items]},
            {"title": "Completed tasks", "columns": ["Item", "Evidence"],
             "rows": [[i["label"], i["evidence"]] for i in items if i["status"] == "done"]},
            {"title": "Pending tasks", "columns": ["Item", "Status", "Evidence"],
             "rows": [[i["label"], i["status"].replace("_", " "), i["evidence"]] for i in items if i["status"] not in ("done", "n/a")]},
            {"title": "Agent execution", "columns": ["Agent", "Task", "Status", "Records", "Exceptions", "Duration (s)", "Finished"],
             "rows": [[AGENTS[x.agent][0], x.title, x.status.replace("_", " "), x.records_processed or 0,
                       x.exceptions_count or 0, round((x.duration_ms or 0) / 1000, 1), _ts(x.finished_at)]
                      for x in sorted(tasks.values(), key=lambda x: (x.wave, x.id))]},
        ]
        bank = tasks.get("bank_reconciliation")
        if bank and bank.output_json:
            spec["sections"].append(t.from_rows(
                "Reconciliation status", ["Bank", "Account", "Matched", "Unmatched bank", "Unmatched ledger", "Unexplained"],
                bank.output_json.get("accounts", []),
                lambda a: [a.get("bank_name"), a.get("account_number"), a.get("matched"), a.get("unmatched_bank"),
                           a.get("unmatched_ledger"), _money(a.get("unexplained_difference"))]))
        consol = tasks.get("consolidation")
        if consol and consol.output_json:
            c = consol.output_json
            spec["sections"] += [
                {"title": "Group results", "columns": ["Line", "Aggregate", "Eliminations", "Consolidated"],
                 "rows": [[r["label"], _money(r["aggregate"]), _money(r["eliminations"]), _money(r["consolidated"])]
                          for r in c.get("group_pl", []) + c.get("group_bs", [])]},
                {"title": "Intercompany eliminations", "columns": ["Reference", "Seller", "Buyer", "Seller revenue",
                                                                   "Buyer expense", "Eliminated", "Difference", "Status"],
                 "rows": [[r["reference"], r["seller"], r["buyer"], _money(r["seller_revenue"]), _money(r["buyer_expense"]),
                           _money(r["eliminated"]), _money(r["difference"]), r["status"]] for r in c.get("eliminations", [])]},
            ]
        spec["sections"] += [
            *t.proposals(db, run, pending_only=True)[:2],
            t.exceptions([e for e in _exceptions(db, run) if e.status == "open"]) | {"title": "Unresolved exceptions"},
            {"title": "Final closing status", "columns": ["Status", "Detail"],
             "rows": [[run.status.replace("_", " "),
                       f"Locked by {run.close_approved_by} on {_ts(run.close_approved_at)}" if run.status == "closed"
                       else "Period open: awaiting journal decisions and close approval."]]},
        ]
        if run.close_note:
            spec["notes"] = [f"Close approval note: {run.close_note}"]
    else:
        spec.update(_cfo_spec(out, t))
    return spec


def _cfo_spec(out: dict[str, Any], t: _Table) -> dict[str, Any]:
    h, p = out.get("headline") or {}, out.get("performance") or {}
    narrative = out.get("narrative") or {}
    summary = [
        ("Close completion %", h.get("close_completion_pct")), ("Open exceptions", h.get("open_exceptions")),
        ("Exceptions identified", h.get("exceptions_identified")), ("Journals awaiting approval", h.get("pending_approvals")),
        ("Value awaiting approval", _money(h.get("pending_approval_value"))),
        ("Revenue", _money(p.get("revenue"))), ("Expenses", _money(p.get("expenses"))), ("Profit", _money(p.get("profit"))),
    ]
    g = out.get("group")
    if g:
        summary += [("Consolidated revenue", _money(g.get("consolidated_revenue"))),
                    ("Consolidated profit", _money(g.get("consolidated_net_profit"))),
                    ("Intercompany revenue eliminated", _money(g.get("eliminated_revenue")))]
    sections = [
        {"title": "Financial performance", "columns": ["Measure", out.get("period", "Period"), p.get("prior_period", "Prior"), "Change"],
         "rows": [[label, _money(p.get(k)), _money(p.get(f"prior_{k}")),
                   _money((p.get(k) or 0) - (p.get(f"prior_{k}") or 0))] for label, k in
                  (("Revenue", "revenue"), ("Expenses", "expenses"), ("Profit", "profit"))]},
    ]
    if out.get("subsidiary_comparison"):
        sections.append({"title": "Subsidiary comparison", "columns": ["Entity", "Revenue", "Net profit", "Net margin %",
                                                                       "Share of group revenue %", "Total assets", "Cash"],
                         "rows": [[c["entity"], _money(c["revenue"]), _money(c["net_profit"]), c.get("net_margin_pct"),
                                   c.get("share_of_group_revenue_pct"), _money(c["total_assets"]), _money(c["cash"])]
                                  for c in out["subsidiary_comparison"]]})
    sections += [
        {"title": "Key financial movements", "columns": ["Account", "Current", "Prior", "Change", "Change %"],
         "rows": [[m["account"], _money(m["current"]), _money(m["prior"]), _money(m["change"]), m.get("change_pct")]
                  for m in out.get("key_movements", [])]},
        {"title": "Major exceptions", "columns": ["Severity", "Issue", "Entity", "Agent", "Amount"],
         "rows": [[e["severity"], e["title"], e.get("entity") or "", AGENTS.get(e["agent"], (e["agent"],))[0], _money(e.get("amount"))]
                  for e in out.get("major_exceptions", [])]},
        {"title": "Root causes", "columns": ["Cause", "Items", "Amount", "Recommended action"],
         "rows": [[c["cause"], c["count"], _money(c["amount"]), c["action"]] for c in out.get("root_causes", [])]},
        {"title": "Financial risks", "columns": ["Area", "Level", "Detail"],
         "rows": [[r["area"], r["level"], r["detail"]] for r in out.get("risks", [])]},
        {"title": "Recommended actions", "columns": ["Action"], "rows": [[a] for a in out.get("recommended_actions", [])]},
        {"title": "Approval requirements", "columns": ["Journal", "Description", "Entity", "Amount"],
         "rows": [[a["journal"], a["title"], a.get("entity") or "", _money(a.get("amount"))] for a in out.get("approval_requirements", [])]},
        {"title": "Management decisions", "columns": ["Journal", "Description", "Decision", "By", "Note"],
         "rows": [[d["journal"], d["title"], d["decision"].replace("_", " "), d.get("by") or "", d.get("note") or ""]
                  for d in out.get("management_decisions", [])]},
    ]
    notes = [narrative["note"]] if narrative.get("note") else []
    return {"summary": summary, "sections": sections, "notes": notes,
            "narrative": [x.strip() for x in (narrative.get("text") or "").split("\n") if x.strip()],
            "narrative_source": narrative.get("source")}


# ── Renderers ────────────────────────────────────────────────────────────────


def _meta(spec: dict) -> list[tuple[str, Any]]:
    return [
        ("Entity", spec["entity"]), ("Period", spec["period"]), ("Currency", spec["currency"]),
        ("Responsible agent", spec["agent"]), ("Agent status", spec["agent_status"]),
        ("Executed", spec["executed_at"]), ("Close run", f"#{spec['run_id']} ({spec['run_status']})"),
        ("Approval status", spec["approval_status"]), ("Generated", spec["generated_at"]),
    ]


def render_json(spec: dict) -> dict:
    return {**spec, "meta": [[k, v] for k, v in _meta(spec)], "summary": [[k, v] for k, v in spec["summary"]]}


def render_xlsx(spec: dict) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill

    wb = Workbook()
    ws = wb.active
    ws.title = "Summary"
    ws.append([spec["title"]])
    ws["A1"].font = Font(bold=True, size=14)
    ws.append([])
    for label, value in _meta(spec) + [("", "")] + list(spec["summary"]):
        ws.append([label, value])
    for para in spec.get("narrative", []):
        ws.append(["Commentary", para])
    for note in spec.get("notes", []):
        ws.append(["Note", note])
    ws.column_dimensions["A"].width = 28
    ws.column_dimensions["B"].width = 60
    header_fill = PatternFill("solid", fgColor="071226")
    used: set[str] = {"Summary"}
    for section in spec["sections"]:
        name = "".join(ch for ch in section["title"] if ch not in "[]:*?/\\")[:31]
        while name in used:
            name = name[:28] + str(len(used))
        used.add(name)
        sheet = wb.create_sheet(name)
        sheet.append(section["columns"])
        for idx in range(1, len(section["columns"]) + 1):
            cell = sheet.cell(row=1, column=idx)
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = header_fill
            sheet.column_dimensions[cell.column_letter].width = 22
        for row in section["rows"]:
            sheet.append(list(row))
        if not section["rows"]:
            sheet.append(["None"])
        for row in sheet.iter_rows(min_row=2):
            for cell in row:
                cell.alignment = Alignment(wrap_text=True, vertical="top")
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def render_pdf(spec: dict) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    styles = getSampleStyleSheet()
    small = styles["BodyText"].clone("small", fontSize=7.5, leading=9)
    body = styles["BodyText"].clone("body9", fontSize=9, leading=11)
    lead = styles["BodyText"].clone("lead", fontSize=10, leading=14, spaceAfter=6)
    navy, gold = colors.HexColor("#071226"), colors.HexColor("#C9A84C")

    def p(v: Any, style=small) -> Paragraph:
        return Paragraph(escape("" if v is None else str(v)), style)

    def footer(canvas, doc) -> None:
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.grey)
        canvas.drawString(12 * mm, 8 * mm, f"Gnanova AI Finance · {spec['entity'][:90]} · {spec['period']} · generated {spec['generated_at']}")
        canvas.drawRightString(landscape(A4)[0] - 12 * mm, 8 * mm, f"Page {doc.page}")
        canvas.restoreState()

    story: list[Any] = [Paragraph(escape(spec["title"]), styles["Title"])]
    meta = Table([[p(k, body), p(v, body)] for k, v in _meta(spec)], colWidths=[45 * mm, 160 * mm], hAlign="LEFT")
    meta.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.lightgrey)]))
    story += [meta, Spacer(1, 4 * mm)]
    if spec.get("narrative"):
        label = "Executive commentary" + (" (AI-drafted, figures verified against agent outputs)"
                                          if spec.get("narrative_source") == "ai" else "")
        story.append(Paragraph(escape(label), styles["Heading2"]))
        story += [p(para, lead) for para in spec["narrative"]]
    if spec["summary"]:
        summary = Table([[p(k, body), p(v, body)] for k, v in spec["summary"]], colWidths=[60 * mm, 60 * mm], hAlign="LEFT")
        summary.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F3F4F6")),
                                     ("BOX", (0, 0), (-1, -1), 0.5, gold)]))
        story += [Paragraph("Summary", styles["Heading2"]), summary, Spacer(1, 3 * mm)]
    width = landscape(A4)[0] - 24 * mm
    for section in spec["sections"]:
        story.append(Paragraph(escape(section["title"]), styles["Heading2"]))
        cols = section["columns"]
        rows = section["rows"] or [["None"] + [""] * (len(cols) - 1)]
        table = Table([[p(c) for c in cols]] + [[p(v) for v in r] for r in rows[:400]],
                      colWidths=[width / len(cols)] * len(cols), repeatRows=1)
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), navy), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.25, colors.lightgrey), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        story += [table, Spacer(1, 3 * mm)]
        if len(rows) > 400:
            story.append(p(f"Showing 400 of {len(rows)} rows; the Excel version has all rows.", body))
    for note in spec.get("notes", []):
        story.append(p(note, body))
    story.append(Spacer(1, 3 * mm))
    story.append(p("Figures come from the posted ledger and source records via deterministic agent services. "
                   "Proposed journals post only after approval by an authorised user.", body))
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=12 * mm, rightMargin=12 * mm,
                            topMargin=12 * mm, bottomMargin=14 * mm, title=spec["title"])
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
