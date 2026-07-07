"""Revenue leakage rollup from three-way match exceptions (presentation layer only)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.rev_rec_leakage import RevRecLeakageSnapshot


def shift_period(ym: str, delta: int) -> str:
    year, month = map(int, ym.split("-"))
    month0 = (year * 12 + (month - 1)) + delta
    ny, nm = divmod(month0, 12)
    return f"{ny:04d}-{nm + 1:02d}"


def expected_revenue_amount(item: dict[str, Any]) -> float:
    sched = item.get("schedule_amount")
    if sched is not None:
        return float(sched)
    gl = item.get("gl_amount")
    if gl is not None:
        return float(gl)
    return 0.0


def is_leakage_exception(item: dict[str, Any]) -> bool:
    status = str(item.get("status") or "")
    diff = float(item.get("difference") or 0)
    if status == "missing_billing":
        return True
    if status == "billing_gl_diff" and diff < 0:
        return True
    return False


def leakage_amount_for_item(item: dict[str, Any]) -> float:
    status = str(item.get("status") or "")
    diff = float(item.get("difference") or 0)
    if status == "missing_billing":
        return abs(diff)
    if status == "billing_gl_diff" and diff < 0:
        return abs(diff)
    return 0.0


def compute_leakage_summary(items: list[dict[str, Any]], period: str) -> dict[str, Any]:
    """Aggregate leakage from three-way match items without changing match logic."""
    leakage_items: list[dict[str, Any]] = []
    expected_total = 0.0

    for raw in items:
        expected_total += expected_revenue_amount(raw)
        if not is_leakage_exception(raw):
            continue
        amt = leakage_amount_for_item(raw)
        if amt <= 0:
            continue
        leakage_items.append(
            {
                "contract_id": raw.get("contract_id"),
                "customer": raw.get("customer") or "Unknown",
                "status": raw.get("status"),
                "leakage_amount": round(amt, 2),
                "billing_amount": raw.get("billing_amount"),
                "gl_amount": raw.get("gl_amount"),
                "schedule_amount": raw.get("schedule_amount"),
                "difference": raw.get("difference"),
            }
        )

    leakage_total = round(sum(i["leakage_amount"] for i in leakage_items), 2)
    leakage_pct = round((leakage_total / expected_total * 100) if expected_total else 0.0, 2)

    return {
        "period": period,
        "leakage_total": leakage_total,
        "leakage_pct": leakage_pct,
        "expected_revenue_total": round(expected_total, 2),
        "item_count": len(leakage_items),
        "items": leakage_items,
        "prior_period": None,
        "prior_leakage_total": None,
        "trend_amount": None,
        "trend_direction": None,
    }


def _snapshot_query(db: Session, workspace_id: str, company_id: str | None, period: str):
    q = db.query(RevRecLeakageSnapshot).filter(
        RevRecLeakageSnapshot.workspace_id == workspace_id,
        RevRecLeakageSnapshot.period == period,
    )
    if company_id:
        return q.filter(RevRecLeakageSnapshot.company_id == company_id)
    return q.filter(RevRecLeakageSnapshot.company_id.is_(None))


def _apply_trend(summary: dict[str, Any], prior_row: RevRecLeakageSnapshot | None, prior_period: str) -> None:
    summary["prior_period"] = prior_period
    if not prior_row:
        summary["prior_leakage_total"] = None
        summary["trend_amount"] = None
        summary["trend_direction"] = "none"
        return
    prior_total = float(prior_row.leakage_total or 0)
    current = float(summary["leakage_total"])
    trend = round(current - prior_total, 2)
    summary["prior_leakage_total"] = prior_total
    summary["trend_amount"] = trend
    if abs(trend) < 0.01:
        summary["trend_direction"] = "flat"
    elif trend > 0:
        summary["trend_direction"] = "increase"
    else:
        summary["trend_direction"] = "decrease"


def snapshot_to_dict(row: RevRecLeakageSnapshot) -> dict[str, Any]:
    return {
        "period": row.period,
        "leakage_total": float(row.leakage_total or 0),
        "leakage_pct": float(row.leakage_pct or 0),
        "expected_revenue_total": float(row.expected_revenue_total or 0),
        "item_count": int(row.item_count or 0),
        "items": row.items_json or [],
        "prior_period": row.prior_period,
        "prior_leakage_total": row.prior_leakage_total,
        "trend_amount": row.trend_amount,
        "trend_direction": row.trend_direction,
        "saved_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def get_leakage_snapshot(
    db: Session,
    workspace_id: str,
    company_id: str | None,
    period: str,
) -> dict[str, Any] | None:
    row = _snapshot_query(db, workspace_id, company_id, period).first()
    return snapshot_to_dict(row) if row else None


def save_leakage_snapshot(
    db: Session,
    workspace_id: str,
    company_id: str | None,
    period: str,
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    summary = compute_leakage_summary(items, period)
    prior_period = shift_period(period, -1)
    prior_row = _snapshot_query(db, workspace_id, company_id, prior_period).first()
    _apply_trend(summary, prior_row, prior_period)

    row = _snapshot_query(db, workspace_id, company_id, period).first()
    now = datetime.utcnow()
    if row:
        row.leakage_total = summary["leakage_total"]
        row.leakage_pct = summary["leakage_pct"]
        row.expected_revenue_total = summary["expected_revenue_total"]
        row.item_count = summary["item_count"]
        row.prior_period = summary["prior_period"]
        row.prior_leakage_total = summary["prior_leakage_total"]
        row.trend_amount = summary["trend_amount"]
        row.trend_direction = summary["trend_direction"]
        row.items_json = summary["items"]
        row.updated_at = now
    else:
        row = RevRecLeakageSnapshot(
            id=str(uuid.uuid4()),
            workspace_id=workspace_id,
            company_id=company_id,
            period=period,
            leakage_total=summary["leakage_total"],
            leakage_pct=summary["leakage_pct"],
            expected_revenue_total=summary["expected_revenue_total"],
            item_count=summary["item_count"],
            prior_period=summary["prior_period"],
            prior_leakage_total=summary["prior_leakage_total"],
            trend_amount=summary["trend_amount"],
            trend_direction=summary["trend_direction"],
            items_json=summary["items"],
            created_at=now,
            updated_at=now,
        )
        db.add(row)

    db.commit()
    db.refresh(row)
    return snapshot_to_dict(row)


def leakage_from_three_way_result(three_way_result: dict[str, Any] | None) -> dict[str, Any] | None:
    if not three_way_result:
        return None
    period = str(three_way_result.get("period") or "")
    items = three_way_result.get("items") or []
    if not period:
        return compute_leakage_summary(items, "unknown")
    return compute_leakage_summary(items, period)


def leakage_module_status(leakage: dict[str, Any] | None) -> dict[str, str] | None:
    if not leakage:
        return None
    total = float(leakage.get("leakage_total") or 0)
    pct = float(leakage.get("leakage_pct") or 0)
    count = int(leakage.get("item_count") or 0)
    if total <= 0 and count == 0:
        status = "clean"
    elif pct >= 5 or total >= 50000:
        status = "high"
    else:
        status = "medium"
    trend = leakage.get("trend_direction")
    trend_note = ""
    if trend and trend not in ("none", "flat") and leakage.get("trend_amount") is not None:
        arrow = "↑" if trend == "increase" else "↓"
        trend_note = f" ({arrow} ${abs(float(leakage['trend_amount'])):,.0f} vs prior)"
    return {
        "module": "Revenue Leakage",
        "status": status,
        "detail": f"${total:,.0f} ({pct:.1f}% of expected){trend_note}",
    }
