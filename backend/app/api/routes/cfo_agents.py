"""CFO Command Center API — agent runs, status, briefings, WebSocket stream."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.agents.command_center.registry import list_agent_names
from app.core.database import get_db
from app.models.cfo_command_center import (
    CFOAgentLog,
    CFOAgentOutput,
    CFOAgentRun,
    CFOAgentRunStatus,
    CFOAlert,
    CFOAlertStatus,
)
from app.services import cfo_briefing_service
from app.services.cfo_audit import unwrap_agent_payload
from app.services.cfo_orchestrator_service import create_queued_run, execute_cfo_agent_task

logger = logging.getLogger(__name__)

agents_router = APIRouter(prefix="/api/agents", tags=["cfo-agents"])
briefing_router = APIRouter(prefix="/api/briefing", tags=["cfo-briefing"])


class AskNexusBody(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)


def tenant_id_header(x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-ID")) -> str:
    return (x_tenant_id or "default").strip() or "default"


class RunAgentBody(BaseModel):
    context: dict[str, Any] = Field(default_factory=dict)


@agents_router.post("/run/{agent_name}")
def post_run_agent(
    agent_name: str,
    body: RunAgentBody,
    background_tasks: BackgroundTasks,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    name = agent_name.strip().lower()
    if name not in list_agent_names():
        raise HTTPException(400, f"Unknown agent. Valid: {', '.join(list_agent_names())}")
    row = create_queued_run(db, tenant_id, name, body.context)
    background_tasks.add_task(execute_cfo_agent_task, row.id)
    return {"cfo_run_id": row.run_id, "id": row.id, "agent": name, "status": "queued"}


@agents_router.get("/alerts")
def get_open_alerts(
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(CFOAlert)
        .filter(CFOAlert.tenant_id == tenant_id, CFOAlert.status == CFOAlertStatus.open)
        .order_by(desc(CFOAlert.created_at))
        .limit(50)
        .all()
    )
    return {
        "alerts": [
            {
                "id": r.id,
                "severity": r.severity.value if hasattr(r.severity, "value") else str(r.severity),
                "agent": r.agent_name,
                "title": r.title,
                "body": r.body,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "meta": r.meta_json,
            }
            for r in rows
        ]
    }


@agents_router.get("/status")
def get_agents_status(
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    names = list_agent_names()
    out = []
    for agent in names:
        last = (
            db.query(CFOAgentRun)
            .filter(CFOAgentRun.tenant_id == tenant_id, CFOAgentRun.agent_name == agent)
            .order_by(desc(CFOAgentRun.created_at))
            .first()
        )
        out.append(
            {
                "agent": agent,
                "last_run_at": last.created_at.isoformat() if last and last.created_at else None,
                "last_status": last.status.value if last else None,
                "last_run_id": last.run_id if last else None,
            }
        )
    return {"agents": out}


@agents_router.get("/completed")
def get_completed_agents(
    hours: int = 24,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    """Agents that completed successfully with validation in the last N hours."""
    h = min(max(hours, 1), 168)
    since = datetime.utcnow() - timedelta(hours=h)
    rows = (
        db.query(CFOAgentRun, CFOAgentOutput)
        .join(CFOAgentOutput, CFOAgentOutput.cfo_agent_run_id == CFOAgentRun.id)
        .filter(
            CFOAgentRun.tenant_id == tenant_id,
            CFOAgentRun.status == CFOAgentRunStatus.completed,
            CFOAgentRun.updated_at >= since,
            CFOAgentOutput.validation_passed.is_(True),
        )
        .order_by(desc(CFOAgentRun.updated_at))
        .limit(80)
        .all()
    )
    items: list[dict[str, Any]] = []
    for run, op in rows:
        inner, audit = unwrap_agent_payload(op.payload_json if isinstance(op.payload_json, dict) else None)
        if inner is None:
            inner = op.payload_json if isinstance(op.payload_json, dict) else {}
        if inner.get("failed"):
            continue
        row_count = _infer_row_count(run.agent_name, inner)
        cp = (audit or {}).get("checks_passed", 0)
        ct = (audit or {}).get("checks_total", 12)
        items.append(
            {
                "agent": run.agent_name,
                "run_id": run.run_id,
                "completed_at": run.updated_at.isoformat() if run.updated_at else None,
                "checks_passed": cp,
                "checks_total": ct,
                "all_checks_passed": bool((audit or {}).get("all_passed")),
                "row_count": row_count,
                "audit": audit,
            }
        )
    return {"window_hours": h, "completed": items}


def _infer_row_count(agent: str, data: dict[str, Any]) -> int:
    if agent in ("fpa_variance", "fpa_budget"):
        return len(data.get("line_items") or [])
    if agent == "je_anomaly":
        s = data.get("summary") or {}
        return int(s.get("total_entries") or len(data.get("entries_scored") or []))
    if agent == "recon":
        p = data.get("progress") or {}
        return int(p.get("total") or 0)
    if agent == "ifrs":
        return 1
    return 0


@agents_router.patch("/alerts/{alert_id}/dismiss")
def patch_dismiss_alert(
    alert_id: int,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    row = (
        db.query(CFOAlert)
        .filter(CFOAlert.id == alert_id, CFOAlert.tenant_id == tenant_id, CFOAlert.status == CFOAlertStatus.open)
        .first()
    )
    if not row:
        raise HTTPException(404, "Alert not found or already dismissed")
    row.status = CFOAlertStatus.dismissed
    db.commit()
    return {"ok": True, "id": alert_id, "status": "dismissed"}


@briefing_router.get("/today")
def get_briefing_today_api(tenant_id: str = Depends(tenant_id_header), db: Session = Depends(get_db)):
    b = cfo_briefing_service.get_briefing_today(db, tenant_id)
    if not b:
        return {"briefing": None, "message": "No briefing for today yet. POST /api/briefing/generate to build one."}
    return {
        "briefing_date": b.briefing_date.isoformat(),
        "content": b.content_json,
        "raw_text": b.raw_text,
        "created_at": b.created_at.isoformat() if b.created_at else None,
    }


@briefing_router.get("/history")
def get_briefing_history(
    days: int = 30,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    rows = cfo_briefing_service.list_briefings(db, tenant_id, days=min(max(days, 1), 90))
    return {
        "items": [
            {
                "id": r.id,
                "briefing_date": r.briefing_date.isoformat(),
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "content": r.content_json,
            }
            for r in rows
        ]
    }


@briefing_router.post("/generate")
def post_generate_briefing(
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    row = cfo_briefing_service.build_briefing_for_tenant(db, tenant_id)
    return {"ok": True, "id": row.id, "briefing_date": row.briefing_date.isoformat()}


@briefing_router.post("/ask")
def post_ask_nexus(
    body: AskNexusBody,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    from app.services import llm_service

    if not llm_service.is_configured():
        raise HTTPException(503, "LLM not configured (ANTHROPIC_API_KEY)")
    snap = {
        "open_alerts": cfo_briefing_service.open_alerts(db, tenant_id),
        "recent": cfo_briefing_service.recent_outputs(db, tenant_id, days=5),
    }
    import json

    prompt = (
        "CFO question:\n"
        f"{body.question.strip()}\n\n"
        "Use this snapshot (JSON). If data is missing, say what is needed to answer.\n"
        f"{json.dumps(snap, default=str)[:16000]}"
    )
    answer = llm_service.invoke(
        prompt=prompt,
        system=cfo_briefing_service.NEXUS_CHAT_SYSTEM,
        max_tokens=2000,
        temperature=0.25,
    )
    return {"answer": answer}


@agents_router.get("/runs/{run_id}")
def get_run_detail(
    run_id: str,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    row = db.query(CFOAgentRun).filter(CFOAgentRun.run_id == run_id, CFOAgentRun.tenant_id == tenant_id).first()
    if not row:
        raise HTTPException(404, "Run not found")
    logs = (
        db.query(CFOAgentLog)
        .filter(CFOAgentLog.cfo_agent_run_id == row.id)
        .order_by(CFOAgentLog.id)
        .all()
    )
    out_row = (
        db.query(CFOAgentOutput)
        .filter(CFOAgentOutput.cfo_agent_run_id == row.id, CFOAgentOutput.output_type == "primary")
        .order_by(desc(CFOAgentOutput.id))
        .first()
    )
    audit = None
    summary_keys: list[str] = []
    if out_row and isinstance(out_row.payload_json, dict):
        inner, audit = unwrap_agent_payload(out_row.payload_json)
        if isinstance(inner, dict):
            summary_keys = list(inner.keys())[:20]
    return {
        "run_id": row.run_id,
        "agent": row.agent_name,
        "status": row.status.value if hasattr(row.status, "value") else str(row.status),
        "error_message": row.error_message,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "logs": [{"level": x.level, "message": x.message, "at": x.created_at.isoformat()} for x in logs],
        "validation_passed": out_row.validation_passed if out_row else None,
        "audit": audit,
        "output_keys": summary_keys,
    }


@agents_router.websocket("/stream")
async def ws_agents_stream(websocket: WebSocket):
    await websocket.accept()
    tenant_id = (websocket.headers.get("x-tenant-id") or websocket.query_params.get("tenant_id") or "default").strip()
    run_filter = (websocket.query_params.get("run_id") or "").strip()
    last_log_id = 0
    try:
        while True:
            from app.core.database import SessionLocal

            db = SessionLocal()
            try:
                q = db.query(CFOAgentRun).filter(CFOAgentRun.tenant_id == tenant_id)
                if run_filter:
                    q = q.filter(CFOAgentRun.run_id == run_filter)
                runs = q.order_by(desc(CFOAgentRun.created_at)).limit(5).all()
                for run in runs:
                    rows = (
                        db.query(CFOAgentLog)
                        .filter(CFOAgentLog.cfo_agent_run_id == run.id, CFOAgentLog.id > last_log_id)
                        .order_by(CFOAgentLog.id)
                        .all()
                    )
                    for r in rows:
                        last_log_id = max(last_log_id, r.id)
                        await websocket.send_json(
                            {
                                "run_id": run.run_id,
                                "agent": run.agent_name,
                                "level": r.level,
                                "message": r.message,
                                "ts": r.created_at.isoformat() if r.created_at else None,
                            }
                        )
                    await websocket.send_json(
                        {
                            "heartbeat": True,
                            "run_id": run.run_id,
                            "status": run.status.value if hasattr(run.status, "value") else str(run.status),
                        }
                    )
            finally:
                db.close()
            await asyncio.sleep(0.6)
    except WebSocketDisconnect:
        logger.info("cfo agents ws disconnect")
    except Exception as e:
        logger.warning("cfo agents ws: %s", e)
        try:
            await websocket.send_json({"error": str(e)})
        except Exception:
            pass
