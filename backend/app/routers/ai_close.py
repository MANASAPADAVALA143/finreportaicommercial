"""Month-end close command centre API — runs, agent results, deliverables, journal approvals.

Scoped to the caller's verified workspace plus a company they can access: read to view,
write to start a close, manage to decide journals and approve the close (which locks the
period). A group close is started from one company and covers other companies of the same
workspace that the caller may write to; deciding an entity's journal and approving a group
close need manage access to the entities concerned. Runs execute in the background; poll
GET /runs/{id}.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Callable, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core import company_access, secrets_box
from app.core.company_access import is_super_admin, require_company_access
from app.core.database import SessionLocal, get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.ai_close import (
    AiCloseControls, AiCloseException, AiCloseFxRate, AiCloseFxSettings, AiCloseJournalProposal, AiCloseRun, AiCloseSchedule,
    AiCloseTask,
)
from app.exceptions.period_control import PeriodControlError
from app.models.company_setup import UaeCompanyProfile
from app.models.investments import InvestmentHolding, InvestmentValuation
from app.routers.internal_audit import Scope, _manage, _read, _row, _write
from app.services.ai_cfo import ledger
from app.services.ai_cfo.ledger import LedgerScope
from app.services.ai_close import alerts, orchestrator, scheduling
from app.services.ai_close import ask as ask_service
from app.services.ai_close import controls as close_controls
from app.services.ai_close import agents as agents_module
from app.services.ai_close.agents import AGENTS
from app.services.ai_close.context import period_bounds
from app.services.ai_close.demo_group import seed_demo_group
from app.services.ai_close.journals import DecisionError, approve_close, decide, journal_detail
from app.services.ai_close.reports import FORMATS, REPORTS, ReportUnavailable, build_report, render_json, render_pdf, render_xlsx
from app.services.uae_controls_service import assert_period_open

router = APIRouter(prefix="/api/ai-close", tags=["ai-close"])

session_factory: Callable[[], Session] = SessionLocal
MAX_WORKERS = 4
MAX_ENTITIES = 20
_PERIOD = r"^\d{4}-(0[1-9]|1[0-2])$"
AgentName = Literal["bank_reconciliation", "ap_processing", "ar_intelligence", "ifrs", "fpa", "investment"]
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
        "controls": close_controls.describe(close_controls.get(db, run.workspace_id, run.company_id)),
    }


def _execute(run_id: int) -> None:
    orchestrator.execute_run(run_id, session_factory, max_workers=MAX_WORKERS)


class StartIn(BaseModel):
    period: str | None = Field(default=None, pattern=_PERIOD)
    agents: list[AgentName] | None = None
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


def _closes(db: Session, scope: Scope):
    """Close runs for the company; agent previews ('ask' runs) are not closes."""
    return db.query(AiCloseRun).filter(
        AiCloseRun.workspace_id == scope.workspace_id, AiCloseRun.company_id == scope.company_id,
        or_(AiCloseRun.trigger.is_(None), AiCloseRun.trigger != "ask"),
    )


@router.get("/runs")
def list_runs(scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    rows = _closes(db, scope).order_by(AiCloseRun.id.desc()).limit(30).all()
    return [{**_row(r), "scope": r.scope or "entity"} for r in rows]


@router.get("/runs/latest")
def latest_run(scope: Scope = Depends(_read), ctx: WorkspaceContext = Depends(validate_workspace),
               db: Session = Depends(get_db)):
    run = _closes(db, scope).order_by(AiCloseRun.id.desc()).first()
    return _run_out(db, _readable(db, ctx, run)) if run else None


class AskIn(BaseModel):
    prompt: str = Field(min_length=3, max_length=2000)
    period: str | None = Field(default=None, pattern=_PERIOD)
    scope: Literal["entity", "group"] = "entity"
    entity_ids: list[str] | None = Field(default=None, max_length=MAX_ENTITIES)


@router.post("/agents/{agent}/ask", status_code=202)
def ask_agent(agent: str, body: AskIn, background: BackgroundTasks, scope: Scope = Depends(_write),
              ctx: WorkspaceContext = Depends(validate_workspace), db: Session = Depends(get_db)):
    """Run one agent (and the agents it depends on) as a preview and answer the request from its results."""
    if agent not in ask_service.ASKABLE:
        raise HTTPException(status_code=404, detail="Unknown agent")
    if agent == "consolidation" and body.scope != "group":
        raise HTTPException(status_code=422, detail="The Consolidation Agent needs a group: choose the companies to consolidate")
    ids = _group_entities(db, ctx, scope, body.entity_ids or []) if body.scope == "group" else [scope.company_id]
    latest = max((p for p in (ledger.latest_period(db, LedgerScope(scope.workspace_id, cid)) for cid in ids) if p), default=None)
    period = body.period or ask_service.period_from_prompt(body.prompt, latest) or latest
    if not period:
        raise HTTPException(status_code=422, detail="No posted ledger data for this company; choose a period")
    active = db.query(AiCloseRun).filter(
        AiCloseRun.workspace_id == scope.workspace_id, AiCloseRun.company_id == scope.company_id,
        AiCloseRun.status.in_(("queued", "running")),
    ).first()
    if active:
        raise HTTPException(status_code=409, detail=f"Run #{active.id} is still running")
    selected, tail = ask_service.plan(agent, body.scope)
    run = orchestrator.create_run(
        db, workspace_id=scope.workspace_id, company_id=scope.company_id, period=period, agents_selected=selected,
        requested_by=scope.user_email, scope=body.scope, entities=ids, tail=tail, trigger="ask",
    )
    run.ask_json = {"agent": agent, "agent_name": AGENTS[agent][0], "prompt": body.prompt.strip()}
    db.commit()
    background.add_task(ask_service.finish, session_factory, run.id, MAX_WORKERS)
    return {**_run_out(db, run), "ask": run.ask_json}


def _readable(db: Session, ctx: WorkspaceContext, run: AiCloseRun) -> AiCloseRun:
    """A group run shows every entity's figures, so the caller must be able to read each of them."""
    for cid in orchestrator.entity_ids(run):
        if cid != run.company_id:
            require_company_access(db, ctx, cid, "read")
    return run


def _readable_companies(db: Session, ctx: WorkspaceContext, ids: set[str]) -> set[str]:
    ok = set()
    for cid in ids:
        try:
            require_company_access(db, ctx, cid, "read")
            ok.add(cid)
        except HTTPException:
            pass
    return ok


@router.get("/agents/runs/{rid}")
def get_ask(rid: int, scope: Scope = Depends(_read), ctx: WorkspaceContext = Depends(validate_workspace),
            db: Session = Depends(get_db)):
    run = _readable(db, ctx, _get(db, AiCloseRun, rid, scope))
    if run.trigger != "ask":
        raise HTTPException(status_code=404, detail="Not found")
    return {**_run_out(db, run), "ask": run.ask_json}


@router.get("/runs/{rid}")
def get_run(rid: int, scope: Scope = Depends(_read), ctx: WorkspaceContext = Depends(validate_workspace),
            db: Session = Depends(get_db)):
    return _run_out(db, _readable(db, ctx, _get(db, AiCloseRun, rid, scope)))


@router.get("/runs/{rid}/tasks/{agent}")
def get_task(rid: int, agent: str, scope: Scope = Depends(_read), ctx: WorkspaceContext = Depends(validate_workspace),
             db: Session = Depends(get_db)):
    run = _readable(db, ctx, _get(db, AiCloseRun, rid, scope))
    task = db.query(AiCloseTask).filter(AiCloseTask.run_id == run.id, AiCloseTask.agent == agent).first()
    if task is None:
        raise HTTPException(status_code=404, detail="Not found")
    return _task_out(task, full=True)


@router.get("/runs/{rid}/reports/{key}.{fmt}")
def download_report(rid: int, key: str, fmt: Literal["xlsx", "pdf", "json"], scope: Scope = Depends(_read),
                    ctx: WorkspaceContext = Depends(validate_workspace), db: Session = Depends(get_db)):
    run = _readable(db, ctx, _get(db, AiCloseRun, rid, scope))
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
    scope: Scope = Depends(_read), ctx: WorkspaceContext = Depends(validate_workspace), db: Session = Depends(get_db),
):
    q = _visible_proposals(db, scope)
    if status:
        q = q.filter(AiCloseJournalProposal.status == status)
    rows = q.order_by(AiCloseJournalProposal.id.desc()).limit(200).all()
    readable = _readable_companies(db, ctx, {p.company_id for p in rows})
    rows = [p for p in rows if p.company_id in readable]
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
        close_controls.check_journal(db, proposal, db.get(AiCloseRun, proposal.run_id), user_email=scope.user_email,
                                     role=_role(db, ctx), unrestricted=is_super_admin(ctx), decision=body.decision)
    except close_controls.ControlViolation as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    try:
        decide(db, proposal, body.decision, scope.user_email, body.note)
    except DecisionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    run = db.get(AiCloseRun, proposal.run_id)
    if run is not None:
        orchestrator.recheck_close(db, run)
    return _proposal_out(db, db.get(AiCloseJournalProposal, pid))


def _role(db: Session, ctx: WorkspaceContext) -> str | None:
    return company_access._workspace_role(db, ctx, ctx.workspace_id)


class EclRatesIn(BaseModel):
    current: float = Field(ge=0, le=1)
    d1_30: float = Field(ge=0, le=1, alias="1_30")
    d31_60: float = Field(ge=0, le=1, alias="31_60")
    d61_90: float = Field(ge=0, le=1, alias="61_90")
    d90_plus: float = Field(ge=0, le=1, alias="90_plus")

    def rates(self) -> dict[str, float]:
        return {"current": self.current, "1_30": self.d1_30, "31_60": self.d31_60, "61_90": self.d61_90, "90_plus": self.d90_plus}


class ControlsIn(BaseModel):
    require_segregation: bool = False
    manager_limit: float | None = Field(default=None, ge=0)
    ecl_rates: EclRatesIn | None = None


@router.get("/controls")
def get_controls(scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    return close_controls.describe(close_controls.get(db, scope.workspace_id, scope.company_id))


@router.put("/controls")
def put_controls(body: ControlsIn, scope: Scope = Depends(_manage), ctx: WorkspaceContext = Depends(validate_workspace),
                 db: Session = Depends(get_db)):
    if _role(db, ctx) not in close_controls.OWNER_ROLES and not is_super_admin(ctx):
        raise HTTPException(status_code=403, detail="Only an owner can change approval controls")
    row = close_controls.get(db, scope.workspace_id, scope.company_id)
    if row is None:
        row = AiCloseControls(workspace_id=scope.workspace_id, company_id=scope.company_id)
        db.add(row)
    rates = body.ecl_rates.rates() if body.ecl_rates else None
    if rates and any(b < a for a, b in zip(list(rates.values()), list(rates.values())[1:])):
        raise HTTPException(status_code=422, detail="Loss rates must not fall as receivables age")
    row.require_segregation, row.manager_limit, row.updated_by = body.require_segregation, body.manager_limit, scope.user_email
    row.ecl_rates = rates
    db.commit()
    return close_controls.describe(row)


class SeasonalityIn(BaseModel):
    revenue: list[float] | None = Field(default=None, min_length=12, max_length=12)
    expenses: list[float] | None = Field(default=None, min_length=12, max_length=12)


def _normalised(index: list[float] | None) -> list[float]:
    if not index:
        return [1.0] * 12
    if any(not 0.1 <= v <= 5 for v in index):
        raise HTTPException(status_code=422, detail="Each monthly index must be between 0.1 and 5")
    mean = sum(index) / 12
    return [round(v / mean, 4) for v in index]


def _seasonality_out(row: AiCloseControls | None) -> dict[str, Any]:
    s = (row.seasonality if row else None) or None
    return {"applied": bool(s), "months": list(agents_module.MONTHS),
            "revenue": (s or {}).get("revenue") or [1.0] * 12, "expenses": (s or {}).get("expenses") or [1.0] * 12,
            "updated_by": row.updated_by if row and s else None,
            "rule": "Index per calendar month; 1.00 is an average month. Values are rescaled to average 1, so seasonality "
                    "moves revenue and costs between months without changing the annual run rate."}


@router.get("/forecast-settings")
def get_forecast_settings(scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    return _seasonality_out(close_controls.get(db, scope.workspace_id, scope.company_id))


@router.put("/forecast-settings")
def put_forecast_settings(body: SeasonalityIn, scope: Scope = Depends(_manage), db: Session = Depends(get_db)):
    row = close_controls.get(db, scope.workspace_id, scope.company_id)
    if row is None:
        row = AiCloseControls(workspace_id=scope.workspace_id, company_id=scope.company_id)
        db.add(row)
    if body.revenue is None and body.expenses is None:
        row.seasonality = None
    else:
        row.seasonality = {"revenue": _normalised(body.revenue), "expenses": _normalised(body.expenses)}
    row.updated_by = scope.user_email
    db.commit()
    return _seasonality_out(row)


class FxRateIn(BaseModel):
    period: str = Field(pattern=_PERIOD)
    currency: str = Field(min_length=3, max_length=3)
    closing_rate: float = Field(gt=0)
    average_rate: float = Field(gt=0)
    source: str | None = Field(default=None, max_length=120)


def _reporting_currency(db: Session, scope: Scope) -> str:
    profile = db.get(UaeCompanyProfile, scope.company_id)
    return ((profile.base_currency if profile else None) or "AED").upper()


@router.get("/fx-rates")
def list_fx_rates(period: str | None = Query(default=None, pattern=_PERIOD), scope: Scope = Depends(_read),
                  db: Session = Depends(get_db)):
    q = db.query(AiCloseFxRate).filter(AiCloseFxRate.workspace_id == scope.workspace_id,
                                       AiCloseFxRate.reporting_currency == _reporting_currency(db, scope))
    if period:
        q = q.filter(AiCloseFxRate.period == period)
    return [_row(r) for r in q.order_by(AiCloseFxRate.period.desc(), AiCloseFxRate.currency).limit(200)]


def _fx_maintainers(db: Session, workspace_id: str) -> list[str]:
    row = db.query(AiCloseFxSettings).filter(AiCloseFxSettings.workspace_id == workspace_id).first()
    return list(row.maintainers or []) if row else []


def _may_edit_fx(db: Session, ctx: WorkspaceContext, scope: Scope) -> bool:
    if is_super_admin(ctx) or _role(db, ctx) in close_controls.OWNER_ROLES:
        return True
    email = (scope.user_email or "").strip().lower()
    return bool(email) and email in _fx_maintainers(db, scope.workspace_id)


@router.get("/fx-rates/settings")
def get_fx_settings(scope: Scope = Depends(_read), ctx: WorkspaceContext = Depends(validate_workspace),
                    db: Session = Depends(get_db)):
    return {"maintainers": _fx_maintainers(db, scope.workspace_id), "can_edit": _may_edit_fx(db, ctx, scope),
            "is_owner": is_super_admin(ctx) or _role(db, ctx) in close_controls.OWNER_ROLES,
            "rule": "Owners and the designated treasury / finance administrators may maintain exchange rates. "
                    "Rates for a closed or locked month cannot be changed."}


class FxSettingsIn(BaseModel):
    maintainers: list[str] = Field(default_factory=list, max_length=20)


@router.put("/fx-rates/settings")
def put_fx_settings(body: FxSettingsIn, scope: Scope = Depends(_manage), ctx: WorkspaceContext = Depends(validate_workspace),
                    db: Session = Depends(get_db)):
    if _role(db, ctx) not in close_controls.OWNER_ROLES and not is_super_admin(ctx):
        raise HTTPException(status_code=403, detail="Only an owner can designate who maintains exchange rates")
    emails = list(dict.fromkeys(e.strip().lower() for e in body.maintainers if e.strip()))
    if any(not alerts.EMAIL_RE.match(e) for e in emails):
        raise HTTPException(status_code=422, detail="Enter valid email addresses")
    row = db.query(AiCloseFxSettings).filter(AiCloseFxSettings.workspace_id == scope.workspace_id).first()
    if row is None:
        row = AiCloseFxSettings(workspace_id=scope.workspace_id)
        db.add(row)
    row.maintainers, row.updated_by = emails, scope.user_email
    db.commit()
    return get_fx_settings(scope, ctx, db)


@router.put("/fx-rates")
def put_fx_rate(body: FxRateIn, scope: Scope = Depends(_manage), ctx: WorkspaceContext = Depends(validate_workspace),
                db: Session = Depends(get_db)):
    if not _may_edit_fx(db, ctx, scope):
        raise HTTPException(status_code=403, detail="Exchange rates are maintained by an owner or a designated treasury administrator")
    reporting, currency = _reporting_currency(db, scope), body.currency.upper()
    if currency == reporting:
        raise HTTPException(status_code=422, detail="The currency is already the reporting currency")
    try:
        assert_period_open(entry_date=period_bounds(body.period)[1], workspace_id=scope.workspace_id,
                           company_id=scope.company_id, source="fx_rate", db=db)
    except PeriodControlError as exc:
        raise HTTPException(status_code=409, detail=f"{body.period} is closed for this company; its exchange rates are locked") from exc
    row = db.query(AiCloseFxRate).filter(
        AiCloseFxRate.workspace_id == scope.workspace_id, AiCloseFxRate.period == body.period,
        AiCloseFxRate.currency == currency, AiCloseFxRate.reporting_currency == reporting).first()
    if row is None:
        row = AiCloseFxRate(workspace_id=scope.workspace_id, period=body.period, currency=currency, reporting_currency=reporting)
        db.add(row)
    elif (row.closing_rate, row.average_rate, row.source) != (body.closing_rate, body.average_rate, body.source):
        row.history = [*(row.history or []), {"closing_rate": row.closing_rate, "average_rate": row.average_rate,
                                              "source": row.source, "by": row.updated_by, "replaced_by": scope.user_email,
                                              "at": datetime.now(timezone.utc).isoformat()}][-20:]
    row.closing_rate, row.average_rate, row.source, row.updated_by = body.closing_rate, body.average_rate, body.source, scope.user_email
    db.commit()
    return _row(row)


class NotifyIn(BaseModel):
    emails: list[str] | None = Field(default=None, max_length=alerts.MAX_RECIPIENTS)


@router.post("/runs/{rid}/notify")
def notify_run(rid: int, body: NotifyIn, scope: Scope = Depends(_write), ctx: WorkspaceContext = Depends(validate_workspace),
               db: Session = Depends(get_db)):
    """Send the close summary now: in-app, plus email/Slack to the given addresses or the schedule's recipients."""
    run = _readable(db, ctx, _get(db, AiCloseRun, rid, scope))
    if run.trigger == "ask":
        raise HTTPException(status_code=409, detail="Agent previews are not sent as close summaries")
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
    deliveries = alerts.send_close_summary(db, run, emails=emails, slack_webhook=schedule.slack_webhook_url if schedule else None,
                                           slack_encrypted=True)
    return {"deliveries": deliveries}


class ScheduleIn(BaseModel):
    enabled: bool = True
    scope: Literal["entity", "group"] = "entity"
    entity_ids: list[str] | None = Field(default=None, max_length=MAX_ENTITIES)
    agents: list[AgentName] = Field(min_length=1)
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
        schedule.slack_webhook_url = secrets_box.encrypt(slack) if slack else None
    elif schedule.slack_webhook_url and not schedule.slack_webhook_url.startswith(secrets_box.PREFIX):
        schedule.slack_webhook_url = secrets_box.encrypt(schedule.slack_webhook_url)
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


class HoldingIn(BaseModel):
    code: str = Field(min_length=1, max_length=60)
    name: str = Field(min_length=1, max_length=200)
    asset_class: Literal["equity", "bond", "sukuk", "fund", "deposit", "other"]
    ifrs9_category: Literal["fvtpl", "fvoci", "amortised_cost"] = "fvtpl"
    issuer: str | None = Field(default=None, max_length=200)
    sector: str | None = Field(default=None, max_length=100)
    country: str | None = Field(default=None, max_length=60)
    currency: str = Field(default="AED", min_length=3, max_length=3)
    quantity: float | None = None
    cost: float = Field(ge=0)
    acquired_on: date | None = None
    maturity_date: date | None = None
    coupon_rate: float | None = None


class ValuationIn(BaseModel):
    code: str = Field(min_length=1, max_length=60)
    as_of: date
    market_value: float
    local_value: float | None = None
    price: float | None = None
    income: float | None = None


class PortfolioImportIn(BaseModel):
    holdings: list[HoldingIn] = Field(default_factory=list, max_length=2000)
    valuations: list[ValuationIn] = Field(default_factory=list, max_length=20000)


def _holdings(db: Session, scope: Scope):
    return db.query(InvestmentHolding).filter(
        InvestmentHolding.workspace_id == scope.workspace_id, InvestmentHolding.company_id == scope.company_id)


@router.get("/investments")
def list_investments(scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    rows = _holdings(db, scope).order_by(InvestmentHolding.code).all()
    latest = {}
    for v in db.query(InvestmentValuation).filter(InvestmentValuation.holding_id.in_([h.id for h in rows])).order_by(InvestmentValuation.as_of):
        latest[v.holding_id] = v
    return [{**_row(h), "latest_value": latest[h.id].market_value if h.id in latest else None,
             "latest_as_of": str(latest[h.id].as_of) if h.id in latest else None} for h in rows]


@router.post("/investments/import")
def import_investments(body: PortfolioImportIn, scope: Scope = Depends(_write), db: Session = Depends(get_db)):
    """Upsert holdings by code and valuations by (code, as_of) for this company."""
    by_code = {h.code: h for h in _holdings(db, scope)}
    created = updated = 0
    for row in body.holdings:
        data = row.model_dump()
        data["currency"] = data["currency"].upper()
        holding = by_code.get(row.code)
        if holding is None:
            holding = InvestmentHolding(workspace_id=scope.workspace_id, company_id=scope.company_id, **data)
            db.add(holding)
            by_code[row.code] = holding
            created += 1
        else:
            for k, v in data.items():
                setattr(holding, k, v)
            updated += 1
    db.flush()
    errors, values = [], 0
    for i, row in enumerate(body.valuations):
        holding = by_code.get(row.code)
        if holding is None:
            errors.append(f"Valuation row {i + 1}: unknown holding code {row.code}")
            continue
        existing = db.query(InvestmentValuation).filter(
            InvestmentValuation.holding_id == holding.id, InvestmentValuation.as_of == row.as_of).first()
        fields = row.model_dump(exclude={"code", "as_of"})
        if existing is None:
            db.add(InvestmentValuation(holding_id=holding.id, as_of=row.as_of, source="import", **fields))
        else:
            for k, v in fields.items():
                setattr(existing, k, v)
        values += 1
    db.commit()
    return {"holdings_created": created, "holdings_updated": updated, "valuations_saved": values, "errors": errors[:50]}


@router.delete("/investments/{hid}", status_code=204)
def delete_investment(hid: int, scope: Scope = Depends(_manage), db: Session = Depends(get_db)):
    holding = _holdings(db, scope).filter(InvestmentHolding.id == hid).first()
    if holding is None:
        raise HTTPException(status_code=404, detail="Not found")
    db.query(InvestmentValuation).filter(InvestmentValuation.holding_id == holding.id).delete(synchronize_session=False)
    db.delete(holding)
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
    if run.trigger == "ask":
        raise HTTPException(status_code=409, detail="An agent preview cannot close the period; run the month-end close")
    for cid in orchestrator.entity_ids(run):
        if cid != scope.company_id:
            require_company_access(db, ctx, cid, "manage")
    try:
        close_controls.check_close(db, run, user_email=scope.user_email, unrestricted=is_super_admin(ctx))
    except close_controls.ControlViolation as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
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
