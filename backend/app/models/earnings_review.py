"""Earnings release / management accounts review persistence."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, DateTime, Float, JSON, String

from app.core.database import Base


class EarningsReview(Base):
    __tablename__ = "earnings_reviews"

    review_id = Column(String(40), primary_key=True)
    entity_id = Column(String(128), nullable=False, index=True)
    period = Column(String(64), nullable=False, index=True)
    period_type = Column(String(16), nullable=False, default="quarterly")
    currency = Column(String(8), nullable=False, default="INR")
    company_name = Column(String(256), nullable=True)
    status = Column(String(24), nullable=False, default="started")
    variances_json = Column(JSON, nullable=False, default=dict)
    commentary_json = Column(JSON, nullable=False, default=dict)
    quality_score = Column(Float, nullable=True)
    flags_json = Column(JSON, nullable=False, default=list)
    headline_verdict = Column(String(32), nullable=True)
    total_seconds = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    approved_by = Column(String(256), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    snapshot_json = Column(JSON, nullable=False, default=dict)
