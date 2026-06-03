"""Earnings Reviewer API — management accounts vs prior, budget, consensus."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.database import get_db
from app.middleware.auth import get_current_user
from app.models.users import User
from app.models.earnings_review import EarningsReview
from app.services.earnings_review_engine import parse_analyst_consensus, run_earnings_review
from app.services.earnings_review_pdf import build_earnings_pdf_bytes
from app.services.line_item_parser import LineItemParser

# Example auth protection added below; replicate for other endpoints in this router as needed.
router = APIRouter(prefix="/api/earnings", tags=["earnings-reviewer"])


@router.post("/start")
async def start_review(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
    entity_id: str = Form(...),
    period: str = Form(...),
    period_type: str = Form("quarterly"),
    currency: str = Form("INR"),
    company_name: Optional[str] = Form(None),
    current_period_file: UploadFile = File(...),
    prior_period_file: UploadFile = File(...),
    budget_file: Optional[UploadFile] = File(None),
    analyst_file: Optional[UploadFile] = File(None),
):
    if not current_period_file.filename or not prior_period_file.filename:
        raise HTTPException(status_code=400, detail="current_period_file and prior_period_file are required")

    cur_raw = await current_period_file.read()
    pri_raw = await prior_period_file.read()
    try:
        from app.core.aws_config import upload_to_s3
        upload_to_s3(cur_raw, current_period_file.filename, folder="uploads", country="UAE")
        upload_to_s3(pri_raw, prior_period_file.filename, folder="uploads", country="UAE")
    except Exception:
        pass  # S3 save is non-critical — processing continues from memory
    try:
        current = LineItemParser.parse_pl_to_metrics(cur_raw, current_period_file.filename)
        prior = LineItemParser.parse_pl_to_metrics(pri_raw, prior_period_file.filename)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse P&L: {e}") from e

    budget = None
    if budget_file and budget_file.filename:
        try:
            b_raw = await budget_file.read()
            try:
                from app.core.aws_config import upload_to_s3
                upload_to_s3(b_raw, budget_file.filename, folder="uploads", country="UAE")
            except Exception:
                pass  # S3 save is non-critical — processing continues from memory
            budget = LineItemParser.parse_pl_to_metrics(b_raw, budget_file.filename)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse budget file: {e}") from e

    consensus = None
    if analyst_file and analyst_file.filename:
        try:
            a_raw = await analyst_file.read()
            try:
                from app.core.aws_config import upload_to_s3
                upload_to_s3(a_raw, analyst_file.filename, folder="uploads", country="UAE")
            except Exception:
                pass  # S3 save is non-critical — processing continues from memory
            consensus = parse_analyst_consensus(a_raw, analyst_file.filename)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse analyst consensus: {e}") from e

    review_id = str(uuid.uuid4())
    snap = {
        "entity_id": entity_id.strip(),
        "period": period.strip(),
        "period_type": (period_type or "quarterly").strip().lower(),
        "currency": (currency or "INR").upper(),
        "company_name": (company_name or "").strip() or entity_id,
        "current": current,
        "prior": prior,
        "budget": budget,
        "consensus": consensus,
        "files": {
            "current": current_period_file.filename,
            "prior": prior_period_file.filename,
            "budget": budget_file.filename if budget_file else None,
            "analyst": analyst_file.filename if analyst_file else None,
        },
    }

    row = EarningsReview(
        review_id=review_id,
        entity_id=entity_id.strip(),
        period=period.strip(),
        period_type=(period_type or "quarterly").strip().lower(),
        currency=(currency or "INR").upper(),
        company_name=(company_name or "").strip() or None,
        status="started",
        variances_json={},
        commentary_json={},
        quality_score=None,
        flags_json=[],
        headline_verdict=None,
        snapshot_json=snap,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"review_id": review_id, "status": "started"}


@router.post("/run/{review_id}")
def run_review(review_id: str, db: Session = Depends(get_db)):
    row = db.get(EarningsReview, review_id)
    if not row:
        raise HTTPException(status_code=404, detail="review_id not found")

    snap = dict(row.snapshot_json or {})
    row.status = "running"
    db.add(row)
    db.commit()

    row = db.get(EarningsReview, review_id)
    company = snap.get("company_name") or row.entity_id
    try:
        out = run_earnings_review(
            company_name=company,
            period=row.period,
            currency=row.currency,
            current=snap["current"],
            prior=snap["prior"],
            budget=snap.get("budget"),
            consensus=snap.get("consensus"),
        )
        row.variances_json = out["variances"]
        row.commentary_json = out["commentary_json"]
        row.quality_score = out["quality_score"]
        row.flags_json = out["flags_json"]
        row.headline_verdict = out["headline_verdict"]
        row.total_seconds = out["total_seconds"]
        row.status = "complete"
        flag_modified(row, "variances_json")
        flag_modified(row, "commentary_json")
        flag_modified(row, "flags_json")
    except Exception as e:
        row.status = "error"
        row.variances_json = {"error": str(e)}
        flag_modified(row, "variances_json")

    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "review_id": review_id,
        "status": row.status,
        "quality_score": row.quality_score,
        "headline_verdict": row.headline_verdict,
        "variances": row.variances_json,
        "commentary": row.commentary_json,
        "flags": row.flags_json,
    }


@router.get("/status/{review_id}")
def get_status(review_id: str, db: Session = Depends(get_db)):
    row = db.get(EarningsReview, review_id)
    if not row:
        raise HTTPException(status_code=404, detail="review_id not found")
    return {
        "review_id": row.review_id,
        "entity_id": row.entity_id,
        "period": row.period,
        "period_type": row.period_type,
        "status": row.status,
        "currency": row.currency,
        "company_name": row.company_name,
        "quality_score": row.quality_score,
        "headline_verdict": row.headline_verdict,
        "variances": row.variances_json,
        "commentary": row.commentary_json,
        "flags": row.flags_json,
        "total_seconds": row.total_seconds,
        "snapshot": row.snapshot_json,
        "approved_by": row.approved_by,
        "approved_at": row.approved_at.isoformat() if row.approved_at else None,
    }


@router.get("/history")
def history(entity_id: Optional[str] = None, period_type: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(EarningsReview).order_by(EarningsReview.created_at.desc())
    if entity_id:
        q = q.filter(EarningsReview.entity_id == entity_id.strip())
    if period_type:
        q = q.filter(EarningsReview.period_type == period_type.strip().lower())
    rows = q.limit(100).all()
    return {
        "reviews": [
            {
                "review_id": r.review_id,
                "entity_id": r.entity_id,
                "period": r.period,
                "period_type": r.period_type,
                "status": r.status,
                "quality_score": r.quality_score,
                "headline_verdict": r.headline_verdict,
                "total_seconds": r.total_seconds,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
    }


class ApproveBody(BaseModel):
    approver: str


@router.post("/approve/{review_id}")
def approve(review_id: str, body: ApproveBody, db: Session = Depends(get_db)):
    row = db.get(EarningsReview, review_id)
    if not row:
        raise HTTPException(status_code=404, detail="review_id not found")
    if not body.approver.strip():
        raise HTTPException(status_code=400, detail="approver required")
    row.approved_by = body.approver.strip()
    row.approved_at = datetime.utcnow()
    db.add(row)
    db.commit()
    return {"review_id": review_id, "approved_by": row.approved_by, "approved_at": row.approved_at.isoformat()}


@router.get("/report/{review_id}/pdf")
def report_pdf(review_id: str, db: Session = Depends(get_db)):
    row = db.get(EarningsReview, review_id)
    if not row:
        raise HTTPException(status_code=404, detail="review_id not found")
    v = row.variances_json or {}
    if row.status != "complete" or not v.get("current"):
        raise HTTPException(status_code=400, detail="Run analysis first (status must be complete).")
    commentary = (row.commentary_json or {}).get("full_text") or ""
    pdf = build_earnings_pdf_bytes(
        company_name=row.company_name or row.entity_id,
        period=row.period,
        headline=row.headline_verdict or "IN LINE",
        quality_score=float(row.quality_score or 0),
        variances=v,
        commentary_full=commentary,
        flags=list(row.flags_json or []),
        currency=row.currency or "INR",
    )
    fn = f"Earnings_Review_{row.period}_{row.review_id[:8]}.pdf"
    return Response(content=pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{fn}"'})
