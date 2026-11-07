"""Close deliverables (Excel + PDF) built from a run's validated agent outputs.

Every report states its entity, period, responsible agent, execution time and status, and
lists the source references behind each figure. Approval statuses are read live so a
downloaded pack shows the current decision on each proposed journal.
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

REPORTS = {
    "bank_reconciliation": ("Bank Reconciliation Report", "bank_reconciliation"),
    "ar_collections": ("AR Ageing & Collection Report", "ar_intelligence"),
    "fpa_intelligence": ("FP&A Variance & Forecast Report", "fpa"),
    "close_pack": ("Month-End Close Pack", "close_manager"),
}


class ReportUnavailable(ValueError):
    pass


def _money(v: Any) -> str:
    return "" if v is None else f"{float(v):,.2f}"


def _ts(v: datetime | None) -> str:
    return v.strftime("%Y-%m-%d %H:%M UTC") if v else ""


def _tasks(db: Session, run: AiCloseRun) -> dict[str, AiCloseTask]:
    return {t.agent: t for t in db.query(AiCloseTask).filter(AiCloseTask.run_id == run.id)}


def _exceptions(db: Session, run: AiCloseRun, agent: str | None = None) -> list[AiCloseException]:
    q = db.query(AiCloseException).filter(AiCloseException.run_id == run.id)
    if agent:
        q = q.filter(AiCloseException.agent == agent)
    return q.order_by(AiCloseException.severity, AiCloseException.id).all()


def _exception_section(rows: list[AiCloseException]) -> dict:
    return {
        "title": "Exceptions",
        "columns": ["Severity", "Category", "Issue", "Amount", "Source", "Status"],
        "rows": [[e.severity, e.category.replace("_", " "), e.title, _money(e.amount),
                  ", ".join(str(r.get("ref") or r.get("reference") or r.get("id")) for r in (e.source_refs or []))[:120],
                  e.status] for e in rows],
    }


def _proposal_section(db: Session, run: AiCloseRun, agent: str | None = None) -> dict:
    q = db.query(AiCloseJournalProposal).filter(AiCloseJournalProposal.run_id == run.id)
    if agent:
        q = q.filter(AiCloseJournalProposal.agent == agent)
    return {
        "title": "Proposed journals",
        "columns": ["Journal", "Description", "Amount", "Prepared by", "Status", "Decided by"],
        "rows": [[p.entry_number, p.title, _money(p.amount), AGENTS.get(p.agent, (p.agent,))[0],
                  p.status.replace("_", " "), p.decided_by or ""] for p in q.order_by(AiCloseJournalProposal.id)],
    }


def build_report(db: Session, run: AiCloseRun, key: str) -> dict[str, Any]:
    if key not in REPORTS:
        raise ReportUnavailable("Unknown report")
    title, agent = REPORTS[key]
    task = _tasks(db, run).get(agent)
    if task is None:
        raise ReportUnavailable("This agent was not part of the run")
    if task.status not in ("completed", "completed_with_exceptions"):
        raise ReportUnavailable(f"{task.title} is {task.status.replace('_', ' ')}; no validated output to report")
    out = task.output_json or {}
    profile = db.get(UaeCompanyProfile, run.company_id)
    spec: dict[str, Any] = {
        "key": key, "title": title,
        "entity": profile.company_name if profile else run.company_id,
        "currency": (profile.base_currency if profile else None) or "AED",
        "period": run.period, "agent": AGENTS[agent][0], "agent_status": task.status.replace("_", " "),
        "executed_at": _ts(task.finished_at), "run_id": run.id, "run_status": run.status.replace("_", " "),
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "summary": [], "sections": [],
    }
    if key == "bank_reconciliation":
        spec["summary"] = [
            ("Statement lines processed", out.get("total_lines")), ("Matched", out.get("matched")),
            ("Unmatched bank lines", out.get("unmatched_bank")), ("Unmatched ledger lines", out.get("unmatched_ledger")),
            ("Match rate %", out.get("match_rate_pct")),
        ]
        spec["sections"] = [
            {"title": "Accounts", "columns": ["Bank", "Account", "GL", "Statement balance", "Ledger balance",
                                               "Bank-only net", "Ledger-only net", "Unexplained"],
             "rows": [[a.get("bank_name"), a.get("account_number"), a.get("gl_account_code"),
                       _money(a.get("statement_closing_balance")), _money(a.get("ledger_balance")),
                       _money(a.get("unmatched_bank_net")), _money(a.get("unmatched_ledger_net")),
                       _money(a.get("unexplained_difference"))] for a in out.get("accounts", [])]},
            {"title": "Reconciling items", "columns": ["Side", "Date", "Description", "Reference", "Amount"],
             "rows": [[r.get("side"), r.get("date"), r.get("description"), r.get("reference") or r.get("ref"),
                       _money(r.get("amount"))] for r in out.get("unmatched_items", [])]},
            _proposal_section(db, run, agent),
            _exception_section(_exceptions(db, run, agent)),
        ]
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
             "rows": [[b["label"], b["invoice_count"], _money(b["amount"]), b["pct"], b["risk"]] for b in out.get("buckets", [])]},
            {"title": "Priority customers", "columns": ["Customer", "Risk", "Outstanding", "Overdue", "Worst bucket", "Avg days to pay", "Recommended action"],
             "rows": [[c["customer_name"], c["risk_tier"], _money(c["total_outstanding"]), _money(c["total_overdue"]),
                       c["worst_bucket"], c.get("avg_days_to_pay") or "", c["recommended_action"]] for c in out.get("customers", [])]},
            {"title": "Overdue invoices", "columns": ["Invoice", "Customer", "Due", "Days overdue", "Amount"],
             "rows": [[i["invoice_number"], i["customer_name"], i["due_date"], i["days_overdue"], _money(i["amount_due"])]
                      for i in out.get("invoices", []) if i["days_overdue"] > 0]},
            _exception_section(_exceptions(db, run, agent)),
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
            {"title": "Budget vs actual", "columns": ["Account", "Budget", "Actual", "Variance", "Variance %", "Material"],
             "rows": [[li["account"], _money(li["budget"]), _money(li["actual"]), _money(li["variance"]),
                       f"{li['variance_pct']:.1f}", "yes" if li["material"] else ""] for li in var.get("line_items", [])]},
            {"title": "Cash forecast", "columns": ["Scenario", "Day", "Inflows", "Outflows", "Closing cash"],
             "rows": [[name, p["day"], _money(p["inflows"]), _money(p["outflows"]), _money(p["closing_cash"])]
                      for name, path in forecast.items() for p in path]},
            {"title": "Trend", "columns": ["Period", "Revenue", "Expenses"],
             "rows": [[p["period"], _money(p["revenue"]), _money(p["expenses"])] for p in out.get("prior_three_months", [])]
                     + [[out.get("period"), _money(out.get("revenue")), _money(out.get("expenses"))]]},
            _exception_section(_exceptions(db, run, agent)),
        ]
        spec["notes"] = out.get("limitations", []) + [
            f"Monthly cost assumption {_money(out.get('monthly_cost_assumption'))}; downside = collections -20%, costs +10%; upside = costs -5%.",
        ]
    else:
        tasks = _tasks(db, run)
        spec["summary"] = [
            ("Close completion %", out.get("completion_pct")), ("Checklist items done", f"{out.get('done')}/{out.get('applicable')}"),
            ("Run status", run.status.replace("_", " ")), ("Close approved by", run.close_approved_by or ""),
            ("Close approved at", _ts(run.close_approved_at)),
        ]
        spec["sections"] = [
            {"title": "Closing checklist", "columns": ["Item", "Status", "Evidence"],
             "rows": [[i["label"], i["status"].replace("_", " "), i["evidence"]] for i in out.get("items", [])]},
            {"title": "Agent execution", "columns": ["Agent", "Task", "Status", "Records", "Exceptions", "Duration (s)", "Finished"],
             "rows": [[AGENTS[t.agent][0], t.title, t.status.replace("_", " "), t.records_processed or 0,
                       t.exceptions_count or 0, round((t.duration_ms or 0) / 1000, 1), _ts(t.finished_at)]
                      for t in sorted(tasks.values(), key=lambda t: (t.wave, t.id))]},
            _proposal_section(db, run),
            _exception_section([e for e in _exceptions(db, run) if e.status == "open"]),
        ]
        if run.close_note:
            spec["notes"] = [f"Close approval note: {run.close_note}"]
    return spec


# ── Renderers ────────────────────────────────────────────────────────────────


def _meta(spec: dict) -> list[tuple[str, Any]]:
    return [
        ("Entity", spec["entity"]), ("Period", spec["period"]), ("Currency", spec["currency"]),
        ("Responsible agent", spec["agent"]), ("Agent status", spec["agent_status"]),
        ("Executed", spec["executed_at"]), ("Close run", f"#{spec['run_id']} ({spec['run_status']})"),
        ("Generated", spec["generated_at"]),
    ]


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
    for note in spec.get("notes", []):
        ws.append(["Note", note])
    ws.column_dimensions["A"].width = 28
    ws.column_dimensions["B"].width = 60
    header_fill = PatternFill("solid", fgColor="071226")
    used: set[str] = {"Summary"}
    for section in spec["sections"]:
        name = section["title"][:31]
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
    navy, gold = colors.HexColor("#071226"), colors.HexColor("#C9A84C")

    def p(v: Any, style=small) -> Paragraph:
        return Paragraph(escape("" if v is None else str(v)), style)

    def footer(canvas, doc) -> None:
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.grey)
        canvas.drawString(12 * mm, 8 * mm, f"Gnanova AI Finance · {spec['entity']} · {spec['period']} · generated {spec['generated_at']}")
        canvas.drawRightString(landscape(A4)[0] - 12 * mm, 8 * mm, f"Page {doc.page}")
        canvas.restoreState()

    story: list[Any] = [Paragraph(escape(spec["title"]), styles["Title"])]
    meta = Table([[p(k, body), p(v, body)] for k, v in _meta(spec)], colWidths=[45 * mm, 120 * mm], hAlign="LEFT")
    meta.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.lightgrey)]))
    story += [meta, Spacer(1, 4 * mm)]
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
