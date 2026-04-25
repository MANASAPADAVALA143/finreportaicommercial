"""Multi-agent IFRS orchestration API (additive; wraps Week 1 + Week 2)."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.agents.nexus_orchestrator import (
    create_run_record,
    execute_agentic_pipeline,
    resume_agentic_pipeline,
)
from app.agents.packager_agent import load_export_bytes
from app.core.database import SessionLocal, get_db
from app.models.ifrs_agentic import AgentHumanReview, AgentRun, AgentRunLog, AgentRunStatus, AgentValidation, HumanReviewStatus
from app.models.ifrs_statement import TrialBalance

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ifrs/agentic", tags=["ifrs-agentic"])


def tenant_id_header(x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-ID")) -> str:
    return (x_tenant_id or "default").strip() or "default"


class StartBody(BaseModel):
    trial_balance_id: int = Field(..., ge=1)
    prior_trial_balance_id: Optional[int] = Field(
        default=None,
        ge=1,
        description="Option B/C: explicit prior-year TB id (else auto-resolve from vault / prior TB).",
    )
    manual_prior: Optional[dict[str, Any]] = Field(
        default=None,
        description="Option C key totals, e.g. revenue, total_assets, total_equity, cash, retained_earnings_closing",
    )


class HumanInputBody(BaseModel):
    action: str = Field(default="continue", description="continue | abort")
    resume_from: Optional[str] = Field(
        default=None,
        description="One of: MAPPER, BUILDER, AUDITOR, FIXER, SCRIBE, NARRATOR, PACKAGER",
    )
    review_ids: list[int] = Field(default_factory=list)


@router.post("/start")
def post_start(
    body: StartBody,
    background_tasks: BackgroundTasks,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    tb = (
        db.query(TrialBalance)
        .filter(TrialBalance.id == body.trial_balance_id, TrialBalance.tenant_id == tenant_id)
        .first()
    )
    if not tb:
        raise HTTPException(status_code=404, detail="Trial balance not found")

    run = create_run_record(
        db,
        tenant_id,
        body.trial_balance_id,
        prior_trial_balance_id=body.prior_trial_balance_id,
        manual_prior=body.manual_prior,
    )
    background_tasks.add_task(execute_agentic_pipeline, run.run_id, tenant_id, body.trial_balance_id)
    return {"run_id": run.run_id, "status": "started"}


@router.post("/upload-trial-balance-multi-year")
async def post_upload_multi_year(
    file: UploadFile = File(...),
    company_name: str = Form("Uploaded Entity"),
    currency: Optional[str] = Form(None),
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    """
    Option A — one workbook/CSV with a Year (or FY) column: creates one TrialBalance per fiscal year.
    Map each TB in Week 1 UI, then start agentic on the latest year with prior_trial_balance_id if needed.
    """
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    from app.services.ifrs_multi_year_upload import upload_multi_year_trial_balance

    try:
        return upload_multi_year_trial_balance(
            db,
            tenant_id=tenant_id,
            filename=file.filename or "trial_balance.csv",
            file_bytes=content,
            company_name=company_name,
            currency=currency,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


def _get_run(db: Session, run_id: str, tenant_id: str) -> AgentRun:
    run = db.query(AgentRun).filter(AgentRun.run_id == run_id, AgentRun.tenant_id == tenant_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@router.get("/{run_id}/status")
def get_status(
    run_id: str,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    run = _get_run(db, run_id, tenant_id)
    logs = (
        db.query(AgentRunLog)
        .filter(AgentRunLog.agent_run_id == run.id)
        .order_by(AgentRunLog.id.desc())
        .limit(50)
        .all()
    )
    logs_chrono = list(reversed(logs))
    validations = (
        db.query(AgentValidation)
        .filter(AgentValidation.agent_run_id == run.id)
        .order_by(AgentValidation.id)
        .all()
    )
    reviews = (
        db.query(AgentHumanReview)
        .filter(AgentHumanReview.agent_run_id == run.id)
        .order_by(AgentHumanReview.id)
        .all()
    )
    est_remaining_s = None
    if run.status == AgentRunStatus.running and run.progress_pct and run.progress_pct > 2:
        elapsed = (datetime.utcnow() - run.started_at).total_seconds()
        frac = run.progress_pct / 100.0
        if frac > 0.05:
            est_total = elapsed / frac
            est_remaining_s = max(0, int(est_total - elapsed))

    return {
        "run_id": run.run_id,
        "status": run.status.value,
        "current_agent": run.current_agent,
        "progress_pct": run.progress_pct,
        "agents_completed": run.agents_completed or [],
        "logs": [{"agent_id": x.agent_id, "message": x.message, "ts": x.timestamp.isoformat()} for x in logs_chrono],
        "validation_results": [
            {"check_name": v.check_name, "passed": v.passed, "error": v.error} for v in validations
        ],
        "human_review_items": [
            {
                "id": r.id,
                "item": r.item,
                "status": r.status.value,
                "resolution": r.resolution,
            }
            for r in reviews
        ],
        "pause_reason": run.pause_reason,
        "resume_from_agent": run.resume_from_agent,
        "error_message": run.error_message,
        "estimated_seconds_remaining": est_remaining_s,
    }


@router.get("/{run_id}/output")
def get_output(
    run_id: str,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    run = _get_run(db, run_id, tenant_id)
    if run.status != AgentRunStatus.completed:
        raise HTTPException(status_code=409, detail="Run not completed yet")
    out = run.output or {}
    return {
        "statements": out.get("statements"),
        "notes": out.get("notes"),
        "commentary": out.get("commentary"),
        "exports": out.get("exports"),
    }


@router.post("/{run_id}/human-input")
def post_human_input(
    run_id: str,
    body: HumanInputBody,
    background_tasks: BackgroundTasks,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    run = _get_run(db, run_id, tenant_id)
    if body.action == "abort":
        run.status = AgentRunStatus.failed
        run.error_message = "Aborted by user"
        db.commit()
        return {"ok": True, "status": run.status.value}

    for rid in body.review_ids:
        r = (
            db.query(AgentHumanReview)
            .filter(AgentHumanReview.id == rid, AgentHumanReview.agent_run_id == run.id)
            .first()
        )
        if r:
            r.status = HumanReviewStatus.resolved
            r.resolution = r.resolution or "user_continue"
    resume = body.resume_from or run.resume_from_agent or "BUILDER"
    run.status = AgentRunStatus.running
    run.pause_reason = None
    db.commit()
    background_tasks.add_task(resume_agentic_pipeline, run.run_id, tenant_id, resume)
    return {"ok": True, "status": "started", "resume_from": resume}


@router.get("/{run_id}/download/{kind}")
def download_export(
    run_id: str,
    kind: str,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    if kind not in ("xlsx", "docx", "pdf"):
        raise HTTPException(status_code=400, detail="kind must be xlsx, docx, or pdf")
    run = _get_run(db, run_id, tenant_id)
    if run.status != AgentRunStatus.completed:
        raise HTTPException(status_code=409, detail="Run not completed")
    paths = (run.output or {}).get("export_paths") or {}
    key = {"xlsx": "xlsx", "docx": "docx", "pdf": "pdf"}[kind]
    from pathlib import Path

    p = Path(paths.get(key) or "")
    if not p.exists():
        raise HTTPException(status_code=404, detail="Export file missing")
    data, media, fname = load_export_bytes(p, kind)
    from fastapi.responses import Response

    return Response(content=data, media_type=media, headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@router.websocket("/{run_id}/stream")
async def ws_stream(websocket: WebSocket, run_id: str):
    await websocket.accept()
    tenant_id = (websocket.headers.get("x-tenant-id") or websocket.query_params.get("tenant_id") or "default").strip()
    last_log_id = 0
    run: AgentRun | None = None
    try:
        while True:
            db = SessionLocal()
            try:
                run = db.query(AgentRun).filter(AgentRun.run_id == run_id, AgentRun.tenant_id == tenant_id).first()
                if not run:
                    await websocket.send_json({"error": "run_not_found"})
                    break
                rows = (
                    db.query(AgentRunLog)
                    .filter(AgentRunLog.agent_run_id == run.id, AgentRunLog.id > last_log_id)
                    .order_by(AgentRunLog.id)
                    .all()
                )
                for r in rows:
                    last_log_id = max(last_log_id, r.id)
                    await websocket.send_json(
                        {
                            "agent_id": r.agent_id,
                            "message": r.message,
                            "ts": r.timestamp.isoformat(),
                        }
                    )
                await websocket.send_json(
                    {
                        "heartbeat": True,
                        "status": run.status.value,
                        "progress_pct": run.progress_pct,
                        "current_agent": run.current_agent,
                    }
                )
            finally:
                db.close()

            if run is None:
                break
            if run.status in (AgentRunStatus.completed, AgentRunStatus.failed, AgentRunStatus.paused):
                await asyncio.sleep(0.5)
                if run.status in (AgentRunStatus.completed, AgentRunStatus.failed):
                    break
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        logger.info("agentic ws disconnect %s", run_id)
    except Exception as e:
        logger.warning("agentic ws error: %s", e)
        try:
            await websocket.send_json({"error": str(e)})
        except Exception:
            pass
