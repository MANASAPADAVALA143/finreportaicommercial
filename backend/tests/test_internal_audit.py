"""Internal Audit API: login, company isolation, role limits and dashboard maths."""

from __future__ import annotations

import os
from datetime import date, timedelta
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core import company_access
from app.core.database import get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.history_models import JEAnomalyReview
from app.models.internal_audit import (
    AuditEngagement,
    AuditFinding,
    AuditFindingDueDateRevision,
    AuditFindingFollowup,
    AuditUniverse,
)
from app.models.workspace import WorkspaceRole
from app.routers import internal_audit

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
CO_A = "aaaaaaaa-1111-4000-8000-000000000001"
CO_A2 = "aaaaaaaa-1111-4000-8000-000000000003"
CO_B = "bbbbbbbb-1111-4000-8000-000000000002"
COMPANY_WORKSPACE = {CO_A: WS_A, CO_A2: WS_A, CO_B: WS_B}

YESTERDAY = (date.today() - timedelta(days=1)).isoformat()
TOMORROW = (date.today() + timedelta(days=1)).isoformat()


class Env:
    def __init__(self):
        self.roles = {WS_A: "accountant"}
        self.user_role = "accountant"

    def ctx(self) -> WorkspaceContext:
        role = self.roles.get(WS_A)
        return WorkspaceContext(
            workspace_id=WS_A,
            workspace=SimpleNamespace(id=WS_A),
            user=SimpleNamespace(id="user-1", email="auditor@example.com", role=self.user_role),
            role=WorkspaceRole(role) if role else None,
        )


@pytest.fixture()
def env(monkeypatch):
    e = Env()
    monkeypatch.setattr(
        company_access, "_company_workspace_ids",
        lambda _db, cid: iter([COMPANY_WORKSPACE[cid]] if cid in COMPANY_WORKSPACE else []),
    )
    monkeypatch.setattr(company_access, "_workspace_role", lambda _db, _ctx, ws: e.roles.get(ws))
    return e


@pytest.fixture()
def session_factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for model in (
        AuditUniverse, AuditEngagement, AuditFinding, AuditFindingFollowup, AuditFindingDueDateRevision, JEAnomalyReview,
    ):
        model.__table__.create(engine)
    return sessionmaker(bind=engine)


def _app(env: Env | None, session_factory) -> FastAPI:
    app = FastAPI()
    app.include_router(internal_audit.router)

    def _db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db
    if env is not None:
        app.dependency_overrides[validate_workspace] = env.ctx
    return app


@pytest.fixture()
def client(env, session_factory):
    return TestClient(_app(env, session_factory))


def q(company: str = CO_A) -> str:
    return f"?company_id={company}"


# ── Login ────────────────────────────────────────────────────────────────────

ROUTES = [
    ("GET", "/api/internal-audit/dashboard"),
    ("GET", "/api/internal-audit/universe"),
    ("POST", "/api/internal-audit/universe"),
    ("PUT", "/api/internal-audit/universe/1"),
    ("DELETE", "/api/internal-audit/universe/1"),
    ("GET", "/api/internal-audit/engagements"),
    ("POST", "/api/internal-audit/engagements"),
    ("PUT", "/api/internal-audit/engagements/1"),
    ("DELETE", "/api/internal-audit/engagements/1"),
    ("GET", "/api/internal-audit/engagements/1/report.pdf"),
    ("GET", "/api/internal-audit/findings"),
    ("POST", "/api/internal-audit/findings"),
    ("PUT", "/api/internal-audit/findings/1"),
    ("DELETE", "/api/internal-audit/findings/1"),
    ("GET", "/api/internal-audit/overdue-findings"),
    ("GET", "/api/internal-audit/findings/1/follow-up-history"),
    ("POST", "/api/internal-audit/findings/1/followups"),
    ("POST", "/api/internal-audit/findings/1/revise-due-date"),
    ("PATCH", "/api/internal-audit/findings/1/escalation"),
]


@pytest.mark.parametrize("method,path", ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
def test_routes_require_login(env, session_factory, method, path):
    res = TestClient(_app(None, session_factory)).request(
        method, path + q(), json={"title": "x", "unit_name": "x"}, headers={"X-Workspace-ID": WS_A}
    )
    assert res.status_code == 401, res.text


# ── Company isolation ────────────────────────────────────────────────────────


def test_universe_crud_in_own_company(client, env):
    res = client.post("/api/internal-audit/universe" + q(), json={"unit_name": "Accounts Payable", "department": ""})
    assert res.status_code == 201, res.text
    unit = res.json()
    assert unit["company_id"] == CO_A and unit["workspace_id"] == WS_A and unit["department"] is None

    res = client.put(f"/api/internal-audit/universe/{unit['id']}" + q(), json={"unit_name": "AP", "residual_risk": "High"})
    assert res.status_code == 200 and res.json()["residual_risk"] == "High"
    assert [u["unit_name"] for u in client.get("/api/internal-audit/universe" + q()).json()] == ["AP"]


def test_other_workspace_company_is_forbidden(client, env):
    assert client.get("/api/internal-audit/findings" + q(CO_B)).status_code == 403
    assert client.post("/api/internal-audit/universe" + q(CO_B), json={"unit_name": "x"}).status_code == 403


def test_company_id_is_required_and_validated(client, env):
    assert client.get("/api/internal-audit/universe").status_code == 422
    assert client.get("/api/internal-audit/universe?company_id=default").status_code == 422


def test_records_are_invisible_and_untouchable_from_sibling_company(client, env):
    unit = client.post("/api/internal-audit/universe" + q(CO_A), json={"unit_name": "Treasury"}).json()
    assert client.get("/api/internal-audit/universe" + q(CO_A2)).json() == []

    env.roles[WS_A] = "owner"
    assert client.put(f"/api/internal-audit/universe/{unit['id']}" + q(CO_A2), json={"unit_name": "x"}).status_code == 404
    assert client.delete(f"/api/internal-audit/universe/{unit['id']}" + q(CO_A2)).status_code == 404
    assert client.get("/api/internal-audit/universe" + q(CO_A)).json()[0]["unit_name"] == "Treasury"


def test_finding_cannot_link_to_another_companys_engagement(client, env):
    other = client.post("/api/internal-audit/engagements" + q(CO_A2), json={"title": "Payroll audit"}).json()
    res = client.post("/api/internal-audit/findings" + q(CO_A), json={"title": "x", "engagement_id": other["id"]})
    assert res.status_code == 422
    assert client.get("/api/internal-audit/findings" + q(CO_A)).json() == []


# ── Roles ────────────────────────────────────────────────────────────────────


def test_viewer_can_read_but_not_write(client, env):
    env.roles[WS_A] = "viewer"
    assert client.get("/api/internal-audit/dashboard" + q()).status_code == 200
    assert client.post("/api/internal-audit/findings" + q(), json={"title": "x"}).status_code == 403


def test_delete_requires_manager_role(client, env):
    finding = client.post("/api/internal-audit/findings" + q(), json={"title": "Weak segregation"}).json()
    res = client.delete(f"/api/internal-audit/findings/{finding['id']}" + q())
    assert res.status_code == 403 and "accountant" in res.json()["detail"]

    env.roles[WS_A] = "finance_manager"
    assert client.delete(f"/api/internal-audit/findings/{finding['id']}" + q()).status_code == 204
    assert client.get("/api/internal-audit/findings" + q()).json() == []


# ── Validation, references and counts ────────────────────────────────────────


def test_invalid_enum_values_rejected(client, env):
    assert client.post("/api/internal-audit/findings" + q(), json={"title": "x", "risk_rating": "Huge"}).status_code == 422
    assert client.post("/api/internal-audit/engagements" + q(), json={"title": "x", "status": "Done"}).status_code == 422
    assert client.post("/api/internal-audit/universe" + q(), json={"unit_name": ""}).status_code == 422


def test_references_are_sequential_and_survive_deletes(client, env):
    year = date.today().year
    first = client.post("/api/internal-audit/engagements" + q(), json={"title": "One"}).json()
    second = client.post("/api/internal-audit/engagements" + q(), json={"title": "Two"}).json()
    assert (first["engagement_ref"], second["engagement_ref"]) == (f"IA-{year}-001", f"IA-{year}-002")

    env.roles[WS_A] = "owner"
    client.delete(f"/api/internal-audit/engagements/{first['id']}" + q())
    third = client.post("/api/internal-audit/engagements" + q(), json={"title": "Three"}).json()
    assert third["engagement_ref"] == f"IA-{year}-003"


def test_engagement_findings_count_tracks_create_move_and_delete(client, env):
    e1 = client.post("/api/internal-audit/engagements" + q(), json={"title": "E1"}).json()
    e2 = client.post("/api/internal-audit/engagements" + q(), json={"title": "E2"}).json()
    f = client.post("/api/internal-audit/findings" + q(), json={"title": "F", "engagement_id": e1["id"]}).json()
    client.post("/api/internal-audit/findings" + q(), json={"title": "G", "engagement_id": e1["id"]})

    counts = lambda: {e["title"]: e["findings_count"] for e in client.get("/api/internal-audit/engagements" + q()).json()}  # noqa: E731
    assert counts() == {"E1": 2, "E2": 0}

    client.put(f"/api/internal-audit/findings/{f['id']}" + q(), json={"title": "F", "engagement_id": e2["id"]})
    assert counts() == {"E1": 1, "E2": 1}

    env.roles[WS_A] = "owner"
    client.delete(f"/api/internal-audit/findings/{f['id']}" + q())
    assert counts() == {"E1": 1, "E2": 0}


def test_deleting_engagement_unlinks_its_findings(client, env):
    env.roles[WS_A] = "owner"
    e = client.post("/api/internal-audit/engagements" + q(), json={"title": "E"}).json()
    client.post("/api/internal-audit/findings" + q(), json={"title": "F", "engagement_id": e["id"]})
    assert client.delete(f"/api/internal-audit/engagements/{e['id']}" + q()).status_code == 204
    assert client.get("/api/internal-audit/findings" + q()).json()[0]["engagement_id"] is None


def test_dashboard_counts(client, env):
    post = lambda body, co=CO_A: client.post("/api/internal-audit/findings" + q(co), json=body)  # noqa: E731
    post({"title": "Overdue", "risk_rating": "High", "action_due_date": YESTERDAY})
    post({"title": "Due later", "risk_rating": "High", "action_due_date": TOMORROW, "status": "In Progress"})
    post({"title": "No date", "risk_rating": "Low", "action_due_date": ""})
    post({"title": "Fixed late", "risk_rating": "Critical", "action_due_date": YESTERDAY, "status": "Verified", "is_repeat": True})
    post({"title": "Sibling company", "action_due_date": YESTERDAY}, co=CO_A2)
    client.post("/api/internal-audit/engagements" + q(), json={"title": "E", "status": "Closed"})
    client.post("/api/internal-audit/universe" + q(), json={"unit_name": "U", "residual_risk": "High"})

    d = client.get("/api/internal-audit/dashboard" + q()).json()
    assert d["open_findings"] == 3
    assert d["overdue_actions"] == 1
    assert d["repeat_findings"] == 1
    assert d["findings_by_risk"] == {"High": 2, "Low": 1, "Critical": 1}
    assert d["engagements_by_status"] == {"Closed": 1}
    assert d["universe_by_risk"] == {"High": 1}
    assert {f["title"] for f in d["recent_open_findings"]} == {"Overdue", "Due later", "No date"}


# ── Engagement report PDF ────────────────────────────────────────────────────


@pytest.fixture()
def captured(monkeypatch):
    calls: list[dict] = []

    def fake(**kw):
        calls.append(kw)
        return b"%PDF-fake"

    monkeypatch.setattr(internal_audit, "build_internal_audit_report_pdf", fake)
    return calls


def _review(session_factory, journal_id, posting_date, company=CO_A, score=90.0):
    db = session_factory()
    db.add(JEAnomalyReview(
        workspace_id=COMPANY_WORKSPACE[company], company_id=company, journal_id=journal_id,
        account="6100", amount=1000.0, posting_date=posting_date, risk_score=score, severity="Critical",
    ))
    db.commit()
    db.close()


def test_report_pdf_contains_engagement_findings_only(client, env, captured):
    e = client.post("/api/internal-audit/engagements" + q(), json={"title": "P2P audit"}).json()
    client.post("/api/internal-audit/findings" + q(), json={"title": "Linked", "engagement_id": e["id"]})
    client.post("/api/internal-audit/findings" + q(), json={"title": "Unlinked"})

    res = client.get(f"/api/internal-audit/engagements/{e['id']}/report.pdf" + q() + "&company_name=Acme%20LLC")
    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == "application/pdf"
    assert f'internal-audit-report-{e["engagement_ref"]}.pdf' in res.headers["content-disposition"]
    call = captured[0]
    assert call["engagement"]["title"] == "P2P audit"
    assert [f["title"] for f in call["findings"]] == ["Linked"]
    assert call["company_name"] == "Acme LLC"
    assert call["period"] is None and call["je_entries"] == []


def test_report_pdf_of_sibling_company_engagement_is_not_found(client, env, captured):
    e = client.post("/api/internal-audit/engagements" + q(CO_A), json={"title": "Payroll"}).json()
    assert client.get(f"/api/internal-audit/engagements/{e['id']}/report.pdf" + q(CO_A2)).status_code == 404
    assert client.get(f"/api/internal-audit/engagements/{e['id']}/report.pdf" + q(CO_B)).status_code == 403
    assert captured == []


def test_report_pdf_viewer_can_download(client, env, captured):
    e = client.post("/api/internal-audit/engagements" + q(), json={"title": "E"}).json()
    env.roles[WS_A] = "viewer"
    assert client.get(f"/api/internal-audit/engagements/{e['id']}/report.pdf" + q()).status_code == 200


@pytest.mark.parametrize("period", ["2026-Q5", "2026-13", "26", "Q2-2026", "<b>"])
def test_report_pdf_rejects_bad_period(client, env, captured, period):
    e = client.post("/api/internal-audit/engagements" + q(), json={"title": "E"}).json()
    res = client.get(f"/api/internal-audit/engagements/{e['id']}/report.pdf", params={"company_id": CO_A, "period": period})
    assert res.status_code == 422
    assert "YYYY-Qn" in res.text
    assert captured == []


@pytest.mark.parametrize("period,expected", [
    ("2026-Q2", {"in-apr", "in-jun-30", "in-jun-30-time"}),
    ("2026-06", {"in-jun-30", "in-jun-30-time"}),
    ("2026", {"before", "in-apr", "in-jun-30", "in-jun-30-time", "in-jul"}),
])
def test_report_pdf_je_section_uses_period_and_company(client, env, captured, session_factory, period, expected):
    e = client.post("/api/internal-audit/engagements" + q(), json={"title": "E"}).json()
    _review(session_factory, "before", "2026-03-31")
    _review(session_factory, "in-apr", "2026-04-01")
    _review(session_factory, "in-jun-30", "2026-06-30")
    _review(session_factory, "in-jun-30-time", "2026-06-30 18:45:00")
    _review(session_factory, "in-jul", "2026-07-01")
    _review(session_factory, "sibling", "2026-05-01", company=CO_A2)

    res = client.get(f"/api/internal-audit/engagements/{e['id']}/report.pdf", params={"company_id": CO_A, "period": period})
    assert res.status_code == 200, res.text
    call = captured[0]
    assert call["period"] == period
    assert {r["journal_id"] for r in call["je_entries"]} == expected


# ── Overdue follow-up queue ──────────────────────────────────────────────────

TODAY = date.today()


def _days_ago(n: int) -> str:
    return (TODAY - timedelta(days=n)).isoformat()


def _finding(client, title, due, co=CO_A, **extra):
    res = client.post("/api/internal-audit/findings" + q(co), json={"title": title, "action_due_date": due, **extra})
    assert res.status_code == 201, res.text
    return res.json()


def test_overdue_queue_lists_only_open_past_due_findings_in_company(client, env):
    _finding(client, "Late 10", _days_ago(10), risk_rating="High")
    _finding(client, "Late 95", _days_ago(95))
    _finding(client, "Due today", TODAY.isoformat())
    _finding(client, "Future", TOMORROW)
    _finding(client, "No date", "")
    _finding(client, "Closed late", _days_ago(40), status="Implemented")
    _finding(client, "Sibling late", _days_ago(40), co=CO_A2)

    items = client.get("/api/internal-audit/overdue-findings" + q()).json()
    assert [(i["title"], i["days_overdue"]) for i in items] == [("Late 95", 95), ("Late 10", 10)]
    first = items[0]
    assert first["escalation_level"] == "none"
    assert first["latest_followup"] is None
    assert (first["followup_count"], first["revision_count"], first["original_due_date"]) == (0, 0, None)


def test_follow_up_is_logged_by_signed_in_user_and_summarised(client, env):
    f = _finding(client, "Late", _days_ago(20))
    url = f"/api/internal-audit/findings/{f['id']}/followups" + q()
    first = client.post(url, json={"contacted_at": _days_ago(5), "contacted_person": " CFO ", "response_notes": "Promised by Friday"})
    assert first.status_code == 201, first.text
    assert first.json()["logged_by"] == "auditor@example.com"
    assert first.json()["contacted_person"] == "CFO"
    client.post(url, json={"contacted_at": _days_ago(1), "logged_by": "someone-else"})

    item = client.get("/api/internal-audit/overdue-findings" + q()).json()[0]
    assert item["followup_count"] == 2
    assert item["latest_followup"]["contacted_at"] == _days_ago(1)
    assert item["latest_followup"]["logged_by"] == "auditor@example.com"

    history = client.get(f"/api/internal-audit/findings/{f['id']}/follow-up-history" + q()).json()
    assert [h["contacted_at"] for h in history["followups"]] == [_days_ago(1), _days_ago(5)]
    assert history["revisions"] == []


def test_follow_up_validation(client, env):
    f = _finding(client, "Late", _days_ago(20))
    url = f"/api/internal-audit/findings/{f['id']}/followups" + q()
    assert client.post(url, json={"contacted_at": (TODAY + timedelta(days=3)).isoformat()}).status_code == 422
    assert client.post(url, json={"contacted_at": "25/10/2026"}).status_code == 422
    assert client.post(url, json={}).status_code == 422


def test_revise_due_date_keeps_original_and_leaves_queue(client, env):
    original = _days_ago(30)
    f = _finding(client, "Late", original)
    url = f"/api/internal-audit/findings/{f['id']}/revise-due-date" + q()
    new_date = (TODAY + timedelta(days=30)).isoformat()

    res = client.post(url, json={"revised_due_date": new_date, "reason": "  Vendor delay agreed with CFO  "})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["finding"]["action_due_date"] == new_date
    rev = body["revision"]
    assert (rev["original_due_date"], rev["revised_due_date"]) == (original, new_date)
    assert rev["reason"] == "Vendor delay agreed with CFO"
    assert rev["revised_by"] == "auditor@example.com"

    assert client.get("/api/internal-audit/overdue-findings" + q()).json() == []
    history = client.get(f"/api/internal-audit/findings/{f['id']}/follow-up-history" + q()).json()
    assert [r["original_due_date"] for r in history["revisions"]] == [original]


def test_queue_reports_first_original_due_date_after_several_revisions(client, env, session_factory):
    original = _days_ago(60)
    f = _finding(client, "Late", original)
    url = f"/api/internal-audit/findings/{f['id']}/revise-due-date" + q()
    client.post(url, json={"revised_due_date": TOMORROW, "reason": "first"})
    client.post(url, json={"revised_due_date": (TODAY + timedelta(days=9)).isoformat(), "reason": "second"})

    db = session_factory()
    db.query(AuditFinding).filter(AuditFinding.id == f["id"]).update({AuditFinding.action_due_date: _days_ago(2)})
    db.commit()
    db.close()

    item = client.get("/api/internal-audit/overdue-findings" + q()).json()[0]
    assert (item["revision_count"], item["original_due_date"], item["days_overdue"]) == (2, original, 2)


@pytest.mark.parametrize("body,status", [
    ({"revised_due_date": TOMORROW, "reason": "   "}, 422),
    ({"revised_due_date": TOMORROW}, 422),
    ({"revised_due_date": (TODAY - timedelta(days=5)).isoformat(), "reason": "x"}, 422),
    ({"revised_due_date": "not-a-date", "reason": "x"}, 422),
])
def test_revise_due_date_validation(client, env, body, status):
    f = _finding(client, "Late", _days_ago(10))
    res = client.post(f"/api/internal-audit/findings/{f['id']}/revise-due-date" + q(), json=body)
    assert res.status_code == status, res.text
    assert client.get(f"/api/internal-audit/findings/{f['id']}/follow-up-history" + q()).json()["revisions"] == []


def test_revise_due_date_rejects_closed_finding_and_same_date(client, env):
    closed = _finding(client, "Done", _days_ago(10), status="Verified")
    res = client.post(f"/api/internal-audit/findings/{closed['id']}/revise-due-date" + q(), json={"revised_due_date": TOMORROW, "reason": "x"})
    assert res.status_code == 409
    same = _finding(client, "Later", TOMORROW)
    res = client.post(f"/api/internal-audit/findings/{same['id']}/revise-due-date" + q(), json={"revised_due_date": TOMORROW, "reason": "x"})
    assert res.status_code == 422


def test_escalation_levels(client, env):
    f = _finding(client, "Late", _days_ago(10))
    url = f"/api/internal-audit/findings/{f['id']}/escalation" + q()
    assert client.patch(url, json={"escalation_level": "board"}).status_code == 422
    res = client.patch(url, json={"escalation_level": "audit_committee"})
    assert res.status_code == 200 and res.json()["escalation_level"] == "audit_committee"
    assert client.get("/api/internal-audit/overdue-findings" + q()).json()[0]["escalation_level"] == "audit_committee"


def test_follow_up_routes_respect_roles_and_company(client, env):
    f = _finding(client, "Late", _days_ago(10))
    fid = f["id"]
    env.roles[WS_A] = "viewer"
    assert client.get("/api/internal-audit/overdue-findings" + q()).status_code == 200
    assert client.get(f"/api/internal-audit/findings/{fid}/follow-up-history" + q()).status_code == 200
    assert client.post(f"/api/internal-audit/findings/{fid}/followups" + q(), json={"contacted_at": _days_ago(1)}).status_code == 403
    assert client.patch(f"/api/internal-audit/findings/{fid}/escalation" + q(), json={"escalation_level": "cfo"}).status_code == 403

    env.roles[WS_A] = "accountant"
    for method, path, body in (
        ("GET", f"/api/internal-audit/findings/{fid}/follow-up-history", None),
        ("POST", f"/api/internal-audit/findings/{fid}/followups", {"contacted_at": _days_ago(1)}),
        ("POST", f"/api/internal-audit/findings/{fid}/revise-due-date", {"revised_due_date": TOMORROW, "reason": "x"}),
        ("PATCH", f"/api/internal-audit/findings/{fid}/escalation", {"escalation_level": "cfo"}),
    ):
        assert client.request(method, path + q(CO_A2), json=body).status_code == 404
        assert client.request(method, path + q(CO_B), json=body).status_code == 403
    assert client.get("/api/internal-audit/overdue-findings" + q(CO_A2)).json() == []


def test_deleting_finding_removes_its_follow_up_history(client, env, session_factory):
    f = _finding(client, "Late", _days_ago(10))
    client.post(f"/api/internal-audit/findings/{f['id']}/followups" + q(), json={"contacted_at": _days_ago(1)})
    client.post(f"/api/internal-audit/findings/{f['id']}/revise-due-date" + q(), json={"revised_due_date": TOMORROW, "reason": "x"})
    env.roles[WS_A] = "owner"
    assert client.delete(f"/api/internal-audit/findings/{f['id']}" + q()).status_code == 204
    db = session_factory()
    assert db.query(AuditFindingFollowup).count() == 0
    assert db.query(AuditFindingDueDateRevision).count() == 0
    db.close()


def test_report_pdf_receives_follow_up_summary(client, env, captured):
    original = _days_ago(30)
    e = client.post("/api/internal-audit/engagements" + q(), json={"title": "E"}).json()
    f = _finding(client, "Late", original, engagement_id=e["id"])
    client.post(f"/api/internal-audit/findings/{f['id']}/followups" + q(), json={"contacted_at": _days_ago(2), "contacted_person": "CFO"})
    client.post(f"/api/internal-audit/findings/{f['id']}/revise-due-date" + q(), json={"revised_due_date": TOMORROW, "reason": "agreed"})
    client.patch(f"/api/internal-audit/findings/{f['id']}/escalation" + q(), json={"escalation_level": "cfo"})

    assert client.get(f"/api/internal-audit/engagements/{e['id']}/report.pdf" + q()).status_code == 200
    sent = captured[0]["findings"][0]
    assert sent["escalation_level"] == "cfo"
    assert sent["original_due_date"] == original and sent["action_due_date"] == TOMORROW
    assert sent["latest_followup"]["contacted_person"] == "CFO"
