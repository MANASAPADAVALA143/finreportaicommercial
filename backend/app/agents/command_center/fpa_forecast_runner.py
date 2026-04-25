"""FP&A forecast — roll-forward from YTD and/or rich UI payload (revenue total, monthly rows, budget tie-out)."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session


def _row_forecast_value(row: dict[str, Any]) -> float:
    for k in ("forecast", "fy26", "revenue", "value", "amount", "total"):
        v = row.get(k)
        if v is None:
            continue
        try:
            return float(v)
        except (TypeError, ValueError):
            continue
    return 0.0


def _sum_forecast_data(rows: Any) -> float:
    if not isinstance(rows, list):
        return 0.0
    return sum(_row_forecast_value(r) if isinstance(r, dict) else 0.0 for r in rows)


def _validate(out: dict[str, Any]) -> tuple[bool, list[str]]:
    errs: list[str] = []
    ytd = float(out.get("ytd_actual") or 0)
    months_left = int(out.get("months_remaining_in_fy") or 0)
    total_fy = float(out.get("forecast_fy_total") or 0)
    if total_fy <= 0:
        errs.append("forecast_fy_total must be positive")
    if months_left < 0 or months_left > 12:
        errs.append("months_remaining_in_fy must be 0..12")
    if ytd > 0 and total_fy > ytd * 50:
        errs.append("forecast_fy_total exceeds sanity bound (50x YTD)")
    if ytd < 0:
        errs.append("ytd_actual cannot be negative")
    return (len(errs) == 0, errs)


def run(db: Session, tenant_id: str, context: dict[str, Any]) -> dict[str, Any]:
    del db, tenant_id

    fd = context.get("forecast_data")
    total_explicit = float(context.get("forecast_fy_total") or context.get("revenue_forecast") or 0)
    total_from_rows = _sum_forecast_data(fd)
    total_fy = total_explicit if total_explicit > 0 else total_from_rows

    ytd = float(context.get("ytd_actual") or context.get("ytd_revenue") or 0)
    growth = float(context.get("monthly_growth_pct") or context.get("growth_pct") or 0) / 100.0
    months_left = int(context.get("months_remaining_in_fy") or 12)
    months_elapsed = max(1, int(context.get("months_elapsed") or 10))

    ref_budget = float(context.get("reference_budget") or context.get("budget_reference") or 0)
    deviation_pct: float | None = None
    if ref_budget > 0 and total_fy > 0:
        deviation_pct = (total_fy - ref_budget) / ref_budget * 100.0

    # Classic roll-forward when we have YTD and no explicit FY total from UI
    if total_fy <= 0 and ytd > 0:
        run_rate = ytd / months_elapsed
        forecast_rest = 0.0
        m = run_rate
        for _ in range(max(0, months_left)):
            forecast_rest += m
            m *= 1.0 + growth
        total_fy = ytd + forecast_rest
        run_rate_out = run_rate
        forecast_rest_out = forecast_rest
    else:
        run_rate_out = (ytd / months_elapsed) if ytd > 0 else 0.0
        forecast_rest_out = max(0.0, total_fy - ytd)

    note = str(context.get("note") or "Forecast snapshot from FP&A engine / Command Center.")
    if isinstance(fd, list) and fd and total_explicit <= 0:
        note = "Forecast FY total derived from forecast_data rows; see forecast_rows_sampled."

    out: dict[str, Any] = {
        "ytd_actual": ytd,
        "months_elapsed": months_elapsed,
        "months_remaining_in_fy": months_left,
        "run_rate_monthly": run_rate_out,
        "monthly_growth_pct": growth * 100.0,
        "forecast_remaining_period": forecast_rest_out,
        "forecast_fy_total": total_fy,
        "reference_budget": ref_budget if ref_budget else None,
        "deviation_vs_budget_pct": deviation_pct,
        "model_used": context.get("model_used"),
        "period": context.get("period"),
        "forecast_rows_sampled": len(fd) if isinstance(fd, list) else 0,
        "note": note,
    }
    ok, errs = _validate(out)
    return {"ok": ok, "error": None, "output": out, "validation": {"passed": ok, "errors": errs}}
