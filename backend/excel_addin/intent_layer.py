"""Rule-based intent detection for CFO decision-engine chat."""

from __future__ import annotations

# Keywords per intent (substring match on lowercased message).
_VARIANCE = (
    "variance",
    "budget",
    " over ",
    " under ",
    "over budget",
    "under budget",
    "why revenue",
    "why is revenue",
    "revenue down",
    "revenue up",
    "revenue miss",
    "revenue short",
    "explain change",
    "overspend",
    "overspending",
    "department",
    "underspend",
    "actual vs",
    "vs budget",
    "favorable",
    "adverse",
    "declined",
    "shortfall",
)
_ANOMALY = (
    "unusual",
    "suspicious",
    "fraud",
    "odd",
    " flag",
    "flag ",
    " risk",
    "risk ",
    "round numbers",
    "anomaly",
    "irregular",
)
_FORECAST = (
    "predict",
    "next month",
    "trend",
    "projection",
    "future",
    "runway",
    "forecast",
    "outlook",
    "forward",
)
_KPI = (
    "margin",
    "ebitda",
    "ratio",
    "performance",
    "kpi",
    " health",
    "health ",
    "liquidity",
    "dso",
    "dpo",
)
_SCENARIO = (
    "what if",
    "best case",
    "worst case",
    "simulate",
    "sensitivity",
    "scenario",
    "stress test",
)
_REPORT = (
    "board pack",
    "summary",
    " report",
    "report ",
    "management accounts",
    "executive",
    "board meeting",
    "c-suite",
    "summarize for board",
    "for board",
)

_INTENT_ORDER = ("anomaly", "report", "scenario", "forecast", "kpi", "variance")
_KEYWORDS: dict[str, tuple[str, ...]] = {
    "variance": _VARIANCE,
    "anomaly": _ANOMALY,
    "forecast": _FORECAST,
    "kpi": _KPI,
    "scenario": _SCENARIO,
    "report": _REPORT,
}


def detect_intent(message: str) -> str:
    """
    Returns one of: variance | anomaly | forecast | kpi | scenario | report.
    Default: variance when no keyword matches.
    """
    m = f" {(message or '').lower()} "
    scores: dict[str, int] = {k: 0 for k in _KEYWORDS}
    for intent, kws in _KEYWORDS.items():
        for kw in kws:
            k = kw.strip().lower()
            if not k:
                continue
            if k in m:
                scores[intent] += 1

    best_score = max(scores.values())
    if best_score == 0:
        return "variance"

    # Tie-break: fixed priority (more specific intents first).
    for intent in _INTENT_ORDER:
        if scores[intent] == best_score:
            return intent
    return "variance"
