"""7-page 3-statement model PDF (reportlab)."""

from __future__ import annotations

import io
from datetime import datetime
from typing import Any
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def _money(n: float, currency: str) -> str:
    c = (currency or "USD").upper()
    if c == "INR":
        return f"₹{abs(n):,.0f}" if n >= 0 else f"-₹{abs(n):,.0f}"
    return f"${n:,.0f}"


def build_model_pdf_bytes(
    *,
    model_id: str,
    company_name: str,
    currency: str,
    base_year: int,
    forecast_years: int,
    assumptions: dict[str, Any],
    base_model: dict[str, Any],
    checks: dict[str, Any],
    scenarios: dict[str, Any],
) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, rightMargin=48, leftMargin=48, topMargin=48, bottomMargin=48)
    styles = getSampleStyleSheet()
    story: list = []
    sym = lambda n: _money(float(n), currency)

    # Page 1 — Cover
    story.append(Paragraph("<b>3-Statement Financial Model</b>", styles["Title"]))
    story.append(Spacer(1, 0.2 * inch))
    story.append(Paragraph(escape(company_name or "Company"), styles["Heading2"]))
    story.append(Paragraph(escape(f"Currency: {currency} | Base year: {base_year} | Forecast years: {forecast_years}"), styles["Normal"]))
    story.append(Paragraph(escape(f"Model ID: {model_id}"), styles["Normal"]))
    story.append(Paragraph(f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M')} UTC", styles["Normal"]))
    story.append(PageBreak())

    # Page 2 — Assumptions
    story.append(Paragraph("<b>Key assumptions</b>", styles["Heading2"]))
    story.append(Spacer(1, 0.1 * inch))
    rows = [["Assumption", "Value"]]
    rows.append(["Revenue growth (Y1..Y3)", ", ".join(f"{100 * float(x):.1f}%" for x in (assumptions.get("revenue_growth") or [])[:3])])
    rows.append(["Gross margin", ", ".join(f"{100 * float(x):.1f}%" for x in (assumptions.get("gross_margin") or [])[:3])])
    rows.append(["EBITDA margin", ", ".join(f"{100 * float(x):.1f}%" for x in (assumptions.get("ebitda_margin") or [])[:3])])
    rows.append(["D&A % revenue", f"{100 * float(assumptions.get('da_pct_revenue', 0)):.2f}%"])
    rows.append(["Capex % revenue", f"{100 * float(assumptions.get('capex_pct_revenue', 0)):.2f}%"])
    rows.append(["Tax rate", f"{100 * float(assumptions.get('tax_rate', 0)):.1f}%"])
    rows.append(["Interest rate", f"{100 * float(assumptions.get('interest_rate', 0)):.2f}%"])
    nwc = assumptions.get("nwc_days") or {}
    rows.append(["AR / Inv / AP days", f"{nwc.get('ar_days','')} / {nwc.get('inventory_days','')} / {nwc.get('ap_days','')}"])
    rows.append(["Debt repayment", ", ".join(sym(float(x)) for x in (assumptions.get("debt_repayment") or [])[:3])])
    t = Table(rows, colWidths=[3.2 * inch, 3.8 * inch])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a8a")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.whitesmoke, colors.HexColor("#f1f5f9")]),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
            ]
        )
    )
    story.append(t)
    story.append(PageBreak())

    # Page 3 — P&L table (abbreviated numeric)
    story.append(Paragraph("<b>Income statement</b>", styles["Heading2"]))
    pl = base_model.get("statements", {}).get("income_statement", {})
    labels = pl.get("labels", [])
    hdr = ["Line"] + [escape(str(x)) for x in labels[:8]]
    data = [hdr]
    for r in pl.get("rows", [])[:14]:
        if r.get("is_header"):
            continue
        line = str(r.get("line", ""))
        vals = r.get("values", [])
        row = [escape(line)] + [sym(float(vals[i])) if i < len(vals) else "" for i in range(len(labels[:8]))]
        data.append(row)
    t2 = Table(data, repeatRows=1, colWidths=[2.2 * inch] + [0.85 * inch] * min(8, max(0, len(labels))))
    t2.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#334155")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTSIZE", (0, 0), (-1, -1), 7),
                ("GRID", (0, 0), (-1, -1), 0.2, colors.lightgrey),
            ]
        )
    )
    story.append(t2)
    story.append(PageBreak())

    # Page 4 — Balance sheet
    story.append(Paragraph("<b>Balance sheet</b>", styles["Heading2"]))
    bs = base_model.get("statements", {}).get("balance_sheet", {})
    labels_b = bs.get("labels", [])
    data_b = [["Line"] + [escape(str(x)) for x in labels_b[:8]]]
    for r in bs.get("rows", [])[:22]:
        if r.get("is_header"):
            data_b.append([escape(str(r.get("line", ""))), *([""] * min(8, len(labels_b)))])
            continue
        vals = r.get("values", [])
        data_b.append(
            [escape(str(r.get("line", "")))] + [sym(float(vals[i])) if i < len(vals) else "" for i in range(min(8, len(labels_b)))]
        )
    t3 = Table(data_b, repeatRows=1, colWidths=[2.2 * inch] + [0.85 * inch] * min(8, max(0, len(labels_b))))
    t3.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#334155")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("FONTSIZE", (0, 0), (-1, -1), 7), ("GRID", (0, 0), (-1, -1), 0.2, colors.lightgrey)]))
    story.append(t3)
    story.append(PageBreak())

    # Page 5 — CFS
    story.append(Paragraph("<b>Cash flow statement (indirect)</b>", styles["Heading2"]))
    cfs = base_model.get("statements", {}).get("cash_flow", {})
    labels_c = cfs.get("labels", [])
    data_c = [["Line"] + [escape(str(x)) for x in labels_c]]
    for r in cfs.get("rows", []):
        if r.get("is_header"):
            data_c.append([escape(str(r.get("line", ""))), *([""] * len(labels_c))])
            continue
        vals = r.get("values", [])
        data_c.append([escape(str(r.get("line", "")))] + [sym(float(vals[i])) if i < len(vals) else "" for i in range(len(labels_c))])
    t4 = Table(data_c, repeatRows=1, colWidths=[2.6 * inch] + [1.0 * inch] * max(1, len(labels_c)))
    t4.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#334155")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("FONTSIZE", (0, 0), (-1, -1), 8), ("GRID", (0, 0), (-1, -1), 0.2, colors.lightgrey)]))
    story.append(t4)
    story.append(PageBreak())

    # Page 6 — Checks
    story.append(Paragraph("<b>Model integrity checks</b>", styles["Heading2"]))
    for chk in checks.get("checks", []):
        story.append(Paragraph(f"<b>{escape(chk.get('name',''))}</b>", styles["Heading3"]))
        for y in chk.get("years", []):
            ok = bool(y.get("pass"))
            mark = "✅" if ok else "❌"
            detail_bits = [f"{k}={y.get(k)}" for k in sorted(y.keys()) if k not in ("year", "pass")]
            story.append(
                Paragraph(
                    escape(f"FY{y.get('year')}: {mark} {'PASS' if ok else 'FAIL'} — ") + escape("; ".join(detail_bits[:8])),
                    styles["Normal"],
                )
            )
        story.append(Spacer(1, 0.08 * inch))
    story.append(PageBreak())

    # Page 7 — Scenario summary (all forecast years)
    story.append(Paragraph("<b>Scenario summary — Base | Upside | Downside</b>", styles["Heading2"]))
    story.append(Paragraph("Key metrics for each forecast year.", styles["Normal"]))
    story.append(Spacer(1, 0.08 * inch))
    fy_list = base_model.get("meta", {}).get("forecast_year_list", [])

    def _val(m: dict, pl_bs: str, yi: int, key: str) -> float:
        seq = (m.get("forecast") or {}).get(pl_bs) or []
        if not seq or yi < 0 or yi >= len(seq):
            return 0.0
        return float(seq[yi].get(key, 0))

    for yi, y_year in enumerate(fy_list):
        story.append(Paragraph(escape(f"FY{y_year}E"), styles["Heading3"]))
        hdr_s = ["Metric", "Base", "Upside", "Downside"]
        rows_s = [hdr_s]
        for label, pl_bs, key in [
            ("Revenue", "pl", "revenue"),
            ("EBITDA", "pl", "ebitda"),
            ("Net income", "pl", "net_income"),
            ("Closing cash", "bs", "cash"),
            ("Total debt", "bs", "total_debt"),
        ]:
            row_m = [label]
            for scn in ("base", "upside", "downside"):
                m = scenarios.get(scn) or {}
                row_m.append(sym(_val(m, pl_bs, yi, key)))
            rows_s.append(row_m)
        ts = Table(rows_s, colWidths=[1.8 * inch, 1.4 * inch, 1.4 * inch, 1.4 * inch])
        ts.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a8a")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                ]
            )
        )
        story.append(ts)
        story.append(Spacer(1, 0.1 * inch))

    doc.build(story)
    buf.seek(0)
    return buf.read()
