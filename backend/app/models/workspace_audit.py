"""Workspace-level audit log for UAE accounting controls."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, JSON, String

from app.core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class WorkspaceAuditLog(Base):
    __tablename__ = "workspace_audit_log"

    id = Column(String(36), primary_key=True, default=_uuid)
    workspace_id = Column(String(100), nullable=False, index=True)
    company_id = Column(String(100), nullable=True, index=True)
    action = Column(String(50), nullable=False, index=True)
    entity_type = Column(String(50), nullable=False)
    entity_id = Column(String(100), nullable=True)
    user_email = Column(String(200), nullable=True)
    details = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
