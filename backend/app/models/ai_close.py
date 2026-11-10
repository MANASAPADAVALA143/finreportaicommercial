"""Multi-agent month-end close — runs, agent tasks, de-duplicated exceptions, journal proposals.

A run belongs to one workspace + company (uae_company_profiles.id) + month. A group run is
anchored on the company it was started from and covers the companies in entity_ids; each
exception and journal proposal records the entity it belongs to. Agent outputs
are validated snapshots of deterministic service results. Journal proposals point at real
uae_journal_entries rows created with status 'pending_approval'; they post only when a
manager approves them.
"""

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from app.core.database import Base


class AiCloseRun(Base):
    __tablename__ = "ai_close_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(String(50), nullable=False, index=True)
    company_id = Column(String(50), nullable=False, index=True)
    period = Column(String(7), nullable=False)
    scope = Column(String(10), nullable=True)  # entity | group (null = entity)
    entity_ids = Column(JSON, nullable=True)
    agents = Column(JSON, nullable=False)
    status = Column(String(32), nullable=False, default="queued")
    requested_by = Column(String(255), nullable=True)
    kpis_json = Column(JSON, nullable=True)
    freshness_json = Column(JSON, nullable=True)
    error = Column(Text, nullable=True)
    close_approved_by = Column(String(255), nullable=True)
    close_approved_at = Column(DateTime(timezone=True), nullable=True)
    close_note = Column(Text, nullable=True)
    trigger = Column(String(16), nullable=True)  # manual | scheduled | ask (null = manual)
    schedule_id = Column(Integer, nullable=True)
    ask_json = Column(JSON, nullable=True)  # ask runs: {agent, prompt, answer: {text, source, note}}
    notified_json = Column(JSON, nullable=True)  # [{at, channel, target, ok, detail}]
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)


class AiCloseSchedule(Base):
    """Recurring month-end close for one company (or a group anchored on it): on run_day at
    run_hour in `timezone`, close the previous month and send the summary to the recipients.
    last_run_period is claimed atomically so several app instances never run the same month twice.
    The Slack webhook is write-only through the API."""

    __tablename__ = "ai_close_schedules"
    __table_args__ = (UniqueConstraint("workspace_id", "company_id", name="uq_ai_close_schedule"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(String(50), nullable=False, index=True)
    company_id = Column(String(50), nullable=False, index=True)
    enabled = Column(Boolean, nullable=False, default=True)
    scope = Column(String(10), nullable=False, default="entity")
    entity_ids = Column(JSON, nullable=True)
    agents = Column(JSON, nullable=False)
    run_day = Column(Integer, nullable=False, default=2)
    run_hour = Column(Integer, nullable=False, default=6)
    timezone = Column(String(64), nullable=False, default="Asia/Dubai")
    notify_emails = Column(JSON, nullable=True)
    slack_webhook_url = Column(String(500), nullable=True)
    notify_when = Column(String(16), nullable=False, default="always")  # always | issues | never
    last_run_period = Column(String(7), nullable=True)
    last_run_id = Column(Integer, nullable=True)
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    created_by = Column(String(255), nullable=True)
    updated_by = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AiCloseTask(Base):
    __tablename__ = "ai_close_tasks"
    __table_args__ = (UniqueConstraint("run_id", "agent", name="uq_ai_close_task"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(Integer, ForeignKey("ai_close_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    workspace_id = Column(String(50), nullable=False, index=True)
    company_id = Column(String(50), nullable=False, index=True)
    agent = Column(String(40), nullable=False)
    title = Column(String(200), nullable=False)
    depends_on = Column(JSON, nullable=True)
    wave = Column(Integer, nullable=False, default=0)
    status = Column(String(32), nullable=False, default="pending")
    attempts = Column(Integer, nullable=False, default=0)
    records_processed = Column(Integer, nullable=True)
    exceptions_count = Column(Integer, nullable=True)
    output_json = Column(JSON, nullable=True)
    validation_json = Column(JSON, nullable=True)
    messages_json = Column(JSON, nullable=True)
    error = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    duration_ms = Column(Integer, nullable=True)


class AiCloseException(Base):
    """One unique issue per run; the fingerprint stops two agents reporting the same item twice."""

    __tablename__ = "ai_close_exceptions"
    __table_args__ = (UniqueConstraint("run_id", "fingerprint", name="uq_ai_close_exception"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(Integer, ForeignKey("ai_close_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    task_id = Column(Integer, ForeignKey("ai_close_tasks.id", ondelete="CASCADE"), nullable=True)
    workspace_id = Column(String(50), nullable=False, index=True)
    company_id = Column(String(50), nullable=False, index=True)
    agent = Column(String(40), nullable=False)
    entity_id = Column(String(50), nullable=True)
    fingerprint = Column(String(200), nullable=False)
    category = Column(String(40), nullable=False)
    severity = Column(String(16), nullable=False)
    title = Column(String(300), nullable=False)
    detail = Column(Text, nullable=True)
    amount = Column(Float, nullable=True)
    source_refs = Column(JSON, nullable=True)
    status = Column(String(16), nullable=False, default="open")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AiCloseJournalProposal(Base):
    __tablename__ = "ai_close_journal_proposals"

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(Integer, ForeignKey("ai_close_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    task_id = Column(Integer, ForeignKey("ai_close_tasks.id", ondelete="SET NULL"), nullable=True)
    workspace_id = Column(String(50), nullable=False, index=True)
    company_id = Column(String(50), nullable=False, index=True)
    agent = Column(String(40), nullable=False)
    fingerprint = Column(String(200), nullable=False, index=True)
    journal_entry_id = Column(String(36), nullable=False, index=True)
    entry_number = Column(String(30), nullable=True)
    title = Column(String(300), nullable=False)
    rationale = Column(Text, nullable=False)
    amount = Column(Float, nullable=True)
    source_refs = Column(JSON, nullable=True)
    status = Column(String(24), nullable=False, default="pending_approval")
    prepared_by = Column(String(100), nullable=False)
    requested_by = Column(String(255), nullable=True)
    decided_by = Column(String(255), nullable=True)
    decided_at = Column(DateTime(timezone=True), nullable=True)
    decision_note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
