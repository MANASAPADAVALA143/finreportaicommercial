"""Excel AI Suite — upload Excel, download AI-enhanced Excel."""
from __future__ import annotations

import io
import json
from typing import Annotated, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.services.excel_suite_generators import (
    build_board_pack_excel_workbook,
    build_budget_workbook,
    build_cashflow_workbook,
    build_kpi_dashboard_workbook,
    build_management_accounts_workbook,
    build_rolling_forecast_workbook,
    build_scenario_workbook,
)
from app.services.excel_variance_service import analyse_variance

router = APIRouter(tags=["Excel AI Suite"])

_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _download(filename: str, data: bytes) -> StreamingResponse:
    return StreamingResponse(
        io.BytesIO(data),
        media_type=_XLSX,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/variance-analysis")
async def variance_analysis(file: UploadFile = File(...)):
    raw = await file.read()
    try:
        out = analyse_variance(raw)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Variance processing failed: {e!s}") from e
    return _download("FinReportAI_variance_analysis.xlsx", out)


@router.post("/build-budget")
async def build_budget(
    file: UploadFile = File(...),
    industry: Annotated[str, Form()] = "Manufacturing",
    revenue_growth_pct: Annotated[float, Form()] = 10.0,
    cost_inflation_pct: Annotated[float, Form()] = 5.0,
    new_hires: Annotated[int, Form()] = 0,
    fy_label: Annotated[str, Form()] = "FY2026",
):
    raw = await file.read()
    try:
        out = build_budget_workbook(
            raw,
            industry=industry.strip() or "Manufacturing",
            revenue_growth_pct=revenue_growth_pct,
            cost_inflation_pct=cost_inflation_pct,
            new_hires=new_hires,
            fy_label=fy_label.strip() or "FY2026",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return _download("FinReportAI_budget_builder.xlsx", out)


@router.post("/rolling-forecast")
async def rolling_forecast(
    file: UploadFile = File(...),
    current_month: Annotated[int, Form()] = 9,
):
    raw = await file.read()
    try:
        out = build_rolling_forecast_workbook(raw, current_month=current_month)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return _download("FinReportAI_rolling_forecast.xlsx", out)


@router.post("/cashflow-forecast")
async def cashflow_forecast(
    file: UploadFile = File(...),
    min_cash: Annotated[float, Form()] = 1_500_000.0,
):
    raw = await file.read()
    try:
        out = build_cashflow_workbook(raw, min_cash=min_cash)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return _download("FinReportAI_13_week_cashflow.xlsx", out)


@router.post("/kpi-dashboard")
async def kpi_dashboard(file: UploadFile = File(...)):
    raw = await file.read()
    try:
        out = build_kpi_dashboard_workbook(raw)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return _download("FinReportAI_kpi_dashboard.xlsx", out)


@router.post("/board-pack")
async def board_pack_excel(
    file: UploadFile = File(...),
    budget_file: Optional[UploadFile] = File(None),
):
    raw = await file.read()
    bud: bytes | None = None
    if budget_file and budget_file.filename:
        bud = await budget_file.read()
    try:
        out = build_board_pack_excel_workbook(raw, budget_file_bytes=bud)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return _download("FinReportAI_board_pack.xlsx", out)


@router.post("/scenario-planner")
async def scenario_planner(
    file: UploadFile = File(...),
    assumptions_json: Annotated[str, Form()] = "{}",
):
    raw = await file.read()
    try:
        body = json.loads(assumptions_json) if assumptions_json.strip() else {}
        if not isinstance(body, dict):
            body = {}
    except json.JSONDecodeError:
        body = {}
    try:
        out = build_scenario_workbook(raw, body)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return _download("FinReportAI_scenario_planner.xlsx", out)


@router.post("/management-accounts")
async def management_accounts(
    file: UploadFile = File(...),
    format_id: Annotated[str, Form()] = "ICAI",
):
    raw = await file.read()
    fmt = format_id.strip().upper() or "ICAI"
    if fmt not in ("ICAI", "CIMA"):
        fmt = "ICAI"
    try:
        out = build_management_accounts_workbook(raw, format_id=fmt)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return _download("FinReportAI_management_accounts.xlsx", out)
