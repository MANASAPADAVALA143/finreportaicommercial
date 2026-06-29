"""IFRS 15 contract register — CRUD, recognition, JE posting."""
from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.ifrs15_contract import IFRS15Contract
from app.services.uae_journal_service import create_journal_entry


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def calculate_percentage_complete(method: str, data: dict) -> float:
    if method == "cost_incurred":
        total = _f(data.get("total_estimated_costs"))
        return min(_f(data.get("costs_incurred")) / total * 100, 100) if total else 0.0
    if method == "milestone":
        milestones = data.get("milestones") or []
        if not milestones:
            return 0.0
        completed = sum(1 for m in milestones if m.get("completed"))
        return min(completed / len(milestones) * 100, 100)
    if method == "time_elapsed":
        start = data.get("start_date")
        end = data.get("end_date")
        if not start or not end:
            return 0.0
        if isinstance(start, str):
            start = date.fromisoformat(start[:10])
        if isinstance(end, str):
            end = date.fromisoformat(end[:10])
        elapsed = (date.today() - start).days
        total = (end - start).days
        return min(elapsed / total * 100, 100) if total > 0 else 0.0
    if method == "units_delivered":
        total = _f(data.get("total_units"))
        return min(_f(data.get("units_delivered")) / total * 100, 100) if total else 0.0
    return 0.0


def _parse_obligations(raw: str | None) -> list[dict]:
    if not raw:
        return []
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return []


def _contract_dict(c: IFRS15Contract) -> dict[str, Any]:
    obs = _parse_obligations(c.performance_obligations)
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
        "status": c.status,
        "je_posted": bool(c.je_posted),
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


def list_contracts(db: Session, workspace_id: str, company_id: str | None = None) -> list[dict]:
    q = db.query(IFRS15Contract).filter(IFRS15Contract.workspace_id == workspace_id)
    if company_id:
        q = q.filter(IFRS15Contract.company_id == company_id)
    return [_contract_dict(c) for c in q.order_by(IFRS15Contract.created_at.desc()).all()]


def get_contract(db: Session, contract_id: str, workspace_id: str, company_id: str | None = None) -> IFRS15Contract | None:
    q = db.query(IFRS15Contract).filter(IFRS15Contract.id == contract_id, IFRS15Contract.workspace_id == workspace_id)
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


def calculate_recognition(
    db: Session,
    contract_id: str,
    obligation_index: int,
    method: str,
    method_data: dict,
    workspace_id: str,
    company_id: str | None,
) -> dict[str, Any]:
    contract = get_contract(db, contract_id, workspace_id, company_id)
    if not contract:
        raise ValueError("Contract not found")
    obs = _parse_obligations(contract.performance_obligations)
    if obligation_index < 0 or obligation_index >= len(obs):
        raise ValueError("Invalid obligation index")
    ob = obs[obligation_index]
    pct = calculate_percentage_complete(method, {**method_data, "start_date": ob.get("start_date"), "end_date": ob.get("end_date")})
    allocated = _f(ob.get("allocated_transaction_price_aed"))
    already = _f(ob.get("revenue_recognised_aed"))
    revenue = (pct / 100) * allocated
    incremental = max(revenue - already, 0)
    ob["percentage_complete"] = round(pct, 2)
    ob["revenue_recognised_aed"] = round(revenue, 2)
    ob["revenue_remaining_aed"] = round(allocated - revenue, 2)
    obs[obligation_index] = ob
    update_contract(db, contract, {"performance_obligations": obs})
    billed = _f(method_data.get("billed_amount_aed"))
    asset_or_liability = "contract_asset" if revenue > billed else "contract_liability"
    return {
        "percentage_complete": round(pct, 2),
        "revenue_to_recognise": round(revenue, 2),
        "journal_entry_amount": round(incremental, 2),
        "contract_asset_or_liability": asset_or_liability,
        "incremental_recognition": round(incremental, 2),
    }


def post_recognition_je(
    db: Session,
    *,
    contract_id: str,
    obligation_index: int,
    period_date: date,
    amount_aed: float,
    workspace_id: str,
    company_id: str | None,
    billed_amount: float = 0,
) -> dict[str, Any]:
    contract = get_contract(db, contract_id, workspace_id, company_id)
    if not contract:
        raise ValueError("Contract not found")
    obs = _parse_obligations(contract.performance_obligations)
    ob = obs[obligation_index] if 0 <= obligation_index < len(obs) else {}
    desc = ob.get("description", "Performance obligation")
    customer = contract.customer_name
    je_ids: list[str] = []

    if amount_aed > 0.01:
        je1 = create_journal_entry(
            tenant_id=workspace_id,
            company_id=company_id,
            entry_date=period_date,
            description=f"IFRS 15: {customer} - {desc}",
            reference=f"IFRS15-{contract_id[:8]}",
            source="IFRS15_REVENUE",
            lines=[
                {"account_code": "1300", "account_name": "Contract Asset", "debit": amount_aed, "credit": 0},
                {"account_code": "4100", "account_name": "Revenue", "debit": 0, "credit": amount_aed},
            ],
            db=db,
            auto_post=True,
        )
        je_ids.append(je1.id)

    if billed_amount > amount_aed + 0.01:
        diff = billed_amount - amount_aed
        je2 = create_journal_entry(
            tenant_id=workspace_id,
            company_id=company_id,
            entry_date=period_date,
            description=f"IFRS 15 Billing: {customer}",
            reference=f"IFRS15-BILL-{contract_id[:8]}",
            source="IFRS15_BILLING",
            lines=[
                {"account_code": "1200", "account_name": "Trade Receivables", "debit": billed_amount, "credit": 0},
                {"account_code": "2400", "account_name": "Contract Liability", "debit": 0, "credit": billed_amount},
            ],
            db=db,
            auto_post=True,
        )
        je_ids.append(je2.id)
        contract.contract_liability_aed = _f(contract.contract_liability_aed) + billed_amount
    elif amount_aed > billed_amount + 0.01:
        diff = amount_aed - billed_amount
        contract.contract_asset_aed = _f(contract.contract_asset_aed) + diff

    contract.total_recognised_aed = _f(contract.total_recognised_aed) + amount_aed
    contract.total_remaining_aed = max(_f(contract.contract_value_aed) - _f(contract.total_recognised_aed), 0)
    contract.je_posted = True
    contract.updated_at = datetime.utcnow()
    db.add(contract)
    db.commit()

    return {"success": True, "je_ids": je_ids, "period_date": period_date.isoformat()}
