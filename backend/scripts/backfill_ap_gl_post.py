#!/usr/bin/env python3
"""
One-time backfill: post approved AP invoices to UAE GL + GulfTax.

Finds invoices where status = Approved AND (je_posted is not true OR no
uae_journal_entries row with source AP_INVOICE / AP_INVOICE_VAT and reference = invoice id).

Uses the shared idempotent post_invoice_to_gl_and_tax() service.

Usage:
  cd backend
  python scripts/backfill_ap_gl_post.py --dry-run
  python scripts/backfill_ap_gl_post.py --company-id <uuid>
  python scripts/backfill_ap_gl_post.py --limit 50
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


def _get_supabase():
    from app.core.supabase import get_supabase

    return get_supabase()


def _fetch_approved_invoices(company_id: str | None) -> list[dict]:
    sb = _get_supabase()
    q = (
        sb.table("invoices")
        .select(
            "id, company_id, invoice_number, vendor_name, total_amount, "
            "invoice_date, status, je_posted, je_reference"
        )
        .eq("status", "Approved")
    )
    if company_id:
        q = q.eq("company_id", company_id)
    res = q.execute()
    return res.data or []


def _fetch_gl_posted_invoice_ids(db) -> set[str]:
    from app.models.uae_accounting_full import UAEJournalEntry

    rows = (
        db.query(UAEJournalEntry.reference)
        .filter(UAEJournalEntry.source.in_(("AP_INVOICE", "AP_INVOICE_VAT")))
        .all()
    )
    return {str(r[0]) for r in rows if r and r[0]}


def _resolve_workspace(sb, company_id: str) -> str:
    if not company_id:
        return ""
    try:
        res = (
            sb.table("companies")
            .select("workspace_id")
            .eq("id", company_id)
            .maybe_single()
            .execute()
        )
        ws = (res.data or {}).get("workspace_id")
        return str(ws) if ws else company_id
    except Exception:
        return company_id


def _needs_backfill(inv: dict, gl_refs: set[str]) -> bool:
    iid = str(inv.get("id") or "")
    if not iid:
        return False
    je_posted = bool(inv.get("je_posted"))
    has_je = iid in gl_refs
    return (not je_posted) or (not has_je)


def run_backfill(
    *,
    company_id: str | None,
    dry_run: bool,
    limit: int | None,
) -> dict[str, int]:
    from app.core.database import SessionLocal
    from app.services.ap_invoice_post_service import (
        post_invoice_to_gl_and_tax,
        request_from_supabase_invoice,
    )

    sb = _get_supabase()
    approved = _fetch_approved_invoices(company_id)
    db = SessionLocal()

    stats = {
        "approved_total": len(approved),
        "pending_backfill": 0,
        "succeeded": 0,
        "skipped_already_posted": 0,
        "failed": 0,
    }
    failures: list[tuple[str, str, str]] = []

    try:
        gl_refs = _fetch_gl_posted_invoice_ids(db)
        pending = [inv for inv in approved if _needs_backfill(inv, gl_refs)]
        if limit is not None:
            pending = pending[:limit]
        stats["pending_backfill"] = len(pending)

        log.info(
            "Found %d Approved invoice(s); %d need GL/GulfTax backfill",
            stats["approved_total"],
            stats["pending_backfill"],
        )

        if dry_run:
            for inv in pending:
                log.info(
                    "  [DRY RUN] %s | %s | %s | je_posted=%s",
                    inv.get("invoice_number", "—"),
                    inv.get("id"),
                    inv.get("vendor_name", "—"),
                    inv.get("je_posted"),
                )
            return stats

        for inv in pending:
            iid = str(inv.get("id") or "")
            inv_no = str(inv.get("invoice_number") or iid)
            cid = str(inv.get("company_id") or "")
            if not cid:
                stats["failed"] += 1
                failures.append((iid, inv_no, "missing company_id"))
                log.warning("SKIP %s — no company_id", inv_no)
                continue

            ws_id = _resolve_workspace(sb, cid)
            tenant_id = ws_id or cid

            try:
                full = (
                    sb.table("invoices")
                    .select("*")
                    .eq("id", iid)
                    .maybe_single()
                    .execute()
                )
                inv_row = full.data or inv
                payload = request_from_supabase_invoice(inv_row, workspace_id=ws_id)
                result = post_invoice_to_gl_and_tax(payload, tenant_id=tenant_id, db=db)

                if result.get("skipped"):
                    stats["skipped_already_posted"] += 1
                    log.info(
                        "SKIP (already posted) %s — JE %s",
                        inv_no,
                        result.get("je_reference", "—"),
                    )
                elif result.get("je_posted"):
                    stats["succeeded"] += 1
                    log.info(
                        "OK %s — JE %s",
                        inv_no,
                        result.get("je_reference", "—"),
                    )
                elif result.get("ok") is False:
                    stats["failed"] += 1
                    err = str(result.get("error", "post returned ok=false"))
                    failures.append((iid, inv_no, err))
                    log.error("FAIL %s — %s", inv_no, err)
                else:
                    stats["failed"] += 1
                    failures.append((iid, inv_no, "je_posted=false"))
                    log.error("FAIL %s — journal entry was not created", inv_no)
            except Exception as exc:
                stats["failed"] += 1
                failures.append((iid, inv_no, str(exc)))
                log.exception("FAIL %s", inv_no)
                db.rollback()

    finally:
        db.close()

    log.info("——— Backfill summary ———")
    log.info("Approved invoices (total):     %d", stats["approved_total"])
    log.info("Pending backfill:              %d", stats["pending_backfill"])
    log.info("Posted to GL (new):            %d", stats["succeeded"])
    log.info("Skipped (already posted):      %d", stats["skipped_already_posted"])
    log.info("Failed:                        %d", stats["failed"])
    if failures:
        log.info("Failures:")
        for iid, inv_no, err in failures[:20]:
            log.info("  %s | %s | %s", inv_no, iid, err)
        if len(failures) > 20:
            log.info("  ... and %d more", len(failures) - 20)

    return stats


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill approved AP invoices to UAE GL + GulfTax",
    )
    parser.add_argument("--company-id", help="Limit to one Supabase company UUID")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List invoices that would be backfilled without posting",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process at most N invoices (for staged rollout)",
    )
    args = parser.parse_args()

    try:
        stats = run_backfill(
            company_id=args.company_id,
            dry_run=args.dry_run,
            limit=args.limit,
        )
    except Exception as exc:
        log.error("Backfill aborted: %s", exc)
        return 1

    return 0 if stats["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
