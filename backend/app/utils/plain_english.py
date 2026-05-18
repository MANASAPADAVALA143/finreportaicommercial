"""
plain_english.py
Converts raw ML feature names, model scores, and flags into
plain-English explanations for non-technical users (CFOs, auditors).

All functions are pure — no I/O, no DB access.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Translation tables
# ---------------------------------------------------------------------------

FEATURE_LABELS: dict[str, str] = {
    "amount_log":       "Amount is unusual for this account",
    "is_afterhours":    "Posted outside business hours",
    "is_monthend":      "Posted at month-end (high-risk period)",
    "is_weekend":       "Posted on a weekend",
    "user_encoded":     "Unusual activity for this user",
    "account_encoded":  "Unexpected account type",
    "is_manual":        "Manually entered — not system-generated",
    "is_round":         "Suspiciously round amount",
    "source_encoded":   "Unusual posting source",
    "day_of_week":      "Day of posting is atypical for this account",
    "hour_of_day":      "Time of posting is atypical",
}

BEHAVIOUR_LABELS: dict[str, str] = {
    "afterhours_anomaly":   "⏰ Posted outside business hours",
    "monthend_spike":       "📅 Month-end spike — entries cluster unusually at period close",
    "unusual_source":       "⚙️ Unusual system source for this account",
    "new_user":             "👤 User not seen in historical baseline",
    "weekend_anomaly":      "📆 Posted on a weekend",
    "high_amount":          "💰 Amount significantly above normal",
    "round_number":         "🔢 Suspiciously round amount",
    "unusual_entity":       "🏢 Entity not seen in historical transactions",
}

RISK_EXPLANATIONS: dict[str, str] = {
    "CRITICAL": "🔴 Critical Risk — Requires immediate attention before period close",
    "HIGH":     "🟠 High Risk — Requires review before period close",
    "MEDIUM":   "🟡 Medium Risk — Review recommended; may be legitimate but unusual",
    "LOW":      "🟢 Low Risk — Minor anomaly; likely routine",
}


# ---------------------------------------------------------------------------
# Individual model explanations
# ---------------------------------------------------------------------------

def explain_zscore(zscore: float, source: str) -> str:
    """Convert z-score to a plain-English sentence."""
    abs_z = abs(zscore)
    direction = "above" if zscore >= 0 else "below"
    period = (
        source.replace("history (", "").replace(" months)", "-month historical average")
              .replace("history", "historical average")
              .replace("batch only", "batch average")
    )
    if abs_z < 1.5:
        return f"Amount is within the normal range ({abs_z:.1f}× {direction} {period})"
    elif abs_z < 2.5:
        return f"Amount is moderately unusual — {abs_z:.1f}× {direction} {period}"
    elif abs_z < 3.5:
        return f"Amount is significantly above normal — {abs_z:.1f}× {direction} {period}"
    else:
        return f"⚠️ Amount is far outside the normal range — {abs_z:.1f}× {direction} {period}"


def explain_isolation(score: float, n_history: int, n_batch: int) -> str:
    """Convert isolation forest risk score (0–100) to plain English."""
    total = n_history + n_batch
    context = f"all {total:,} entries analysed" if total > 0 else "all entries analysed"
    if score >= 90:
        return f"Highly isolated — this entry looks very different from {context}"
    elif score >= 70:
        return f"Moderately isolated — unusual compared to historical and current entries"
    elif score >= 50:
        return f"Slightly unusual — some characteristics differ from normal entries"
    else:
        return f"Normal pattern — consistent with historical data"


def explain_iqr(amount: float, upper_fence: float, lower_fence: float | None = None) -> str:
    """Convert IQR bounds to plain English."""
    if upper_fence and amount > upper_fence:
        return (
            f"Amount ₹{amount:,.0f} exceeds the normal upper limit of ₹{upper_fence:,.0f}"
        )
    if lower_fence and amount < lower_fence:
        return (
            f"Amount ₹{amount:,.0f} is below the normal lower limit of ₹{lower_fence:,.0f}"
        )
    limit_str = f" (up to ₹{upper_fence:,.0f})" if upper_fence else ""
    return f"Amount is within the normal range{limit_str}"


def explain_compliance(score: int) -> str:
    """Convert compliance score (0–100) to plain English."""
    if score >= 70:
        return "✅ Strong controls — entry follows standard procedures"
    elif score >= 40:
        return "⚠️ Moderate controls — some standard procedures not followed"
    elif score >= 20:
        return "🔶 Weak controls — multiple control gaps detected"
    else:
        return "🔴 Poor controls — entry lacks standard approval and documentation"


def translate_top_contributors(features: list[str]) -> list[dict[str, str]]:
    """
    Convert a list of raw SHAP/ML feature names into plain-English findings.
    Returns [{"feature": "...", "label": "..."}].
    """
    seen: set[str] = set()
    findings = []
    for feat in features:
        if feat in seen:
            continue
        seen.add(feat)
        label = FEATURE_LABELS.get(feat, feat.replace("_", " ").title())
        findings.append({"feature": feat, "label": label})
    return findings


def translate_behaviour_flags(flags: list[str]) -> list[str]:
    """Convert raw behaviour flag names to readable strings."""
    return [BEHAVIOUR_LABELS.get(f, f.replace("_", " ").title()) for f in flags]


# ---------------------------------------------------------------------------
# Full summary builder
# ---------------------------------------------------------------------------

def build_plain_english_summary(
    *,
    journal_id: str,
    account: str,
    amount: float,
    risk_level: str,
    composite_score: float,
    zscore_value: float,
    zscore_source: str,
    isolation_score: float,
    iqr_upper: float,
    iqr_lower: float | None,
    behaviour_flags: list[str],
    compliance_score: int,
    shap_top_features: list[str],
    n_history: int,
    n_batch: int,
) -> dict:
    """
    Returns a structured dict of plain-English fields ready for the frontend.

    All technical scores are still returned inside 'technical' for the
    "Show technical details ▼" toggle.
    """
    return {
        # ── Header ─────────────────────────────────────────────────────────
        "risk_explanation": RISK_EXPLANATIONS.get(risk_level, risk_level),
        # BEFORE: "Scores above 60 are flagged for review" — wrong threshold, stale copy
        # AFTER:  dynamic text matching actual thresholds (CRITICAL≥80, HIGH≥65, MEDIUM≥45)
        "what_is_score": (
            f"This entry scored {composite_score:.0f}/100. "
            + {
                "CRITICAL": "Scores ≥ 75 are Critical — immediate action required before period close.",
                "HIGH":     "Scores ≥ 55 are High risk — review required before period close.",
                "MEDIUM":   "Scores ≥ 42 are Medium risk — review recommended; likely unusual but may be legitimate.",
                "LOW":      "Scores below 42 are Low risk — within normal parameters.",
            }.get(risk_level, f"Risk level: {risk_level}.")
        ),

        # ── Four plain checks ───────────────────────────────────────────────
        "amount_check":   explain_zscore(zscore_value, zscore_source),
        "pattern_check":  explain_isolation(isolation_score, n_history, n_batch),
        "range_check":    explain_iqr(amount, iqr_upper, iqr_lower),
        "controls_check": explain_compliance(compliance_score),

        # ── Behaviour alerts ────────────────────────────────────────────────
        "behaviour_alerts": translate_behaviour_flags(behaviour_flags),

        # ── Key findings (SHAP contributors) ────────────────────────────────
        "key_findings": translate_top_contributors(shap_top_features),
    }
