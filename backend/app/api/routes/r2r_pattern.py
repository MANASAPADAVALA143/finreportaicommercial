"""R2R pattern analysis — ML + rules engine (POST /api/r2r/pattern/analyse)."""
import io
import json
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
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
    client_id: str | None = None,
    db: Session | None = None,
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
        client_id=client_id or "",
        db=db,
    )
    if isinstance(result, dict) and result.get("error"):
        raise HTTPException(status_code=400, detail=str(result["error"]))

    result["sensitivity"] = s
    result["threshold_profile"] = {
        "sensitivity": s,
        "high_threshold": engine.HIGH_THRESHOLD,
        "medium_threshold": engine.MEDIUM_THRESHOLD,
        "custom_threshold_applied": bool(ct_raw),
        "client_baseline_loaded": bool(client_id),
    }
    return result


@router.post("/pattern/analyse")
async def analyse_pattern(request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    """
    Accept either:
    - `Content-Type: application/json` with keys: rows (array), sensitivity, custom_threshold, materiality_*, client_id
    - multipart/form-data (legacy): rows_json, file, sensitivity, client_id, ...
    """
    df: pd.DataFrame | None = None
    sensitivity = "balanced"
    custom_threshold: str | None = None
    materiality_amount: str | None = None
    materiality_pct: str | None = None
    client_id: str | None = None

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
        cid = payload.get("client_id")
        client_id = str(cid).strip() if cid and str(cid).strip() else None
    else:
        form = await request.form()
        cid = form.get("client_id")
        client_id = str(cid).strip() if cid and str(cid).strip() else None

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

    result = _run_engine(df, sensitivity, custom_threshold, materiality_amount, materiality_pct,
                         client_id=client_id, db=db)
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


# ── R2R ↔ Accounting integration endpoints ────────────────────────────────────

@router.get("/baseline-status/{company_id}")
async def get_baseline_status(
    company_id: str,
    country: str = "UAE",
    db: Session = Depends(get_db),
):
    """Return R2R historical baseline status for Historical Intelligence tab."""
    from app.modules.r2r.historical import get_baseline_status as _get
    return _get(company_id, country, db)


@router.get("/load-from-accounting")
async def load_from_accounting(
    company_id: str = "demo",
    country: str = "UAE",
    period: str = None,
    db: Session = Depends(get_db),
):
    """Load posted JEs from accounting DB — no file upload needed."""
    from app.modules.r2r.historical import load_entries_for_analysis
    rows = load_entries_for_analysis(company_id, country, period, db)
    return {
        "rows": rows,
        "count": len(rows),
        "source": "accounting",
        "company_id": company_id,
        "country": country,
    }


@router.post("/sync-from-accounting")
async def sync_from_accounting(
    request: Request,
    db: Session = Depends(get_db),
):
    """Manually bulk-sync all posted JEs from UAE accounting to R2R baseline."""
    from app.modules.r2r.historical import add_to_company_baseline

    body = await request.json()
    company_id = body.get("company_id", "demo")
    country    = body.get("country", "UAE")
    period     = body.get("period")

    try:
        from app.models.uae_accounting_full import UAEJournalEntry, UAEJournalLine
        q = db.query(UAEJournalEntry).filter_by(tenant_id=company_id, status="posted")
        if period:
            q = q.filter(UAEJournalEntry.period == period)
        je_list = q.all()
    except Exception as exc:
        return {"synced": 0, "error": str(exc)}

    je_rows = []
    for je in je_list:
        try:
            lines = db.query(UAEJournalLine).filter_by(journal_id=je.id).all()
            if lines:
                for line in lines:
                    je_rows.append({
                        "je_id": f"{je.id}_{line.id}",
                        "je_number": je.reference or je.id,
                        "date": str(je.entry_date),
                        "period": je.period or "",
                        "description": je.description or "",
                        "account_code": line.account_code or "",
                        "account_name": line.account_name or "",
                        "debit": float(line.debit or 0),
                        "credit": float(line.credit or 0),
                        "amount": float(line.debit or line.credit or 0),
                        "source": je.source or "manual",
                        "posted_by": je.posted_by or company_id,
                    })
            else:
                je_rows.append({
                    "je_id": je.id, "je_number": je.reference or je.id,
                    "date": str(je.entry_date), "period": je.period or "",
                    "description": je.description or "", "account_code": "",
                    "amount": 0, "source": je.source or "manual",
                })
        except Exception:
            pass

    synced = add_to_company_baseline(company_id, je_rows, country, db)
    return {
        "synced": synced,
        "total_je": len(je_list),
        "total_lines": len(je_rows),
        "company_id": company_id,
        "country": country,
    }
