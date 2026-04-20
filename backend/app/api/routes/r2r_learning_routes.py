"""R2R learning loop API — feedback, baselines, progress."""
from __future__ import annotations

import io
from typing import Any, Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.r2r_learning_engine import R2RLearningEngine

router = APIRouter(prefix="/api/r2r", tags=["r2r-learning"])
_engine = R2RLearningEngine()


class EntryDataBody(BaseModel):
    account: str | None = None
    gl_account: str | None = None
    amount: float = 0.0
    user: str | None = None
    posted_by: str | None = None
    date: str | None = None
    description: str | None = None
    entry_id: str = ""
    risk_score: float = 0.0
    risk_level: str = ""
    risk_reasons: list[str] | str | None = None


class FeedbackBody(BaseModel):
    client_id: str = Field(..., min_length=1, max_length=128)
    entry_id: str = Field(..., min_length=1, max_length=256)
    entry_data: EntryDataBody
    feedback: str
    comment: str = ""
    reviewed_by: str = "analyst"

    @field_validator("feedback")
    @classmethod
    def _norm_feedback(cls, v: str) -> str:
        s = (v or "").strip().lower()
        if s not in ("approved", "rejected", "needs_review"):
            raise ValueError("feedback must be approved, rejected, or needs_review")
        return s


@router.post("/feedback")
def post_r2r_feedback(body: FeedbackBody, db: Session = Depends(get_db)) -> dict[str, Any]:
    ed = body.entry_data.model_dump()
    ed["entry_id"] = body.entry_id or ed.get("entry_id") or ""
    try:
        result = _engine.record_feedback(
            body.client_id.strip(),
            ed,
            body.feedback,
            body.comment,
            body.reviewed_by or "analyst",
            db,
        )
        return {"saved": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/build-baseline")
async def post_build_baseline(
    client_id: str = Form(...),
    client_name: str = Form(""),
    industry: Optional[str] = Form(None),
    fiscal_year_end: Optional[str] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")
    try:
        if file.filename and file.filename.lower().endswith((".xlsx", ".xls")):
            df = pd.read_excel(io.BytesIO(raw), engine="openpyxl")
        else:
            df = pd.read_csv(io.BytesIO(raw))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse file: {e}") from e
    if df is None or df.empty:
        raise HTTPException(status_code=400, detail="No rows in file")

    profile = _engine.build_baseline(
        client_id.strip(),
        (client_name or client_id).strip(),
        df,
        db,
        industry=(industry or "").strip() or None,
        fiscal_year_end=(fiscal_year_end or "").strip() or None,
    )
    acct_n = len(profile.account_baselines or {})
    user_n = len(profile.user_baselines or {})
    return {
        "profile_id": profile.id,
        "client_id": profile.client_id,
        "accounts_learned": acct_n,
        "users_learned": user_n,
        "vendors_learned": len(profile.vendor_baselines or {}),
        "months_of_data": profile.months_of_data,
        "status": profile.learning_status,
    }


@router.get("/learning-progress/{client_id}")
def get_learning_progress(client_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    return _engine.get_learning_progress(client_id.strip(), db)


@router.get("/feedback-history/{client_id}")
def get_feedback_history(
    client_id: str,
    db: Session = Depends(get_db),
    status: Optional[str] = Query(None, description="approved | rejected | needs_review"),
    limit: int = Query(200, ge=1, le=500),
) -> dict[str, Any]:
    items = _engine.list_feedback_history(client_id.strip(), db, status=status, limit=limit)
    return {"client_id": client_id.strip(), "count": len(items), "items": items}
