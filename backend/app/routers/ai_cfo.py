"""AI CFO Command Centre API — detection, agent investigations, approvals, activity.

Scoped like Internal Audit: the caller's verified workspace plus a company they can access
(read to view, write to run detection or investigations, manage to decide approvals or
seed the demo company). Investigations run in the background; poll GET /investigations/{id}.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Callable, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.models.ai_cfo import AiCfoApprovalRequest, AiCfoFinding, AiCfoInvestigation, AiCfoToolCall
from app.routers.internal_audit import Scope, _manage, _read, _row, _write
from app.services import llm_service
from app.services.ai_cfo import agent as ai_agent
from app.services.ai_cfo import ledger
from app.services.ai_cfo.demo import seed_demo_company
from app.services.ai_cfo.detection import run_detection
from app.services.ai_cfo.ledger import LedgerScope
from app.services.audit_log_service import log_audit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai-cfo", tags=["ai-cfo"])

MAX_ACTIVE_RUNS = 3
_SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}
session_factory: Callable[[], Session] = SessionLocal


def _ledger_scope(scope: Scope) -> LedgerScope:
    return LedgerScope(scope.workspace_id, scope.company_id)


def _get(db: Session, model: Any, obj_id: int, scope: Scope) -> Any:
    obj = db.query(model).filter(
        model.id == obj_id, model.workspace_id == scope.workspace_id, model.company_id == scope.company_id
    ).first()
    if obj is None:
        raise HTTPException(status_code=404, detail="Not found")
    return obj


def _audit(db: Session, scope: Scope, action: str, entity_type: str, entity_id: Any, details: dict) -> None:
    try:
        log_audit(
            db, workspace_id=scope.workspace_id, company_id=scope.company_id, action=action,
            entity_type=entity_type, entity_id=str(entity_id), user_email=scope.user_email, details=details,
        )
    except Exception as exc:  # noqa: BLE001 - the audit table must never block the action
        logger.warning("ai-cfo audit log failed: %s", exc)


# ── Overview ─────────────────────────────────────────────────────────────────


@router.get("/overview")
def overview(scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    ls = _ledger_scope(scope)
    findings = db.query(AiCfoFinding).filter(
        AiCfoFinding.workspace_id == scope.workspace_id, AiCfoFinding.company_id == scope.company_id
    )
    by_status = dict(findings.with_entities(AiCfoFinding.status, func.count()).group_by(AiCfoFinding.status).all())
    open_by_severity = dict(
        findings.filter(AiCfoFinding.status.in_(("open", "investigated")))
        .with_entities(AiCfoFinding.severity, func.count()).group_by(AiCfoFinding.severity).all()
    )
    inv_by_status = dict(
        db.query(AiCfoInvestigation.status, func.count())
        .filter(AiCfoInvestigation.workspace_id == scope.workspace_id, AiCfoInvestigation.company_id == scope.company_id)
        .group_by(AiCfoInvestigation.status).all()
    )
    pending = (
        db.query(func.count(AiCfoApprovalRequest.id))
        .filter(
            AiCfoApprovalRequest.workspace_id == scope.workspace_id,
            AiCfoApprovalRequest.company_id == scope.company_id,
            AiCfoApprovalRequest.status == "pending",
        ).scalar() or 0
    )
    return {
        "coverage": ledger.coverage(db, ls),
        "findings_by_status": by_status,
        "open_findings_by_severity": open_by_severity,
        "investigations_by_status": inv_by_status,
        "pending_approvals": pending,
        "ai_configured": llm_service.is_configured(),
    }


# ── Detection and findings ───────────────────────────────────────────────────


class DetectIn(BaseModel):
    period: str | None = Field(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$")


@router.post("/detect")
def detect(body: DetectIn, scope: Scope = Depends(_write), db: Session = Depends(get_db)):
    result = run_detection(db, _ledger_scope(scope), body.period)
    _audit(db, scope, "ai_cfo.detection.run", "ai_cfo_detection", result["period"] or "none",
           {"created": result["created"], "updated": result["updated"]})
    db.commit()
    return {**result, "findings": [_row(f) for f in result["findings"]]}


FindingStatus = Literal["open", "investigated", "dismissed", "resolved"]


@router.get("/findings")
def list_findings(
    status: FindingStatus | None = None, scope: Scope = Depends(_read), db: Session = Depends(get_db)
):
    q = db.query(AiCfoFinding).filter(
        AiCfoFinding.workspace_id == scope.workspace_id, AiCfoFinding.company_id == scope.company_id
    )
    if status:
        q = q.filter(AiCfoFinding.status == status)
    rows = q.order_by(AiCfoFinding.period.desc(), AiCfoFinding.id.desc()).limit(200).all()
    rows.sort(key=lambda f: (f.period, -_SEVERITY_ORDER.get(f.severity, 9)), reverse=True)
    return [_row(f) for f in rows]


def _investigation_out(db: Session, inv: AiCfoInvestigation, *, with_steps: bool) -> dict[str, Any]:
    out = _row(inv)
    if with_steps:
        out["tool_calls"] = [
            _row(c) for c in db.query(AiCfoToolCall)
            .filter(AiCfoToolCall.investigation_id == inv.id).order_by(AiCfoToolCall.step, AiCfoToolCall.id)
        ]
        out["approval_requests"] = [
            _row(a) for a in db.query(AiCfoApprovalRequest)
            .filter(AiCfoApprovalRequest.investigation_id == inv.id).order_by(AiCfoApprovalRequest.id)
        ]
    return out


@router.get("/findings/{fid}")
def get_finding(fid: int, scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    finding = _get(db, AiCfoFinding, fid, scope)
    invs = (
        db.query(AiCfoInvestigation).filter(AiCfoInvestigation.finding_id == fid)
        .order_by(AiCfoInvestigation.id.desc()).all()
    )
    return {**_row(finding), "investigations": [_investigation_out(db, i, with_steps=False) for i in invs]}


class FindingUpdateIn(BaseModel):
    status: FindingStatus
    note: str | None = Field(default=None, max_length=2000)


@router.patch("/findings/{fid}")
def update_finding(fid: int, body: FindingUpdateIn, scope: Scope = Depends(_write), db: Session = Depends(get_db)):
    finding = _get(db, AiCfoFinding, fid, scope)
    finding.status = body.status
    finding.status_note = (body.note or "").strip() or None
    _audit(db, scope, f"ai_cfo.finding.{body.status}", "ai_cfo_finding", fid, {"note": finding.status_note})
    db.commit()
    db.refresh(finding)
    return _row(finding)


# ── Investigations (agent runs) ──────────────────────────────────────────────


class InvestigationIn(BaseModel):
    finding_id: int | None = None
    question: str | None = Field(default=None, max_length=2000)


def _run_in_background(investigation_id: int) -> None:
    db = session_factory()
    try:
        inv = db.get(AiCfoInvestigation, investigation_id)
        if inv is not None and inv.status == "queued":
            ai_agent.run_investigation(db, inv)
    except Exception:  # noqa: BLE001
        logger.exception("ai-cfo background investigation %s crashed", investigation_id)
    finally:
        db.close()


@router.post("/investigations", status_code=202)
def start_investigation(
    body: InvestigationIn, background: BackgroundTasks, scope: Scope = Depends(_write), db: Session = Depends(get_db)
):
    question = (body.question or "").strip()
    finding = _get(db, AiCfoFinding, body.finding_id, scope) if body.finding_id is not None else None
    if finding is None and not question:
        raise HTTPException(status_code=422, detail="Provide a finding to investigate or a question")
    if not llm_service.is_configured():
        raise HTTPException(status_code=503, detail="The AI model is not configured on this server")
    active = (
        db.query(func.count(AiCfoInvestigation.id))
        .filter(
            AiCfoInvestigation.workspace_id == scope.workspace_id,
            AiCfoInvestigation.company_id == scope.company_id,
            AiCfoInvestigation.status.in_(("queued", "running")),
        ).scalar() or 0
    )
    if active >= MAX_ACTIVE_RUNS:
        raise HTTPException(status_code=429, detail="Investigations already running for this company; wait for them to finish")
    inv = AiCfoInvestigation(
        workspace_id=scope.workspace_id,
        company_id=scope.company_id,
        finding_id=finding.id if finding else None,
        agent="anomaly_investigator" if finding else "cfo_analyst",
        question=question or "Explain this anomaly with its drivers, impact and recommended actions.",
        status="queued",
        requested_by=scope.user_email,
    )
    db.add(inv)
    db.flush()
    _audit(db, scope, "ai_cfo.investigation.start", "ai_cfo_investigation", inv.id,
           {"agent": inv.agent, "finding_id": inv.finding_id})
    db.commit()
    db.refresh(inv)
    background.add_task(_run_in_background, inv.id)
    return _investigation_out(db, inv, with_steps=False)


@router.get("/investigations")
def list_investigations(scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    rows = (
        db.query(AiCfoInvestigation)
        .filter(AiCfoInvestigation.workspace_id == scope.workspace_id, AiCfoInvestigation.company_id == scope.company_id)
        .order_by(AiCfoInvestigation.id.desc()).limit(100).all()
    )
    return [_investigation_out(db, i, with_steps=False) for i in rows]


@router.get("/investigations/{iid}")
def get_investigation(iid: int, scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    return _investigation_out(db, _get(db, AiCfoInvestigation, iid, scope), with_steps=True)


# ── Approvals ────────────────────────────────────────────────────────────────

ApprovalStatus = Literal["pending", "approved", "rejected"]


@router.get("/approvals")
def list_approvals(
    status: ApprovalStatus | None = None, scope: Scope = Depends(_read), db: Session = Depends(get_db)
):
    q = db.query(AiCfoApprovalRequest).filter(
        AiCfoApprovalRequest.workspace_id == scope.workspace_id, AiCfoApprovalRequest.company_id == scope.company_id
    )
    if status:
        q = q.filter(AiCfoApprovalRequest.status == status)
    return [_row(a) for a in q.order_by(AiCfoApprovalRequest.id.desc()).limit(200)]


class DecisionIn(BaseModel):
    decision: Literal["approved", "rejected"]
    note: str | None = Field(default=None, max_length=2000)


@router.post("/approvals/{aid}/decision")
def decide_approval(aid: int, body: DecisionIn, scope: Scope = Depends(_manage), db: Session = Depends(get_db)):
    req = _get(db, AiCfoApprovalRequest, aid, scope)
    if req.status != "pending":
        raise HTTPException(status_code=409, detail=f"Request already {req.status}")
    req.status = body.decision
    req.decided_by = scope.user_email
    req.decision_note = (body.note or "").strip() or None
    req.decided_at = datetime.now(timezone.utc)
    _audit(db, scope, f"ai_cfo.approval.{body.decision}", "ai_cfo_approval", aid,
           {"action_type": req.action_type, "note": req.decision_note, "executed": False})
    db.commit()
    db.refresh(req)
    return {**_row(req), "executed": False}


# ── Activity and demo data ───────────────────────────────────────────────────


@router.get("/activity")
def activity(limit: int = Query(default=100, ge=1, le=500), scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    calls = (
        db.query(AiCfoToolCall, AiCfoInvestigation.agent)
        .join(AiCfoInvestigation, AiCfoToolCall.investigation_id == AiCfoInvestigation.id)
        .filter(AiCfoToolCall.workspace_id == scope.workspace_id, AiCfoToolCall.company_id == scope.company_id)
        .order_by(AiCfoToolCall.id.desc()).limit(limit).all()
    )
    return [{**_row(c), "agent": agent} for c, agent in calls]


@router.post("/demo/seed")
def seed_demo(scope: Scope = Depends(_manage), db: Session = Depends(get_db)):
    result = seed_demo_company(db, scope.workspace_id)
    _audit(db, scope, "ai_cfo.demo.seed", "uae_company_profile", result["company_id"], {"periods": result["periods"]})
    db.commit()
    return result
