"""GulfTax E-Invoicing — Peppol PINT AE (embedded in FinReportAI)."""
from __future__ import annotations

import os
import uuid
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Literal, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/gulftax/einvoicing", tags=["GulfTax E-Invoicing"])

IntegrationStatus = Literal["not_started", "planning", "testing", "live"]
AspSubmissionStatus = Literal["pending", "accepted", "rejected"]

# In-memory ASP submission store (keyed by workspace_id or "default")
_asp_submissions: dict[str, list[dict[str, Any]]] = {}


class CalculatePhaseRequest(BaseModel):
    trn: str = Field(default="", max_length=15)
    annual_revenue_aed: float = Field(..., ge=0)
    transaction_profile: Literal["B2B", "B2G", "B2C"] = "B2B"
    entity_type: str = "mainland"
    workspace_id: Optional[str] = None


class ValidateInvoiceRequest(BaseModel):
    invoice_number: str
    supplier_trn: str = ""
    buyer_trn: str = ""
    net_amount: float = Field(..., ge=0)
    vat_amount: float = Field(..., ge=0)
    invoice_date: str = ""
    xml_content: str = ""
    workspace_id: Optional[str] = None


class ReadinessRequest(BaseModel):
    annual_revenue_aed: float = Field(..., ge=0)
    asp_appointed: bool = False
    invoice_format: str = "PDF"
    integration_status: IntegrationStatus = "not_started"
    master_data_clean: Literal["YES", "PARTIAL", "NO"] = "PARTIAL"
    budget_confirmed: bool = False
    invoices_per_month: int = Field(default=0, ge=0)
    business_type: Literal["B2B", "B2G", "B2C"] = "B2B"
    workspace_id: Optional[str] = None


class GenerateXmlRequest(BaseModel):
    invoice_number: str
    supplier_name: str
    supplier_trn: str
    buyer_name: str = ""
    buyer_trn: str = ""
    net_amount: float = Field(..., gt=0)
    vat_amount: float = Field(..., ge=0)
    currency: str = "AED"
    invoice_date: str = ""
    workspace_id: Optional[str] = None


def _phase_from_revenue(revenue: float) -> tuple[int, str, str]:
    if revenue >= 50_000_000:
        return 1, "2026-07-01", "Phase 1 — Revenue ≥ AED 50M (mandatory Jul 2026)"
    if revenue >= 20_000_000:
        return 2, "2027-01-01", "Phase 2 — Revenue ≥ AED 20M (mandatory Jan 2027)"
    return 3, "2027-07-01", "Phase 3 — All remaining businesses (Jul 2027)"


def _compute_readiness(params: ReadinessRequest) -> Dict[str, Any]:
    rev = params.annual_revenue_aed
    phase, deadline, phase_label = _phase_from_revenue(rev)

    score = 100
    gaps: List[Dict[str, str]] = []
    if not params.asp_appointed:
        score -= 35
        gaps.append({"level": "critical", "text": "No accredited ASP appointed"})
    if params.invoice_format in ("PDF", "Paper", "Email"):
        score -= 25
        gaps.append({"level": "high", "text": "Invoice format not Peppol / PINT AE ready"})
    if params.integration_status == "not_started":
        score -= 15
        gaps.append({"level": "high", "text": "ERP / ASP integration not started"})
    if params.master_data_clean in ("NO", "PARTIAL"):
        score -= 12
        gaps.append({"level": "high", "text": "Master data not clean for e-invoicing"})
    if not params.budget_confirmed:
        score -= 8
        gaps.append({"level": "medium", "text": "ERP upgrade budget not confirmed"})
    if params.invoices_per_month > 500 and params.integration_status != "live":
        score -= 5
        gaps.append({"level": "medium", "text": "High invoice volume without live integration"})
    if params.business_type == "B2C" and rev < 50_000_000:
        score -= 5

    score = max(0, min(100, score))
    today = date.today()
    asp_deadline = date(2026, 7, 31)
    go_live = date.fromisoformat(deadline)
    days_asp = (asp_deadline - today).days
    days_live = (go_live - today).days

    urgency = "GREEN"
    if phase == 1 and score < 40:
        urgency = "RED"
    elif phase == 1 or score < 55:
        urgency = "AMBER"

    return {
        "phase": phase,
        "phase_label": phase_label,
        "mandatory_from": deadline,
        "readiness_score": score,
        "urgency": urgency,
        "gaps": gaps,
        "days_to_asp_deadline": days_asp,
        "days_to_go_live": days_live,
        "standard": "Peppol PINT AE",
        "penalty_exposure_aed": 60_000 if (not params.asp_appointed and rev >= 50_000_000) else 5_000,
    }


@router.post("/calculate-phase")
def calculate_phase(body: CalculatePhaseRequest):
    """UAE e-invoicing phase calculator (FTA timeline)."""
    trn = body.trn.strip().replace(" ", "")
    phase, deadline, label = _phase_from_revenue(body.annual_revenue_aed)
    return {
        "trn": trn or None,
        "annual_revenue_aed": body.annual_revenue_aed,
        "phase": phase,
        "mandatory_from": deadline,
        "phase_label": label,
        "standard": "Peppol PINT AE",
        "transaction_profile": body.transaction_profile,
        "entity_type": body.entity_type,
        "workspace_id": body.workspace_id,
        "message": f"E-invoicing Phase {phase} from {deadline}",
    }


@router.post("/validate")
def validate_invoice(body: ValidateInvoiceRequest):
    """Validate invoice fields + optional UBL XML for Peppol PINT AE compliance."""
    errors: List[str] = []
    warnings: List[str] = []
    passed: List[str] = []

    trn = body.supplier_trn.strip().replace(" ", "")
    if trn:
        if len(trn) == 15 and trn.isdigit():
            passed.append("Supplier TRN format valid (15 digits)")
        else:
            errors.append("Supplier TRN must be 15 numeric digits")
    else:
        warnings.append("Supplier TRN missing")

    if body.net_amount <= 0:
        errors.append("Net amount must be positive")
    else:
        passed.append("Net amount present")

    expected_vat = round(body.net_amount * 0.05, 2)
    if abs(body.vat_amount - expected_vat) > 0.05 and body.vat_amount > 0:
        warnings.append(f"VAT amount {body.vat_amount} differs from expected 5% ({expected_vat})")
    elif body.vat_amount > 0:
        passed.append("VAT amount consistent with 5% standard rate")

    if body.invoice_date:
        passed.append("Invoice date provided")
    else:
        warnings.append("Invoice date missing")

    xml_valid = True
    if body.xml_content.strip():
        required = ["Invoice", "cbc:ID", "cac:AccountingSupplierParty", "cac:TaxTotal"]
        missing = [t for t in required if t not in body.xml_content]
        if missing:
            xml_valid = False
            errors.extend([f"XML missing tag: {t}" for t in missing])
        else:
            passed.append("UBL 2.1 structure present")

    score = max(0, min(100, 100 - len(errors) * 20 - len(warnings) * 5))
    return {
        "valid": len(errors) == 0,
        "compliance_score": score,
        "passed": passed,
        "errors": errors,
        "warnings": warnings,
        "xml_valid": xml_valid,
        "standard": "Peppol PINT AE / UBL 2.1",
        "workspace_id": body.workspace_id,
    }


@router.post("/readiness")
def readiness_assessment(body: ReadinessRequest):
    """Full Peppol readiness score with gap analysis."""
    result = _compute_readiness(body)
    return {"workspace_id": body.workspace_id, **result}


@router.post("/generate-xml")
def generate_xml(body: GenerateXmlRequest):
    """Generate minimal UBL 2.1 Peppol PINT AE invoice XML."""
    inv_date = body.invoice_date or date.today().isoformat()
    trn = body.supplier_trn.strip().replace(" ", "")
    if not trn or len(trn) != 15 or not trn.isdigit():
        raise HTTPException(400, "Valid 15-digit supplier TRN required for Peppol XML")

    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>{body.invoice_number}</cbc:ID>
  <cbc:IssueDate>{inv_date}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>{body.currency}</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>{body.supplier_name}</cbc:Name></cac:PartyName>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>{trn}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>{body.buyer_name or 'Buyer'}</cbc:Name></cac:PartyName>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="{body.currency}">{body.vat_amount:.2f}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="{body.currency}">{body.net_amount:.2f}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="{body.currency}">{body.vat_amount:.2f}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>5</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="{body.currency}">{body.net_amount:.2f}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="{body.currency}">{body.net_amount:.2f}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="{body.currency}">{(body.net_amount + body.vat_amount):.2f}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="{body.currency}">{(body.net_amount + body.vat_amount):.2f}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>"""
    return {
        "invoice_number": body.invoice_number,
        "xml_content": xml,
        "standard": "Peppol PINT AE / UBL 2.1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "workspace_id": body.workspace_id,
    }


class AspSubmitRequest(BaseModel):
    invoice_number: str
    invoice_date: str = ""
    seller_trn: str = ""
    buyer_trn: str = ""
    net_amount: float = Field(..., ge=0)
    vat_amount: float = Field(..., ge=0)
    gross_amount: float = Field(..., ge=0)
    xml_content: str = ""
    workspace_id: Optional[str] = None


class AspInboundRequest(BaseModel):
    submission_id: str
    status: AspSubmissionStatus
    rejection_reason: str = ""


def _ws_key(workspace_id: Optional[str]) -> str:
    return (workspace_id or "default").strip() or "default"


async def _trigger_asp_webhook(payload: dict[str, Any]) -> None:
    url = os.getenv("GULFTAX_ASP_WEBHOOK_URL") or os.getenv("N8N_ASP_WEBHOOK_URL")
    if not url:
        return
    async with httpx.AsyncClient(timeout=30.0) as client:
        await client.post(url, json=payload)


@router.post("/asp/submit")
async def submit_to_asp(body: AspSubmitRequest):
    """Submit validated invoice to ASP via n8n/webhook trigger."""
    if body.net_amount <= 0:
        raise HTTPException(400, "net_amount must be positive")
    sub_id = str(uuid.uuid4())
    ws = _ws_key(body.workspace_id)
    record = {
        "id": sub_id,
        "invoice_number": body.invoice_number,
        "invoice_date": body.invoice_date,
        "seller_trn": body.seller_trn,
        "buyer_trn": body.buyer_trn,
        "net_amount": body.net_amount,
        "vat_amount": body.vat_amount,
        "gross_amount": body.gross_amount,
        "status": "pending",
        "rejection_reason": None,
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "workspace_id": ws,
    }
    _asp_submissions.setdefault(ws, []).insert(0, record)
    await _trigger_asp_webhook({"event": "asp_submit", "submission": record})
    return {"submission_id": sub_id, "status": "pending", "message": "Submitted to ASP — awaiting response"}


@router.get("/asp/submissions")
def list_asp_submissions(workspace_id: Optional[str] = None, limit: int = 20):
    ws = _ws_key(workspace_id)
    rows = _asp_submissions.get(ws, [])[:limit]
    return {"items": rows}


@router.post("/asp/{submission_id}/redrive")
async def redrive_asp_submission(submission_id: str, workspace_id: Optional[str] = None):
    ws = _ws_key(workspace_id)
    rows = _asp_submissions.get(ws, [])
    rec = next((r for r in rows if r["id"] == submission_id), None)
    if not rec:
        raise HTTPException(404, "Submission not found")
    rec["status"] = "pending"
    rec["rejection_reason"] = None
    rec["updated_at"] = datetime.now(timezone.utc).isoformat()
    await _trigger_asp_webhook({"event": "asp_redrive", "submission": rec})
    return {"submission_id": submission_id, "status": "pending"}


@router.post("/asp/inbound")
def asp_inbound_status(body: AspInboundRequest, workspace_id: Optional[str] = None):
    """n8n callback to update ASP submission status (accepted/rejected)."""
    ws = _ws_key(workspace_id)
    rows = _asp_submissions.get(ws, [])
    rec = next((r for r in rows if r["id"] == body.submission_id), None)
    if not rec:
        raise HTTPException(404, "Submission not found")
    rec["status"] = body.status
    rec["rejection_reason"] = body.rejection_reason or None
    rec["updated_at"] = datetime.now(timezone.utc).isoformat()
    return {"submission_id": body.submission_id, "status": body.status}
