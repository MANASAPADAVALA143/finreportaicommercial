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
    parser.add_argument(
        "--repair-mismatched",
        action="store_true",
        help="Also rewrite AP_INVOICE JEs whose company_id != resolved profile company",
    )
    args = parser.parse_args()

    from app.core.database import SessionLocal
    from app.models.client_data import ApCompany
    from app.models.uae_accounting_full import UAEJournalEntry
    from app.services.ap_invoice_post_service import _resolve_company_id_for_je

    db = SessionLocal()
    try:
        company_id = _resolve_company_id_for_je(db, args.tenant_id, None, invoice_ref="backfill")
        ap = db.get(ApCompany, company_id)
        log.info(
            "Resolved company_id=%s name=%s for tenant=%s",
            company_id,
            (ap.name if ap else "?"),
            args.tenant_id,
        )

        nulls = (
            db.query(UAEJournalEntry)
            .filter(
                UAEJournalEntry.tenant_id == args.tenant_id,
                UAEJournalEntry.company_id.is_(None),
            )
            .all()
        )
        targets = list(nulls)
        if args.repair_mismatched:
            mismatched = (
                db.query(UAEJournalEntry)
                .filter(
                    UAEJournalEntry.tenant_id == args.tenant_id,
                    UAEJournalEntry.source == "AP_INVOICE",
                    UAEJournalEntry.company_id.isnot(None),
                    UAEJournalEntry.company_id != company_id,
                )
                .all()
            )
            targets.extend(mismatched)

        # de-dupe by id
        seen: set[str] = set()
        unique: list = []
        for je in targets:
            if je.id in seen:
                continue
            seen.add(je.id)
            unique.append(je)

        log.info("JEs to update: %s (null=%s)", len(unique), len(nulls))
        for je in unique:
            log.info(
                "  %s period=%s source=%s old_company=%s",
                je.entry_number,
                je.period,
                je.source,
                je.company_id,
            )
            if not args.dry_run:
                je.company_id = company_id
                db.add(je)
        if not args.dry_run and unique:
            db.commit()
            log.info("Backfilled %s journal entries → company_id=%s", len(unique), company_id)
        elif args.dry_run:
            log.info("Dry run — no writes")
    finally:
        db.close()


if __name__ == "__main__":
    main()
