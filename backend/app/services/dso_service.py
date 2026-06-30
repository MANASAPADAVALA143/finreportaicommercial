"""DSO (Days Sales Outstanding) metrics from UAE AR invoices."""

from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.models.uae_accounting_full import UAESalesInvoice

INDUSTRY_BENCHMARK = 45


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _month_bounds(year: int, month: int) -> tuple[date, date]:
    last_day = monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last_day)


def _dso_for_period(
    db: Session,
    tenant_id: str,
    company_id: str,
    period_start: date,
    period_end: date,
) -> dict[str, float]:
    days_in_period = max(1, (period_end - period_start).days + 1)

    revenue_invs = (
        db.query(UAESalesInvoice)
        .filter(
            UAESalesInvoice.tenant_id == tenant_id,
            UAESalesInvoice.company_id == company_id,
            UAESalesInvoice.invoice_date >= period_start,
            UAESalesInvoice.invoice_date <= period_end,
        )
        .all()
    )
    total_revenue = sum(_f(i.total_amount) for i in revenue_invs)

    open_invs = (
        db.query(UAESalesInvoice)
        .filter(
            UAESalesInvoice.tenant_id == tenant_id,
            UAESalesInvoice.company_id == company_id,
            UAESalesInvoice.status.notin_(["paid"]),
        )
        .all()
    )
    total_outstanding = sum(_f(i.outstanding or i.total_amount) for i in open_invs)

    dso = (total_outstanding / total_revenue) * days_in_period if total_revenue > 0 else 0.0

    due_in_period = (
        db.query(UAESalesInvoice)
        .filter(
            UAESalesInvoice.tenant_id == tenant_id,
            UAESalesInvoice.company_id == company_id,
            UAESalesInvoice.due_date >= period_start,
            UAESalesInvoice.due_date <= period_end,
        )
        .count()
    )
    collected_in_period = (
        db.query(UAESalesInvoice)
        .filter(
            UAESalesInvoice.tenant_id == tenant_id,
            UAESalesInvoice.company_id == company_id,
            UAESalesInvoice.status == "paid",
            UAESalesInvoice.paid_date >= period_start,
            UAESalesInvoice.paid_date <= period_end,
        )
        .count()
    )
    efficiency = (collected_in_period / due_in_period * 100) if due_in_period > 0 else 0.0

    return {
        "dso": round(dso, 1),
        "total_revenue": round(total_revenue, 2),
        "total_outstanding": round(total_outstanding, 2),
        "collections_efficiency_pct": round(efficiency, 1),
    }


def build_dso_metrics(
    db: Session,
    workspace_id: str,
    company_id: str,
    period_start: str,
    period_end: str,
) -> dict[str, Any]:
    start = date.fromisoformat(period_start)
    end = date.fromisoformat(period_end)
    current = _dso_for_period(db, workspace_id, company_id, start, end)

    trend: list[dict[str, Any]] = []
    today = date.today()
    for i in range(5, -1, -1):
        m_date = today.replace(day=1) - timedelta(days=i * 28)
        m_start, m_end = _month_bounds(m_date.year, m_date.month)
        month_dso = _dso_for_period(db, workspace_id, company_id, m_start, m_end)
        trend.append({
            "month": m_start.strftime("%b %Y"),
            "dso": month_dso["dso"],
        })

    dso_values = [t["dso"] for t in trend if t["dso"] > 0]
    best_dso = min(dso_values) if dso_values else 0
    worst_dso = max(dso_values) if dso_values else 0

    dso_current = current["dso"]
    vs_benchmark = round(dso_current - INDUSTRY_BENCHMARK, 1)

    return {
        "dso_current": dso_current,
        "dso_trend": trend,
        "best_dso": best_dso,
        "worst_dso": worst_dso,
        "industry_benchmark": INDUSTRY_BENCHMARK,
        "dso_vs_benchmark": vs_benchmark,
        "dso_vs_benchmark_label": (
            f"{abs(vs_benchmark):.0f} days {'above' if vs_benchmark > 0 else 'below'} benchmark"
            if vs_benchmark != 0
            else "On benchmark"
        ),
        "collections_efficiency_pct": current["collections_efficiency_pct"],
        "total_outstanding_aed": current["total_outstanding"],
        "total_revenue_aed": current["total_revenue"],
        "currency": "AED",
    }
