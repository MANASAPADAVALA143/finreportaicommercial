"""Scheduled month-end closes.

A schedule is due once its local day/hour has passed in the current month and the previous
month has not been run for it yet. Each month is claimed with a single conditional UPDATE, so
when several app instances check at the same time only one of them runs the close. A run that
fails after the claim is not retried automatically; the error is kept on the schedule and the
close can be run by hand.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Callable
from zoneinfo import ZoneInfo

from sqlalchemy import or_, update
from sqlalchemy.orm import Session

from app.models.ai_close import AiCloseRun, AiCloseSchedule
from app.models.company_setup import UaeCompanyProfile
from app.services.ai_cfo.ledger import period_add
from app.services.ai_close import alerts, orchestrator

logger = logging.getLogger(__name__)

SCHEDULED_BY = "Scheduled close"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def target_period(local: datetime) -> str:
    return period_add(f"{local.year:04d}-{local.month:02d}", -1)


def due_period(schedule: AiCloseSchedule, now: datetime | None = None) -> str | None:
    local = (now or _now()).astimezone(ZoneInfo(schedule.timezone))
    if (local.day, local.hour) < (schedule.run_day, schedule.run_hour):
        return None
    period = target_period(local)
    return None if schedule.last_run_period == period else period


def next_run_at(schedule: AiCloseSchedule, now: datetime | None = None) -> datetime | None:
    if not schedule.enabled:
        return None
    tz = ZoneInfo(schedule.timezone)
    local = (now or _now()).astimezone(tz)
    if due_period(schedule, now):
        return local.astimezone(timezone.utc)
    year, month = local.year, local.month
    candidate = datetime(year, month, schedule.run_day, schedule.run_hour, tzinfo=tz)
    if candidate <= local or schedule.last_run_period == target_period(local):
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
        candidate = datetime(year, month, schedule.run_day, schedule.run_hour, tzinfo=tz)
    return candidate.astimezone(timezone.utc)


def claim(db: Session, schedule_id: int, period: str) -> bool:
    res = db.execute(
        update(AiCloseSchedule)
        .where(AiCloseSchedule.id == schedule_id, AiCloseSchedule.enabled.is_(True),
               or_(AiCloseSchedule.last_run_period.is_(None), AiCloseSchedule.last_run_period != period))
        .values(last_run_period=period, last_run_at=_now(), last_error=None)
    )
    db.commit()
    return res.rowcount == 1


def _start(db: Session, schedule: AiCloseSchedule, period: str) -> AiCloseRun:
    ids = [schedule.company_id] + [i for i in (schedule.entity_ids or []) if i != schedule.company_id]
    present = {p.id for p in db.query(UaeCompanyProfile).filter(
        UaeCompanyProfile.id.in_(ids), UaeCompanyProfile.workspace_id == schedule.workspace_id)}
    if schedule.company_id not in present:
        raise ValueError("The scheduled company no longer exists in this workspace")
    ids = [i for i in ids if i in present]
    scope = schedule.scope if schedule.scope == "group" and len(ids) > 1 else "entity"
    active = db.query(AiCloseRun).filter(
        AiCloseRun.workspace_id == schedule.workspace_id, AiCloseRun.company_id == schedule.company_id,
        AiCloseRun.status.in_(("queued", "running"))).first()
    if active:
        raise ValueError(f"Close run #{active.id} was still running")
    run = orchestrator.create_run(
        db, workspace_id=schedule.workspace_id, company_id=schedule.company_id, period=period,
        agents_selected=list(schedule.agents or orchestrator.SELECTABLE), requested_by=SCHEDULED_BY,
        scope=scope, entities=ids,
    )
    run.trigger, run.schedule_id = "scheduled", schedule.id
    db.commit()
    return run


def notify(db: Session, run: AiCloseRun, schedule: AiCloseSchedule) -> list[dict]:
    s = alerts.summary(db, run)
    external = schedule.notify_when == "always" or (schedule.notify_when == "issues" and s["has_issues"])
    return alerts.send_close_summary(db, run, emails=schedule.notify_emails or [], slack_webhook=schedule.slack_webhook_url,
                                     external=external)


def run_schedule(session_factory: Callable[[], Session], schedule_id: int, period: str, max_workers: int = 4) -> int | None:
    db = session_factory()
    try:
        schedule = db.get(AiCloseSchedule, schedule_id)
        try:
            run = _start(db, schedule, period)
        except ValueError as exc:
            schedule.last_error = f"{period}: {exc}"
            db.commit()
            return None
        run_id = run.id
        schedule.last_run_id = run_id
        db.commit()
    finally:
        db.close()
    orchestrator.execute_run(run_id, session_factory, max_workers=max_workers)
    db = session_factory()
    try:
        run, schedule = db.get(AiCloseRun, run_id), db.get(AiCloseSchedule, schedule_id)
        notify(db, run, schedule)
        if run.status == "failed":
            schedule.last_error = f"{period}: run #{run_id} finished with a failed agent"
        db.commit()
    except Exception as exc:  # noqa: BLE001 - the run itself is complete; record the alert failure
        logger.exception("ai-close schedule %s alerts failed", schedule_id)
        db.rollback()
        schedule = db.get(AiCloseSchedule, schedule_id)
        schedule.last_error = f"{period}: alerts failed ({type(exc).__name__})"
        db.commit()
    finally:
        db.close()
    return run_id


def run_due_schedules(session_factory: Callable[[], Session], now: datetime | None = None, max_workers: int = 4) -> list[int]:
    """Run every enabled schedule that is due; returns the ids of the runs started."""
    db = session_factory()
    try:
        due = []
        for s in db.query(AiCloseSchedule).filter(AiCloseSchedule.enabled.is_(True)).all():
            try:
                period = due_period(s, now)
            except Exception as exc:  # noqa: BLE001 - e.g. an invalid stored time zone
                s.last_error = f"Schedule not evaluated: {exc}"
                db.commit()
                continue
            if period and claim(db, s.id, period):
                due.append((s.id, period))
    finally:
        db.close()
    started = []
    for schedule_id, period in due:
        run_id = run_schedule(session_factory, schedule_id, period, max_workers)
        if run_id:
            started.append(run_id)
    return started


def describe(schedule: AiCloseSchedule, now: datetime | None = None) -> dict:
    return {
        "id": schedule.id, "enabled": schedule.enabled, "scope": schedule.scope, "entity_ids": schedule.entity_ids or [],
        "agents": schedule.agents, "run_day": schedule.run_day, "run_hour": schedule.run_hour, "timezone": schedule.timezone,
        "notify_emails": schedule.notify_emails or [], "slack_configured": bool(schedule.slack_webhook_url),
        "notify_when": schedule.notify_when, "last_run_period": schedule.last_run_period, "last_run_id": schedule.last_run_id,
        "last_run_at": schedule.last_run_at.isoformat() if schedule.last_run_at else None, "last_error": schedule.last_error,
        "next_run_at": (lambda n: n.isoformat() if n else None)(next_run_at(schedule, now)),
        "next_period": preview_period(schedule, now), "updated_by": schedule.updated_by,
    }


def preview_period(schedule: AiCloseSchedule, now: datetime | None = None) -> str | None:
    n = next_run_at(schedule, now)
    return target_period(n.astimezone(ZoneInfo(schedule.timezone))) if n else None
