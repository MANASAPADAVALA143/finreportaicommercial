"""GL reconciliation certificate PDF (reportlab, 5 pages)."""

from __future__ import annotations

import io
from typing import Any
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def format_inr_indian(n: float) -> str:
    """Indian digit grouping: ₹12,34,567.89"""
    sign = "-" if n < 0 else ""
    x = f"{abs(n):.2f}"
    if "." in x:
        intpart, frac = x.split(".", 1)
    else:
        intpart, frac = x, "00"
    intpart = intpart.lstrip("0") or "0"
    if len(intpart) <= 3:
        return f"{sign}₹{intpart}.{frac}"
    tail = intpart[-3:]
    head = intpart[:-3]
    parts: list[str] = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return f"{sign}₹{','.join(parts)},{tail}.{frac}"


def format_money(n: float, currency: str) -> str:
    if (currency or "INR").upper() == "INR":
        return format_inr_indian(n)
    return f"${abs(n):,.2f}" if n >= 0 else f"-${abs(n):,.2f}"


def build_gl_recon_pdf_bytes(
    *,
    company_name: str,
    account_code: str,
    account_name: str,
    period: str,
    summary: dict[str, Any],
    matches_sample: list[dict],
    unmatched_gl: list[dict],
    unmatched_bank: list[dict],
    suggested_jes: list[dict],
    currency: str,
) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, rightMargin=54, leftMargin=54, topMargin=54, bottomMargin=54)
    styles = getSampleStyleSheet()
    story: list = []
    sym = format_money
    status = summary.get("reconciliation_status", "BREAKS EXIST")
    status_txt = {"CLEAN": "CLEAN", "MATERIAL BREAK": "MATERIAL BREAK", "BREAKS EXIST": "BREAKS EXIST"}.get(status, status)

    # Page 1
    story.append(Paragraph("<b>Reconciliation certificate</b>", styles["Title"]))
    story.append(Spacer(1, 0.15 * inch))
    story.append(Paragraph(escape(f"Entity: {company_name}"), styles["Normal"]))
    story.append(Paragraph(escape(f"GL account: {account_code} — {account_name}"), styles["Normal"]))
    story.append(Paragraph(escape(f"Period: {period}"), styles["Normal"]))
    story.append(Spacer(1, 0.12 * inch))
    story.append(Paragraph(f"<b>Status:</b> {escape(status_txt)}", styles["Heading3"]))
    story.append(
        Paragraph(
            f"GL total (signed): {sym(float(summary.get('gl_total', 0)), currency)} | "
            f"Bank net change: {sym(float(summary.get('bank_net_change', 0)), currency)} | "
            f"Difference: {sym(float(summary.get('difference', 0)), currency)}",
            styles["Normal"],
        )
    )
    story.append(
        Paragraph(
            f"Match rate: {summary.get('match_rate_pct', 0):.1f}% — matched {summary.get('matched_count', 0)} pairs "
            f"(amount {sym(float(summary.get('matched_amount', 0)), currency)}).",
            styles["Normal"],
        )
    )
    story.append(PageBreak())

    # Page 2 summary table
    story.append(Paragraph("<b>Reconciliation summary</b>", styles["Heading2"]))
    ob = summary.get("bank_opening_balance")
    cb = summary.get("bank_closing_balance")
    rows = [
        ["Opening bank balance (derived)", sym(float(ob), currency) if ob is not None else "—"],
        ["GL signed total (period)", sym(float(summary.get("gl_total", 0)), currency)],
        ["Bank net change (closing − opening)", sym(float(summary.get("bank_net_change", 0)), currency)],
        ["Difference (GL total − bank net change)", sym(float(summary.get("difference", 0)), currency)],
    ]
    t = Table(rows, colWidths=[3.2 * inch, 2.2 * inch])
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.25, colors.grey), ("FONTSIZE", (0, 0), (-1, -1), 9)]))
    story.append(t)
    story.append(Spacer(1, 0.15 * inch))
    br = summary.get("breaks_by_category") or {}
    if br:
        story.append(Paragraph("<b>Breaks by category</b>", styles["Normal"]))
        for k, v in br.items():
            story.append(Paragraph(escape(f"{k}: {int(v.get('count', 0))} items, {sym(float(v.get('amount', 0)), currency)}"), styles["Normal"]))
    story.append(PageBreak())

    # Page 3 matched sample
    story.append(Paragraph("<b>Matched transactions (sample)</b>", styles["Heading2"]))
    mh = ["GL Date", "GL Ref", "Amt", "Bank Date", "Bank Ref", "Conf."]
    mr = [mh]
    for m in matches_sample[:20]:
        mr.append(
            [
                str(m.get("gl_date", ""))[:10],
                str(m.get("gl_ref", ""))[:12],
                sym(float(m.get("amount", 0)), currency),
                str(m.get("bank_date", ""))[:10],
                str(m.get("bank_ref", ""))[:12],
                f"{m.get('confidence', '')}%",
            ]
        )
    t2 = Table(mr, colWidths=[0.85 * inch, 0.9 * inch, 1.1 * inch, 0.85 * inch, 0.9 * inch, 0.65 * inch])
    t2.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a5f")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                ("FONTSIZE", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.append(t2)
    story.append(PageBreak())

    # Page 4 unmatched + JEs
    story.append(Paragraph("<b>Unmatched items (excerpt)</b>", styles["Heading2"]))
    for u in (unmatched_gl + unmatched_bank)[:25]:
        story.append(
            Paragraph(
                escape(f"{u.get('source')} | {u.get('category')} | {u.get('date')} | {sym(float(u.get('amount', 0)), currency)} | {u.get('description', '')[:80]}"),
                styles["Normal"],
            )
        )
    story.append(Spacer(1, 0.1 * inch))
    story.append(Paragraph("<b>Suggested journal entries (pending review)</b>", styles["Heading3"]))
    for je in suggested_jes[:15]:
        story.append(
            Paragraph(
                escape(
                    f"DR {je.get('debit_account')} {sym(float(je.get('amount', 0)), currency)} / "
                    f"CR {je.get('credit_account')} — {je.get('description', '')[:60]}"
                ),
                styles["Normal"],
            )
        )
    story.append(PageBreak())

    # Page 5 sign-off
    story.append(Paragraph("<b>Sign-off</b>", styles["Heading2"]))
    story.append(Paragraph("Prepared by: ___________________________", styles["Normal"]))
    story.append(Paragraph("Reviewed by: ___________________________", styles["Normal"]))
    story.append(Paragraph("Approved by: ___________________________", styles["Normal"]))
    story.append(Paragraph("Date: ___________________________", styles["Normal"]))
    story.append(Spacer(1, 0.2 * inch))
    story.append(
        Paragraph(
            "<i>This reconciliation has been reviewed and approved in accordance with IAS 1 and internal control procedures.</i>",
            styles["Normal"],
        )
    )

    doc.build(story)
    return buf.getvalue()
