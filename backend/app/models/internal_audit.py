"""Internal Audit — audit universe, engagements and findings (IIA lifecycle)."""

from sqlalchemy import BigInteger, Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, JSON, String, Text
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
    # Startup reconciliation adds new columns as nullable without defaults; NULL means "none".
    escalation_level = Column(String(32), nullable=True, default="none")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class AuditFindingFollowup(Base):
    """One contact with the action owner about an overdue corrective action."""

    __tablename__ = "audit_finding_followups"

    id = Column(Integer, primary_key=True, autoincrement=True)
    finding_id = Column(Integer, ForeignKey("audit_findings.id", ondelete="CASCADE"), nullable=False, index=True)
    workspace_id = Column(String(50), nullable=False, index=True)
    company_id = Column(String(50), nullable=False, index=True)
    contacted_at = Column(Date, nullable=False)
    contacted_person = Column(String(200), nullable=True)
    response_notes = Column(Text, nullable=True)
    logged_by = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AuditFindingDueDateRevision(Base):
    """Append-only record of each agreed change to a finding's action due date."""

    __tablename__ = "audit_finding_due_date_revisions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    finding_id = Column(Integer, ForeignKey("audit_findings.id", ondelete="CASCADE"), nullable=False, index=True)
    workspace_id = Column(String(50), nullable=False, index=True)
    company_id = Column(String(50), nullable=False, index=True)
    original_due_date = Column(String(20), nullable=True)
    revised_due_date = Column(String(20), nullable=False)
    reason = Column(Text, nullable=False)
    revised_by = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AuditWorkpaperProcedure(Base):
    """One audit procedure in an engagement's workpaper checklist."""

    __tablename__ = "audit_workpaper_procedures"

    id = Column(Integer, primary_key=True, autoincrement=True)
    engagement_id = Column(Integer, ForeignKey("audit_engagements.id", ondelete="CASCADE"), nullable=False, index=True)
    workspace_id = Column(String(50), nullable=False, index=True)
    company_id = Column(String(50), nullable=False, index=True)
    title = Column(String(300), nullable=False)
    description = Column(Text, nullable=True)
    assigned_to = Column(String(100), nullable=True)
    status = Column(String(20), nullable=False, default="not_started")
    notes = Column(Text, nullable=True)
    completed_by = Column(String(255), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class AuditWorkpaperEvidence(Base):
    """An evidence file attached to a workpaper procedure; the bytes live in Supabase Storage."""

    __tablename__ = "audit_workpaper_evidence"

    id = Column(Integer, primary_key=True, autoincrement=True)
    procedure_id = Column(
        Integer, ForeignKey("audit_workpaper_procedures.id", ondelete="CASCADE"), nullable=False, index=True
    )
    workspace_id = Column(String(50), nullable=False, index=True)
    company_id = Column(String(50), nullable=False, index=True)
    file_name = Column(String(255), nullable=False)
    storage_path = Column(String(500), nullable=False)
    file_size = Column(BigInteger, nullable=True)
    content_type = Column(String(100), nullable=True)
    uploaded_by = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
