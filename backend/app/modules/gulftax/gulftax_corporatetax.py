"""GulfTax Corporate Tax — compute, return generation, TP check (embedded)."""
from __future__ import annotations

import json
import os
from datetime import date
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/gulftax/corporate-tax", tags=["GulfTax Corporate Tax"])

CT_ZERO_BAND = Decimal("375000")
CT_RATE = Decimal("0.09")
SBR_CAP = Decimal("3000000")


class CTLineItem(BaseModel):
    label: str
    amount: float


class ComputeCTRequest(BaseModel):
    fiscal_year: str = Field(..., description="e.g. 2025")
    revenue: float = Field(..., ge=0)
    accounting_profit: float
    addbacks: List[CTLineItem] = Field(default_factory=list)
    deductions: List[CTLineItem] = Field(default_factory=list)
    free_zone_income: float = 0
    qfzp_eligible: bool = False
    sbr_elected: bool = False
    entity_type: str = "mainland"
    workspace_id: Optional[str] = None


class GenerateReturnRequest(BaseModel):
    fiscal_year: str
    revenue: float
    accounting_profit: float
    taxable_income: float
    ct_payable: float
    effective_rate: float
    entity_type: str = "mainland"
    addbacks: List[CTLineItem] = Field(default_factory=list)
    deductions: List[CTLineItem] = Field(default_factory=list)
    workspace_id: Optional[str] = None


class TPCheckRequest(BaseModel):
    related_party_transactions: List[Dict[str, Any]] = Field(default_factory=list)
    fiscal_year: str = ""
    workspace_id: Optional[str] = None


def _dec(value: float) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"))


def _compute_ct(body: ComputeCTRequest) -> Dict[str, Any]:
    if body.sbr_elected and _dec(body.revenue) <= SBR_CAP:
        return {
            "fiscal_year": body.fiscal_year,
            "revenue": body.revenue,
            "accounting_profit": body.accounting_profit,
            "taxable_income": 0.0,
            "ct_payable": 0.0,
            "effective_rate": 0.0,
            "entity_type": body.entity_type,
            "sbr_applied": True,
            "message": "Small Business Relief elected — CT liability nil",
        }

    total_addbacks = sum(_dec(i.amount) for i in body.addbacks)
    total_deductions = sum(_dec(i.amount) for i in body.deductions)
    accounting_profit = _dec(body.accounting_profit)
    taxable_income = max(Decimal("0"), accounting_profit + total_addbacks - total_deductions)

    if body.qfzp_eligible:
        qualifying = min(_dec(body.free_zone_income), taxable_income)
        remaining = max(Decimal("0"), taxable_income - qualifying)
    else:
        remaining = taxable_income

    if remaining <= CT_ZERO_BAND:
        ct_payable = Decimal("0")
    else:
        ct_payable = (remaining - CT_ZERO_BAND) * CT_RATE

    ct_payable = ct_payable.quantize(Decimal("0.01"))
    eff_rate = (
        ((ct_payable / taxable_income) * Decimal("100")).quantize(Decimal("0.01"))
        if taxable_income > 0 else Decimal("0")
    )

    return {
        "fiscal_year": body.fiscal_year,
        "revenue": body.revenue,
        "accounting_profit": float(accounting_profit),
        "taxable_income": float(taxable_income),
        "ct_payable": float(ct_payable),
        "effective_rate": float(eff_rate),
        "entity_type": body.entity_type,
        "sbr_applied": False,
        "meta": {
            "threshold_aed": float(CT_ZERO_BAND),
            "standard_rate_percent": 9,
            "addbacks_total": float(total_addbacks),
            "deductions_total": float(total_deductions),
        },
    }


@router.post("/compute")
def compute_corporate_tax(body: ComputeCTRequest):
    """Compute UAE CT liability (Federal Decree-Law No. 47 of 2022)."""
    result = _compute_ct(body)
    return {"workspace_id": body.workspace_id, **result}


@router.post("/generate-return")
def generate_ct_return(body: GenerateReturnRequest):
    """Generate CT return draft JSON for FTA filing."""
    filing_deadline = f"{int(body.fiscal_year) + 1}-09-30"
    return {
        "workspace_id": body.workspace_id,
        "fiscal_year": body.fiscal_year,
        "status": "draft",
        "filing_deadline": filing_deadline,
        "entity_type": body.entity_type,
        "summary": {
            "revenue_aed": body.revenue,
            "accounting_profit_aed": body.accounting_profit,
            "taxable_income_aed": body.taxable_income,
            "ct_payable_aed": body.ct_payable,
            "effective_rate_percent": body.effective_rate,
        },
        "addbacks": [a.model_dump() for a in body.addbacks],
        "deductions": [d.model_dump() for d in body.deductions],
        "fta_form": {
            "box_accounting_profit": body.accounting_profit,
            "box_taxable_income": body.taxable_income,
            "box_ct_liability": body.ct_payable,
        },
        "message": f"CT return draft for FY {body.fiscal_year} — file by {filing_deadline}",
    }


@router.post("/tp-check")
def transfer_pricing_check(body: TPCheckRequest):
    """Basic related-party / transfer pricing risk scan."""
    flags: List[Dict[str, Any]] = []
    total_rp = Decimal("0")

    for tx in body.related_party_transactions:
        amount = _dec(float(tx.get("amount", 0) or 0))
        total_rp += amount
        party = str(tx.get("related_party", "") or "Unknown")
        tx_type = str(tx.get("type", "service") or "service")
        if amount > 1_000_000:
            flags.append({
                "severity": "high",
                "party": party,
                "amount_aed": float(amount),
                "issue": f"Material related-party {tx_type} — TP documentation required (Art. 34)",
            })
        elif amount > 250_000:
            flags.append({
                "severity": "medium",
                "party": party,
                "amount_aed": float(amount),
                "issue": f"Related-party {tx_type} above AED 250K — review arm's length pricing",
            })

    risk_score = min(100, len(flags) * 15 + (30 if total_rp > 5_000_000 else 0))
    return {
        "workspace_id": body.workspace_id,
        "fiscal_year": body.fiscal_year,
        "related_party_total_aed": float(total_rp),
        "flags": flags,
        "risk_score": risk_score,
        "recommendation": (
            "Prepare UAE TP documentation and Local File before CT filing."
            if flags else "No material related-party risks detected in submitted data."
        ),
    }


@router.post("/narrative")
def ct_narrative(body: ComputeCTRequest):
    """AI advisory narrative for CT (optional — requires ANTHROPIC_API_KEY)."""
    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not key:
        raise HTTPException(503, "ANTHROPIC_API_KEY not configured")

    computed = _compute_ct(body)
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=key)
        prompt = f"""Write a 3-paragraph UAE Corporate Tax advisory for a CFO.
FY {body.fiscal_year}, entity {body.entity_type}, revenue AED {body.revenue:,.0f},
accounting profit AED {body.accounting_profit:,.0f}, taxable income AED {computed['taxable_income']:,.0f},
CT payable AED {computed['ct_payable']:,.0f}. Plain prose, no markdown."""

        msg = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=700,
            temperature=0.3,
            messages=[{"role": "user", "content": prompt}],
        )
        return {"workspace_id": body.workspace_id, "narrative": msg.content[0].text.strip()}
    except Exception as exc:
        raise HTTPException(502, f"Claude narrative failed: {exc}") from exc
