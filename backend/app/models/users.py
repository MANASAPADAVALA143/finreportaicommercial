"""RBAC models: companies, users, audit_log."""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlalchemy import Boolean, Column, DateTime, Enum as SAEnum, ForeignKey, JSON, String

from app.core.database import Base


class UserRole(str, Enum):
    super_admin = "super_admin"
    cfo = "cfo"
    finance_manager = "finance_manager"
    accountant = "accountant"
    auditor = "auditor"


class Company(Base):
    __tablename__ = "rbac_companies"

    id = Column(String(36), primary_key=True)
    name = Column(String(256), nullable=False)
    plan = Column(String(32), nullable=False, default="starter")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class User(Base):
    __tablename__ = "rbac_users"

    id = Column(String(36), primary_key=True)
    company_id = Column(String(36), ForeignKey("rbac_companies.id"), nullable=False, index=True)
    name = Column(String(256), nullable=False)
    email = Column(String(256), nullable=False, unique=True, index=True)
    password_hash = Column(String(512), nullable=False)
    role = Column(SAEnum(UserRole), nullable=False, default=UserRole.accountant)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_login = Column(DateTime, nullable=True)


class AuditLog(Base):
    __tablename__ = "rbac_audit_log"

    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("rbac_users.id"), nullable=False, index=True)
    action = Column(String(128), nullable=False)
    module = Column(String(64), nullable=False)
    details = Column(JSON, nullable=False, default=dict)
    ip_address = Column(String(64), nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
