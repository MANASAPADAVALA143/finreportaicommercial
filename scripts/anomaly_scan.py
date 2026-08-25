#!/usr/bin/env python3
"""
SCRIPT 5 — Weekly AP anomaly scan

Deploy: /home/ubuntu/finreportaicommercial/scripts/anomaly_scan.py
Cron:   0 5 * * 1   (Monday 08:00 Dubai / 05:00 UTC)

Checks (last 30 days per company):
  a) Weekend invoice date (UAE Fri/Sat, India Sat/Sun)
  b) Round amounts (>= 5000 and divisible by 1000/10000)
  c) Missing TRN / GSTIN
  d) First-time vendor with high amount (> 50_000)
  e) Duplicate invoice numbers within same vendor

Persists to invoice_anomalies, bumps invoices.risk_score, emails CFO report.

Usage:
  python3 scripts/anomaly_scan.py --test
  python3 scripts/anomaly_scan.py --test --send --company-id <uuid>
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

SCRIPT_NAME = "anomaly_scan"
HIGH_VENDOR_AMOUNT = 50_000.0


def _parse_date(v: Any) -> date | None:
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v)[:10]).date()
    except ValueError:
        return None


def _is_india(company: dict[str, Any]) -> bool:
    market = (company.get("market") or "").strip().lower()
    if market in ("india", "in"):
        return True
    if market in ("uae", "ae", "dubai"):
        return False
    return False


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
    cols = (
        "id,invoice_number,vendor_name,total_amount,invoice_date,due_date,"
        "currency,gstin,trn,tax_registration_number,vendor_trn,risk_score,risk_flags,created_at"
    )
    try:
        res = (
            sb.table("invoices")
            .select(cols)
            .eq("company_id", company_id)
            .gte("invoice_date", since)
            .execute()
        )
        return list(res.data or [])
    except Exception:
        # slim select if some tax cols missing
        res = (
            sb.table("invoices")
            .select(
                "id,invoice_number,vendor_name,total_amount,invoice_date,due_date,"
                "currency,gstin,risk_score,risk_flags,created_at"
            )
            .eq("company_id", company_id)
            .gte("invoice_date", since)
            .execute()
        )
        return list(res.data or [])


def known_vendors_before(company_id: str, before: str) -> set[str]:
    """Vendor names that already appear before the scan window (not first-time)."""
    sb = get_supabase_client()
    try:
        res = (
            sb.table("invoices")
            .select("vendor_name")
            .eq("company_id", company_id)
            .lt("invoice_date", before)
            .execute()
        )
        return {
            (r.get("vendor_name") or "").strip().lower()
            for r in (res.data or [])
            if (r.get("vendor_name") or "").strip()
        }
    except Exception:
        return set()


def _tax_id(inv: dict[str, Any]) -> str:
    for key in ("gstin", "trn", "tax_registration_number", "vendor_trn"):
        val = (inv.get(key) or "").strip()
        if val:
            return val
    return ""


def scan_invoice(
    inv: dict[str, Any],
    *,
    india: bool,
    vendor_first_seen: dict[str, date],
    vendor_inv_numbers: dict[str, list[str]],
    known_prior_vendors: set[str] | None = None,
) -> list[dict[str, Any]]:
    flags: list[dict[str, Any]] = []
    amount = float(inv.get("total_amount") or 0)
    inv_date = _parse_date(inv.get("invoice_date"))
    vendor = (inv.get("vendor_name") or "").strip()
    vendor_key = vendor.lower()
    inv_no = (inv.get("invoice_number") or "").strip()

    # a) Weekend
    if inv_date:
        wd = inv_date.weekday()  # Mon=0 … Sun=6
        if india:
            weekend = wd >= 5  # Sat/Sun
            label = "India weekend (Sat/Sun)"
        else:
            weekend = wd >= 4  # Fri/Sat
            label = "UAE weekend (Fri/Sat)"
        if weekend:
            flags.append({
                "anomaly_type": "rule_based",
                "detection_method": "weekend_invoice",
                "severity": "medium",
                "risk_score": 45,
                "flag_code": "WEEKEND_INVOICE",
                "flag_reason": f"Invoice dated on {label} — backdating risk",
                "flag_details": {"invoice_date": inv_date.isoformat(), "weekday": wd},
            })

    # b) Round amounts
    if amount >= 5000 and (amount % 1000 == 0 or amount % 10000 == 0):
        flags.append({
            "anomaly_type": "rule_based",
            "detection_method": "round_number",
            "severity": "medium",
            "risk_score": 40,
            "flag_code": "ROUND_NUMBER",
            "flag_reason": "Round number amount — fabrication risk",
            "flag_details": {"amount": amount},
        })

    # c) Missing TRN/GSTIN
    if not _tax_id(inv):
        flag_code = "MISSING_GSTIN" if india else "MISSING_TRN"
        tax_label = "GSTIN" if india else "TRN"
        flags.append({
            "anomaly_type": "rule_based",
            "detection_method": "missing_tax_id",
            "severity": "medium",
            "risk_score": 50,
            "flag_code": flag_code,
            "flag_reason": f"Missing {tax_label} on invoice",
            "flag_details": {},
        })

    # d) First-time vendor + high amount (no history before scan window + first in-window)
    first = vendor_first_seen.get(vendor_key)
    prior = vendor_key in (known_prior_vendors or set())
    if (
        vendor_key
        and not prior
        and first
        and inv_date
        and first == inv_date
        and amount > HIGH_VENDOR_AMOUNT
    ):
        flags.append({
            "anomaly_type": "rule_based",
            "detection_method": "new_vendor_high_amount",
            "severity": "high",
            "risk_score": 80,
            "flag_code": "NEW_VENDOR_HIGH_AMOUNT",
            "flag_reason": f"First-time vendor with high amount (>{HIGH_VENDOR_AMOUNT:,.0f})",
            "flag_details": {"amount": amount, "vendor": vendor},
        })

    # e) Duplicate invoice numbers same vendor
    if vendor_key and inv_no:
        peers = [n for n in vendor_inv_numbers.get(vendor_key, []) if n.lower() == inv_no.lower()]
        if len(peers) > 1:
            flags.append({
                "anomaly_type": "rule_based",
                "detection_method": "duplicate_invoice_number",
                "severity": "high",
                "risk_score": 90,
                "flag_code": "DUPLICATE_INVOICE_NUMBER",
                "flag_reason": f"Duplicate invoice number '{inv_no}' for vendor {vendor}",
                "flag_details": {"invoice_number": inv_no, "count": len(peers)},
            })

    return flags


def process_company(
    company: dict[str, Any],
    *,
    send: bool,
    write: bool,
    logger,
) -> dict[str, Any]:
    cid = company["id"]
    name = company.get("name") or cid
    india = _is_india(company)
    since = (date.today() - timedelta(days=30)).isoformat()
    invoices = fetch_invoices(cid, since)
    known_prior = known_vendors_before(cid, since)

    vendor_first_seen: dict[str, date] = {}
    vendor_inv_numbers: dict[str, list[str]] = defaultdict(list)
    for inv in invoices:
        vk = (inv.get("vendor_name") or "").strip().lower()
        d = _parse_date(inv.get("invoice_date"))
        if vk and d:
            if vk not in vendor_first_seen or d < vendor_first_seen[vk]:
                vendor_first_seen[vk] = d
        inv_no = (inv.get("invoice_number") or "").strip()
        if vk and inv_no:
            vendor_inv_numbers[vk].append(inv_no)

    sb = get_supabase_client()
    all_findings: list[dict[str, Any]] = []
    inserted = 0
    updated_risk = 0

    # Existing open anomalies for dedupe
    existing_keys: set[tuple[str, str]] = set()
    if write:
        try:
            ex = (
                sb.table("invoice_anomalies")
                .select("invoice_id,flag_code,status")
                .eq("company_id", cid)
                .eq("status", "open")
                .execute()
            )
            for row in ex.data or []:
                existing_keys.add((row.get("invoice_id") or "", row.get("flag_code") or ""))
        except Exception:
            logger.warning("Could not load existing anomalies — may insert duplicates")

    for inv in invoices:
        flags = scan_invoice(
            inv,
            india=india,
            vendor_first_seen=vendor_first_seen,
            vendor_inv_numbers=vendor_inv_numbers,
            known_prior_vendors=known_prior,
        )
        if not flags:
            continue

        max_score = max(float(f["risk_score"]) for f in flags)
        for f in flags:
            finding = {
                **f,
                "invoice_id": inv["id"],
                "invoice_number": inv.get("invoice_number"),
                "vendor_name": inv.get("vendor_name"),
                "total_amount": inv.get("total_amount"),
            }
            all_findings.append(finding)
            key = (inv["id"], f["flag_code"])
            if write and key not in existing_keys:
                try:
                    sb.table("invoice_anomalies").insert({
                        "invoice_id": inv["id"],
                        "company_id": cid,
                        "anomaly_type": f["anomaly_type"],
                        "detection_method": f["detection_method"],
                        "severity": f["severity"],
                        "risk_score": f["risk_score"],
                        "flag_code": f["flag_code"],
                        "flag_reason": f["flag_reason"],
                        "flag_details": f.get("flag_details") or {},
                        "status": "open",
                    }).execute()
                    inserted += 1
                    existing_keys.add(key)
                except Exception:
                    logger.exception("Insert anomaly failed for %s %s", inv["id"], f["flag_code"])

        if write:
            try:
                prev = float(inv.get("risk_score") or 0)
                new_score = max(prev, max_score)
                risk_flags = inv.get("risk_flags") or []
                if not isinstance(risk_flags, list):
                    risk_flags = []
                # append new flag codes not already present
                existing_types = {
                    (x.get("type") if isinstance(x, dict) else None) for x in risk_flags
                }
                for f in flags:
                    if f["flag_code"] not in existing_types:
                        risk_flags.append({
                            "type": f["flag_code"],
                            "severity": f["severity"],
                            "message": f["flag_reason"],
                        })
                sb.table("invoices").update({
                    "risk_score": new_score,
                    "risk_flags": risk_flags,
                    "updated_at": datetime.utcnow().isoformat() + "Z",
                }).eq("id", inv["id"]).execute()
                updated_risk += 1
            except Exception:
                logger.exception("risk_score update failed for %s", inv["id"])

    to_email = resolve_cfo_email(company)
    by_code: dict[str, int] = defaultdict(int)
    for f in all_findings:
        by_code[f["flag_code"]] += 1

    summary_rows = "".join(
        f"<tr><td style='padding:6px 10px;border-bottom:1px solid #eee'>{code}</td>"
        f"<td style='padding:6px 10px;border-bottom:1px solid #eee;text-align:right'>{cnt}</td></tr>"
        for code, cnt in sorted(by_code.items(), key=lambda x: -x[1])
    ) or "<tr><td colspan='2' style='padding:12px'>No anomalies</td></tr>"

    detail_rows = "".join(
        f"<tr>"
        f"<td style='padding:6px 10px;border-bottom:1px solid #eee'>{f.get('invoice_number')}</td>"
        f"<td style='padding:6px 10px;border-bottom:1px solid #eee'>{f.get('vendor_name')}</td>"
        f"<td style='padding:6px 10px;border-bottom:1px solid #eee'>{f.get('flag_code')}</td>"
        f"<td style='padding:6px 10px;border-bottom:1px solid #eee'>{f.get('flag_reason')}</td>"
        f"</tr>"
        for f in all_findings[:80]
    ) or ""

    html = f"""<!DOCTYPE html><html><body style="font-family:Segoe UI,Arial,sans-serif">
    <h2>Weekly Anomaly Report — {name}</h2>
    <p>Window: last 30 days · Market: {"India" if india else "UAE"} ·
       Flags: {len(all_findings)} · Inserted: {inserted} · Risk updates: {updated_risk}</p>
    <h3>By flag</h3>
    <table cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;width:100%;max-width:480px">
      <thead><tr style="background:#f9fafb">
        <th align="left" style="padding:8px">Flag</th>
        <th align="right" style="padding:8px">Count</th>
      </tr></thead>
      <tbody>{summary_rows}</tbody>
    </table>
    <h3 style="margin-top:24px">Details (up to 80)</h3>
    <table cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;width:100%">
      <thead><tr style="background:#f9fafb">
        <th align="left" style="padding:8px">Invoice</th>
        <th align="left" style="padding:8px">Vendor</th>
        <th align="left" style="padding:8px">Code</th>
        <th align="left" style="padding:8px">Reason</th>
      </tr></thead>
      <tbody>{detail_rows or "<tr><td colspan='4' style='padding:12px'>None</td></tr>"}</tbody>
    </table>
    <p style="color:#6b7280;font-size:12px">Ref: Gnanova Finance OS · anomaly_scan.py</p>
    </body></html>"""

    subject = f"Anomaly Scan — {name}: {len(all_findings)} flag(s)"
    email_sent = False
    if send and all_findings and to_email:
        email_sent = send_email(
            to_email,
            subject,
            text=f"{len(all_findings)} anomaly flags for {name}",
            html=html,
            logger=logger,
        )
    elif send and not all_findings:
        logger.info("No anomalies — skip email for %s", name)
    elif send and not to_email:
        logger.error("No CFO email for %s", cid)
    else:
        logger.info(
            "[--test] %s scanned=%s flags=%s to=%s",
            name, len(invoices), len(all_findings), to_email or "(none)",
        )

    return {
        "company_id": cid,
        "company_name": name,
        "market": "IN" if india else "AE",
        "scanned": len(invoices),
        "flags": len(all_findings),
        "inserted": inserted,
        "updated_risk": updated_risk,
        "by_code": dict(by_code),
        "to": to_email,
        "email_sent": email_sent,
        "ok": True,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Weekly AP anomaly scan")
    parser.add_argument("--test", action="store_true")
    parser.add_argument("--send", action="store_true")
    parser.add_argument("--no-write", action="store_true")
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
