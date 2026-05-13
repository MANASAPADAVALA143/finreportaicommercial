"""Month-end close module — IFRS checklist, integrity, PDF (FastAPI)."""

from __future__ import annotations

import io
import uuid
from datetime import datetime
from typing import Any, Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.database import get_db
from app.middleware.auth import get_current_user
from app.models.users import User
from app.models.month_end_close import CloseRun
from app.services.month_end_close_engine import (
    initial_checklist,
    opening_from_prior_tb,
    parse_journal_entries,
    parse_trial_balance,
    run_all_checks,
)
from app.services.month_end_close_pdf import build_close_pdf_bytes

# Example auth protection added below; replicate for other endpoints in this router as needed.
router = APIRouter(prefix="/api/close", tags=["month-end-close"])


def _append_audit(run: CloseRun, action: str, detail: dict | None = None) -> None:
    trail = list(run.audit_trail or [])
    trail.append({"at": datetime.utcnow().isoformat() + "Z", "action": action, "detail": detail or {}})
    run.audit_trail = trail


def _df_records(content: bytes, filename: str) -> list[dict]:
    bio = io.BytesIO(content)
    fn = (filename or "").lower()
    if fn.endswith((".xlsx", ".xls")):
        df = pd.read_excel(bio)
    else:
        df = pd.read_csv(io.BytesIO(content))
    return df.fillna("").to_dict(orient="records")


class StartCloseJson(BaseModel):
    entity_id: str
    period: str
    currency: str = Field(default="INR", description="INR uses ₹ in reports; otherwise $")
    company_name: Optional[str] = None
    uploaded_files: list[dict[str, Any]] = Field(default_factory=list)


@router.post("/start")
async def start_close(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
    entity_id: str = Form(...),
    period: str = Form(...),
    currency: str = Form("INR"),
    company_name: Optional[str] = Form(None),
    trial_balance_file: Optional[UploadFile] = File(None),
    journal_entries_file: Optional[UploadFile] = File(None),
    bank_statement_file: Optional[UploadFile] = File(None),
    prior_financials_file: Optional[UploadFile] = File(None),
):
    """
    Multipart close start (TB, JEs, bank, prior-period financials).
    Returns run_id and status started.
    """
    run_id = str(uuid.uuid4())
    snap: dict[str, Any] = {
        "uploaded": [],
        "currency": (currency or "INR").upper(),
    }

    if trial_balance_file and trial_balance_file.filename:
        raw = await trial_balance_file.read()
        snap["trial_balance"] = parse_trial_balance(raw, trial_balance_file.filename)
        snap["uploaded"].append({"role": "trial_balance", "filename": trial_balance_file.filename})

    if journal_entries_file and journal_entries_file.filename:
        raw = await journal_entries_file.read()
        je_df = parse_journal_entries(raw, journal_entries_file.filename)
        snap["journal_entries_rows"] = je_df.fillna("").to_dict(orient="records")
        snap["uploaded"].append({"role": "journal_entries", "filename": journal_entries_file.filename})

    if bank_statement_file and bank_statement_file.filename:
        raw = await bank_statement_file.read()
        snap["bank_rows"] = _df_records(raw, bank_statement_file.filename)
        snap["uploaded"].append({"role": "bank_statement", "filename": bank_statement_file.filename})

    if prior_financials_file and prior_financials_file.filename:
        raw = await prior_financials_file.read()
        prior_tb = parse_trial_balance(raw, prior_financials_file.filename)
        snap["uploaded"].append({"role": "prior_financials", "filename": prior_financials_file.filename})
        opens = opening_from_prior_tb(
            prior_tb,
            entity_name=company_name or entity_id,
            period_label=f"prior_to_{period}",
            currency=currency or "INR",
        )
        snap["opening_retained_earnings"] = opens["opening_retained_earnings"]
        snap["opening_cash"] = opens["opening_cash"]

    run = CloseRun(
        run_id=run_id,
        entity_id=entity_id.strip(),
        period=period.strip(),
        company_name=(company_name or "").strip() or None,
        currency=(currency or "INR").upper(),
        status="started",
        checks_json={"items": initial_checklist(), "integrity": {}, "progress_pct": 0},
        snapshot_json=snap,
        audit_trail=[],
    )
    _append_audit(run, "close_started", {"entity_id": entity_id, "period": period})
    db.add(run)
    db.commit()
    db.refresh(run)
    return {"run_id": run_id, "status": "started"}


@router.post("/start-json")
async def start_close_json(body: StartCloseJson, db: Session = Depends(get_db)):
    """JSON-only start (metadata + optional file names) for integrations without multipart."""
    run_id = str(uuid.uuid4())
    run = CloseRun(
        run_id=run_id,
        entity_id=body.entity_id.strip(),
        period=body.period.strip(),
        company_name=body.company_name,
        currency=(body.currency or "INR").upper(),
        status="started",
        checks_json={"items": initial_checklist(), "integrity": {}, "progress_pct": 0},
        snapshot_json={"uploaded": body.uploaded_files, "currency": (body.currency or "INR").upper()},
        audit_trail=[],
    )
    _append_audit(run, "close_started_json", {"entity_id": body.entity_id})
    db.add(run)
    db.commit()
    return {"run_id": run_id, "status": "started"}


@router.get("/status/{run_id}")
def get_status(run_id: str, db: Session = Depends(get_db)):
    run = db.get(CloseRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="run_id not found")
    cj = run.checks_json or {}
    return {
        "run_id": run.run_id,
        "entity_id": run.entity_id,
        "period": run.period,
        "status": run.status,
        "currency": run.currency,
        "progress_pct": cj.get("progress_pct", 0),
        "items": cj.get("items", []),
        "integrity": cj.get("integrity", {}),
        "total_seconds": run.total_seconds,
        "approved_by": run.approved_by,
        "approved_at": run.approved_at.isoformat() if run.approved_at else None,
    }


@router.post("/run-checks/{run_id}")
def run_checks(run_id: str, db: Session = Depends(get_db)):
    run = db.get(CloseRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="run_id not found")
    run.status = "running_checks"
    cj = dict(run.checks_json or {})
    items = list(cj.get("items") or [])
    for it in items:
        if it.get("status") == "pending":
            it["status"] = "running"
    cj["items"] = items
    run.checks_json = cj
    flag_modified(run, "checks_json")
    _append_audit(run, "checks_started", {})
    db.add(run)
    db.commit()

    run = db.get(CloseRun, run_id)
    try:
        run_all_checks(db, run)
    except Exception as e:
        run.status = "error"
        _append_audit(run, "checks_failed", {"error": str(e)})
        cj = dict(run.checks_json or {})
        for it in cj.get("items", []):
            if it.get("status") in ("pending", "running"):
                it["status"] = "check_error"
                it["result_summary"] = f"Run aborted: {e}"
        run.checks_json = cj
        flag_modified(run, "checks_json")
        db.add(run)
    db.commit()
    db.refresh(run)
    return {"run_id": run_id, "status": run.status, "progress_pct": (run.checks_json or {}).get("progress_pct")}


class ApproveBody(BaseModel):
    approver: str


@router.post("/approve/{run_id}")
def approve_close(run_id: str, body: ApproveBody, db: Session = Depends(get_db)):
    run = db.get(CloseRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="run_id not found")
    if not (body.approver and body.approver.strip()):
        raise HTTPException(status_code=400, detail="approver is required")
    run.approved_by = body.approver.strip()
    run.approved_at = datetime.utcnow()
    run.status = "approved"
    _append_audit(run, "close_approved", {"approver": run.approved_by})
    db.add(run)
    db.commit()
    return {"run_id": run_id, "status": "approved", "approved_by": run.approved_by, "approved_at": run.approved_at.isoformat()}


@router.get("/history")
def list_history(entity_id: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(CloseRun).order_by(CloseRun.created_at.desc())
    if entity_id:
        q = q.filter(CloseRun.entity_id == entity_id.strip())
    rows = q.limit(100).all()
    out = []
    for r in rows:
        out.append(
            {
                "run_id": r.run_id,
                "entity_id": r.entity_id,
                "period": r.period,
                "status": r.status,
                "total_seconds": r.total_seconds,
                "approved_by": r.approved_by,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
        )
    return {"runs": out}


@router.get("/report/{run_id}/pdf")
def download_pdf(run_id: str, db: Session = Depends(get_db)):
    run = db.get(CloseRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="run_id not found")
    cj = run.checks_json or {}
    pdf = build_close_pdf_bytes(
        company_name=run.company_name or run.entity_id,
        period=run.period,
        prepared_by="FinReportAI Month-End Close",
        checks_payload=cj,
        integrity=cj.get("integrity") or {},
        currency=run.currency or "INR",
    )
    fname = f"IFRS_Close_{run.period}_{run.run_id[:8]}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
