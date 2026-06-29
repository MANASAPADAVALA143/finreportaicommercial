#!/usr/bin/env python3
"""Apply 023_invoices_advance_payment.sql to Supabase via direct Postgres."""
from __future__ import annotations

import os
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
_REPO = _BACKEND.parent
sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv

load_dotenv(_BACKEND / ".env", override=True)

SQL_PATH = _REPO / "supabase" / "migrations" / "023_invoices_advance_payment.sql"
COLUMNS = (
    "is_advance_payment",
    "contract_value",
    "delivery_date",
    "advance_vat_amount",
    "remaining_vat_amount",
)


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


def verify_columns(db_url: str) -> list[str]:
    import psycopg2

    conn = psycopg2.connect(db_url)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'invoices'
                  AND column_name = ANY(%s)
                """,
                (list(COLUMNS),),
            )
            return [r[0] for r in cur.fetchall()]
    finally:
        conn.close()


def verify_via_rest() -> bool:
    """Best-effort check using Supabase REST when no DB URL."""
    url = (os.getenv("SUPABASE_URL") or "").strip()
    key = (os.getenv("SUPABASE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not url or not key:
        return False
    try:
        from supabase import create_client

        sb = create_client(url, key)
        sb.table("invoices").select("is_advance_payment").limit(1).execute()
        return True
    except Exception as e:
        msg = str(e)
        if "is_advance_payment" in msg or "PGRST204" in msg:
            return False
        raise


def main() -> int:
    db_url = (os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL") or "").strip()

    if db_url.startswith("postgresql"):
        existing = verify_columns(db_url)
        if len(existing) == len(COLUMNS):
            print(f"All advance payment columns already exist: {', '.join(COLUMNS)}")
            return 0

        try:
            import psycopg2
        except ImportError:
            print("Install psycopg2-binary: pip install psycopg2-binary", file=sys.stderr)
            return 1

        sql = SQL_PATH.read_text(encoding="utf-8")
        conn = psycopg2.connect(db_url)
        try:
            with conn.cursor() as cur:
                for stmt in _split_sql(sql):
                    cur.execute(stmt)
            conn.commit()
        finally:
            conn.close()

        after = verify_columns(db_url)
        print(f"Migration applied. Columns present: {', '.join(after)}")
        return 0 if len(after) == len(COLUMNS) else 1

    # No direct DB URL — check REST and report
    try:
        if verify_via_rest():
            print("Advance payment columns already exist (verified via Supabase REST).")
            return 0
    except Exception as e:
        print(f"REST check failed: {e}", file=sys.stderr)

    print(
        "Cannot apply migration automatically — SUPABASE_DB_URL is not set in backend/.env.\n"
        "Run this file manually in Supabase SQL Editor:\n"
        f"  {SQL_PATH}\n"
        "Or add SUPABASE_DB_URL (Database → Connection string URI) and re-run this script.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
