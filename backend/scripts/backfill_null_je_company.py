#!/usr/bin/env python3
"""Backfill NULL company_id on AP journal entries for a tenant."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv

load_dotenv(_BACKEND / ".env", override=True)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("backfill_null_company")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tenant-id", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    from app.core.database import SessionLocal
    from app.models.uae_accounting_full import UAEJournalEntry
    from app.services.ap_invoice_post_service import _resolve_company_id_for_je

    db = SessionLocal()
    try:
        company_id = _resolve_company_id_for_je(db, args.tenant_id, None, invoice_ref="backfill")
        log.info("Resolved company_id=%s for tenant=%s", company_id, args.tenant_id)

        nulls = (
            db.query(UAEJournalEntry)
            .filter(
                UAEJournalEntry.tenant_id == args.tenant_id,
                UAEJournalEntry.company_id.is_(None),
            )
            .all()
        )
        log.info("NULL company_id JEs: %s", len(nulls))
        for je in nulls:
            log.info("  %s period=%s source=%s", je.entry_number, je.period, je.source)
            if not args.dry_run:
                je.company_id = company_id
                db.add(je)
        if not args.dry_run and nulls:
            db.commit()
            log.info("Backfilled %s journal entries → company_id=%s", len(nulls), company_id)
        elif args.dry_run:
            log.info("Dry run — no writes")
    finally:
        db.close()


if __name__ == "__main__":
    main()
