"""R2R client learning loop — profiles, human feedback, and learning events."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.sqlite import JSON as SQLiteJSON
from app.core.database import Base


class ClientProfile(Base):
    __tablename__ = "client_profiles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(String(128), nullable=False, unique=True, index=True)
    client_name = Column(String(512), nullable=False, default="")
    industry = Column(String(256), nullable=True)
    fiscal_year_end = Column(String(64), nullable=True)
    months_of_data = Column(Integer, nullable=False, default=0)

    account_baselines = Column(SQLiteJSON, nullable=True)
    user_baselines = Column(SQLiteJSON, nullable=True)
    vendor_baselines = Column(SQLiteJSON, nullable=True)
    timing_baselines = Column(SQLiteJSON, nullable=True)

    amount_threshold_multiplier = Column(Float, nullable=False, default=2.0)
    weekend_penalty_score = Column(Float, nullable=False, default=15.0)
    round_number_penalty = Column(Float, nullable=False, default=10.0)
    new_vendor_penalty = Column(Float, nullable=False, default=12.0)

    total_entries_analysed = Column(Integer, nullable=False, default=0)
    total_flagged = Column(Integer, nullable=False, default=0)
    total_approved = Column(Integer, nullable=False, default=0)
    total_rejected = Column(Integer, nullable=False, default=0)
    false_positive_rate = Column(Float, nullable=True)

    learning_status = Column(String(32), nullable=False, default="initialising")

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class JournalEntryFeedback(Base):
    __tablename__ = "journal_entry_feedback"

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(String(128), ForeignKey("client_profiles.client_id"), nullable=False, index=True)

    entry_id = Column(String(256), nullable=False, index=True)
    gl_account = Column(String(512), nullable=False, default="")
    amount = Column(Float, nullable=False, default=0.0)
    posted_by = Column(String(256), nullable=False, default="")
    posting_date = Column(DateTime, nullable=True)
    description = Column(Text, nullable=True)

    original_risk_score = Column(Float, nullable=False, default=0.0)
    original_risk_level = Column(String(32), nullable=False, default="")
    original_risk_reasons = Column(SQLiteJSON, nullable=True)

    feedback = Column(String(32), nullable=False)
    feedback_comment = Column(Text, nullable=True)
    reviewed_by = Column(String(256), nullable=False, default="")
    reviewed_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    threshold_adjusted = Column(Boolean, nullable=False, default=False)
    adjustment_note = Column(Text, nullable=True)


class LearningEvent(Base):
    __tablename__ = "learning_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(String(128), ForeignKey("client_profiles.client_id"), nullable=False, index=True)

    event_type = Column(String(64), nullable=False)
    description = Column(Text, nullable=False, default="")
    old_value = Column(String(512), nullable=True)
    new_value = Column(String(512), nullable=True)
    triggered_by_feedback_id = Column(Integer, ForeignKey("journal_entry_feedback.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
