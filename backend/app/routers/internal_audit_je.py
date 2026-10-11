"""Internal Audit JE review queue — flagged journal entries, auditor sign-off and exports.

Rows are created by /api/v2/analyze-historical for entries scoring above 60 and are
scoped to the caller's workspace plus a company they can access.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.company_access import AccessLevel, require_company_access
from app.core.database import get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.history_models import JEAnomalyReview
from app.models.internal_audit import AuditFinding
from app.routers.internal_audit import Scope, _check_engagement, _next_ref, _recount_findings, _row
from app.services.je_review_export import SEVERITIES, build_pdf, build_xlsx, export_meta, summarize

router = APIRouter(prefix="/api/internal-audit/je-reviews", tags=["internal-audit"])

ReviewStatus = Literal["Open", "Under Review", "Cleared"]
Severity = Literal["Critical", "High", "Medium"]
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class ReviewScope(Scope):
    def __init__(self, workspace_id: str, company_id: str, user_email: str | None):
        super().__init__(workspace_id, company_id)
        self.user_email = user_email


def _review_scope(level: AccessLevel):
    def dep(
        company_id: str = Query(...),
        ctx: WorkspaceContext = Depends(validate_workspace),
        db: Session = Depends(get_db),
    ) -> ReviewScope:
        cid = require_company_access(db, ctx, company_id, level)
        return ReviewScope(ctx.workspace_id, cid, getattr(ctx.user, "email", None))

    return dep


_read = _review_scope("read")
_write = _review_scope("write")


def _date_param(value: str | None, name: str) -> str | None:
    value = (value or "").strip() or None
    if value and not _DATE_RE.match(value):
        raise HTTPException(status_code=422, detail=f"{name} must be YYYY-MM-DD")
    return value


def _query(
    db: Session,
    scope: Scope,
    severity: str | None,
    status: str | None,
    period_start: str | None,
    period_end: str | None,
) -> list[JEAnomalyReview]:
    q = db.query(JEAnomalyReview).filter(*scope.filter(JEAnomalyReview))
    if severity:
        q = q.filter(JEAnomalyReview.severity == severity)
    if status:
        q = q.filter(JEAnomalyReview.status == status)
    if period_start:
        q = q.filter(JEAnomalyReview.posting_date >= period_start)
    if period_end:
        q = q.filter(JEAnomalyReview.posting_date <= period_end)
    rows = q.all()
    rank = {s: i for i, s in enumerate(SEVERITIES)}
    rows.sort(key=lambda r: (rank.get(r.severity, 99), -(r.risk_score or 0)))
    return rows


@router.get("")
def list_reviews(
    severity: Severity | None = None,
    status: ReviewStatus | None = None,
    period_start: str | None = None,
    period_end: str | None = None,
    scope: ReviewScope = Depends(_read),
    db: Session = Depends(get_db),
):
    rows = _query(
        db, scope, severity, status,
        _date_param(period_start, "period_start"), _date_param(period_end, "period_end"),
    )
    items = [_row(r) for r in rows]
    return {"items": items, "summary": summarize(items)}


class ReviewUpdateIn(BaseModel):
    status: ReviewStatus | None = None
    auditor_comment: str | None = Field(default=None, max_length=4000)


@router.patch("/{rid}")
def update_review(rid: int, body: ReviewUpdateIn, scope: ReviewScope = Depends(_write), db: Session = Depends(get_db)):
    row = db.query(JEAnomalyReview).filter(JEAnomalyReview.id == rid, *scope.filter(JEAnomalyReview)).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    data = body.model_dump(exclude_unset=True)
    if "status" in data:
        if data["status"] is None:
            raise HTTPException(status_code=422, detail="status cannot be empty")
        row.status = data["status"]
    if "auditor_comment" in data:
        row.auditor_comment = (data["auditor_comment"] or "").strip() or None
    row.reviewed_by = scope.user_email
    row.reviewed_at = datetime.utcnow()
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return _row(row)


class RaiseFindingIn(BaseModel):
    engagement_id: int | None = None


def _finding_description(row: JEAnomalyReview) -> str:
    parts = [row.explanation, row.ai_observation]
    if row.top_reasons:
        parts.append("Risk indicators: " + "; ".join(str(r) for r in row.top_reasons))
    if row.auditor_comment:
        parts.append(f"Auditor comment: {row.auditor_comment}")
    return "\n\n".join(p for p in parts if p)


@router.post("/{rid}/raise-finding", status_code=201)
def raise_finding(
    rid: int,
    body: RaiseFindingIn,
    scope: ReviewScope = Depends(_write),
    db: Session = Depends(get_db),
):
    row = db.query(JEAnomalyReview).filter(JEAnomalyReview.id == rid, *scope.filter(JEAnomalyReview)).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    if row.finding_id is not None:
        existing = (
            db.query(AuditFinding)
            .filter(AuditFinding.id == row.finding_id, *scope.filter(AuditFinding))
            .first()
        )
        if existing is not None:
            raise HTTPException(status_code=409, detail=f"Already raised as finding {existing.finding_ref}")
    _check_engagement(db, body.engagement_id, scope)

    account = f"{row.account} – {row.account_name}" if row.account_name else row.account
    finding = AuditFinding(
        workspace_id=scope.workspace_id,
        company_id=scope.company_id,
        engagement_id=body.engagement_id,
        finding_ref=_next_ref(db, AuditFinding, AuditFinding.finding_ref, "F", scope),
        title=f"Unusual journal entry {row.journal_id} on account {account}"[:300],
        description=_finding_description(row) or None,
        risk_rating=row.severity if row.severity in SEVERITIES else "Medium",
        evidence_ref=f"JE {row.journal_id}"[:200],
        status="Open",
    )
    db.add(finding)
    db.flush()
    _recount_findings(db, {finding.engagement_id}, scope)
    row.finding_id = finding.id
    if row.status == "Open":
        row.status = "Under Review"
    row.reviewed_by = scope.user_email
    row.reviewed_at = datetime.utcnow()
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(finding)
    db.refresh(row)
    return {"finding": _row(finding), "review": _row(row)}


@router.get("/export")
def export_reviews(
    format: Literal["pdf", "xlsx"] = "pdf",
    severity: Severity | None = None,
    status: ReviewStatus | None = None,
    period_start: str | None = None,
    period_end: str | None = None,
    company_name: str | None = Query(default=None, max_length=200),
    scope: ReviewScope = Depends(_read),
    db: Session = Depends(get_db),
):
    start = _date_param(period_start, "period_start")
    end = _date_param(period_end, "period_end")
    rows = [_row(r) for r in _query(db, scope, severity, status, start, end)]
    meta = export_meta(company_name, start, end, scope.user_email)
    stamp = datetime.utcnow().strftime("%Y%m%d")
    if format == "xlsx":
        content: Any = build_xlsx(rows, meta)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        content = build_pdf(rows, meta)
        media = "application/pdf"
    return Response(
        content=content,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="je-review-{stamp}.{format}"'},
    )
