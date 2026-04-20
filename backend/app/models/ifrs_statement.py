"""
Week 1 — IFRS Trial Balance & GL mapping (SQLAlchemy).
"""
from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.sqlite import JSON as SQLiteJSON
from sqlalchemy.orm import relationship
from sqlalchemy.types import JSON

from app.core.database import Base


# PostgreSQL-compatible enums stored as VARCHAR (SQLite-friendly)
class TBStatus(str, enum.Enum):
    uploaded = "uploaded"
    mapping_in_progress = "mapping_in_progress"
    mapped = "mapped"
    statements_generated = "statements_generated"


class AccountTypeEnum(str, enum.Enum):
    asset = "asset"
    liability = "liability"
    equity = "equity"
    revenue = "revenue"
    expense = "expense"


class IFRSStatementKind(str, enum.Enum):
    financial_position = "financial_position"
    profit_loss = "profit_loss"
    cash_flows = "cash_flows"
    equity = "equity"
    other_comprehensive_income = "other_comprehensive_income"


class MappingSourceEnum(str, enum.Enum):
    ai_suggested = "ai_suggested"
    user_confirmed = "user_confirmed"
    user_overridden = "user_overridden"
    tally_suggested = "tally_suggested"


def _enum_str(e: type[enum.Enum]) -> SAEnum:
    return SAEnum(e, values_callable=lambda x: [i.value for i in x], native_enum=False)


_json_type = JSON().with_variant(SQLiteJSON(), "sqlite")


class DisclosureNoteStatus(str, enum.Enum):
    not_started = "not_started"
    ai_generating = "ai_generating"
    ai_draft = "ai_draft"
    user_editing = "user_editing"
    complete = "complete"


class ComplianceResultEnum(str, enum.Enum):
    pass_ = "pass"
    fail = "fail"
    warning = "warning"
    not_applicable = "not_applicable"


class ComplianceSeverityEnum(str, enum.Enum):
    critical = "critical"
    major = "major"
    minor = "minor"


class TrialBalance(Base):
    __tablename__ = "trial_balances"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    company_name = Column(String(512), nullable=False)
    period_start = Column(Date, nullable=True)
    period_end = Column(Date, nullable=True)
    currency = Column(String(8), nullable=False, default="USD")
    uploaded_by = Column(String(256), nullable=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    status = Column(_enum_str(TBStatus), nullable=False, default=TBStatus.uploaded)
    file_name = Column(String(512), nullable=False)
    file_path = Column(String(1024), nullable=True)

    lines = relationship("TrialBalanceLine", back_populates="trial_balance", cascade="all, delete-orphan")
    gl_mappings = relationship("GLMapping", back_populates="trial_balance", viewonly=True)
    generated_statements = relationship(
        "GeneratedStatement",
        back_populates="trial_balance",
        cascade="all, delete-orphan",
    )
    disclosure_notes = relationship(
        "DisclosureNote",
        back_populates="trial_balance",
        cascade="all, delete-orphan",
    )
    compliance_checks = relationship(
        "ComplianceCheck",
        back_populates="trial_balance",
        cascade="all, delete-orphan",
    )
    statement_commentaries = relationship(
        "StatementCommentary",
        back_populates="trial_balance",
        cascade="all, delete-orphan",
    )
    risk_flags = relationship(
        "RiskFlag",
        back_populates="trial_balance",
        cascade="all, delete-orphan",
    )
    board_packs = relationship(
        "BoardPack",
        back_populates="trial_balance",
        cascade="all, delete-orphan",
    )


class TrialBalanceLine(Base):
    __tablename__ = "trial_balance_lines"

    id = Column(Integer, primary_key=True, autoincrement=True)
    trial_balance_id = Column(Integer, ForeignKey("trial_balances.id"), nullable=False, index=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    gl_code = Column(String(64), nullable=False)
    gl_description = Column(String(512), nullable=False)
    debit_amount = Column(Float, nullable=False, default=0.0)
    credit_amount = Column(Float, nullable=False, default=0.0)
    net_amount = Column(Float, nullable=False, default=0.0)
    account_type = Column(_enum_str(AccountTypeEnum), nullable=False, default=AccountTypeEnum.asset)

    trial_balance = relationship("TrialBalance", back_populates="lines")
    mappings = relationship(
        "GLMapping", back_populates="trial_balance_line", cascade="all, delete-orphan"
    )
    ifrs_links = relationship(
        "IFRSLink", back_populates="trial_balance_line", cascade="all, delete-orphan"
    )


class GLMapping(Base):
    __tablename__ = "gl_mappings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    company_id = Column(String(128), nullable=True, index=True)
    trial_balance_id = Column(Integer, ForeignKey("trial_balances.id"), nullable=False, index=True)
    trial_balance_line_id = Column(Integer, ForeignKey("trial_balance_lines.id"), nullable=False, index=True)
    gl_code = Column(String(64), nullable=False)
    gl_description = Column(String(512), nullable=False)
    ifrs_statement = Column(_enum_str(IFRSStatementKind), nullable=False)
    ifrs_line_item = Column(String(512), nullable=False)
    ifrs_section = Column(String(512), nullable=False)
    ifrs_sub_section = Column(String(512), nullable=True)
    mapping_source = Column(_enum_str(MappingSourceEnum), nullable=False, default=MappingSourceEnum.ai_suggested)
    ai_confidence_score = Column(Float, nullable=False, default=0.0)
    ai_reasoning = Column(Text, nullable=True)
    is_confirmed = Column(Boolean, nullable=False, default=False)
    confirmed_by = Column(String(256), nullable=True)
    confirmed_at = Column(DateTime, nullable=True)
    needs_review = Column(Boolean, nullable=False, default=False)
    # CFO AI Harness — deterministic validator (separate from mapping LLM)
    validator_checked = Column(Boolean, nullable=False, default=False)
    validator_passed = Column(Boolean, nullable=False, default=False)
    validator_issues = Column(_json_type, nullable=True)
    validator_score = Column(Float, nullable=True)
    is_contra = Column(Boolean, nullable=False, default=False)
    locked = Column(Boolean, nullable=False, default=False)

    trial_balance = relationship("TrialBalance", back_populates="gl_mappings")
    trial_balance_line = relationship("TrialBalanceLine", back_populates="mappings")


class MappingTemplate(Base):
    __tablename__ = "mapping_templates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    template_name = Column(String(256), nullable=False)
    industry = Column(String(128), nullable=True)
    is_default = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    # Serialised GL → IFRS rows for reuse (Week 1 save-template)
    entries = Column(_json_type, nullable=True)


class GeneratedStatement(Base):
    __tablename__ = "generated_statements"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    trial_balance_id = Column(Integer, ForeignKey("trial_balances.id"), nullable=False, index=True)
    statement_type = Column(_enum_str(IFRSStatementKind), nullable=False, index=True)
    period_start = Column(Date, nullable=True)
    period_end = Column(Date, nullable=True)
    currency = Column(String(8), nullable=False, default="USD")
    status = Column(String(32), nullable=False, default="draft")
    generated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    generated_by_ai = Column(Boolean, nullable=False, default=True)
    reviewed = Column(Boolean, nullable=False, default=False)

    trial_balance = relationship("TrialBalance", back_populates="generated_statements")
    line_items = relationship(
        "StatementLineItem",
        back_populates="statement",
        cascade="all, delete-orphan",
        order_by="StatementLineItem.display_order",
    )


class StatementLineItem(Base):
    __tablename__ = "statement_line_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    statement_id = Column(Integer, ForeignKey("generated_statements.id"), nullable=False, index=True)
    ifrs_section = Column(String(256), nullable=False)
    ifrs_sub_section = Column(String(256), nullable=True)
    ifrs_line_item = Column(String(512), nullable=False)
    amount = Column(Numeric(18, 2), nullable=False, default=0)
    is_calculated = Column(Boolean, nullable=False, default=False)
    is_subtotal = Column(Boolean, nullable=False, default=False)
    is_total = Column(Boolean, nullable=False, default=False)
    is_manual_override = Column(Boolean, nullable=False, default=False)
    display_order = Column(Integer, nullable=False, default=0)
    indent_level = Column(Integer, nullable=False, default=0)

    statement = relationship("GeneratedStatement", back_populates="line_items")
    ifrs_links = relationship("IFRSLink", back_populates="statement_line_item")


class IFRSLineItemMaster(Base):
    __tablename__ = "ifrs_line_item_master"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(512), nullable=False, index=True)
    statement = Column(String(128), nullable=False, index=True)
    section = Column(String(256), nullable=False)
    sub_section = Column(String(256), nullable=True)
    standard = Column(String(128), nullable=True)
    is_calculated = Column(Boolean, nullable=False, default=False)
    display_order = Column(Integer, nullable=False, default=0)


class IFRSLink(Base):
    __tablename__ = "ifrs_links"

    id = Column(Integer, primary_key=True, autoincrement=True)
    trial_balance_line_id = Column(Integer, ForeignKey("trial_balance_lines.id"), nullable=False, index=True)
    statement_line_item_id = Column(Integer, ForeignKey("statement_line_items.id"), nullable=False, index=True)
    statement_type = Column(String(64), nullable=False)
    amount_contribution = Column(Numeric(18, 2), nullable=False, default=0)

    trial_balance_line = relationship("TrialBalanceLine", back_populates="ifrs_links")
    statement_line_item = relationship("StatementLineItem", back_populates="ifrs_links")


class DisclosureNote(Base):
    __tablename__ = "disclosure_notes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    trial_balance_id = Column(Integer, ForeignKey("trial_balances.id"), nullable=False, index=True)
    note_number = Column(Integer, nullable=False)
    note_code = Column(String(8), nullable=False)
    note_title = Column(String(512), nullable=False)
    status = Column(_enum_str(DisclosureNoteStatus), nullable=False, default=DisclosureNoteStatus.not_started)
    ai_generated_content = Column(Text, nullable=True)
    user_edited_content = Column(Text, nullable=True)
    is_user_edited = Column(Boolean, nullable=False, default=False)
    word_count = Column(Integer, nullable=False, default=0)
    generated_at = Column(DateTime, nullable=True)
    edited_at = Column(DateTime, nullable=True)
    edited_by = Column(String(256), nullable=True)

    trial_balance = relationship("TrialBalance", back_populates="disclosure_notes")
    sections = relationship(
        "DisclosureSection",
        back_populates="note",
        cascade="all, delete-orphan",
        order_by="DisclosureSection.display_order",
    )


class DisclosureSection(Base):
    __tablename__ = "disclosure_sections"

    id = Column(Integer, primary_key=True, autoincrement=True)
    note_id = Column(Integer, ForeignKey("disclosure_notes.id", ondelete="CASCADE"), nullable=False, index=True)
    section_title = Column(String(512), nullable=False)
    content = Column(Text, nullable=True)
    display_order = Column(Integer, nullable=False, default=0)
    is_table = Column(Boolean, nullable=False, default=False)
    table_data = Column(_json_type, nullable=True)

    note = relationship("DisclosureNote", back_populates="sections")


class ComplianceCheck(Base):
    __tablename__ = "compliance_checks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    trial_balance_id = Column(Integer, ForeignKey("trial_balances.id"), nullable=False, index=True)
    check_code = Column(String(32), nullable=False, index=True)
    check_description = Column(String(1024), nullable=False)
    standard = Column(String(128), nullable=False)
    result = Column(_enum_str(ComplianceResultEnum), nullable=False)
    severity = Column(_enum_str(ComplianceSeverityEnum), nullable=False)
    details = Column(Text, nullable=True)
    recommendation = Column(Text, nullable=True)
    checked_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    trial_balance = relationship("TrialBalance", back_populates="compliance_checks")


class ErpType(str, enum.Enum):
    tally = "tally"
    quickbooks = "quickbooks"
    zoho = "zoho"
    sap = "sap"
    oracle = "oracle"
    other = "other"


class ErpConnectionStatus(str, enum.Enum):
    not_tested = "not_tested"
    connected = "connected"
    disconnected = "disconnected"
    error = "error"


class TallySyncType(str, enum.Enum):
    trial_balance = "trial_balance"
    ledger_groups = "ledger_groups"
    vouchers = "vouchers"
    masters = "masters"


class TallySyncStatus(str, enum.Enum):
    started = "started"
    completed = "completed"
    failed = "failed"


class ERPConnection(Base):
    __tablename__ = "erp_connections"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    entity_id = Column(String(128), nullable=True, index=True)
    erp_type = Column(_enum_str(ErpType), nullable=False, default=ErpType.tally)
    connection_name = Column(String(512), nullable=False)
    tally_host = Column(String(256), nullable=False, default="localhost")
    tally_port = Column(Integer, nullable=False, default=9000)
    tally_company_name = Column(String(512), nullable=False, default="")
    tally_version = Column(String(128), nullable=True)
    status = Column(_enum_str(ErpConnectionStatus), nullable=False, default=ErpConnectionStatus.not_tested)
    last_connected_at = Column(DateTime, nullable=True)
    last_sync_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)
    default_currency = Column(String(8), nullable=False, default="INR")
    fiscal_year_start = Column(String(32), nullable=False, default="April")
    auto_sync = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    sync_logs = relationship("TallySyncLog", back_populates="connection")


class TallySyncLog(Base):
    __tablename__ = "tally_sync_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), nullable=False, default="default", index=True)
    connection_id = Column(Integer, ForeignKey("erp_connections.id"), nullable=True, index=True)
    sync_type = Column(_enum_str(TallySyncType), nullable=False, default=TallySyncType.trial_balance)
    period_from = Column(Date, nullable=True)
    period_to = Column(Date, nullable=True)
    company_name = Column(String(512), nullable=True)
    rows_imported = Column(Integer, nullable=False, default=0)
    status = Column(_enum_str(TallySyncStatus), nullable=False, default=TallySyncStatus.started)
    error_message = Column(Text, nullable=True)
    trial_balance_id = Column(Integer, ForeignKey("trial_balances.id"), nullable=True, index=True)
    started_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime, nullable=True)

    connection = relationship("ERPConnection", back_populates="sync_logs")


class BoardPackStatus(str, enum.Enum):
    generating = "generating"
    draft = "draft"
    reviewed = "reviewed"
    final = "final"


class StatementCommentary(Base):
    """AI / management commentary snippets used in board pack and disclosures."""

    __tablename__ = "statement_commentaries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    trial_balance_id = Column(Integer, ForeignKey("trial_balances.id"), nullable=False, index=True)
    commentary_type = Column(String(64), nullable=False, index=True)
    content = Column(Text, nullable=False)
    edited_content = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    trial_balance = relationship("TrialBalance", back_populates="statement_commentaries")


class RiskFlag(Base):
    """Material risk highlights for board pack risk dashboard."""

    __tablename__ = "risk_flags"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    trial_balance_id = Column(Integer, ForeignKey("trial_balances.id"), nullable=False, index=True)
    severity = Column(String(16), nullable=False, index=True)
    title = Column(String(512), nullable=False)
    metric_name = Column(String(256), nullable=True)
    metric_value = Column(String(256), nullable=True)
    recommendation = Column(Text, nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    trial_balance = relationship("TrialBalance", back_populates="risk_flags")


class BoardPack(Base):
    __tablename__ = "board_packs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    trial_balance_id = Column(Integer, ForeignKey("trial_balances.id"), nullable=False, index=True)
    company_name = Column(String(512), nullable=False)
    period_end = Column(Date, nullable=True)
    currency = Column(String(8), nullable=False, default="USD")
    status = Column(_enum_str(BoardPackStatus), nullable=False, default=BoardPackStatus.draft)
    pdf_path = Column(String(2048), nullable=False)
    public_token = Column(String(64), nullable=False, unique=True, index=True)
    watermark = Column(String(32), nullable=False, default="DRAFT")
    generated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    reviewed_by = Column(String(256), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    shared_at = Column(DateTime, nullable=True)
    view_count = Column(Integer, nullable=False, default=0)

    trial_balance = relationship("TrialBalance", back_populates="board_packs")
