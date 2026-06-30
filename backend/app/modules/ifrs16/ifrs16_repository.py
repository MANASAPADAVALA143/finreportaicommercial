"""IFRS 16 lease register — CRUD and portfolio summary."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models.ifrs16_lease import IFRS16Lease


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _lease_to_dict(lease: IFRS16Lease) -> dict[str, Any]:
    calc = {}
    if lease.calculation_json:
        try:
            calc = json.loads(lease.calculation_json)
        except json.JSONDecodeError:
            calc = {}
    end_date = None
    if lease.commencement_date and lease.lease_term_months:
        end_date = lease.commencement_date + timedelta(days=lease.lease_term_months * 30)
    return {
        "id": lease.id,
        "workspace_id": lease.workspace_id,
        "company_id": lease.company_id,
        "lease_name": lease.lease_name,
        "asset_description": lease.asset_description,
        "asset_class": lease.asset_class,
        "commencement_date": lease.commencement_date.isoformat() if lease.commencement_date else None,
        "lease_term_months": lease.lease_term_months,
        "lease_payments_aed": _f(lease.lease_payments_aed),
        "payment_frequency": lease.payment_frequency,
        "incremental_borrowing_rate": _f(lease.incremental_borrowing_rate),
        "rou_asset_initial": _f(lease.rou_asset_initial),
        "lease_liability_initial": _f(lease.lease_liability_initial),
        "rou_asset_current": _f(lease.rou_asset_current),
        "lease_liability_current": _f(lease.lease_liability_current),
        "accumulated_depreciation": _f(lease.accumulated_depreciation),
        "depreciation_ytd": _f(lease.depreciation_ytd),
        "interest_ytd": _f(lease.interest_ytd),
        "status": lease.status,
        "next_remeasurement_date": lease.next_remeasurement_date.isoformat() if lease.next_remeasurement_date else None,
        "contract_file_url": lease.contract_file_url,
        "je_posted": bool(lease.je_posted),
        "last_je_date": lease.last_je_date.isoformat() if lease.last_je_date else None,
        "end_date": end_date.isoformat() if end_date else None,
        "calculation_results": calc,
        "created_at": lease.created_at.isoformat() if lease.created_at else None,
        "updated_at": lease.updated_at.isoformat() if lease.updated_at else None,
    }


def list_leases(
    db: Session,
    workspace_id: str,
    company_id: str | None = None,
    *,
    status: str | None = None,
    asset_class: str | None = None,
    search: str | None = None,
) -> list[dict[str, Any]]:
    q = db.query(IFRS16Lease).filter(IFRS16Lease.workspace_id == workspace_id)
    if company_id:
        q = q.filter(IFRS16Lease.company_id == company_id)
    if status and status != "all":
        q = q.filter(IFRS16Lease.status == status)
    if asset_class and asset_class != "all":
        q = q.filter(IFRS16Lease.asset_class == asset_class)
    if search:
        like = f"%{search}%"
        q = q.filter(
            (IFRS16Lease.lease_name.ilike(like)) | (IFRS16Lease.asset_description.ilike(like))
        )
    rows = q.order_by(IFRS16Lease.created_at.desc()).all()
    return [_lease_to_dict(r) for r in rows]


def get_lease(db: Session, lease_id: str, workspace_id: str, company_id: str | None = None) -> IFRS16Lease | None:
    q = db.query(IFRS16Lease).filter(
        IFRS16Lease.id == lease_id,
        IFRS16Lease.workspace_id == workspace_id,
    )
    if company_id:
        q = q.filter(IFRS16Lease.company_id == company_id)
    return q.first()


def create_lease(db: Session, data: dict[str, Any]) -> IFRS16Lease:
    calc = data.get("calculation_results") or data.get("results") or {}
    schedule = calc.get("amortization_schedule") or []
    if isinstance(calc, dict) and schedule:
        calc = {**calc, "amortization_schedule": schedule}

    comm_raw = data.get("commencement_date", "")
    if isinstance(comm_raw, str):
        commencement = date.fromisoformat(comm_raw[:10])
    else:
        commencement = comm_raw

    ll = _f(data.get("lease_liability_current") or data.get("lease_liability") or calc.get("lease_liability"))
    rou = _f(data.get("rou_asset_current") or data.get("rou_asset") or calc.get("rou_asset"))

    lease = IFRS16Lease(
        workspace_id=data["workspace_id"],
        company_id=data.get("company_id"),
        lease_name=data.get("lease_name") or data.get("lease_id") or "Lease",
        asset_description=data.get("asset_description", ""),
        asset_class=data.get("asset_class", "property"),
        commencement_date=commencement,
        lease_term_months=int(data.get("lease_term_months") or 0),
        lease_payments_aed=Decimal(str(data.get("lease_payments_aed") or data.get("monthly_payment") or 0)),
        payment_frequency=data.get("payment_frequency", "monthly"),
        incremental_borrowing_rate=Decimal(str(data.get("incremental_borrowing_rate") or data.get("annual_discount_rate") or 0)),
        rou_asset_initial=Decimal(str(data.get("rou_asset_initial") or rou)),
        lease_liability_initial=Decimal(str(data.get("lease_liability_initial") or ll)),
        rou_asset_current=Decimal(str(rou)),
        lease_liability_current=Decimal(str(ll)),
        accumulated_depreciation=Decimal("0"),
        status="active",
        next_remeasurement_date=(
            date.fromisoformat(data["next_remeasurement_date"][:10])
            if data.get("next_remeasurement_date")
            else commencement + timedelta(days=365)
        ),
        contract_file_url=data.get("contract_file_url"),
        calculation_json=json.dumps(calc, default=str),
    )
    db.add(lease)
    db.commit()
    db.refresh(lease)
    return lease


def update_lease(db: Session, lease: IFRS16Lease, updates: dict[str, Any]) -> IFRS16Lease:
    for key, col in [
        ("lease_name", "lease_name"),
        ("asset_description", "asset_description"),
        ("asset_class", "asset_class"),
        ("status", "status"),
        ("lease_payments_aed", "lease_payments_aed"),
        ("rou_asset_current", "rou_asset_current"),
        ("lease_liability_current", "lease_liability_current"),
        ("accumulated_depreciation", "accumulated_depreciation"),
        ("depreciation_ytd", "depreciation_ytd"),
        ("interest_ytd", "interest_ytd"),
        ("je_posted", "je_posted"),
        ("last_je_date", "last_je_date"),
        ("next_remeasurement_date", "next_remeasurement_date"),
        ("contract_file_url", "contract_file_url"),
    ]:
        if key in updates and updates[key] is not None:
            val = updates[key]
            if key in ("last_je_date", "next_remeasurement_date") and isinstance(val, str):
                val = date.fromisoformat(val[:10])
            if key in (
                "lease_payments_aed", "rou_asset_current", "lease_liability_current",
                "accumulated_depreciation", "depreciation_ytd", "interest_ytd",
            ):
                val = Decimal(str(val))
            setattr(lease, col, val)

    if "calculation_results" in updates:
        lease.calculation_json = json.dumps(updates["calculation_results"], default=str)

    lease.updated_at = datetime.utcnow()
    db.add(lease)
    db.commit()
    db.refresh(lease)
    return lease


def soft_delete_lease(db: Session, lease: IFRS16Lease) -> IFRS16Lease:
    lease.status = "terminated"
    lease.updated_at = datetime.utcnow()
    db.add(lease)
    db.commit()
    db.refresh(lease)
    return lease


def portfolio_summary(
    db: Session,
    workspace_id: str,
    company_id: str | None = None,
) -> dict[str, Any]:
    leases = list_leases(db, workspace_id, company_id, status="active")
    today = date.today()
    d30 = today + timedelta(days=30)
    d90 = today + timedelta(days=90)

    by_class: dict[str, dict[str, float | int]] = {
        "property": {"count": 0, "rou_asset": 0.0, "liability": 0.0},
        "vehicle": {"count": 0, "rou_asset": 0.0, "liability": 0.0},
        "equipment": {"count": 0, "rou_asset": 0.0, "liability": 0.0},
        "other": {"count": 0, "rou_asset": 0.0, "liability": 0.0},
    }
    exp30 = exp90 = 0
    total_rou = total_ll = total_dep_ytd = total_int_ytd = 0.0

    all_rows = list_leases(db, workspace_id, company_id)
    active = [l for l in all_rows if l["status"] == "active"]

    for l in active:
        total_rou += l["rou_asset_current"]
        total_ll += l["lease_liability_current"]
        total_dep_ytd += l["depreciation_ytd"]
        total_int_ytd += l["interest_ytd"]
        ac = l.get("asset_class") or "other"
        if ac not in by_class:
            ac = "other"
        by_class[ac]["count"] = int(by_class[ac]["count"]) + 1
        by_class[ac]["rou_asset"] = float(by_class[ac]["rou_asset"]) + l["rou_asset_current"]
        by_class[ac]["liability"] = float(by_class[ac]["liability"]) + l["lease_liability_current"]
        end_raw = l.get("end_date")
        if end_raw:
            try:
                end_d = date.fromisoformat(end_raw[:10])
                if today <= end_d <= d30:
                    exp30 += 1
                if today <= end_d <= d90:
                    exp90 += 1
            except ValueError:
                pass

    return {
        "total_leases": len(all_rows),
        "active_leases": len(active),
        "total_rou_assets_aed": round(total_rou, 2),
        "total_lease_liability_aed": round(total_ll, 2),
        "total_depreciation_ytd": round(total_dep_ytd, 2),
        "total_interest_ytd": round(total_int_ytd, 2),
        "leases_expiring_30_days": exp30,
        "leases_expiring_90_days": exp90,
        "by_asset_class": by_class,
        "currency": "AED",
    }
