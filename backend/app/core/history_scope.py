"""Authorization + storage key for JE history, baselines, narratives and feedback.

Those tables are keyed by a free-form `company_id` string. Callers send one of:
  * a company UUID            -> must pass the normal company access check
  * the active workspace UUID -> workspace-level data (JE posting sync)
  * a free-text label         -> stored under the caller's workspace so other
                                 workspaces can never read or reset it
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.company_access import AccessLevel, UUID_RE, require_company_access, require_workspace_level
from app.middleware.workspace import WorkspaceContext

MAX_LABEL_LENGTH = 60


def history_key(db: Session, ctx: WorkspaceContext, company_id: str | None, level: AccessLevel) -> str:
    raw = (company_id or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="company_id is required.")
    if raw == ctx.workspace_id:
        require_workspace_level(db, ctx, level)
        return raw
    if UUID_RE.match(raw):
        return require_company_access(db, ctx, raw, level)
    if len(raw) > MAX_LABEL_LENGTH:
        raise HTTPException(status_code=422, detail=f"company_id label longer than {MAX_LABEL_LENGTH} characters")
    require_workspace_level(db, ctx, level)
    return f"ws:{ctx.workspace_id}:{raw}"
