#!/usr/bin/env python3
"""
Backfill GulfTax VAT classification on historical AP invoices.

Finds Supabase invoices where gulftax_decision is missing (Approved, Processing,
Paid, On Hold by default), runs embedded classify_invoice, writes VAT/GulfTax
fields. Does NOT re-approve or re-post GL.

Usage:
  cd backend
  python scripts/backfill_ap_classify.py --dry-run
  python scripts/backfill_ap_classify.py --workspace-id b5e18ef9-...
  python scripts/backfill_ap_classify.py --company-id 0deaa402-...
  python scripts/backfill_ap_classify.py --statuses Processing,Approved --limit 50
  python scripts/backfill_ap_classify.py --all-unclassified --limit 50
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path
from typing import Any

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv

load_dotenv(_BACKEND / ".env", override=True)

# Windows consoles often use cp1252 — avoid UnicodeEncodeError on arrows etc.
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("backfill_ap_classify")

DEFAULT_TENANT = "b5e18ef9-e81b-4312-b895-20eef28a3bb3"

# AP company_id used by UAE-INV demo/historical rows (workspace link may be stale).
KNOWN_UAE_AP_COMPANY = "0deaa402-f6a1-4c38-90e8-711f4fd0aa09"

# Classification is independent of approval/GL — include Processing (stuck mid-flow)
# and terminal Paid / On Hold rows that never got classify-on-upload.
DEFAULT_STATUSES = ("Approved", "Processing", "Paid", "On Hold")


def _get_supabase():
    from app.core.supabase import get_supabase

    return get_supabase()


def _company_ids_for_workspace(sb, workspace_id: str) -> list[str]:
    try:
        res = (
            sb.table("companies")
            .select("id")
            .eq("workspace_id", workspace_id)
            .execute()
        )
        return [str(r["id"]) for r in (res.data or []) if r.get("id")]
    except Exception:
        log.exception("Failed to list companies for workspace %s", workspace_id)
        return []


def _fetch_unclassified(
    sb,
    *,
    workspace_id: str | None,
    company_id: str | None,
    all_unclassified: bool,
    statuses: list[str],
    limit: int,
) -> list[dict]:
    select_cols = (
        "id, company_id, invoice_number, vendor_name, vendor_trn, total_amount, "
        "invoice_date, description, status, vat_treatment, gulftax_decision, "
        "gulftax_risk_score, gulftax_confidence, ifrs_category"
    )
    q = sb.table("invoices").select(select_cols)
    if statuses:
        q = q.in_("status", statuses)

    if company_id:
        q = q.eq("company_id", company_id)
    elif not all_unclassified and workspace_id:
        cids = set(_company_ids_for_workspace(sb, workspace_id))
        # Historical UAE-INV rows live on a separate company_id; include for default tenant.
        if workspace_id == DEFAULT_TENANT:
            cids.add(KNOWN_UAE_AP_COMPANY)
        if cids:
            q = q.in_("company_id", list(cids))
        else:
            log.warning("No companies for workspace %s — scanning all matching invoices", workspace_id)

    # Paginate — PostgREST default max is often 1000
    res = q.order("created_at", desc=False).limit(max(limit * 5, 1000)).execute()
    rows = res.data or []
    out: list[dict] = []
    for r in rows:
        decision = (r.get("gulftax_decision") or "").strip()
        if decision:
            continue  # idempotent: already classified
        out.append(r)
        if len(out) >= limit:
            break
    return out


def _trn_valid(raw: str | None) -> bool:
    trn = (raw or "").strip().replace(" ", "").replace("-", "")
    return bool(trn) and trn.isdigit() and len(trn) == 15


async def _classify_one(inv: dict[str, Any]) -> dict[str, Any]:
    from app.services.gulftax_bridge import ClassifyRequest, classify_invoice

    trn = str(inv.get("vendor_trn") or "").strip()
    trn_ok = _trn_valid(trn)
    amount = float(inv.get("total_amount") or 0)
    if amount <= 0:
        raise ValueError("total_amount must be > 0")

    req = ClassifyRequest(
        company_id=str(inv.get("company_id") or "default"),
        description=str(inv.get("description") or f"AP Invoice from {inv.get('vendor_name')}"),
        amount_aed=amount,
        vendor_or_customer=str(inv.get("vendor_name") or "Vendor"),
        transaction_type="purchase",
        entity_type="mainland",
        invoice_number=str(inv.get("invoice_number") or inv.get("id")),
        transaction_date=str(inv.get("invoice_date") or "")[:10] or "2026-01-01",
    )
    result = await classify_invoice(req, trn_valid=trn_ok)
    data = result.to_dict()
    data["trn_valid"] = trn_ok
    # Historical rows: do not HARD_BLOCK solely for malformed TRN (demo UAE-INV TRNs
    # are often short). Keep trn_valid=False and demote to REVIEW_QUEUE for display.
    if data.get("decision") == "HARD_BLOCK" and not trn_ok:
        score = float(data.get("risk_score") or 0)
        if score < 70:
            data["decision"] = "REVIEW_QUEUE"
    return data


def _update_invoice(sb, invoice_id: str, clf: dict[str, Any], *, dry_run: bool) -> None:
    """Write GulfTax fields only — never touches status / GL / approval."""
    payload: dict[str, Any] = {
        "vat_treatment": clf.get("vat_treatment") or "standard_rated",
        "vat_rate": clf.get("vat_rate"),
        "vat_amount": clf.get("vat_amount_aed"),
        "tax_amount": clf.get("vat_amount_aed"),
        "tax_type": "VAT",
        "tax_rate": clf.get("vat_rate"),
        "gulftax_decision": clf.get("decision"),
        "gulftax_risk_score": clf.get("risk_score"),
        "gulftax_confidence": clf.get("confidence_score"),
    }
    optional = {
        "trn_valid": clf.get("trn_valid"),
        "gulftax_reasoning": clf.get("reasoning"),
    }

    if dry_run:
        log.info("  DRY-RUN would update %s -> %s", invoice_id, {**payload, **optional})
        return

    # Try full payload; drop unknown columns one-by-one if schema is missing them.
    attempt = {**payload, **optional}
    for _ in range(4):
        try:
            sb.table("invoices").update(attempt).eq("id", invoice_id).execute()
            return
        except Exception as exc:
            err = str(exc)
            dropped = False
            for col in ("gulftax_reasoning", "trn_valid"):
                if col in attempt and (col in err or "PGRST204" in err or "Could not find" in err):
                    # Only drop the column named in the error when possible
                    if col in err or (col == "gulftax_reasoning" and "gulftax_reasoning" in err):
                        log.warning("Dropping column %s from update for %s", col, invoice_id)
                        attempt.pop(col, None)
                        dropped = True
                        break
            if not dropped and ("PGRST204" in err or "Could not find" in err):
                # Ambiguous schema error — drop optional keys still present
                for col in list(optional.keys()):
                    if col in attempt:
                        log.warning("Dropping optional column %s for %s (%s)", col, invoice_id, exc)
                        attempt.pop(col, None)
                        dropped = True
                        break
            if not dropped:
                raise
    # Last resort: core fields only
    sb.table("invoices").update(payload).eq("id", invoice_id).execute()


async def run(args: argparse.Namespace) -> None:
    sb = _get_supabase()
    statuses = [s.strip() for s in (args.statuses or "").split(",") if s.strip()]
    if not statuses:
        statuses = list(DEFAULT_STATUSES)
    rows = _fetch_unclassified(
        sb,
        workspace_id=None if args.all_unclassified else args.workspace_id,
        company_id=args.company_id,
        all_unclassified=args.all_unclassified,
        statuses=statuses,
        limit=args.limit,
    )
    log.info("Unclassified invoices to process (statuses=%s): %s", statuses, len(rows))

    classified = skipped = failed = 0
    treatments: dict[str, int] = {}
    decisions: dict[str, int] = {}

    for inv in rows:
        inv_id = inv["id"]
        number = inv.get("invoice_number") or inv_id
        if (inv.get("gulftax_decision") or "").strip():
            log.info("SKIP %s — already has gulftax_decision", number)
            skipped += 1
            continue
        try:
            clf = await _classify_one(inv)
            _update_invoice(sb, inv_id, clf, dry_run=args.dry_run)
            treatment = str(clf.get("vat_treatment") or "?")
            decision = str(clf.get("decision") or "?")
            treatments[treatment] = treatments.get(treatment, 0) + 1
            decisions[decision] = decisions.get(decision, 0) + 1
            classified += 1
            log.info(
                "OK %s vendor=%s decision=%s treatment=%s conf=%s risk=%s trn_valid=%s",
                number,
                inv.get("vendor_name"),
                decision,
                treatment,
                clf.get("confidence_score"),
                clf.get("risk_score"),
                clf.get("trn_valid"),
            )
        except Exception as exc:
            failed += 1
            log.exception("FAIL %s: %s", number, exc)

    log.info(
        "Done. classified=%s skipped=%s failed=%s treatments=%s decisions=%s dry_run=%s",
        classified,
        skipped,
        failed,
        treatments,
        decisions,
        args.dry_run,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill AP GulfTax classification")
    parser.add_argument("--workspace-id", default=DEFAULT_TENANT)
    parser.add_argument("--company-id", default=None)
    parser.add_argument(
        "--statuses",
        default=",".join(DEFAULT_STATUSES),
        help="Comma-separated invoice statuses to include (default: Approved,Processing,Paid,On Hold)",
    )
    parser.add_argument(
        "--all-unclassified",
        action="store_true",
        help="Process all invoices missing gulftax_decision (any company)",
    )
    parser.add_argument("--limit", type=int, default=200)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
