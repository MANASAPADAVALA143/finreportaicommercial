"""IFRS 15 contract register — CRUD and portfolio summary (ifrs15_contracts table)."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.ifrs15_contract import IFRS15Contract


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _parse_obligations(raw: str | None) -> list[dict]:
    if not raw:
        return []
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return []


def contract_to_dict(c: IFRS15Contract) -> dict[str, Any]:
    obs = _parse_obligations(c.performance_obligations)
    calc: dict[str, Any] = {}
    if c.calculation_json:
        try:
            calc = json.loads(c.calculation_json)
        except json.JSONDecodeError:
            calc = {}
    return {
        "id": c.id,
        "workspace_id": c.workspace_id,
        "company_id": c.company_id,
        "contract_number": c.contract_number,
        "customer_name": c.customer_name,
        "contract_date": c.contract_date,
        "contract_value_aed": _f(c.contract_value_aed),
        "performance_obligations": obs,
        "total_recognised_aed": _f(c.total_recognised_aed),
        "total_remaining_aed": _f(c.total_remaining_aed),
        "contract_liability_aed": _f(c.contract_liability_aed),
        "contract_asset_aed": _f(c.contract_asset_aed),
        "calculation_results": calc,
        "has_calculation": bool(calc),
        "status": c.status,
        "je_posted": bool(c.je_posted),
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


def list_contracts(db: Session, workspace_id: str, company_id: str | None = None) -> list[dict]:
    q = db.query(IFRS15Contract).filter(IFRS15Contract.workspace_id == workspace_id)
    if company_id:
        q = q.filter(IFRS15Contract.company_id == company_id)
    return [contract_to_dict(c) for c in q.order_by(IFRS15Contract.created_at.desc()).all()]


def get_contract(
    db: Session, contract_id: str, workspace_id: str, company_id: str | None = None
) -> IFRS15Contract | None:
    q = db.query(IFRS15Contract).filter(
        IFRS15Contract.id == contract_id,
        IFRS15Contract.workspace_id == workspace_id,
    )
    if company_id:
        q = q.filter(IFRS15Contract.company_id == company_id)
    return q.first()


def create_contract(db: Session, data: dict[str, Any]) -> IFRS15Contract:
    obs = data.get("performance_obligations") or []
    total_val = _f(data.get("contract_value_aed"))
    recognised = sum(_f(o.get("revenue_recognised_aed")) for o in obs)
    remaining = total_val - recognised
    c = IFRS15Contract(
        workspace_id=data["workspace_id"],
        company_id=data.get("company_id"),
        contract_number=data.get("contract_number") or f"CTR-{datetime.utcnow().strftime('%Y%m%d%H%M')}",
        customer_name=data.get("customer_name", ""),
        contract_date=data.get("contract_date"),
        contract_value_aed=total_val,
        performance_obligations=json.dumps(obs, default=str),
        total_recognised_aed=recognised,
        total_remaining_aed=remaining,
        contract_liability_aed=_f(data.get("contract_liability_aed")),
        contract_asset_aed=_f(data.get("contract_asset_aed")),
        status=data.get("status", "active"),
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def update_contract(db: Session, contract: IFRS15Contract, updates: dict[str, Any]) -> IFRS15Contract:
    if "performance_obligations" in updates:
        obs = updates["performance_obligations"]
        contract.performance_obligations = json.dumps(obs, default=str)
        contract.total_recognised_aed = sum(_f(o.get("revenue_recognised_aed")) for o in obs)
        contract.total_remaining_aed = _f(contract.contract_value_aed) - _f(contract.total_recognised_aed)
    for k in ("customer_name", "status", "contract_liability_aed", "contract_asset_aed", "je_posted"):
        if k in updates:
            setattr(contract, k, updates[k])
    contract.updated_at = datetime.utcnow()
    db.add(contract)
    db.commit()
    db.refresh(contract)
    return contract


def save_calculation_results(db: Session, contract: IFRS15Contract, results: dict[str, Any]) -> IFRS15Contract:
    """Persist full IFRS 15 engine output on the contract row."""
    balances = results.get("contract_balances") or {}
    revenue_to_date = _f(balances.get("revenue_recognized_to_date"))
    contract.calculation_json = json.dumps(results, default=str)
    contract.total_recognised_aed = revenue_to_date
    contract.total_remaining_aed = max(_f(contract.contract_value_aed) - revenue_to_date, 0)
    contract.contract_liability_aed = _f(balances.get("contract_liability_amount"))
    contract.contract_asset_aed = _f(balances.get("contract_asset_amount"))
    contract.updated_at = datetime.utcnow()
    db.add(contract)
    db.commit()
    db.refresh(contract)
    return contract


def list_calculated_contract_ids(
    db: Session,
    workspace_id: str,
    company_id: str | None = None,
    *,
    period: str | None = None,
) -> list[str]:
    """Return contract IDs with persisted full-engine calculation_json."""
    q = db.query(IFRS15Contract).filter(
        IFRS15Contract.workspace_id == workspace_id,
        IFRS15Contract.calculation_json.isnot(None),
        IFRS15Contract.calculation_json != "",
    )
    if company_id:
        q = q.filter(IFRS15Contract.company_id == company_id)
    rows = q.order_by(IFRS15Contract.updated_at.desc()).all()
    if not period:
        return [r.id for r in rows]
    out: list[str] = []
    for r in rows:
        updated_ym = r.updated_at.strftime("%Y-%m") if r.updated_at else ""
        contract_ym = str(r.contract_date or "")[:7]
        if updated_ym == period or contract_ym == period or not period:
            out.append(r.id)
    return out if out else [r.id for r in rows]


def portfolio_summary(db: Session, workspace_id: str, company_id: str | None = None) -> dict[str, Any]:
    contracts = list_contracts(db, workspace_id, company_id)
    active = [c for c in contracts if c.get("status") == "active"]
    ot = pt = 0
    for c in active:
        for o in c.get("performance_obligations") or []:
            if o.get("satisfaction_method") == "over_time":
                ot += 1
            else:
                pt += 1
    return {
        "total_contracts": len(contracts),
        "total_contract_value_aed": round(sum(_f(c["contract_value_aed"]) for c in active), 2),
        "total_recognised_ytd_aed": round(sum(_f(c["total_recognised_aed"]) for c in active), 2),
        "total_remaining_aed": round(sum(_f(c["total_remaining_aed"]) for c in active), 2),
        "contract_liabilities_aed": round(sum(_f(c["contract_liability_aed"]) for c in active), 2),
        "contract_assets_aed": round(sum(_f(c["contract_asset_aed"]) for c in active), 2),
        "over_time_contracts": ot,
        "point_in_time_contracts": pt,
    }
