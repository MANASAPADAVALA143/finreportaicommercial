"""Build vendor profiles and AP intelligence from historical invoice uploads."""

from __future__ import annotations

import logging
import statistics
import uuid
from collections import Counter, defaultdict
from datetime import datetime
from typing import Any

from app.core.supabase import get_supabase

logger = logging.getLogger(__name__)


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _parse_date(raw: Any) -> datetime | None:
    if not raw:
        return None
    s = str(raw).strip()[:10]
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def _mode_confidence(values: list[str]) -> tuple[str, float]:
    if not values:
        return "", 0.0
    counts = Counter(v for v in values if v)
    if not counts:
        return "", 0.0
    top, n = counts.most_common(1)[0]
    return top, round(100.0 * n / len(values), 1)


def _price_trend(dated_amounts: list[tuple[datetime, float]]) -> tuple[str, float]:
    if len(dated_amounts) < 4:
        return "stable", 0.0
    dated_amounts.sort(key=lambda x: x[0])
    mid = len(dated_amounts) // 2
    first = [a for _, a in dated_amounts[:mid]]
    second = [a for _, a in dated_amounts[mid:]]
    m1 = statistics.mean(first) if first else 0.0
    m2 = statistics.mean(second) if second else 0.0
    if m1 <= 0:
        return "stable", 0.0
    pct = round(((m2 - m1) / m1) * 100, 1)
    if pct > 10:
        return "increasing", pct
    if pct < -10:
        return "decreasing", pct
    return "stable", pct


def _is_recurring(dates: list[datetime]) -> bool:
    if len(dates) < 4:
        return False
    months = {(d.year, d.month) for d in dates}
    return len(months) >= 3 and len(dates) / max(len(months), 1) >= 1.5


def _is_splitting(amounts: list[float]) -> bool:
    if len(amounts) < 8:
        return False
    total = sum(amounts)
    avg = total / len(amounts)
    return avg < 50_000 and total > 200_000


def _rejection_rate(rows: list[dict[str, Any]]) -> float:
    if not rows:
        return 0.0
    rejected = 0
    for r in rows:
        st = str(r.get("approval_status") or "").lower()
        if any(x in st for x in ("reject", "denied", "declined", "failed")):
            rejected += 1
    return round(rejected / len(rows), 4)


def build_vendor_profiles(invoices: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_vendor: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for inv in invoices:
        name = str(inv.get("vendor_name") or "").strip()
        if name:
            by_vendor[name].append(inv)

    profiles: list[dict[str, Any]] = []
    for vendor_name, rows in by_vendor.items():
        amounts = [_f(r.get("total_amount")) for r in rows if _f(r.get("total_amount")) > 0]
        if not amounts:
            continue
        dates = [d for d in (_parse_date(r.get("invoice_date")) for r in rows) if d]
        dated_amounts = [
            (d, _f(r.get("total_amount")))
            for r in rows
            if (d := _parse_date(r.get("invoice_date"))) and _f(r.get("total_amount")) > 0
        ]
        gl_codes = [str(r.get("gl_code") or "").strip() for r in rows]
        ifrs_cats = [str(r.get("ifrs_category") or "").strip() for r in rows]
        gl_code, gl_conf = _mode_confidence(gl_codes)
        ifrs_cat, _ = _mode_confidence(ifrs_cats)
        trend, trend_pct = _price_trend(dated_amounts)
        month_span = 1
        if dates:
            month_span = max(1, (max(dates) - min(dates)).days // 30 or 1)

        profiles.append({
            "vendor_name": vendor_name,
            "mean_amount": round(statistics.mean(amounts), 2),
            "std_deviation": round(statistics.pstdev(amounts), 2) if len(amounts) > 1 else 0.0,
            "min_amount": round(min(amounts), 2),
            "max_amount": round(max(amounts), 2),
            "median_amount": round(statistics.median(amounts), 2),
            "avg_invoices_per_month": round(len(rows) / month_span, 2),
            "typical_gl_code": gl_code or None,
            "typical_gl_confidence": gl_conf,
            "typical_ifrs_category": ifrs_cat or None,
            "historical_rejection_rate": _rejection_rate(rows),
            "is_recurring": _is_recurring(dates),
            "is_splitting_vendor": _is_splitting(amounts),
            "price_trend": trend,
            "price_trend_pct": trend_pct,
            "training_invoice_count": len(rows),
            "training_date_from": min(dates).date().isoformat() if dates else None,
            "training_date_to": max(dates).date().isoformat() if dates else None,
        })
    return profiles


def train_from_invoices(
    company_id: str,
    invoices: list[dict[str, Any]],
    file_name: str | None = None,
) -> dict[str, Any]:
    if len(invoices) < 5:
        raise ValueError("At least 5 invoices required for training")

    now = datetime.utcnow().isoformat()
    profiles = build_vendor_profiles(invoices)
    amounts = [_f(i.get("total_amount")) for i in invoices if _f(i.get("total_amount")) > 0]
    all_dates = [d for d in (_parse_date(i.get("invoice_date")) for i in invoices) if d]
    month_span = 1
    if all_dates:
        month_span = max(1, (max(all_dates) - min(all_dates)).days // 30 or 1)

    gl_mappings = sum(1 for p in profiles if p.get("typical_gl_code"))
    saved_profiles: list[dict[str, Any]] = [
        {"id": str(uuid.uuid4()), "company_id": company_id, "updated_at": now, **p}
        for p in profiles
    ]

    intel = {
        "id": str(uuid.uuid4()),
        "company_id": company_id,
        "avg_invoice_amount": round(statistics.mean(amounts), 2) if amounts else 0,
        "median_invoice_amount": round(statistics.median(amounts), 2) if amounts else 0,
        "avg_invoices_per_month": round(len(invoices) / month_span, 2),
        "is_trained": True,
        "training_invoice_count": len(invoices),
        "training_date_from": min(all_dates).date().isoformat() if all_dates else None,
        "training_date_to": max(all_dates).date().isoformat() if all_dates else None,
        "last_trained_at": now,
        "updated_at": now,
    }

    recurring = sum(1 for p in profiles if p.get("is_recurring"))
    splitting = sum(1 for p in profiles if p.get("is_splitting_vendor"))
    high_rejection = [
        p["vendor_name"]
        for p in profiles
        if float(p.get("historical_rejection_rate") or 0) > 0.2
    ][:10]

    persisted = False
    persist_warning: str | None = None
    try:
        sb = get_supabase()
        upload_id = str(uuid.uuid4())
        upload_logged = False
        try:
            sb.table("training_uploads").insert({
                "id": upload_id,
                "company_id": company_id,
                "file_name": file_name or "upload",
                "status": "processing",
                "rows_processed": len(invoices),
            }).execute()
            upload_logged = True
        except Exception as exc:
            logger.warning("training_uploads insert skipped: %s", exc)

        for row in saved_profiles:
            sb.table("vendor_profiles").upsert(
                row,
                on_conflict="company_id,vendor_name",
            ).execute()

        sb.table("ap_intelligence").upsert(intel, on_conflict="company_id").execute()

        try:
            if upload_logged:
                sb.table("training_uploads").update({
                    "status": "completed",
                    "vendors_profiled": len(profiles),
                    "gl_mappings_created": gl_mappings,
                }).eq("id", upload_id).execute()
        except Exception:
            pass
        persisted = True
    except Exception as exc:
        logger.warning("AP training Supabase persist failed for %s: %s", company_id, exc)
        persist_warning = (
            "Training completed in memory. Run supabase/migrations/022_ap_training_tables.sql "
            "in Supabase SQL Editor to save profiles permanently."
        )

    return {
        "success": True,
        "persisted": persisted,
        "warning": persist_warning,
        "total_invoices": len(invoices),
        "vendors_profiled": len(profiles),
        "gl_mappings_created": gl_mappings,
        "recurring_vendors": recurring,
        "splitting_vendors": splitting,
        "high_rejection": high_rejection,
        "profiles": saved_profiles,
        "intelligence": intel,
    }
