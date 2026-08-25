"""IFRS 15 contract register — CRUD, recognition, JE posting, full 5-step engine."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.modules.ifrs15.ifrs15_adapter import (
    contract_row_to_ifrs15_input,
    serialize_calculation_results,
)
from app.modules.ifrs15.ifrs15_calculator import IFRS15Calculator
from app.modules.ifrs15.ifrs15_repository import (
    contract_to_dict,
    create_contract,
    get_contract,
    list_contracts,
    portfolio_summary,
    save_calculation_results,
    update_contract,
)
from app.services.uae_journal_service import create_journal_entry

# Re-export for rev_rec_recon backward compatibility
_contract_dict = contract_to_dict


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


def calculate_full_contract(
    db: Session,
    contract_id: str,
    workspace_id: str,
    company_id: str | None = None,
    *,
    cash_received: float = 0,
    persist: bool = False,
) -> dict[str, Any]:
    """Run the ported IFRS 15 5-step calculator for a stored contract."""
    contract = get_contract(db, contract_id, workspace_id, company_id)
    if not contract:
        raise ValueError("Contract not found")
    calc_input = contract_row_to_ifrs15_input(contract)
    if not calc_input.performance_obligations:
        raise ValueError("Contract has no performance obligations")
    calculator = IFRS15Calculator()
    from decimal import Decimal

    results = calculator.calculate_full_ifrs15(calc_input, cash_received=Decimal(str(cash_received)))
    serialized = serialize_calculation_results(results)
    if persist:
        save_calculation_results(db, contract, serialized)
    return serialized


def calculate_recognition(
    db: Session,
    contract_id: str,
    obligation_index: int,
    method: str,
    method_data: dict,
    workspace_id: str,
    company_id: str | None,
) -> dict[str, Any]:
    if (method or "").strip().lower() == "engine":
        cash_received = _f(method_data.get("cash_received_aed"))
        results = calculate_full_contract(
            db,
            contract_id,
            workspace_id,
            company_id,
            cash_received=cash_received,
            persist=True,
        )
        contract = get_contract(db, contract_id, workspace_id, company_id)
        balances = results.get("contract_balances") or {}
        revenue_to_date = _f(balances.get("revenue_recognized_to_date"))
        already = _f(contract.total_recognised_aed) if contract else 0
        incremental = max(revenue_to_date - already, 0)
        liability = _f(balances.get("contract_liability_amount"))
        asset = _f(balances.get("contract_asset_amount"))
        return {
            "method": "engine",
            "calculation_results": results,
            "transaction_price": _f(results.get("transaction_price")),
            "percentage_complete": None,
            "revenue_to_recognise": round(revenue_to_date, 2),
            "revenue_recognized_to_date": round(revenue_to_date, 2),
            "journal_entry_amount": round(incremental, 2),
            "incremental_recognition": round(incremental, 2),
            "contract_asset_or_liability": (
                "contract_liability" if liability >= asset else "contract_asset"
            ),
            "contract_balances": balances,
        }

    contract = get_contract(db, contract_id, workspace_id, company_id)
    if not contract:
        raise ValueError("Contract not found")
    import json

    try:
        obs = json.loads(contract.performance_obligations or "[]")
    except json.JSONDecodeError:
        obs = []
    if obligation_index < 0 or obligation_index >= len(obs):
        raise ValueError("Invalid obligation index")
    ob = obs[obligation_index]
    pct = calculate_percentage_complete(
        method, {**method_data, "start_date": ob.get("start_date"), "end_date": ob.get("end_date")}
    )
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
    import json

    try:
        obs = json.loads(contract.performance_obligations or "[]")
    except json.JSONDecodeError:
        obs = []
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
