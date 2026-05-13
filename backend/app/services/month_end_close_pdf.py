"""IFRS month-end close report PDF (reportlab)."""

from __future__ import annotations

import io
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def build_close_pdf_bytes(
    *,
    company_name: str,
    period: str,
    prepared_by: str,
    checks_payload: dict[str, Any],
    integrity: dict[str, Any],
    currency: str,
) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        rightMargin=54,
        leftMargin=54,
        topMargin=54,
        bottomMargin=54,
    )
    styles = getSampleStyleSheet()
    story: list = []

    sym = "₹" if (currency or "INR").upper() == "INR" else "$"

    story.append(Paragraph("<b>IFRS month-end close report</b>", styles["Title"]))
    story.append(Spacer(1, 0.2 * inch))
    story.append(Paragraph(f"<b>Entity:</b> {company_name}", styles["Normal"]))
    story.append(Paragraph(f"<b>Period:</b> {period}", styles["Normal"]))
    story.append(Paragraph(f"<b>Prepared by:</b> {prepared_by}", styles["Normal"]))
    story.append(PageBreak())

    # Page 2 — checklist table
    story.append(Paragraph("<b>Close checklist summary</b>", styles["Heading2"]))
    rows = [["#", "Check", "Status", "Summary"]]
    for i, it in enumerate(checks_payload.get("items") or [], start=1):
        rows.append(
            [
                str(i),
                str(it.get("name", "")),
                str(it.get("status", "")),
                str(it.get("result_summary", ""))[:120],
            ]
        )
    t = Table(rows, colWidths=[0.35 * inch, 1.9 * inch, 0.9 * inch, 3.0 * inch])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a5f")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
            ]
        )
    )
    story.append(t)
    story.append(PageBreak())

    # Page 3 — integrity
    story.append(Paragraph("<b>Three-statement integrity (IAS 1)</b>", styles["Heading2"]))
    if integrity:
        lines = [
            f"Profit or loss (PAT): {sym}{integrity.get('pl_net_income', 0):,.2f}",
            f"Retained earnings opening / closing: {sym}{integrity.get('retained_earnings_opening', 0):,.2f} / {sym}{integrity.get('retained_earnings_closing', 0):,.2f}",
            f"RE bridge variance: {sym}{integrity.get('re_bridge_variance', 0):,.2f} (pass: {integrity.get('re_bridge_ok')})",
            f"Cash opening / expected closing / BS cash: {sym}{integrity.get('cash_opening', 0):,.2f} / {sym}{integrity.get('cash_expected_closing', 0):,.2f} / {sym}{integrity.get('cash_closing_bs', 0):,.2f}",
            f"Cash bridge variance: {sym}{integrity.get('cash_bridge_variance', 0):,.2f} (pass: {integrity.get('cash_bridge_ok')})",
            f"Total assets vs liabilities+equity: {sym}{integrity.get('total_assets', 0):,.2f} vs {sym}{integrity.get('total_liabilities_plus_equity', 0):,.2f} (variance {sym}{integrity.get('balance_sheet_variance', 0):,.2f})",
        ]
        for ln in lines:
            story.append(Paragraph(ln, styles["Normal"]))
    else:
        story.append(Paragraph("No integrity block captured for this run.", styles["Normal"]))
    story.append(PageBreak())

    # Page 4 — flagged
    story.append(Paragraph("<b>Flagged items</b>", styles["Heading2"]))
    bullets: list[str] = []
    for it in checks_payload.get("items") or []:
        if it.get("status") in ("flagged", "failed", "check_error"):
            bullets.append(f"{it.get('name')}: {it.get('result_summary', '')[:200]}")
    if not bullets:
        story.append(Paragraph("No flagged checks on this run.", styles["Normal"]))
    else:
        for b in bullets:
            story.append(Paragraph(f"• {b}", styles["Normal"]))
    story.append(PageBreak())

    # Page 5 — sign-off
    story.append(Paragraph("<b>CFO sign-off</b>", styles["Heading2"]))
    story.append(Paragraph("Approved by: ___________________________", styles["Normal"]))
    story.append(Paragraph("Date: ___________________________", styles["Normal"]))
    story.append(Spacer(1, 0.2 * inch))
    story.append(Paragraph("<i>Digital signature line — binders per entity policy.</i>", styles["Italic"]))

    doc.build(story)
    return buf.getvalue()
