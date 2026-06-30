"""Company onboarding & multi-company setup models."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint

from app.core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class UaeCompanyProfile(Base):
    __tablename__ = "uae_company_profiles"

    id = Column(String(36), primary_key=True, default=_uuid)
    workspace_id = Column(String(36), ForeignKey("workspaces.id"), nullable=False, index=True)
    company_name = Column(String(256), nullable=False)
    trade_name = Column(String(256), nullable=True)
    legal_type = Column(String(64), nullable=True)  # LLC / FZE / Branch / Sole Proprietor / Other
    trn = Column(String(20), nullable=True)
    license_number = Column(String(64), nullable=True)
    license_authority = Column(String(128), nullable=True)
    base_currency = Column(String(3), nullable=False, default="AED")
    reporting_standard = Column(String(32), nullable=False, default="IFRS")
    financial_year_start = Column(Integer, nullable=False, default=1)  # month 1-12
    industry = Column(String(64), nullable=True)
    address = Column(Text, nullable=True)
    phone = Column(String(32), nullable=True)
    email = Column(String(200), nullable=True)
    website = Column(String(256), nullable=True)
    logo_url = Column(String(512), nullable=True)
    status = Column(String(20), nullable=False, default="setup")  # setup | active
    setup_step = Column(Integer, nullable=False, default=1)
    coa_option = Column(String(20), nullable=True)  # default | csv | blank
    opening_balance_date = Column(Date, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class AccountingPeriod(Base):
    __tablename__ = "accounting_periods"
    __table_args__ = (UniqueConstraint("workspace_id", "company_id", "period_number", name="uq_period"),)

    id = Column(String(36), primary_key=True, default=_uuid)
    workspace_id = Column(String(36), ForeignKey("workspaces.id"), nullable=False, index=True)
    company_id = Column(String(36), ForeignKey("uae_company_profiles.id"), nullable=True, index=True)
    period_number = Column(Integer, nullable=False)
    period_name = Column(String(32), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    status = Column(String(20), nullable=False, default="open")  # open | closed | locked
    locked_by = Column(String(36), nullable=True)
    locked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class AccountingControls(Base):
    __tablename__ = "accounting_controls"

    id = Column(String(36), primary_key=True, default=_uuid)
    workspace_id = Column(String(36), ForeignKey("workspaces.id"), nullable=False, unique=True)
    company_id = Column(String(36), ForeignKey("uae_company_profiles.id"), nullable=True)
    je_approval_threshold_aed = Column(Numeric(15, 2), nullable=True)
    allow_backdating = Column(Boolean, nullable=False, default=True)
    max_backdate_days = Column(Integer, nullable=False, default=30)
    require_docs_account_ids = Column(Text, nullable=True)  # JSON array of account codes
    dual_approval_account_ids = Column(Text, nullable=True)  # JSON array of account codes
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class WorkspaceUserRole(Base):
    __tablename__ = "workspace_user_roles"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id", "module", name="uq_ws_user_module"),)

    id = Column(String(36), primary_key=True, default=_uuid)
    workspace_id = Column(String(36), ForeignKey("workspaces.id"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("rbac_users.id"), nullable=False, index=True)
    module = Column(String(64), nullable=False)  # ap | ar | journals | cfo | viewer
    role = Column(String(64), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class ConsolidationElimination(Base):
    __tablename__ = "consolidation_eliminations"

    id = Column(String(36), primary_key=True, default=_uuid)
    workspace_id = Column(String(36), ForeignKey("workspaces.id"), nullable=False, index=True)
    period_id = Column(String(36), ForeignKey("accounting_periods.id"), nullable=False, index=True)
    account_category = Column(String(64), nullable=False)
    company_from_id = Column(String(36), ForeignKey("uae_company_profiles.id"), nullable=True)
    company_to_id = Column(String(36), ForeignKey("uae_company_profiles.id"), nullable=True)
    amount = Column(Numeric(15, 2), nullable=False, default=0)
    note = Column(Text, nullable=True)
    created_by = Column(String(36), ForeignKey("rbac_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
