"""Workspace audit log helper."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models.workspace_audit import WorkspaceAuditLog


def log_audit(
    db: Session,
    *,
    workspace_id: str,
    company_id: str | None,
    action: str,
    entity_type: str,
    entity_id: str | None,
    user_email: str | None = None,
    details: dict[str, Any] | None = None,
) -> WorkspaceAuditLog:
    entry = WorkspaceAuditLog(
        workspace_id=workspace_id,
        company_id=company_id,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id else None,
        user_email=user_email,
        details=details or {},
    )
    db.add(entry)
    db.flush()
    return entry
