"""Group CFO intelligence storage.

The workspace is the group. These tables record ownership, intercompany match
results and frozen KPI snapshots. They do not copy ledgers, FX rates or eliminations.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Column, Date, DateTime, ForeignKey, Index, Numeric, String, Text
from sqlalchemy.types import JSON

from app.core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class GroupEntityOwnership(Base):
    """Ownership of a legal entity. Absent row means wholly owned; NCI is not inferred."""

    __tablename__ = "group_entity_ownership"
    __table_args__ = (
        Index("ix_group_ownership_ws_company", "workspace_id", "company_id"),
    )

    id = Column(String(36), primary_key=True, default=_uuid)
    workspace_id = Column(String(36), ForeignKey("workspaces.id"), nullable=False, index=True)
    company_id = Column(String(36), ForeignKey("uae_company_profiles.id"), nullable=False, index=True)
    owner_company_id = Column(String(36), ForeignKey("uae_company_profiles.id"), nullable=True, index=True)
    ownership_percent = Column(Numeric(7, 4), nullable=False)
    effective_from = Column(Date, nullable=False)
    effective_to = Column(Date, nullable=True)
    created_by = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class GroupFinancialSnapshot(Base):
    """Frozen group figures for one workspace, period, currency and entity set."""

    __tablename__ = "group_financial_snapshots"
    __table_args__ = (
        Index("ix_group_snapshot_ws_period", "workspace_id", "period"),
    )

    id = Column(String(36), primary_key=True, default=_uuid)
    workspace_id = Column(String(36), ForeignKey("workspaces.id"), nullable=False, index=True)
    period = Column(String(7), nullable=False)
    reporting_currency = Column(String(3), nullable=False)
    company_set_key = Column(String(64), nullable=False, index=True)
    company_ids = Column(JSON, nullable=False)
    status = Column(String(20), nullable=False)
    kpis = Column(JSON, nullable=False)
    methodology = Column(JSON, nullable=False)
    limitations = Column(JSON, nullable=True)
    created_by = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class GroupIntercompanyMatch(Base):
    """One intercompany reference as matched by the existing consolidation agent."""

    __tablename__ = "group_intercompany_matches"
    __table_args__ = (
        Index("ix_group_ic_ws_period", "workspace_id", "period"),
        Index("ix_group_ic_snapshot", "snapshot_id"),
    )

    id = Column(String(36), primary_key=True, default=_uuid)
    workspace_id = Column(String(36), ForeignKey("workspaces.id"), nullable=False, index=True)
    snapshot_id = Column(String(36), ForeignKey("group_financial_snapshots.id"), nullable=False)
    period = Column(String(7), nullable=False)
    reporting_currency = Column(String(3), nullable=False)
    reference = Column(String(100), nullable=False)
    seller_company_id = Column(String(36), nullable=True)
    buyer_company_id = Column(String(36), nullable=True)
    seller_name = Column(String(256), nullable=True)
    buyer_name = Column(String(256), nullable=True)
    seller_amount = Column(Numeric(18, 2), nullable=True)
    buyer_amount = Column(Numeric(18, 2), nullable=True)
    eliminated_amount = Column(Numeric(18, 2), nullable=True)
    difference = Column(Numeric(18, 2), nullable=True)
    status = Column(String(32), nullable=False)
    source_refs = Column(JSON, nullable=True)
    methodology = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
