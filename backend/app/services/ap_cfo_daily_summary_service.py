"""Daily CFO AP summary — outstanding / due / overdue / risk / approvals / top vendors.

Mirrors frontend buildCfoSummary metrics plus the email briefing fields used by
n8n/daily-cfo-email.workflow.json.
"""
from __future__ import annotations

import logging
import os
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Optional

from app.core.supabase import get_supabase
from app.services.notification_service import send_notification

logger = logging.getLogger(__name__)

_CLOSED_STATUSES = {"paid", "rejected"}
_CLOSED_PAYMENT = {"paid", "cancelled"}


def _parse_date(value: Any) -> Optional[date]:
    if not value:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value)[:10]).date()
    except ValueError:
        return None


def _is_open(row: dict[str, Any]) -> bool:
    if (row.get("status") or "").strip().lower() in _CLOSED_STATUSES:
        return False
    if (row.get("payment_status") or "").strip().lower() in _CLOSED_PAYMENT:
        return False
    return True


def _fmt_money(currency: str, amount: float) -> str:
    return f"{currency} {amount:,.2f}"


def _render_html(summary: dict[str, Any]) -> str:
    currency = summary.get("currency") or "AED"
    vendors = (summary.get("top_vendors") or [])[:3]
    vendor_rows = "".join(
        f"""
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">{i + 1}. {v.get('vendor_name') or 'Unknown'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">{_fmt_money(currency, float(v.get('amount') or 0))}</td>
        </tr>"""
        for i, v in enumerate(vendors)
    ) or '<tr><td colspan="2" style="padding:12px;color:#6b7280;">No open vendor balances</td></tr>'

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr>
          <td style="background:#0f766e;padding:20px 28px;">
            <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#ccfbf1;">Gnanova Finance OS</div>
            <div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:4px;">Daily CFO Briefing</div>
            <div style="font-size:13px;color:#99f6e4;margin-top:6px;">{summary.get('period_label') or summary.get('as_of')} · Asia/Dubai 08:00</div>
          </td>
        </tr>
        <tr><td style="padding:24px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="50%" style="padding:0 8px 12px 0;vertical-align:top;">
                <div style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;padding:14px;">
                  <div style="font-size:11px;color:#0f766e;text-transform:uppercase;">Total outstanding</div>
                  <div style="font-size:22px;font-weight:700;margin-top:4px;">{_fmt_money(currency, float(summary.get('total_outstanding') or 0))}</div>
                </div>
              </td>
              <td width="50%" style="padding:0 0 12px 8px;vertical-align:top;">
                <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:14px;">
                  <div style="font-size:11px;color:#c2410c;text-transform:uppercase;">Due this week</div>
                  <div style="font-size:22px;font-weight:700;margin-top:4px;">{int(summary.get('due_this_week_count') or 0)}</div>
                  <div style="font-size:12px;color:#9a3412;margin-top:2px;">{_fmt_money(currency, float(summary.get('due_this_week_amount') or 0))} due</div>
                </div>
              </td>
            </tr>
            <tr>
              <td width="50%" style="padding:0 8px 12px 0;vertical-align:top;">
                <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px;">
                  <div style="font-size:11px;color:#b91c1c;text-transform:uppercase;">Overdue</div>
                  <div style="font-size:22px;font-weight:700;margin-top:4px;">{int(summary.get('overdue_count') or 0)}</div>
                  <div style="font-size:12px;color:#991b1b;margin-top:2px;">{_fmt_money(currency, float(summary.get('overdue_amount') or 0))}</div>
                </div>
              </td>
              <td width="50%" style="padding:0 0 12px 8px;vertical-align:top;">
                <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;padding:14px;">
                  <div style="font-size:11px;color:#7e22ce;text-transform:uppercase;">High risk flags</div>
                  <div style="font-size:22px;font-weight:700;margin-top:4px;">{int(summary.get('high_risk_flags') or 0)}</div>
                </div>
              </td>
            </tr>
          </table>
          <div style="margin-top:8px;padding:14px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
            <div style="font-size:11px;color:#6b7280;text-transform:uppercase;">Pending approvals</div>
            <div style="font-size:20px;font-weight:700;margin-top:4px;">{int(summary.get('pending_approvals') or 0)}</div>
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
            Ref: Gnanova Finance OS · Automated daily briefing.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def build_cfo_daily_summary(
    company_id: Optional[str] = None,
    days: int = 7,
    market: Optional[str] = None,
) -> dict[str, Any]:
    """Build daily briefing payload (open AP + period activity).

    market: 'IN' | 'AE' | None — when IN, adds GST ITC / TDS / GSTR due fields
    and defaults currency display to INR.
    """
    today = date.today()
    week_end = today + timedelta(days=7)
    period_start = today - timedelta(days=max(1, days))
    period_start_iso = period_start.isoformat()
    today_iso = today.isoformat()
    market_norm = (market or "").strip().upper()
    is_india = market_norm in ("IN", "INDIA")

    sb = get_supabase()
    select_cols = (
        "id,invoice_number,vendor_name,total_amount,currency,due_date,status,"
        "payment_status,risk_score,risk_flags,created_at,company_id,"
        "gst_amount,tds_amount,reverse_charge,hsn_sac_code,ifrs_category,description,gstin"
    )
    q = sb.table("invoices").select(select_cols)
    if company_id:
        q = q.eq("company_id", company_id)
    try:
        rows = list((q.execute()).data or [])
    except Exception:
        # Columns may be missing before India migration — fall back
        q2 = sb.table("invoices").select(
            "id,invoice_number,vendor_name,total_amount,currency,due_date,status,"
            "payment_status,risk_score,risk_flags,created_at,company_id"
        )
        if company_id:
            q2 = q2.eq("company_id", company_id)
        rows = list((q2.execute()).data or [])

    outstanding = 0.0
    due_week_count = 0
    due_week_amount = 0.0
    overdue_count = 0
    overdue_amount = 0.0
    high_risk_flags = 0
    pending_approvals = 0
    vendor_map: dict[str, float] = defaultdict(float)
    currencies: list[str] = []
    itc_eligible = 0.0
    itc_blocked = 0.0
    tds_payable = 0.0

    period_invoices = 0
    period_amount = 0.0
    approved = 0
    rejected = 0
    paid = 0
    pending_period = 0

    blocked_hints = (
        "motor vehicle",
        "car ",
        "entertainment",
        "food",
        "beverage",
        "restaurant",
        "club",
        "personal",
        "sec 17",
    )

    for inv in rows:
        amt = float(inv.get("total_amount") or 0)
        currency = (inv.get("currency") or "").strip()
        if currency:
            currencies.append(currency)

        created = str(inv.get("created_at") or "")[:10]
        if created and created >= period_start_iso:
            period_invoices += 1
            period_amount += amt
            st = inv.get("status") or ""
            if st == "Approved":
                approved += 1
            elif st == "Rejected":
                rejected += 1
            elif st == "Paid":
                paid += 1
            else:
                pending_period += 1

        if is_india:
            gst = float(inv.get("gst_amount") or 0)
            tds_payable += float(inv.get("tds_amount") or 0)
            if gst > 0:
                text = f"{inv.get('ifrs_category') or ''} {inv.get('description') or ''} {inv.get('hsn_sac_code') or ''}".lower()
                if any(h in text for h in blocked_hints):
                    itc_blocked += gst
                else:
                    itc_eligible += gst

        if not _is_open(inv):
            continue

        outstanding += amt
        due = _parse_date(inv.get("due_date"))
        if due:
            if due < today:
                overdue_count += 1
                overdue_amount += amt
            elif due <= week_end:
                due_week_count += 1
                due_week_amount += amt

        st = inv.get("status") or ""
        if st in ("Processing", "On Hold", "Queried"):
            pending_approvals += 1

        risk = str(inv.get("risk_score") or "").lower()
        flags = inv.get("risk_flags")
        flag_list = flags if isinstance(flags, list) else []
        if risk in ("high", "critical"):
            high_risk_flags += max(1, len(flag_list) or 1)
        else:
            for f in flag_list:
                sev = ""
                if isinstance(f, dict):
                    sev = str(f.get("severity") or "").lower()
                if sev in ("high", "critical"):
                    high_risk_flags += 1

        vendor = (inv.get("vendor_name") or "Unknown").strip() or "Unknown"
        vendor_map[vendor] += amt

    top_vendors = [
        {"vendor_name": name, "amount": round(amount, 2), "count": 0}
        for name, amount in sorted(vendor_map.items(), key=lambda x: -x[1])[:3]
    ]

    if currencies:
        counts: dict[str, int] = defaultdict(int)
        for c in currencies:
            counts[c] += 1
        currency = sorted(counts.items(), key=lambda x: -x[1])[0][0]
    else:
        currency = "INR" if is_india else "AED"

    # GSTR due dates (next month 11th / 20th)
    next_month = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
    month_name = next_month.strftime("%B %Y")
    gstr1_due = f"11th {month_name}"
    gstr3b_due = f"20th {month_name}"

    summary: dict[str, Any] = {
        "as_of": today_iso,
        "period_label": f"As of {today_iso} (activity last {days} days: {period_start_iso} – {today_iso})",
        "period_start": period_start_iso,
        "period_end": today_iso,
        "currency": currency,
        "market": "IN" if is_india else "AE",
        "total_outstanding": round(outstanding, 2),
        "due_this_week_count": due_week_count,
        "due_this_week_amount": round(due_week_amount, 2),
        "overdue_count": overdue_count,
        "overdue_amount": round(overdue_amount, 2),
        "high_risk_flags": high_risk_flags,
        "pending_approvals": pending_approvals,
        "top_vendors": top_vendors,
        "total_invoices": period_invoices,
        "total_amount": round(period_amount, 2),
        "approved": approved,
        "pending_approval": pending_period,
        "rejected": rejected,
        "paid": paid,
        "itc_eligible": round(itc_eligible, 2),
        "itc_blocked": round(itc_blocked, 2),
        "tds_payable": round(tds_payable, 2),
        "gstr1_due": gstr1_due,
        "gstr3b_due": gstr3b_due,
    }
    summary["html"] = _render_html(summary)
    if is_india:
        summary["subject"] = (
            f"Daily CFO Briefing - {_fmt_money('INR', outstanding)} AP - "
            f"{overdue_count} overdue"
        )
    else:
        summary["subject"] = (
            f"Daily CFO Briefing - {_fmt_money(currency, outstanding)} outstanding - "
            f"{overdue_count} overdue"
        )
    return summary


def send_cfo_daily_email(
    summary: dict[str, Any],
    to_email: Optional[str] = None,
) -> dict[str, Any]:
    """Send HTML briefing to CFO_EMAIL (or override)."""
    recipient = (to_email or os.getenv("CFO_EMAIL") or "").strip()
    if not recipient:
        return {"sent": False, "reason": "CFO_EMAIL not set", "to": None}

    plain = (
        f"Total outstanding: {summary.get('currency')} {summary.get('total_outstanding')}\n"
        f"Due this week: {summary.get('due_this_week_count')}\n"
        f"Overdue: {summary.get('overdue_count')}\n"
        f"High risk flags: {summary.get('high_risk_flags')}\n"
        f"Pending approvals: {summary.get('pending_approvals')}\n"
    )
    ok = send_notification(
        recipient,
        str(summary.get("subject") or "Daily CFO Briefing"),
        plain,
        html=str(summary.get("html") or ""),
    )
    return {"sent": ok, "to": recipient, "reason": None if ok else "send_failed"}
