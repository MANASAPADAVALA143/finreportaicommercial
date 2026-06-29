"""
Module 3 — Advanced AP Anomaly Detection Engine
Statistical (Z-score + IQR), ML (Isolation Forest), and rule-based fraud patterns.
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field, asdict
from datetime import datetime, date
from typing import Any

try:
    import numpy as np
    from scipy import stats
    from sklearn.ensemble import IsolationForest
except ImportError:
    np = None  # type: ignore
    stats = None  # type: ignore
    IsolationForest = None  # type: ignore


# UAE public holidays (sample — extend annually)
UAE_PUBLIC_HOLIDAYS_2026 = {
    date(2026, 1, 1),
    date(2026, 4, 21),
    date(2026, 4, 22),
    date(2026, 4, 23),
    date(2026, 6, 6),
    date(2026, 6, 7),
    date(2026, 12, 2),
    date(2026, 12, 3),
}

DEFAULT_APPROVAL_THRESHOLD = 10_000.0
NEW_VENDOR_HIGH_AMOUNT = 100_000.0


@dataclass
class AnomalyFlag:
    anomaly_type: str  # statistical | ml | rule_based
    detection_method: str
    severity: str  # low | medium | high | critical
    risk_score: float
    flag_code: str
    flag_reason: str
    flag_details: dict[str, Any] = field(default_factory=dict)


def _parse_date(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
    except ValueError:
        try:
            return datetime.strptime(s[:10], "%Y-%m-%d").date()
        except ValueError:
            return None


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _vendor_stats(history: list[dict[str, Any]]) -> dict[str, float]:
    amounts = [float(h.get("total_amount") or 0) for h in history if h.get("total_amount")]
    dates = sorted(
        d for d in (_parse_date(h.get("invoice_date")) for h in history) if d
    )
    gaps: list[float] = []
    for i in range(1, len(dates)):
        gaps.append((dates[i] - dates[i - 1]).days)

    avg_amt = float(np.mean(amounts)) if np is not None and amounts else (sum(amounts) / len(amounts) if amounts else 0)
    std_amt = float(np.std(amounts, ddof=1)) if np is not None and len(amounts) > 1 else (
        (sum((a - avg_amt) ** 2 for a in amounts) / (len(amounts) - 1)) ** 0.5 if len(amounts) > 1 else 0
    )
    avg_gap = float(np.mean(gaps)) if np is not None and gaps else (sum(gaps) / len(gaps) if gaps else 30)

    dow_counts: dict[int, int] = {}
    dom_counts: dict[int, int] = {}
    for h in history:
        d = _parse_date(h.get("invoice_date"))
        if d:
            dow_counts[d.weekday()] = dow_counts.get(d.weekday(), 0) + 1
            dom_counts[d.day] = dom_counts.get(d.day, 0) + 1

    typical_dow = max(dow_counts, key=dow_counts.get) if dow_counts else 0
    typical_dom = max(dom_counts, key=dom_counts.get) if dom_counts else 1

    return {
        "avg_invoice_amount": avg_amt,
        "std_invoice_amount": std_amt or 1.0,
        "avg_days_between_invoices": avg_gap or 30.0,
        "typical_invoice_day_of_week": float(typical_dow),
        "typical_invoice_day_of_month": float(typical_dom),
    }


def _statistical_flags(
    invoice: dict[str, Any],
    history: list[dict[str, Any]],
    stats_dict: dict[str, float],
) -> list[AnomalyFlag]:
    flags: list[AnomalyFlag] = []
    amount = float(invoice.get("total_amount") or 0)
    avg = stats_dict["avg_invoice_amount"]
    std = max(stats_dict["std_invoice_amount"], 1.0)
    z = (amount - avg) / std

    if z > 2.5:
        flags.append(
            AnomalyFlag(
                "statistical", "zscore", "high", min(100, 40 + z * 10),
                "AMOUNT_HIGH_ZSCORE",
                f"Unusually high amount for this vendor (z={z:.2f})",
                {"z_score": round(z, 3), "vendor_avg": avg, "invoice_amount": amount},
            )
        )
    elif z < -2.5:
        flags.append(
            AnomalyFlag(
                "statistical", "zscore", "medium", 35,
                "AMOUNT_LOW_ZSCORE",
                "Unusually low amount (possible split invoice)",
                {"z_score": round(z, 3), "vendor_avg": avg, "invoice_amount": amount},
            )
        )

    inv_date = _parse_date(invoice.get("invoice_date"))
    if history and inv_date:
        last_dates = sorted(
            d for d in (_parse_date(h.get("invoice_date")) for h in history) if d
        )
        if last_dates:
            days_since = (inv_date - last_dates[-1]).days
            avg_gap = stats_dict["avg_days_between_invoices"]
            if avg_gap > 0 and days_since < avg_gap * 0.3:
                flags.append(
                    AnomalyFlag(
                        "statistical", "frequency", "high", 45,
                        "FREQUENCY_ANOMALY",
                        "Invoice frequency too high — possible duplicate or splitting",
                        {"days_since_last": days_since, "avg_days_between": avg_gap},
                    )
                )

    submitted = _parse_dt(invoice.get("created_at") or invoice.get("submitted_at"))
    if submitted:
        if submitted.weekday() >= 5 or submitted.date() in UAE_PUBLIC_HOLIDAYS_2026:
            flags.append(
                AnomalyFlag(
                    "statistical", "timing", "medium", 25,
                    "NON_BUSINESS_DAY",
                    "Submitted on non-business day — verify authenticity",
                    {"submitted_at": submitted.isoformat()},
                )
            )
        hour = submitted.hour
        if hour >= 18 or hour < 7:
            flags.append(
                AnomalyFlag(
                    "statistical", "timing", "low", 15,
                    "OUTSIDE_BUSINESS_HOURS",
                    "Submitted outside business hours",
                    {"submitted_at": submitted.isoformat(), "hour": hour},
                )
            )

    return flags


def _ml_flags(
    invoice: dict[str, Any],
    history: list[dict[str, Any]],
    stats_dict: dict[str, float],
) -> list[AnomalyFlag]:
    if IsolationForest is None or np is None or len(history) < 5:
        return []

    rows: list[list[float]] = []
    for h in history:
        amt = float(h.get("total_amount") or 0)
        d = _parse_date(h.get("invoice_date"))
        dow = float(d.weekday()) if d else 0
        dom = float(d.day) if d else 1
        po_amt = float(h.get("po_amount") or amt)
        amt_vs_po = amt / po_amt if po_amt else 1.0
        line_items = float(len(h.get("line_items") or []) or 1)
        rows.append([amt, dow, dom, stats_dict["avg_days_between_invoices"], amt_vs_po, line_items, 24.0])

    inv_date = _parse_date(invoice.get("invoice_date"))
    amt = float(invoice.get("total_amount") or 0)
    po_amt = float(invoice.get("po_amount") or amt)
    feat = [
        amt,
        float(inv_date.weekday()) if inv_date else 0,
        float(inv_date.day) if inv_date else 1,
        stats_dict["avg_days_between_invoices"],
        amt / po_amt if po_amt else 1.0,
        float(len(invoice.get("line_items") or []) or 1),
        24.0,
    ]

    X = np.array(rows + [feat])
    model = IsolationForest(contamination=0.1, random_state=42, n_estimators=100)
    model.fit(X[:-1])
    score = float(model.decision_function(X[-1:])[0])

    flags: list[AnomalyFlag] = []
    if score < -0.6:
        flags.append(
            AnomalyFlag(
                "ml", "isolation_forest", "high", 70,
                "ML_HIGH_RISK",
                f"Isolation Forest high-risk anomaly (score={score:.3f})",
                {"anomaly_score": round(score, 4)},
            )
        )
    elif score < -0.3:
        flags.append(
            AnomalyFlag(
                "ml", "isolation_forest", "medium", 50,
                "ML_REVIEW",
                f"Isolation Forest flagged for review (score={score:.3f})",
                {"anomaly_score": round(score, 4)},
            )
        )
    return flags


def _rule_flags(
    invoice: dict[str, Any],
    history: list[dict[str, Any]],
    vendor: dict[str, Any],
    approval_threshold: float = DEFAULT_APPROVAL_THRESHOLD,
) -> list[AnomalyFlag]:
    flags: list[AnomalyFlag] = []
    amount = float(invoice.get("total_amount") or 0)
    vendor_name = (invoice.get("vendor_name") or "").strip()
    inv_num = (invoice.get("invoice_number") or "").strip()
    inv_date = _parse_date(invoice.get("invoice_date"))
    notes = (invoice.get("notes") or invoice.get("description") or "").upper()

    # PATTERN 1: Split invoice
    if inv_date:
        window = [
            h for h in history
            if _parse_date(h.get("invoice_date"))
            and abs((_parse_date(h.get("invoice_date")) - inv_date).days) <= 7
        ]
        combined = amount + sum(float(h.get("total_amount") or 0) for h in window)
        small_parts = [amount] + [float(h.get("total_amount") or 0) for h in window]
        if len(small_parts) >= 2 and all(a < approval_threshold for a in small_parts) and combined > approval_threshold:
            flags.append(
                AnomalyFlag(
                    "rule_based", "split_detection", "high", 75,
                    "SPLIT_INVOICE",
                    f"Possible invoice splitting to bypass AED {approval_threshold:,.0f} approval limit",
                    {"combined_amount": combined, "threshold": approval_threshold, "invoices_in_window": len(small_parts)},
                )
            )

    # PATTERN 2: Round number
    if amount >= 5000 and (amount % 1000 == 0 or amount % 10000 == 0):
        vendor_age = vendor.get("vendor_age_days", 999)
        if vendor_age < 90 or amount >= 50_000:
            flags.append(
                AnomalyFlag(
                    "rule_based", "round_number", "medium", 40,
                    "ROUND_NUMBER",
                    "Round number invoice — common in fraudulent invoices",
                    {"amount": amount},
                )
            )

    # PATTERN 3: Just below threshold
    if approval_threshold > 0 and amount >= approval_threshold * 0.95 and amount < approval_threshold:
        flags.append(
            AnomalyFlag(
                "rule_based", "just_below_threshold", "high", 65,
                "JUST_BELOW_THRESHOLD",
                f"Amount just below approval threshold — review required",
                {"amount": amount, "threshold": approval_threshold},
            )
        )

    # PATTERN 4: Near duplicate
    for h in history:
        h_amt = float(h.get("total_amount") or 0)
        if h_amt <= 0:
            continue
        variance = abs(amount - h_amt) / h_amt
        same_period = inv_date and _parse_date(h.get("invoice_date")) and inv_date.month == _parse_date(h.get("invoice_date")).month
        if (
            variance <= 0.05
            and (h.get("invoice_number") or "").strip().lower() != inv_num.lower()
            and same_period
        ):
            flags.append(
                AnomalyFlag(
                    "rule_based", "near_duplicate", "high", 60,
                    "NEAR_DUPLICATE",
                    f"Near-duplicate invoice — {variance * 100:.1f}% amount variance detected",
                    {"other_invoice": h.get("invoice_number"), "variance_pct": round(variance * 100, 2)},
                )
            )
            break

    # PATTERN 5: Approver concentration (needs approval history on invoice)
    approver_stats = invoice.get("approver_concentration") or {}
    if approver_stats.get("pct", 0) > 70:
        flags.append(
            AnomalyFlag(
                "rule_based", "approver_concentration", "medium", 45,
                "APPROVER_CONCENTRATION",
                "Approver concentration risk — consider rotation",
                approver_stats,
            )
        )

    # PATTERN 6: New vendor + large amount
    vendor_age = float(vendor.get("vendor_age_days") or 999)
    if vendor_age < 60 and amount > NEW_VENDOR_HIGH_AMOUNT:
        flags.append(
            AnomalyFlag(
                "rule_based", "new_vendor_high_amount", "critical", 85,
                "NEW_VENDOR_HIGH_AMOUNT",
                "New vendor, high value — enhanced due diligence required",
                {"vendor_age_days": vendor_age, "amount": amount},
            )
        )

    # PATTERN 7: Revised invoice trap
    rev_pattern = re.compile(r"-(R|REV|REVISED|2|B)$", re.I)
    if rev_pattern.search(inv_num):
        for h in history:
            h_amt = float(h.get("total_amount") or 0)
            if h_amt > 0 and abs(amount - h_amt) / h_amt <= 0.1:
                flags.append(
                    AnomalyFlag(
                        "rule_based", "revised_invoice", "medium", 50,
                        "REVISED_INVOICE",
                        "Possible revised invoice — confirm replacement not duplicate",
                        {"original": h.get("invoice_number"), "amount": amount},
                    )
                )
                break

    # PATTERN 8: Payment urgency manipulation
    submitted = _parse_dt(invoice.get("created_at") or invoice.get("submitted_at"))
    if submitted and ("URGENT" in notes or "ASAP" in notes):
        if submitted.weekday() == 4 and submitted.hour >= 15:
            flags.append(
                AnomalyFlag(
                    "rule_based", "urgency_manipulation", "high", 55,
                    "URGENT_PAYMENT_FRIDAY",
                    "Urgent payment request — verify directly with vendor CFO",
                    {"submitted_at": submitted.isoformat()},
                )
            )

    return flags


def detect_invoice_anomalies(
    invoice: dict[str, Any],
    vendor_history: list[dict[str, Any]],
    vendor: dict[str, Any] | None = None,
    approval_threshold: float = DEFAULT_APPROVAL_THRESHOLD,
) -> dict[str, Any]:
    """Run full anomaly pipeline on a single invoice."""
    vendor = vendor or {}
    history = [h for h in vendor_history if h.get("id") != invoice.get("id")]
    stats_dict = _vendor_stats(history)

    all_flags: list[AnomalyFlag] = []
    all_flags.extend(_statistical_flags(invoice, history, stats_dict))
    all_flags.extend(_ml_flags(invoice, history, stats_dict))
    all_flags.extend(_rule_flags(invoice, history, vendor, approval_threshold))

    if not all_flags:
        return {
            "overall_risk_score": 0,
            "flags": [],
            "vendor_stats": stats_dict,
            "statistical_context": None,
        }

    overall = min(100, max(all_flags, key=lambda f: f.risk_score).risk_score)
    amount = float(invoice.get("total_amount") or 0)
    avg = stats_dict["avg_invoice_amount"]
    std = stats_dict["std_invoice_amount"]
    mult = (amount - avg) / std if std else 0

    context = None
    if avg > 0:
        context = (
            f"This vendor's avg invoice is AED {avg:,.0f}. "
            f"This invoice is AED {amount:,.0f} ({mult:.1f}x standard deviation)."
        )

    return {
        "overall_risk_score": round(overall, 1),
        "flags": [asdict(f) for f in all_flags],
        "vendor_stats": stats_dict,
        "statistical_context": context,
    }


def detect_batch(payload: dict[str, Any]) -> dict[str, Any]:
    """HTTP entry: { invoice, vendor_history, vendor, approval_threshold }"""
    return detect_invoice_anomalies(
        payload.get("invoice") or {},
        payload.get("vendor_history") or [],
        payload.get("vendor") or {},
        float(payload.get("approval_threshold") or DEFAULT_APPROVAL_THRESHOLD),
    )


if __name__ == "__main__":
    sample = {
        "invoice": {
            "id": "new-1",
            "invoice_number": "INV-9901",
            "vendor_name": "Al Baraka Trading",
            "total_amount": 9800,
            "invoice_date": "2026-06-05",
            "created_at": "2026-06-05T16:30:00",
        },
        "vendor_history": [
            {"id": "h1", "invoice_number": "INV-9900", "total_amount": 9800, "invoice_date": "2026-06-03"},
            {"id": "h2", "invoice_number": "INV-9899", "total_amount": 9800, "invoice_date": "2026-06-01"},
        ],
        "vendor": {"vendor_age_days": 400},
        "approval_threshold": 10000,
    }
    print(json.dumps(detect_batch(sample), indent=2))
