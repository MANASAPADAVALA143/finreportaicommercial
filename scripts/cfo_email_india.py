#!/usr/bin/env python3
"""
SCRIPT 2 — Daily CFO Email (India / IST)

Deploy:  /home/ubuntu/finreportaicommercial/scripts/cfo_email_india.py
Cron:    30 2 * * *   (= 08:00 Asia/Kolkata)

Adds vs UAE email:
  - INR / ₹ formatting
  - GST ITC eligible vs blocked (Sec 17(5) heuristic)
  - TDS payable this month
  - GSTR-1 / GSTR-3B due dates

Usage:
  python3 scripts/cfo_email_india.py --test
  python3 scripts/cfo_email_india.py --test --send --company-id <uuid>
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

_SCRIPTS_DIR = Path(__file__).resolve().parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from _gnanova_cron_common import (  # noqa: E402
    alert_admin,
    ensure_backend_on_path,
    get_supabase_client,
    load_env,
    resolve_cfo_email,
    send_email,
    setup_logger,
)

SCRIPT_NAME = "cfo_email_india"


def _fmt_inr(amount: float) -> str:
    """HTML / email body — rupee symbol."""
    return "₹" + f"{float(amount or 0):,.2f}"


def _fmt_inr_ascii(amount: float) -> str:
    """Subject / Windows console — ASCII-safe."""
    return "INR " + f"{float(amount or 0):,.2f}"


def fetch_india_companies(company_id: str | None = None) -> list[dict[str, Any]]:
    """Active India companies (market=india/in OR settings country IN / INR)."""
    sb = get_supabase_client()
    q = sb.table("companies").select(
        "id,name,slug,market,subscription_status,accounting_standard,admin_email"
    )
    if company_id:
        q = q.eq("id", company_id)
    rows = list((q.execute()).data or [])

    india: list[dict[str, Any]] = []
    for row in rows:
        status = (row.get("subscription_status") or "active").lower()
        if status in ("cancelled", "canceled", "suspended", "inactive"):
            continue
        market = (row.get("market") or "").strip().lower()
        if market in ("india", "in"):
            india.append(row)
            continue
        if market in ("uae", "ae", "dubai"):
            if company_id:
                # Explicit --company-id allows dual-market testing on UAE-flagged company
                india.append(row)
            continue
        try:
            cs = (
                sb.table("company_settings")
                .select("country,base_currency")
                .eq("company_id", row["id"])
                .limit(1)
                .execute()
            )
            settings = (cs.data or [None])[0]
            country = ((settings or {}).get("country") or "").upper()
            currency = ((settings or {}).get("base_currency") or "").upper()
            if country == "IN" or currency == "INR":
                india.append(row)
        except Exception:
            if company_id:
                india.append(row)
    return india


def build_summary_for_company(company_id: str, days: int = 7) -> dict[str, Any]:
    ensure_backend_on_path()
    from app.services.ap_cfo_daily_summary_service import build_cfo_daily_summary

    return build_cfo_daily_summary(company_id=company_id, days=days, market="IN")


def _flag_breakdown_html(summary: dict[str, Any]) -> str:
    ensure_backend_on_path()
    from app.services.ap_cfo_daily_summary_service import _render_flag_breakdown_html

    return _render_flag_breakdown_html(summary)


def _highest_risk_html(summary: dict[str, Any]) -> str:
    ensure_backend_on_path()
    from app.services.ap_cfo_daily_summary_service import _render_highest_risk_html

    return _render_highest_risk_html(summary)


def render_india_html(summary: dict[str, Any], *, company_name: str) -> str:
    vendors = (summary.get("top_vendors") or [])[:3]
    vendor_rows = "".join(
        f"""
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">{i + 1}. {v.get('vendor_name') or 'Unknown'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">{_fmt_inr(float(v.get('amount') or 0))}</td>
        </tr>"""
        for i, v in enumerate(vendors)
    ) or '<tr><td colspan="2" style="padding:12px;color:#6b7280;">No open vendor balances</td></tr>'

    overdue = int(summary.get("overdue_count") or 0)
    due_week = int(summary.get("due_this_week_count") or 0)
    high_risk = int(summary.get("high_risk_flags") or 0)
    pending = int(summary.get("pending_approvals") or 0)
    gstr1 = summary.get("gstr1_due") or ""
    gstr3b = summary.get("gstr3b_due") or ""
    flag_breakdown_html = _flag_breakdown_html(summary)
    highest_risk_html = _highest_risk_html(summary)

    return f"""<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f3f4f6;font-family:Segoe UI,Arial,sans-serif;color:#111827;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;border:1px solid #e5e7eb;">
<tr><td style="background:#1e40af;padding:20px 28px;">
  <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#bfdbfe;">Gnanova Finance OS — India</div>
  <div style="font-size:22px;font-weight:700;color:#fff;margin-top:4px;">Daily CFO Briefing</div>
  <div style="font-size:13px;color:#93c5fd;margin-top:6px;">{company_name} · {summary.get('period_label') or summary.get('as_of')} · IST 08:00</div>
</td></tr>
<tr><td style="padding:24px 28px;">
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
  <td width="50%" style="padding:0 8px 12px 0;vertical-align:top;">
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px;">
      <div style="font-size:11px;color:#1e40af;text-transform:uppercase;">Total outstanding AP</div>
      <div style="font-size:22px;font-weight:700;margin-top:4px;">{_fmt_inr(float(summary.get('total_outstanding') or 0))}</div>
    </div>
  </td>
  <td width="50%" style="padding:0 0 12px 8px;vertical-align:top;">
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:14px;">
      <div style="font-size:11px;color:#c2410c;text-transform:uppercase;">Due this week</div>
      <div style="font-size:22px;font-weight:700;margin-top:4px;">{due_week} invoices</div>
      <div style="font-size:12px;color:#9a3412;margin-top:2px;">{_fmt_inr(float(summary.get('due_this_week_amount') or 0))}</div>
    </div>
  </td>
</tr>
<tr>
  <td width="50%" style="padding:0 8px 12px 0;vertical-align:top;">
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px;">
      <div style="font-size:11px;color:#b91c1c;text-transform:uppercase;">Overdue</div>
      <div style="font-size:22px;font-weight:700;margin-top:4px;">{overdue} invoices</div>
      <div style="font-size:12px;color:#991b1b;margin-top:2px;">{_fmt_inr(float(summary.get('overdue_amount') or 0))}</div>
    </div>
  </td>
  <td width="50%" style="padding:0 0 12px 8px;vertical-align:top;">
    <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;padding:14px;">
      <div style="font-size:11px;color:#7e22ce;text-transform:uppercase;">High risk flags</div>
      <div style="font-size:22px;font-weight:700;margin-top:4px;">{high_risk}</div>
      {flag_breakdown_html}
    </div>
  </td>
</tr>
</table>

<div style="margin-top:4px;padding:14px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;">
  <div style="font-size:13px;font-weight:600;margin-bottom:8px;color:#15803d;">GST Input Tax Credit</div>
  <table width="100%">
    <tr><td style="font-size:12px;color:#166534;">ITC Eligible</td><td style="text-align:right;font-weight:600;color:#166534;">{_fmt_inr(float(summary.get('itc_eligible') or 0))}</td></tr>
    <tr><td style="font-size:12px;color:#b91c1c;">ITC Blocked (Sec 17(5))</td><td style="text-align:right;font-weight:600;color:#b91c1c;">{_fmt_inr(float(summary.get('itc_blocked') or 0))}</td></tr>
    <tr><td style="font-size:12px;color:#92400e;">TDS Payable</td><td style="text-align:right;font-weight:600;color:#92400e;">{_fmt_inr(float(summary.get('tds_payable') or 0))}</td></tr>
  </table>
</div>

<div style="margin-top:12px;padding:14px;background:#fefce8;border-radius:8px;border:1px solid #fde68a;">
  <div style="font-size:13px;font-weight:600;margin-bottom:8px;color:#92400e;">Upcoming GST Filing Deadlines</div>
  <table width="100%">
    <tr><td style="font-size:12px;color:#78350f;">GSTR-1 due</td><td style="text-align:right;font-weight:600;font-size:12px;">{gstr1}</td></tr>
    <tr><td style="font-size:12px;color:#78350f;">GSTR-3B due</td><td style="text-align:right;font-weight:600;font-size:12px;">{gstr3b}</td></tr>
  </table>
</div>

<div style="margin-top:12px;padding:14px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
  <div style="font-size:11px;color:#6b7280;text-transform:uppercase;">Pending approvals</div>
  <div style="font-size:20px;font-weight:700;margin-top:4px;">{pending}</div>
</div>

<div style="margin-top:20px;">
  <div style="font-size:14px;font-weight:600;margin-bottom:8px;">Top 3 vendors by outstanding</div>
  <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
    <thead><tr style="background:#f9fafb;">
      <th align="left" style="padding:8px 12px;font-size:11px;color:#6b7280;text-transform:uppercase;">Vendor</th>
      <th align="right" style="padding:8px 12px;font-size:11px;color:#6b7280;text-transform:uppercase;">Outstanding</th>
    </tr></thead>
    <tbody>{vendor_rows}</tbody>
  </table>
</div>
{highest_risk_html}
<p style="margin:20px 0 0;font-size:12px;color:#6b7280;">Ref: Gnanova Finance OS India | Automated daily briefing (EC2 cron)</p>
</td></tr></table></td></tr></table>
</body></html>"""


def process_company(company: dict[str, Any], *, days: int, send: bool, logger) -> dict[str, Any]:
    company_id = company["id"]
    name = company.get("name") or company_id
    logger.info("Processing India company %s (%s)", name, company_id)

    try:
        summary = build_summary_for_company(company_id, days=days)
    except Exception as e:
        logger.exception("Summary failed for %s", company_id)
        return {"company_id": company_id, "ok": False, "error": str(e)}

    html = render_india_html(summary, company_name=name)
    overdue = int(summary.get("overdue_count") or 0)
    subject = (
        f"Daily CFO Briefing - {_fmt_inr_ascii(float(summary.get('total_outstanding') or 0))} AP - "
        f"{overdue} overdue - {name}"
    )
    plain_parts = [
        f"{name}",
        f"Outstanding: {_fmt_inr(float(summary.get('total_outstanding') or 0))}",
        f"Overdue: {overdue}",
        f"High risk: {summary.get('high_risk_flags')}",
    ]
    for b in summary.get("high_risk_flag_breakdown") or []:
        plain_parts.append(f"  • {b.get('label')}: {int(b.get('count') or 0)}")
    plain_parts.extend(
        [
            f"ITC eligible: {_fmt_inr(float(summary.get('itc_eligible') or 0))}",
            f"ITC blocked: {_fmt_inr(float(summary.get('itc_blocked') or 0))}",
            f"TDS: {_fmt_inr(float(summary.get('tds_payable') or 0))}",
            f"GSTR-3B: {summary.get('gstr3b_due')}",
        ]
    )
    if summary.get("highest_risk_invoices"):
        plain_parts.append("Highest risk invoices this period:")
        for r in summary["highest_risk_invoices"]:
            plain_parts.append(
                f"  - {r.get('invoice_number')} ({r.get('vendor_name')}) — "
                f"{r.get('flag_label')} — {_fmt_inr(float(r.get('amount') or 0))}"
            )
    plain = "\n".join(plain_parts) + "\n"
    to_email = resolve_cfo_email(company)
    result: dict[str, Any] = {
        "company_id": company_id,
        "company_name": name,
        "to": to_email or None,
        "subject": subject,
        "total_outstanding": summary.get("total_outstanding"),
        "overdue_count": overdue,
        "itc_eligible": summary.get("itc_eligible"),
        "itc_blocked": summary.get("itc_blocked"),
        "tds_payable": summary.get("tds_payable"),
        "gstr3b_due": summary.get("gstr3b_due"),
        "ok": True,
        "sent": False,
    }
    if not send:
        logger.info("[--test] Would send to %s | %s", to_email or "(no CFO email)", subject)
        result["html_preview_chars"] = len(html)
        return result
    if not to_email:
        result["ok"] = False
        result["error"] = "CFO email missing (company_settings.cfo_email)"
        return result
    sent = send_email(to_email, subject, text=plain, html=html, logger=logger)
    result["sent"] = sent
    if not sent:
        result["ok"] = False
        result["error"] = "email_send_failed"
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Daily CFO Email — India (EC2 cron)")
    parser.add_argument("--test", action="store_true")
    parser.add_argument("--send", action="store_true")
    parser.add_argument("--company-id", default=None)
    parser.add_argument("--days", type=int, default=7)
    args = parser.parse_args(argv)

    env_path = load_env()
    logger = setup_logger(SCRIPT_NAME)
    logger.info("Started %s | env=%s | test=%s", SCRIPT_NAME, env_path, args.test)
    send = (not args.test) or args.send
    exit_code = 0
    results: list[dict[str, Any]] = []

    try:
        companies = fetch_india_companies(args.company_id)
        if not companies:
            logger.warning("No India companies found")
            print(json.dumps({"ok": True, "companies": 0, "results": []}, indent=2))
            return 0
        for company in companies:
            try:
                r = process_company(company, days=args.days, send=send, logger=logger)
                results.append(r)
                if not r.get("ok"):
                    exit_code = 1
            except Exception as e:
                logger.exception("Unhandled for %s", company.get("id"))
                results.append({"company_id": company.get("id"), "ok": False, "error": str(e)})
                exit_code = 1
                try:
                    alert_admin(SCRIPT_NAME, e, logger)
                except Exception:
                    pass
        print(json.dumps({"ok": exit_code == 0, "script": SCRIPT_NAME, "test": args.test, "sent": send, "companies": len(companies), "results": results}, indent=2, default=str))
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
