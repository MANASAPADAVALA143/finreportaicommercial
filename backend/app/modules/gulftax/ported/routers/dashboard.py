"""Dashboard summary API."""
from calendar import monthrange
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import get_current_company_id
from models import AuditLog, Company, Invoice, ReconciliationResult

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])


def _add_months(d0: date, months: int) -> date:
    total = d0.year * 12 + d0.month - 1 + months
    y = total // 12
    m = total % 12 + 1
    day = min(d0.day, monthrange(y, m)[1])
    return date(y, m, day)


def _calendar_quarter(today: date) -> Tuple[date, date, str]:
    q = (today.month - 1) // 3 + 1
    start_month = 3 * (q - 1) + 1
    start = date(today.year, start_month, 1)
    if q == 4:
        end = date(today.year, 12, 31)
    else:
        end = date(today.year, start_month + 3, 1) - timedelta(days=1)
    return start, end, f"Q{q} {today.year}"


def _vat_filing_deadline(period_end: date) -> date:
    return period_end + timedelta(days=28)


def _days_between(d0: date, d1: date) -> int:
    return (d1 - d0).days


def _real_vat_kpis(
    *,
    workspace_id: str,
    company_id: str,
    period: str,
) -> Dict[str, Any]:
    """VAT Due + classified counts from real AR + gulftax (not ported Transaction)."""
    from app.core.database import SessionLocal
    from app.modules.gulftax.vat_return_service import fetch_all_vat_return_boxes
    from app.services.ap_invoice_post_service import _resolve_company_id_for_je

    fr_db = SessionLocal()
    try:
        resolved = _resolve_company_id_for_je(
            fr_db, workspace_id, company_id, invoice_ref="dashboard-summary"
        )
        boxes = fetch_all_vat_return_boxes(
            fr_db,
            workspace_id=workspace_id,
            company_id=resolved,
            period=period,
        )
        return {
            "estimated_payable_aed": round(
                float(boxes.get("box12_net_vat_payable_or_refundable") or 0), 2
            ),
            "transactions_classified": int(boxes.get("sales_invoice_count") or 0)
            + int(boxes.get("purchase_entry_count") or 0),
            "transactions_needing_review": 0,
        }
    finally:
        fr_db.close()


@router.get("/summary")
async def dashboard_summary(
    company_id: str = Depends(get_current_company_id),
    db: Session = Depends(get_db),
    x_company_id: Optional[str] = Header(default=None, alias="X-Company-Id"),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
) -> Dict[str, Any]:
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    today = date.today()
    period_start, period_end, label = _calendar_quarter(today)
    filing_deadline = _vat_filing_deadline(period_end)
    days_to_filing = _days_between(today, filing_deadline)

    active_company = (
        (x_company_id or getattr(company, "external_id", None) or company_id or "")
    ).strip()
    workspace_id = (
        (x_workspace_id or "").strip()
        or str(getattr(company, "workspace_id", None) or "").strip()
        or active_company
    )
    q = (today.month - 1) // 3 + 1
    tax_period = f"{today.year}-Q{q}"

    estimated_payable_aed = 0.0
    transactions_classified = 0
    transactions_needing_review = 0
    try:
        vat_kpis = _real_vat_kpis(
            workspace_id=workspace_id,
            company_id=active_company,
            period=tax_period,
        )
        estimated_payable_aed = float(vat_kpis["estimated_payable_aed"])
        transactions_classified = int(vat_kpis["transactions_classified"])
        transactions_needing_review = int(vat_kpis["transactions_needing_review"])
        # If current quarter empty, fall back to prior quarter with data
        if transactions_classified == 0 and estimated_payable_aed == 0:
            prev = today.month - 3
            py, pm = (today.year, prev) if prev > 0 else (today.year - 1, prev + 12)
            pq = (pm - 1) // 3 + 1
            prev_period = f"{py}-Q{pq}"
            prev_kpis = _real_vat_kpis(
                workspace_id=workspace_id,
                company_id=active_company,
                period=prev_period,
            )
            if (
                int(prev_kpis["transactions_classified"]) > 0
                or float(prev_kpis["estimated_payable_aed"]) != 0
            ):
                estimated_payable_aed = float(prev_kpis["estimated_payable_aed"])
                transactions_classified = int(prev_kpis["transactions_classified"])
                period_start, period_end, label = _calendar_quarter(date(py, max(pm, 1), 1))
                filing_deadline = _vat_filing_deadline(period_end)
                days_to_filing = _days_between(today, filing_deadline)
                tax_period = prev_period
    except Exception:
        # Do NOT fall back to ported Transaction table for VAT KPIs.
        estimated_payable_aed = 0.0
        transactions_classified = 0
        transactions_needing_review = 0

    last_fy_end = date(today.year - 1, 12, 31)
    ct_deadline = _add_months(last_fy_end, 9)
    days_to_ct = _days_between(today, ct_deadline)

    mandate = date(2027, 1, 1)
    days_to_mandate = _days_between(today, mandate)
    revenue = company.annual_revenue_aed or 0.0
    asp_ok = bool(company.asp_appointed)

    readiness = 0
    try:
        from app.core.database import SessionLocal
        from app.modules.gulftax.gulftax_einvoicing import compute_company_readiness

        fr_db = SessionLocal()
        try:
            ready = compute_company_readiness(
                fr_db, db, workspace_id, active_company or company_id
            )
            readiness = int(ready.get("readiness_score") or 0)
            asp_ok = bool(ready.get("asp_appointed") or (ready.get("inputs") or {}).get("asp_appointed"))
            if ready.get("days_to_go_live") is not None:
                days_to_mandate = int(ready["days_to_go_live"])
        finally:
            fr_db.close()
    except Exception:
        # Fallback: honest minimal deductions without phase stub 72
        readiness = 100
        if not asp_ok:
            readiness -= 20
        if not str(getattr(company, "trn", None) or "").strip():
            readiness -= 15
        readiness = max(0, readiness)

    recent_activity: List[Dict[str, Any]] = []
    try:
        recent_rows = (
            db.query(AuditLog)
            .filter(AuditLog.company_id == company_id)
            .order_by(AuditLog.timestamp.desc())
            .limit(12)
            .all()
        )
        recent_activity = [
            {
                "timestamp": r.timestamp.isoformat() if r.timestamp else "",
                "actor": r.actor,
                "action": r.action,
                "entity": r.entity or "",
            }
            for r in recent_rows
        ]
    except Exception:
        db.rollback()

    pending_approvals = 0
    try:
        pending_approvals = (
            db.query(func.count(Invoice.id))
            .filter(
                Invoice.company_id == company_id,
                Invoice.status.in_(["pending", "review", "escalated"]),
            )
            .scalar()
            or 0
        )
    except Exception:
        db.rollback()

    open_mismatches = 0
    try:
        open_mismatches = (
            db.query(func.count(ReconciliationResult.id))
            .filter(
                and_(
                    ReconciliationResult.company_id == company_id,
                    ReconciliationResult.status == "mismatch_found",
                )
            )
            .scalar()
            or 0
        )
    except Exception:
        db.rollback()

    # ── Invoice Flow queue stats (ported Invoice table — unchanged) ────────────
    all_invoices: List[Any] = []
    try:
        all_invoices = (
            db.query(Invoice)
            .filter(Invoice.company_id == company_id)
            .all()
        )
    except Exception:
        db.rollback()
    inv_pending_review = sum(1 for i in all_invoices if i.status == "review")
    inv_escalated      = sum(1 for i in all_invoices if i.status == "escalated")
    inv_auto_approved_today = sum(
        1 for i in all_invoices
        if i.status == "auto_approved"
        and i.created_at
        and i.created_at.date() == today
    )
    inv_total_vat_at_risk = sum(
        float(flag.get("vat_at_risk_aed", 0) or 0)
        for i in all_invoices
        for flag in (i.risk_flags or [])
        if isinstance(flag, dict) and (flag.get("severity") or "").upper() == "HIGH"
    )

    ct_status = "not_started"
    try:
        from app.services.uae_suite_service import get_latest_ct_status_for_company

        ct_status = get_latest_ct_status_for_company(company_id)
    except Exception:
        pass

    return {
        "current_period": {
            "start_date": period_start.isoformat(),
            "end_date": period_end.isoformat(),
            "label": label,
            "tax_period": tax_period,
        },
        "vat": {
            "estimated_payable_aed": round(float(estimated_payable_aed), 2),
            "transactions_classified": transactions_classified,
            "transactions_needing_review": transactions_needing_review,
            "days_to_filing": days_to_filing,
            "filing_deadline": filing_deadline.isoformat(),
        },
        "corporate_tax": {
            "estimated_liability_aed": 0.0,
            "filing_deadline": ct_deadline.isoformat(),
            "days_to_deadline": days_to_ct,
            "status": ct_status,
        },
        "e_invoicing": {
            "readiness_score": int(readiness),
            "mandate_date": mandate.isoformat(),
            "days_to_mandate": days_to_mandate,
            "asp_appointed": asp_ok,
        },
        "recent_activity": recent_activity,
        "pending_approvals": int(pending_approvals),
        "open_reconciliation_mismatches": int(open_mismatches),
        "invoice_flow": {
            "pending_review": inv_pending_review,
            "escalated": inv_escalated,
            "auto_approved_today": inv_auto_approved_today,
            "total_invoices": len(all_invoices),
            "total_vat_at_risk_aed": round(inv_total_vat_at_risk, 2),
        },
    }


@router.get("/activity")
async def dashboard_activity(
    company_id: str = Depends(get_current_company_id),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """Activity feed for dashboard timeline widgets."""
    rows: List[Any] = []
    try:
        rows = (
            db.query(AuditLog)
            .filter(AuditLog.company_id == company_id)
            .order_by(AuditLog.timestamp.desc())
            .limit(limit)
            .all()
        )
    except Exception:
        db.rollback()
        return []
    return [
        {
            "id": r.id,
            "company_id": r.company_id,
            "timestamp": r.timestamp.isoformat() if r.timestamp else "",
            "actor": r.actor,
            "action": r.action,
            "entity": r.entity,
            "entity_type": r.entity_type,
            "entity_id": r.entity_id,
            "before_state": r.before_state,
            "after_state": r.after_state,
        }
        for r in rows
    ]
