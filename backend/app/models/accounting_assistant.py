"""Technical Accounting AI Assistant — per-user conversations and their messages."""

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.sql import func

from app.core.database import Base


class AccountingConversation(Base):
    __tablename__ = "accounting_conversations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(String(50), nullable=False, index=True)
    company_id = Column(String(50), nullable=False, index=True)
    user_email = Column(String(255), nullable=False, index=True)
    title = Column(String(200), nullable=True)
    jurisdiction = Column(String(16), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AccountingMessage(Base):
    __tablename__ = "accounting_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(
        Integer, ForeignKey("accounting_conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    workspace_id = Column(String(50), nullable=False, index=True)
    company_id = Column(String(50), nullable=False, index=True)
    role = Column(String(16), nullable=False)
    content = Column(Text, nullable=False)
    # Structured answer sections (JSON) once the model returns them; unused in phase 1.
    answer_json = Column(Text, nullable=True)
    requires_review = Column(Boolean, nullable=True, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
