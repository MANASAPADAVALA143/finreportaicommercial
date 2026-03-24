"""
R2R stateful API — clients and journal history (MindBridge-style).
Uses SQLite only; no changes to existing DB or modules.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Any, Optional

from app.r2r.db import (
    init_db,
    create_client,
    list_clients,
    save_upload,
    get_client_history,
    get_client_uploads,
)

router = APIRouter(prefix="/api/r2r", tags=["r2r-history"])


class CreateClientRequest(BaseModel):
    name: str


class UploadRequest(BaseModel):
    client_id: str
    entries: List[Any]
    filename: Optional[str] = None


@router.on_event("startup")
def _ensure_db():
    init_db()


@router.get("/clients", response_model=List[dict])
def api_list_clients():
    """List all clients (for CA firm dropdown)."""
    return list_clients()


@router.post("/clients", response_model=dict)
def api_create_client(body: CreateClientRequest):
    """Create a new client. Returns { id, name, created_at }."""
    if not (body.name and body.name.strip()):
        raise HTTPException(status_code=400, detail="name is required")
    return create_client(body.name.strip())


@router.post("/upload", response_model=dict)
def api_upload(body: UploadRequest):
    """
    Save a batch of journal entries for a client.
    Appends to that client's history. Month 2+ uploads are scored against full history.
    Returns { upload_id, client_id, filename, uploaded_at, row_count }.
    """
    if not body.client_id:
        raise HTTPException(status_code=400, detail="client_id is required")
    if not body.entries:
        raise HTTPException(status_code=400, detail="entries array is required")
    return save_upload(body.client_id, body.entries, body.filename)


@router.get("/history")
def api_get_history(client_id: str):
    """
    Get full journal history for a client (all uploads, flattened).
    Frontend uses this to build baseline from all history and score current batch.
    """
    if not client_id:
        raise HTTPException(status_code=400, detail="client_id is required")
    entries = get_client_history(client_id)
    return {"client_id": client_id, "entries": entries, "total": len(entries)}


@router.get("/uploads")
def api_get_uploads(client_id: str):
    """List uploads for a client (metadata only)."""
    if not client_id:
        raise HTTPException(status_code=400, detail="client_id is required")
    return {"client_id": client_id, "uploads": get_client_uploads(client_id)}
