"""
Scoring engine that uses STORED company baselines (not recalculated each time).
Company-specific accuracy improves with more uploads.
"""
from datetime import datetime
from sqlalchemy.orm import Session
from app.db.models import CompanyProfile


def get_baseline_for_entry(company_id: str, account: str, db: Session) -> dict:
    """Fetch stored baseline for a specific company + account."""
    profile = db.query(CompanyProfile).filter(
        CompanyProfile.company_id == company_id,
        CompanyProfile.account == account,
    ).first()

    if profile:
        return {
            "avg": profile.avg_amount,
            "std": profile.std_amount,
            "p75": profile.p75_amount,
            "p90": profile.p90_amount,
            "p95": profile.p95_amount,
            "count": profile.entry_count,
            "weekend_rate": profile.weekend_rate,
            "manual_rate": profile.manual_rate,
            "common_users": profile.common_users or [],
            "monthly_avg": profile.monthly_avg or {},
            "source": "historical",
        }

    return {
        "avg": 0, "std": 1, "p75": 0, "p90": 0, "p95": 0,
        "count": 0, "weekend_rate": 0.15, "manual_rate": 0.5,
        "common_users": [], "monthly_avg": {},
        "source": "no_history",
    }


def score_entry_against_company_baseline(
    entry: dict,
    company_id: str,
    all_entries: list,
    db: Session,
) -> dict:
    amount = abs(float(entry.get("amount", 0)))
    account = str(entry.get("account", "Unknown"))
    user_id = str(entry.get("user_id", "Unknown"))
    source = str(entry.get("source", ""))
    description = str(entry.get("description", "")).lower()
    vendor = str(entry.get("entity", entry.get("vendor", "Unknown")))

    try:
        date = datetime.fromisoformat(str(entry.get("posting_date", "")))
    except Exception:
        date = datetime.now()

    is_weekend = date.weekday() >= 5
    is_month_end = date.day >= 28
    is_manual = source.lower() == "manual"

    baseline = get_baseline_for_entry(company_id, account, db)
    flags = []
    scores = {"ml": 0.0, "stat": 0.0, "rules": 0.0, "ai": 0.0}

    # Statistical score (vs company's own history)
    if baseline["count"] >= 5:
        z = (amount - baseline["avg"]) / baseline["std"] if baseline["std"] else 0
        if abs(z) > 3.0:
            scores["stat"] = 0.90
            flags.append(
                f"Extreme outlier: {abs(z):.1f}σ above {account} average "
                f"(avg: ₹{baseline['avg']:,.0f}, this: ₹{amount:,.0f})"
            )
        elif abs(z) > 2.0:
            scores["stat"] = 0.60
            flags.append(f"Outlier: {abs(z):.1f}σ above {account} average")
        elif amount > baseline["p95"]:
            scores["stat"] = 0.40
            flags.append(f"Above 95th percentile for {account}")
        elif amount > baseline["p90"]:
            scores["stat"] = 0.20
    else:
        scores["stat"] = 0.10
        if baseline["source"] == "no_history":
            flags.append(f"New account '{account}' — no baseline yet")

    scores["ml"] = min(scores["stat"] * 1.1, 1.0)

    # Rules (normalized by this company's rates)
    rule_score = 0.0
    if is_weekend and baseline["weekend_rate"] < 0.12:
        rule_score += 0.15
        flags.append(
            f"Weekend posting unusual for this company "
            f"(their rate: {baseline['weekend_rate']*100:.0f}%)"
        )
    if is_manual and baseline["manual_rate"] < 0.30:
        rule_score += 0.10
        flags.append("Manual entry — company normally uses automated posting")
    if user_id and baseline["common_users"] and user_id not in baseline["common_users"]:
        rule_score += 0.12
        flags.append(f"User '{user_id}' has not posted to {account} before")
    if is_month_end and amount > baseline["p90"]:
        rule_score += 0.08
        flags.append("Large month-end entry — verify it's a planned accrual")

    dup_key = f"{vendor}_{amount}_{str(date)[:7]}"
    dups = [
        e
        for e in all_entries
        if f"{e.get('entity', e.get('vendor', 'Unknown'))}_{abs(float(e.get('amount', 0)))}_{str(e.get('posting_date', ''))[:7]}"
        == dup_key
    ]
    if len(dups) > 1:
        rule_score += 0.25
        flags.append(f"Duplicate entry — {len(dups)} identical entries this month")

    susp_words = ["correction", "adjustment", "reversal", "error", "write-off", "urgent"]
    found = [w for w in susp_words if w in description]
    if found:
        total = len(all_entries) or 1
        freq = sum(
            1
            for e in all_entries
            if any(w in str(e.get("description", "")).lower() for w in found)
        ) / total
        if freq < 0.30:
            rule_score += 0.12
            flags.append(f"Unusual narration: '{found[0]}' — rare for this company")

    if "suspense" in account.lower():
        rule_score += 0.10
        flags.append("Suspense account — verify clearing within period")

    scores["rules"] = min(rule_score, 1.0)

    final = (
        0.40 * scores["ml"]
        + 0.30 * scores["stat"]
        + 0.20 * scores["rules"]
        + 0.10 * scores["ai"]
    )
    final_score = round(final * 100)
    risk_level = "HIGH" if final_score >= 65 else "MEDIUM" if final_score >= 35 else "LOW"

    return {
        "journal_id": entry.get("journal_id", ""),
        "amount": amount,
        "account": account,
        "vendor": vendor,
        "user_id": user_id,
        "date": str(date.date()),
        "final_score": final_score,
        "risk_level": risk_level,
        "ml_score": round(scores["ml"] * 100),
        "stat_score": round(scores["stat"] * 100),
        "rules_score": round(scores["rules"] * 100),
        "ai_score": 0,
        "rule_flags": flags,
        "baseline_source": baseline["source"],
        "baseline_count": baseline["count"],
    }
