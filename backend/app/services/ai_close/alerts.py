"""Close summary alerts: in-app notification, email (with the CFO Executive Summary PDF) and
Slack. Every figure comes from the run's records. Each delivery attempt is appended to
run.notified_json so the page can show what was sent, to whom, and whether it succeeded.
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone
from html import escape
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.core import secrets_box
from app.models.ai_close import AiCloseException, AiCloseJournalProposal, AiCloseRun
from app.models.company_setup import UaeCompanyProfile
from app.services import notification_service
from app.services.ai_close import orchestrator
from app.services.ai_close.reports import ReportUnavailable, build_report, render_pdf

logger = logging.getLogger(__name__)

SLACK_PREFIX = "https://hooks.slack.com/services/"
EMAIL_RE = re.compile(r"^[^@\s,;]+@[^@\s,;]+\.[A-Za-z]{2,}$")
MAX_RECIPIENTS = 10
_SEV = {"high": 0, "medium": 1, "low": 2}


def page_link() -> str:
    base = (os.getenv("FRONTEND_URL") or "").rstrip("/")
    return f"{base}/ai-cfo/executive-summary" if base else "/ai-cfo/executive-summary"


def summary(db: Session, run: AiCloseRun) -> dict[str, Any]:
    ids = orchestrator.entity_ids(run)
    names = {p.id: p.company_name for p in db.query(UaeCompanyProfile).filter(UaeCompanyProfile.id.in_(ids))}
    kpis = {k["key"]: k["value"] for k in orchestrator.compute_kpis(db, run)}
    open_exc = db.query(AiCloseException).filter(AiCloseException.run_id == run.id, AiCloseException.status == "open").all()
    open_exc.sort(key=lambda e: (_SEV.get(e.severity, 9), -abs(e.amount or 0)))
    pending = db.query(AiCloseJournalProposal).filter(
        AiCloseJournalProposal.run_id == run.id, AiCloseJournalProposal.status == "pending_approval").all()
    cfo = next((t.output_json for t in orchestrator.tasks_of(db, run) if t.agent == "cfo_intelligence"
                and t.status in ("completed", "completed_with_exceptions")), None) or {}
    label = ("Group: " + ", ".join(names.get(i, i) for i in ids)) if orchestrator.is_group(run) else names.get(run.company_id, run.company_id)
    failed = [t.title for t in orchestrator.tasks_of(db, run) if t.status == "failed"]
    narrative = ((cfo.get("narrative") or {}).get("text") or "").split("\n")[0]
    return {
        "run_id": run.id, "period": run.period, "entity": label, "status": run.status,
        "completion_pct": kpis.get("close_completion_pct"), "exceptions": kpis.get("exceptions_identified"),
        "unresolved": kpis.get("unresolved_exceptions"), "pending_approvals": len(pending),
        "pending_value": round(sum(p.amount or 0 for p in pending), 2), "failed_agents": failed,
        "top_issues": [{"severity": e.severity, "title": e.title, "entity": names.get(e.entity_id or "", "")} for e in open_exc[:5]],
        "narrative": narrative, "link": page_link(),
        "has_issues": run.status == "failed" or bool(pending) or bool(open_exc),
    }


def _subject(s: dict[str, Any]) -> str:
    state = {"failed": "needs attention: an agent failed", "awaiting_approval": "ready for review",
             "closed": "closed"}.get(s["status"], s["status"].replace("_", " "))
    return f"Month-end close {s['period']} — {s['entity'][:80]} — {state}"


def _text(s: dict[str, Any]) -> str:
    lines = [_subject(s), "",
             f"Close completion: {s['completion_pct']}%", f"Exceptions: {s['exceptions']} identified, {s['unresolved']} unresolved",
             f"Journals awaiting approval: {s['pending_approvals']} ({s['pending_value']:,.2f})"]
    if s["failed_agents"]:
        lines.append("Failed: " + "; ".join(s["failed_agents"]))
    if s["top_issues"]:
        lines += ["", "Top issues:"] + [f"- [{i['severity']}] {i['title']}" + (f" ({i['entity']})" if i["entity"] else "") for i in s["top_issues"]]
    if s["narrative"]:
        lines += ["", s["narrative"]]
    lines += ["", f"Review and approve: {s['link']}", "Agents prepare journals only; nothing posts until a finance manager approves it."]
    return "\n".join(lines)


def _html(s: dict[str, Any]) -> str:
    rows = "".join(f"<tr><td style='padding:4px 12px 4px 0;color:#64748b'>{escape(k)}</td><td><b>{escape(str(v))}</b></td></tr>" for k, v in (
        ("Close completion", f"{s['completion_pct']}%"), ("Exceptions identified", s["exceptions"]),
        ("Unresolved", s["unresolved"]), ("Journals awaiting approval", f"{s['pending_approvals']} ({s['pending_value']:,.2f})")))
    issues = "".join(f"<li>[{escape(i['severity'])}] {escape(i['title'])}{' — ' + escape(i['entity']) if i['entity'] else ''}</li>"
                     for i in s["top_issues"])
    failed = f"<p style='color:#b91c1c'><b>Failed:</b> {escape('; '.join(s['failed_agents']))}</p>" if s["failed_agents"] else ""
    return (
        "<div style='font-family:Arial,sans-serif;font-size:14px;color:#0f172a'>"
        f"<div style='background:#071226;color:#fff;padding:12px 16px'><b>{escape(_subject(s))}</b></div>"
        f"<div style='padding:16px'>{failed}<table>{rows}</table>"
        + (f"<p><b>Top issues</b></p><ul>{issues}</ul>" if issues else "")
        + (f"<p>{escape(s['narrative'])}</p>" if s["narrative"] else "")
        + f"<p><a href='{escape(s['link'])}' style='background:#C9A84C;color:#0f172a;padding:8px 14px;text-decoration:none'>Review and approve</a></p>"
        "<p style='color:#64748b;font-size:12px'>Agents prepare journals only; nothing posts until a finance manager approves it. "
        "The CFO Executive Summary is attached when available.</p></div></div>"
    )


def valid_slack_url(url: str) -> bool:
    return url.startswith(SLACK_PREFIX) and len(url) <= 500 and " " not in url


def clean_emails(emails: list[str] | None) -> list[str]:
    out = list(dict.fromkeys(e.strip().lower() for e in (emails or []) if e and e.strip()))
    bad = [e for e in out if not EMAIL_RE.match(e)]
    if bad:
        raise ValueError(f"Invalid email address: {bad[0]}")
    if len(out) > MAX_RECIPIENTS:
        raise ValueError(f"At most {MAX_RECIPIENTS} recipients")
    return out


def _record(run: AiCloseRun, channel: str, target: str, ok: bool, detail: str = "") -> dict[str, Any]:
    entry = {"at": datetime.now(timezone.utc).isoformat(), "channel": channel, "target": target, "ok": ok, "detail": detail}
    run.notified_json = [*(run.notified_json or []), entry][-50:]
    return entry


def _mask(url: str) -> str:
    return "Slack webhook …" + url[-6:]


def send_close_summary(db: Session, run: AiCloseRun, *, emails: list[str] | None = None, slack_webhook: str | None = None,
                       external: bool = True, slack_encrypted: bool = False) -> list[dict[str, Any]]:
    """In-app notification always; email and Slack when `external`. Never raises for delivery errors.
    With slack_encrypted the webhook is the stored (encrypted) value and is decrypted here."""
    s = summary(db, run)
    slack_error = None
    if slack_webhook and slack_encrypted:
        try:
            slack_webhook = secrets_box.decrypt(slack_webhook)
        except secrets_box.SecretUnreadable as exc:
            slack_webhook, slack_error = None, str(exc)
    deliveries = []
    severity = "critical" if s["status"] == "failed" else ("warning" if s["has_issues"] else "info")
    notification_service._upsert_notification(
        db, workspace_id=run.workspace_id, company_id=run.company_id, n_type="close_summary", severity=severity,
        title=f"Month-end close {run.period} (run #{run.id}): {s['status'].replace('_', ' ')}"[:200],
        body=f"{s['unresolved']} unresolved exception(s); {s['pending_approvals']} journal(s) awaiting approval.",
        link="/ai-cfo/executive-summary",
    )
    deliveries.append(_record(run, "in_app", "workspace", True))
    if external:
        recipients = emails or []
        if recipients:
            attachment = None
            try:
                attachment = render_pdf(build_report(db, run, "cfo_summary"))
            except ReportUnavailable:
                pass
            subject, text, html = _subject(s), _text(s), _html(s)
            for to in recipients:
                ok = notification_service.send_notification(
                    to, subject, text, html=html, attachment=attachment,
                    attachment_filename=f"cfo-executive-summary-{run.period}-run{run.id}.pdf")
                deliveries.append(_record(run, "email", to, ok, "" if ok else "Email not delivered (check RESEND_API_KEY or SMTP settings)"))
        if slack_error:
            deliveries.append(_record(run, "slack", "Slack webhook", False, slack_error + "; save the webhook again"))
        if slack_webhook:
            if not valid_slack_url(slack_webhook):
                deliveries.append(_record(run, "slack", "invalid webhook", False, "Not a Slack incoming-webhook URL"))
            else:
                try:
                    res = httpx.post(slack_webhook, json={"text": _text(s)}, timeout=15)
                    ok = res.status_code < 300
                    deliveries.append(_record(run, "slack", _mask(slack_webhook), ok, "" if ok else f"Slack returned {res.status_code}"))
                except Exception as exc:  # noqa: BLE001 - recorded, not raised
                    deliveries.append(_record(run, "slack", _mask(slack_webhook), False, type(exc).__name__))
    db.commit()
    return deliveries
