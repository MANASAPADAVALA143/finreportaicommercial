"""Month-end close command centre API — runs, agent results, deliverables, journal approvals.

Scoped to the caller's verified workspace plus a company they can access: read to view,
write to start a close, manage to decide journals and approve the close (which locks the
period). A group close is started from one company and covers other companies of the same
workspace that the caller may write to; deciding an entity's journal and approving a group
close need manage access to the entities concerned. Runs execute in the background; poll
GET /runs/{id}.
"""
from __future__ import annotations

from typing import Any, Callable, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.company_access import require_company_access
from app.core.database import SessionLocal, get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.ai_close import AiCloseException, AiCloseJournalProposal, AiCloseRun, AiCloseSchedule, AiCloseTask
from app.models.company_setup import UaeCompanyProfile
from app.routers.internal_audit import Scope, _manage, _read, _row, _write
from app.services.ai_cfo import ledger
from app.services.ai_cfo.ledger import LedgerScope
from app.services.ai_close import alerts, orchestrator, scheduling
from app.services.ai_close.agents import AGENTS
from app.services.ai_close.demo_group import seed_demo_group
from app.services.ai_close.journals import DecisionError, approve_close, decide, journal_detail
from app.services.ai_close.reports import FORMATS, REPORTS, ReportUnavailable, build_report, render_json, render_pdf, render_xlsx

router = APIRouter(prefix="/api/ai-close", tags=["ai-close"])

session_factory: Callable[[], Session] = SessionLocal
MAX_WORKERS = 4
MAX_ENTITIES = 20
_PERIOD = r"^\d{4}-(0[1-9]|1[0-2])$"
_SEVERITY = {"high": 0, "medium": 1, "low": 2}


def _get(db: Session, model: Any, obj_id: int, scope: Scope) -> Any:
    obj = db.query(model).filter(
        model.id == obj_id, model.workspace_id == scope.workspace_id, model.company_id == scope.company_id
    ).first()
    if obj is None:
        raise HTTPException(status_code=404, detail="Not found")
    return obj


def _names(db: Session, ids: list[str]) -> dict[str, str]:
    return {p.id: p.company_name for p in db.query(UaeCompanyProfile).filter(UaeCompanyProfile.id.in_(ids))}


def _task_out(t: AiCloseTask, *, full: bool) -> dict[str, Any]:
    out = _row(t)
    out["agent_name"] = AGENTS.get(t.agent, (t.agent,))[0]
    if not full:
        out.pop("output_json", None)
    return out


def _proposal_out(db: Session, p: AiCloseJournalProposal, names: dict[str, str] | None = None) -> dict[str, Any]:
    names = names if names is not None else _names(db, [p.company_id])
    return {**_row(p), "agent_name": AGENTS.get(p.agent, (p.agent,))[0], "entity_name": names.get(p.company_id),
            **journal_detail(db, p)}


def _run_out(db: Session, run: AiCloseRun) -> dict[str, Any]:
    ids = orchestrator.entity_ids(run)
    names = _names(db, ids)
    tasks = db.query(AiCloseTask).filter(AiCloseTask.run_id == run.id).order_by(AiCloseTask.wave, AiCloseTask.id).all()
    exceptions = db.query(AiCloseException).filter(AiCloseException.run_id == run.id).all()
    exceptions.sort(key=lambda e: (e.status != "open", _SEVERITY.get(e.severity, 9), e.id))
    proposals = db.query(AiCloseJournalProposal).filter(AiCloseJournalProposal.run_id == run.id).order_by(AiCloseJournalProposal.id).all()
    by_agent = {t.agent: t for t in tasks}
    close = by_agent.get("close_manager")
    cfo = by_agent.get("cfo_intelligence")
    deliverables = []
    for key, (title, agent) in REPORTS.items():
        task = by_agent.get(agent)
        ready = task is not None and task.status in ("completed", "completed_with_exceptions")
        deliverables.append({
            "key": key, "title": title, "agent": agent, "agent_name": AGENTS[agent][0], "formats": list(FORMATS[key]),
            "status": "ready" if ready else ("not_run" if task is None else task.status),
            "executed_at": task.finished_at.isoformat() if task and task.finished_at else None,
        })
    return {
        **_row(run),
        "scope": run.scope or "entity",
        "entities": [{"id": i, "name": names.get(i, i)} for i in ids],
        "kpis": orchestrator.compute_kpis(db, run),
        "tasks": [_task_out(t, full=False) for t in tasks],
        "checklist": (close.output_json if close and close.output_json else None),
        "cfo_summary": (cfo.output_json if cfo and cfo.status in ("completed", "completed_with_exceptions") else None),
        "exceptions": [{**_row(e), "entity_name": names.get(e.entity_id or "")} for e in exceptions[:300]],
        "exceptions_total": len(exceptions),
        "exceptions_open": sum(1 for e in exceptions if e.status == "open"),
        "proposals": [_proposal_out(db, p, names) for p in proposals],
        "deliverables": deliverables,
    }


def _execute(run_id: int) -> None:
    orchestrator.execute_run(run_id, session_factory, max_workers=MAX_WORKERS)


class StartIn(BaseModel):
    period: str | None = Field(default=None, pattern=_PERIOD)
    agents: list[Literal["bank_reconciliation", "ap_processing", "ar_intelligence", "ifrs", "fpa"]] | None = None
    scope: Literal["entity", "group"] = "entity"
    entity_ids: list[str] | None = Field(default=None, max_length=MAX_ENTITIES)


def _group_entities(db: Session, ctx: WorkspaceContext, scope: Scope, requested: list[str]) -> list[str]:
    ids = list(dict.fromkeys([scope.company_id, *[i.strip() for i in requested if i and i.strip()]]))
    if len(ids) < 2:
        raise HTTPException(status_code=422, detail="A group close needs at least two companies")
    profiles = {p.id: p for p in db.query(UaeCompanyProfile).filter(UaeCompanyProfile.id.in_(ids))}
    for cid in ids:
        profile = profiles.get(cid)
        if profile is None or str(profile.workspace_id) != scope.workspace_id:
            raise HTTPException(status_code=422, detail="Every group company must belong to this workspace")
        require_company_access(db, ctx, cid, "write")
    return ids


@router.post("/runs", status_code=202)
def start_close(body: StartIn, background: BackgroundTasks, scope: Scope = Depends(_write),
                ctx: WorkspaceContext = Depends(validate_workspace), db: Session = Depends(get_db)):
    ids = _group_entities(db, ctx, scope, body.entity_ids or []) if body.scope == "group" else [scope.company_id]
    period = body.period
    if not period:
        latest = [p for p in (ledger.latest_period(db, LedgerScope(scope.workspace_id, cid)) for cid in ids) if p]
        period = max(latest) if latest else None
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
        scope=body.scope, entities=ids,
    )
    background.add_task(_execute, run.id)
    return _run_out(db, run)


@router.get("/runs")
def list_runs(scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    rows = db.query(AiCloseRun).filter(
        AiCloseRun.workspace_id == scope.workspace_id, AiCloseRun.company_id == scope.company_id
    ).order_by(AiCloseRun.id.desc()).limit(30).all()
    return [{**_row(r), "scope": r.scope or "entity"} for r in rows]


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
def download_report(rid: int, key: str, fmt: Literal["xlsx", "pdf", "json"], scope: Scope = Depends(_read),
                    db: Session = Depends(get_db)):
    run = _get(db, AiCloseRun, rid, scope)
    if key in FORMATS and fmt != "json" and fmt not in FORMATS[key]:
        raise HTTPException(status_code=404, detail=f"{REPORTS[key][0]} is available as {', '.join(FORMATS[key]).upper()}")
    try:
        spec = build_report(db, run, key)
    except ReportUnavailable as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if fmt == "json":
        return render_json(spec)
    if fmt == "xlsx":
        content, media = render_xlsx(spec), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        content, media = render_pdf(spec), "application/pdf"
    return Response(content=content, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="{key}-{run.period}-run{run.id}.{fmt}"'})


def _visible_proposals(db: Session, scope: Scope):
    """Proposals in this company, plus those of group runs started from it."""
    run_ids = db.query(AiCloseRun.id).filter(AiCloseRun.workspace_id == scope.workspace_id,
                                            AiCloseRun.company_id == scope.company_id)
    return db.query(AiCloseJournalProposal).filter(
        AiCloseJournalProposal.workspace_id == scope.workspace_id,
        (AiCloseJournalProposal.company_id == scope.company_id) | AiCloseJournalProposal.run_id.in_(run_ids),
    )


@router.get("/journals")
def list_journals(
    status: Literal["pending_approval", "approved", "rejected", "changes_requested"] | None = Query(default=None),
    scope: Scope = Depends(_read), db: Session = Depends(get_db),
):
    q = _visible_proposals(db, scope)
    if status:
        q = q.filter(AiCloseJournalProposal.status == status)
    rows = q.order_by(AiCloseJournalProposal.id.desc()).limit(200).all()
    names = _names(db, list({p.company_id for p in rows}))
    return [_proposal_out(db, p, names) for p in rows]


class DecisionIn(BaseModel):
    decision: Literal["approved", "rejected", "changes_requested"]
    note: str | None = Field(default=None, max_length=2000)


@router.post("/journals/{pid}/decision")
def decide_journal(pid: int, body: DecisionIn, scope: Scope = Depends(_manage),
                   ctx: WorkspaceContext = Depends(validate_workspace), db: Session = Depends(get_db)):
    proposal = _visible_proposals(db, scope).filter(AiCloseJournalProposal.id == pid).first()
    if proposal is None:
        raise HTTPException(status_code=404, detail="Not found")
    if proposal.company_id != scope.company_id:
        require_company_access(db, ctx, proposal.company_id, "manage")
    try:
        decide(db, proposal, body.decision, scope.user_email, body.note)
    except DecisionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    run = db.get(AiCloseRun, proposal.run_id)
    if run is not None:
        orchestrator.recheck_close(db, run)
    return _proposal_out(db, db.get(AiCloseJournalProposal, pid))


class NotifyIn(BaseModel):
    emails: list[str] | None = Field(default=None, max_length=alerts.MAX_RECIPIENTS)


@router.post("/runs/{rid}/notify")
def notify_run(rid: int, body: NotifyIn, scope: Scope = Depends(_write), db: Session = Depends(get_db)):
    """Send the close summary now: in-app, plus email/Slack to the given addresses or the schedule's recipients."""
    run = _get(db, AiCloseRun, rid, scope)
    if run.status in ("queued", "running"):
        raise HTTPException(status_code=409, detail="The close is still running")
    schedule = db.query(AiCloseSchedule).filter(
        AiCloseSchedule.workspace_id == scope.workspace_id, AiCloseSchedule.company_id == scope.company_id).first()
    try:
        emails = alerts.clean_emails(body.emails) if body.emails else list((schedule.notify_emails if schedule else None) or [])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not emails and scope.user_email:
        emails = [scope.user_email]
    deliveries = alerts.send_close_summary(db, run, emails=emails, slack_webhook=schedule.slack_webhook_url if schedule else None)
    return {"deliveries": deliveries}


class ScheduleIn(BaseModel):
    enabled: bool = True
    scope: Literal["entity", "group"] = "entity"
    entity_ids: list[str] | None = Field(default=None, max_length=MAX_ENTITIES)
    agents: list[Literal["bank_reconciliation", "ap_processing", "ar_intelligence", "ifrs", "fpa"]] = Field(min_length=1)
    run_day: int = Field(ge=1, le=28)
    run_hour: int = Field(ge=0, le=23)
    timezone: str = Field(default="Asia/Dubai", max_length=64)
    notify_emails: list[str] = Field(default_factory=list, max_length=alerts.MAX_RECIPIENTS)
    slack_webhook_url: str | None = Field(default=None, max_length=500)
    notify_when: Literal["always", "issues", "never"] = "always"


def _schedule(db: Session, scope: Scope) -> AiCloseSchedule | None:
    return db.query(AiCloseSchedule).filter(
        AiCloseSchedule.workspace_id == scope.workspace_id, AiCloseSchedule.company_id == scope.company_id).first()


@router.get("/schedule")
def get_schedule(scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    schedule = _schedule(db, scope)
    return scheduling.describe(schedule) if schedule else None


@router.put("/schedule")
def put_schedule(body: ScheduleIn, scope: Scope = Depends(_manage), ctx: WorkspaceContext = Depends(validate_workspace),
                 db: Session = Depends(get_db)):
    try:
        ZoneInfo(body.timezone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Unknown time zone") from exc
    try:
        emails = alerts.clean_emails(body.notify_emails)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    slack = (body.slack_webhook_url or "").strip()
    if slack and not alerts.valid_slack_url(slack):
        raise HTTPException(status_code=422, detail="Slack webhook must be an incoming-webhook URL (https://hooks.slack.com/services/…)")
    ids = _group_entities(db, ctx, scope, body.entity_ids or []) if body.scope == "group" else [scope.company_id]
    schedule = _schedule(db, scope)
    if schedule is None:
        schedule = AiCloseSchedule(workspace_id=scope.workspace_id, company_id=scope.company_id, created_by=scope.user_email,
                                   agents=list(body.agents))
        db.add(schedule)
    schedule.enabled, schedule.scope, schedule.entity_ids = body.enabled, body.scope, ids
    schedule.agents = [a for a in orchestrator.SELECTABLE if a in body.agents]
    schedule.run_day, schedule.run_hour, schedule.timezone = body.run_day, body.run_hour, body.timezone
    schedule.notify_emails, schedule.notify_when, schedule.updated_by = emails, body.notify_when, scope.user_email
    if body.slack_webhook_url is not None:
        schedule.slack_webhook_url = slack or None
    db.commit()
    db.refresh(schedule)
    return scheduling.describe(schedule)


@router.delete("/schedule", status_code=204)
def delete_schedule(scope: Scope = Depends(_manage), db: Session = Depends(get_db)):
    schedule = _schedule(db, scope)
    if schedule is not None:
        db.delete(schedule)
        db.commit()
    return Response(status_code=204)


@router.post("/demo/seed")
def seed_demo(scope: Scope = Depends(_write), db: Session = Depends(get_db)):
    """Create or rebuild the labelled synthetic demo group in this workspace; real companies are untouched."""
    return seed_demo_group(db, scope.workspace_id)


class CloseApprovalIn(BaseModel):
    note: str | None = Field(default=None, max_length=2000)


@router.post("/runs/{rid}/approve-close")
def approve_run_close(rid: int, body: CloseApprovalIn, scope: Scope = Depends(_manage),
                      ctx: WorkspaceContext = Depends(validate_workspace), db: Session = Depends(get_db)):
    run = _get(db, AiCloseRun, rid, scope)
    for cid in orchestrator.entity_ids(run):
        if cid != scope.company_id:
            require_company_access(db, ctx, cid, "manage")
    orchestrator.recheck_close(db, run)
    close = db.query(AiCloseTask).filter(AiCloseTask.run_id == run.id, AiCloseTask.agent == "close_manager").first()
    items = (close.output_json or {}).get("items", []) if close else []
    open_items = sum(1 for i in items if i["status"] not in ("done", "n/a") and i["key"] != "prior_period_closed")
    try:
        periods = approve_close(db, run, user_email=scope.user_email, user_id=scope.user_id,
                                note=body.note, open_items=open_items)
    except DecisionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    orchestrator.recheck_close(db, run)
    return {**_run_out(db, run), "locked_period": _row(periods[0]), "locked_periods": [_row(p) for p in periods]}
