#!/usr/bin/env python3
"""
Backfill VAT Classifier `transactions` from existing gulftax_transactions.

Usage:
  python scripts/backfill_vat_classifier_transactions.py \\
      --company-id 77905042-bc16-48d0-93f9-50190ad1f9e1

  python scripts/backfill_vat_classifier_transactions.py --all
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv

load_dotenv(_BACKEND / ".env", override=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--company-id", help="FinReportAI company UUID (gulftax_transactions.company_id)")
    parser.add_argument("--all", action="store_true", help="Backfill all companies")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    if not args.company_id and not args.all:
        parser.error("Provide --company-id or --all")

    from app.core.database import SessionLocal
    from app.services.vat_classifier_sync_service import backfill_classifier_from_gulftax

    db = SessionLocal()
    try:
        result = backfill_classifier_from_gulftax(
            db,
            finreport_company_id=None if args.all else args.company_id,
            limit=args.limit,
        )
    finally:
        db.close()

    log.info(
        "backfill done scanned=%s created=%s skipped=%s failed=%s",
        result.get("scanned"),
        result.get("created"),
        result.get("skipped"),
        result.get("failed"),
    )
    if result.get("errors"):
        for err in result["errors"]:
            log.warning("  %s", err)
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
