"""Excel / VBA add-on: upload a workbook, return AI commentary in a new sheet.

Uses the same Anthropic path as the rest of FinReportAI (`llm_service`).
"""
from __future__ import annotations

import io
import os
from typing import Literal

import pandas as pd
from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl.styles import Alignment

from app.services import llm_service

router = APIRouter(prefix="/excel", tags=["Excel VBA Add-on"])

_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_MAX_TEXT_CHARS = 120_000


def _read_upload_to_df(contents: bytes) -> pd.DataFrame:
    buf = io.BytesIO(contents)
    try:
        return pd.read_excel(buf, engine="openpyxl", sheet_name=0)
    except Exception:
        buf.seek(0)
        try:
            return pd.read_excel(buf, engine="xlrd", sheet_name=0)
        except Exception as e:
            raise ValueError(f"Could not read Excel file: {e}") from e


def _prompts(data_text: str) -> dict[str, str]:
    return {
        "variance": f"""You are a CFO analyst with Big 4 experience.
Analyze this Budget vs Actual data:
{data_text}
Write: 1) Executive summary 2) Top 3 variances explained
3) Risk flags 4) Recommended actions.
Format professionally for board presentation.""",
        "pl_commentary": f"""You are a finance controller.
Analyze this P&L statement:
{data_text}
Write CFO-ready commentary covering performance,
trends, concerns and outlook. Max 3 paragraphs.""",
        "anomaly": f"""You are an audit specialist.
Review this financial data:
{data_text}
Flag: round numbers, unusual entries, timing anomalies,
SOD risks. List each with severity: HIGH/MEDIUM/LOW.""",
    }


@router.post(
    "/analyze",
    operation_id="finreport_excel_analyze",
    summary="Upload Excel, return workbook with AI Commentary sheet (VBA / integrations)",
)
async def analyze_excel(
    file: UploadFile = File(..., description="Excel workbook (.xlsx or .xls)"),
    analysis_type: Literal["variance", "pl_commentary", "anomaly"] = Query(
        "variance", description="Analysis preset"
    ),
):
    if not llm_service.is_configured():
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY is not configured on the server.",
        )

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty file upload.")

    try:
        df = _read_upload_to_df(contents)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    data_text = df.to_string(index=False)
    if len(data_text) > _MAX_TEXT_CHARS:
        data_text = data_text[:_MAX_TEXT_CHARS] + "\n\n[TRUNCATED FOR TOKEN LIMITS]"

    prompts = _prompts(data_text)
    prompt = prompts[analysis_type]

    model_id = (
        os.environ.get("ANTHROPIC_EXCEL_ANALYZE_MODEL", "").strip()
        or os.environ.get("ANTHROPIC_MODEL", "").strip()
        or None
    )

    try:
        ai_output = llm_service.invoke(
            prompt, max_tokens=1500, temperature=0.3, model_id=model_id
        )
    except Exception as e:
        raise HTTPException(
            status_code=502, detail=f"LLM request failed: {e!s}"
        ) from e

    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="Original Data", index=False)
        result_df = pd.DataFrame({"AI Analysis": [ai_output]})
        result_df.to_excel(writer, sheet_name="AI Commentary", index=False)
        ws = writer.sheets["AI Commentary"]
        ws.column_dimensions["A"].width = 120
        for row in ws.iter_rows():
            for cell in row:
                cell.alignment = Alignment(wrap_text=True, vertical="top")
        # Row 1 = header, row 2 = commentary cell
        ws.row_dimensions[2].height = 300

    output.seek(0)
    return StreamingResponse(
        output,
        media_type=_XLSX,
        headers={
            "Content-Disposition": 'attachment; filename="FinReportAI_ai_analysis.xlsx"'
        },
    )
