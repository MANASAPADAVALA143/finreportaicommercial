#!/usr/bin/env python3
"""Apply supabase/migrations/026_vat_advanced.sql to FinReportAI Supabase."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1].parent
SQL_FILE = ROOT / "supabase" / "migrations" / "026_vat_advanced.sql"


def main() -> int:
    try:
        from dotenv import load_dotenv
        load_dotenv(ROOT / "backend" / ".env")
    except ImportError:
        pass

    db_url = (os.getenv("SUPABASE_DB_URL") or "").strip()
    if not db_url:
        print("Set SUPABASE_DB_URL in backend/.env, or run 026_vat_advanced.sql in Supabase SQL Editor.")
        return 1

    if not SQL_FILE.is_file():
        print(f"Missing {SQL_FILE}")
        return 1

    try:
        import psycopg2
    except ImportError:
        print("pip install psycopg2-binary")
        return 1

    sql = SQL_FILE.read_text(encoding="utf-8")
    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
        print("OK — 026_vat_advanced tables created")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
