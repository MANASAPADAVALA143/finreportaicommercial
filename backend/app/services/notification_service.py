"""Workspace notifications — email delivery, in-app scan, list, mark read."""
from __future__ import annotations

import base64
import logging
import os
import smtplib
from datetime import date, datetime
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.models.company_setup import AccountingPeriod, WorkspaceUserRole
from app.models.uae_accounting_full import UAEJournalEntry, UAESalesInvoice
from app.models.users import User
from app.models.workspace_notification import WorkspaceNotification

logger = logging.getLogger(__name__)


def send_notification(
    to_email: str,
    subject: str,
    body: str,
    *,
    attachment: bytes | None = None,
    attachment_filename: str = "attachment.pdf",
) -> bool:
    """Send email via Resend or SMTP. Never raises — logs and returns False on failure."""
    if not to_email:
        return False

    from_addr = os.getenv("FROM_EMAIL", os.getenv("RESEND_FROM", os.getenv("SMTP_FROM", "noreply@finreportai.com")))

    resend_key = os.getenv("RESEND_API_KEY", "")
    if resend_key:
        try:
            payload: dict[str, Any] = {
                "from": from_addr,
                "to": [to_email],
                "subject": subject,
                "text": body,
            }
            if attachment:
                payload["attachments"] = [{
                    "filename": attachment_filename,
                    "content": base64.b64encode(attachment).decode("ascii"),
                }]
            with httpx.Client(timeout=30) as client:
                r = client.post(
                    "https://api.resend.com/emails",
                    headers={
                        "Authorization": f"Bearer {resend_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
            if r.status_code < 300:
                return True
            logger.warning("Resend notification failed: %s", r.text)
        except Exception:
            logger.exception("Resend notification error")
        return False

    smtp_host = os.getenv("SMTP_HOST", "")
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_pass = os.getenv("SMTP_PASS") or os.getenv("SMTP_PASSWORD", "")
    if smtp_host and smtp_user and smtp_pass:
        try:
            msg: MIMEMultipart | MIMEText
            if attachment:
                msg = MIMEMultipart()
                msg.attach(MIMEText(body))
                part = MIMEApplication(attachment, Name=attachment_filename)
                part.add_header("Content-Disposition", "attachment", filename=attachment_filename)
                msg.attach(part)
            else:
                msg = MIMEText(body)
            msg["Subject"] = subject
            msg["From"] = os.getenv("SMTP_FROM", smtp_user)
            msg["To"] = to_email
            with smtplib.SMTP(smtp_host, int(os.getenv("SMTP_PORT", "587"))) as server:
                server.starttls()
                server.login(smtp_user, smtp_pass)
                server.send_message(msg)
            return True
        except Exception:
            logger.exception("SMTP notification error")
        return False

    logger.info("[NOTIFICATION - not configured] To: %s | %s", to_email, subject)
    return False


def get_workspace_role_email(
    db: Session,
    workspace_id: str,
    roles: list[str],
) -> str | None:
    row = (
        db.query(User.email)
        .join(WorkspaceUserRole, WorkspaceUserRole.user_id == User.id)
        .filter(
            WorkspaceUserRole.workspace_id == workspace_id,
            WorkspaceUserRole.role.in_(roles),
            User.is_active == True,  # noqa: E712
        )
        .first()
    )
    return row[0] if row else None


def _dedupe_key(n_type: str, title: str) -> str:
    return f"{n_type}:{title}"


def _upsert_notification(
    db: Session,
    *,
    workspace_id: str,
    company_id: str | None,
    n_type: str,
    severity: str,
    title: str,
    body: str,
    link: str | None,
) -> WorkspaceNotification | None:
    existing = (
        db.query(WorkspaceNotification)
        .filter_by(workspace_id=workspace_id, type=n_type, title=title, is_read=False)
        .first()
    )
    if existing:
        existing.body = body
        existing.severity = severity
        existing.link = link
        db.add(existing)
        return existing

    n = WorkspaceNotification(
        workspace_id=workspace_id,
        company_id=company_id,
        type=n_type,
        severity=severity,
        title=title,
        body=body,
        link=link,
    )
    db.add(n)
    return n


def scan_notifications(
    db: Session,
    workspace_id: str,
    company_id: str | None = None,
) -> int:
    """Scan AR / JE / period-close and create in-app notifications. Returns count created/updated."""
    today = date.today()
    count = 0

    inv_q = db.query(UAESalesInvoice).filter(
        UAESalesInvoice.tenant_id == workspace_id,
        UAESalesInvoice.status.in_(["sent", "overdue", "partial"]),
    )
    if company_id:
        inv_q = inv_q.filter(UAESalesInvoice.company_id == company_id)
    for inv in inv_q.all():
        due = inv.due_date
        if not due or due >= today:
            continue
        days = (today - due).days
        cust = inv.customer.name if inv.customer else "Customer"
        title = f"Overdue AR: {inv.invoice_number}"
        body = f"{cust} — AED {float(inv.outstanding or inv.total_amount or 0):,.2f} overdue by {days} days."
        _upsert_notification(
            db, workspace_id=workspace_id, company_id=inv.company_id,
            n_type="ar_overdue", severity="warning" if days <= 30 else "critical",
            title=title, body=body, link="/uae-full/ar",
        )
        count += 1

    je_q = db.query(UAEJournalEntry).filter(
        UAEJournalEntry.tenant_id == workspace_id,
        UAEJournalEntry.status == "pending_approval",
    )
    if company_id:
        je_q = je_q.filter(UAEJournalEntry.company_id == company_id)
    for je in je_q.all():
        total = sum(float(l.debit or 0) for l in je.lines)
        title = f"JE pending approval: {je.entry_number or je.id[:8]}"
        body = f"{je.description or 'Journal entry'} — AED {total:,.2f}"
        _upsert_notification(
            db, workspace_id=workspace_id, company_id=je.company_id,
            n_type="je_approval", severity="warning",
            title=title, body=body, link="/uae-full/controls",
        )
        count += 1

    period_q = db.query(AccountingPeriod).filter_by(workspace_id=workspace_id, status="open")
    if company_id:
        period_q = period_q.filter_by(company_id=company_id)
    for p in period_q.all():
        if not p.end_date:
            continue
        days_left = (p.end_date - today).days
        if 0 <= days_left <= 7:
            title = f"Period close due: {p.period_name}"
            body = f"Accounting period ends in {days_left} day(s) — {p.end_date.isoformat()}."
            _upsert_notification(
                db, workspace_id=workspace_id, company_id=p.company_id,
                n_type="period_close", severity="info",
                title=title, body=body, link="/uae-full/period-close",
            )
            count += 1

    db.commit()
    return count


def list_notifications(
    db: Session,
    workspace_id: str,
    *,
    unread_only: bool = False,
    limit: int = 50,
) -> list[dict[str, Any]]:
    q = db.query(WorkspaceNotification).filter_by(workspace_id=workspace_id)
    if unread_only:
        q = q.filter(WorkspaceNotification.is_read == False)  # noqa: E712
    rows = q.order_by(WorkspaceNotification.created_at.desc()).limit(limit).all()
    return [
        {
            "id": n.id,
            "type": n.type,
            "severity": n.severity,
            "title": n.title,
            "body": n.body,
            "link": n.link,
            "is_read": n.is_read,
            "company_id": n.company_id,
            "created_at": n.created_at.isoformat() if n.created_at else None,
        }
        for n in rows
    ]


def mark_read(db: Session, workspace_id: str, notification_id: str) -> bool:
    n = (
        db.query(WorkspaceNotification)
        .filter_by(id=notification_id, workspace_id=workspace_id)
        .first()
    )
    if not n:
        return False
    n.is_read = True
    db.commit()
    return True


def mark_all_read(db: Session, workspace_id: str) -> int:
    rows = db.query(WorkspaceNotification).filter_by(workspace_id=workspace_id, is_read=False).all()
    for n in rows:
        n.is_read = True
    db.commit()
    return len(rows)
