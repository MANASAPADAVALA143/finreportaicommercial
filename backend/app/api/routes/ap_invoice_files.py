"""Original invoice files in the private `invoice-files` bucket, via the service role.

The browser stores files directly when it holds a Supabase session that storage RLS
accepts. Users signed in only through the RBAC backend have no such session, so the
frontend falls back to these endpoints. Objects live under `<company_id>/<prefix>/…`
and every call checks that the company belongs to the caller's workspace.
"""

from __future__ import annotations

import logging
import re
import secrets
import time
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.company_access import require_company_access, require_invoice_access
from app.core.database import get_db
from app.core.supabase import get_supabase
from app.middleware.workspace import WorkspaceContext, validate_workspace

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ap/invoice-files", tags=["AP Invoice Files"])

BUCKET = "invoice-files"
MAX_BYTES = 25 * 1024 * 1024
SIGNED_URL_TTL_SECONDS = 60 * 60

_PREFIX_RE = re.compile(r"^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$")


def _signed_url(path: str) -> str:
    res: Any = get_supabase().storage.from_(BUCKET).create_signed_url(path, SIGNED_URL_TTL_SECONDS)
    if isinstance(res, str):
        return res
    if isinstance(res, dict):
        url = res.get("signedURL") or res.get("signedUrl") or res.get("signed_url")
        if url:
            return str(url)
    raise RuntimeError("signed URL missing from storage response")


@router.post("/upload")
async def upload_invoice_file(
    file: UploadFile = File(...),
    company_id: str = Form(...),
    prefix: str = Form("uploads"),
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    company_id = company_id.strip()
    prefix = prefix.strip().strip("/") or "uploads"
    if not _PREFIX_RE.match(prefix):
        raise HTTPException(status_code=422, detail="Invalid prefix")
    require_company_access(db, ctx, company_id, "write")

    data = await file.read(MAX_BYTES + 1)
    if not data:
        raise HTTPException(status_code=422, detail="Empty file")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File larger than 25 MB")

    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", file.filename or "invoice")[-120:]
    path = f"{company_id}/{prefix}/{int(time.time() * 1000)}-{secrets.token_hex(4)}-{safe_name}"
    try:
        get_supabase().storage.from_(BUCKET).upload(
            path,
            data,
            {"content-type": file.content_type or "application/octet-stream", "upsert": "false"},
        )
    except Exception as exc:
        logger.warning("invoice-files: upload failed for company %s: %s", company_id, exc)
        raise HTTPException(status_code=502, detail="Storage upload failed") from exc
    return {"path": path}


class AttachBody(BaseModel):
    invoice_id: str
    path: str
    file_type: str | None = None


@router.post("/attach")
def attach_invoice_file(
    body: AttachBody,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Link an already-stored file to an invoice that was captured without one (e.g. Excel import)."""
    invoice_id = body.invoice_id.strip()
    path = body.path.strip().lstrip("/")
    if ".." in path.split("/") or "//" in path or "/" not in path:
        raise HTTPException(status_code=422, detail="Invalid path")

    company_id = require_invoice_access(db, ctx, [invoice_id], "write")[invoice_id]
    if path.split("/", 1)[0] != company_id:
        raise HTTPException(status_code=403, detail="File belongs to a different company")
    try:
        _signed_url(path)
    except Exception as exc:
        raise HTTPException(status_code=404, detail="File not found in storage") from exc

    file_type = (body.file_type or "").strip()[:100] or None
    res = (
        get_supabase()
        .table("invoices")
        .update({"file_url": path, "file_type": file_type})
        .eq("id", invoice_id)
        .eq("company_id", company_id)
        .execute()
    )
    if not (res.data or []):
        raise HTTPException(status_code=409, detail="Invoice was not updated")
    return {"path": path}


class SignedUrlBody(BaseModel):
    path: str


@router.post("/signed-url")
def invoice_file_signed_url(
    body: SignedUrlBody,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    path = body.path.strip().lstrip("/")
    if ".." in path.split("/"):
        raise HTTPException(status_code=422, detail="Invalid path")
    company_id = path.split("/", 1)[0]
    require_company_access(db, ctx, company_id, "read")
    try:
        return {"url": _signed_url(path)}
    except Exception as exc:
        logger.warning("invoice-files: signed URL failed for %s: %s", path, exc)
        raise HTTPException(status_code=404, detail="File not found") from exc
