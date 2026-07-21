"""AR sales invoice GulfTax classify helpers (sale direction).

Mirrors AP /api/uae/ap/classify-invoice via gulftax_bridge, but:
- transaction_type = "sale"
- TRN is buyer (customer) TRN
- Art.54 / foreign-supplier reverse-charge enrichments stay purchase-only
  inside classifier._enrich_classification when type is sale
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from app.models.uae_accounting_full import UAESalesInvoice

logger = logging.getLogger(__name__)

LOW_CONFIDENCE_THRESHOLD = 0.7


def normalize_buyer_trn(trn: str | None) -> str:
    return (trn or "").strip().replace(" ", "").replace("-", "")


def buyer_trn_valid(trn: str | None) -> bool:
    """
    Empty buyer TRN is allowed (B2C / optional UI field).
    If provided, must be 15 numeric digits.
    """
    cleaned = normalize_buyer_trn(trn)
    if not cleaned:
        return True
    return cleaned.isdigit() and len(cleaned) == 15


def classify_ar_invoice_sync(
    *,
    invoice_number: str,
    customer_name: str,
    total_amount: float,
    invoice_date: str,
    description: str = "",
    buyer_trn: str | None = None,
    company_id: str = "default",
    entity_type: str = "mainland",
) -> dict[str, Any]:
    """
    Sync classify for AR create paths.
    On classifier failure → REVIEW_QUEUE (never silent AUTO_APPROVE).
    """
    from app.modules.gulftax.classifier import classify_transaction
    from app.services.gulftax_bridge import _compute_risk

    cleaned = normalize_buyer_trn(buyer_trn)
    trn_ok = buyer_trn_valid(buyer_trn)
    desc = description or f"AR Sales Invoice to {customer_name}"

    try:
        data = classify_transaction(
            description=desc,
            amount_aed=float(total_amount),
            vendor_or_customer=customer_name,
            transaction_type="sale",
            entity_type=entity_type,
        )
        risk_score, decision = _compute_risk(data, trn_ok)
        # Invalid format (when TRN provided) already forces HARD_BLOCK via _compute_risk
        confidence = float(data.get("confidence_score", 1.0))
        flag = bool(data.get("flag_for_review", False))
        if decision == "REVIEW_QUEUE" or confidence < LOW_CONFIDENCE_THRESHOLD:
            flag = True

        return {
            "invoice_number": invoice_number,
            "customer_name": customer_name,
            "total_amount": float(total_amount),
            "trn_valid": trn_ok,
            "buyer_trn": cleaned or None,
            "vat_treatment": data.get("vat_treatment", "standard_rated"),
            "vat_rate": float(data.get("vat_rate", 5.0)),
            "vat_amount_aed": float(data.get("vat_amount_aed", 0.0)),
            "confidence_score": confidence,
            "reasoning": data.get("reasoning") or "",
            "flag_for_review": flag,
            "blocked_input_vat": bool(data.get("blocked_input_vat", False)),
            "blocked_reason": data.get("blocked_reason") or "",
            "blocked_vat_amount": float(data.get("blocked_vat_amount", 0.0)),
            "uae_law_sources": list(data.get("uae_law_sources") or []),
            "risk_score": risk_score,
            "decision": decision,
            "classify_error": None,
        }
    except Exception as exc:
        logger.exception(
            "AR GulfTax classify failed for invoice %s: %s", invoice_number, exc
        )
        note = (
            f"GulfTax classify unavailable — queued for review. ({exc})"
        )
        return {
            "invoice_number": invoice_number,
            "customer_name": customer_name,
            "total_amount": float(total_amount),
            "trn_valid": trn_ok,
            "buyer_trn": cleaned or None,
            "vat_treatment": "standard_rated",
            "vat_rate": 5.0,
            "vat_amount_aed": round(float(total_amount) * 0.05 / 1.05, 2)
            if total_amount
            else 0.0,
            "confidence_score": 0.0,
            "reasoning": note,
            "flag_for_review": True,
            "blocked_input_vat": False,
            "blocked_reason": "",
            "blocked_vat_amount": 0.0,
            "uae_law_sources": [],
            "risk_score": 50.0,
            "decision": "REVIEW_QUEUE",
            "classify_error": str(exc),
        }


def apply_classification_to_invoice(
    inv: UAESalesInvoice,
    clf: dict[str, Any],
) -> None:
    """Persist classify fields on the AR invoice row."""
    inv.vat_treatment = clf.get("vat_treatment")
    inv.gulftax_decision = clf.get("decision")
    inv.gulftax_risk_score = clf.get("risk_score")
    inv.gulftax_confidence = clf.get("confidence_score")
    inv.trn_valid = clf.get("trn_valid")
    inv.flag_for_review = bool(clf.get("flag_for_review", False))
    inv.gulftax_reasoning = clf.get("reasoning") or None


def classify_and_store_sales_invoice(
    db: Session,
    inv: UAESalesInvoice,
    *,
    customer_name: str,
    description: str = "",
) -> dict[str, Any]:
    """Classify an existing draft invoice and store results on the row."""
    lines = list(inv.lines or [])
    desc = description or (
        lines[0].description if lines and lines[0].description else ""
    )
    clf = classify_ar_invoice_sync(
        invoice_number=inv.invoice_number or inv.id,
        customer_name=customer_name,
        total_amount=float(inv.total_amount or 0),
        invoice_date=inv.invoice_date.isoformat() if inv.invoice_date else "",
        description=desc,
        buyer_trn=inv.buyer_trn,
        company_id=inv.company_id or "default",
    )
    apply_classification_to_invoice(inv, clf)
    db.add(inv)
    db.flush()
    return clf
