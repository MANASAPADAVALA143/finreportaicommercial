"""
R2R stateful API — clients and journal history (MindBridge-style).
Clients are registered per workspace in Postgres; journal history rows live in the R2R SQLite file.
"""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import List, Any, Optional

from app.core.company_access import require_workspace_level
from app.core.database import get_db
from app.core.r2r_scope import owned_client_id
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.r2r_learning import R2RClient
from app.r2r.db import (
    init_db,
    save_upload,
    get_client_history,
    get_client_uploads,
)

router = APIRouter(prefix="/api/r2r", tags=["r2r-history"], dependencies=[Depends(validate_workspace)])


class CreateClientRequest(BaseModel):
    name: str


class UploadRequest(BaseModel):
    client_id: str
    entries: List[Any]
    filename: Optional[str] = None


@router.on_event("startup")
def _ensure_db():
    init_db()


def _client_out(c: R2RClient) -> dict:
    created = c.created_at.isoformat() + "Z" if c.created_at else None
    return {"id": c.id, "name": c.name, "created_at": created}


@router.get("/clients", response_model=List[dict])
def api_list_clients(ctx: WorkspaceContext = Depends(validate_workspace), db: Session = Depends(get_db)):
    """List this workspace's clients (for CA firm dropdown)."""
    require_workspace_level(db, ctx, "read")
    rows = (
        db.query(R2RClient)
        .filter(R2RClient.workspace_id == ctx.workspace_id)
        .order_by(R2RClient.created_at.desc())
        .all()
    )
    return [_client_out(c) for c in rows]


@router.post("/clients", response_model=dict)
def api_create_client(
    body: CreateClientRequest,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
):
    """Create a new client in the caller's workspace. Returns { id, name, created_at }."""
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    require_workspace_level(db, ctx, "write")
    client_id = uuid.uuid4().hex[:12]
    while db.get(R2RClient, client_id) is not None:
        client_id = uuid.uuid4().hex[:12]
    client = R2RClient(id=client_id, workspace_id=ctx.workspace_id, name=name[:255], created_at=datetime.utcnow())
    db.add(client)
    db.commit()
    db.refresh(client)
    return _client_out(client)


@router.post("/upload", response_model=dict)
def api_upload(
    body: UploadRequest,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
):
    """
    Save a batch of journal entries for a client.
    Appends to that client's history. Month 2+ uploads are scored against full history.
    Returns { upload_id, client_id, filename, uploaded_at, row_count }.
    """
    client_id = owned_client_id(db, ctx, body.client_id, "write")
    if not body.entries:
        raise HTTPException(status_code=400, detail="entries array is required")
    return save_upload(client_id, body.entries, body.filename)


@router.get("/history")
def api_get_history(
    client_id: str,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
):
    """
    Get full journal history for a client (all uploads, flattened).
    Frontend uses this to build baseline from all history and score current batch.
    """
    client_id = owned_client_id(db, ctx, client_id, "read")
    entries = get_client_history(client_id)
    return {"client_id": client_id, "entries": entries, "total": len(entries)}


@router.get("/uploads")
def api_get_uploads(
    client_id: str,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
):
    """List uploads for a client (metadata only)."""
    client_id = owned_client_id(db, ctx, client_id, "read")
    return {"client_id": client_id, "uploads": get_client_uploads(client_id)}
