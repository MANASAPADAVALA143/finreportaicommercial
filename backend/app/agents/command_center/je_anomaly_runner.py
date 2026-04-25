"""Wraps R2RPatternEngine journal anomaly analysis."""
from __future__ import annotations

import math
from typing import Any

import pandas as pd
from sqlalchemy.orm import Session

from app.services.r2r_pattern_engine import R2RPatternEngine


def _json_safe(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_json_safe(x) for x in obj]
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if hasattr(obj, "isoformat"):
        try:
            return obj.isoformat()
        except Exception:
            return str(obj)
    return obj


def _validate(raw: dict[str, Any]) -> tuple[bool, list[str]]:
    errs: list[str] = []
    if raw.get("error"):
        errs.append(str(raw["error"]))
        return False, errs
    rows = raw.get("flagged_entries") or raw.get("rows") or raw.get("flagged") or []
    if isinstance(rows, list):
        for r in rows[:500]:
            if not isinstance(r, dict):
                continue
            rs = r.get("risk_score")
            if rs is not None:
                try:
                    x = float(rs)
                    if x < 0 or x > 100:
                        errs.append(f"risk_score out of range: {x}")
                except (TypeError, ValueError):
                    errs.append("invalid risk_score")
    return (len(errs) == 0, errs)


def run(db: Session, tenant_id: str, context: dict[str, Any]) -> dict[str, Any]:
    del db, tenant_id
    rows = context.get("rows")
    if not rows or not isinstance(rows, list):
        return {
            "ok": False,
            "error": "context.rows required: list of journal dicts (amount, date, account, …)",
            "output": None,
            "validation": {"passed": False, "errors": ["missing rows"]},
        }
    df = pd.DataFrame(rows)
    engine = R2RPatternEngine()
    raw = engine.analyse(
        df,
        sensitivity=str(context.get("sensitivity") or "balanced"),
        materiality_amount=float(context.get("materiality_amount") or 0),
        materiality_pct=float(context.get("materiality_pct") or 0),
    )
    if isinstance(raw, dict) and raw.get("error"):
        return {
            "ok": False,
            "error": str(raw["error"]),
            "output": _json_safe(raw),
            "validation": {"passed": False, "errors": [str(raw["error"])]},
        }
    safe = _json_safe(raw) if isinstance(raw, dict) else {"result": str(raw)}
    ok, errs = _validate(safe if isinstance(safe, dict) else {})
    return {"ok": ok, "error": None, "output": safe, "validation": {"passed": ok, "errors": errs}}
