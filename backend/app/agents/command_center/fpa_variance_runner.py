"""Wraps FP&A variance calculation (same logic as fpa_variance route)."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.api.routes import fpa_variance as fpa_variance_mod
from app.services import fpa_commentary


def _validate(result: dict[str, Any]) -> tuple[bool, list[str]]:
    errs: list[str] = []
    b = float(result.get("total_budget") or 0)
    a = float(result.get("total_actual") or 0)
    v = float(result.get("total_variance") or 0)
    if abs((b + v) - a) > max(1e-6, abs(a) * 1e-9):
        errs.append(f"Variance totals mismatch: budget+variance vs actual (budget={b}, var={v}, actual={a})")
    return (len(errs) == 0, errs)


def run(db: Session, tenant_id: str, context: dict[str, Any]) -> dict[str, Any]:
    del db, tenant_id
    line_items = context.get("line_items")
    if not line_items or not isinstance(line_items, list):
        return {
            "ok": False,
            "error": "context.line_items required: list of {account, department?, budget, actual}",
            "output": None,
            "validation": {"passed": False, "errors": ["missing line_items"]},
        }
    result = fpa_variance_mod._calculate(line_items)
    ok, errs = _validate(result)
    commentary = ""
    if ok:
        commentary = fpa_commentary.fpa_commentary(
            "Summarise this variance analysis for the CFO. Call out material departments and risks.",
            result,
        )
    out = {**result, "commentary": commentary}
    return {"ok": ok, "error": None, "output": out, "validation": {"passed": ok, "errors": errs}}
