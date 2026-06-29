"""AP dashboard metrics + Claude-generated insight cards from Supabase invoices."""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import date, datetime
from typing import Any

logger = logging.getLogger(__name__)


def _get_ap_supabase():
    from app.core.supabase import get_supabase
    return get_supabase()


def _invoice_billed(inv: dict[str, Any]) -> float:
    total = float(inv.get("total_amount") or 0)
    if total > 0:
        return total
    sub = float(inv.get("subtotal_amount") or inv.get("amount") or 0)
    tax = float(inv.get("tax_amount") or inv.get("vat_amount") or 0)
    return sub + tax


def _parse_date(val: str | None) -> date | None:
    if not val:
        return None
    try:
        return date.fromisoformat(str(val)[:10])
    except ValueError:
        return None


def _fetch_invoices(company_id: str | None) -> list[dict[str, Any]]:
    sb = _get_ap_supabase()
    q = sb.table("invoices").select(
        "id,vendor_name,total_amount,subtotal_amount,tax_amount,vat_amount,"
        "status,payment_status,due_date,invoice_date,paid_date,paid_at,"
        "approval_status,je_posted,company_id"
    )
    if company_id:
        q = q.eq("company_id", company_id)
    res = q.execute()
    return list(res.data or [])


def _compute_metrics(invoices: list[dict[str, Any]]) -> dict[str, Any]:
    today = date.today()
    today_s = today.isoformat()

    total_billed = sum(_invoice_billed(i) for i in invoices)
    paid_invoices = [i for i in invoices if (i.get("status") or "") == "Paid"]
    total_paid = sum(_invoice_billed(i) for i in paid_invoices)
    open_balance = max(0.0, total_billed - total_paid)

    overdue_rows: list[dict[str, Any]] = []
    for inv in invoices:
        st = (inv.get("status") or "").strip()
        ps = (inv.get("payment_status") or "").strip().lower()
        if st == "Paid":
            continue
        due = _parse_date(inv.get("due_date"))
        is_overdue = ps == "overdue" or (
            due is not None
            and due < today
            and st in ("Approved", "Overdue", "Processing", "On Hold", "Queried")
        )
        if is_overdue:
            overdue_rows.append(inv)

    overdue_amount = sum(_invoice_billed(i) for i in overdue_rows)
    overdue_count = len(overdue_rows)
    overdue_pct = (overdue_amount / open_balance * 100) if open_balance > 0 else 0.0

    disputed_rows = [
        i for i in invoices
        if (i.get("status") or "") in ("Queried", "On Hold", "Disputed")
    ]
    disputed_count = len(disputed_rows)
    disputed_amount = sum(_invoice_billed(i) for i in disputed_rows)

    pending_rows = [
        i for i in invoices
        if (i.get("status") or "") == "Processing"
        or (i.get("approval_status") or "").lower() == "pending"
    ]
    pending_approval_count = len(pending_rows)
    pending_amount = sum(_invoice_billed(i) for i in pending_rows)

    recon_rows = [
        i for i in invoices
        if (i.get("status") or "") == "Approved" and not bool(i.get("je_posted"))
    ]
    recon_mismatch_count = len(recon_rows)
    recon_mismatch_amount = sum(_invoice_billed(i) for i in recon_rows)

    vendor_totals: dict[str, dict[str, Any]] = {}
    for inv in invoices:
        if (inv.get("status") or "") == "Paid":
            continue
        vn = (inv.get("vendor_name") or "Unknown").strip()
        vendor_totals.setdefault(vn, {"vendor_name": vn, "total": 0.0, "invoice_count": 0})
        vendor_totals[vn]["total"] += _invoice_billed(inv)
        vendor_totals[vn]["invoice_count"] += 1

    top_3 = sorted(vendor_totals.values(), key=lambda x: x["total"], reverse=True)[:3]
    top_3_total = sum(v["total"] for v in top_3)
    top_3_pct = (top_3_total / open_balance * 100) if open_balance > 0 else 0.0

    dpo_days: list[int] = []
    for inv in invoices:
        inv_d = _parse_date(inv.get("invoice_date"))
        if not inv_d:
            continue
        paid_raw = inv.get("paid_date") or inv.get("paid_at")
        end_d = _parse_date(str(paid_raw) if paid_raw else today_s) or today
        dpo_days.append((end_d - inv_d).days)
    dpo = sum(dpo_days) / len(dpo_days) if dpo_days else 0.0

    aging = {
        "current": 0.0,
        "days_1_30": 0.0,
        "days_31_60": 0.0,
        "days_61_90": 0.0,
        "days_90_plus": 0.0,
    }
    for inv in invoices:
        if (inv.get("status") or "") == "Paid":
            continue
        amt = _invoice_billed(inv)
        due = _parse_date(inv.get("due_date"))
        if not due:
            aging["current"] += amt
            continue
        delta = (today - due).days
        if delta < 0:
            aging["current"] += amt
        elif delta <= 30:
            aging["days_1_30"] += amt
        elif delta <= 60:
            aging["days_31_60"] += amt
        elif delta <= 90:
            aging["days_61_90"] += amt
        else:
            aging["days_90_plus"] += amt

    payment_rate = (total_paid / total_billed * 100) if total_billed > 0 else 0.0

    return {
        "total_billed": round(total_billed, 2),
        "total_paid": round(total_paid, 2),
        "open_balance": round(open_balance, 2),
        "overdue_amount": round(overdue_amount, 2),
        "overdue_count": overdue_count,
        "overdue_pct": round(overdue_pct, 1),
        "disputed_count": disputed_count,
        "disputed_amount": round(disputed_amount, 2),
        "pending_approval_count": pending_approval_count,
        "pending_amount": round(pending_amount, 2),
        "recon_mismatch_count": recon_mismatch_count,
        "recon_mismatch_amount": round(recon_mismatch_amount, 2),
        "top_3_vendors": top_3,
        "top_3_total": round(top_3_total, 2),
        "top_3_pct": round(top_3_pct, 1),
        "dpo": round(dpo, 1),
        "aging_buckets": {k: round(v, 2) for k, v in aging.items()},
        "payment_rate_pct": round(payment_rate, 1),
        "invoice_count": len(invoices),
    }


def _mock_empty_response() -> dict[str, Any]:
    return {
        "insights": [],
        "summary": {
            "total_billed": 0,
            "total_paid": 0,
            "open_balance": 0,
            "overdue_amount": 0,
            "dpo": 0,
            "payment_rate_pct": 0,
        },
        "empty": True,
        "message": "No AP data yet — upload invoices to see insights",
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }


def _mock_insights(metrics: dict[str, Any]) -> dict[str, Any]:
    """Fallback when Claude unavailable."""
    m = metrics
    return {
        "insights": [
            {
                "id": "overdue",
                "title": f"Overdue posture: {m['overdue_pct']:.1f}% of open AP",
                "priority": "HIGH" if m["overdue_pct"] > 10 else "MEDIUM",
                "icon": "alert",
                "amount_at_risk": m["overdue_amount"],
                "actions": [
                    f"Clear AED {m['overdue_amount']:,.0f} across {m['overdue_count']} overdue bills",
                    "Prioritise vendors with due dates past 30 days",
                    "Schedule payments this week for approved overdue items",
                ],
            },
            {
                "id": "vendors",
                "title": f"Vendor concentration: top 3 = {m['top_3_pct']:.1f}% of AP",
                "priority": "MEDIUM",
                "icon": "vendor",
                "amount_at_risk": m["top_3_total"],
                "actions": [
                    f"Review top vendor exposure of AED {m['top_3_total']:,.0f}",
                    "Validate payment terms on concentrated suppliers",
                    "Diversify spend where contracts allow",
                ],
            },
            {
                "id": "recon",
                "title": f"Reconciliation: {m['recon_mismatch_count']} mismatched",
                "priority": "HIGH" if m["recon_mismatch_count"] else "INFO",
                "icon": "recon",
                "amount_at_risk": m["recon_mismatch_amount"],
                "actions": [
                    f"Post AED {m['recon_mismatch_amount']:,.0f} approved invoices to GL",
                    "Run approve-and-post for unmatched JE rows",
                    "Reconcile before month-end close",
                ],
            },
            {
                "id": "aging",
                "title": f"90+ day aging: AED {m['aging_buckets']['days_90_plus']:,.0f}",
                "priority": "MEDIUM" if m["aging_buckets"]["days_90_plus"] > 0 else "INFO",
                "icon": "aging",
                "amount_at_risk": m["aging_buckets"]["days_90_plus"],
                "actions": [
                    f"Escalate {m['aging_buckets']['days_90_plus']:,.0f} AED in 90+ bucket",
                    "Confirm dispute status on long-outstanding items",
                    "Set payment run for 61–90 day bucket this fortnight",
                ],
            },
        ],
        "summary": {
            "total_billed": m["total_billed"],
            "total_paid": m["total_paid"],
            "open_balance": m["open_balance"],
            "overdue_amount": m["overdue_amount"],
            "dpo": m["dpo"],
            "payment_rate_pct": m["payment_rate_pct"],
        },
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }


def _claude_insights(metrics: dict[str, Any]) -> dict[str, Any]:
    import anthropic

    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")

    m = metrics
    ab = m["aging_buckets"]
    top_vendors_str = ", ".join(
        f"{v['vendor_name']} (AED {v['total']:,.0f}, {v['invoice_count']} inv)"
        for v in m["top_3_vendors"]
    ) or "none"

    prompt = f"""You are a senior AP Controller for a UAE company.
Analyze this AP data and generate exactly 4 specific recommended action cards.

AP DATA:
- Total billed: AED {m['total_billed']:,.0f}
- Open balance: AED {m['open_balance']:,.0f}
- Total paid: AED {m['total_paid']:,.0f} ({m['payment_rate_pct']:.1f}% payment rate)
- Overdue: AED {m['overdue_amount']:,.0f} ({m['overdue_pct']:.1f}% of open AP)
  {m['overdue_count']} bills past due
- Average DPO: {m['dpo']:.1f} days
- Disputed invoices: {m['disputed_count']} worth AED {m['disputed_amount']:,.0f}
- Pending approval: {m['pending_approval_count']} worth AED {m['pending_amount']:,.0f}
- Recon mismatches: {m['recon_mismatch_count']} bills (AED {m['recon_mismatch_amount']:,.0f} not posted to GL)
- Top 3 vendors: {top_vendors_str} = {m['top_3_pct']:.1f}% of open AP
- Aging: Current={ab['current']:,.0f}, 1-30={ab['days_1_30']:,.0f}, 31-60={ab['days_31_60']:,.0f}, 61-90={ab['days_61_90']:,.0f}, 90+={ab['days_90_plus']:,.0f}

Generate exactly 4 insight cards with ids: overdue, vendors, recon, aging.
Each card must have specific AED amounts and counts. Be direct and actionable.

Return JSON only:
{{
  "insights": [
    {{"id": "overdue", "title": "...", "priority": "HIGH|MEDIUM|LOW|INFO", "icon": "alert", "amount_at_risk": 0, "actions": ["...", "...", "..."]}},
    {{"id": "vendors", "title": "...", "priority": "...", "icon": "vendor", "amount_at_risk": 0, "actions": ["...", "...", "..."]}},
    {{"id": "recon", "title": "...", "priority": "...", "icon": "recon", "amount_at_risk": 0, "actions": ["...", "...", "..."]}},
    {{"id": "aging", "title": "...", "priority": "...", "icon": "aging", "amount_at_risk": 0, "actions": ["...", "...", "..."]}}
  ],
  "summary": {{
    "total_billed": {m['total_billed']},
    "total_paid": {m['total_paid']},
    "open_balance": {m['open_balance']},
    "overdue_amount": {m['overdue_amount']},
    "dpo": {m['dpo']},
    "payment_rate_pct": {m['payment_rate_pct']}
  }}
}}"""

    client = anthropic.Anthropic(api_key=key)
    msg = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1200,
        temperature=0.3,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = msg.content[0].text.strip()
    if "```" in raw:
        raw = re.sub(r"^```(?:json)?\s*", "", raw.split("```")[1] if "```" in raw else raw)
        raw = raw.split("```")[0].strip()
    data = json.loads(raw)
    data["generated_at"] = datetime.utcnow().isoformat() + "Z"
    return data


def generate_ap_insights(*, workspace_id: str | None, company_id: str | None) -> dict[str, Any]:
    try:
        invoices = _fetch_invoices(company_id)
    except RuntimeError as exc:
        logger.warning("AP insights — Supabase not configured: %s", exc)
        return _mock_empty_response()
    except Exception as exc:
        logger.exception("AP insights fetch failed")
        raise RuntimeError(f"Failed to load AP data: {exc}") from exc

    if not invoices:
        return _mock_empty_response()

    metrics = _compute_metrics(invoices)

    try:
        result = _claude_insights(metrics)
    except Exception as exc:
        logger.warning("Claude insights failed, using rule-based fallback: %s", exc)
        result = _mock_insights(metrics)

    result.setdefault("summary", {
        "total_billed": metrics["total_billed"],
        "total_paid": metrics["total_paid"],
        "open_balance": metrics["open_balance"],
        "overdue_amount": metrics["overdue_amount"],
        "dpo": metrics["dpo"],
        "payment_rate_pct": metrics["payment_rate_pct"],
    })
    result["empty"] = False
    result["metrics"] = metrics
    return result
