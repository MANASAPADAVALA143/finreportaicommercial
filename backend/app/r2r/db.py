"""
R2R SQLite DB — zero setup, file-based.
Stores journal history per client so baseline is learned from full history.
"""
import os
import sqlite3
import json
import uuid
from datetime import datetime
from typing import List, Optional, Any
from contextlib import contextmanager

# DB file next to this module (backend/app/r2r/r2r.db)
_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("R2R_DB_PATH", os.path.join(_DIR, "r2r.db"))


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    """Create tables if they don't exist. Safe to call on every startup."""
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS clients (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS journal_uploads (
                id TEXT PRIMARY KEY,
                client_id TEXT NOT NULL,
                filename TEXT,
                uploaded_at TEXT NOT NULL,
                row_count INTEGER NOT NULL,
                FOREIGN KEY (client_id) REFERENCES clients(id)
            );
            CREATE TABLE IF NOT EXISTS journal_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                upload_id TEXT NOT NULL,
                row_index INTEGER NOT NULL,
                data TEXT NOT NULL,
                FOREIGN KEY (upload_id) REFERENCES journal_uploads(id)
            );
            CREATE INDEX IF NOT EXISTS idx_uploads_client ON journal_uploads(client_id);
            CREATE INDEX IF NOT EXISTS idx_entries_upload ON journal_entries(upload_id);
        """)


def create_client(name: str) -> dict:
    """Create a client. Returns { id, name, created_at }."""
    client_id = str(uuid.uuid4())[:8]
    created_at = datetime.utcnow().isoformat() + "Z"
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO clients (id, name, created_at) VALUES (?, ?, ?)",
            (client_id, name.strip(), created_at),
        )
    return {"id": client_id, "name": name.strip(), "created_at": created_at}


def list_clients() -> List[dict]:
    """List all clients. Returns [{ id, name, created_at }, ...]."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, name, created_at FROM clients ORDER BY created_at DESC"
        ).fetchall()
    return [{"id": r["id"], "name": r["name"], "created_at": r["created_at"]} for r in rows]


def save_upload(client_id: str, entries: List[Any], filename: Optional[str] = None) -> dict:
    """
    Append a batch of journal rows to the client's history.
    entries: list of raw row objects (will be stored as JSON).
    Returns { upload_id, client_id, filename, uploaded_at, row_count }.
    """
    upload_id = str(uuid.uuid4())
    uploaded_at = datetime.utcnow().isoformat() + "Z"
    row_count = len(entries)
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO journal_uploads (id, client_id, filename, uploaded_at, row_count) VALUES (?, ?, ?, ?, ?)",
            (upload_id, client_id, filename or "", uploaded_at, row_count),
        )
        for i, row in enumerate(entries):
            data = json.dumps(row, default=str) if not isinstance(row, str) else row
            conn.execute(
                "INSERT INTO journal_entries (upload_id, row_index, data) VALUES (?, ?, ?)",
                (upload_id, i, data),
            )
    return {
        "upload_id": upload_id,
        "client_id": client_id,
        "filename": filename,
        "uploaded_at": uploaded_at,
        "row_count": row_count,
    }


def get_client_history(client_id: str) -> List[dict]:
    """
    Return all journal rows for this client (all uploads, flattened).
    Each item is the parsed JSON row (raw row as stored).
    """
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT data FROM journal_entries e JOIN journal_uploads u ON e.upload_id = u.id WHERE u.client_id = ? ORDER BY u.uploaded_at, e.row_index",
            (client_id,),
        ).fetchall()
    out = []
    for r in rows:
        try:
            out.append(json.loads(r["data"]))
        except (json.JSONDecodeError, TypeError):
            out.append({"raw": r["data"]})
    return out


def get_client_uploads(client_id: str) -> List[dict]:
    """Return list of uploads for client: [{ upload_id, filename, uploaded_at, row_count }, ...]."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, filename, uploaded_at, row_count FROM journal_uploads WHERE client_id = ? ORDER BY uploaded_at DESC",
            (client_id,),
        ).fetchall()
    return [
        {
            "upload_id": r["id"],
            "filename": r["filename"],
            "uploaded_at": r["uploaded_at"],
            "row_count": r["row_count"],
        }
        for r in rows
    ]
