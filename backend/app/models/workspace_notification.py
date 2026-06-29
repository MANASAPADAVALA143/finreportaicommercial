"""In-app notifications per workspace."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, String, Text

from app.core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class WorkspaceNotification(Base):
    __tablename__ = "workspace_notifications"

    id = Column(String(36), primary_key=True, default=_uuid)
    workspace_id = Column(String(36), nullable=False, index=True)
    company_id = Column(String(36), nullable=True, index=True)
    type = Column(String(50), nullable=False)  # ar_overdue | je_approval | period_close
    severity = Column(String(20), default="info")  # info | warning | critical
    title = Column(String(200), nullable=False)
    body = Column(Text, nullable=True)
    link = Column(String(300), nullable=True)
    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
