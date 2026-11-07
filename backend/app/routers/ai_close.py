"""Month-end close command centre API — runs, agent results, deliverables, journal approvals.

Scoped to the caller's verified workspace plus a company they can access: read to view,
write to start a close, manage to decide journals and approve the close (which locks the
period). Runs execute in the background; poll GET /runs/{id}.
"""
from __future__ import annotations

from typing import Any, Callable, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.models.ai_close import AiCloseException, AiCloseJournalProposal, AiCloseRun, AiCloseTask
from app.routers.internal_audit import Scope, _manage, _read, _row, _write
from app.services.ai_cfo import ledger
from app.services.ai_cfo.ledger import LedgerScope
from app.services.ai_close import orchestrator
from app.services.ai_close.agents import AGENTS
from app.services.ai_close.journals import DecisionError, approve_close, decide, journal_detail
from app.services.ai_close.reports import REPORTS, ReportUnavailable, build_report, render_pdf, render_xlsx

router = APIRouter(prefix="/api/ai-close", tags=["ai-close"])

session_factory: Callable[[], Session] = SessionLocal
MAX_WORKERS = 4
_PERIOD = r"^\d{4}-(0[1-9]|1[0-2])$"
_SEVERITY = {"high": 0, "medium": 1, "low": 2}


def _get(db: Session, model: Any, obj_id: int, scope: Scope) -> Any:
    obj = db.query(model).filter(
        model.id == obj_id, model.workspace_id == scope.workspace_id, model.company_id == scope.company_id
    ).first()
    if obj is None:
        raise HTTPException(status_code=404, detail="Not found")
    return obj


def _task_out(t: AiCloseTask, *, full: bool) -> dict[str, Any]:
    out = _row(t)
    out["agent_name"] = AGENTS.get(t.agent, (t.agent,))[0]
    if not full:
        out.pop("output_json", None)
    return out


def _proposal_out(db: Session, p: AiCloseJournalProposal) -> dict[str, Any]:
    return {**_row(p), "agent_name": AGENTS.get(p.agent, (p.agent,))[0], **journal_detail(db, p)}


def _run_out(db: Session, run: AiCloseRun) -> dict[str, Any]:
    tasks = db.query(AiCloseTask).filter(AiCloseTask.run_id == run.id).order_by(AiCloseTask.wave, AiCloseTask.id).all()
    exceptions = db.query(AiCloseException).filter(AiCloseException.run_id == run.id).all()
    exceptions.sort(key=lambda e: (_SEVERITY.get(e.severity, 9), e.id))
    proposals = db.query(AiCloseJournalProposal).filter(AiCloseJournalProposal.run_id == run.id).order_by(AiCloseJournalProposal.id).all()
    by_agent = {t.agent: t for t in tasks}
    close = by_agent.get("close_manager")
    deliverables = []
    for key, (title, agent) in REPORTS.items():
        task = by_agent.get(agent)
        ready = task is not None and task.status in ("completed", "completed_with_exceptions")
        deliverables.append({
            "key": key, "title": title, "agent": agent, "agent_name": AGENTS[agent][0],
            "status": "ready" if ready else ("not_run" if task is None else task.status),
            "executed_at": task.finished_at.isoformat() if task and task.finished_at else None,
        })
    return {
        **_row(run),
        "kpis": orchestrator.compute_kpis(db, run),
        "tasks": [_task_out(t, full=False) for t in tasks],
        "checklist": (close.output_json if close and close.output_json else None),
        "exceptions": [_row(e) for e in exceptions[:300]],
        "exceptions_total": len(exceptions),
        "exceptions_open": sum(1 for e in exceptions if e.status == "open"),
        "proposals": [_proposal_out(db, p) for p in proposals],
        "deliverables": deliverables,
    }


def _execute(run_id: int) -> None:
    orchestrator.execute_run(run_id, session_factory, max_workers=MAX_WORKERS)


class StartIn(BaseModel):
    period: str | None = Field(default=None, pattern=_PERIOD)
    agents: list[Literal["bank_reconciliation", "ar_intelligence", "fpa"]] | None = None


@router.post("/runs", status_code=202)
def start_close(body: StartIn, background: BackgroundTasks, scope: Scope = Depends(_write), db: Session = Depends(get_db)):
    period = body.period or ledger.latest_period(db, LedgerScope(scope.workspace_id, scope.company_id))
    if not period:
        raise HTTPException(status_code=422, detail="No posted ledger data for this company; choose a period")
    active = db.query(AiCloseRun).filter(
        AiCloseRun.workspace_id == scope.workspace_id, AiCloseRun.company_id == scope.company_id,
        AiCloseRun.status.in_(("queued", "running")),
    ).first()
    if active:
        raise HTTPException(status_code=409, detail=f"Close run #{active.id} is still running")
    run = orchestrator.create_run(
        db, workspace_id=scope.workspace_id, company_id=scope.company_id, period=period,
        agents_selected=list(body.agents or orchestrator.SELECTABLE), requested_by=scope.user_email,
    )
    background.add_task(_execute, run.id)
    return _run_out(db, run)


@router.get("/runs")
def list_runs(scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    rows = db.query(AiCloseRun).filter(
        AiCloseRun.workspace_id == scope.workspace_id, AiCloseRun.company_id == scope.company_id
    ).order_by(AiCloseRun.id.desc()).limit(30).all()
    return [_row(r) for r in rows]


@router.get("/runs/latest")
def latest_run(scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    run = db.query(AiCloseRun).filter(
        AiCloseRun.workspace_id == scope.workspace_id, AiCloseRun.company_id == scope.company_id
    ).order_by(AiCloseRun.id.desc()).first()
    return _run_out(db, run) if run else None


@router.get("/runs/{rid}")
def get_run(rid: int, scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    return _run_out(db, _get(db, AiCloseRun, rid, scope))


@router.get("/runs/{rid}/tasks/{agent}")
def get_task(rid: int, agent: str, scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    run = _get(db, AiCloseRun, rid, scope)
    task = db.query(AiCloseTask).filter(AiCloseTask.run_id == run.id, AiCloseTask.agent == agent).first()
    if task is None:
        raise HTTPException(status_code=404, detail="Not found")
    return _task_out(task, full=True)


@router.get("/runs/{rid}/reports/{key}.{fmt}")
def download_report(rid: int, key: str, fmt: Literal["xlsx", "pdf"], scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    run = _get(db, AiCloseRun, rid, scope)
    try:
        spec = build_report(db, run, key)
    except ReportUnavailable as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if fmt == "xlsx":
        content, media = render_xlsx(spec), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        content, media = render_pdf(spec), "application/pdf"
    return Response(content=content, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="{key}-{run.period}-run{run.id}.{fmt}"'})


@router.get("/journals")
def list_journals(
    status: Literal["pending_approval", "approved", "rejected", "changes_requested"] | None = Query(default=None),
    scope: Scope = Depends(_read), db: Session = Depends(get_db),
):
    q = db.query(AiCloseJournalProposal).filter(
        AiCloseJournalProposal.workspace_id == scope.workspace_id, AiCloseJournalProposal.company_id == scope.company_id
    )
    if status:
        q = q.filter(AiCloseJournalProposal.status == status)
    return [_proposal_out(db, p) for p in q.order_by(AiCloseJournalProposal.id.desc()).limit(200)]


class DecisionIn(BaseModel):
    decision: Literal["approved", "rejected", "changes_requested"]
    note: str | None = Field(default=None, max_length=2000)


@router.post("/journals/{pid}/decision")
def decide_journal(pid: int, body: DecisionIn, scope: Scope = Depends(_manage), db: Session = Depends(get_db)):
    proposal = _get(db, AiCloseJournalProposal, pid, scope)
    try:
        decide(db, proposal, body.decision, scope.user_email, body.note)
    except DecisionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    run = db.get(AiCloseRun, proposal.run_id)
    if run is not None:
        orchestrator.recheck_close(db, run)
    return _proposal_out(db, db.get(AiCloseJournalProposal, pid))


class CloseApprovalIn(BaseModel):
    note: str | None = Field(default=None, max_length=2000)


@router.post("/runs/{rid}/approve-close")
def approve_run_close(rid: int, body: CloseApprovalIn, scope: Scope = Depends(_manage), db: Session = Depends(get_db)):
    run = _get(db, AiCloseRun, rid, scope)
    orchestrator.recheck_close(db, run)
    close = db.query(AiCloseTask).filter(AiCloseTask.run_id == run.id, AiCloseTask.agent == "close_manager").first()
    items = (close.output_json or {}).get("items", []) if close else []
    open_items = sum(1 for i in items if i["status"] != "done" and i["key"] != "prior_period_closed")
    try:
        period = approve_close(db, run, user_email=scope.user_email, user_id=scope.user_id,
                               note=body.note, open_items=open_items)
    except DecisionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    orchestrator.recheck_close(db, run)
    return {**_run_out(db, run), "locked_period": _row(period)}
