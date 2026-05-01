import os
import tempfile
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table
from reportlab.lib.styles import getSampleStyleSheet


async def generate_pdf(content: dict, filename: str) -> str:
    """Generate professional board pack PDF."""
    output_dir = tempfile.gettempdir()
    output_path = os.path.join(output_dir, filename)

    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        topMargin=50,
        bottomMargin=50,
    )

    styles = getSampleStyleSheet()
    story = []

    now = datetime.now()
    story.append(Paragraph(f"BOARD PACK — {now.strftime('%B %Y').upper()}", styles["Title"]))
    story.append(Paragraph("Prepared by FinReportAI Agentic System", styles["Normal"]))
    story.append(Spacer(1, 20))

    story.append(Paragraph("EXECUTIVE SUMMARY", styles["Heading1"]))
    story.append(Paragraph(content.get("executive_summary", ""), styles["Normal"]))
    story.append(Spacer(1, 15))

    metrics = content.get("headline_metrics", {})
    if metrics:
        story.append(Paragraph("HEADLINE METRICS", styles["Heading1"]))
        table_data = [[k.replace("_", " ").title(), v] for k, v in metrics.items()]
        story.append(Table(table_data, colWidths=[200, 300]))
        story.append(Spacer(1, 15))

    story.append(Paragraph("VARIANCE COMMENTARY", styles["Heading1"]))
    story.append(Paragraph(content.get("variance_commentary", ""), styles["Normal"]))
    story.append(Spacer(1, 15))

    risks = content.get("key_risks", [])
    if risks:
        story.append(Paragraph("KEY RISKS & MITIGATIONS", styles["Heading1"]))
        for risk in risks:
            story.append(Paragraph(f"• {risk}", styles["Normal"]))
        story.append(Spacer(1, 15))

    actions = content.get("management_actions", [])
    if actions:
        story.append(Paragraph("MANAGEMENT ACTIONS", styles["Heading1"]))
        for action in actions:
            story.append(Paragraph(f"→ {action}", styles["Normal"]))
        story.append(Spacer(1, 15))

    story.append(Paragraph("OUTLOOK", styles["Heading1"]))
    story.append(Paragraph(content.get("outlook", ""), styles["Normal"]))

    doc.build(story)
    return output_path
