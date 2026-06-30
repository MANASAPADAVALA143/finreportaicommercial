"""GulfTax — Transfer Pricing analysis."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/gulftax/tp", tags=["GulfTax Transfer Pricing"])

MATERIALITY_AED = 3_000_000

_tp_store: dict[str, list[dict[str, Any]]] = {}


class TPTransaction(BaseModel):
    counterparty_name: str
    relationship: str = Field(..., description="e.g. parent, subsidiary, associate")
    transaction_type: str
    amount_aed: float = Field(..., gt=0)
    tp_method: str = Field("TNMM", description="CUP | TNMM | Cost Plus")


class TPAnalyseRequest(BaseModel):
    transactions: list[TPTransaction] = Field(default_factory=list)
    local_file_prepared: bool = False
    master_file_prepared: bool = False


@router.get("/transactions")
def list_tp_transactions(
    x_company_id: str | None = Header(default=None, alias="X-Company-Id"),
) -> dict[str, Any]:
    key = (x_company_id or "default").strip()
    return {"transactions": _tp_store.get(key, [])}


@router.post("/transactions")
def add_tp_transaction(
    body: TPTransaction,
    x_company_id: str | None = Header(default=None, alias="X-Company-Id"),
) -> dict[str, Any]:
    key = (x_company_id or "default").strip()
    row = body.model_dump()
    _tp_store.setdefault(key, []).append(row)
    return {"success": True, "transaction": row}


@router.post("/analyse")
def analyse_transfer_pricing(
    body: TPAnalyseRequest,
    x_company_id: str | None = Header(default=None, alias="X-Company-Id"),
) -> dict[str, Any]:
    key = (x_company_id or "default").strip()
    txs = body.transactions or _tp_store.get(key, [])
    if body.transactions:
        _tp_store[key] = [t.model_dump() for t in body.transactions]

    related = [t if isinstance(t, dict) else t.model_dump() for t in txs]
    breaches = [t for t in related if float(t.get("amount_aed", 0)) >= MATERIALITY_AED]

    risk = "LOW"
    if len(breaches) >= 3:
        risk = "HIGH"
    elif len(breaches) >= 1:
        risk = "MEDIUM"

    if not body.local_file_prepared and breaches:
        risk = "HIGH" if risk == "MEDIUM" else risk

    return {
        "related_party_transactions": related,
        "materiality_breaches": breaches,
        "materiality_threshold_aed": MATERIALITY_AED,
        "documentation_status": {
            "local_file_prepared": body.local_file_prepared,
            "master_file_prepared": body.master_file_prepared,
            "within_materiality": len(breaches) == 0,
        },
        "risk_level": risk,
        "recommendation": (
            "Prepare local file and master file — material related-party transactions detected."
            if breaches
            else "Related-party transactions below materiality or well documented."
        ),
    }
