"""
GulfTax AI Bridge Service
==========================
Calls GulfTax AI (https://github.com/MANASAPADAVALA143/uaetax.git) to classify
UAE VAT on AP invoices before they are approved and posted to the GL.

GulfTax runs at GULFTAX_API_URL (default: http://localhost:8000).
Endpoint: POST /api/vat/classify-transaction

Risk Decision Tiers:
  < 35  → AUTO_APPROVE  (green — post straight to GL)
  35–70 → REVIEW_QUEUE  (amber — CFO must confirm)
  ≥ 70 or invalid TRN → HARD_BLOCK (red — blocked)

Art. 54 UAE VAT: entertainment / hospitality input tax is fully blocked.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger(__name__)

GULFTAX_URL: str = os.getenv("GULFTAX_API_URL", "http://localhost:8000")
_TIMEOUT = 15.0  # seconds


# ── Request / Result dataclasses ──────────────────────────────────────────────

@dataclass
class ClassifyRequest:
    """Maps AP invoice fields → GulfTax ClassifyTransactionRequest schema."""
    company_id: str
    description: str
    amount_aed: float
    vendor_or_customer: str
    transaction_type: str          # "purchase" | "sale"
    entity_type: str               # "mainland" | "free_zone" | "designated_zone"
    invoice_number: str
    transaction_date: str          # YYYY-MM-DD


@dataclass
class ClassificationResult:
    vat_treatment: str
    vat_rate: float
    vat_amount_aed: float
    confidence_score: float
    reasoning: str
    flag_for_review: bool
    blocked_input_vat: bool
    blocked_reason: str
    blocked_vat_amount: float
    uae_law_sources: list[str] = field(default_factory=list)
    # Computed by bridge
    risk_score: float = 0.0
    decision: str = "AUTO_APPROVE"   # AUTO_APPROVE | REVIEW_QUEUE | HARD_BLOCK
    trn_valid: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "vat_treatment":     self.vat_treatment,
            "vat_rate":          self.vat_rate,
            "vat_amount_aed":    self.vat_amount_aed,
            "confidence_score":  self.confidence_score,
            "reasoning":         self.reasoning,
            "flag_for_review":   self.flag_for_review,
            "blocked_input_vat": self.blocked_input_vat,
            "blocked_reason":    self.blocked_reason,
            "blocked_vat_amount":self.blocked_vat_amount,
            "uae_law_sources":   self.uae_law_sources,
            "risk_score":        self.risk_score,
            "decision":          self.decision,
            "trn_valid":         self.trn_valid,
        }


# ── Risk scoring ──────────────────────────────────────────────────────────────

def _compute_risk(data: dict[str, Any], trn_valid: bool) -> tuple[float, str]:
    """
    Score 0–100 based on GulfTax output fields + TRN validity.
    Returns (risk_score, decision).
    """
    score = 0.0

    # Art. 54: blocked entertainment/hospitality input VAT — major risk flag
    if data.get("blocked_input_vat"):
        score += 40.0

    # Confidence < 1.0 contributes up to 30 pts
    confidence = float(data.get("confidence_score", 1.0))
    score += max(0.0, (1.0 - confidence)) * 30.0

    # Review flag adds 15 pts
    if data.get("flag_for_review"):
        score += 15.0

    # Invalid or missing TRN adds 30 pts
    if not trn_valid:
        score += 30.0

    score = min(round(score, 1), 100.0)

    if not trn_valid or score >= 70:
        decision = "HARD_BLOCK"
    elif score >= 35:
        decision = "REVIEW_QUEUE"
    else:
        decision = "AUTO_APPROVE"

    return score, decision


# ── Public API ────────────────────────────────────────────────────────────────

async def classify_invoice(
    req: ClassifyRequest,
    trn_valid: bool = True,
) -> ClassificationResult:
    """
    Call GulfTax POST /api/vat/classify-transaction and return a
    ClassificationResult with computed risk_score + decision.

    Raises:
        httpx.ConnectError  — if GulfTax is not reachable
        httpx.HTTPStatusError — on non-2xx response
    """
    payload = {
        "company_id":          req.company_id,
        "description":         req.description,
        "amount_aed":          req.amount_aed,
        "vendor_or_customer":  req.vendor_or_customer,
        "transaction_type":    req.transaction_type,
        "entity_type":         req.entity_type,
        "invoice_number":      req.invoice_number,
        "transaction_date":    req.transaction_date,
    }

    logger.info(
        "GulfTax classify → invoice=%s vendor=%s amount=%.2f",
        req.invoice_number, req.vendor_or_customer, req.amount_aed,
    )

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            f"{GULFTAX_URL}/api/vat/classify-transaction",
            json=payload,
        )
        resp.raise_for_status()
        data: dict[str, Any] = resp.json()

    risk_score, decision = _compute_risk(data, trn_valid)

    return ClassificationResult(
        vat_treatment    = data.get("vat_treatment", "standard_rated"),
        vat_rate         = float(data.get("vat_rate", 5.0)),
        vat_amount_aed   = float(data.get("vat_amount_aed", 0.0)),
        confidence_score = float(data.get("confidence_score", 1.0)),
        reasoning        = data.get("reasoning", ""),
        flag_for_review  = bool(data.get("flag_for_review", False)),
        blocked_input_vat= bool(data.get("blocked_input_vat", False)),
        blocked_reason   = data.get("blocked_reason", ""),
        blocked_vat_amount = float(data.get("blocked_vat_amount", 0.0)),
        uae_law_sources  = list(data.get("uae_law_sources", [])),
        risk_score       = risk_score,
        decision         = decision,
        trn_valid        = trn_valid,
    )


async def health_check() -> dict[str, Any]:
    """
    Ping GulfTax GET /health.
    Returns {"online": True/False, "url": ..., ...}
    Never raises — always returns a dict.
    """
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{GULFTAX_URL}/health")
            return {
                "online":      resp.status_code < 400,
                "status_code": resp.status_code,
                "url":         GULFTAX_URL,
                "detail":      resp.text[:200] if resp.text else "",
            }
    except httpx.ConnectError:
        return {"online": False, "error": "Connection refused", "url": GULFTAX_URL}
    except Exception as exc:
        return {"online": False, "error": str(exc), "url": GULFTAX_URL}
