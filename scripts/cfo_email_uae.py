#!/usr/bin/env python3
"""
SCRIPT 1 — Daily CFO Email (UAE / Dubai)

Deploy:  /home/ubuntu/finreportaicommercial/scripts/cfo_email_uae.py
Cron:    0 4 * * *   (= 08:00 Asia/Dubai, no DST)

What it does:
  1. Loads secrets from backend/.env
  2. Fetches active UAE companies from Supabase (market = uae | AE)
  3. Builds AP daily summary per company (same metrics as /api/ap/cfo-daily-summary)
  4. Renders AED HTML email (outstanding, due this week, overdue, VAT summary,
     high risk, pending approvals, top 3 vendors)
  5. Sends via Resend or SMTP to CFO_EMAIL (or CFO_EMAIL_BY_COMPANY[company_id])

Usage:
  # Dry run — build + print, do NOT send
  cd /home/ubuntu/finreportaicommercial
  python3 scripts/cfo_email_uae.py --test

  # Production send
  python3 scripts/cfo_email_uae.py

  # Single company
  python3 scripts/cfo_email_uae.py --company-id 0deaa402-f6a1-4c38-90e8-711f4fd0aa09 --test

  # Force send even with --test (rare)
  python3 scripts/cfo_email_uae.py --test --send
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

# Ensure scripts/ is importable for _gnanova_cron_common
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

SCRIPT_NAME = "cfo_email_uae"


def _fmt_aed(amount: float) -> str:
    return f"AED {float(amount or 0):,.2f}"


def fetch_uae_companies(company_id: str | None = None) -> list[dict[str, Any]]:
    """Active UAE companies. Filters by market / settings country when present."""
    sb = get_supabase_client()
    q = sb.table("companies").select(
        "id,name,slug,market,subscription_status,accounting_standard,admin_email"
    )
    if company_id:
        q = q.eq("id", company_id)
    rows = list((q.execute()).data or [])

    uae: list[dict[str, Any]] = []
    for row in rows:
        status = (row.get("subscription_status") or "active").lower()
        if status in ("cancelled", "canceled", "suspended", "inactive"):
            continue
        market = (row.get("market") or "").strip().lower()
        # Explicit India skip
        if market in ("india", "in"):
            continue
        # Prefer market=uae / ae; if market blank treat as UAE when asked for UAE script
        # (today all test companies are market=uae)
        if market and market not in ("uae", "ae", "dubai"):
            # Unknown market — check company_settings.country
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
                    continue
            except Exception:
                pass
        uae.append(row)

    return uae


def build_summary_for_company(company_id: str, days: int = 7) -> dict[str, Any]:
    """Reuse FastAPI service — same payload as POST /api/ap/cfo-daily-summary."""
    ensure_backend_on_path()
    from app.services.ap_cfo_daily_summary_service import build_cfo_daily_summary

    return build_cfo_daily_summary(company_id=company_id, days=days)


def estimate_vat_summary(company_id: str) -> dict[str, float]:
    """
    Lightweight VAT briefing for UAE email:
      - open_ap_tax: sum of tax_amount on open invoices (input VAT approximate)
      - overdue_tax: tax on overdue open invoices
    Falls back to zeros if tax_amount column/query fails.
    """
    sb = get_supabase_client()
    try:
        res = (
            sb.table("invoices")
            .select("status,payment_status,due_date,tax_amount,total_amount")
            .eq("company_id", company_id)
            .execute()
        )
        rows = list(res.data or [])
    except Exception:
        return {"open_ap_tax": 0.0, "overdue_tax": 0.0}

    from datetime import date

    today = date.today()
    open_tax = 0.0
    overdue_tax = 0.0
    for inv in rows:
        st = (inv.get("status") or "").lower()
        ps = (inv.get("payment_status") or "").lower()
        if st in ("paid", "rejected") or ps in ("paid", "cancelled"):
            continue
        tax = float(inv.get("tax_amount") or 0)
        open_tax += tax
        due = (inv.get("due_date") or "")[:10]
        if due and due < today.isoformat():
            overdue_tax += tax
    return {"open_ap_tax": round(open_tax, 2), "overdue_tax": round(overdue_tax, 2)}


def render_uae_html(
    summary: dict[str, Any],
    *,
    company_name: str,
    vat: dict[str, float],
) -> str:
    """UAE/AED HTML template (n8n parity + VAT summary block)."""
    currency = summary.get("currency") or "AED"
    vendors = (summary.get("top_vendors") or [])[:3]
    vendor_rows = "".join(
        f"""
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">{i + 1}. {v.get('vendor_name') or 'Unknown'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">{_fmt_aed(float(v.get('amount') or 0))}</td>
        </tr>"""
        for i, v in enumerate(vendors)
    ) or '<tr><td colspan="2" style="padding:12px;color:#6b7280;">No open vendor balances</td></tr>'

    overdue = int(summary.get("overdue_count") or 0)
    due_week = int(summary.get("due_this_week_count") or 0)
    high_risk = int(summary.get("high_risk_flags") or 0)
    pending = int(summary.get("pending_approvals") or 0)

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Daily CFO Briefing — UAE</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr>
          <td style="background:#0f766e;padding:20px 28px;">
            <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#ccfbf1;">Gnanova Finance OS — UAE</div>
            <div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:4px;">Daily CFO Briefing</div>
            <div style="font-size:13px;color:#99f6e4;margin-top:6px;">{company_name} · {summary.get('period_label') or summary.get('as_of')} · Dubai 08:00</div>
          </td>
        </tr>
        <tr><td style="padding:24px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="50%" style="padding:0 8px 12px 0;vertical-align:top;">
                <div style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;padding:14px;">
                  <div style="font-size:11px;color:#0f766e;text-transform:uppercase;">Total outstanding</div>
                  <div style="font-size:22px;font-weight:700;margin-top:4px;">{_fmt_aed(float(summary.get('total_outstanding') or 0))}</div>
                </div>
              </td>
              <td width="50%" style="padding:0 0 12px 8px;vertical-align:top;">
                <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:14px;">
                  <div style="font-size:11px;color:#c2410c;text-transform:uppercase;">Due this week</div>
                  <div style="font-size:22px;font-weight:700;margin-top:4px;">{due_week}</div>
                  <div style="font-size:12px;color:#9a3412;margin-top:2px;">{_fmt_aed(float(summary.get('due_this_week_amount') or 0))} due</div>
                </div>
              </td>
            </tr>
            <tr>
              <td width="50%" style="padding:0 8px 12px 0;vertical-align:top;">
                <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px;">
                  <div style="font-size:11px;color:#b91c1c;text-transform:uppercase;">Overdue</div>
                  <div style="font-size:22px;font-weight:700;margin-top:4px;">{overdue}</div>
                  <div style="font-size:12px;color:#991b1b;margin-top:2px;">{_fmt_aed(float(summary.get('overdue_amount') or 0))}</div>
                </div>
              </td>
              <td width="50%" style="padding:0 0 12px 8px;vertical-align:top;">
                <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;padding:14px;">
                  <div style="font-size:11px;color:#7e22ce;text-transform:uppercase;">High risk flags</div>
                  <div style="font-size:22px;font-weight:700;margin-top:4px;">{high_risk}</div>
                </div>
              </td>
            </tr>
          </table>

          <div style="margin-top:4px;padding:14px;background:#ecfeff;border-radius:8px;border:1px solid #a5f3fc;">
            <div style="font-size:13px;font-weight:600;margin-bottom:8px;color:#0e7490;">VAT summary (open AP)</div>
            <table width="100%">
              <tr>
                <td style="font-size:12px;color:#155e75;">Input VAT on open invoices</td>
                <td style="text-align:right;font-weight:600;">{_fmt_aed(vat.get('open_ap_tax', 0))}</td>
              </tr>
              <tr>
                <td style="font-size:12px;color:#155e75;">VAT on overdue invoices</td>
                <td style="text-align:right;font-weight:600;">{_fmt_aed(vat.get('overdue_tax', 0))}</td>
              </tr>
            </table>
            <div style="font-size:11px;color:#678;margin-top:6px;">Currency: {currency}. Drill into GST/VAT Recon for FTA box detail.</div>
          </div>

          <div style="margin-top:12px;padding:14px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
            <div style="font-size:11px;color:#6b7280;text-transform:uppercase;">Pending approvals</div>
            <div style="font-size:20px;font-weight:700;margin-top:4px;">{pending}</div>
          </div>

          <div style="margin-top:20px;">
            <div style="font-size:14px;font-weight:600;margin-bottom:8px;">Top 3 vendors by outstanding</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
              <thead>
                <tr style="background:#f9fafb;">
                  <th align="left" style="padding:8px 12px;font-size:11px;color:#6b7280;text-transform:uppercase;">Vendor</th>
                  <th align="right" style="padding:8px 12px;font-size:11px;color:#6b7280;text-transform:uppercase;">Outstanding</th>
                </tr>
              </thead>
              <tbody>{vendor_rows}</tbody>
            </table>
          </div>

          <p style="margin:20px 0 0;font-size:12px;color:#6b7280;line-height:1.5;">
            Open AP InvoiceFlow → CFO Dashboard for drill-down.
            Ref: Gnanova Finance OS UAE · Automated daily briefing (EC2 cron).
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def process_company(
    company: dict[str, Any],
    *,
    days: int,
    send: bool,
    logger,
) -> dict[str, Any]:
    company_id = company["id"]
    name = company.get("name") or company_id
    logger.info("Processing company %s (%s)", name, company_id)

    try:
        summary = build_summary_for_company(company_id, days=days)
    except Exception as e:
        logger.exception("Summary failed for %s", company_id)
        return {"company_id": company_id, "ok": False, "error": str(e)}

    vat = estimate_vat_summary(company_id)
    html = render_uae_html(summary, company_name=name, vat=vat)
    subject = (
        f"Daily CFO Briefing - {_fmt_aed(float(summary.get('total_outstanding') or 0))} outstanding - "
        f"{int(summary.get('overdue_count') or 0)} overdue - {name}"
    )
    plain = (
        f"{name}\n"
        f"Outstanding: {_fmt_aed(float(summary.get('total_outstanding') or 0))}\n"
        f"Due this week: {summary.get('due_this_week_count')}\n"
        f"Overdue: {summary.get('overdue_count')} ({_fmt_aed(float(summary.get('overdue_amount') or 0))})\n"
        f"High risk: {summary.get('high_risk_flags')}\n"
        f"Pending approvals: {summary.get('pending_approvals')}\n"
        f"VAT on open AP: {_fmt_aed(vat.get('open_ap_tax', 0))}\n"
    )

    to_email = resolve_cfo_email(company)
    result: dict[str, Any] = {
        "company_id": company_id,
        "company_name": name,
        "to": to_email or None,
        "subject": subject,
        "total_outstanding": summary.get("total_outstanding"),
        "overdue_count": summary.get("overdue_count"),
        "pending_approvals": summary.get("pending_approvals"),
        "top_vendors": summary.get("top_vendors"),
        "vat": vat,
        "ok": True,
        "sent": False,
        "cfo_email_source": (
            "company_settings/admin_email"
            if to_email and to_email != (os.getenv("CFO_EMAIL") or "").strip()
            else ("env_CFO_EMAIL" if to_email else "missing")
        ),
    }

    if not send:
        logger.info("[--test] Would send to %s | %s", to_email or "(no CFO_EMAIL)", subject)
        result["html_preview_chars"] = len(html)
        return result

    if not to_email:
        logger.error("No CFO_EMAIL for company %s — skip send", company_id)
        result["ok"] = False
        result["error"] = "CFO_EMAIL not set"
        return result

    sent = send_email(to_email, subject, text=plain, html=html, logger=logger)
    result["sent"] = sent
    if not sent:
        result["ok"] = False
        result["error"] = "email_send_failed"
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Daily CFO Email — UAE (EC2 cron)")
    parser.add_argument(
        "--test",
        action="store_true",
        help="Run once: build summaries and log them without sending email",
    )
    parser.add_argument(
        "--send",
        action="store_true",
        help="With --test, still send email (useful for one-off live smoke)",
    )
    parser.add_argument("--company-id", default=None, help="Limit to one company UUID")
    parser.add_argument("--days", type=int, default=7, help="Activity window (default 7)")
    args = parser.parse_args(argv)

    env_path = load_env()
    logger = setup_logger(SCRIPT_NAME)
    logger.info("Started %s | env=%s | test=%s", SCRIPT_NAME, env_path, args.test)

    send = (not args.test) or args.send
    exit_code = 0
    results: list[dict[str, Any]] = []

    try:
        companies = fetch_uae_companies(args.company_id)
        if not companies:
            logger.warning("No UAE companies found — nothing to do")
            print(json.dumps({"ok": True, "companies": 0, "results": []}, indent=2))
            return 0

        logger.info("Found %d UAE company(ies)", len(companies))
        for company in companies:
            try:
                r = process_company(company, days=args.days, send=send, logger=logger)
                results.append(r)
                if not r.get("ok"):
                    exit_code = 1
            except Exception as e:
                # Never crash the whole run — log + continue
                logger.exception("Unhandled error for company %s", company.get("id"))
                results.append({"company_id": company.get("id"), "ok": False, "error": str(e)})
                exit_code = 1
                try:
                    alert_admin(SCRIPT_NAME, e, logger)
                except Exception:
                    logger.exception("alert_admin failed")

        payload = {
            "ok": exit_code == 0,
            "script": SCRIPT_NAME,
            "test": args.test,
            "sent": send,
            "companies": len(companies),
            "results": results,
        }
        print(json.dumps(payload, indent=2, default=str))
        logger.info("Finished %s ok=%s", SCRIPT_NAME, exit_code == 0)
        return exit_code

    except Exception as e:
        logger.exception("Fatal error in %s", SCRIPT_NAME)
        try:
            alert_admin(SCRIPT_NAME, e, logger)
        except Exception:
            logger.exception("alert_admin failed")
        print(json.dumps({"ok": False, "error": str(e)}, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
