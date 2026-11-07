"""Scheduled month-end closes and close summary alerts."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.models.ai_close import AiCloseRun, AiCloseSchedule
from app.models.workspace_notification import WorkspaceNotification
from app.services import notification_service
from app.services.ai_close import agents, alerts, scheduling
from tests.test_ai_close import (  # noqa: F401 - pytest fixtures
    BASE, PHASE_A, WS_A, _start, client, demo, env, q, sb, session_factory,
)

SLACK = "https://hooks.slack.com/services/T000/B000/abcdef123456"
DUE = datetime(2026, 11, 2, 3, 0, tzinfo=timezone.utc)  # 07:00 in Dubai


def _utc(*args):
    return datetime(*args, tzinfo=timezone.utc)


@pytest.fixture()
def outbox(monkeypatch):
    sent = {"email": [], "slack": []}

    def send(to, subject, body, *, html=None, attachment=None, attachment_filename=""):
        sent["email"].append({"to": to, "subject": subject, "body": body, "html": html, "attachment": attachment,
                              "filename": attachment_filename})
        return True

    class Res:
        status_code = 200

    def post(url, json=None, timeout=None):
        sent["slack"].append({"url": url, "text": json["text"]})
        return Res()

    monkeypatch.setattr(notification_service, "send_notification", send)
    monkeypatch.setattr(alerts.httpx, "post", post)
    return sent


def _schedule(session_factory, company_id, **kw):
    db = session_factory()
    s = AiCloseSchedule(workspace_id=WS_A, company_id=company_id, agents=kw.pop("agents", PHASE_A), run_day=2, run_hour=6,
                        timezone="Asia/Dubai", **kw)
    db.add(s)
    db.commit()
    sid = s.id
    db.close()
    return sid


def test_due_period_and_next_run():
    s = AiCloseSchedule(enabled=True, run_day=2, run_hour=6, timezone="Asia/Dubai", last_run_period=None)
    assert scheduling.due_period(s, _utc(2026, 11, 2, 1, 30)) is None
    assert scheduling.next_run_at(s, _utc(2026, 11, 2, 1, 30)) == _utc(2026, 11, 2, 2, 0)
    assert scheduling.due_period(s, _utc(2026, 11, 2, 2, 5)) == "2026-10"
    assert scheduling.due_period(s, _utc(2027, 1, 20, 9, 0)) == "2026-12"
    s.last_run_period = "2026-10"
    assert scheduling.due_period(s, _utc(2026, 11, 20, 2, 5)) is None
    assert scheduling.next_run_at(s, _utc(2026, 11, 20, 2, 5)) == _utc(2026, 12, 2, 2, 0)
    assert scheduling.preview_period(s, _utc(2026, 11, 20, 2, 5)) == "2026-11"
    s.enabled = False
    assert scheduling.next_run_at(s) is None


def test_month_is_claimed_once(session_factory, demo):
    sid = _schedule(session_factory, demo.a)
    first, second = session_factory(), session_factory()
    assert scheduling.claim(first, sid, "2026-10") is True
    assert scheduling.claim(second, sid, "2026-10") is False
    assert scheduling.claim(second, sid, "2026-11") is True
    first.close()
    second.close()


def test_scheduled_group_close_runs_once_and_sends_summary(session_factory, demo, outbox):
    sid = _schedule(session_factory, demo.a, scope="group", entity_ids=demo.group, agents=list(agents.ENTITY_AGENTS),
                    notify_emails=["cfo@example.com", "controller@example.com"], slack_webhook_url=SLACK)
    assert scheduling.run_due_schedules(session_factory, now=_utc(2026, 11, 2, 1, 0), max_workers=1) == []
    started = scheduling.run_due_schedules(session_factory, now=DUE, max_workers=1)
    assert len(started) == 1
    assert scheduling.run_due_schedules(session_factory, now=DUE, max_workers=1) == []

    db = session_factory()
    run = db.get(AiCloseRun, started[0])
    schedule = db.get(AiCloseSchedule, sid)
    assert (run.period, run.trigger, run.schedule_id, run.scope, run.status) == ("2026-10", "scheduled", sid, "group", "awaiting_approval")
    assert run.requested_by == scheduling.SCHEDULED_BY and run.entity_ids == demo.group
    assert schedule.last_run_period == "2026-10" and schedule.last_run_id == run.id and schedule.last_error is None
    summary = alerts.summary(db, run)
    channels = [(n["channel"], n["target"], n["ok"]) for n in run.notified_json]
    assert channels[0] == ("in_app", "workspace", True)
    assert ("email", "cfo@example.com", True) in channels and ("email", "controller@example.com", True) in channels
    assert channels[-1][0] == "slack" and channels[-1][1].endswith("123456") and SLACK not in str(channels)
    note = db.query(WorkspaceNotification).filter_by(workspace_id=WS_A, type="close_summary").one()
    assert note.severity == "warning" and "2026-10" in note.title
    db.close()

    email = outbox["email"][0]
    assert "Month-end close 2026-10" in email["subject"] and "ready for review" in email["subject"]
    assert email["attachment"][:5] == b"%PDF-" and email["filename"].startswith("cfo-executive-summary-2026-10")
    assert f"Journals awaiting approval: {summary['pending_approvals']}" in email["body"]
    assert summary["pending_approvals"] == 11 and "/ai-cfo/executive-summary" in email["body"]
    assert outbox["slack"][0]["url"] == SLACK and "Top issues:" in outbox["slack"][0]["text"]


def test_failed_scheduled_run_alerts_on_issues_only(session_factory, demo, outbox, monkeypatch):
    def boom(ctx):
        raise RuntimeError("AR source unavailable")

    monkeypatch.setitem(agents.AGENTS, "ar_intelligence", ("AR Intelligence Agent", boom))
    sid = _schedule(session_factory, demo.a, notify_emails=["cfo@example.com"], notify_when="issues")
    run_id = scheduling.run_due_schedules(session_factory, now=DUE, max_workers=1)[0]
    db = session_factory()
    assert db.get(AiCloseRun, run_id).status == "failed"
    assert "failed agent" in db.get(AiCloseSchedule, sid).last_error
    assert db.query(WorkspaceNotification).filter_by(type="close_summary").one().severity == "critical"
    db.close()
    assert "needs attention" in outbox["email"][0]["subject"] and "Failed: Age receivables" in outbox["email"][0]["body"]


def test_notify_never_keeps_alerts_in_app(session_factory, demo, outbox):
    _schedule(session_factory, demo.a, notify_emails=["cfo@example.com"], slack_webhook_url=SLACK, notify_when="never")
    run_id = scheduling.run_due_schedules(session_factory, now=DUE, max_workers=1)[0]
    db = session_factory()
    assert [n["channel"] for n in db.get(AiCloseRun, run_id).notified_json] == ["in_app"]
    db.close()
    assert outbox == {"email": [], "slack": []}


def test_schedule_skips_when_a_close_is_already_running(session_factory, demo, outbox):
    sid = _schedule(session_factory, demo.a)
    db = session_factory()
    db.add(AiCloseRun(workspace_id=WS_A, company_id=demo.a, period="2026-10", agents=PHASE_A, status="running"))
    db.commit()
    db.close()
    assert scheduling.run_due_schedules(session_factory, now=DUE, max_workers=1) == []
    db = session_factory()
    assert "still running" in db.get(AiCloseSchedule, sid).last_error
    db.close()


def test_schedule_api_validation_roles_and_secret(client, env, demo):
    url = BASE + "/schedule" + q(demo.a)
    body = {"scope": "group", "entity_ids": demo.group[1:], "agents": PHASE_A, "run_day": 3, "run_hour": 7,
            "timezone": "Asia/Dubai", "notify_emails": ["CFO@Example.com"], "slack_webhook_url": SLACK}
    assert client.get(url).json() is None
    assert client.put(url, json=body).status_code == 403
    env.roles[WS_A] = "owner"
    saved = client.put(url, json=body).json()
    assert saved["slack_configured"] is True and "slack_webhook_url" not in saved and SLACK not in str(saved)
    assert saved["entity_ids"] == demo.group and saved["notify_emails"] == ["cfo@example.com"]
    assert saved["next_run_at"] and saved["next_period"]
    for bad in ({"timezone": "Mars/Base"}, {"run_day": 31}, {"notify_emails": ["not-an-email"]},
                {"slack_webhook_url": "https://example.com/hook"}, {"entity_ids": [demo.b]}, {"agents": []}):
        assert client.put(url, json={**body, **bad}).status_code == 422, bad
    kept = client.put(url, json={**body, "slack_webhook_url": None, "run_day": 5}).json()
    assert kept["slack_configured"] is True and kept["run_day"] == 5
    cleared = client.put(url, json={**body, "slack_webhook_url": ""}).json()
    assert cleared["slack_configured"] is False
    env.roles[WS_A] = "viewer"
    assert client.get(url).json()["run_day"] == 3
    assert client.delete(url).status_code == 403
    env.roles[WS_A] = "owner"
    assert client.delete(url).status_code == 204 and client.get(url).json() is None


def test_send_summary_now(client, env, demo, outbox):
    run = _start(client, demo.a, agents=PHASE_A)
    res = client.post(f"{BASE}/runs/{run['id']}/notify" + q(demo.a), json={"emails": ["cfo@example.com"]})
    assert res.status_code == 200
    assert [(d["channel"], d["target"]) for d in res.json()["deliveries"]] == [("in_app", "workspace"), ("email", "cfo@example.com")]
    again = client.get(f"{BASE}/runs/{run['id']}" + q(demo.a)).json()
    assert again["trigger"] is None and len(again["notified_json"]) == 2
    default = client.post(f"{BASE}/runs/{run['id']}/notify" + q(demo.a), json={}).json()
    assert default["deliveries"][-1]["target"] == "controller@example.com"
    assert client.post(f"{BASE}/runs/{run['id']}/notify" + q(demo.a), json={"emails": ["x"]}).status_code == 422
    env.roles[WS_A] = "viewer"
    assert client.post(f"{BASE}/runs/{run['id']}/notify" + q(demo.a), json={}).status_code == 403
