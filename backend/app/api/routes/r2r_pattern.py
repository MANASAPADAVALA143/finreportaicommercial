"""R2R pattern analysis — ML + rules engine (POST /api/r2r/pattern/analyse)."""
import io
import json
from typing import Any

import pandas as pd
from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.services.r2r_pattern_engine import R2RPatternEngine

router = APIRouter(prefix="/api/r2r", tags=["r2r-pattern"])


@router.post("/pattern/analyse")
async def analyse_pattern(
    file: UploadFile | None = File(None),
    rows_json: str | None = Form(None),
    sensitivity: str = Form("balanced"),
    custom_threshold: str | None = Form(None),
    client_id: str | None = Form(None),
    materiality_amount: str | None = Form(None),
    materiality_pct: str | None = Form(None),
) -> dict[str, Any]:
    del client_id  # reserved for persistence / history

    df: pd.DataFrame | None = None

    if file is not None and file.filename:
        raw = await file.read()
        try:
            if file.filename.lower().endswith((".xlsx", ".xls")):
                df = pd.read_excel(io.BytesIO(raw), engine="openpyxl")
            else:
                df = pd.read_csv(io.BytesIO(raw))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not read file: {e}") from e

    elif rows_json:
        try:
            data = json.loads(rows_json)
            if not isinstance(data, list):
                raise ValueError("rows_json must be a JSON array of objects")
            df = pd.DataFrame(data)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid rows_json: {e}") from e

    if df is None or df.empty:
        raise HTTPException(status_code=400, detail="Provide a CSV/XLSX file or rows_json body")

    engine = R2RPatternEngine()
    s = (sensitivity or "balanced").strip().lower()
    if s == "conservative":
        engine.HIGH_THRESHOLD = 50
        engine.MEDIUM_THRESHOLD = 30
    elif s == "strict":
        engine.HIGH_THRESHOLD = 75
        engine.MEDIUM_THRESHOLD = 55

    ct_raw = (custom_threshold or "").strip()
    if ct_raw:
        try:
            high_t = int(float(ct_raw))
            med_t = high_t - 20
            if med_t < 0:
                med_t = 0
            if med_t >= high_t:
                med_t = max(0, high_t - 1)
            engine.HIGH_THRESHOLD = high_t
            engine.MEDIUM_THRESHOLD = med_t
        except ValueError:
            pass

    mat_amt = 0.0
    mat_pct = 0.0
    ma = (materiality_amount or "").strip()
    mp = (materiality_pct or "").strip()
    if ma:
        try:
            mat_amt = max(0.0, float(ma))
        except ValueError:
            pass
    if mp:
        try:
            mat_pct = max(0.0, float(mp))
        except ValueError:
            pass

    result = engine.analyse(
        df,
        sensitivity=s,
        materiality_amount=mat_amt,
        materiality_pct=mat_pct,
    )
    if isinstance(result, dict) and result.get("error"):
        raise HTTPException(status_code=400, detail=str(result["error"]))

    result["sensitivity"] = s
    result["threshold_profile"] = {
        "sensitivity": s,
        "high_threshold": engine.HIGH_THRESHOLD,
        "medium_threshold": engine.MEDIUM_THRESHOLD,
        "custom_threshold_applied": bool(ct_raw),
    }
    return result
