"""Internal Audit Report PDF (ReportLab) for one engagement.

Built from the engagement, its findings and, when a period is chosen, the JE anomaly
review queue (je_anomaly_reviews) for that period. Overdue status is computed from
action_due_date against today's date.

Every user-supplied value is XML-escaped before it reaches Paragraph markup. Text is
drawn with the standard Helvetica font, which only covers WinAnsi characters, so
symbols such as arrows, bullets and warning signs are written as plain text.
"""
from __future__ import annotations

import io
from datetime import date, datetime, timezone
from typing import Any
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.services.je_review_export import summarize

BRAND = "Gnanova Finance OS"

_NAVY = colors.HexColor("#0A0F1E")
_AMBER = colors.HexColor("#F5A623")
_SLATE = colors.HexColor("#334155")
_LIGHT = colors.HexColor("#F8FAFC")
_BORDER = colors.HexColor("#E2E8F0")
_RED = colors.HexColor("#DC2626")
_ORANGE = colors.HexColor("#EA580C")
_YELLOW = colors.HexColor("#CA8A04")
_GREEN = colors.HexColor("#16A34A")
_GREY = colors.HexColor("#64748B")

_RISK_COLORS = {"Critical": _RED, "High": _RED, "Medium": _ORANGE, "Low": _YELLOW}
_STATUS_COLORS = {
    "Open": _RED, "In Progress": _ORANGE, "Overdue": _RED,
    "Implemented": _GREEN, "Verified": _GREEN,
    "Under Review": _ORANGE, "Cleared": _GREEN,
}
_RISK_ORDER = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}
_CLOSED = {"Implemented", "Verified"}
JE_TABLE_LIMIT = 50

PAGE_W, _ = A4
MARGIN = 0.65 * inch
CONTENT_W = PAGE_W - 2 * MARGIN


def _cols(*fractions: float) -> list[float]:
    return [CONTENT_W * f for f in fractions]


def _styles():
    base = getSampleStyleSheet()

    def add(name: str, parent: str, **kw: Any) -> None:
        base.add(ParagraphStyle(name=name, parent=base[parent], **kw))

    add("RTitle", "Title", textColor=_NAVY, fontSize=22, leading=28, spaceAfter=4)
    add("RSubtitle", "Normal", textColor=_SLATE, fontSize=11, spaceAfter=2)
    add("RMeta", "Normal", textColor=_GREY, fontSize=9, spaceAfter=2)
    add("RH1", "Heading1", textColor=_AMBER, fontSize=13, spaceBefore=14, spaceAfter=6)
    add("RH2", "Heading2", textColor=_NAVY, fontSize=11, spaceBefore=10, spaceAfter=4)
    add("RBody", "Normal", textColor=_SLATE, fontSize=10, leading=14, spaceAfter=4)
    add("RBodyBold", "Normal", textColor=_NAVY, fontSize=10, leading=14, fontName="Helvetica-Bold")
    add("RCaption", "Normal", textColor=_GREY, fontSize=8, leading=11)
    add("RBrand", "Normal", textColor=_AMBER, fontSize=14, alignment=TA_RIGHT, fontName="Helvetica-Bold")
    add("RTableH", "Normal", textColor=colors.white, fontSize=9, leading=12,
        fontName="Helvetica-Bold", alignment=TA_CENTER)
    add("RTableC", "Normal", textColor=_SLATE, fontSize=9, leading=12)
    add("RTableHS", "RTableH", fontSize=8, leading=10)
    add("RTableCS", "RTableC", fontSize=8, leading=10)
    add("RKpi", "Normal", textColor=_NAVY, fontSize=16, leading=20,
        fontName="Helvetica-Bold", alignment=TA_CENTER)
    return base


def _text(val: Any) -> str:
    if val is None:
        return "—"
    s = str(val).strip()
    return s or "—"


def _esc(val: Any) -> str:
    """Escaped markup for a value; line breaks in long text survive as <br/>."""
    return escape(_text(val)).replace("\n", "<br/>")


def _p(val: Any, style) -> Paragraph:
    return Paragraph(_esc(val), style)


def _hex(col) -> str:
    return "#" + col.hexval()[2:]


def _colored(val: Any, palette: dict[str, Any], style) -> Paragraph:
    label = _text(val)
    c = _hex(palette.get(label, _GREY))
    return Paragraph(f'<font color="{c}"><b>{escape(label)}</b></font>', style)


def _table(rows: list[list[Any]], col_widths: list[float | None], *, header: bool = True,
           label_cols: tuple[int, ...] = (), padding: int = 6, repeat: bool = False) -> Table:
    t = Table(rows, colWidths=col_widths, repeatRows=1 if repeat else 0)
    style: list[tuple] = [
        ("GRID", (0, 0), (-1, -1), 0.5, _BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), padding),
        ("BOTTOMPADDING", (0, 0), (-1, -1), padding),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]
    if header:
        style += [
            ("BACKGROUND", (0, 0), (-1, 0), _NAVY),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, _LIGHT]),
        ]
    for col in label_cols:
        style.append(("BACKGROUND", (col, 0), (col, -1), _LIGHT))
    t.setStyle(TableStyle(style))
    return t


def _rule(thickness: float = 2, color=_AMBER) -> HRFlowable:
    return HRFlowable(width="100%", thickness=thickness, color=color, spaceBefore=2, spaceAfter=6)


def is_overdue(finding: dict[str, Any], today: str) -> bool:
    due = finding.get("action_due_date")
    return bool(due) and due < today and finding.get("status") not in _CLOSED


def _cover(eng: dict, company_name: str, period: str | None, s) -> list:
    el: list = [
        Paragraph(BRAND, s["RBrand"]),
        Spacer(1, 0.4 * inch),
        HRFlowable(width="100%", thickness=4, color=_AMBER, spaceAfter=20),
        Paragraph("INTERNAL AUDIT REPORT", s["RTitle"]),
        Spacer(1, 4),
        _p(eng.get("title"), s["RSubtitle"]),
        Spacer(1, 0.15 * inch),
        Paragraph(f"Engagement Reference: {_esc(eng.get('engagement_ref'))}", s["RMeta"]),
        Paragraph(f"Status: {_esc(eng.get('status'))}", s["RMeta"]),
    ]
    if period:
        el.append(Paragraph(f"JE Anomaly Period: {_esc(period)}", s["RMeta"]))
    el.append(Spacer(1, 0.3 * inch))

    team = ", ".join(eng.get("team_members") or []) or None
    meta = [
        ("Entity / Company", company_name),
        ("Audit Unit / Department", eng.get("audit_unit")),
        ("Lead Auditor", eng.get("lead_auditor")),
        ("Team Members", team),
        ("Planned Period", f"{_text(eng.get('planned_start'))} to {_text(eng.get('planned_end'))}"),
        ("Actual Period", f"{_text(eng.get('actual_start'))} to {_text(eng.get('actual_end'))}"),
        ("Overall Risk Rating", eng.get("risk_rating")),
        ("Report Generated", datetime.now(timezone.utc).strftime("%d %b %Y, %H:%M UTC")),
    ]
    el.append(_table(
        [[Paragraph(k, s["RBodyBold"]), _p(v, s["RBody"])] for k, v in meta],
        [2.2 * inch, None], header=False, label_cols=(0,),
    ))
    el.append(Spacer(1, 0.3 * inch))

    for label, key in (("Scope", "scope"), ("Objectives", "objectives")):
        if (eng.get(key) or "").strip():
            el += [Paragraph(label, s["RH2"]), _p(eng[key], s["RBody"])]
    el.append(PageBreak())
    return el


def _executive_summary(num: int, findings: list[dict], je: dict | None, je_num: int | None,
                       today: str, s) -> list:
    el: list = [Paragraph(f"{num}. Executive Summary", s["RH1"]), _rule()]

    total = len(findings)
    by_risk: dict[str, int] = {}
    for f in findings:
        risk = f.get("risk_rating") or "Medium"
        by_risk[risk] = by_risk.get(risk, 0) + 1
    open_count = sum(1 for f in findings if f.get("status") not in _CLOSED)
    overdue = sum(1 for f in findings if is_overdue(f, today))
    crit_high = by_risk.get("Critical", 0) + by_risk.get("High", 0)
    closed = total - open_count

    def kpi(value: int, alert: bool) -> Paragraph:
        c = _hex(_RED if alert else _GREEN)
        return Paragraph(f'<font color="{c}">{value}</font>', s["RKpi"])

    el.append(_table(
        [
            [Paragraph(h, s["RTableH"]) for h in
             ("Total Findings", "Open", "Overdue", "Critical / High", "Implemented / Verified")],
            [Paragraph(str(total), s["RKpi"]), kpi(open_count, open_count > 0), kpi(overdue, overdue > 0),
             kpi(crit_high, crit_high > 0), kpi(closed, False)],
        ],
        [None] * 5, padding=8,
    ))
    el.append(Spacer(1, 12))

    if total:
        el.append(Paragraph("Findings by Risk Rating", s["RH2"]))
        rows = [[Paragraph(h, s["RTableH"]) for h in ("Risk Rating", "Count", "% of Total")]]
        for risk in ("Critical", "High", "Medium", "Low"):
            n = by_risk.get(risk, 0)
            if n:
                rows.append([_colored(risk, _RISK_COLORS, s["RTableC"]), _p(n, s["RTableC"]),
                             _p(f"{n / total * 100:.0f}%", s["RTableC"])])
        el += [_table(rows, [2.5 * inch, 1 * inch, 1.5 * inch]), Spacer(1, 12)]

    if je is not None:
        el.append(Paragraph("Journal Entry Anomalies (R2R Pattern Engine)", s["RH2"]))
        sev, st = je["by_severity"], je["by_status"]
        rows = [
            [Paragraph("Metric", s["RTableH"]), Paragraph("Value", s["RTableH"])],
            ["Period analysed", je["period"]],
            ["Flagged journal entries", je["total"]],
            ["Critical / High", sev.get("Critical", 0) + sev.get("High", 0)],
            ["Cleared by auditor", st.get("Cleared", 0)],
            ["Under review", st.get("Under Review", 0)],
            ["Open / not yet reviewed", st.get("Open", 0)],
            ["Raised as audit findings", je["raised"]],
        ]
        el.append(_table(
            [rows[0]] + [[_p(k, s["RTableC"]), _p(v, s["RTableC"])] for k, v in rows[1:]],
            [3 * inch, 2 * inch],
        ))
        if je["total"] and je_num is not None:
            el += [Spacer(1, 8), _p(
                f"See Section {je_num} for the flagged entries. Critical and High entries "
                "require a management response.", s["RCaption"],
            )]
    return el


def _findings_section(num: int, findings: list[dict], s) -> list:
    el: list = [Paragraph(f"{num}. Audit Findings", s["RH1"]), _rule()]
    if not findings:
        return el + [_p("No findings were recorded for this engagement.", s["RBody"])]

    ordered = sorted(findings, key=lambda f: (_RISK_ORDER.get(f.get("risk_rating"), 3), f.get("id") or 0))
    for idx, f in enumerate(ordered, 1):
        risk = _text(f.get("risk_rating"))
        c = _hex(_RISK_COLORS.get(risk, _GREY))
        heading = Paragraph(
            f"<b>Finding {idx}: {_esc(f.get('title'))}</b> "
            f'<font color="{c}">[{escape(risk)}]</font>',
            s["RH2"],
        )
        details = [
            ("Finding Ref", f.get("finding_ref"), "Status", f.get("status")),
            ("Root Cause", f.get("root_cause"), "Action Owner", f.get("action_owner")),
            ("Due Date", f.get("action_due_date"), "Repeat Finding",
             f"Yes ({f['repeat_from_year']})" if f.get("is_repeat") and f.get("repeat_from_year")
             else ("Yes" if f.get("is_repeat") else "No")),
            ("Evidence Ref", f.get("evidence_ref"), "", ""),
        ]
        table = _table(
            [[Paragraph(a, s["RBodyBold"]), _p(b, s["RTableC"]),
              Paragraph(c_, s["RBodyBold"]), _p(d, s["RTableC"]) if c_ else ""]
             for a, b, c_, d in details],
            _cols(0.18, 0.32, 0.18, 0.32),
            header=False, label_cols=(0, 2), padding=5,
        )
        el += [KeepTogether([heading, _rule(1, _BORDER), table]), Spacer(1, 6)]

        for label, key in (
            ("Observation / Control Gap", "control_gap"),
            ("Description", "description"),
            ("Recommendation", "recommendation"),
            ("Management Response", "management_response"),
        ):
            if (f.get(key) or "").strip():
                el += [Paragraph(f"<b>{label}</b>", s["RBody"]), _p(f[key], s["RBody"])]
        el.append(Spacer(1, 10))
    return el


def _capa_section(num: int, findings: list[dict], today: str, s) -> list:
    el: list = [Paragraph(f"{num}. Corrective Action Plan (CAPA) Tracker", s["RH1"]), _rule()]
    open_f = [f for f in findings if f.get("status") not in _CLOSED]
    if not open_f:
        return el + [_p("All findings have been implemented or verified. No open corrective actions.", s["RBody"])]

    rows = [[Paragraph(h, s["RTableH"]) for h in ("Ref", "Finding", "Risk", "Owner", "Due Date", "Status")]]
    for f in sorted(open_f, key=lambda x: x.get("action_due_date") or "9999"):
        due = _esc(f.get("action_due_date"))
        if is_overdue(f, today):
            due = f'<font color="{_hex(_RED)}"><b>{due} (overdue)</b></font>'
        title = _text(f.get("title"))
        rows.append([
            _p(f.get("finding_ref"), s["RTableC"]),
            _p(title[:80] + ("…" if len(title) > 80 else ""), s["RTableC"]),
            _colored(f.get("risk_rating"), _RISK_COLORS, s["RTableC"]),
            _p(f.get("action_owner"), s["RTableC"]),
            Paragraph(due, s["RTableC"]),
            _colored(f.get("status"), _STATUS_COLORS, s["RTableC"]),
        ])
    el.append(_table(rows, _cols(0.11, 0.31, 0.11, 0.17, 0.16, 0.14), repeat=True))

    overdue = sum(1 for f in open_f if is_overdue(f, today))
    if overdue:
        el += [Spacer(1, 6), _p(
            f"{overdue} finding(s) are past their remediation due date and require escalation.",
            s["RCaption"],
        )]
    return el


def _je_section(num: int, entries: list[dict], period: str, s) -> list:
    el: list = [Paragraph(f"{num}. Journal Entry Anomaly Detail (R2R Pattern Engine)", s["RH1"]), _rule()]
    if not entries:
        return el + [_p(
            f"No journal entries were flagged for review in period {period}. Either the period "
            "has not been analysed against the historical baseline, or no entry scored above 60.",
            s["RBody"],
        )]

    el += [_p(
        f"Journal entries flagged by the R2R Pattern Engine for period {period}. "
        "Review-queue bands: Critical above 85, High 70 to 85, Medium 60 to 70.",
        s["RBody"],
    ), Spacer(1, 6)]

    hs, cs = s["RTableHS"], s["RTableCS"]
    rows = [[Paragraph(h, hs) for h in
             ("Journal ID", "Date", "Account", "Amount", "User", "Score", "Severity", "Status")]]
    for e in entries[:JE_TABLE_LIMIT]:
        amount = e.get("amount")
        rows.append([
            _p(_text(e.get("journal_id"))[:18], cs),
            _p(_text(e.get("posting_date"))[:10], cs),
            _p(_text(e.get("account_name") or e.get("account"))[:28], cs),
            _p(f"{amount:,.0f}" if isinstance(amount, (int, float)) else None, cs),
            _p(_text(e.get("user_id"))[:14], cs),
            _p(f"{float(e.get('risk_score') or 0):.0f}", cs),
            _colored(e.get("severity"), _RISK_COLORS, cs),
            _colored(e.get("status"), _STATUS_COLORS, cs),
        ])
    el.append(_table(
        rows,
        _cols(0.136, 0.122, 0.18, 0.122, 0.108, 0.08, 0.115, 0.137),
        padding=4, repeat=True,
    ))
    if len(entries) > JE_TABLE_LIMIT:
        el += [Spacer(1, 4), _p(
            f"Showing the top {JE_TABLE_LIMIT} of {len(entries)} flagged entries. "
            "Export the full list from Internal Audit > JE Review.",
            s["RCaption"],
        )]

    reasons: dict[str, int] = {}
    for e in entries:
        for r in e.get("top_reasons") or []:
            if isinstance(r, str) and r.strip():
                reasons[r] = reasons.get(r, 0) + 1
    if reasons:
        rows = [[Paragraph("Pattern", s["RTableH"]), Paragraph("Entries", s["RTableH"])]]
        rows += [[_p(r, s["RTableC"]), _p(n, s["RTableC"])]
                 for r, n in sorted(reasons.items(), key=lambda x: -x[1])[:8]]
        el += [Spacer(1, 10), Paragraph("Most Common Anomaly Patterns", s["RH2"]),
               _table(rows, [5 * inch, 1.5 * inch])]
    return el


def _signoff_section(num: int, eng: dict, s) -> list:
    rows = [
        [Paragraph("Lead Auditor", s["RBodyBold"]), _p(eng.get("lead_auditor"), s["RBody"]),
         Paragraph("Date", s["RBodyBold"]), _p(date.today().strftime("%d %b %Y"), s["RBody"])],
        [Paragraph("Engagement Ref", s["RBodyBold"]), _p(eng.get("engagement_ref"), s["RBody"]),
         Paragraph("Status", s["RBodyBold"]), _p(eng.get("status"), s["RBody"])],
        [Paragraph("Signature", s["RBodyBold"]), "", Paragraph("Reviewed by", s["RBodyBold"]), ""],
    ]
    return [
        Paragraph(f"{num}. Auditor Sign-off", s["RH1"]),
        _rule(),
        _table(rows, _cols(0.19, 0.31, 0.19, 0.31), header=False, label_cols=(0, 2), padding=8),
        Spacer(1, 0.3 * inch),
        _p(
            f"This report was produced by the {BRAND} Internal Audit module and is confidential. "
            "Distribution is restricted to authorised personnel. Findings and recommendations are "
            "based on the procedures performed during the engagement.",
            s["RCaption"],
        ),
    ]


def _footer(canvas, doc) -> None:
    canvas.saveState()
    canvas.setStrokeColor(_AMBER)
    canvas.setLineWidth(1)
    canvas.line(MARGIN, 0.55 * inch, PAGE_W - MARGIN, 0.55 * inch)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(_GREY)
    canvas.drawString(MARGIN, 0.4 * inch, f"CONFIDENTIAL — {BRAND} Internal Audit Report")
    canvas.drawRightString(PAGE_W - MARGIN, 0.4 * inch, f"Page {doc.page}")
    canvas.restoreState()


def build_internal_audit_report_pdf(
    *,
    engagement: dict[str, Any],
    findings: list[dict[str, Any]],
    company_name: str | None,
    je_entries: list[dict[str, Any]] | None = None,
    period: str | None = None,
) -> bytes:
    """Return PDF bytes. The JE section is included only when `period` is given.

    `je_entries` are serialised JEAnomalyReview rows for that period, highest risk first.
    """
    s = _styles()
    today = date.today().isoformat()
    entries = je_entries or []

    je_summary = None
    if period:
        stats = summarize(entries)
        je_summary = {
            **stats,
            "period": period,
            "raised": sum(1 for e in entries if e.get("finding_id")),
        }

    nums = iter(range(1, 6))
    exec_num, findings_num, capa_num = next(nums), next(nums), next(nums)
    je_num = next(nums) if period else None
    signoff_num = next(nums)

    story: list = _cover(engagement, _text(company_name), period, s)
    story += _executive_summary(exec_num, findings, je_summary, je_num, today, s)
    story += [PageBreak(), *_findings_section(findings_num, findings, s)]
    story += [PageBreak(), *_capa_section(capa_num, findings, today, s)]
    if je_num is not None:
        story += [PageBreak(), *_je_section(je_num, entries, period, s)]
    story += [PageBreak(), *_signoff_section(signoff_num, engagement, s)]

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        topMargin=MARGIN,
        bottomMargin=MARGIN + 0.2 * inch,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        title=f"Internal Audit Report — {_text(engagement.get('title'))}",
        author=BRAND,
        subject="Internal Audit Report",
    )
    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()
