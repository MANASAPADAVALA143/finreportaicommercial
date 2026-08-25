"""Map IFRS 15 extractor output and DB contracts to FinReportAI shapes."""
from __future__ import annotations

import json
from datetime import datetime
from decimal import Decimal
from typing import Any

from app.models.ifrs15_contract import IFRS15Contract
from app.modules.ifrs15.ifrs15_calculator import IFRS15Input, PerformanceObligation


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _unwrap_field(obj: Any) -> Any:
    if isinstance(obj, dict) and "value" in obj:
        return obj.get("value")
    return obj


def _parse_date(raw: Any) -> str:
    if not raw:
        return ""
    s = str(raw).strip()[:10]
    return s if len(s) == 10 else ""


def is_uae_spa_extraction(data: dict[str, Any]) -> bool:
    return bool(data.get("contract_identification") or data.get("property") or data.get("parties"))


def extraction_to_portfolio_payload(extracted: dict[str, Any]) -> dict[str, Any]:
    """
    Normalize full extractor output into the shape expected by Contract Portfolio
    and ifrs15_contracts (customer_name, contract_value_aed, performance_obligations).
    """
    if is_uae_spa_extraction(extracted):
        return _uae_spa_to_portfolio(extracted)
    return _generic_to_portfolio(extracted)


def _uae_spa_to_portfolio(data: dict[str, Any]) -> dict[str, Any]:
    parties = data.get("parties") or {}
    fin = data.get("financial") or {}
    ci = data.get("contract_identification") or {}
    tl = data.get("construction_timeline") or {}
    ifrs = data.get("ifrs15_specific") or {}

    customer = _unwrap_field(parties.get("buyer_name")) or ""
    contract_value = _f(_unwrap_field(fin.get("contract_value_aed")))
    contract_date = _parse_date(_unwrap_field(ci.get("contract_date")))
    method_raw = str(_unwrap_field(ifrs.get("revenue_recognition_method")) or "over_time").lower()
    satisfaction = "point_in_time" if "point" in method_raw else "over_time"
    po_desc = str(_unwrap_field(ifrs.get("performance_obligation")) or "Delivery of property unit")
    start = _parse_date(_unwrap_field(tl.get("construction_start_date")))
    end = _parse_date(_unwrap_field(tl.get("expected_handover_date")) or _unwrap_field(tl.get("expected_completion_date")))

    return {
        "customer_name": customer,
        "contract_date": contract_date,
        "contract_value_aed": contract_value,
        "performance_obligations": [
            {
                "description": po_desc,
                "standalone_selling_price_aed": contract_value,
                "allocated_transaction_price_aed": contract_value,
                "satisfaction_method": satisfaction,
                "start_date": start,
                "end_date": end,
            }
        ],
        "payment_terms": _unwrap_field(fin.get("payment_plan")),
        "extraction_type": "uae_spa",
        "raw_extraction": data,
    }


def _generic_to_portfolio(data: dict[str, Any]) -> dict[str, Any]:
    step1 = data.get("step1_identify_contract") or {}
    details = step1.get("contract_details") or {}
    step2 = data.get("step2_performance_obligations") or {}
    step3 = data.get("step3_transaction_price") or {}
    step5 = data.get("step5_recognition") or {}

    obligations = step2.get("identified_obligations") or []
    timing = {t.get("obligation_id"): t for t in (step5.get("obligations_recognition_timing") or [])}

    perf_obs: list[dict[str, Any]] = []
    for ob in obligations:
        oid = ob.get("obligation_id")
        t = timing.get(oid) or {}
        pattern = str(t.get("recognition_pattern") or "over_time").lower()
        ssp = _f(ob.get("standalone_selling_price_estimate"))
        perf_obs.append(
            {
                "description": ob.get("description") or f"Obligation {oid}",
                "standalone_selling_price_aed": ssp,
                "allocated_transaction_price_aed": ssp,
                "satisfaction_method": "point_in_time" if "point" in pattern else "over_time",
                "start_date": _parse_date(details.get("effective_date")),
                "end_date": _parse_date(t.get("transfer_date")),
            }
        )

    total_price = _f(step3.get("total_transaction_price") or details.get("total_contract_value"))
    if perf_obs and total_price > 0:
        ssp_sum = sum(_f(o["allocated_transaction_price_aed"]) for o in perf_obs)
        if ssp_sum <= 0:
            each = total_price / len(perf_obs)
            for o in perf_obs:
                o["standalone_selling_price_aed"] = round(each, 2)
                o["allocated_transaction_price_aed"] = round(each, 2)
        elif abs(ssp_sum - total_price) > 0.01:
            ratio = total_price / ssp_sum
            for o in perf_obs:
                o["allocated_transaction_price_aed"] = round(_f(o["allocated_transaction_price_aed"]) * ratio, 2)

    return {
        "customer_name": details.get("customer_name") or "",
        "contract_date": _parse_date(details.get("effective_date")),
        "contract_value_aed": total_price,
        "performance_obligations": perf_obs,
        "payment_terms": details.get("payment_terms") or "",
        "contract_duration_months": int(details.get("contract_term_months") or 0),
        "extraction_type": "generic_5_step",
        "raw_extraction": data,
    }


def _parse_obligations(raw: str | None) -> list[dict[str, Any]]:
    if not raw:
        return []
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return []


def contract_row_to_ifrs15_input(contract: IFRS15Contract) -> IFRS15Input:
    """Build calculator input from an ifrs15_contracts row."""
    obs = _parse_obligations(contract.performance_obligations)
    effective = datetime.utcnow()
    if contract.contract_date:
        try:
            effective = datetime.strptime(contract.contract_date[:10], "%Y-%m-%d")
        except ValueError:
            pass

    pos: list[PerformanceObligation] = []
    for i, ob in enumerate(obs):
        method = str(ob.get("satisfaction_method") or "over_time").lower()
        recognition = "point_in_time" if "point" in method else "over_time"
        end_raw = ob.get("end_date")
        transfer_dt = None
        if end_raw:
            try:
                transfer_dt = datetime.strptime(str(end_raw)[:10], "%Y-%m-%d")
            except ValueError:
                transfer_dt = None
        pos.append(
            PerformanceObligation(
                obligation_id=f"PO-{i + 1}",
                description=str(ob.get("description") or f"Obligation {i + 1}"),
                standalone_selling_price=Decimal(str(_f(ob.get("allocated_transaction_price_aed") or ob.get("standalone_selling_price_aed")))),
                recognition_method=recognition,
                duration_months=12,
                transfer_date=transfer_dt,
                recognition_date=transfer_dt,
                completion_percentage=Decimal(str(_f(ob.get("percentage_complete")))),
            )
        )

    return IFRS15Input(
        contract_id=contract.contract_number or contract.id,
        customer_name=contract.customer_name or "",
        effective_date=effective,
        contract_term_months=12,
        fixed_consideration=Decimal(str(_f(contract.contract_value_aed))),
        currency="AED",
        performance_obligations=pos,
    )


def serialize_calculation_results(results: dict[str, Any]) -> dict[str, Any]:
    """Make calculator output JSON-safe (DataFrames → records, Decimal → float)."""
    out: dict[str, Any] = {}
    for key, val in results.items():
        if val is None:
            out[key] = None
        elif hasattr(val, "to_dict"):
            try:
                out[key] = val.to_dict(orient="records")
            except Exception:
                out[key] = str(val)
        elif isinstance(val, Decimal):
            out[key] = float(val)
        elif isinstance(val, dict):
            out[key] = serialize_calculation_results(val)
        elif isinstance(val, list):
            out[key] = [
                serialize_calculation_results(v) if isinstance(v, dict) else (
                    float(v) if isinstance(v, Decimal) else v
                )
                for v in val
            ]
        else:
            out[key] = val
    return out
