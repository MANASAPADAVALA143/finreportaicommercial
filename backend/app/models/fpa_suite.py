"""FP&A Suite extended modules — persisted analysis snapshots."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, Text

from app.core.database import Base


class FpaAnalysisResult(Base):
    __tablename__ = "fpa_analysis_results"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(128), nullable=True, index=True)
    module = Column(String(64), nullable=False, index=True)
    result_json = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
