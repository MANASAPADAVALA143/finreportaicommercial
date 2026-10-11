"""Internal Audit — audit universe, engagements and findings (IIA lifecycle)."""

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.sql import func

from app.core.database import Base


class AuditUniverse(Base):
    __tablename__ = "audit_universe"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(String(50), nullable=True, index=True)
    company_id = Column(String(50), nullable=True, index=True)
    unit_name = Column(String(200), nullable=False)
    department = Column(String(100), nullable=True)
    process_owner = Column(String(100), nullable=True)
    inherent_risk = Column(String(20), nullable=True)
    control_effectiveness = Column(String(20), nullable=True)
    residual_risk = Column(String(20), nullable=True)
    audit_frequency = Column(String(20), nullable=True)
    last_audited = Column(String(20), nullable=True)
    next_planned = Column(String(20), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class AuditEngagement(Base):
    __tablename__ = "audit_engagements"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(String(50), nullable=True, index=True)
    company_id = Column(String(50), nullable=True, index=True)
    engagement_ref = Column(String(30), nullable=True)
    title = Column(String(300), nullable=False)
    audit_unit = Column(String(200), nullable=True)
    scope = Column(Text, nullable=True)
    objectives = Column(Text, nullable=True)
    lead_auditor = Column(String(100), nullable=True)
    team_members = Column(JSON, nullable=True)
    status = Column(String(20), nullable=False, default="Planning")
    planned_start = Column(String(20), nullable=True)
    planned_end = Column(String(20), nullable=True)
    actual_start = Column(String(20), nullable=True)
    actual_end = Column(String(20), nullable=True)
    budget_hours = Column(Float, nullable=True)
    actual_hours = Column(Float, nullable=True)
    risk_rating = Column(String(20), nullable=True)
    findings_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class AuditFinding(Base):
    __tablename__ = "audit_findings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(String(50), nullable=True, index=True)
    company_id = Column(String(50), nullable=True, index=True)
    engagement_id = Column(Integer, ForeignKey("audit_engagements.id", ondelete="SET NULL"), nullable=True)
    finding_ref = Column(String(30), nullable=True)
    title = Column(String(300), nullable=False)
    description = Column(Text, nullable=True)
    risk_rating = Column(String(20), nullable=False, default="Medium")
    root_cause = Column(String(100), nullable=True)
    control_gap = Column(Text, nullable=True)
    recommendation = Column(Text, nullable=True)
    management_response = Column(Text, nullable=True)
    action_owner = Column(String(100), nullable=True)
    action_due_date = Column(String(20), nullable=True)
    status = Column(String(20), nullable=False, default="Open")
    is_repeat = Column(Boolean, default=False)
    repeat_from_year = Column(String(10), nullable=True)
    evidence_ref = Column(String(200), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
