"""Evidence files for Internal Audit workpapers, in the private `audit-workpapers` bucket.

Only the backend touches the bucket (service role), so objects need no storage RLS
policies. Paths are `<workspace_id>/<company_id>/<procedure_id>/<unique>-<name>` and are
never sent to the browser; downloads go through short-lived signed URLs.
"""
from __future__ import annotations

import re
import secrets
import time
from pathlib import PurePath
from typing import Any

from app.core.supabase import get_supabase

BUCKET = "audit-workpapers"
MAX_BYTES = 20 * 1024 * 1024
SIGNED_URL_TTL_SECONDS = 60 * 60

# Stored content type comes from the extension, never from the browser's claim.
CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}
_SIGNATURES = {
    ".pdf": (b"%PDF",),
    ".png": (b"\x89PNG\r\n\x1a\n",),
    ".jpg": (b"\xff\xd8\xff",),
    ".jpeg": (b"\xff\xd8\xff",),
    ".xlsx": (b"PK\x03\x04",),
    ".docx": (b"PK\x03\x04",),
    ".xls": (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",),
}


class EvidenceRejected(ValueError):
    pass


def check_file(filename: str, data: bytes) -> tuple[str, str]:
    """Return (display name, content type) or raise EvidenceRejected."""
    name = PurePath((filename or "").replace("\\", "/")).name.strip()[:255] or "file"
    ext = PurePath(name).suffix.lower()
    if ext not in CONTENT_TYPES:
        raise EvidenceRejected("Allowed file types: PDF, Excel, CSV, Word, PNG, JPG, TXT")
    if not data:
        raise EvidenceRejected("File is empty")
    if len(data) > MAX_BYTES:
        raise EvidenceRejected("File is larger than 20 MB")
    signatures = _SIGNATURES.get(ext)
    if signatures and not data.startswith(signatures):
        raise EvidenceRejected(f"File content does not match its {ext} extension")
    if signatures is None and b"\x00" in data[:8192]:
        raise EvidenceRejected(f"File content does not look like {ext} text")
    return name, CONTENT_TYPES[ext]


def object_path(workspace_id: str, company_id: str, procedure_id: int, name: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", name)[-120:]
    return f"{workspace_id}/{company_id}/{procedure_id}/{int(time.time() * 1000)}-{secrets.token_hex(4)}-{safe}"


def upload(path: str, data: bytes, content_type: str) -> None:
    get_supabase().storage.from_(BUCKET).upload(path, data, {"content-type": content_type, "upsert": "false"})


def signed_url(path: str, download_name: str) -> str:
    res: Any = get_supabase().storage.from_(BUCKET).create_signed_url(
        path, SIGNED_URL_TTL_SECONDS, {"download": download_name}
    )
    if isinstance(res, str):
        return res
    if isinstance(res, dict):
        url = res.get("signedURL") or res.get("signedUrl") or res.get("signed_url")
        if url:
            return str(url)
    raise RuntimeError("signed URL missing from storage response")


def remove(paths: list[str]) -> None:
    if paths:
        get_supabase().storage.from_(BUCKET).remove(paths)
