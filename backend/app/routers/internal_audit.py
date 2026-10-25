"""Internal Audit API — audit universe, engagements, findings and committee dashboard.

Every route runs inside the caller's verified workspace and requires access to the
requested company: read for any member, write to create/edit, manage to delete.
"""
from __future__ import annotations

import logging
import re
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.company_access import AccessLevel, require_company_access
from app.core.database import get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.history_models import JEAnomalyReview
from app.models.internal_audit import (
    AuditEngagement,
    AuditFinding,
    AuditFindingDueDateRevision,
    AuditFindingFollowup,
    AuditUniverse,
    AuditWorkpaperEvidence,
    AuditWorkpaperProcedure,
)
from app.services import audit_workpaper_storage as wp_storage
from app.services.internal_audit_report import build_internal_audit_report_pdf

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/internal-audit", tags=["internal-audit"])

Risk = Literal["Low", "Medium", "High", "Critical"]
ControlRating = Literal["Strong", "Adequate", "Weak", "None"]
Frequency = Literal["Annual", "Bi-annual", "Quarterly", "Ad-hoc"]
EngagementStatus = Literal["Planning", "Fieldwork", "Reporting", "Closed"]
FindingStatus = Literal["Open", "In Progress", "Overdue", "Implemented", "Verified"]
OPEN_STATUSES = ("Open", "In Progress", "Overdue")
CLOSED_STATUSES = ("Implemented", "Verified")


class Scope:
    def __init__(self, workspace_id: str, company_id: str, user_email: str | None = None):
        self.workspace_id = workspace_id
        self.company_id = company_id
        self.user_email = user_email

    def filter(self, model: Any) -> tuple[Any, Any]:
        return model.workspace_id == self.workspace_id, model.company_id == self.company_id


def _scope(level: AccessLevel):
    def dep(
        company_id: str = Query(...),
        ctx: WorkspaceContext = Depends(validate_workspace),
        db: Session = Depends(get_db),
    ) -> Scope:
        cid = require_company_access(db, ctx, company_id, level)
        return Scope(ctx.workspace_id, cid, getattr(ctx.user, "email", None))

    return dep


_read = _scope("read")
_write = _scope("write")
_manage = _scope("manage")


def _row(obj: Any) -> dict[str, Any]:
    out = {c.name: getattr(obj, c.name) for c in obj.__table__.columns}
    for k, v in out.items():
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
    return out


def _clean(body: BaseModel, *, partial: bool) -> dict[str, Any]:
    """Blank strings become NULL so date comparisons and filters stay meaningful."""
    data = body.model_dump(exclude_unset=partial)
    return {k: (None if isinstance(v, str) and not v.strip() else v) for k, v in data.items()}


def _get_or_404(db: Session, model: Any, obj_id: int, scope: Scope) -> Any:
    obj = db.query(model).filter(model.id == obj_id, *scope.filter(model)).first()
    if obj is None:
        raise HTTPException(status_code=404, detail="Not found")
    return obj


def _next_ref(db: Session, model: Any, column: Any, prefix: str, scope: Scope) -> str:
    year = date.today().year
    stem = f"{prefix}-{year}-"
    taken = {
        r[0] for r in db.query(column).filter(*scope.filter(model), column.like(f"{stem}%")).all() if r[0]
    }
    n = len(taken) + 1
    while f"{stem}{n:03d}" in taken:
        n += 1
    return f"{stem}{n:03d}"


# ── Audit universe ───────────────────────────────────────────────────────────


class UniverseIn(BaseModel):
    unit_name: str = Field(min_length=1, max_length=200)
    department: str | None = Field(default=None, max_length=100)
    process_owner: str | None = Field(default=None, max_length=100)
    inherent_risk: Risk | None = "Medium"
    control_effectiveness: ControlRating | None = "Adequate"
    residual_risk: Risk | None = "Medium"
    audit_frequency: Frequency | None = "Annual"
    last_audited: str | None = Field(default=None, max_length=20)
    next_planned: str | None = Field(default=None, max_length=20)
    notes: str | None = None


@router.get("/universe")
def list_universe(scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    rows = db.query(AuditUniverse).filter(*scope.filter(AuditUniverse)).order_by(AuditUniverse.id).all()
    return [_row(r) for r in rows]


@router.post("/universe", status_code=201)
def create_universe(body: UniverseIn, scope: Scope = Depends(_write), db: Session = Depends(get_db)):
    obj = AuditUniverse(**_clean(body, partial=False), workspace_id=scope.workspace_id, company_id=scope.company_id)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _row(obj)


@router.put("/universe/{uid}")
def update_universe(uid: int, body: UniverseIn, scope: Scope = Depends(_write), db: Session = Depends(get_db)):
    obj = _get_or_404(db, AuditUniverse, uid, scope)
    for k, v in _clean(body, partial=True).items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return _row(obj)


@router.delete("/universe/{uid}", status_code=204)
def delete_universe(uid: int, scope: Scope = Depends(_manage), db: Session = Depends(get_db)):
    db.delete(_get_or_404(db, AuditUniverse, uid, scope))
    db.commit()
    return Response(status_code=204)


# ── Engagements ──────────────────────────────────────────────────────────────


class EngagementIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    audit_unit: str | None = Field(default=None, max_length=200)
    scope: str | None = None
    objectives: str | None = None
    lead_auditor: str | None = Field(default=None, max_length=100)
    team_members: list[str] | None = None
    status: EngagementStatus = "Planning"
    planned_start: str | None = Field(default=None, max_length=20)
    planned_end: str | None = Field(default=None, max_length=20)
    actual_start: str | None = Field(default=None, max_length=20)
    actual_end: str | None = Field(default=None, max_length=20)
    budget_hours: float | None = Field(default=None, ge=0)
    actual_hours: float | None = Field(default=None, ge=0)
    risk_rating: Risk | None = None


def _recount_findings(db: Session, engagement_ids: set[int | None], scope: Scope) -> None:
    for eid in engagement_ids - {None}:
        eng = db.query(AuditEngagement).filter(AuditEngagement.id == eid, *scope.filter(AuditEngagement)).first()
        if eng is not None:
            eng.findings_count = (
                db.query(func.count(AuditFinding.id))
                .filter(AuditFinding.engagement_id == eid, *scope.filter(AuditFinding))
                .scalar()
                or 0
            )


@router.get("/engagements")
def list_engagements(scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    rows = (
        db.query(AuditEngagement)
        .filter(*scope.filter(AuditEngagement))
        .order_by(AuditEngagement.id.desc())
        .all()
    )
    return [_row(r) for r in rows]


@router.post("/engagements", status_code=201)
def create_engagement(body: EngagementIn, scope: Scope = Depends(_write), db: Session = Depends(get_db)):
    ref = _next_ref(db, AuditEngagement, AuditEngagement.engagement_ref, "IA", scope)
    obj = AuditEngagement(
        **_clean(body, partial=False),
        engagement_ref=ref,
        findings_count=0,
        workspace_id=scope.workspace_id,
        company_id=scope.company_id,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _row(obj)


@router.put("/engagements/{eid}")
def update_engagement(eid: int, body: EngagementIn, scope: Scope = Depends(_write), db: Session = Depends(get_db)):
    obj = _get_or_404(db, AuditEngagement, eid, scope)
    for k, v in _clean(body, partial=True).items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return _row(obj)


@router.delete("/engagements/{eid}", status_code=204)
def delete_engagement(eid: int, scope: Scope = Depends(_manage), db: Session = Depends(get_db)):
    obj = _get_or_404(db, AuditEngagement, eid, scope)
    db.query(AuditFinding).filter(AuditFinding.engagement_id == eid, *scope.filter(AuditFinding)).update(
        {AuditFinding.engagement_id: None}, synchronize_session=False
    )
    procedure_ids = [
        pid for (pid,) in db.query(AuditWorkpaperProcedure.id)
        .filter(AuditWorkpaperProcedure.engagement_id == eid, *scope.filter(AuditWorkpaperProcedure))
    ]
    paths = _delete_procedures(db, scope, procedure_ids)
    db.delete(obj)
    db.commit()
    _remove_stored_files(paths)
    return Response(status_code=204)


# ── Findings & corrective actions ────────────────────────────────────────────


class FindingIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    engagement_id: int | None = None
    description: str | None = None
    risk_rating: Risk = "Medium"
    root_cause: str | None = Field(default=None, max_length=100)
    control_gap: str | None = None
    recommendation: str | None = None
    management_response: str | None = None
    action_owner: str | None = Field(default=None, max_length=100)
    action_due_date: str | None = Field(default=None, max_length=20)
    status: FindingStatus = "Open"
    is_repeat: bool = False
    repeat_from_year: str | None = Field(default=None, max_length=10)
    evidence_ref: str | None = Field(default=None, max_length=200)


def _check_engagement(db: Session, engagement_id: int | None, scope: Scope) -> None:
    if engagement_id is None:
        return
    exists = (
        db.query(AuditEngagement.id)
        .filter(AuditEngagement.id == engagement_id, *scope.filter(AuditEngagement))
        .first()
    )
    if exists is None:
        raise HTTPException(status_code=422, detail="Engagement not found for this company")


@router.get("/findings")
def list_findings(scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    rows = db.query(AuditFinding).filter(*scope.filter(AuditFinding)).order_by(AuditFinding.id.desc()).all()
    return [_row(r) for r in rows]


@router.post("/findings", status_code=201)
def create_finding(body: FindingIn, scope: Scope = Depends(_write), db: Session = Depends(get_db)):
    _check_engagement(db, body.engagement_id, scope)
    ref = _next_ref(db, AuditFinding, AuditFinding.finding_ref, "F", scope)
    obj = AuditFinding(
        **_clean(body, partial=False),
        finding_ref=ref,
        workspace_id=scope.workspace_id,
        company_id=scope.company_id,
    )
    db.add(obj)
    db.flush()
    _recount_findings(db, {obj.engagement_id}, scope)
    db.commit()
    db.refresh(obj)
    return _row(obj)


@router.put("/findings/{fid}")
def update_finding(fid: int, body: FindingIn, scope: Scope = Depends(_write), db: Session = Depends(get_db)):
    obj = _get_or_404(db, AuditFinding, fid, scope)
    data = _clean(body, partial=True)
    if "engagement_id" in data:
        _check_engagement(db, data["engagement_id"], scope)
    previous = obj.engagement_id
    for k, v in data.items():
        setattr(obj, k, v)
    db.flush()
    _recount_findings(db, {previous, obj.engagement_id}, scope)
    db.commit()
    db.refresh(obj)
    return _row(obj)


@router.delete("/findings/{fid}", status_code=204)
def delete_finding(fid: int, scope: Scope = Depends(_manage), db: Session = Depends(get_db)):
    obj = _get_or_404(db, AuditFinding, fid, scope)
    engagement_id = obj.engagement_id
    for child in (AuditFindingFollowup, AuditFindingDueDateRevision):
        db.query(child).filter(child.finding_id == fid, *scope.filter(child)).delete(synchronize_session=False)
    db.delete(obj)
    db.flush()
    _recount_findings(db, {engagement_id}, scope)
    db.commit()
    return Response(status_code=204)


# ── Audit committee dashboard ────────────────────────────────────────────────


@router.get("/dashboard")
def dashboard(scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    today = date.today().isoformat()
    in_scope_findings = scope.filter(AuditFinding)

    eng_rows = (
        db.query(AuditEngagement.status, func.count(AuditEngagement.id))
        .filter(*scope.filter(AuditEngagement))
        .group_by(AuditEngagement.status)
        .all()
    )
    risk_rows = (
        db.query(AuditFinding.risk_rating, func.count(AuditFinding.id))
        .filter(*in_scope_findings)
        .group_by(AuditFinding.risk_rating)
        .all()
    )
    open_findings = (
        db.query(func.count(AuditFinding.id))
        .filter(*in_scope_findings, AuditFinding.status.in_(OPEN_STATUSES))
        .scalar()
        or 0
    )
    overdue = (
        db.query(func.count(AuditFinding.id))
        .filter(
            *in_scope_findings,
            AuditFinding.action_due_date.isnot(None),
            AuditFinding.action_due_date < today,
            AuditFinding.status.notin_(CLOSED_STATUSES),
        )
        .scalar()
        or 0
    )
    repeat = (
        db.query(func.count(AuditFinding.id))
        .filter(*in_scope_findings, AuditFinding.is_repeat.is_(True))
        .scalar()
        or 0
    )
    universe_rows = (
        db.query(AuditUniverse.residual_risk, func.count(AuditUniverse.id))
        .filter(*scope.filter(AuditUniverse))
        .group_by(AuditUniverse.residual_risk)
        .all()
    )
    recent = (
        db.query(AuditFinding)
        .filter(*in_scope_findings, AuditFinding.status.in_(OPEN_STATUSES))
        .order_by(AuditFinding.id.desc())
        .limit(10)
        .all()
    )
    return {
        "engagements_by_status": {s: n for s, n in eng_rows},
        "findings_by_risk": {r: n for r, n in risk_rows},
        "open_findings": open_findings,
        "overdue_actions": overdue,
        "repeat_findings": repeat,
        "universe_by_risk": {(r or "Unrated"): n for r, n in universe_rows},
        "recent_open_findings": [_row(f) for f in recent],
    }


# ── Overdue follow-up queue ──────────────────────────────────────────────────

EscalationLevel = Literal["none", "management", "cfo", "audit_committee"]
# Users enter dates in their own time zone while the server runs on UTC.
_TZ_SLACK = timedelta(days=1)


def _followup_summary(db: Session, scope: Scope, finding_ids: list[int]) -> dict[int, dict[str, Any]]:
    """Latest follow-up, follow-up count, revision count and first original due date per finding."""
    out: dict[int, dict[str, Any]] = {
        fid: {"latest_followup": None, "followup_count": 0, "revision_count": 0, "original_due_date": None}
        for fid in finding_ids
    }
    if not finding_ids:
        return out
    followups = (
        db.query(AuditFindingFollowup)
        .filter(AuditFindingFollowup.finding_id.in_(finding_ids), *scope.filter(AuditFindingFollowup))
        .order_by(AuditFindingFollowup.contacted_at.desc(), AuditFindingFollowup.id.desc())
        .all()
    )
    for fu in followups:
        s = out[fu.finding_id]
        if s["latest_followup"] is None:
            s["latest_followup"] = _row(fu)
        s["followup_count"] += 1
    revisions = (
        db.query(AuditFindingDueDateRevision)
        .filter(AuditFindingDueDateRevision.finding_id.in_(finding_ids), *scope.filter(AuditFindingDueDateRevision))
        .order_by(AuditFindingDueDateRevision.id)
        .all()
    )
    for rev in revisions:
        s = out[rev.finding_id]
        if s["revision_count"] == 0:
            s["original_due_date"] = rev.original_due_date
        s["revision_count"] += 1
    return out


def _finding_out(obj: AuditFinding) -> dict[str, Any]:
    row = _row(obj)
    row["escalation_level"] = row.get("escalation_level") or "none"
    return row


@router.get("/overdue-findings")
def list_overdue_findings(scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    """Open findings whose action due date has passed, most overdue first."""
    today = date.today()
    rows = (
        db.query(AuditFinding)
        .filter(
            *scope.filter(AuditFinding),
            AuditFinding.status.notin_(CLOSED_STATUSES),
            AuditFinding.action_due_date.isnot(None),
            AuditFinding.action_due_date < today.isoformat(),
        )
        .order_by(AuditFinding.action_due_date, AuditFinding.id)
        .all()
    )
    summary = _followup_summary(db, scope, [f.id for f in rows])
    items = []
    for f in rows:
        try:
            days = (today - date.fromisoformat(f.action_due_date)).days
        except ValueError:
            continue
        items.append({**_finding_out(f), **summary[f.id], "days_overdue": days})
    return items


@router.get("/findings/{fid}/follow-up-history")
def follow_up_history(fid: int, scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    _get_or_404(db, AuditFinding, fid, scope)
    followups = (
        db.query(AuditFindingFollowup)
        .filter(AuditFindingFollowup.finding_id == fid, *scope.filter(AuditFindingFollowup))
        .order_by(AuditFindingFollowup.contacted_at.desc(), AuditFindingFollowup.id.desc())
        .all()
    )
    revisions = (
        db.query(AuditFindingDueDateRevision)
        .filter(AuditFindingDueDateRevision.finding_id == fid, *scope.filter(AuditFindingDueDateRevision))
        .order_by(AuditFindingDueDateRevision.id.desc())
        .all()
    )
    return {"followups": [_row(r) for r in followups], "revisions": [_row(r) for r in revisions]}


class FollowupIn(BaseModel):
    contacted_at: date
    contacted_person: str | None = Field(default=None, max_length=200)
    response_notes: str | None = Field(default=None, max_length=4000)


@router.post("/findings/{fid}/followups", status_code=201)
def add_followup(fid: int, body: FollowupIn, scope: Scope = Depends(_write), db: Session = Depends(get_db)):
    _get_or_404(db, AuditFinding, fid, scope)
    if body.contacted_at > date.today() + _TZ_SLACK:
        raise HTTPException(status_code=422, detail="Contact date cannot be in the future")
    obj = AuditFindingFollowup(
        finding_id=fid,
        workspace_id=scope.workspace_id,
        company_id=scope.company_id,
        contacted_at=body.contacted_at,
        contacted_person=(body.contacted_person or "").strip() or None,
        response_notes=(body.response_notes or "").strip() or None,
        logged_by=scope.user_email,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _row(obj)


class ReviseDueDateIn(BaseModel):
    revised_due_date: date
    reason: str = Field(min_length=1, max_length=2000)


@router.post("/findings/{fid}/revise-due-date", status_code=201)
def revise_due_date(fid: int, body: ReviseDueDateIn, scope: Scope = Depends(_write), db: Session = Depends(get_db)):
    finding = _get_or_404(db, AuditFinding, fid, scope)
    reason = body.reason.strip()
    revised = body.revised_due_date.isoformat()
    if not reason:
        raise HTTPException(status_code=422, detail="A reason is required to revise the due date")
    if finding.status in CLOSED_STATUSES:
        raise HTTPException(status_code=409, detail=f"Finding is {finding.status}; its due date can no longer change")
    if body.revised_due_date < date.today() - _TZ_SLACK:
        raise HTTPException(status_code=422, detail="Revised due date cannot be in the past")
    if revised == finding.action_due_date:
        raise HTTPException(status_code=422, detail="Revised due date is the same as the current one")
    revision = AuditFindingDueDateRevision(
        finding_id=fid,
        workspace_id=scope.workspace_id,
        company_id=scope.company_id,
        original_due_date=finding.action_due_date,
        revised_due_date=revised,
        reason=reason,
        revised_by=scope.user_email,
    )
    db.add(revision)
    finding.action_due_date = revised
    db.commit()
    db.refresh(revision)
    db.refresh(finding)
    return {"revision": _row(revision), "finding": _finding_out(finding)}


class EscalationIn(BaseModel):
    escalation_level: EscalationLevel


@router.patch("/findings/{fid}/escalation")
def set_escalation(fid: int, body: EscalationIn, scope: Scope = Depends(_write), db: Session = Depends(get_db)):
    finding = _get_or_404(db, AuditFinding, fid, scope)
    finding.escalation_level = body.escalation_level
    db.commit()
    db.refresh(finding)
    return _finding_out(finding)


# ── Engagement report PDF ────────────────────────────────────────────────────

_QUARTER_RE = re.compile(r"^(\d{4})-Q([1-4])$")
_MONTH_RE = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")
_YEAR_RE = re.compile(r"^(\d{4})$")


def _period_bounds(period: str) -> tuple[str, str]:
    """`2026-Q2`, `2026-06` or `2026` → (first day, day after last day) as YYYY-MM-DD."""
    if m := _QUARTER_RE.match(period):
        year, q = int(m.group(1)), int(m.group(2))
        first, last = (q - 1) * 3 + 1, q * 3
    elif m := _MONTH_RE.match(period):
        year, first = int(m.group(1)), int(m.group(2))
        last = first
    elif m := _YEAR_RE.match(period):
        year, first, last = int(m.group(1)), 1, 12
    else:
        raise HTTPException(status_code=422, detail="period must be YYYY-Qn, YYYY-MM or YYYY")
    end = date(year, last, monthrange(year, last)[1])
    return date(year, first, 1).isoformat(), (end + timedelta(days=1)).isoformat()


def _company_name(db: Session, company_id: str) -> str | None:
    from app.models.users import Company

    try:
        row = db.query(Company.name).filter(Company.id == company_id).first()
    except Exception:
        db.rollback()
        return None
    return row[0] if row else None


@router.get("/engagements/{eid}/report.pdf")
def engagement_report_pdf(
    eid: int,
    period: str | None = Query(default=None, max_length=10, description="YYYY-Qn, YYYY-MM or YYYY; omit to skip the JE section"),
    company_name: str | None = Query(default=None, max_length=200),
    scope: Scope = Depends(_read),
    db: Session = Depends(get_db),
):
    eng = _get_or_404(db, AuditEngagement, eid, scope)
    findings = (
        db.query(AuditFinding)
        .filter(AuditFinding.engagement_id == eid, *scope.filter(AuditFinding))
        .order_by(AuditFinding.id)
        .all()
    )

    period = (period or "").strip() or None
    je_rows: list[dict[str, Any]] = []
    if period:
        start, end_exclusive = _period_bounds(period)
        reviews = (
            db.query(JEAnomalyReview)
            .filter(
                *scope.filter(JEAnomalyReview),
                JEAnomalyReview.posting_date >= start,
                JEAnomalyReview.posting_date < end_exclusive,
            )
            .order_by(JEAnomalyReview.risk_score.desc())
            .all()
        )
        je_rows = [_row(r) for r in reviews]

    summary = _followup_summary(db, scope, [f.id for f in findings])
    name = (company_name or "").strip() or _company_name(db, scope.company_id)
    pdf = build_internal_audit_report_pdf(
        engagement=_row(eng),
        findings=[{**_finding_out(f), **summary[f.id]} for f in findings],
        company_name=name,
        je_entries=je_rows,
        period=period,
    )
    ref = re.sub(r"[^A-Za-z0-9_-]", "", eng.engagement_ref or "") or f"IA-{eid}"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="internal-audit-report-{ref}.pdf"'},
    )


# ── Digital workpapers ───────────────────────────────────────────────────────

WorkpaperStatus = Literal["not_started", "in_progress", "done"]
_EVIDENCE_FIELDS = ("id", "procedure_id", "file_name", "file_size", "content_type", "uploaded_by", "notes", "created_at")


def _evidence_out(ev: AuditWorkpaperEvidence) -> dict[str, Any]:
    """Evidence row without its storage path, which stays server-side."""
    row = _row(ev)
    return {k: row[k] for k in _EVIDENCE_FIELDS}


def _delete_procedures(db: Session, scope: Scope, procedure_ids: list[int]) -> list[str]:
    """Delete procedures and their evidence rows; return storage paths to remove after commit."""
    if not procedure_ids:
        return []
    evidence = db.query(AuditWorkpaperEvidence).filter(
        AuditWorkpaperEvidence.procedure_id.in_(procedure_ids), *scope.filter(AuditWorkpaperEvidence)
    )
    paths = [ev.storage_path for ev in evidence]
    evidence.delete(synchronize_session=False)
    db.query(AuditWorkpaperProcedure).filter(
        AuditWorkpaperProcedure.id.in_(procedure_ids), *scope.filter(AuditWorkpaperProcedure)
    ).delete(synchronize_session=False)
    return paths


def _remove_stored_files(paths: list[str]) -> None:
    """Best effort: an orphaned object is harmless, a row pointing at a missing file is not."""
    try:
        wp_storage.remove(paths)
    except Exception as exc:
        logger.warning("audit-workpapers: could not remove %d stored file(s): %s", len(paths), exc)


@router.get("/engagements/{eid}/workpapers")
def list_workpapers(eid: int, scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    eng = _get_or_404(db, AuditEngagement, eid, scope)
    procedures = (
        db.query(AuditWorkpaperProcedure)
        .filter(AuditWorkpaperProcedure.engagement_id == eid, *scope.filter(AuditWorkpaperProcedure))
        .order_by(AuditWorkpaperProcedure.sort_order, AuditWorkpaperProcedure.id)
        .all()
    )
    counts = dict(
        db.query(AuditWorkpaperEvidence.procedure_id, func.count(AuditWorkpaperEvidence.id))
        .filter(
            AuditWorkpaperEvidence.procedure_id.in_([p.id for p in procedures]),
            *scope.filter(AuditWorkpaperEvidence),
        )
        .group_by(AuditWorkpaperEvidence.procedure_id)
        .all()
    ) if procedures else {}
    return {
        "engagement": _row(eng),
        "procedures": [{**_row(p), "evidence_count": counts.get(p.id, 0)} for p in procedures],
    }


class ProcedureIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=4000)
    assigned_to: str | None = Field(default=None, max_length=100)


@router.post("/engagements/{eid}/workpapers", status_code=201)
def create_workpaper(eid: int, body: ProcedureIn, scope: Scope = Depends(_write), db: Session = Depends(get_db)):
    _get_or_404(db, AuditEngagement, eid, scope)
    data = _clean(body, partial=False)
    if not (data.get("title") or "").strip():
        raise HTTPException(status_code=422, detail="Procedure title is required")
    last = (
        db.query(func.max(AuditWorkpaperProcedure.sort_order))
        .filter(AuditWorkpaperProcedure.engagement_id == eid, *scope.filter(AuditWorkpaperProcedure))
        .scalar()
    )
    obj = AuditWorkpaperProcedure(
        **{**data, "title": data["title"].strip()},
        engagement_id=eid,
        workspace_id=scope.workspace_id,
        company_id=scope.company_id,
        status="not_started",
        sort_order=(last if last is not None else -1) + 1,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return {**_row(obj), "evidence_count": 0}


class ProcedureUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=4000)
    assigned_to: str | None = Field(default=None, max_length=100)
    status: WorkpaperStatus | None = None
    notes: str | None = Field(default=None, max_length=10000)


@router.patch("/workpapers/{pid}")
def update_workpaper(pid: int, body: ProcedureUpdateIn, scope: Scope = Depends(_write), db: Session = Depends(get_db)):
    obj = _get_or_404(db, AuditWorkpaperProcedure, pid, scope)
    data = _clean(body, partial=True)
    if "title" in data:
        if not (data["title"] or "").strip():
            raise HTTPException(status_code=422, detail="Procedure title is required")
        data["title"] = data["title"].strip()
    if "status" in data:
        if data["status"] is None:
            raise HTTPException(status_code=422, detail="status cannot be empty")
        if data["status"] == "done" and obj.status != "done":
            obj.completed_at = datetime.now(timezone.utc)
            obj.completed_by = scope.user_email
        elif data["status"] != "done":
            obj.completed_at = None
            obj.completed_by = None
    for k, v in data.items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    count = (
        db.query(func.count(AuditWorkpaperEvidence.id))
        .filter(AuditWorkpaperEvidence.procedure_id == pid, *scope.filter(AuditWorkpaperEvidence))
        .scalar()
        or 0
    )
    return {**_row(obj), "evidence_count": count}


@router.delete("/workpapers/{pid}", status_code=204)
def delete_workpaper(pid: int, scope: Scope = Depends(_manage), db: Session = Depends(get_db)):
    _get_or_404(db, AuditWorkpaperProcedure, pid, scope)
    paths = _delete_procedures(db, scope, [pid])
    db.commit()
    _remove_stored_files(paths)
    return Response(status_code=204)


@router.get("/workpapers/{pid}/evidence")
def list_evidence(pid: int, scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    _get_or_404(db, AuditWorkpaperProcedure, pid, scope)
    rows = (
        db.query(AuditWorkpaperEvidence)
        .filter(AuditWorkpaperEvidence.procedure_id == pid, *scope.filter(AuditWorkpaperEvidence))
        .order_by(AuditWorkpaperEvidence.id)
        .all()
    )
    return [_evidence_out(ev) for ev in rows]


@router.post("/workpapers/{pid}/evidence", status_code=201)
def upload_evidence(
    pid: int,
    file: UploadFile = File(...),
    notes: str | None = Form(default=None, max_length=2000),
    scope: Scope = Depends(_write),
    db: Session = Depends(get_db),
):
    _get_or_404(db, AuditWorkpaperProcedure, pid, scope)
    data = file.file.read(wp_storage.MAX_BYTES + 1)
    try:
        name, content_type = wp_storage.check_file(file.filename or "", data)
    except wp_storage.EvidenceRejected as exc:
        raise HTTPException(status_code=413 if len(data) > wp_storage.MAX_BYTES else 422, detail=str(exc)) from exc

    path = wp_storage.object_path(scope.workspace_id, scope.company_id, pid, name)
    try:
        wp_storage.upload(path, data, content_type)
    except Exception as exc:
        logger.warning("audit-workpapers: upload failed for procedure %s: %s", pid, exc)
        raise HTTPException(status_code=502, detail="Storage upload failed") from exc

    ev = AuditWorkpaperEvidence(
        procedure_id=pid,
        workspace_id=scope.workspace_id,
        company_id=scope.company_id,
        file_name=name,
        storage_path=path,
        file_size=len(data),
        content_type=content_type,
        uploaded_by=scope.user_email,
        notes=(notes or "").strip() or None,
    )
    try:
        db.add(ev)
        db.commit()
    except Exception:
        db.rollback()
        _remove_stored_files([path])
        raise
    db.refresh(ev)
    return _evidence_out(ev)


@router.get("/evidence/{evid}/download")
def evidence_download_url(evid: int, scope: Scope = Depends(_read), db: Session = Depends(get_db)):
    ev = _get_or_404(db, AuditWorkpaperEvidence, evid, scope)
    try:
        url = wp_storage.signed_url(ev.storage_path, ev.file_name)
    except Exception as exc:
        logger.warning("audit-workpapers: signed URL failed for evidence %s: %s", evid, exc)
        raise HTTPException(status_code=404, detail="File not found in storage") from exc
    return {"url": url, "expires_in": wp_storage.SIGNED_URL_TTL_SECONDS}


@router.delete("/evidence/{evid}", status_code=204)
def delete_evidence(evid: int, scope: Scope = Depends(_manage), db: Session = Depends(get_db)):
    ev = _get_or_404(db, AuditWorkpaperEvidence, evid, scope)
    path = ev.storage_path
    db.delete(ev)
    db.commit()
    _remove_stored_files([path])
    return Response(status_code=204)
