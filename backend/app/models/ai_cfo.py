"""AI CFO agentic layer — findings, agent investigations, tool-call audit trail, approvals.

Every row is scoped to a workspace and a company (uae_company_profiles.id). Figures in
`metrics_json` / `result_json` come from deterministic ledger queries; the model only
explains them. Approval requests record a decision; nothing is executed automatically.
"""

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from app.core.database import Base


class AiCfoFinding(Base):
    """A deterministic detection result (spike, budget overrun, duplicate) awaiting review."""

    __tablename__ = "ai_cfo_findings"
    __table_args__ = (UniqueConstraint("workspace_id", "company_id", "fingerprint", name="uq_ai_cfo_finding"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(String(50), nullable=False, index=True)
    company_id = Column(String(50), nullable=False, index=True)
    fingerprint = Column(String(200), nullable=False)
    kind = Column(String(32), nullable=False)
    period = Column(String(7), nullable=False)
    account_code = Column(String(20), nullable=True)
    account_name = Column(String(200), nullable=True)
    title = Column(String(300), nullable=False)
    detection_reason = Column(Text, nullable=False)
    severity = Column(String(16), nullable=False)
    amount = Column(Float, nullable=True)
    metrics_json = Column(JSON, nullable=True)
    evidence_refs = Column(JSON, nullable=True)
    status = Column(String(16), nullable=False, default="open")
    status_note = Column(Text, nullable=True)
    detected_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AiCfoInvestigation(Base):
    """One agent run: investigating a finding or answering a CFO question."""

    __tablename__ = "ai_cfo_investigations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(String(50), nullable=False, index=True)
    company_id = Column(String(50), nullable=False, index=True)
    finding_id = Column(Integer, ForeignKey("ai_cfo_findings.id", ondelete="SET NULL"), nullable=True, index=True)
    agent = Column(String(40), nullable=False)
    question = Column(Text, nullable=False)
    status = Column(String(16), nullable=False, default="queued")
    result_json = Column(JSON, nullable=True)
    answer_markdown = Column(Text, nullable=True)
    unverified_refs = Column(JSON, nullable=True)
    error = Column(Text, nullable=True)
    model = Column(String(64), nullable=True)
    steps = Column(Integer, nullable=False, default=0)
    requested_by = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)


class AiCfoToolCall(Base):
    """Audit trail of every tool an agent executed, with its inputs and a result summary."""

    __tablename__ = "ai_cfo_tool_calls"

    id = Column(Integer, primary_key=True, autoincrement=True)
    investigation_id = Column(
        Integer, ForeignKey("ai_cfo_investigations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    workspace_id = Column(String(50), nullable=False, index=True)
    company_id = Column(String(50), nullable=False, index=True)
    step = Column(Integer, nullable=False)
    tool_name = Column(String(64), nullable=False)
    action_class = Column(String(16), nullable=False)
    input_json = Column(JSON, nullable=True)
    output_summary = Column(Text, nullable=True)
    refs = Column(JSON, nullable=True)
    is_error = Column(Integer, nullable=False, default=0)
    duration_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AiCfoApprovalRequest(Base):
    """An action an agent prepared; a manager approves or rejects it. Approval does not execute."""

    __tablename__ = "ai_cfo_approval_requests"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(String(50), nullable=False, index=True)
    company_id = Column(String(50), nullable=False, index=True)
    investigation_id = Column(
        Integer, ForeignKey("ai_cfo_investigations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    finding_id = Column(Integer, ForeignKey("ai_cfo_findings.id", ondelete="SET NULL"), nullable=True, index=True)
    action_type = Column(String(40), nullable=False)
    title = Column(String(300), nullable=False)
    rationale = Column(Text, nullable=False)
    payload_json = Column(JSON, nullable=True)
    amount = Column(Float, nullable=True)
    status = Column(String(16), nullable=False, default="pending")
    requested_by = Column(String(255), nullable=True)
    decided_by = Column(String(255), nullable=True)
    decision_note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    decided_at = Column(DateTime(timezone=True), nullable=True)
