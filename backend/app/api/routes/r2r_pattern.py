"""R2R pattern analysis — ML + rules engine (POST /api/r2r/pattern/analyse)."""
import io
import json
from typing import Any

import pandas as pd
from fastapi import APIRouter, HTTPException, Request

from app.services.r2r_pattern_engine import R2RPatternEngine

router = APIRouter(prefix="/api/r2r", tags=["r2r-pattern"])


def _mat_float(v: Any) -> float:
    if v is None:
        return 0.0
    s = str(v).strip()
    if not s:
        return 0.0
    try:
        return max(0.0, float(s))
    except ValueError:
        return 0.0


def _run_engine(
    df: pd.DataFrame,
    sensitivity: str,
    custom_threshold: str | None,
    materiality_amount: str | None,
    materiality_pct: str | None,
) -> dict[str, Any]:
    engine = R2RPatternEngine()
    s = (sensitivity or "balanced").strip().lower()
    if s == "conservative":
        engine.HIGH_THRESHOLD = 50
        engine.MEDIUM_THRESHOLD = 30
    elif s == "strict":
        engine.HIGH_THRESHOLD = 75
        engine.MEDIUM_THRESHOLD = 55

    ct_raw = (custom_threshold or "").strip() if custom_threshold else ""
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

    mat_amt = _mat_float(materiality_amount)
    mat_pct = _mat_float(materiality_pct)

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


@router.post("/pattern/analyse")
async def analyse_pattern(request: Request) -> dict[str, Any]:
    """
    Accept either:
    - `Content-Type: application/json` with keys: rows (array), sensitivity, custom_threshold, materiality_*
    - multipart/form-data (legacy): rows_json, file, sensitivity, ...
    """
    df: pd.DataFrame | None = None
    sensitivity = "balanced"
    custom_threshold: str | None = None
    materiality_amount: str | None = None
    materiality_pct: str | None = None

    ct = (request.headers.get("content-type") or "").lower()

    if "application/json" in ct:
        try:
            payload = await request.json()
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}") from e
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="JSON body must be an object")
        rows = payload.get("rows")
        if not isinstance(rows, list) or not rows:
            raise HTTPException(
                status_code=400,
                detail="JSON body must include non-empty 'rows' array of objects",
            )
        df = pd.DataFrame(rows)
        sensitivity = str(payload.get("sensitivity") or "balanced")
        ctv = payload.get("custom_threshold")
        custom_threshold = str(ctv).strip() if ctv is not None and str(ctv).strip() else None
        ma = payload.get("materiality_amount")
        materiality_amount = str(ma).strip() if ma is not None and str(ma).strip() else None
        mp = payload.get("materiality_pct")
        materiality_pct = str(mp).strip() if mp is not None and str(mp).strip() else None
    else:
        form = await request.form()
        # reserved for persistence / history
        _ = form.get("client_id")

        file = form.get("file")
        rows_json = form.get("rows_json")
        sensitivity = str(form.get("sensitivity") or "balanced")
        ctv = form.get("custom_threshold")
        custom_threshold = str(ctv).strip() if ctv is not None and str(ctv).strip() else None
        ma = form.get("materiality_amount")
        materiality_amount = str(ma).strip() if ma is not None and str(ma).strip() else None
        mp = form.get("materiality_pct")
        materiality_pct = str(mp).strip() if mp is not None and str(mp).strip() else None

        if file is not None and getattr(file, "filename", None):
            raw = await file.read()
            try:
                fn = str(file.filename).lower()
                if fn.endswith((".xlsx", ".xls")):
                    df = pd.read_excel(io.BytesIO(raw), engine="openpyxl")
                else:
                    df = pd.read_csv(io.BytesIO(raw))
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Could not read file: {e}") from e
        elif rows_json:
            try:
                raw = rows_json if isinstance(rows_json, str) else str(rows_json)
                data = json.loads(raw)
                if not isinstance(data, list):
                    raise ValueError("rows_json must be a JSON array of objects")
                df = pd.DataFrame(data)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Invalid rows_json: {e}") from e

    if df is None or df.empty:
        raise HTTPException(
            status_code=400,
            detail="Provide JSON { rows: [...] } or multipart rows_json / file",
        )

    result = _run_engine(df, sensitivity, custom_threshold, materiality_amount, materiality_pct)
    try:
        from app.agents.intelligence import generate_insight
        from app.agents.memory import read_agent_memory, store_agent_run, update_agent_memory
        from app.core.database import SessionLocal

        _r2r_data = result if isinstance(result, dict) else (result.model_dump() if hasattr(result, "model_dump") else result.dict())
        _db = SessionLocal()
        try:
            _history = await read_agent_memory("r2r_pattern", _db)
            _insight = await generate_insight(
                "r2r_pattern",
                {
                    "r2r_result": _r2r_data,
                    "source_route": "/r2r/pattern",
                    "deep_link": "/r2r/pattern",
                },
                _history,
            )
            _insight["source_route"] = "/r2r/pattern"
            _insight["deep_link"] = "/r2r/pattern"
            _insight["module_label"] = "R2R Pattern Analysis"
            _input = {
                "sensitivity": sensitivity,
                "custom_threshold": custom_threshold,
                "materiality_amount": materiality_amount,
                "materiality_pct": materiality_pct,
                "row_count": len(df) if df is not None else 0,
            }
            await store_agent_run("r2r_pattern", _input, _r2r_data, _insight, _db)
            await update_agent_memory("r2r_pattern", _r2r_data, _db)
        finally:
            _db.close()
    except Exception as _e:
        print(f"[agent_run] r2r_pattern: {_e}")
    return result
