"""GL vs bank vs subledger reconciliation API."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.database import get_db
from app.middleware.auth import get_current_user
from app.models.users import User
from app.models.gl_reconciliation import GLReconciliation
from app.services import gl_recon_engine as eng
from app.services.gl_recon_pdf import build_gl_recon_pdf_bytes

# Example auth protection added below; replicate for other endpoints in this router as needed.
router = APIRouter(prefix="/api/recon/gl", tags=["gl-reconciliation"])


def _audit(row: GLReconciliation, action: str, detail: dict | None = None) -> None:
    trail = list(row.audit_trail or [])
    trail.append({"at": datetime.utcnow().isoformat() + "Z", "action": action, "detail": detail or {}})
    row.audit_trail = trail
    flag_modified(row, "audit_trail")


@router.post("/start")
async def start_recon(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
    entity_id: str = Form(...),
    period: str = Form(...),
    account_code: str = Form(...),
    account_name: str = Form(""),
    currency: str = Form("INR"),
    company_name: Optional[str] = Form(None),
    gl_file: UploadFile = File(...),
    bank_file: UploadFile = File(...),
    subledger_file: Optional[UploadFile] = File(None),
):
    if not gl_file.filename or not bank_file.filename:
        raise HTTPException(status_code=400, detail="gl_file and bank_file are required")
    try:
        g_raw = await gl_file.read()
        b_raw = await bank_file.read()
        try:
            from app.core.aws_config import upload_to_s3
            upload_to_s3(g_raw, gl_file.filename, folder="uploads", country="UAE")
            upload_to_s3(b_raw, bank_file.filename, folder="uploads", country="UAE")
        except Exception:
            pass  # S3 save is non-critical — processing continues from memory
        gl_df = eng.parse_gl(g_raw, gl_file.filename)
        bank_df = eng.parse_bank(b_raw, bank_file.filename)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Parse error: {e}") from e

    sub_records = None
    if subledger_file and subledger_file.filename:
        try:
            s_raw = await subledger_file.read()
            try:
                from app.core.aws_config import upload_to_s3
                upload_to_s3(s_raw, subledger_file.filename, folder="uploads", country="UAE")
            except Exception:
                pass  # S3 save is non-critical — processing continues from memory
            sub_df = eng.parse_subledger(s_raw, subledger_file.filename)
            sub_records = [
                {
                    "row_id": r["row_id"],
                    "date": r["date"].isoformat() if pd.notna(r["date"]) else "",
                    "invoice_no": str(r.get("invoice_no", "")),
                    "vendor_customer": str(r.get("vendor_customer", "")),
                    "amount": float(r["amount"]),
                }
                for _, r in sub_df.iterrows()
            ]
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Subledger parse error: {e}") from e

    recon_id = str(uuid.uuid4())
    snap: dict[str, Any] = {
        "entity_id": entity_id.strip(),
        "period": period.strip(),
        "account_code": account_code.strip(),
        "account_name": (account_name or "").strip(),
        "currency": (currency or "INR").upper(),
        "company_name": (company_name or "").strip() or entity_id,
        "gl_rows": eng.serialize_gl_bank_df(gl_df),
        "bank_rows": eng.serialize_gl_bank_df(bank_df),
        "subledger_rows": sub_records,
        "files": {"gl": gl_file.filename, "bank": bank_file.filename, "subledger": subledger_file.filename if subledger_file else None},
    }

    row = GLReconciliation(
        recon_id=recon_id,
        entity_id=entity_id.strip(),
        period=period.strip(),
        account_code=account_code.strip(),
        account_name=(account_name or "").strip() or None,
        currency=(currency or "INR").upper(),
        company_name=(company_name or "").strip() or None,
        status="started",
        summary_json={},
        matches_json=[],
        unmatched_gl=[],
        unmatched_bank=[],
        suggested_jes=[],
        audit_trail=[],
        snapshot_json=snap,
    )
    _audit(row, "started", {"recon_id": recon_id})
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"recon_id": recon_id, "status": "started"}


@router.post("/run/{recon_id}")
def run_recon(recon_id: str, db: Session = Depends(get_db)):
    row = db.get(GLReconciliation, recon_id)
    if not row:
        raise HTTPException(status_code=404, detail="recon_id not found")
    snap = dict(row.snapshot_json or {})
    row.status = "matching"
    db.add(row)
    db.commit()

    row = db.get(GLReconciliation, recon_id)
    try:
        gl_df = eng.deserialize_gl_df(snap["gl_rows"])
        bank_df = eng.deserialize_bank_df(snap["bank_rows"])
        sub_df = None
        if snap.get("subledger_rows"):
            sub_df = eng.deserialize_subledger_df(snap["subledger_rows"])
        out = eng.run_reconciliation(gl_df, bank_df, sub_df)
        # merge audit
        trail = list(row.audit_trail or [])
        trail.extend(out.get("audit_trail") or [])
        row.audit_trail = trail
        row.matches_json = out["matches"]
        row.unmatched_gl = out["unmatched_gl"]
        row.unmatched_bank = out["unmatched_bank"]
        row.suggested_jes = out["suggested_jes"]
        row.summary_json = out["summary"]
        row.total_seconds = out["total_seconds"]
        row.status = "complete"
        flag_modified(row, "matches_json")
        flag_modified(row, "unmatched_gl")
        flag_modified(row, "unmatched_bank")
        flag_modified(row, "suggested_jes")
        flag_modified(row, "summary_json")
        flag_modified(row, "audit_trail")
    except Exception as e:
        row.status = "error"
        row.summary_json = {"error": str(e)}
        flag_modified(row, "summary_json")
        _audit(row, "error", {"message": str(e)})

    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "recon_id": recon_id,
        "status": row.status,
        "summary": row.summary_json,
        "matches_count": len(row.matches_json or []),
    }


@router.get("/status/{recon_id}")
def get_status(recon_id: str, db: Session = Depends(get_db)):
    row = db.get(GLReconciliation, recon_id)
    if not row:
        raise HTTPException(status_code=404, detail="recon_id not found")
    return {
        "recon_id": row.recon_id,
        "entity_id": row.entity_id,
        "period": row.period,
        "account_code": row.account_code,
        "status": row.status,
        "currency": row.currency,
        "company_name": row.company_name,
        "summary": row.summary_json,
        "matches_count": len(row.matches_json or []),
        "unmatched_gl_count": len(row.unmatched_gl or []),
        "unmatched_bank_count": len(row.unmatched_bank or []),
        "suggested_jes_count": len(row.suggested_jes or []),
        "total_seconds": row.total_seconds,
        "snapshot_meta": {k: v for k, v in (row.snapshot_json or {}).items() if k != "gl_rows" and k != "bank_rows" and k != "subledger_rows"},
        "approved_by": row.approved_by,
        "approved_at": row.approved_at.isoformat() if row.approved_at else None,
    }


def _filter_matches(matches: list, confidence: Optional[str]) -> list:
    if not confidence:
        return matches
    c = confidence.lower()
    if c == "exact":
        return [m for m in matches if m.get("layer") == 1 or m.get("confidence", 0) == 100]
    if c == "near":
        return [m for m in matches if m.get("confidence_label") == "near"]
    if c == "suggested":
        return [m for m in matches if m.get("confidence_label") == "suggested"]
    return matches


@router.get("/matches/{recon_id}")
def get_matches(
    recon_id: str,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    confidence: Optional[str] = None,
    db: Session = Depends(get_db),
):
    row = db.get(GLReconciliation, recon_id)
    if not row:
        raise HTTPException(status_code=404, detail="recon_id not found")
    m = _filter_matches(list(row.matches_json or []), confidence)
    start = (page - 1) * size
    chunk = m[start : start + size]
    return {"page": page, "size": size, "total": len(m), "items": chunk}


@router.get("/unmatched/{recon_id}")
def get_unmatched(
    recon_id: str,
    source: Optional[str] = Query(None, description="gl or bank"),
    category: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    row = db.get(GLReconciliation, recon_id)
    if not row:
        raise HTTPException(status_code=404, detail="recon_id not found")
    items: list = []
    if source in (None, "gl"):
        items.extend(list(row.unmatched_gl or []))
    if source in (None, "bank"):
        items.extend(list(row.unmatched_bank or []))
    if category:
        items = [x for x in items if x.get("category") == category]
    return {"items": items, "total": len(items)}


@router.get("/suggested-jes/{recon_id}")
def get_suggested_jes(recon_id: str, db: Session = Depends(get_db)):
    row = db.get(GLReconciliation, recon_id)
    if not row:
        raise HTTPException(status_code=404, detail="recon_id not found")
    return {"items": list(row.suggested_jes or [])}


class ApproveBody(BaseModel):
    approver: str


@router.post("/approve/{recon_id}")
def approve(recon_id: str, body: ApproveBody, db: Session = Depends(get_db)):
    row = db.get(GLReconciliation, recon_id)
    if not row:
        raise HTTPException(status_code=404, detail="recon_id not found")
    if not body.approver.strip():
        raise HTTPException(status_code=400, detail="approver required")
    row.approved_by = body.approver.strip()
    row.approved_at = datetime.utcnow()
    _audit(row, "approved", {"approver": row.approved_by})
    db.add(row)
    db.commit()
    return {"recon_id": recon_id, "approved_by": row.approved_by}


class ClearBody(BaseModel):
    source: str
    row_id: str


@router.post("/clear/{recon_id}")
def mark_cleared(recon_id: str, body: ClearBody, db: Session = Depends(get_db)):
    row = db.get(GLReconciliation, recon_id)
    if not row:
        raise HTTPException(status_code=404, detail="recon_id not found")
    summary = dict(row.summary_json or {})
    clears = list(summary.get("manual_clears", []))
    clears.append({"source": body.source, "row_id": body.row_id, "at": datetime.utcnow().isoformat() + "Z"})
    summary["manual_clears"] = clears
    row.summary_json = summary
    flag_modified(row, "summary_json")
    _audit(row, "mark_cleared", {"source": body.source, "row_id": body.row_id})
    if body.source == "gl":
        row.unmatched_gl = [x for x in (row.unmatched_gl or []) if x.get("row_id") != body.row_id]
    elif body.source == "bank":
        row.unmatched_bank = [x for x in (row.unmatched_bank or []) if x.get("row_id") != body.row_id]
    flag_modified(row, "unmatched_gl")
    flag_modified(row, "unmatched_bank")
    db.add(row)
    db.commit()
    return {"ok": True, "cleared": body.row_id}


class JEActionBody(BaseModel):
    je_id: str
    action: str  # accept | reject


@router.post("/je-action/{recon_id}")
def je_action(recon_id: str, body: JEActionBody, db: Session = Depends(get_db)):
    row = db.get(GLReconciliation, recon_id)
    if not row:
        raise HTTPException(status_code=404, detail="recon_id not found")
    jes = list(row.suggested_jes or [])
    found = False
    for je in jes:
        if je.get("id") == body.je_id:
            je["user_status"] = "accepted" if body.action == "accept" else "rejected"
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="je_id not found")
    row.suggested_jes = jes
    flag_modified(row, "suggested_jes")
    _audit(row, "je_action", {"je_id": body.je_id, "action": body.action})
    db.add(row)
    db.commit()
    return {"ok": True, "je_id": body.je_id, "status": body.action}


@router.get("/history")
def history(entity_id: Optional[str] = None, account_code: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(GLReconciliation).order_by(GLReconciliation.created_at.desc())
    if entity_id:
        q = q.filter(GLReconciliation.entity_id == entity_id.strip())
    if account_code:
        q = q.filter(GLReconciliation.account_code == account_code.strip())
    rows = q.limit(100).all()
    return {
        "recons": [
            {
                "recon_id": r.recon_id,
                "entity_id": r.entity_id,
                "period": r.period,
                "account_code": r.account_code,
                "status": r.status,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
    }


@router.get("/report/{recon_id}/pdf")
def report_pdf(recon_id: str, db: Session = Depends(get_db)):
    row = db.get(GLReconciliation, recon_id)
    if not row:
        raise HTTPException(status_code=404, detail="recon_id not found")
    if row.status != "complete":
        raise HTTPException(status_code=400, detail="Complete reconciliation first")
    summary = row.summary_json or {}
    pdf = build_gl_recon_pdf_bytes(
        company_name=row.company_name or row.entity_id,
        account_code=row.account_code,
        account_name=row.account_name or "",
        period=row.period,
        summary=summary,
        matches_sample=list(row.matches_json or [])[:20],
        unmatched_gl=list(row.unmatched_gl or []),
        unmatched_bank=list(row.unmatched_bank or []),
        suggested_jes=list(row.suggested_jes or []),
        currency=row.currency or "INR",
    )
    fn = f"GL_Recon_{row.account_code}_{row.period}_{row.recon_id[:8]}.pdf"
    return Response(content=pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{fn}"'})
