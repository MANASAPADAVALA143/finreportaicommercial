"""Professional PDF export for Audit Intelligence reports (ReportLab)."""

from __future__ import annotations

import io
import json
from datetime import datetime, timezone
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def _json_block(styles, data: Any) -> list:
    text = json.dumps(data, indent=2, default=str)
    # Escape for ReportLab XML-ish Paragraph
    safe = (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\n", "<br/>")
    )
    return [Paragraph(f"<font face='Courier' size='8'>{safe}</font>", styles["AuditBody"]), Spacer(1, 12)]


def build_audit_pdf_bytes(
    *,
    agent_name: str,
    client_name: str | None,
    run_at: datetime | None,
    result: dict[str, Any],
) -> bytes:
    """Return PDF file bytes."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        topMargin=0.65 * inch,
        bottomMargin=0.65 * inch,
        leftMargin=0.65 * inch,
        rightMargin=0.65 * inch,
    )

    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="AuditTitle",
            parent=styles["Title"],
            textColor=colors.HexColor("#0A0F1E"),
            spaceAfter=12,
        )
    )
    styles.add(
        ParagraphStyle(
            name="AuditH1",
            parent=styles["Heading1"],
            textColor=colors.HexColor("#F5A623"),
            spaceAfter=8,
        )
    )
    styles.add(
        ParagraphStyle(
            name="AuditBody",
            parent=styles["Normal"],
            textColor=colors.HexColor("#1a1a2e"),
            fontSize=10,
            leading=14,
        )
    )
    styles.add(
        ParagraphStyle(
            name="BrandRight",
            parent=styles["Normal"],
            alignment=TA_RIGHT,
            textColor=colors.HexColor("#F5A623"),
            fontSize=14,
            fontName="Helvetica-Bold",
        )
    )

    when = run_at or datetime.now(timezone.utc)
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    stamp = when.strftime("%Y-%m-%d %H:%M UTC")

    story: list = []
    header_data = [
        [
            Paragraph("", styles["Normal"]),
            Paragraph("Gnanova.pro", styles["BrandRight"]),
        ]
    ]
    ht = Table(header_data, colWidths=[3.2 * inch, 3.2 * inch])
    ht.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEABOVE", (0, 0), (-1, 0), 0.5, colors.HexColor("#F5A623")),
            ]
        )
    )
    story.append(ht)
    story.append(Spacer(1, 16))

    story.append(Paragraph(agent_name.upper(), styles["AuditTitle"]))
    meta = f"<b>Run:</b> {stamp}"
    if client_name:
        meta += f" &nbsp;|&nbsp; <b>Client:</b> {client_name}"
    story.append(Paragraph(meta, styles["AuditBody"]))
    story.append(Spacer(1, 14))

    story.append(Paragraph("STRUCTURED RESULTS", styles["AuditH1"]))
    story.extend(_json_block(styles, result))

    doc.build(story)
    return buf.getvalue()


def build_command_center_memo_pdf(
    *,
    company_name: str,
    period: str,
    narrative: str,
    generated_at: str | None = None,
    composite_score: float | None = None,
    composite_risk: str | None = None,
) -> bytes:
    """Clean 1–2 page audit memo PDF for Command Center narrative."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
        leftMargin=0.85 * inch,
        rightMargin=0.85 * inch,
    )
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="MemoTitle",
            parent=styles["Title"],
            fontName="Times-Bold",
            fontSize=16,
            textColor=colors.HexColor("#0A0F1E"),
            spaceAfter=6,
            alignment=0,
        )
    )
    styles.add(
        ParagraphStyle(
            name="MemoMeta",
            parent=styles["Normal"],
            fontName="Times-Roman",
            fontSize=10,
            textColor=colors.HexColor("#444444"),
            spaceAfter=18,
            leading=13,
        )
    )
    styles.add(
        ParagraphStyle(
            name="MemoBody",
            parent=styles["Normal"],
            fontName="Times-Roman",
            fontSize=11,
            textColor=colors.HexColor("#111111"),
            leading=16,
            spaceAfter=12,
            alignment=TA_JUSTIFY,
        )
    )

    stamp = generated_at or datetime.now(timezone.utc).isoformat()
    try:
        stamp_disp = datetime.fromisoformat(stamp.replace("Z", "+00:00")).strftime(
            "%d %b %Y %H:%M UTC"
        )
    except Exception:
        stamp_disp = stamp

    story: list = []
    story.append(Paragraph("AI Audit Findings", styles["MemoTitle"]))
    meta_bits = [company_name or "Company", f"Period {period}", stamp_disp]
    if composite_score is not None:
        meta_bits.append(
            f"Composite score {composite_score:.0f}"
            + (f" ({composite_risk})" if composite_risk else "")
        )
    story.append(Paragraph(" · ".join(meta_bits), styles["MemoMeta"]))

    paras = [p.strip() for p in (narrative or "").split("\n\n") if p.strip()]
    if not paras:
        paras = [(narrative or "").strip() or "No narrative generated."]
    for p in paras:
        safe = (
            p.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\n", "<br/>")
        )
        story.append(Paragraph(safe, styles["MemoBody"]))

    doc.build(story)
    return buf.getvalue()
