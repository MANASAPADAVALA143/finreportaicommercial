#!/usr/bin/env python3
"""Apply supabase/migrations/020_ap_po_grn_tables.sql to FinReportAI Supabase."""
from __future__ import annotations

import os
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
_REPO = _BACKEND.parent
sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv

load_dotenv(_BACKEND / ".env", override=True)

SQL_FILE = _REPO / "supabase" / "migrations" / "020_ap_po_grn_tables.sql"


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


def verify_tables(db_url: str) -> bool:
    import psycopg2

    conn = psycopg2.connect(db_url)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_name IN ('purchase_orders','goods_receipts','grn_line_items')
                """
            )
            found = {r[0] for r in cur.fetchall()}
            return len(found) == 3
    finally:
        conn.close()


def main() -> int:
    db_url = (os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL") or "").strip()
    if not db_url.startswith("postgresql"):
        print(
            "Missing SUPABASE_DB_URL.\n"
            "Add to backend/.env from Supabase → Settings → Database → Connection string (URI).\n"
            "Or paste supabase/migrations/020_ap_po_grn_tables.sql into Supabase SQL Editor and Run.",
            file=sys.stderr,
        )
        return 1

    if verify_tables(db_url):
        print("PO/GRN tables already exist — nothing to do.")
        return 0

    if not SQL_FILE.is_file():
        print(f"SQL file not found: {SQL_FILE}", file=sys.stderr)
        return 1

    try:
        import psycopg2
    except ImportError:
        print("pip install psycopg2-binary", file=sys.stderr)
        return 1

    statements = _split_sql(SQL_FILE.read_text(encoding="utf-8"))
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

    if verify_tables(db_url):
        print("Done. PO/GRN Excel import enabled at /ap-invoices/po and /ap-invoices/grn")
        return 0

    print("Migration ran but tables not found — check SQL Editor output.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
