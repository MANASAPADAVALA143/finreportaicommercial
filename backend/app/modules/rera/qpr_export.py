"""QPR (Quarterly Project Report) export — PDF (reportlab) and CSV."""
from __future__ import annotations

import csv
import io
from datetime import date
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def _money(v: Any, currency: str) -> str:
    try:
        amount = float(v or 0)
    except (TypeError, ValueError):
        amount = 0.0
    if currency == "INR":
        return f"₹{amount:,.2f}"
    return f"AED {amount:,.2f}"


def build_qpr_pdf(*, project: dict[str, Any], qpr: dict[str, Any]) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=0.6 * inch, bottomMargin=0.6 * inch)
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="QPRTitle", parent=styles["Title"], textColor=colors.HexColor("#0A4D4D")))
    styles.add(ParagraphStyle(name="QPRHeading", parent=styles["Heading2"], textColor=colors.HexColor("#0A4D4D")))
    currency = project.get("currency", "AED")
    story: list = []

    story.append(Paragraph(project.get("name", "Project"), styles["QPRTitle"]))
    story.append(Paragraph(f"Quarterly Project Report — {qpr.get('quarter', '')}", styles["Heading2"]))
    story.append(Spacer(1, 10))

    details = [
        ["RERA Number", project.get("rera_number", "-")],
        ["Location", project.get("location", "-")],
        ["Total Units", str(project.get("total_units", "-"))],
        ["Report Date", date.today().isoformat()],
    ]
    t = Table(details, colWidths=[2.2 * inch, 3.3 * inch])
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.grey), ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold")]))
    story.append(t)
    story.append(Spacer(1, 16))

    story.append(Paragraph("Collections & Escrow", styles["QPRHeading"]))
    fin_rows = [
        ["Metric", "Amount"],
        ["Total Collections", _money(qpr.get("total_collections"), currency)],
        ["Escrow Deposited", _money(qpr.get("escrow_deposited"), currency)],
        ["Withdrawals", _money(qpr.get("withdrawals"), currency)],
    ]
    ft = Table(fin_rows, colWidths=[2.8 * inch, 2.7 * inch])
    ft.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0A4D4D")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ]
        )
    )
    story.append(ft)
    story.append(Spacer(1, 16))

    story.append(Paragraph("Construction Progress vs Utilization", styles["QPRHeading"]))
    progress = float(qpr.get("construction_progress") or 0)
    utilization = float(qpr.get("utilization") or 0)
    variance = utilization - progress
    prog_rows = [
        ["Metric", "%"],
        ["Construction Progress", f"{progress:.2f}%"],
        ["Fund Utilization", f"{utilization:.2f}%"],
        ["Variance (Utilization − Progress)", f"{variance:+.2f}%"],
    ]
    pt = Table(prog_rows, colWidths=[2.8 * inch, 2.7 * inch])
    pt.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0A4D4D")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("TEXTCOLOR", (1, 3), (1, 3), colors.red if variance > 10 else colors.black),
            ]
        )
    )
    story.append(pt)
    story.append(Spacer(1, 16))
    story.append(Paragraph(f"Status: {qpr.get('status', 'draft').upper()}", styles["Normal"]))

    doc.build(story)
    return buf.getvalue()


def build_qpr_csv(*, project: dict[str, Any], qpr: dict[str, Any]) -> str:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Project", project.get("name", "")])
    writer.writerow(["RERA Number", project.get("rera_number", "")])
    writer.writerow(["Quarter", qpr.get("quarter", "")])
    writer.writerow([])
    writer.writerow(["Metric", "Value"])
    writer.writerow(["Total Collections", qpr.get("total_collections")])
    writer.writerow(["Escrow Deposited", qpr.get("escrow_deposited")])
    writer.writerow(["Withdrawals", qpr.get("withdrawals")])
    writer.writerow(["Construction Progress %", qpr.get("construction_progress")])
    writer.writerow(["Utilization %", qpr.get("utilization")])
    writer.writerow(["Status", qpr.get("status")])
    return out.getvalue()
