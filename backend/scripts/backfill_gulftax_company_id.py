#!/usr/bin/env python3
"""Backfill gulftax_transactions company_id Al Noor → canonical Gnanova profile."""

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
log = logging.getLogger("backfill_gulftax_company")

DEFAULT_TENANT = "b5e18ef9-e81b-4312-b895-20eef28a3bb3"
DEFAULT_FROM = "ae7301ab-38ce-413f-9d76-c254b506d47a"
DEFAULT_TO = "77905042-bc16-48d0-93f9-50190ad1f9e1"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tenant-id", default=DEFAULT_TENANT)
    parser.add_argument("--from-company-id", default=DEFAULT_FROM)
    parser.add_argument("--to-company-id", default=DEFAULT_TO)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    from app.core.database import SessionLocal
    from app.models.client_data import GulftaxTransaction
    from app.services.gulftax_sync_service import _fta_box

    db = SessionLocal()
    try:
        rows = (
            db.query(GulftaxTransaction)
            .filter(
                GulftaxTransaction.company_id == args.from_company_id,
                GulftaxTransaction.tenant_id == args.tenant_id,
            )
            .all()
        )
        # Also catch rows stamped Al Noor with tenant = company or null
        extra = (
            db.query(GulftaxTransaction)
            .filter(GulftaxTransaction.company_id == args.from_company_id)
            .filter(
                (GulftaxTransaction.tenant_id == args.tenant_id)
                | (GulftaxTransaction.tenant_id == args.from_company_id)
                | (GulftaxTransaction.tenant_id.is_(None))
            )
            .all()
        )
        by_id = {r.id: r for r in rows}
        for r in extra:
            by_id[r.id] = r
        targets = list(by_id.values())

        log.info(
            "Updating %s gulftax_transactions %s → %s (tenant=%s)",
            len(targets),
            args.from_company_id,
            args.to_company_id,
            args.tenant_id,
        )
        fixed_fta = 0
        for r in targets:
            log.info(
                "  %s period=%s dir=%s fta=%s vat=%s src=%s",
                r.invoice_number,
                r.tax_period,
                r.direction,
                r.fta_box,
                r.vat_amount,
                r.source,
            )
            if not args.dry_run:
                r.company_id = args.to_company_id
                r.tenant_id = args.tenant_id
                # Repair zero-rated output wrongly stamped as box3
                if (r.direction or "") == "output" and (r.vat_category or "") == "zero":
                    if r.fta_box != "box4":
                        r.fta_box = _fta_box("zero", "output")
                        fixed_fta += 1
                db.add(r)
        if not args.dry_run and targets:
            db.commit()
            log.info(
                "Backfilled %s rows → company_id=%s (fta_box fixes=%s)",
                len(targets),
                args.to_company_id,
                fixed_fta,
            )
        elif args.dry_run:
            log.info("Dry run — no writes")
    finally:
        db.close()


if __name__ == "__main__":
    main()
