"""GL vs bank vs subledger reconciliation persistence."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, DateTime, Float, JSON, String

from app.core.database import Base


class GLReconciliation(Base):
    __tablename__ = "gl_reconciliations"

    recon_id = Column(String(40), primary_key=True)
    entity_id = Column(String(128), nullable=False, index=True)
    period = Column(String(32), nullable=False, index=True)
    account_code = Column(String(64), nullable=False, index=True)
    account_name = Column(String(256), nullable=True)
    currency = Column(String(8), nullable=False, default="INR")
    company_name = Column(String(256), nullable=True)
    status = Column(String(24), nullable=False, default="started")
    summary_json = Column(JSON, nullable=False, default=dict)
    matches_json = Column(JSON, nullable=False, default=list)
    unmatched_gl = Column(JSON, nullable=False, default=list)
    unmatched_bank = Column(JSON, nullable=False, default=list)
    suggested_jes = Column(JSON, nullable=False, default=list)
    audit_trail = Column(JSON, nullable=False, default=list)
    total_seconds = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    approved_by = Column(String(256), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    snapshot_json = Column(JSON, nullable=False, default=dict)
