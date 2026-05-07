"""Audit Intelligence — persisted agent runs."""

from sqlalchemy import Column, DateTime, Integer, JSON, String, Text
from sqlalchemy.sql import func

from app.core.database import Base


class AuditRun(Base):
    __tablename__ = "audit_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    agent_type = Column(String(50), nullable=False, index=True)
    client_name = Column(String(100), nullable=True)
    file_name = Column(String(200), nullable=True)
    run_timestamp = Column(DateTime(timezone=True), server_default=func.now())
    result_summary = Column(Text, nullable=True)
    full_result = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
