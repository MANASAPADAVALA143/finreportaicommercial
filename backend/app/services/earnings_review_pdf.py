"""Six-page earnings review PDF (reportlab)."""

from __future__ import annotations

import io
from typing import Any
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def build_earnings_pdf_bytes(
    *,
    company_name: str,
    period: str,
    headline: str,
    quality_score: float,
    variances: dict[str, Any],
    commentary_full: str,
    flags: list[dict],
    currency: str,
) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, rightMargin=54, leftMargin=54, topMargin=54, bottomMargin=54)
    styles = getSampleStyleSheet()
    story: list = []
    sym = "₹" if (currency or "INR").upper() == "INR" else "$"
    cur = variances.get("current") or {}
    prior = variances.get("prior") or {}
    bud = variances.get("budget")

    # Page 1
    story.append(Paragraph("<b>Earnings scorecard</b>", styles["Title"]))
    story.append(Spacer(1, 0.15 * inch))
    story.append(Paragraph(f"<b>Entity:</b> {company_name}", styles["Normal"]))
    story.append(Paragraph(f"<b>Period:</b> {period}", styles["Normal"]))
    story.append(Paragraph(f"<b>Quality score: {quality_score:.0f} / 100</b>", styles["Heading2"]))
    story.append(Paragraph(f"<b>Headline vs plan / consensus:</b> {headline}", styles["Normal"]))
    story.append(Spacer(1, 0.2 * inch))

    rows = [["Metric", "Actual", "Prior", "Var %", "Budget", "vs Bud %"]]
    for key, disp in [
        ("revenue", "Turnover / revenue"),
        ("gross_profit", "Gross profit"),
        ("ebitda", "EBITDA"),
        ("net_income", "Profit after tax"),
    ]:
        a = float(cur.get(key, 0) or 0)
        p = float(prior.get(key, 0) or 0)
        vp = (a - p) / abs(p) * 100 if abs(p) > 1e-9 else 0.0
        b = float(bud.get(key, 0) or 0) if bud else None
        vb = (a - b) / abs(b) * 100 if b is not None and abs(b) > 1e-9 else None
        rows.append(
            [
                disp,
                f"{sym}{a:,.0f}",
                f"{sym}{p:,.0f}",
                f"{vp:+.1f}%",
                f"{sym}{b:,.0f}" if b is not None else "—",
                f"{vb:+.1f}%" if vb is not None else "—",
            ]
        )
    t = Table(rows, colWidths=[1.5 * inch, 1.0 * inch, 1.0 * inch, 0.85 * inch, 1.0 * inch, 0.9 * inch])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a5f")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
            ]
        )
    )
    story.append(t)
    story.append(PageBreak())

    # Page 2 — bridge text
    story.append(Paragraph("<b>Revenue &amp; margin bridge</b>", styles["Heading2"]))
    rv = float(cur.get("revenue", 0) or 0)
    pv = float(prior.get("revenue", 0) or 0)
    story.append(
        Paragraph(
            f"Prior turnover {sym}{pv:,.0f} → change {sym}{rv - pv:,.0f} → current {sym}{rv:,.0f}.",
            styles["Normal"],
        )
    )
    story.append(
        Paragraph(
            f"EBITDA margin: prior {float(prior.get('ebitda_margin_pct', 0) or 0):.2f}% → "
            f"current {float(cur.get('ebitda_margin_pct', 0) or 0):.2f}%.",
            styles["Normal"],
        )
    )
    story.append(PageBreak())

    # Page 3 — Group A
    story.append(Paragraph("<b>Period-over-period analysis</b>", styles["Heading2"]))
    for ch in variances.get("group_a") or []:
        story.append(Paragraph(f"<b>{ch.get('id')} {ch.get('name')}</b> — {ch.get('status')}", styles["Normal"]))
        story.append(Paragraph(str(ch.get("result_summary", "")), styles["Normal"]))
        story.append(Spacer(1, 0.08 * inch))
    story.append(PageBreak())

    # Page 4 — B + C
    story.append(Paragraph("<b>Budget &amp; consensus</b>", styles["Heading2"]))
    for ch in (variances.get("group_b") or []) + (variances.get("group_c") or []):
        story.append(Paragraph(f"<b>{ch.get('id')}</b> {ch.get('name')}: {ch.get('result_summary', '')}", styles["Normal"]))
    ss = variances.get("surprise_score_pct")
    if ss is not None:
        story.append(Paragraph(f"<b>Composite surprise:</b> {ss:+.2f}%", styles["Normal"]))
    story.append(PageBreak())

    # Page 5 — commentary
    story.append(Paragraph("<b>CFO commentary (AI-generated or template)</b>", styles["Heading2"]))
    for para in commentary_full.split("\n\n"):
        if para.strip():
            safe = escape(para.strip()).replace("\n", "<br/>")
            story.append(Paragraph(safe, styles["Normal"]))
            story.append(Spacer(1, 0.1 * inch))
    story.append(PageBreak())

    # Page 6 — flags
    story.append(Paragraph("<b>Red flags &amp; recommendations</b>", styles["Heading2"]))
    for f in flags:
        story.append(
            Paragraph(
                f"<b>{f.get('severity', '').upper()}</b> — {f.get('metric')}: {f.get('finding')} "
                f"<i>Action: {f.get('recommendation')}</i>",
                styles["Normal"],
            )
        )
        story.append(Spacer(1, 0.06 * inch))
    story.append(Spacer(1, 0.2 * inch))
    story.append(Paragraph("CFO sign-off: ___________________________  Date: __________", styles["Normal"]))

    doc.build(story)
    return buf.getvalue()
