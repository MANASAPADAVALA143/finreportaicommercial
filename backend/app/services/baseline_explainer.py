"""Plain-English comparison of a journal entry against its account's historical baseline."""

from __future__ import annotations

from datetime import datetime
from typing import Any

Z_ALERT = 2.0

REVIEW_SCORE_THRESHOLD = 60.0


def severity_for_score(score: float) -> str | None:
    """Review-queue severity bands: Critical > 85, High 70–85, Medium 60–70."""
    if score > 85:
        return "Critical"
    if score >= 70:
        return "High"
    if score > REVIEW_SCORE_THRESHOLD:
        return "Medium"
    return None


def _money(amount: float, currency: str | None) -> str:
    text = f"{amount:,.0f}"
    return f"{currency} {text}" if currency else text


def _month_label(posting_date: Any) -> str | None:
    raw = str(posting_date or "")
    for fmt, width in (("%Y-%m-%d", 10), ("%Y-%m", 7)):
        try:
            return datetime.strptime(raw[:width], fmt).strftime("%B %Y")
        except ValueError:
            continue
    return None


def explain_against_baseline(
    *,
    account: str,
    account_name: str | None,
    amount: float,
    posting_date: Any,
    baseline: Any | None,
    currency: str | None = None,
) -> dict[str, Any]:
    """Return {"text", "z_score", "ratio", "above_threshold"} for one entry.

    `baseline` is an AccountBaseline row (entry-level mean/std/min/max over months_loaded).
    """
    label = f"{account} – {account_name}" if account_name else str(account)
    amount = abs(float(amount or 0))

    if baseline is None or not baseline.total_entries:
        return {
            "text": f"Account {label} has no historical baseline yet, so this amount could not be compared with past activity.",
            "z_score": None,
            "ratio": None,
            "above_threshold": None,
        }

    mean = float(baseline.mean_amount or 0)
    std = float(baseline.std_amount or 0)
    months = int(baseline.months_loaded or 0)
    low = float(baseline.min_amount or 0)
    high = float(baseline.max_amount or 0)
    z = (amount - mean) / std if std > 0 else None
    ratio = amount / mean if mean > 0 else None
    above = z is not None and z >= Z_ALERT

    when = _month_label(posting_date)
    posted = f"posted {_money(amount, currency)}" + (f" in {when}" if when else "")
    period = f"{months}-month average" if months else "historical average"
    range_text = f"Historical range: {_money(low, currency)}–{_money(high, currency)}."
    z_text = f"Z-score: {z:.1f}." if z is not None else "Z-score: n/a (no variation in history)."

    if ratio is not None and ratio >= 1.05:
        comparison = f"{ratio:.1f}× above the {period} of {_money(mean, currency)}"
    elif ratio is not None and ratio <= 0.95:
        comparison = f"{ratio:.1f}× the {period} of {_money(mean, currency)}"
    else:
        comparison = f"in line with the {period} of {_money(mean, currency)}"

    text = f"Account {label} {posted} — {comparison}. {z_text} {range_text}"
    if not above:
        text += " The amount is within 2 standard deviations, so the flag comes from other risk indicators."

    return {
        "text": text,
        "z_score": round(z, 2) if z is not None else None,
        "ratio": round(ratio, 2) if ratio is not None else None,
        "above_threshold": above,
    }
