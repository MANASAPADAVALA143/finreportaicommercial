"""IFRS 16 audit-ready disclosure PDF (reportlab)."""
from __future__ import annotations

import io
import json
from datetime import date, datetime
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def build_ifrs16_audit_pdf(
    *,
    company_name: str,
    period_date: str,
    prepared_by: str,
    portfolio: dict[str, Any],
    leases: list[dict[str, Any]],
) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=0.6 * inch, bottomMargin=0.6 * inch)
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="Title16", parent=styles["Title"], textColor=colors.HexColor("#0A4D4D"), spaceAfter=12))
    styles.add(ParagraphStyle(name="H16", parent=styles["Heading2"], textColor=colors.HexColor("#0A4D4D"), spaceAfter=6))
    story: list = []

    # Page 1 — Cover
    story.append(Paragraph(company_name or "Company", styles["Title16"]))
    story.append(Paragraph("IFRS 16 Lease Accounting Disclosure", styles["Title"]))
    story.append(Spacer(1, 12))
    story.append(Paragraph(f"Period: {period_date}", styles["Normal"]))
    story.append(Paragraph(f"Prepared by: {prepared_by}", styles["Normal"]))
    story.append(Paragraph(f"Date generated: {date.today().isoformat()}", styles["Normal"]))
    story.append(PageBreak())

    # Page 2 — Portfolio Summary
    story.append(Paragraph("Portfolio Summary", styles["H16"]))
    summary_data = [
        ["Metric", "Amount (AED)"],
        ["Total ROU Assets", f"{portfolio.get('total_rou_assets_aed', 0):,.2f}"],
        ["Total Lease Liability", f"{portfolio.get('total_lease_liability_aed', 0):,.2f}"],
        ["Active Leases", str(portfolio.get("active_leases", 0))],
        ["Depreciation YTD", f"{portfolio.get('total_depreciation_ytd', 0):,.2f}"],
        ["Interest YTD", f"{portfolio.get('total_interest_ytd', 0):,.2f}"],
    ]
    t = Table(summary_data, colWidths=[3 * inch, 2.5 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0A4D4D")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
    ]))
    story.append(t)
    story.append(Spacer(1, 16))

    by_class = portfolio.get("by_asset_class") or {}
    if by_class:
        story.append(Paragraph("By Asset Class", styles["H16"]))
        class_rows = [["Class", "Count", "ROU Asset", "Liability"]]
        for cls, vals in by_class.items():
            class_rows.append([
                cls.title(),
                str(vals.get("count", 0)),
                f"{_f(vals.get('rou_asset')):,.2f}",
                f"{_f(vals.get('liability')):,.2f}",
            ])
        ct = Table(class_rows, colWidths=[1.5 * inch, 0.8 * inch, 1.5 * inch, 1.5 * inch])
        ct.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.grey)]))
        story.append(ct)
    story.append(PageBreak())

    # Per lease detail
    for lease in leases:
        if lease.get("status") != "active":
            continue
        story.append(Paragraph(f"Lease: {lease.get('lease_name', '')}", styles["H16"]))
        detail = [
            ["Field", "Value"],
            ["Asset", lease.get("asset_description", "")],
            ["Commencement", lease.get("commencement_date", "")],
            ["Term (months)", str(lease.get("lease_term_months", ""))],
            ["IBR", f"{_f(lease.get('incremental_borrowing_rate')) * 100:.2f}%"],
            ["Monthly Payment", f"{_f(lease.get('lease_payments_aed')):,.2f}"],
            ["Initial ROU Asset", f"{_f(lease.get('rou_asset_initial')):,.2f}"],
            ["Initial Liability", f"{_f(lease.get('lease_liability_initial')):,.2f}"],
            ["Current ROU Asset", f"{_f(lease.get('rou_asset_current')):,.2f}"],
            ["Current Liability", f"{_f(lease.get('lease_liability_current')):,.2f}"],
        ]
        dt = Table(detail, colWidths=[2 * inch, 3.5 * inch])
        dt.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.grey)]))
        story.append(dt)
        story.append(Spacer(1, 8))

        calc = lease.get("calculation_results") or {}
        schedule = calc.get("amortization_schedule") or []
        if schedule:
            story.append(Paragraph("Amortisation Schedule (first 6 periods)", styles["Normal"]))
            sched_rows = [["Period", "Date", "Payment", "Interest", "Principal", "Closing"]]
            for row in schedule[:6]:
                sched_rows.append([
                    str(row.get("Period") or row.get("period") or ""),
                    str(row.get("Date") or row.get("date") or ""),
                    f"{_f(row.get('Payment') or row.get('payment')):,.0f}",
                    f"{_f(row.get('Interest') or row.get('interest')):,.0f}",
                    f"{_f(row.get('Principal') or row.get('principal')):,.0f}",
                    f"{_f(row.get('Closing_Balance') or row.get('closing_liability')):,.0f}",
                ])
            st = Table(sched_rows, colWidths=[0.6 * inch] * 6)
            st.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.grey), ("FONTSIZE", (0, 0), (-1, -1), 7)]))
            story.append(st)
        story.append(PageBreak())

    # Disclosure note
    story.append(Paragraph("IFRS 16 Disclosure Note", styles["H16"]))
    total_ll = _f(portfolio.get("total_lease_liability_aed"))
    lt1 = total_ll * 0.35
    b15 = total_ll * 0.50
    gt5 = total_ll * 0.15
    ibrs = [_f(l.get("incremental_borrowing_rate")) for l in leases if l.get("status") == "active"]
    avg_ibr = (sum(ibrs) / len(ibrs) * 100) if ibrs else 0

    disc = [
        ["Right-of-use assets — closing balance", f"AED {portfolio.get('total_rou_assets_aed', 0):,.2f}"],
        ["Lease liabilities — maturity < 1 year", f"AED {lt1:,.2f}"],
        ["Lease liabilities — 1 to 5 years", f"AED {b15:,.2f}"],
        ["Lease liabilities — > 5 years", f"AED {gt5:,.2f}"],
        ["Total lease liability (discounted)", f"AED {total_ll:,.2f}"],
        ["Depreciation charge (YTD)", f"AED {portfolio.get('total_depreciation_ytd', 0):,.2f}"],
        ["Interest on lease liabilities (YTD)", f"AED {portfolio.get('total_interest_ytd', 0):,.2f}"],
        ["Weighted average IBR applied", f"{avg_ibr:.2f}%"],
    ]
    dt2 = Table(disc, colWidths=[3.5 * inch, 2 * inch])
    dt2.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.grey)]))
    story.append(dt2)

    doc.build(story)
    return buf.getvalue()
