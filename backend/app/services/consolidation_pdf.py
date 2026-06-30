"""Consolidation group report PDF export."""

from __future__ import annotations

import io
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def _fmt(n: float) -> str:
    if n < 0:
        return f"({abs(n):,.0f})"
    return f"{n:,.0f}"


def _table(data: list[list[str]], col_widths: list[float] | None = None) -> Table:
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f766e")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
    ]))
    return t


def generate_consolidation_pdf(
    *,
    period_name: str,
    companies: list[dict[str, Any]],
    pl: dict[str, Any],
    bs: dict[str, Any],
    generated_at: str,
) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, rightMargin=40, leftMargin=40, topMargin=48, bottomMargin=40)
    styles = getSampleStyleSheet()
    title = ParagraphStyle("Title", parent=styles["Title"], fontSize=20, spaceAfter=12)
    sub = ParagraphStyle("Sub", parent=styles["Normal"], fontSize=11, textColor=colors.grey)
    story = []

    story.append(Paragraph("Group Consolidated Report", title))
    story.append(Paragraph(f"Period: {period_name}", sub))
    story.append(Paragraph(f"Generated: {generated_at}", sub))
    names = ", ".join(c.get("company_name", "") for c in companies)
    story.append(Paragraph(f"Companies: {names}", sub))
    story.append(Spacer(1, 0.3 * inch))

    # P&L
    story.append(Paragraph("Consolidated Profit & Loss", styles["Heading2"]))
    pl_header = ["Account"] + [c["company_name"][:12] for c in companies] + ["Elim.", "Group"]
    pl_data = [pl_header]
    for row in pl.get("rows", []):
        pl_data.append([
            row["label"],
            *[_fmt(row.get("companies", {}).get(c["id"], 0)) for c in companies],
            _fmt(row.get("eliminations", 0)),
            _fmt(row.get("group_total", 0)),
        ])
    story.append(_table(pl_data))
    story.append(PageBreak())

    # BS
    story.append(Paragraph("Consolidated Balance Sheet", styles["Heading2"]))
    bs_header = ["Account"] + [c["company_name"][:12] for c in companies] + ["Elim.", "Group"]
    bs_data = [bs_header]
    for row in bs.get("rows", []):
        bs_data.append([
            row["label"],
            *[_fmt(row.get("companies", {}).get(c["id"], 0)) for c in companies],
            _fmt(row.get("eliminations", 0)),
            _fmt(row.get("group_total", 0)),
        ])
    story.append(_table(bs_data))
    story.append(PageBreak())

    # Individual P&L per company
    for c in companies:
        story.append(Paragraph(f"{c['company_name']} — P&L", styles["Heading2"]))
        cid = c["id"]
        co_data = [["Line", "Amount (AED)"]]
        for row in pl.get("rows", []):
            co_data.append([row["label"], _fmt(row.get("companies", {}).get(cid, 0))])
        story.append(_table(co_data, col_widths=[3.5 * inch, 2 * inch]))
        story.append(PageBreak())

    doc.build(story)
    return buf.getvalue()
