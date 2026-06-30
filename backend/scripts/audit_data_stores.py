#!/usr/bin/env python3
"""Audit Supabase vs AWS RDS table coverage.

Usage:
  python backend/scripts/audit_data_stores.py

Requires DATABASE_URL (AWS RDS) and optionally SUPABASE_DB_URL for Supabase introspection.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1].parent
sys.path.insert(0, str(ROOT / "backend"))

try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / "backend" / ".env")
except ImportError:
    pass

TARGET_TABLES = [
    "invoices",
    "invoice_line_items",
    "vendors",
    "purchase_orders",
    "goods_receipts",
    "company_config",
    "gulftax_transactions",
    "vat_return_entries",
    "partial_exemption_calculations",
    "bad_debt_relief_claims",
    "designated_zone_transactions",
    "ifrs16_leases",
    "workspace_members",
    "ap_audit_logs",
    "tenants",
]


def _tables_postgres(url: str) -> set[str]:
    import psycopg2

    conn = psycopg2.connect(url)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
            )
            return {r[0] for r in cur.fetchall()}
    finally:
        conn.close()


def main() -> int:
    rds_url = (os.getenv("DATABASE_URL") or "").strip()
    supa_url = (os.getenv("SUPABASE_DB_URL") or "").strip()

    print("=== FinReportAI data store audit ===\n")

    if not rds_url or rds_url.startswith("sqlite"):
        print("WARN  DATABASE_URL is not PostgreSQL/RDS — set AWS RDS URI in backend/.env")
        rds_tables: set[str] = set()
    else:
        try:
            rds_tables = _tables_postgres(rds_url)
            print(f"RDS ({rds_url.split('@')[-1]}): {len(rds_tables)} tables")
        except Exception as exc:
            print(f"FAIL  RDS connect: {exc}")
            rds_tables = set()

    if supa_url:
        try:
            supa_tables = _tables_postgres(supa_url)
            print(f"Supabase: {len(supa_tables)} tables")
        except Exception as exc:
            print(f"FAIL  Supabase connect: {exc}")
            supa_tables = set()
    else:
        print("SKIP  SUPABASE_DB_URL not set — cannot list Supabase tables")
        supa_tables = set()

    print("\n--- Target tables ---")
    for t in TARGET_TABLES:
        in_rds = t in rds_tables
        in_supa = t in supa_tables if supa_tables else None
        rds_mark = "OK" if in_rds else "MISSING"
        supa_mark = ("OK" if in_supa else "MISSING") if in_supa is not None else "n/a"
        only_supa = in_supa and not in_rds if in_supa is not None else False
        flag = " ← migrate" if only_supa else ""
        print(f"  {t:40} RDS={rds_mark:7} Supabase={supa_mark:7}{flag}")

    if supa_tables and rds_tables:
        only_supa = sorted(supa_tables - rds_tables)
        only_rds = sorted(rds_tables - supa_tables)
        print(f"\nOnly in Supabase ({len(only_supa)}): {', '.join(only_supa[:20])}")
        if len(only_supa) > 20:
            print(f"  ... and {len(only_supa) - 20} more")
        print(f"Only in RDS ({len(only_rds)}): {', '.join(only_rds[:20])}")

    print("\nNext: alembic upgrade head  OR  init_db on startup creates client_data tables")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
