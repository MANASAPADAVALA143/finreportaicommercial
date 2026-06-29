#!/usr/bin/env python3
"""Apply 018_invoices_invoice_language.sql to Supabase via direct Postgres."""
from __future__ import annotations

import os
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
_REPO = _BACKEND.parent
sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv

load_dotenv(_BACKEND / ".env", override=True)

SQL = """
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS invoice_language text DEFAULT 'en';
NOTIFY pgrst, 'reload schema';
"""


def _split_sql(sql: str) -> list[str]:
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


def verify_column(db_url: str) -> bool:
    import psycopg2

    conn = psycopg2.connect(db_url)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'invoices'
                  AND column_name = 'invoice_language'
                """
            )
            return cur.fetchone() is not None
    finally:
        conn.close()


def main() -> int:
    db_url = (os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL") or "").strip()
    if not db_url.startswith("postgresql"):
        print(
            "Missing SUPABASE_DB_URL in backend/.env.\n"
            "Add from Supabase → Settings → Database → Connection string (URI).\n"
            "Then re-run: python scripts/run_invoice_language_migration.py",
            file=sys.stderr,
        )
        return 1

    try:
        import psycopg2
    except ImportError:
        print("Install psycopg2-binary: pip install psycopg2-binary", file=sys.stderr)
        return 1

    if verify_column(db_url):
        print("Column invoice_language already exists on public.invoices.")
        return 0

    statements = _split_sql(SQL)
    print(f"Applying {len(statements)} statements …")
    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            for stmt in statements:
                print(f"  → {stmt.split(chr(10), 1)[0][:80]}")
                cur.execute(stmt)
    finally:
        conn.close()

    if verify_column(db_url):
        print("Done. invoice_language column added and schema cache notified.")
        return 0

    print("Migration ran but column not found — check permissions.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
