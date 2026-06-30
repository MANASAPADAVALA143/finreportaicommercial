#!/usr/bin/env python3
"""
Backfill approved AP invoices into gulftax_transactions.

Usage:
  # Single period (existing behaviour)
  python scripts/backfill_gulftax_transactions.py \\
      --company-id <uuid> --tax-period 2026-Q2

  # All approved invoices across every period (new)
  python scripts/backfill_gulftax_transactions.py \\
      --company-id <uuid> --all-approved

  # All companies, all periods (super-admin use)
  python scripts/backfill_gulftax_transactions.py --all-approved

  # Dry run — log what would sync without writing
  python scripts/backfill_gulftax_transactions.py \\
      --company-id <uuid> --all-approved --dry-run
"""
from __future__ import annotations

import argparse
import logging
import sys
from collections import defaultdict
from datetime import date
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


def _get_supabase():
    from app.core.supabase import get_supabase

    return get_supabase()


def _fetch_filing_frequency(sb, company_id: str, cache: dict[str, str]) -> str:
    if company_id in cache:
        return cache[company_id]
    try:
        res = (
            sb.table("companies")
            .select("vat_filing_frequency")
            .eq("id", company_id)
            .maybe_single()
            .execute()
        )
        freq = (res.data or {}).get("vat_filing_frequency") or "quarterly"
    except Exception:
        freq = "quarterly"
    cache[company_id] = freq
    return freq


def _derive_tax_period(invoice_date: str, filing_frequency: str) -> str:
    from app.services.gulftax_sync_service import tax_period_for_date

    d = date.fromisoformat(str(invoice_date)[:10])
    return tax_period_for_date(d, filing_frequency)


def fetch_pending_invoices(
    company_id: str | None,
    tax_period: str | None,
) -> list[dict]:
    """
    Approved invoices not yet in gulftax_transactions.
    Optionally filter to one company and/or tax period.
    """
    sb = _get_supabase()

    already_synced: set[str] = set()
    try:
        synced_query = (
            sb.table("gulftax_transactions")
            .select("ap_invoice_id")
            .not_.is_("ap_invoice_id", "null")
            .eq("status", "posted")
        )
        if company_id:
            synced_query = synced_query.eq("company_id", company_id)

        synced_result = synced_query.execute()
        already_synced = {
            str(row["ap_invoice_id"])
            for row in (synced_result.data or [])
            if row.get("ap_invoice_id")
        }
    except Exception as exc:
        err = str(exc)
        if "gulftax_transactions" in err and ("PGRST205" in err or "404" in err):
            log.error(
                "Table gulftax_transactions not found — run migration "
                "supabase/migrations/024_gulftax_transactions.sql first (supabase db push)."
            )
            raise SystemExit(1) from exc
        raise

    inv_query = (
        sb.table("invoices")
        .select(
            "id, company_id, invoice_date, invoice_number, "
            "vendor_name, total_amount, status"
        )
        .eq("status", "Approved")
    )
    if company_id:
        inv_query = inv_query.eq("company_id", company_id)

    inv_result = inv_query.execute()
    invoices = inv_result.data or []

    freq_cache: dict[str, str] = {}
    pending: list[dict] = []

    for inv in invoices:
        iid = str(inv.get("id") or "")
        if not iid or iid in already_synced:
            continue

        cid = str(inv.get("company_id") or "")
        if not cid:
            continue

        inv_date = inv.get("invoice_date")
        if not inv_date:
            log.warning("Skipping invoice %s — missing invoice_date", iid)
            continue

        freq = _fetch_filing_frequency(sb, cid, freq_cache)
        period = _derive_tax_period(str(inv_date), freq)

        if tax_period and period != tax_period:
            continue

        pending.append({**inv, "_tax_period": period})

    return pending


def run_single_period(company_id: str, tax_period: str, dry_run: bool) -> int:
    if dry_run:
        pending = fetch_pending_invoices(company_id, tax_period)
        log.info(
            "DRY RUN — period %s: %d invoice(s) would sync",
            tax_period,
            len(pending),
        )
        for inv in pending:
            log.info(
                "  [DRY RUN] %s | %s | %s | AED %.2f",
                inv.get("invoice_number", "—"),
                inv["id"],
                inv.get("vendor_name", "—"),
                float(inv.get("total_amount") or 0),
            )
        return 0

    from app.services.gulftax_sync_service import sync_period

    result = sync_period(company_id, tax_period)
    log.info("Result: %s", result)
    return 0 if result.get("ok") else 1


def run_all_approved(company_id: str | None, tax_period: str | None, dry_run: bool) -> int:
    from app.services.gulftax_sync_service import sync_approved_invoice_to_gulftax

    log.info(
        "Starting backfill | company_id=%s | tax_period=%s | dry_run=%s",
        company_id or "ALL",
        tax_period or "ALL",
        dry_run,
    )

    pending = fetch_pending_invoices(company_id, tax_period)
    if not pending:
        log.info("Nothing to backfill — all approved invoices already synced.")
        return 0

    by_period: dict[str, list[dict]] = defaultdict(list)
    for inv in pending:
        by_period[inv["_tax_period"]].append(inv)

    total_synced = 0
    total_failed = 0

    for period in sorted(by_period):
        period_invoices = by_period[period]
        log.info("Period %s — %d invoice(s) to sync", period, len(period_invoices))

        for inv in period_invoices:
            invoice_id = str(inv["id"])
            cid = str(inv["company_id"])

            if dry_run:
                log.info(
                    "  [DRY RUN] Would sync %s (%s) | %s | AED %.2f",
                    inv.get("invoice_number", "—"),
                    invoice_id,
                    inv.get("vendor_name", "—"),
                    float(inv.get("total_amount") or 0),
                )
                total_synced += 1
                continue

            result = sync_approved_invoice_to_gulftax(invoice_id, cid)
            if result.get("ok"):
                log.info(
                    "  Synced %s | %s | %s | AED %.2f",
                    period,
                    inv.get("invoice_number", "—"),
                    inv.get("vendor_name", "—"),
                    float(inv.get("total_amount") or 0),
                )
                total_synced += 1
            else:
                log.error(
                    "  Failed %s | %s — %s",
                    inv.get("invoice_number", "—"),
                    invoice_id,
                    result.get("error", "unknown error"),
                )
                total_failed += 1

    log.info(
        "Backfill complete — synced: %d | failed: %d | pending was: %d",
        total_synced,
        total_failed,
        len(pending),
    )
    return 1 if total_failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill approved AP invoices into gulftax_transactions",
    )
    parser.add_argument(
        "--company-id",
        help="UUID of the company to backfill. Omit with --all-approved to run across ALL companies.",
    )
    parser.add_argument(
        "--tax-period",
        help="Single period e.g. 2026-Q2 or 2026-06. Omit with --all-approved to scan every period.",
    )
    parser.add_argument(
        "--all-approved",
        action="store_true",
        help="Scan all approved invoices across all tax periods.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be synced without writing anything.",
    )
    args = parser.parse_args()

    if not args.tax_period and not args.all_approved:
        parser.error("Provide --tax-period <period> or --all-approved")

    if args.all_approved:
        return run_all_approved(args.company_id, args.tax_period, args.dry_run)

    if not args.company_id:
        parser.error("--company-id is required when using --tax-period without --all-approved")

    return run_single_period(args.company_id, args.tax_period, args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
