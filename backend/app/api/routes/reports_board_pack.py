"""Board pack HTML + PDF preview — POST /api/reports/board-pack"""

from __future__ import annotations

import base64
import logging
from io import BytesIO
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fpdf import FPDF
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.fpa_commentary import fpa_commentary
from app.services.fpa_result_store import store_fpa_result

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/reports", tags=["Reports Board Pack"])


class BoardPackRequest(BaseModel):
    company_name: str = "FinReportAI Demo Ltd"
    period: str = "Q1 2026"
    cfo_name: str = "CFO"
    key_message_1: str = ""
    key_message_2: str = ""
    key_message_3: str = ""
    include_pl: bool = True
    include_cash: bool = True
    include_kpis: bool = True
    include_variance: bool = True
    include_forecast: bool = True
    include_risks: bool = True
    variance_summary: str = "Budget vs actual is broadly on track; marketing spend elevated."
    forecast_summary: str = "Base case revenue growth 12% YoY with stable margins."
    user_id: Optional[str] = None


def _html_preview(body: BoardPackRequest, executive_summary: str) -> str:
    sections: List[str] = []
    if body.include_pl:
        sections.append("<h2>P&amp;L summary</h2><p>High-level revenue, gross margin, and EBITDA vs prior period.</p>")
    if body.include_cash:
        sections.append("<h2>Cash</h2><p>Liquidity runway and working-capital highlights.</p>")
    if body.include_kpis:
        sections.append("<h2>KPIs</h2><p>Core operating and SaaS metrics dashboard.</p>")
    if body.include_variance:
        sections.append(f"<h2>Variance</h2><p>{body.variance_summary}</p>")
    if body.include_forecast:
        sections.append(f"<h2>Forecast</h2><p>{body.forecast_summary}</p>")
    if body.include_risks:
        sections.append("<h2>Risks</h2><p>Macro, execution, and concentration risks to monitor.</p>")
    bullets = "".join(f"<li>{m}</li>" for m in [body.key_message_1, body.key_message_2, body.key_message_3] if m)
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>Board Pack</title>
<style>body{{font-family:system-ui,Segoe UI,sans-serif;max-width:900px;margin:40px auto;line-height:1.5;color:#111}}
h1{{border-bottom:2px solid #111;padding-bottom:8px}}</style></head><body>
<h1>{body.company_name}</h1>
<p><strong>Period:</strong> {body.period} &nbsp;|&nbsp; <strong>CFO:</strong> {body.cfo_name}</p>
<h2>Executive summary</h2>
<p>{executive_summary}</p>
<ul>{bullets}</ul>
{''.join(sections)}
</body></html>"""


def _pdf_bytes(body: BoardPackRequest, executive_summary: str) -> bytes:
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, body.company_name, ln=True)
    pdf.set_font("Helvetica", size=11)
    pdf.cell(0, 8, f"Period: {body.period}   |   CFO: {body.cfo_name}", ln=True)
    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Executive summary", ln=True)
    pdf.set_font("Helvetica", size=10)
    for line in executive_summary.split("\n"):
        pdf.multi_cell(0, 5, line)
    pdf.ln(2)
    for label, text in [
        ("Key message 1", body.key_message_1),
        ("Key message 2", body.key_message_2),
        ("Key message 3", body.key_message_3),
    ]:
        if text:
            pdf.set_font("Helvetica", "B", 10)
            pdf.cell(0, 6, label, ln=True)
            pdf.set_font("Helvetica", size=10)
            pdf.multi_cell(0, 5, text)
    buf = BytesIO()
    pdf.output(buf)
    return buf.getvalue()


@router.post("/board-pack")
def board_pack(body: BoardPackRequest, db: Session = Depends(get_db)):
    try:
        exec_summary = fpa_commentary(
            "Draft a tight board-pack executive summary (max 180 words) from the following placeholders and toggles.",
            body.model_dump(),
        )
        html_preview = _html_preview(body, exec_summary)
        pdf_bin = _pdf_bytes(body, exec_summary)
        pdf_b64 = base64.b64encode(pdf_bin).decode("ascii")
        out = {
            "executive_summary": exec_summary,
            "html_preview": html_preview,
            "pdf_base64": pdf_b64,
        }
        store_fpa_result(db, "board_pack", {**out, "pdf_base64": "[omitted]"}, user_id=body.user_id)
        return out
    except Exception as e:
        logger.exception("board-pack failed")
        raise HTTPException(status_code=500, detail=str(e)) from e
