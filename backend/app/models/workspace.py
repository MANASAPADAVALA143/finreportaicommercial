"""Multi-tenant workspace models — one workspace = one legal entity / company."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)

from app.core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class WorkspaceRole(str, enum.Enum):
    owner = "owner"
    finance_manager = "finance_manager"
    accountant = "accountant"
    auditor = "auditor"
    viewer = "viewer"


class Workspace(Base):
    """A workspace represents one client company / legal entity."""

    __tablename__ = "workspaces"

    id = Column(String(36), primary_key=True, default=_uuid)
    name = Column(String(256), nullable=False)
    legal_entity_name = Column(String(256), nullable=False)
    trn_number = Column(String(20), nullable=True)
    country = Column(String(64), nullable=False, default="UAE")
    currency = Column(String(3), nullable=False, default="AED")
    fiscal_year_start_month = Column(Integer, nullable=False, default=1)  # 1=Jan
    fiscal_year_end_month = Column(Integer, nullable=False, default=12)
    industry = Column(String(128), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class WorkspaceMember(Base):
    """Maps users to workspaces with workspace-specific roles."""

    __tablename__ = "workspace_members"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id", name="uq_workspace_user"),)

    id = Column(String(36), primary_key=True, default=_uuid)
    workspace_id = Column(String(36), ForeignKey("workspaces.id"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("rbac_users.id"), nullable=False, index=True)
    role = Column(SAEnum(WorkspaceRole), nullable=False, default=WorkspaceRole.accountant)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class WorkspaceVATSettings(Base):
    """Default VAT configuration per workspace."""

    __tablename__ = "workspace_vat_settings"

    id = Column(String(36), primary_key=True, default=_uuid)
    workspace_id = Column(String(36), ForeignKey("workspaces.id"), nullable=False, unique=True)
    entity_type = Column(String(32), default="mainland")  # mainland | free_zone | designated_zone
    vat_registered = Column(Boolean, default=True)
    standard_rate = Column(String(10), default="5")
    filing_frequency = Column(String(20), default="quarterly")
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
