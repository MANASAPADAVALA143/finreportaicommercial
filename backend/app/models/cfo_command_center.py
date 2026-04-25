"""CFO Command Center — agent runs, logs, outputs, briefings, alerts (separate from IFRS agent_runs)."""
from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.sqlite import JSON as SQLiteJSON
from sqlalchemy.orm import relationship
from sqlalchemy.types import JSON

from app.core.database import Base

_json = JSON().with_variant(SQLiteJSON(), "sqlite")


def _enum_str(e: type[enum.Enum]):
    from sqlalchemy import Enum as SAEnum

    return SAEnum(e, values_callable=lambda x: [i.value for i in x], native_enum=False)


class CFOAgentRunStatus(str, enum.Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    needs_review = "needs_review"


class CFOAlertSeverity(str, enum.Enum):
    info = "info"
    warning = "warning"
    urgent = "urgent"


class CFOAlertStatus(str, enum.Enum):
    open = "open"
    dismissed = "dismissed"


class CFOAgentRun(Base):
    __tablename__ = "cfo_agent_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(String(64), nullable=False, unique=True, index=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    agent_name = Column(String(64), nullable=False, index=True)
    status = Column(_enum_str(CFOAgentRunStatus), nullable=False, default=CFOAgentRunStatus.queued)
    context_json = Column(_json, nullable=True)
    error_message = Column(Text, nullable=True)
    retry_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    logs = relationship("CFOAgentLog", back_populates="run", cascade="all, delete-orphan")
    outputs = relationship("CFOAgentOutput", back_populates="run", cascade="all, delete-orphan")


class CFOAgentLog(Base):
    __tablename__ = "cfo_agent_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    cfo_agent_run_id = Column(Integer, ForeignKey("cfo_agent_runs.id"), nullable=False, index=True)
    level = Column(String(16), nullable=False, default="info")
    message = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    run = relationship("CFOAgentRun", back_populates="logs")


class CFOAgentOutput(Base):
    __tablename__ = "cfo_agent_outputs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    cfo_agent_run_id = Column(Integer, ForeignKey("cfo_agent_runs.id"), nullable=False, index=True)
    output_type = Column(String(64), nullable=False, default="primary")
    payload_json = Column(_json, nullable=False)
    validation_passed = Column(Boolean, nullable=False, default=False)
    validation_errors_json = Column(_json, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    run = relationship("CFOAgentRun", back_populates="outputs")


class CFOBriefing(Base):
    __tablename__ = "cfo_briefings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    briefing_date = Column(Date, nullable=False, index=True)
    content_json = Column(_json, nullable=False)
    raw_text = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class CFOAlert(Base):
    __tablename__ = "cfo_agent_alerts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    agent_name = Column(String(64), nullable=False, index=True)
    severity = Column(_enum_str(CFOAlertSeverity), nullable=False, default=CFOAlertSeverity.warning)
    title = Column(String(512), nullable=False)
    body = Column(Text, nullable=True)
    status = Column(_enum_str(CFOAlertStatus), nullable=False, default=CFOAlertStatus.open)
    cfo_agent_run_id = Column(Integer, ForeignKey("cfo_agent_runs.id"), nullable=True, index=True)
    meta_json = Column(_json, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
