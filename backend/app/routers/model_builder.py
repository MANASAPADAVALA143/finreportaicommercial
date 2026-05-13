"""FP&A 3-statement Model Builder API."""

from __future__ import annotations

import json
import time
import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.database import get_db
from app.middleware.auth import get_current_user
from app.models.users import User
from app.models.financial_model import FinancialModel
from app.services import model_builder_engine as eng
from app.services.model_builder_excel import build_model_excel_bytes
from app.services.model_builder_pdf import build_model_pdf_bytes

# Example auth protection added below; replicate for other endpoints in this router as needed.
router = APIRouter(prefix="/api/model", tags=["model-builder"])


def _audit(row: FinancialModel, action: str, detail: dict | None = None) -> None:
    trail = list(row.audit_trail or [])
    trail.append({"at": datetime.utcnow().isoformat() + "Z", "action": action, "detail": detail or {}})
    row.audit_trail = trail
    flag_modified(row, "audit_trail")


def _scenario_bundle(full: dict[str, Any], name: str) -> dict[str, Any]:
    if name == "base":
        return full.get("base") or {}
    if name == "upside":
        return full.get("upside") or {}
    if name == "downside":
        return full.get("downside") or {}
    raise HTTPException(status_code=400, detail="scenario must be base|upside|downside")


def _filter_statement(model: dict[str, Any], statement: str | None) -> dict[str, Any]:
    if not statement or statement == "all":
        return model
    st = statement.lower().strip()
    if st == "pl":
        return {"income_statement": model.get("statements", {}).get("income_statement"), "meta": model.get("meta")}
    if st == "bs":
        return {"balance_sheet": model.get("statements", {}).get("balance_sheet"), "meta": model.get("meta")}
    if st == "cfs":
        return {"cash_flow": model.get("statements", {}).get("cash_flow"), "meta": model.get("meta")}
    if st == "debt":
        return {"debt_schedule": model.get("forecast", {}).get("debt_schedule"), "meta": model.get("meta")}
    if st == "wc":
        return {"working_capital": model.get("forecast", {}).get("working_capital"), "meta": model.get("meta")}
    raise HTTPException(status_code=400, detail="statement must be pl|bs|cfs|debt|wc|all")


@router.post("/start")
async def start_model(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
    entity_id: str = Form(...),
    company_name: str = Form(...),
    currency: str = Form("USD"),
    base_year: int = Form(2024),
    forecast_years: int = Form(3),
    historical_pl_file: UploadFile = File(...),
    historical_bs_file: UploadFile = File(...),
    assumptions_json: str = Form(...),
):
    if not historical_pl_file.filename or not historical_bs_file.filename:
        raise HTTPException(status_code=400, detail="historical_pl_file and historical_bs_file are required")
    try:
        assumptions = json.loads(assumptions_json)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"assumptions_json invalid JSON: {e}") from e
    pl_raw = await historical_pl_file.read()
    bs_raw = await historical_bs_file.read()
    try:
        parsed_pl = eng.parse_historical_pl(pl_raw, historical_pl_file.filename or "pl.csv")
        parsed_bs = eng.parse_historical_bs(bs_raw, historical_bs_file.filename or "bs.csv")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Parse error: {e}") from e

    model_id = str(uuid.uuid4())
    row = FinancialModel(
        model_id=model_id,
        entity_id=entity_id.strip(),
        company_name=(company_name or "").strip() or entity_id,
        currency=(currency or "USD").upper()[:8],
        base_year=int(base_year),
        forecast_years=max(1, min(5, int(forecast_years))),
        status="started",
        assumptions_json=assumptions,
        model_json={
            "_inputs": {
                "parsed_pl": parsed_pl,
                "parsed_bs": parsed_bs,
                "files": {"pl": historical_pl_file.filename, "bs": historical_bs_file.filename},
            }
        },
        checks_json={},
        scenarios_json={},
        audit_trail=[],
        total_seconds=None,
    )
    _audit(row, "started", {"model_id": model_id})
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"model_id": model_id, "status": "started"}


@router.post("/build/{model_id}")
def build_model(model_id: str, db: Session = Depends(get_db)):
    row = db.get(FinancialModel, model_id)
    if not row:
        raise HTTPException(status_code=404, detail="model_id not found")
    inputs = (row.model_json or {}).get("_inputs") or {}
    parsed_pl = inputs.get("parsed_pl")
    parsed_bs = inputs.get("parsed_bs")
    if not parsed_pl or not parsed_bs:
        raise HTTPException(status_code=400, detail="Model inputs missing; call /start first")

    row.status = "building"
    db.add(row)
    db.commit()

    t0 = time.perf_counter()
    try:
        pkg = eng.build_full_package(
            pl_hist_payload=parsed_pl,
            bs_hist_payload=parsed_bs,
            assumptions=dict(row.assumptions_json or {}),
            base_year=int(row.base_year),
            forecast_years=int(row.forecast_years),
            currency=row.currency or "USD",
        )
    except Exception as e:
        row.status = "error"
        row.checks_json = {"error": str(e)}
        _audit(row, "build_error", {"error": str(e)})
        db.add(row)
        db.commit()
        raise HTTPException(status_code=400, detail=str(e)) from e

    elapsed = time.perf_counter() - t0
    base = pkg["base"]
    row.model_json = base
    row.checks_json = base.get("checks", {})
    row.scenarios_json = {"base": pkg["base"], "upside": pkg["upside"], "downside": pkg["downside"]}
    row.status = "complete"
    row.total_seconds = float(elapsed)
    _audit(row, "built", {"seconds": elapsed, "checks_all_pass": (base.get("checks", {}).get("summary") or {}).get("all_pass")})
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "model_id": model_id,
        "status": row.status,
        "total_seconds": row.total_seconds,
        "checks": row.checks_json,
        "model": row.model_json,
        "scenarios": {"base": pkg["base"], "upside": pkg["upside"], "downside": pkg["downside"]},
    }


@router.get("/status/{model_id}")
def model_status(model_id: str, db: Session = Depends(get_db)):
    row = db.get(FinancialModel, model_id)
    if not row:
        raise HTTPException(status_code=404, detail="model_id not found")
    partial: dict[str, Any] = {}
    if row.status == "complete":
        partial["checks_summary"] = (row.checks_json or {}).get("summary")
    elif row.status == "started":
        partial["inputs_ready"] = bool((row.model_json or {}).get("_inputs"))
    return {
        "model_id": model_id,
        "status": row.status,
        "partial": partial,
        "total_seconds": row.total_seconds,
    }


@router.get("/output/{model_id}")
def model_output(
    model_id: str,
    db: Session = Depends(get_db),
    scenario: str = Query("base"),
    statement: str = Query("all"),
):
    row = db.get(FinancialModel, model_id)
    if not row:
        raise HTTPException(status_code=404, detail="model_id not found")
    scen = scenario.lower().strip()
    full = row.scenarios_json or {}
    if row.status != "complete" or not full:
        return {"model_id": model_id, "status": row.status, "detail": "Build not complete"}
    bundle = _scenario_bundle(full, scen)
    return {"model_id": model_id, "scenario": scen, "payload": _filter_statement(bundle, statement)}


@router.get("/history")
def model_history(db: Session = Depends(get_db), entity_id: Optional[str] = None):
    q = db.query(FinancialModel).order_by(FinancialModel.created_at.desc())
    if entity_id:
        q = q.filter(FinancialModel.entity_id == entity_id.strip())
    rows = q.limit(100).all()
    return {
        "items": [
            {
                "model_id": r.model_id,
                "entity_id": r.entity_id,
                "company_name": r.company_name,
                "status": r.status,
                "base_year": r.base_year,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "total_seconds": r.total_seconds,
            }
            for r in rows
        ]
    }


class ApproveBody(BaseModel):
    approver: str


@router.post("/approve/{model_id}")
def approve_model(model_id: str, body: ApproveBody, db: Session = Depends(get_db)):
    row = db.get(FinancialModel, model_id)
    if not row:
        raise HTTPException(status_code=404, detail="model_id not found")
    row.approved_by = (body.approver or "").strip() or "unknown"
    row.approved_at = datetime.utcnow()
    _audit(row, "approved", {"approver": row.approved_by})
    db.add(row)
    db.commit()
    return {"model_id": model_id, "approved_by": row.approved_by, "approved_at": row.approved_at.isoformat() + "Z"}


@router.get("/report/{model_id}/pdf")
def model_pdf(model_id: str, db: Session = Depends(get_db)):
    row = db.get(FinancialModel, model_id)
    if not row:
        raise HTTPException(status_code=404, detail="model_id not found")
    if row.status != "complete":
        raise HTTPException(status_code=400, detail="Model not complete")
    full = row.scenarios_json or {}
    base = full.get("base") or {}
    pdf = build_model_pdf_bytes(
        model_id=model_id,
        company_name=row.company_name or "",
        currency=row.currency or "USD",
        base_year=int(row.base_year),
        forecast_years=int(row.forecast_years),
        assumptions=eng.normalize_assumptions(dict(row.assumptions_json or {}), int(row.forecast_years)),
        base_model=base,
        checks=base.get("checks", {}),
        scenarios={"base": full.get("base"), "upside": full.get("upside"), "downside": full.get("downside")},
    )
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="model_{model_id}.pdf"'},
    )


@router.get("/export/{model_id}/excel")
def model_excel(model_id: str, db: Session = Depends(get_db)):
    row = db.get(FinancialModel, model_id)
    if not row:
        raise HTTPException(status_code=404, detail="model_id not found")
    if row.status != "complete":
        raise HTTPException(status_code=400, detail="Model not complete")
    full = row.scenarios_json or {}
    base = full.get("base") or {}
    n_hist = len((base.get("historical") or {}).get("pl") or [])
    asm = eng.normalize_assumptions(dict(row.assumptions_json or {}), int(row.forecast_years))
    xlsx = build_model_excel_bytes(
        company_name=row.company_name or "",
        currency=row.currency or "USD",
        base_model=base,
        scenarios={"base": full.get("base"), "upside": full.get("upside"), "downside": full.get("downside")},
        assumptions=asm,
        n_hist=n_hist,
    )
    return Response(
        content=xlsx,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="model_{model_id}.xlsx"'},
    )
