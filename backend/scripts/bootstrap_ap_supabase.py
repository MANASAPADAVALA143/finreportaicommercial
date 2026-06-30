#!/usr/bin/env python3
"""
Apply supabase/migrations/017_ap_missing_core_tables.sql to FinReportAI Supabase.

Requires direct Postgres access (service role JWT cannot run DDL via REST).

  Supabase Dashboard → Settings → Database → Connection string → URI (Session pooler)
  Set in backend/.env:
    SUPABASE_DB_URL=postgresql://postgres.[ref]:[password]@...pooler.supabase.com:5432/postgres

Then from backend/:
  python scripts/bootstrap_ap_supabase.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
_REPO = _BACKEND.parent
sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv

load_dotenv(_BACKEND / ".env", override=True)

SQL_FILE = _REPO / "supabase" / "migrations" / "017_ap_missing_core_tables.sql"


def _split_sql(sql: str) -> list[str]:
    """Split SQL file into executable statements (ignores comment-only fragments)."""
    parts: list[str] = []
    buf: list[str] = []
    for line in sql.splitlines():
        stripped = line.strip()
        if stripped.startswith("--"):
            continue
        buf.append(line)
        if stripped.endswith(";"):
            stmt = "\n".join(buf).strip()
            buf = []
            if stmt and stmt != ";":
                parts.append(stmt.rstrip(";").strip())
    tail = "\n".join(buf).strip()
    if tail:
        parts.append(tail.rstrip(";").strip())
    return [p for p in parts if p]


def main() -> int:
    db_url = (os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL") or "").strip()
    if not db_url.startswith("postgresql"):
        print(
            "Missing SUPABASE_DB_URL.\n"
            "Add to backend/.env:\n"
            "  SUPABASE_DB_URL=postgresql://postgres.[ref]:[password]@...pooler.supabase.com:5432/postgres\n"
            "Or run supabase/migrations/017_ap_missing_core_tables.sql in Supabase SQL Editor.",
            file=sys.stderr,
        )
        return 1

    if not SQL_FILE.is_file():
        print(f"SQL file not found: {SQL_FILE}", file=sys.stderr)
        return 1

    try:
        import psycopg2
    except ImportError:
        print("Install psycopg2-binary: pip install psycopg2-binary", file=sys.stderr)
        return 1

    sql = SQL_FILE.read_text(encoding="utf-8")
    statements = _split_sql(sql)
    print(f"Applying {len(statements)} statements from {SQL_FILE.name} …")

    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            for i, stmt in enumerate(statements, 1):
                preview = stmt.split("\n", 1)[0][:72]
                print(f"  [{i}/{len(statements)}] {preview}…")
                cur.execute(stmt)
    finally:
        conn.close()

    print("Done. Reload the upload page — company_settings / app_settings errors should be gone.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
