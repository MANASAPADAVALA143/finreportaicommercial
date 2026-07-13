#!/usr/bin/env python3
"""Apply alembic 023_einvoicing_record_type to Postgres RDS.

Requires DATABASE_URL pointing at the FinReportAI RDS (not sqlite default).

  backend/.env:
    DATABASE_URL=postgresql://user:pass@host:5432/dbname

From backend/:
  python scripts/run_einvoicing_record_type_migration.py

Or:
  alembic upgrade head
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv

load_dotenv(_BACKEND / ".env", override=True)

SQL_STATEMENTS = [
    """
    ALTER TABLE einvoicing_submissions
    ADD COLUMN IF NOT EXISTS record_type VARCHAR(32) NOT NULL DEFAULT 'outbound_ar'
    """,
    """
    UPDATE einvoicing_submissions
    SET record_type = 'internal_vendor_record'
    WHERE invoice_id LIKE 'gulftax-flow-%'
    """,
    """
    CREATE INDEX IF NOT EXISTS ix_einvoicing_submissions_record_type
    ON einvoicing_submissions (record_type)
    """,
]


def main() -> int:
    url = (os.getenv("DATABASE_URL") or "").strip()
    if not url or url.startswith("sqlite"):
        print(
            "ERROR: Set DATABASE_URL in backend/.env to your Postgres RDS URL "
            "(sqlite is not the production einvoicing_submissions store).",
            file=sys.stderr,
        )
        return 1

    try:
        from sqlalchemy import create_engine, text
    except ImportError:
        print("ERROR: sqlalchemy required", file=sys.stderr)
        return 1

    engine = create_engine(url, connect_args={"connect_timeout": 15})
    print(f"Connecting to {url.split('@')[-1] if '@' in url else 'database'}…")
    with engine.begin() as conn:
        for stmt in SQL_STATEMENTS:
            conn.execute(text(stmt.strip()))

    print("OK: record_type column + index applied; gulftax-flow rows backfilled.")
    print("\nVerification — SELECT record_type, COUNT(*) FROM einvoicing_submissions GROUP BY record_type:")
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT record_type, COUNT(*) AS cnt "
                "FROM einvoicing_submissions GROUP BY record_type ORDER BY record_type"
            )
        ).fetchall()
    if not rows:
        print("  (no rows in einvoicing_submissions)")
    else:
        for record_type, cnt in rows:
            print(f"  {record_type}\t{cnt}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
