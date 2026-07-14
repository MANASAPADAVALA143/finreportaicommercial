#!/usr/bin/env python3
"""
SCRIPT 3 — Weekly duplicate scan

Deploy: /home/ubuntu/finreportaicommercial/scripts/duplicate_scan.py
Cron:   0 3 * * 5   (Friday 08:00 Dubai / 03:00 UTC)

For each active company:
  - Fetch invoices from last 90 days
  - Same rules as DB trigger (GSTIN+inv#, vendor+inv#, same month, 90-day)
  - Update duplicate_flag / duplicate_of_id / duplicate_reason
  - Email CFO a full duplicate report (when findings exist)

Usage:
  python3 scripts/duplicate_scan.py --test
  python3 scripts/duplicate_scan.py --test --send --company-id <uuid>
  python3 scripts/duplicate_scan.py --no-write --test   # read-only
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

_SCRIPTS_DIR = Path(__file__).resolve().parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from _gnanova_cron_common import (  # noqa: E402
    alert_admin,
    get_supabase_client,
    load_env,
    resolve_cfo_email,
    send_email,
    setup_logger,
)

SCRIPT_NAME = "duplicate_scan"
SELECT_COLS = (
    "id,invoice_number,vendor_name,total_amount,invoice_date,gstin,"
    "duplicate_flag,duplicate_of_id,duplicate_reason,currency"
)
SELECT_COLS_FALLBACK = (
    "id,invoice_number,vendor_name,total_amount,invoice_date,"
    "duplicate_flag,duplicate_of_id,duplicate_reason,currency"
)


def _parse_date(v: Any) -> date | None:
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v)[:10]).date()
    except ValueError:
        return None


def fetch_active_companies(company_id: str | None = None) -> list[dict[str, Any]]:
    sb = get_supabase_client()
    q = sb.table("companies").select("id,name,market,subscription_status,admin_email")
    if company_id:
        q = q.eq("id", company_id)
    rows = list((q.execute()).data or [])
    out = []
    for r in rows:
        st = (r.get("subscription_status") or "active").lower()
        if st in ("cancelled", "canceled", "suspended", "inactive"):
            continue
        out.append(r)
    return out


def fetch_invoices(company_id: str, since: str) -> list[dict[str, Any]]:
    sb = get_supabase_client()
    try:
        res = (
            sb.table("invoices")
            .select(SELECT_COLS)
            .eq("company_id", company_id)
            .gte("invoice_date", since)
            .execute()
        )
        return list(res.data or [])
    except Exception:
        res = (
            sb.table("invoices")
            .select(SELECT_COLS_FALLBACK)
            .eq("company_id", company_id)
            .gte("invoice_date", since)
            .execute()
        )
        return list(res.data or [])


def find_duplicate_pairs(invoices: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return list of finding dicts for newly detected duplicates."""
    findings: list[dict[str, Any]] = []
    by_id = {r["id"]: r for r in invoices}

    gstin_inv: dict[tuple[str, str], list[str]] = defaultdict(list)
    vendor_inv: dict[tuple[str, str], list[str]] = defaultdict(list)
    vendor_amt_month: dict[tuple[str, float, str], list[str]] = defaultdict(list)
    vendor_amt: dict[tuple[str, float], list[str]] = defaultdict(list)

    for inv in invoices:
        iid = inv["id"]
        gstin = (inv.get("gstin") or "").strip().upper()
        inv_no = (inv.get("invoice_number") or "").strip()
        vendor = (inv.get("vendor_name") or "").strip().lower()
        amt = float(inv.get("total_amount") or 0)
        d = _parse_date(inv.get("invoice_date"))
        if gstin and inv_no:
            gstin_inv[(gstin, inv_no)].append(iid)
        if vendor and inv_no:
            vendor_inv[(vendor, inv_no)].append(iid)
        if vendor and d:
            month_key = f"{d.year}-{d.month:02d}"
            vendor_amt_month[(vendor, amt, month_key)].append(iid)
            vendor_amt[(vendor, amt)].append(iid)

    claimed: set[str] = set()

    def add_pair(a: str, b: str, reason: str, prob: float) -> None:
        da = _parse_date(by_id[a].get("invoice_date")) or date.max
        db = _parse_date(by_id[b].get("invoice_date")) or date.max
        orig, dup = (a, b) if da <= db else (b, a)
        if dup in claimed:
            return
        existing = by_id[dup]
        if existing.get("duplicate_flag") and existing.get("duplicate_of_id") == orig:
            return
        claimed.add(dup)
        findings.append({
            "invoice_id": dup,
            "duplicate_of_id": orig,
            "reason": reason,
            "probability": prob,
            "invoice_number": by_id[dup].get("invoice_number"),
            "vendor_name": by_id[dup].get("vendor_name"),
            "total_amount": by_id[dup].get("total_amount"),
            "original_invoice_number": by_id[orig].get("invoice_number"),
        })

    for ids in gstin_inv.values():
        if len(ids) < 2:
            continue
        for i in range(1, len(ids)):
            add_pair(ids[0], ids[i], "Same GSTIN and invoice number", 98)

    for ids in vendor_inv.values():
        if len(ids) < 2:
            continue
        for i in range(1, len(ids)):
            add_pair(ids[0], ids[i], "Same invoice number and vendor", 95)

    for ids in vendor_amt_month.values():
        if len(ids) < 2:
            continue
        for i in range(1, len(ids)):
            add_pair(ids[0], ids[i], "Same vendor and amount in the same month", 90)

    for ids in vendor_amt.values():
        if len(ids) < 2:
            continue
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                di = _parse_date(by_id[ids[i]].get("invoice_date"))
                dj = _parse_date(by_id[ids[j]].get("invoice_date"))
                if not di or not dj:
                    continue
                if abs((di - dj).days) <= 90:
                    add_pair(ids[i], ids[j], "Same vendor and amount within 90 days", 87)

    return findings


def apply_flags(findings: list[dict[str, Any]], logger) -> int:
    sb = get_supabase_client()
    updated = 0
    now = datetime.utcnow().isoformat() + "Z"
    for f in findings:
        try:
            sb.table("invoices").update({
                "duplicate_flag": True,
                "duplicate_of_id": f["duplicate_of_id"],
                "duplicate_reason": f["reason"],
                "duplicate_probability": f["probability"],
                "updated_at": now,
            }).eq("id", f["invoice_id"]).execute()
            updated += 1
        except Exception:
            logger.exception("Failed to update duplicate for %s", f["invoice_id"])
    return updated


def build_report_html(company_name: str, findings: list[dict[str, Any]], updated: int) -> str:
    rows_html = "".join(
        f"<tr>"
        f"<td style='padding:6px 10px;border-bottom:1px solid #eee'>{f.get('invoice_number')}</td>"
        f"<td style='padding:6px 10px;border-bottom:1px solid #eee'>{f.get('original_invoice_number')}</td>"
        f"<td style='padding:6px 10px;border-bottom:1px solid #eee'>{f.get('vendor_name')}</td>"
        f"<td style='padding:6px 10px;border-bottom:1px solid #eee;text-align:right'>{f.get('total_amount')}</td>"
        f"<td style='padding:6px 10px;border-bottom:1px solid #eee'>{f.get('reason')}</td>"
        f"</tr>"
        for f in findings
    ) or "<tr><td colspan='5' style='padding:12px'>No new duplicates found</td></tr>"

    return f"""<!DOCTYPE html><html><body style="font-family:Segoe UI,Arial,sans-serif">
    <h2>Weekly Duplicate Report — {company_name}</h2>
    <p>Period: last 90 days · Findings: {len(findings)} · Updated rows: {updated}</p>
    <table cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;width:100%">
      <thead><tr style="background:#f9fafb">
        <th align="left" style="padding:8px">Invoice</th>
        <th align="left" style="padding:8px">Original</th>
        <th align="left" style="padding:8px">Vendor</th>
        <th align="right" style="padding:8px">Amount</th>
        <th align="left" style="padding:8px">Reason</th>
      </tr></thead>
      <tbody>{rows_html}</tbody>
    </table>
    <p style="color:#6b7280;font-size:12px">Ref: Gnanova Finance OS · duplicate_scan.py</p>
    </body></html>"""


def process_company(
    company: dict[str, Any],
    *,
    send: bool,
    write: bool,
    logger,
) -> dict[str, Any]:
    cid = company["id"]
    name = company.get("name") or cid
    since = (date.today() - timedelta(days=90)).isoformat()
    invoices = fetch_invoices(cid, since)
    findings = find_duplicate_pairs(invoices)
    updated = apply_flags(findings, logger) if write else 0

    to_email = resolve_cfo_email(company)
    html = build_report_html(name, findings, updated)
    subject = f"Duplicate Scan — {name}: {len(findings)} finding(s)"
    email_sent = False

    if send and findings and to_email:
        email_sent = send_email(
            to_email,
            subject,
            text=f"{len(findings)} duplicates for {name}",
            html=html,
            logger=logger,
        )
    elif send and not findings:
        logger.info("No findings — skip CFO email for %s", name)
    elif send and not to_email:
        logger.error("No CFO email for %s", cid)
    else:
        logger.info("[--test] %s scanned=%s findings=%s to=%s", name, len(invoices), len(findings), to_email or "(none)")

    return {
        "company_id": cid,
        "company_name": name,
        "scanned": len(invoices),
        "findings": len(findings),
        "updated": updated,
        "to": to_email,
        "email_sent": email_sent,
        "details": findings,
        "ok": True,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Weekly AP duplicate scan")
    parser.add_argument("--test", action="store_true")
    parser.add_argument("--send", action="store_true", help="Email CFO report (also with --test)")
    parser.add_argument("--no-write", action="store_true", help="Do not update invoices")
    parser.add_argument("--company-id", default=None)
    args = parser.parse_args(argv)

    load_env()
    logger = setup_logger(SCRIPT_NAME)
    send = (not args.test) or args.send
    write = not args.no_write

    exit_code = 0
    results: list[dict[str, Any]] = []
    try:
        companies = fetch_active_companies(args.company_id)
        if not companies:
            print(json.dumps({"ok": True, "companies": 0, "results": []}, indent=2))
            return 0
        for co in companies:
            try:
                r = process_company(co, send=send, write=write, logger=logger)
                results.append(r)
            except Exception as e:
                logger.exception("Company failed")
                results.append({"company_id": co.get("id"), "ok": False, "error": str(e)})
                exit_code = 1
                try:
                    alert_admin(SCRIPT_NAME, e, logger)
                except Exception:
                    pass
        print(json.dumps({
            "ok": exit_code == 0,
            "script": SCRIPT_NAME,
            "test": args.test,
            "write": write,
            "send": send,
            "results": results,
        }, indent=2, default=str))
        return exit_code
    except Exception as e:
        logger.exception("Fatal")
        try:
            alert_admin(SCRIPT_NAME, e, logger)
        except Exception:
            pass
        print(json.dumps({"ok": False, "error": str(e)}, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
