"""Linear trend forecast + simple seasonality from monthly series."""

from __future__ import annotations

import statistics
from typing import Any


def _lin_forecast(xs: list[float], ys: list[float], steps: int) -> list[float]:
    n = len(xs)
    if n < 2:
        return [ys[-1] if ys else 0.0] * steps
    mean_x = statistics.mean(xs)
    mean_y = statistics.mean(ys)
    num = sum((xi - mean_x) * (yi - mean_y) for xi, yi in zip(xs, ys, strict=False))
    den = sum((xi - mean_x) ** 2 for xi in xs) or 1e-9
    slope = num / den
    intercept = mean_y - slope * mean_x
    out = []
    last_x = xs[-1]
    for i in range(1, steps + 1):
        x = last_x + i
        out.append(max(0.0, intercept + slope * x))
    return out


def analyze_forecast(monthly_actuals: list[dict[str, Any]]) -> dict[str, Any]:
    rows = sorted(
        monthly_actuals,
        key=lambda r: str(r.get("month", "")),
    )
    xs = list(range(len(rows)))
    revs = [float(r.get("revenue", 0) or 0) for r in rows]
    costs = [float(r.get("costs", 0) or 0) for r in rows]
    months = [str(r.get("month", "")) for r in rows]

    mean_rev = statistics.mean(revs) if revs else 0.0
    seasonality: dict[str, float] = {}
    for m, rv in zip(months, revs, strict=False):
        if mean_rev > 0:
            seasonality[m] = round(rv / mean_rev, 4)
        else:
            seasonality[m] = 1.0

    growth_rate = None
    if len(revs) >= 2 and revs[0] > 0:
        growth_rate = (revs[-1] - revs[0]) / abs(revs[0]) * 100.0

    f_rev = _lin_forecast(xs, revs, 6)
    f_cost = _lin_forecast(xs, costs, 6)

    forecast_months: list[dict[str, Any]] = []
    base_label = months[-1] if months else "last"
    for i, (rv, ct) in enumerate(zip(f_rev, f_cost, strict=False), start=1):
        forecast_months.append(
            {
                "period": f"forecast+{i}_from_{base_label}",
                "revenue": round(rv, 2),
                "costs": round(ct, 2),
                "net": round(rv - ct, 2),
            }
        )

    return {
        "history_months": months,
        "forecast_months": forecast_months,
        "growth_rate_pct": growth_rate,
        "seasonality_index": seasonality,
        "method": "ols_linear_extension",
    }
