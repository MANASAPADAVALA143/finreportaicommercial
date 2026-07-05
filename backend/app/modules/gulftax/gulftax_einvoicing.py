"""GulfTax E-Invoicing — unified Peppol PINT AE API."""
from __future__ import annotations

import os
from datetime import date, datetime, timezone
from typing import Any, Literal, Optional

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services import einvoicing_service_unified as svc

router = APIRouter(prefix="/api/gulftax/einvoicing", tags=["GulfTax E-Invoicing"])

IntegrationStatus = Literal["not_started", "planning", "testing", "live"]
AspSubmissionStatus = Literal["pending", "accepted", "rejected", "error"]


class CalculatePhaseRequest(BaseModel):
    trn: str = Field(default="", max_length=15)
    annual_revenue_aed: float = Field(..., ge=0)
    transaction_profile: Literal["B2B", "B2G", "B2C"] = "B2B"
    entity_type: str = "mainland"
    workspace_id: Optional[str] = None


class ValidateInvoiceRequest(BaseModel):
    invoice_number: str = ""
    invoice_date: str = ""
    supplier_trn: str = ""
    seller_trn: str = ""
    buyer_trn: str = ""
    supplier_name: str = ""
    vendor_name: str = ""
    buyer_name: str = ""
    net_amount: float = Field(default=0, ge=0)
    vat_amount: float = Field(default=0, ge=0)
    gross_amount: float = Field(default=0, ge=0)
    vat_category: str = "S"
    vat_rate: float = 5.0
    vat_treatment: str = "standard"
    currency: str = "AED"
    xml_content: str = ""
    is_b2b: bool = True
    is_credit_note: bool = False
    document_type_code: str = "380"
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
    supplier_address: str = ""
    buyer_name: str = ""
    buyer_trn: str = ""
    buyer_address: str = ""
    net_amount: float = Field(..., gt=0)
    vat_amount: float = Field(..., ge=0)
    gross_amount: Optional[float] = None
    currency: str = "AED"
    invoice_date: str = ""
    vat_category: str = "S"
    vat_rate: float = 5.0
    is_credit_note: bool = False
    lines: list[dict[str, Any]] = Field(default_factory=list)
    workspace_id: Optional[str] = None


class AspSubmitRequest(BaseModel):
    invoice_number: str
    invoice_date: str = ""
    seller_trn: str = ""
    buyer_trn: str = ""
    net_amount: float = Field(..., ge=0)
    vat_amount: float = Field(..., ge=0)
    gross_amount: float = Field(..., ge=0)
    xml_content: str = ""
    invoice_id: Optional[str] = None
    submission_id: Optional[str] = None
    company_id: Optional[str] = None
    workspace_id: Optional[str] = None


class AspInboundRequest(BaseModel):
    submission_id: str
    status: AspSubmissionStatus
    rejection_reason: str = ""
    asp_reference: str = ""


def _tenant(workspace_id: Optional[str]) -> str:
    return (workspace_id or "default").strip() or "default"


async def _trigger_asp_webhook(payload: dict[str, Any]) -> None:
    url = os.getenv("GULFTAX_ASP_WEBHOOK_URL") or os.getenv("N8N_ASP_WEBHOOK_URL")
    if not url:
        return
    async with httpx.AsyncClient(timeout=30.0) as client:
        await client.post(url, json=payload)


def _compute_readiness(params: ReadinessRequest) -> dict[str, Any]:
    phase = svc.calculate_phase(params.annual_revenue_aed)
    score = 100
    gaps: list[dict[str, str]] = []
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
    score = max(0, min(100, score))
    urgency = "GREEN"
    if phase["phase_num"] == 1 and score < 40:
        urgency = "RED"
    elif phase["phase_num"] == 1 or score < 55:
        urgency = "AMBER"
    return {
        **phase,
        "readiness_score": score,
        "urgency": urgency,
        "gaps": gaps,
        "days_to_go_live": phase["days_to_mandatory"],
    }


@router.get("/calculate-phase")
@router.post("/calculate-phase")
def calculate_phase_endpoint(
    body: CalculatePhaseRequest | None = None,
    annual_revenue_aed: float | None = Query(None, ge=0),
):
    """Unified FTA phase calculator — Phase 1 mandatory Jan 2027 for ≥ AED 50M."""
    revenue = annual_revenue_aed
    if body:
        revenue = body.annual_revenue_aed
    if revenue is None:
        raise HTTPException(400, "annual_revenue_aed required")
    result = svc.calculate_phase(revenue)
    if body:
        result["trn"] = body.trn.strip() or None
        result["transaction_profile"] = body.transaction_profile
        result["entity_type"] = body.entity_type
        result["workspace_id"] = body.workspace_id
    return result


@router.post("/validate")
def validate_invoice(body: ValidateInvoiceRequest):
    """Unified PINT AE validation (15+ rules)."""
    payload = body.model_dump()
    payload["seller_trn"] = body.seller_trn or body.supplier_trn
    payload["supplier_name"] = body.supplier_name or body.vendor_name
    return svc.validate_pint_ae(payload)


@router.post("/validate-xml")
async def validate_xml_upload(
    file: UploadFile = File(...),
    is_b2b: bool = Form(default=True),
):
    content = await file.read()
    try:
        xml_content = content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(400, "File must be UTF-8 encoded XML") from exc
    return svc.validate_pint_ae({"xml_content": xml_content, "is_b2b": is_b2b})


@router.post("/readiness")
def readiness_assessment(body: ReadinessRequest):
    result = _compute_readiness(body)
    return {"workspace_id": body.workspace_id, **result}


@router.post("/generate-xml")
def generate_xml(body: GenerateXmlRequest):
    gross = body.gross_amount if body.gross_amount is not None else round(body.net_amount + body.vat_amount, 2)
    xml = svc.generate_pint_ae_xml({
        "invoice_number": body.invoice_number,
        "invoice_date": body.invoice_date or date.today().isoformat(),
        "supplier_name": body.supplier_name,
        "supplier_address": body.supplier_address,
        "seller_trn": body.supplier_trn,
        "buyer_name": body.buyer_name,
        "buyer_address": body.buyer_address,
        "buyer_trn": body.buyer_trn,
        "net_amount": body.net_amount,
        "vat_amount": body.vat_amount,
        "gross_amount": gross,
        "currency": body.currency,
        "vat_category": body.vat_category,
        "vat_rate": body.vat_rate,
        "is_credit_note": body.is_credit_note,
        "lines": body.lines,
    })
    return {
        "invoice_number": body.invoice_number,
        "xml_content": xml,
        "standard": "Peppol PINT AE / UBL 2.1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "workspace_id": body.workspace_id,
    }


@router.post("/generate-xml/download")
def generate_xml_download(body: GenerateXmlRequest):
    gross = body.gross_amount if body.gross_amount is not None else round(body.net_amount + body.vat_amount, 2)
    xml = svc.generate_pint_ae_xml({
        "invoice_number": body.invoice_number,
        "invoice_date": body.invoice_date or date.today().isoformat(),
        "supplier_name": body.supplier_name,
        "supplier_address": body.supplier_address,
        "seller_trn": body.supplier_trn,
        "buyer_name": body.buyer_name,
        "buyer_trn": body.buyer_trn,
        "net_amount": body.net_amount,
        "vat_amount": body.vat_amount,
        "gross_amount": gross,
        "currency": body.currency,
        "lines": body.lines,
    })
    filename = f"invoice_{body.invoice_number.replace('/', '-')}.xml"
    return Response(
        content=xml,
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/asp/submit")
async def submit_to_asp(body: AspSubmitRequest, db: Session = Depends(get_db)):
    if body.net_amount <= 0:
        raise HTTPException(400, "net_amount must be positive")
    tenant = _tenant(body.workspace_id)
    company_id = body.company_id or tenant
    xml = body.xml_content
    if not xml.strip():
        xml = svc.generate_pint_ae_xml({
            "invoice_number": body.invoice_number,
            "invoice_date": body.invoice_date,
            "seller_trn": body.seller_trn,
            "buyer_trn": body.buyer_trn,
            "net_amount": body.net_amount,
            "vat_amount": body.vat_amount,
            "gross_amount": body.gross_amount,
        })
    row = svc.submit_to_asp(
        db,
        tenant_id=tenant,
        company_id=company_id,
        invoice_number=body.invoice_number,
        xml_payload=xml,
        invoice_id=body.invoice_id,
        submission_id=body.submission_id,
    )
    record = svc._serialize_submission(row)
    await _trigger_asp_webhook({"event": "asp_submit", "submission": record})
    return {
        "submission_id": row.id,
        "status": row.submission_status,
        "message": "Submitted to ASP — awaiting response",
    }


@router.get("/asp/submissions")
def list_asp_submissions(
    workspace_id: Optional[str] = None,
    company_id: Optional[str] = None,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    tenant = _tenant(workspace_id)
    items = svc.list_submissions(db, tenant, company_id=company_id, limit=limit)
    return {"items": items}


@router.post("/asp/{submission_id}/redrive")
async def redrive_asp_submission(
    submission_id: str,
    workspace_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    tenant = _tenant(workspace_id)
    row = svc.update_submission_status(db, submission_id, status="pending", error_message="")
    if not row or row.tenant_id != tenant:
        raise HTTPException(404, "Submission not found")
    record = svc._serialize_submission(row)
    await _trigger_asp_webhook({"event": "asp_redrive", "submission": record})
    return {"submission_id": submission_id, "status": "pending"}


@router.post("/asp/inbound")
def asp_inbound_status(body: AspInboundRequest, db: Session = Depends(get_db)):
    """n8n callback to update ASP submission status."""
    status = body.status
    if status == "rejected" and not body.rejection_reason:
        body.rejection_reason = "Rejected by ASP"
    row = svc.update_submission_status(
        db,
        body.submission_id,
        status=status,
        asp_reference=body.asp_reference or None,
        error_message=body.rejection_reason or None,
    )
    if not row:
        raise HTTPException(404, "Submission not found")
    return {"submission_id": body.submission_id, "status": row.submission_status}
