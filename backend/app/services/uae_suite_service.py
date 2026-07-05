"""UAE Finance Suite — unified AP + AR + UAE Tax summary."""

from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timedelta
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models.client_data import CtReturn
from app.models.company_setup import UaeCompanyProfile
from app.modules.gulftax.gulftax_einvoicing import ReadinessRequest, _compute_readiness
from app.services.ap_aging_service import compute_ap_aging
from app.services.ap_insights_service import _compute_metrics, _fetch_invoices
from app.services.ar_aging_service import BUCKET_LABELS, BUCKET_ORDER, compute_ar_aging
from app.services.credit_note_service import list_credit_notes
from app.services.vat_recon_service import get_recon_status

SBR_CT_DEADLINE_MONTHS = 9


def _calendar_quarter(today: date) -> tuple[date, date, str]:
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


def _top_overdue_vendor(ap_aging: dict[str, Any]) -> dict[str, Any] | None:
    vendors: dict[str, float] = {}
    for inv in ap_aging.get("invoices", []):
        if int(inv.get("days_overdue") or 0) <= 0:
            continue
        name = (inv.get("vendor_name") or "Unknown").strip()
        vendors[name] = vendors.get(name, 0.0) + float(inv.get("amount") or 0)
    if not vendors:
        return None
    top_name = max(vendors, key=vendors.get)  # type: ignore[arg-type]
    return {"vendor_name": top_name, "overdue_amount": round(vendors[top_name], 2)}


def _worst_ar_bucket(ar_aging: dict[str, Any]) -> dict[str, Any] | None:
    buckets = ar_aging.get("buckets") or []
    worst = None
    for b in reversed(buckets):
        key = b.get("bucket")
        if key == "current":
            continue
        amt = float(b.get("amount") or 0)
        if amt > 0:
            worst = {
                "bucket": key,
                "label": b.get("label") or BUCKET_LABELS.get(key, key),
                "amount": amt,
            }
            break
    return worst


def _credit_notes_in_period(
    db: Session,
    tenant_id: str,
    company_id: str | None,
    period_start: date,
    period_end: date,
) -> dict[str, Any]:
    data = list_credit_notes(db, tenant_id, company_id=company_id)
    notes = []
    for cn in data.get("credit_notes", []):
        created_raw = cn.get("created_at") or cn.get("issue_date")
        if not created_raw:
            continue
        try:
            created = datetime.fromisoformat(str(created_raw)[:19]).date()
        except ValueError:
            continue
        if period_start <= created <= period_end:
            notes.append(cn)
    total = sum(float(n.get("amount") or 0) for n in notes)
    return {"count": len(notes), "total_amount": round(total, 2)}


def _latest_ct_return(db: Session, tenant_id: str, company_id: str | None) -> dict[str, Any]:
    q = db.query(CtReturn).filter(CtReturn.tenant_id == tenant_id)
    if company_id:
        q = q.filter(CtReturn.company_id == company_id)
    row = q.order_by(CtReturn.created_at.desc()).first()
    if not row:
        return {
            "status": "not_started",
            "ct_payable_aed": 0.0,
            "period_start": None,
            "period_end": None,
            "return_id": None,
        }
    return {
        "status": row.status,
        "ct_payable_aed": float(row.ct_payable_aed or 0),
        "period_start": row.period_start.isoformat() if row.period_start else None,
        "period_end": row.period_end.isoformat() if row.period_end else None,
        "return_id": row.id,
        "sbr_elected": bool(getattr(row, "sbr_elected", False)),
    }


def get_latest_ct_status_for_company(company_id: str) -> str:
    """Used by GulfTax dashboard summary — query main RDS ct_returns."""
    try:
        from app.core.database import SessionLocal

        db = SessionLocal()
        try:
            row = (
                db.query(CtReturn)
                .filter(CtReturn.company_id == company_id)
                .order_by(CtReturn.created_at.desc())
                .first()
            )
            return row.status if row else "not_started"
        finally:
            db.close()
    except Exception:
        return "not_started"


def _einvoicing_readiness(db: Session, tenant_id: str, company_id: str | None) -> dict[str, Any]:
    profile = (
        db.query(UaeCompanyProfile)
        .filter(UaeCompanyProfile.workspace_id == tenant_id)
        .first()
    )
    revenue = 5_000_000.0
    asp = False
    if profile:
        revenue = float(getattr(profile, "annual_revenue_aed", None) or revenue)
        asp = bool(getattr(profile, "asp_appointed", False))
    return _compute_readiness(
        ReadinessRequest(
            annual_revenue_aed=revenue,
            asp_appointed=asp,
            invoice_format="PDF",
            integration_status="not_started",
            master_data_clean="PARTIAL",
            budget_confirmed=False,
        )
    )


def _ap_metrics(company_id: str | None) -> dict[str, Any]:
    try:
        invoices = _fetch_invoices(company_id)
    except Exception:
        invoices = []
    if not invoices:
        return {
            "pending_approval_count": 0,
            "pending_amount": 0.0,
            "open_balance": 0.0,
            "overdue_amount": 0.0,
        }
    m = _compute_metrics(invoices)
    return {
        "pending_approval_count": m["pending_approval_count"],
        "pending_amount": m["pending_amount"],
        "open_balance": m["open_balance"],
        "overdue_amount": m["overdue_amount"],
    }


def build_uae_suite_summary(
    db: Session,
    ported_db: Session,
    *,
    tenant_id: str,
    company_id: str | None,
    period: str | None = None,
) -> dict[str, Any]:
    today = date.today()
    period_start, period_end, period_label = _calendar_quarter(today)
    tax_period = period or f"{period_start.year}-Q{(period_start.month - 1) // 3 + 1}"
    filing_deadline = _vat_filing_deadline(period_end)
    days_to_filing = (filing_deadline - today).days

    profile = (
        db.query(UaeCompanyProfile)
        .filter(UaeCompanyProfile.workspace_id == tenant_id)
        .first()
    )

    ap_aging = compute_ap_aging(company_id=company_id)
    ap_metrics = _ap_metrics(company_id)
    ar_aging = compute_ar_aging(db, tenant_id, company_id)

    recon = get_recon_status(ported_db, company_id=company_id or tenant_id, period=tax_period)

    estimated_vat = 0.0
    try:
        from app.modules.gulftax.vat_return_service import fetch_all_vat_return_boxes

        boxes = fetch_all_vat_return_boxes(
            db,
            workspace_id=tenant_id,
            company_id=company_id or tenant_id,
            period=tax_period,
        )
        estimated_vat = max(
            0.0,
            float(boxes.get("box12_net_vat_payable_or_refundable") or boxes.get("box8_vat_payable_or_refundable") or 0),
        )
    except Exception:
        estimated_vat = 0.0

    ct = _latest_ct_return(db, tenant_id, company_id)
    einvoicing = _einvoicing_readiness(db, tenant_id, company_id)
    credit_notes = _credit_notes_in_period(db, tenant_id, company_id, period_start, period_end)

    last_fy_end = date(today.year - 1, 12, 31)
    m_total = last_fy_end.month - 1 + SBR_CT_DEADLINE_MONTHS
    ct_deadline = date(
        last_fy_end.year + m_total // 12,
        m_total % 12 + 1,
        min(last_fy_end.day, monthrange(last_fy_end.year + m_total // 12, m_total % 12 + 1)[1]),
    )

    return {
        "company": {
            "name": profile.company_name if profile else None,
            "trn": profile.trn if profile else None,
        },
        "banner": {
            "vat_period_label": period_label,
            "vat_period_start": period_start.isoformat(),
            "vat_period_end": period_end.isoformat(),
            "days_to_vat_filing": days_to_filing,
            "vat_filing_deadline": filing_deadline.isoformat(),
            "ct_return_status": ct["status"],
            "ct_filing_deadline": ct_deadline.isoformat(),
        },
        "ap": {
            "total_outstanding": ap_aging.get("total_outstanding", 0),
            "total_overdue": ap_aging.get("total_overdue", 0),
            "pending_approvals": ap_metrics["pending_approval_count"],
            "pending_amount": ap_metrics["pending_amount"],
            "top_overdue_vendor": _top_overdue_vendor(ap_aging),
        },
        "ar": {
            "total_outstanding": ar_aging.get("total_outstanding", 0),
            "total_overdue": ar_aging.get("total_overdue", 0),
            "worst_aging_bucket": _worst_ar_bucket(ar_aging),
            "credit_notes_issued": credit_notes,
        },
        "uae_tax": {
            "tax_period": tax_period,
            "recon_status": recon.get("status"),
            "recon_difference_aed": recon.get("difference_aed"),
            "estimated_vat_payable_aed": round(estimated_vat, 2),
            "ct_return": ct,
            "e_invoicing": {
                "readiness_score": einvoicing.get("readiness_score", 0),
                "urgency": einvoicing.get("urgency"),
                "days_to_go_live": einvoicing.get("days_to_go_live"),
            },
        },
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }
