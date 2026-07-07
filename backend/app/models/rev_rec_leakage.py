"""IFRS 15 revenue leakage snapshots — monthly rollup from three-way match exceptions."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, DateTime, Float, Integer, JSON, String, UniqueConstraint

from app.core.database import Base


class RevRecLeakageSnapshot(Base):
    """Per-period revenue leakage rollup (mirrors gl_reconciliations / earnings_reviews snapshot pattern)."""

    __tablename__ = "rev_rec_leakage_snapshots"
    __table_args__ = (
        UniqueConstraint("workspace_id", "company_id", "period", name="uq_rev_rec_leakage_ws_co_period"),
    )

    id = Column(String(36), primary_key=True)
    workspace_id = Column(String(36), nullable=False, index=True)
    company_id = Column(String(36), nullable=True, index=True)
    period = Column(String(7), nullable=False, index=True)

    leakage_total = Column(Float, nullable=False, default=0)
    leakage_pct = Column(Float, nullable=False, default=0)
    expected_revenue_total = Column(Float, nullable=False, default=0)
    item_count = Column(Integer, nullable=False, default=0)

    prior_period = Column(String(7), nullable=True)
    prior_leakage_total = Column(Float, nullable=True)
    trend_amount = Column(Float, nullable=True)
    trend_direction = Column(String(16), nullable=True)

    items_json = Column(JSON, nullable=False, default=list)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
