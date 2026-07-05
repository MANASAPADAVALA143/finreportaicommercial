"""VAT reconciliation — gulftax_transactions vs filed VAT return."""

from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.client_data import GulftaxTransaction
from app.modules.gulftax.vat_return_service import fetch_all_vat_return_boxes, parse_period

_MISMATCH_THRESHOLD_AED = 100.0


def _ported_models():
    """Lazy import of GulfTax ported ORM (separate metadata from FinReportAI)."""
    import sys
    from pathlib import Path

    root = Path(__file__).resolve().parents[1] / "modules" / "gulftax" / "ported"
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from models import ReconciliationResult, VATReturn  # noqa: WPS433

    return ReconciliationResult, VATReturn


def _period_label(period_start: date, period_end: date) -> str:
    """Best-effort tax_period label for a date range."""
    if period_start.year == period_end.year and period_start.month == period_end.month:
        return f"{period_start.year}-{period_start.month:02d}"
    q = (period_start.month - 1) // 3 + 1
    return f"{period_start.year}-Q{q}"


def get_vat_periods(
    db: Session,
    *,
    tenant_id: str,
    company_id: str,
) -> list[dict[str, Any]]:
    """Distinct tax periods from RDS gulftax_transactions."""
    rows = (
        db.query(
            GulftaxTransaction.tax_period,
            func.count(GulftaxTransaction.id).label("transaction_count"),
            func.min(GulftaxTransaction.transaction_date).label("period_start"),
            func.max(GulftaxTransaction.transaction_date).label("period_end"),
        )
        .filter(
            GulftaxTransaction.tenant_id == tenant_id,
            GulftaxTransaction.company_id == company_id,
            GulftaxTransaction.status == "posted",
        )
        .group_by(GulftaxTransaction.tax_period)
        .order_by(GulftaxTransaction.tax_period.desc())
        .all()
    )
    return [
        {
            "tax_period": r.tax_period,
            "transaction_count": int(r.transaction_count or 0),
            "period_start": r.period_start.isoformat() if r.period_start else None,
            "period_end": r.period_end.isoformat() if r.period_end else None,
        }
        for r in rows
    ]


def _find_vat_return(ported_db: Session, *, company_id: str, period_start: date, period_end: date):
    _, VATReturn = _ported_models()

    return (
        ported_db.query(VATReturn)
        .filter(
            VATReturn.company_id == company_id,
            VATReturn.period_start <= period_end,
            VATReturn.period_end >= period_start,
        )
        .order_by(VATReturn.created_at.desc())
        .first()
    )


def _latest_recon(
    ported_db: Session,
    *,
    company_id: str,
    tax_period: str,
):
    ReconciliationResult, _ = _ported_models()

    return (
        ported_db.query(ReconciliationResult)
        .filter(
            ReconciliationResult.company_id == company_id,
            ReconciliationResult.tax_period == tax_period,
        )
        .order_by(ReconciliationResult.created_at.desc())
        .first()
    )


def _box_breakdown(computed: dict[str, Any]) -> dict[str, float]:
    return {
        "box8_total_output_vat": float(computed.get("box8_total_output_vat") or 0),
        "box11_total_input_vat": float(computed.get("box11_total_input_vat") or 0),
        "box12_net_vat_payable_or_refundable": float(
            computed.get("box12_net_vat_payable_or_refundable") or 0
        ),
    }


def _compare_boxes(
    computed: dict[str, Any],
    vat_return,
) -> tuple[list[dict[str, Any]], float]:
    """Compare computed FTA boxes against a filed VATReturn row."""
    mismatches: list[dict[str, Any]] = []
    total_diff = 0.0

    checks = [
        (
            "Box 8 — Total output VAT",
            float(computed.get("box8_total_output_vat") or 0),
            float(vat_return.box2_vat_on_supplies or 0),
        ),
        (
            "Box 11 — Total input VAT",
            float(computed.get("box11_total_input_vat") or 0),
            float(vat_return.box7_vat_on_expenses or 0),
        ),
        (
            "Box 12 — Net VAT payable / refundable",
            float(computed.get("box12_net_vat_payable_or_refundable") or 0),
            float(vat_return.box8_vat_payable_or_refundable or 0),
        ),
    ]

    for label, tx_amount, return_amount in checks:
        diff = abs(round(tx_amount - return_amount, 2))
        if diff > _MISMATCH_THRESHOLD_AED:
            mismatches.append(
                {
                    "invoice_number": label,
                    "issue": f"{label} mismatch",
                    "transaction_amount": tx_amount,
                    "return_amount": return_amount,
                    "difference": diff,
                }
            )
            total_diff += diff

    return mismatches, round(total_diff, 2)


def run_vat_recon(
    db: Session,
    ported_db: Session,
    *,
    tenant_id: str,
    company_id: str,
    period_start: date,
    period_end: date,
    tax_period: str | None = None,
) -> dict[str, Any]:
    """
    Aggregate gulftax_transactions (via fetch_all_vat_return_boxes), compare to
    vat_returns for the period, persist reconciliation_results.
    """
    ReconciliationResult, _ = _ported_models()

    period = tax_period or _period_label(period_start, period_end)
    computed = fetch_all_vat_return_boxes(
        db,
        workspace_id=tenant_id,
        company_id=company_id,
        period=period,
    )
    boxes = _box_breakdown(computed)

    tx_count = (
        db.query(func.count(GulftaxTransaction.id))
        .filter(
            GulftaxTransaction.tenant_id == tenant_id,
            GulftaxTransaction.company_id == company_id,
            GulftaxTransaction.tax_period == period,
            GulftaxTransaction.status == "posted",
        )
        .scalar()
        or 0
    )

    vat_return = _find_vat_return(
        ported_db,
        company_id=company_id,
        period_start=period_start,
        period_end=period_end,
    )

    if not vat_return:
        status = "no_return"
        mismatches: list[dict[str, Any]] = []
        difference_aed = 0.0
        vat_return_id = None
        return_output = 0.0
    else:
        mismatches, difference_aed = _compare_boxes(computed, vat_return)
        status = "matched" if not mismatches else "mismatch_found"
        vat_return_id = vat_return.id
        return_output = float(vat_return.box2_vat_on_supplies or 0)

    recommendation = "No issues found. Transaction data aligns with the VAT return."
    if status == "no_return":
        recommendation = (
            "No VAT return on file for this period. Run reconciliation after generating "
            "a return, or file using computed box values from GulfTax transactions."
        )
    elif mismatches:
        recommendation = (
            "Review mismatches before filing. Common causes: unposted AP/AR sync, "
            "manual return overrides, or transactions outside the tax period."
        )

    row = ReconciliationResult(
        company_id=company_id,
        vat_return_id=vat_return_id,
        tax_period=period,
        period_start=period_start,
        period_end=period_end,
        total_invoices_aed=float(tx_count),
        total_output_vat_aed=boxes["box8_total_output_vat"],
        vat_return_output_aed=return_output,
        difference_aed=difference_aed,
        mismatches=mismatches,
        box_breakdown=boxes,
        status=status,
        source="gulftax_transactions",
    )
    ported_db.add(row)
    ported_db.commit()
    ported_db.refresh(row)

    return {
        "id": row.id,
        "status": status,
        "difference_aed": difference_aed,
        "tax_period": period,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "transaction_count": int(tx_count),
        "box_breakdown": boxes,
        "computed_boxes": {
            k: computed.get(k)
            for k in (
                "box8_total_output_vat",
                "box11_total_input_vat",
                "box12_net_vat_payable_or_refundable",
                "sales_invoice_count",
                "purchase_entry_count",
                "source",
            )
        },
        "vat_return_id": vat_return_id,
        "mismatches": mismatches,
        "recommendation": recommendation,
        "source": "gulftax_transactions",
    }


def get_recon_status(
    ported_db: Session,
    *,
    company_id: str,
    period: str,
) -> dict[str, Any]:
    """Latest reconciliation result for a tax period."""
    row = _latest_recon(ported_db, company_id=company_id, tax_period=period)
    if not row:
        period_start, period_end = parse_period(period)
        return {
            "status": "never_run",
            "tax_period": period,
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "difference_aed": None,
            "mismatches": [],
            "override_reason": None,
            "last_run_at": None,
            "source": None,
        }

    return {
        "id": row.id,
        "status": row.status,
        "tax_period": row.tax_period or period,
        "period_start": row.period_start.isoformat() if row.period_start else None,
        "period_end": row.period_end.isoformat() if row.period_end else None,
        "difference_aed": float(row.difference_aed or 0),
        "box_breakdown": row.box_breakdown,
        "mismatches": row.mismatches or [],
        "override_reason": row.override_reason,
        "last_run_at": row.created_at.isoformat() if row.created_at else None,
        "source": row.source,
    }


def get_recon_history(
    ported_db: Session,
    *,
    company_id: str,
    limit: int = 20,
) -> list[dict[str, Any]]:
    ReconciliationResult, _ = _ported_models()

    rows = (
        ported_db.query(ReconciliationResult)
        .filter(ReconciliationResult.company_id == company_id)
        .order_by(ReconciliationResult.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": r.id,
            "status": r.status,
            "tax_period": r.tax_period,
            "period_start": r.period_start.isoformat() if r.period_start else None,
            "period_end": r.period_end.isoformat() if r.period_end else None,
            "difference_aed": float(r.difference_aed or 0),
            "transaction_count": float(r.total_invoices_aed or 0),
            "override_reason": r.override_reason,
            "source": r.source,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


def set_recon_override(
    ported_db: Session,
    *,
    company_id: str,
    period: str,
    reason: str,
) -> dict[str, Any]:
    """Record filing override reason on the latest recon row for a period."""
    row = _latest_recon(ported_db, company_id=company_id, tax_period=period)
    if not row:
        raise ValueError("No reconciliation run found for this period — run recon first.")
    if row.status != "mismatch_found":
        raise ValueError("Override is only required when reconciliation found mismatches.")

    row.override_reason = reason.strip()[:2000]
    ported_db.commit()
    ported_db.refresh(row)
    return {
        "id": row.id,
        "status": row.status,
        "tax_period": period,
        "override_reason": row.override_reason,
    }
