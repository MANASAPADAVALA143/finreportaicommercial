#!/usr/bin/env python3
"""Apply supabase/migrations/054_vat_classifier_transactions.sql to Supabase."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1].parent
SQL_FILE = ROOT / "supabase" / "migrations" / "054_vat_classifier_transactions.sql"


def main() -> int:
    try:
        from dotenv import load_dotenv

        load_dotenv(ROOT / "backend" / ".env")
    except ImportError:
        pass

    db_url = (os.getenv("SUPABASE_DB_URL") or "").strip()
    if not db_url:
        print(
            "Set SUPABASE_DB_URL in backend/.env, or run "
            "054_vat_classifier_transactions.sql in Supabase SQL Editor."
        )
        return 1

    if not SQL_FILE.is_file():
        print(f"Missing {SQL_FILE}")
        return 1

    try:
        import psycopg2
    except ImportError:
        print("psycopg2 required")
        return 1

    sql = SQL_FILE.read_text(encoding="utf-8")
    conn = psycopg2.connect(db_url)
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(sql)
        print("OK: vat_classifier_transactions applied")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
