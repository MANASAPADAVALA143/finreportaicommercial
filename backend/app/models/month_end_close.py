"""Month-end close run persistence (IFRS-focused close checklist)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, DateTime, Float, JSON, String

from app.core.database import Base


class CloseRun(Base):
    __tablename__ = "close_runs"

    run_id = Column(String(64), primary_key=True)
    entity_id = Column(String(128), nullable=False, index=True)
    period = Column(String(32), nullable=False, index=True)
    company_name = Column(String(256), nullable=True)
    currency = Column(String(8), nullable=False, default="INR")
    status = Column(String(32), nullable=False, default="started")
    checks_json = Column(JSON, nullable=False, default=dict)
    snapshot_json = Column(JSON, nullable=False, default=dict)
    audit_trail = Column(JSON, nullable=False, default=list)
    total_seconds = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    approved_by = Column(String(256), nullable=True)
    approved_at = Column(DateTime, nullable=True)
