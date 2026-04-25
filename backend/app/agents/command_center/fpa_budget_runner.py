"""Budget vs actual using same line structure as variance; flags departments over threshold."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.api.routes import fpa_variance as fpa_variance_mod


def _validate(result: dict[str, Any], threshold_pct: float) -> tuple[bool, list[str]]:
    del threshold_pct
    errs: list[str] = []
    b = float(result.get("total_budget") or 0)
    a = float(result.get("total_actual") or 0)
    v = float(result.get("total_variance") or 0)
    if abs((b + v) - a) > max(1e-6, abs(a) * 1e-9):
        errs.append("budget agent totals mismatch")
    return (len(errs) == 0, errs)


def run(db: Session, tenant_id: str, context: dict[str, Any]) -> dict[str, Any]:
    del db, tenant_id
    line_items = context.get("line_items")
    threshold = float(context.get("overspend_threshold_pct") or 15.0)
    if not line_items or not isinstance(line_items, list):
        return {
            "ok": False,
            "error": "context.line_items required",
            "output": None,
            "validation": {"passed": False, "errors": ["missing line_items"]},
        }
    result = fpa_variance_mod._calculate(line_items)
    ok, errs = _validate(result, threshold)
    overspends = []
    for d in result.get("department_summary") or []:
        p = float(d.get("variance_pct") or 0)
        if p > threshold:
            overspends.append(
                {
                    "department": d.get("department"),
                    "variance_pct": p,
                    "actual": d.get("actual"),
                    "budget": d.get("budget"),
                }
            )
    out = {**result, "overspend_threshold_pct": threshold, "overspends": overspends}
    return {"ok": ok, "error": None, "output": out, "validation": {"passed": ok, "errors": errs}}
