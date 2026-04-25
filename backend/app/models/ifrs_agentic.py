"""Multi-agent IFRS run persistence (additive; does not alter Week 1/2 tables)."""
from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.sqlite import JSON as SQLiteJSON
from sqlalchemy.orm import relationship
from sqlalchemy.types import JSON

from app.core.database import Base

_json = JSON().with_variant(SQLiteJSON(), "sqlite")


class AgentRunStatus(str, enum.Enum):
    started = "started"
    running = "running"
    paused = "paused"
    completed = "completed"
    failed = "failed"


def _enum_str(e: type[enum.Enum]):
    from sqlalchemy import Enum as SAEnum

    return SAEnum(e, values_callable=lambda x: [i.value for i in x], native_enum=False)


class AgentRun(Base):
    __tablename__ = "agent_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(String(64), nullable=False, unique=True, index=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    trial_balance_id = Column(Integer, ForeignKey("trial_balances.id"), nullable=False, index=True)
    prior_trial_balance_id = Column(Integer, ForeignKey("trial_balances.id"), nullable=True, index=True)
    manual_prior_json = Column(_json, nullable=True)
    status = Column(_enum_str(AgentRunStatus), nullable=False, default=AgentRunStatus.started)
    progress_pct = Column(Float, nullable=False, default=0.0)
    current_agent = Column(String(32), nullable=True)
    agents_completed = Column(_json, nullable=True)
    output = Column(_json, nullable=True)
    pause_reason = Column(String(64), nullable=True)
    resume_from_agent = Column(String(32), nullable=True)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    logs = relationship("AgentRunLog", back_populates="run", cascade="all, delete-orphan")
    validations = relationship("AgentValidation", back_populates="run", cascade="all, delete-orphan")
    human_reviews = relationship("AgentHumanReview", back_populates="run", cascade="all, delete-orphan")


class AgentRunLog(Base):
    __tablename__ = "agent_run_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    agent_run_id = Column(Integer, ForeignKey("agent_runs.id"), nullable=False, index=True)
    agent_id = Column(String(32), nullable=False, index=True)
    message = Column(Text, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    run = relationship("AgentRun", back_populates="logs")


class AgentValidation(Base):
    __tablename__ = "agent_validation"

    id = Column(Integer, primary_key=True, autoincrement=True)
    agent_run_id = Column(Integer, ForeignKey("agent_runs.id"), nullable=False, index=True)
    check_name = Column(String(128), nullable=False)
    passed = Column(Boolean, nullable=False, default=False)
    error = Column(Text, nullable=True)

    run = relationship("AgentRun", back_populates="validations")


class HumanReviewStatus(str, enum.Enum):
    pending = "pending"
    resolved = "resolved"


class AgentHumanReview(Base):
    __tablename__ = "agent_human_reviews"

    id = Column(Integer, primary_key=True, autoincrement=True)
    agent_run_id = Column(Integer, ForeignKey("agent_runs.id"), nullable=False, index=True)
    item = Column(Text, nullable=False)
    status = Column(_enum_str(HumanReviewStatus), nullable=False, default=HumanReviewStatus.pending)
    resolution = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    run = relationship("AgentRun", back_populates="human_reviews")
