"""Google Drive upload for AP invoice Excel exports.

Auth: a service account (no per-user OAuth prompt). Configure via
GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON — the full service-account key JSON as a
single env var string (EC2/container friendly — no file to mount). The
target Drive folder must be shared with the service account's email
(Editor access) or uploads will 403.

Behaviour: if a file with the same name already exists in the target
folder, its content is overwritten in place (so re-running the export the
same day replaces today's file instead of piling up duplicates); otherwise
a new file is created.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import service_account

DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"]
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

_FOLDER_ID_PATTERNS = [
    re.compile(r"/folders/([a-zA-Z0-9_-]+)"),
    re.compile(r"[?&]id=([a-zA-Z0-9_-]+)"),
]
_BARE_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{10,}$")


class DriveNotConfigured(RuntimeError):
    """Raised when GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON isn't set."""


def extract_folder_id(folder_url_or_id: str) -> str | None:
    """Pull a Drive folder ID out of a full folder URL, or pass through a bare ID."""
    value = (folder_url_or_id or "").strip()
    if not value:
        return None
    for pattern in _FOLDER_ID_PATTERNS:
        m = pattern.search(value)
        if m:
            return m.group(1)
    if _BARE_ID_RE.match(value):
        return value
    return None


def _load_credentials() -> service_account.Credentials:
    raw = os.getenv("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON", "").strip()
    if not raw:
        raise DriveNotConfigured("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is not set")
    info = json.loads(raw)
    return service_account.Credentials.from_service_account_info(info, scopes=DRIVE_SCOPES)


def _access_token() -> str:
    creds = _load_credentials()
    creds.refresh(GoogleAuthRequest())
    return creds.token


def _find_existing_file_id(*, token: str, folder_id: str, filename: str) -> str | None:
    escaped_name = filename.replace("'", "\\'")
    query = f"name = '{escaped_name}' and '{folder_id}' in parents and trashed = false"
    resp = httpx.get(
        "https://www.googleapis.com/drive/v3/files",
        headers={"Authorization": f"Bearer {token}"},
        params={"q": query, "fields": "files(id,name)", "pageSize": 1},
        timeout=15,
    )
    resp.raise_for_status()
    files = resp.json().get("files") or []
    return files[0]["id"] if files else None


def _create_file(*, token: str, folder_id: str, filename: str, content: bytes, mime_type: str) -> str:
    boundary = "gnanova-drive-upload"
    metadata = json.dumps({"name": filename, "parents": [folder_id]})
    body = (
        f"--{boundary}\r\n"
        f"Content-Type: application/json; charset=UTF-8\r\n\r\n"
        f"{metadata}\r\n"
        f"--{boundary}\r\n"
        f"Content-Type: {mime_type}\r\n\r\n"
    ).encode("utf-8") + content + f"\r\n--{boundary}--".encode("utf-8")

    resp = httpx.post(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/related; boundary={boundary}",
        },
        content=body,
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["id"]


def _overwrite_file(*, token: str, file_id: str, content: bytes, mime_type: str) -> str:
    resp = httpx.patch(
        f"https://www.googleapis.com/upload/drive/v3/files/{file_id}?uploadType=media",
        headers={"Authorization": f"Bearer {token}", "Content-Type": mime_type},
        content=content,
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["id"]


def upload_excel_to_drive(*, folder_url_or_id: str, filename: str, content: bytes) -> dict[str, Any]:
    """Find-or-create + overwrite an Excel file in the given Drive folder.

    Returns {"file_id": str, "url": str, "overwritten": bool}.
    Raises DriveNotConfigured, ValueError (bad folder ref), or httpx.HTTPStatusError.
    """
    folder_id = extract_folder_id(folder_url_or_id)
    if not folder_id:
        raise ValueError("Could not parse a Google Drive folder ID from the configured URL")

    token = _access_token()
    existing_id = _find_existing_file_id(token=token, folder_id=folder_id, filename=filename)

    if existing_id:
        file_id = _overwrite_file(token=token, file_id=existing_id, content=content, mime_type=XLSX_MIME)
        overwritten = True
    else:
        file_id = _create_file(token=token, folder_id=folder_id, filename=filename, content=content, mime_type=XLSX_MIME)
        overwritten = False

    return {"file_id": file_id, "url": f"https://drive.google.com/file/d/{file_id}/view", "overwritten": overwritten}
