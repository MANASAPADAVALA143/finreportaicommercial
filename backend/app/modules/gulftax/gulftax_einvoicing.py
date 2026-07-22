"""GulfTax E-Invoicing — unified Peppol PINT AE API."""
from __future__ import annotations

import os
from datetime import date, datetime, timezone
from typing import Any, Literal, Optional

import httpx
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.client_data import EinvoicingSubmission
from app.models.company_setup import UaeCompanyProfile
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
    # Honest demo checklist (Fix 5)
    trn_recorded: bool = False
    vat_registered: bool = True
    has_company_profile: bool = True
    has_einvoice_submissions_period: bool = False


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


def _asp_appointed_from_company(company: Any) -> bool:
    if bool(getattr(company, "asp_appointed", False)):
        return True
    settings = getattr(company, "settings", None) or {}
    return bool(str(settings.get("asp_provider") or "").strip())


def _invoice_format_from_company(company: Any) -> str:
    settings = getattr(company, "settings", None) or {}
    explicit = str(settings.get("invoice_format") or "").strip()
    if explicit:
        return explicit
    if str(settings.get("peppol_participant_id") or "").strip():
        return "Peppol PINT AE"
    return "PDF"


def _integration_status_from_company(
    company: Any,
    *,
    submission_count: int = 0,
    accepted_count: int = 0,
) -> IntegrationStatus:
    settings = getattr(company, "settings", None) or {}
    explicit = settings.get("integration_status")
    if explicit in ("not_started", "planning", "testing", "live"):
        return explicit  # type: ignore[return-value]
    if accepted_count > 0:
        return "live"
    if submission_count > 0:
        return "testing"
    if str(settings.get("peppol_participant_id") or "").strip():
        return "planning"
    return "not_started"


def readiness_request_from_company(
    company: Any,
    *,
    submission_count: int = 0,
    accepted_count: int = 0,
    trn_recorded: bool = False,
    vat_registered: bool | None = None,
    has_company_profile: bool = True,
    has_einvoice_submissions_period: bool = False,
) -> ReadinessRequest:
    settings = getattr(company, "settings", None) or {}
    revenue = float(
        getattr(company, "annual_revenue_aed", None)
        or settings.get("annual_revenue_aed")
        or 0
    )
    master = settings.get("master_data_clean")
    if master not in ("YES", "PARTIAL", "NO"):
        master = "PARTIAL"
    trn = str(getattr(company, "trn", None) or settings.get("trn") or "").strip()
    vat_reg = (
        bool(vat_registered)
        if vat_registered is not None
        else bool(getattr(company, "vat_registered", True))
    )
    return ReadinessRequest(
        annual_revenue_aed=revenue,
        asp_appointed=_asp_appointed_from_company(company),
        invoice_format=_invoice_format_from_company(company),
        integration_status=_integration_status_from_company(
            company,
            submission_count=submission_count,
            accepted_count=accepted_count,
        ),
        master_data_clean=master,
        budget_confirmed=bool(settings.get("budget_confirmed")),
        trn_recorded=trn_recorded or bool(trn),
        vat_registered=vat_reg,
        has_company_profile=has_company_profile,
        has_einvoice_submissions_period=has_einvoice_submissions_period
        or submission_count > 0,
    )


def resolve_gulftax_company(ported_db: Session, company_id: str | None, tenant_id: str):
    """Map FinReport company / workspace id to GulfTax companies row."""
    try:
        # Same import path as ported routers — avoid double-registering
        # Company on MetaData (InvalidRequestError: Table 'companies'…).
        from app.modules.gulftax.ported_mount import _ensure_ported_path

        _ensure_ported_path()
        from models import Company
    except Exception:
        return None

    if company_id:
        row = ported_db.query(Company).filter(Company.id == company_id).first()
        if row:
            return row
        row = ported_db.query(Company).filter(Company.external_id == company_id).first()
        if row:
            return row

    return (
        ported_db.query(Company)
        .filter(Company.workspace_id == tenant_id)
        .order_by(Company.created_at.desc())
        .first()
    )


def _einvoicing_submission_counts(
    db: Session,
    tenant_id: str,
    company_id: str | None,
) -> tuple[int, int]:
    from app.services.einvoicing_constants import RECORD_TYPE_INTERNAL_VENDOR

    q = db.query(EinvoicingSubmission).filter(EinvoicingSubmission.tenant_id == tenant_id)
    if company_id:
        q = q.filter(EinvoicingSubmission.company_id == company_id)
    rows = [
        r
        for r in q.all()
        if (getattr(r, "record_type", None) or "outbound_ar") != RECORD_TYPE_INTERNAL_VENDOR
    ]
    accepted = sum(1 for r in rows if (r.submission_status or "").lower() == "accepted")
    return len(rows), accepted


def _einvoicing_submissions_this_quarter(
    db: Session,
    tenant_id: str,
    company_id: str | None,
) -> int:
    """Count outbound AR e-invoice submissions created in the current calendar quarter."""
    from sqlalchemy import or_

    from app.services.einvoicing_constants import RECORD_TYPE_INTERNAL_VENDOR, RECORD_TYPE_OUTBOUND_AR

    today = date.today()
    qtr = (today.month - 1) // 3 + 1
    start_month = 3 * (qtr - 1) + 1
    start = date(today.year, start_month, 1)
    q = db.query(EinvoicingSubmission).filter(
        EinvoicingSubmission.tenant_id == tenant_id,
        EinvoicingSubmission.created_at >= datetime(start.year, start.month, start.day),
        or_(
            EinvoicingSubmission.record_type == RECORD_TYPE_OUTBOUND_AR,
            EinvoicingSubmission.record_type.is_(None),
            EinvoicingSubmission.record_type == "",
        ),
    )
    # Explicitly exclude vendor-received internal archives
    q = q.filter(
        or_(
            EinvoicingSubmission.record_type.is_(None),
            EinvoicingSubmission.record_type != RECORD_TYPE_INTERNAL_VENDOR,
        )
    )
    if company_id:
        q = q.filter(EinvoicingSubmission.company_id == company_id)
    return q.count()


def compute_company_readiness(
    db: Session,
    ported_db: Session,
    tenant_id: str,
    company_id: str | None,
) -> dict[str, Any]:
    """Shared readiness path for UAE Suite dashboard and GulfTax E-Invoicing page."""
    profile = (
        db.query(UaeCompanyProfile)
        .filter(UaeCompanyProfile.workspace_id == tenant_id)
        .order_by(UaeCompanyProfile.created_at.asc())
        .first()
    )
    if company_id and (
        not profile or (profile and profile.id != company_id)
    ):
        by_id = db.query(UaeCompanyProfile).filter(UaeCompanyProfile.id == company_id).first()
        if by_id:
            profile = by_id

    company = resolve_gulftax_company(ported_db, company_id, tenant_id)

    # Tenant-wide outbound submissions this quarter (company_id filters often miss)
    period_subs = _einvoicing_submissions_this_quarter(db, tenant_id, None)
    sub_count, accepted = _einvoicing_submission_counts(db, tenant_id, None)

    trn_recorded = bool((getattr(profile, "trn", None) or "").strip())
    # Do not trust ported companies.trn — auto-provision often stamps a synthetic TRN.
    vat_registered = True
    if company is not None and hasattr(company, "vat_registered"):
        vat_registered = bool(company.vat_registered)
    has_profile = profile is not None

    if company:
        params = readiness_request_from_company(
            company,
            submission_count=sub_count,
            accepted_count=accepted,
            trn_recorded=trn_recorded,
            vat_registered=vat_registered,
            has_company_profile=has_profile,
            has_einvoice_submissions_period=period_subs > 0 or sub_count > 0,
        )
        result = _compute_readiness(params)
        result["inputs"] = {
            "annual_revenue_aed": params.annual_revenue_aed,
            "asp_appointed": params.asp_appointed,
            "trn_recorded": params.trn_recorded,
            "vat_registered": params.vat_registered,
            "has_company_profile": params.has_company_profile,
            "has_einvoice_submissions_period": params.has_einvoice_submissions_period,
            "invoice_format": params.invoice_format,
            "integration_status": params.integration_status,
        }
        return result

    revenue = 5_000_000.0
    if profile:
        revenue = float(getattr(profile, "annual_revenue_aed", None) or revenue)
    params = ReadinessRequest(
        annual_revenue_aed=revenue,
        asp_appointed=False,
        invoice_format="PDF",
        integration_status="not_started",
        master_data_clean="PARTIAL",
        budget_confirmed=False,
        trn_recorded=trn_recorded,
        vat_registered=vat_registered,
        has_company_profile=has_profile,
        has_einvoice_submissions_period=period_subs > 0 or sub_count > 0,
    )
    result = _compute_readiness(params)
    result["inputs"] = params.model_dump()
    return result


def _compute_readiness(params: ReadinessRequest) -> dict[str, Any]:
    """Honest Fix-5 checklist score (0–100). Replaces phase-bracket stub."""
    phase = svc.calculate_phase(params.annual_revenue_aed)
    score = 100
    gaps: list[dict[str, str]] = []

    if not params.asp_appointed:
        score -= 20
        gaps.append(
            {
                "level": "critical",
                "text": "ASP provider not configured — required before Oct 30 2026",
            }
        )
    if not params.trn_recorded:
        score -= 15
        gaps.append({"level": "critical", "text": "Company TRN not recorded"})
    if not params.has_einvoice_submissions_period:
        score -= 10
        gaps.append(
            {
                "level": "high",
                "text": "No AR e-invoice XML generated this period",
            }
        )
    if not params.vat_registered:
        score -= 15
        gaps.append({"level": "critical", "text": "Company not VAT-registered"})
    if not params.has_company_profile:
        score -= 10
        gaps.append({"level": "high", "text": "UAE company profile not set up"})

    score = max(0, min(100, score))
    if score >= 80:
        urgency = "GREEN"
    elif score >= 50:
        urgency = "AMBER"
    else:
        urgency = "RED"
    return {
        **phase,
        "readiness_score": score,
        "urgency": urgency,
        "gaps": gaps,
        "days_to_go_live": phase["days_to_mandatory"],
        "asp_appointed": params.asp_appointed,
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
    return {"workspace_id": body.workspace_id, "inputs": body.model_dump(), **result}


def _ported_db():
    from app.modules.gulftax.ported_mount import get_ported_db

    yield from get_ported_db()


@router.get("/readiness/company")
def company_readiness_assessment(
    workspace_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
    x_company_id: Optional[str] = Header(default=None, alias="X-Company-Id"),
    db: Session = Depends(get_db),
    ported_db: Session = Depends(_ported_db),
):
    """Readiness from persisted GulfTax company settings (same path as UAE Suite dashboard)."""
    tenant = (x_workspace_id or workspace_id or "demo").strip() or "demo"
    cid = (company_id or x_company_id or "").strip() or None
    result = compute_company_readiness(db, ported_db, tenant, cid)
    return {"workspace_id": tenant, "company_id": cid, **result}


@router.get("/{invoice_id}/download-xml")
def download_stored_einvoice_xml(
    invoice_id: str,
    workspace_id: Optional[str] = Query(None),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
    db: Session = Depends(get_db),
):
    """Download stored PINT AE XML for an AR invoice (outbound only)."""
    from app.services.einvoicing_constants import RECORD_TYPE_INTERNAL_VENDOR

    tenant = _tenant(x_workspace_id or workspace_id)
    row = (
        db.query(EinvoicingSubmission)
        .filter(
            EinvoicingSubmission.tenant_id == tenant,
            EinvoicingSubmission.invoice_id == invoice_id,
        )
        .order_by(EinvoicingSubmission.created_at.desc())
        .first()
    )
    if not row or not (row.xml_payload or "").strip():
        row = (
            db.query(EinvoicingSubmission)
            .filter(EinvoicingSubmission.invoice_id == invoice_id)
            .order_by(EinvoicingSubmission.created_at.desc())
            .first()
        )
    if not row or not (row.xml_payload or "").strip():
        raise HTTPException(404, "No e-invoice XML found for this invoice")
    if (getattr(row, "record_type", None) or "") == RECORD_TYPE_INTERNAL_VENDOR:
        raise HTTPException(
            400,
            "Vendor-received internal records cannot be downloaded as outbound e-invoices",
        )
    filename = f"pint-ae-{(row.invoice_number or invoice_id).replace('/', '-')}.xml"
    return Response(
        content=row.xml_payload,
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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
async def submit_to_asp(
    body: AspSubmitRequest,
    db: Session = Depends(get_db),
    ported_db: Session = Depends(_ported_db),
):
    if body.net_amount <= 0:
        raise HTTPException(400, "net_amount must be positive")
    tenant = _tenant(body.workspace_id)
    company_id = body.company_id or tenant
    company_trn: str | None = None
    prof = db.query(UaeCompanyProfile).filter(UaeCompanyProfile.id == company_id).first()
    if prof and prof.trn:
        company_trn = prof.trn
    else:
        gulf_co = resolve_gulftax_company(ported_db, company_id, tenant)
        if gulf_co and getattr(gulf_co, "trn", None):
            company_trn = gulf_co.trn
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
    try:
        if not body.submission_id:
            svc.assert_outbound_asp_seller(body.seller_trn, company_trn)
        row = svc.submit_to_asp(
            db,
            tenant_id=tenant,
            company_id=company_id,
            invoice_number=body.invoice_number,
            xml_payload=xml,
            invoice_id=body.invoice_id,
            submission_id=body.submission_id,
        )
    except ValueError as exc:
        raise HTTPException(403, str(exc)) from exc
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
    row = db.query(EinvoicingSubmission).filter_by(id=submission_id).first()
    if not row or row.tenant_id != tenant:
        raise HTTPException(404, "Submission not found")
    try:
        svc.assert_asp_submittable(row)
    except ValueError as exc:
        raise HTTPException(403, str(exc)) from exc
    row = svc.update_submission_status(db, submission_id, status="pending", error_message="")
    if not row:
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
