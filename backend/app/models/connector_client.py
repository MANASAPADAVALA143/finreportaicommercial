"""
API credentials for unattended client scripts (Tally connector, etc.).
Store api_key_sha256 = SHA-256 hex digest of the plaintext key shared with the client.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text

from app.core.database import Base


class ConnectorClient(Base):
    __tablename__ = "connector_clients"

    id = Column(Integer, primary_key=True, autoincrement=True)
    entity_id = Column(String(128), unique=True, nullable=False, index=True)
    tenant_id = Column(String(64), nullable=False, default="default", index=True)
    api_key_sha256 = Column(String(64), nullable=False)
    label = Column(String(256), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
