#!/usr/bin/env python3
"""Apply supabase/migrations/022_ap_training_tables.sql (AP AI training tables)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
_REPO = _BACKEND.parent
sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv

load_dotenv(_BACKEND / ".env", override=True)

SQL_FILE = _REPO / "supabase" / "migrations" / "022_ap_training_tables.sql"


def _split_sql(sql: str) -> list[str]:
    parts: list[str] = []
    buf: list[str] = []
    for line in sql.splitlines():
        stripped = line.strip()
        if stripped.startswith("--"):
            continue
        buf.append(line)
        if stripped.endswith(";"):
            parts.append("\n".join(buf).strip())
            buf = []
    if buf:
        parts.append("\n".join(buf).strip())
    return [p for p in parts if p]


def main() -> int:
    db_url = (os.getenv("SUPABASE_DB_URL") or "").strip()
    if not db_url.startswith("postgresql"):
        print(
            "Set SUPABASE_DB_URL in backend/.env, or paste this file into Supabase SQL Editor:\n"
            f"  {SQL_FILE}",
            file=sys.stderr,
        )
        return 1
    try:
        import psycopg2
    except ImportError:
        print("pip install psycopg2-binary", file=sys.stderr)
        return 1
    sql = SQL_FILE.read_text(encoding="utf-8")
    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    cur = conn.cursor()
    for stmt in _split_sql(sql):
        cur.execute(stmt)
    cur.close()
    conn.close()
    print(f"Applied {SQL_FILE.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
