"""
GulfTax AI — FastAPI Router (embedded in FinReportAI)
Endpoints available at /api/gulftax/...
"""
from __future__ import annotations

import json
import os
import tempfile
import uuid
from datetime import date
from typing import Any, Dict, List, Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.tenant import get_company_id, get_tenant_id
from app.modules.gulftax.auth_cfo import get_current_company_id
from app.modules.gulftax.classifier import classify_batch, classify_transaction
from app.modules.gulftax.ported_mount import get_ported_db

router = APIRouter(prefix="/api/gulftax", tags=["GulfTax VAT"])

# In-memory store for bulk Excel exports (job_id -> path)
_BULK_EXCEL_PATHS: Dict[str, str] = {}


# ── Pydantic models ────────────────────────────────────────────────────────────

class ClassifyRequest(BaseModel):
    description: str
    amount_aed: float = Field(..., gt=0)
    vendor_or_customer: Optional[str] = None
    transaction_type: str = "purchase"
    entity_type: str = "mainland"


class ClassificationResult(BaseModel):
    vat_treatment: str
    vat_rate: int
    vat_amount_aed: float
    confidence_score: float
    reasoning: str
    flag_for_review: bool
    flag_reason: Optional[str] = None
    blocked_input_vat: bool = False
    blocked_reason: Optional[str] = None
    blocked_vat_amount: float = 0.0
    uae_law_sources: Optional[List[str]] = None


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/health")
def gulftax_health():
    """GulfTax AI health check — confirms it's embedded (no port 8000 needed)."""
    return {
        "status": "active",
        "source": "built-in",
        "message": "GulfTax AI is embedded in FinReportAI — no separate service needed.",
        "endpoints": [
            "POST /api/gulftax/classify",
            "POST /api/gulftax/classify-bulk",
            "GET  /api/gulftax/health",
        ],
    }


@router.post("/vat/classify", response_model=ClassificationResult)
@router.post("/classify", response_model=ClassificationResult)
def classify(req: ClassifyRequest):
    """Classify a single UAE transaction for VAT treatment."""
    result = classify_transaction(
        description=req.description,
        amount_aed=req.amount_aed,
        vendor_or_customer=req.vendor_or_customer,
        transaction_type=req.transaction_type,
        entity_type=req.entity_type,
    )
    # Save to S3 for audit trail (non-blocking)
    try:
        from app.core.aws_config import upload_to_s3
        payload = {**result, "description": req.description, "amount_aed": req.amount_aed}
        filename = f"vat-{uuid.uuid4().hex[:8]}-{req.description[:20].replace(' ','_')}.json"
        upload_to_s3(
            json.dumps(payload).encode(),
            filename,
            folder="vat-classifications",
            country="UAE",
        )
    except Exception:
        pass

    return ClassificationResult(**result)


@router.post("/classify-bulk")
def classify_bulk(
    file: UploadFile = File(...),
    entity_type: str = Query("mainland"),
    transaction_type: str = Query("purchase"),
):
    """Classify multiple transactions from CSV/Excel. Returns JSON + Excel download URL."""
    if not file.filename:
        raise HTTPException(400, "Missing filename")

    lower = file.filename.lower()
    try:
        if lower.endswith(".csv"):
            df = pd.read_csv(file.file)
        elif lower.endswith((".xlsx", ".xls")):
            raw = pd.read_excel(file.file, engine="openpyxl", header=None)
            # Auto-detect header row
            KEYWORDS = {"desc", "amount", "date", "vendor", "supplier", "invoice", "type"}
            header_row = 0
            for i in range(min(6, len(raw))):
                hits = sum(1 for kw in KEYWORDS if kw in " ".join(str(v).lower() for v in raw.iloc[i].dropna()))
                if hits >= 2:
                    header_row = i
                    break
            df = raw.iloc[header_row + 1:].copy()
            df.columns = [str(v).strip() for v in raw.iloc[header_row].values]
            df = df.reset_index(drop=True)
        else:
            raise HTTPException(400, "Upload CSV or Excel file")

        df.columns = df.columns.str.strip().str.lower()
        df = df.dropna(how="all").reset_index(drop=True)

        # Find columns
        desc_col = amt_col = vendor_col = None
        for col in df.columns:
            cl = col.lower()
            if "desc" in cl: desc_col = col
            elif "amount" in cl and "vat" not in cl: amt_col = col
            if "vendor" in cl or "supplier" in cl or "customer" in cl: vendor_col = col

        if not desc_col:
            raise HTTPException(400, f"No description column. Found: {list(df.columns)}")
        if not amt_col:
            raise HTTPException(400, f"No amount column. Found: {list(df.columns)}")

        # Build items for batch classify
        items = []
        for _, row in df.iterrows():
            desc = str(row[desc_col]) if pd.notna(row[desc_col]) else ""
            if not desc.strip():
                continue
            amt = float(row[amt_col]) if pd.notna(row[amt_col]) else 0.0
            vendor = str(row[vendor_col]) if vendor_col and pd.notna(row.get(vendor_col, "")) else None
            items.append({"description": desc, "amount": amt, "vendor": vendor, "transaction_type": transaction_type})

        if not items:
            raise HTTPException(400, "No classifiable rows found")

        classifications = classify_batch(items, entity_type=entity_type)

        # Save all to S3 (non-blocking)
        try:
            from app.core.aws_config import upload_to_s3
            upload_to_s3(
                json.dumps(classifications, default=str).encode(),
                f"bulk-vat-{uuid.uuid4().hex[:8]}.json",
                folder="vat-classifications",
                country="UAE",
            )
        except Exception:
            pass

        # Build Excel output
        excel_rows = []
        for item, clf in zip(items, classifications):
            excel_rows.append({
                "description": item["description"],
                "amount_aed": item["amount"],
                "vendor": item.get("vendor", ""),
                "vat_treatment": clf["vat_treatment"],
                "vat_rate": clf["vat_rate"],
                "vat_amount_aed": clf["vat_amount_aed"],
                "confidence": clf["confidence_score"],
                "reasoning": clf["reasoning"],
                "needs_review": clf["flag_for_review"],
                "flag_reason": clf.get("flag_reason", ""),
                "blocked_input_vat": clf.get("blocked_input_vat", False),
            })

        job_id = str(uuid.uuid4())
        tmp_path = os.path.join(tempfile.gettempdir(), f"gulftax_bulk_{job_id}.xlsx")
        pd.DataFrame(excel_rows).to_excel(tmp_path, index=False, sheet_name="VAT Classifications")
        _BULK_EXCEL_PATHS[job_id] = tmp_path

        needs_review = sum(1 for c in classifications if c["flag_for_review"])
        merged = [{**item, **clf} for item, clf in zip(items, classifications)]
        buckets = {
            "auto_approve": [m for m in merged if m.get("bucket") == "auto_approve"],
            "review": [m for m in merged if m.get("bucket") == "review"],
            "blocked": [m for m in merged if m.get("bucket") == "blocked"],
        }
        return {
            "job_id": job_id,
            "classified": len(classifications),
            "needs_review": needs_review,
            "classifications": merged,
            "tabs": buckets,
            "summary": {
                "auto_approve": len(buckets["auto_approve"]),
                "review": len(buckets["review"]),
                "blocked": len(buckets["blocked"]),
            },
            "excel_download_url": f"/api/gulftax/classify-bulk/{job_id}/excel",
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"Classification error: {exc}")


@router.get("/classify-bulk/{job_id}/excel")
def download_bulk_excel(job_id: str):
    from fastapi.responses import FileResponse
    path = _BULK_EXCEL_PATHS.get(job_id)
    if not path or not os.path.isfile(path):
        raise HTTPException(404, "Excel export not found or expired")
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=f"vat_classified_{job_id[:8]}.xlsx",
    )


# ── Proxy endpoint for gulftax-status (sidebar health check) ─────────────────
# This replaces the old external call to localhost:8000
@router.get("/status")
def gulftax_status():
    """Used by the sidebar GulfTaxWidget — replaces localhost:8000 call."""
    return {"online": True, "status_code": 200, "url": "built-in", "source": "embedded"}


@router.get("/vat-return/boxes")
def vat_return_boxes(
    workspace_id: str = Query(..., description="FinReportAI workspace ID"),
    period: str = Query(..., description="VAT period e.g. 2025-Q1"),
):
    """Aggregate Box 9/10/11 from approved AP invoices (vat_return_entries)."""
    from app.services.gulftax_supabase import fetch_vat_return_boxes
    return fetch_vat_return_boxes(workspace_id, period)


@router.get("/vat-return/all-boxes")
def vat_return_all_boxes(
    company_id: str = Query(..., description="Company ID (tenant on invoices)"),
    period: str = Query(...),
    workspace_id: Optional[str] = Query(None, description="FinReportAI workspace ID"),
    x_workspace_id: Optional[str] = Header(None, alias="X-Workspace-Id"),
    db: Session = Depends(get_db),
):
    """FTA VAT return — boxes 1–12 (sales + purchases)."""
    from app.modules.gulftax.vat_return_service import fetch_all_vat_return_boxes

    ws = (workspace_id or x_workspace_id or "").strip() or company_id
    return fetch_all_vat_return_boxes(
        db,
        workspace_id=ws,
        company_id=company_id,
        period=period,
    )


class VatPaymentRequest(BaseModel):
    workspace_id: str
    company_id: Optional[str] = None
    payment_date: str
    amount_aed: float = Field(..., gt=0)
    bank_account_code: str = "1100"
    bank_account_name: str = "Bank Account"
    vat_payable_code: str = "2302"
    vat_payable_name: str = "VAT Payable"
    reference: str = ""


@router.post("/vat-return/record-payment")
def record_vat_payment(body: VatPaymentRequest, db: Session = Depends(get_db)):
    """Post VAT payment JE when Box 12 is payable."""
    from datetime import date as date_cls
    from app.services.uae_journal_service import create_journal_entry

    pay_date = date_cls.fromisoformat(body.payment_date[:10])
    amt = round(body.amount_aed, 2)
    je = create_journal_entry(
        tenant_id=body.workspace_id,
        entry_date=pay_date,
        description=f"VAT payment to FTA {body.reference}".strip(),
        reference=body.reference or "VAT-FTA",
        source="VAT_PAYMENT",
        company_id=body.company_id,
        db=db,
        auto_post=True,
        lines=[
            {
                "account_code": body.vat_payable_code,
                "account_name": body.vat_payable_name,
                "debit": amt,
                "credit": 0,
                "description": "VAT payable settlement",
            },
            {
                "account_code": body.bank_account_code,
                "account_name": body.bank_account_name,
                "debit": 0,
                "credit": amt,
                "description": "Bank payment — FTA",
            },
        ],
    )
    return {"success": True, "journal_entry_id": je.id, "entry_number": je.entry_number}


# ── AP → GulfTax transaction pipeline ─────────────────────────────────────────

class SyncInvoiceBody(BaseModel):
    invoice_id: str
    company_id: str
    workspace_id: Optional[str] = None


class SyncPeriodBody(BaseModel):
    tenant_id: Optional[str] = None
    company_id: Optional[str] = None
    tax_period: str


@router.post("/sync-invoice")
def sync_invoice_to_gulftax(body: SyncInvoiceBody):
    """Push one approved AP invoice into gulftax_transactions."""
    from app.services.gulftax_sync_service import log_sync_failure, sync_approved_invoice_to_gulftax

    cid = body.company_id
    result = sync_approved_invoice_to_gulftax(
        body.invoice_id, cid, workspace_id=body.workspace_id
    )
    if not result.get("ok") and not result.get("skipped"):
        log_sync_failure(
            invoice_id=body.invoice_id,
            company_id=cid,
            error=result.get("error", "sync failed"),
            workspace_id=body.workspace_id,
        )
        raise HTTPException(400, detail=result.get("error", "sync failed"))
    return result


@router.get("/transactions")
def get_gulftax_transactions(
    tenant_id: Optional[str] = Query(None, description="Alias for company_id"),
    company_id: Optional[str] = Query(None),
    tax_period: str = Query(...),
    workspace_id: Optional[str] = Query(None),
):
    from app.services.gulftax_sync_service import list_transactions

    cid = company_id or tenant_id
    if not cid:
        raise HTTPException(400, detail="company_id or tenant_id required")
    items = list_transactions(cid, tax_period, workspace_id=workspace_id)
    return {"items": items, "count": len(items), "tax_period": tax_period, "company_id": cid}


@router.get("/vat-return-summary")
def vat_return_summary(
    tenant_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    tax_period: str = Query(...),
):
    from app.services.gulftax_sync_service import aggregate_vat_return_summary

    cid = company_id or tenant_id
    if not cid:
        raise HTTPException(400, detail="company_id or tenant_id required")
    return aggregate_vat_return_summary(cid, tax_period)


@router.post("/sync-period")
def sync_gulftax_period(body: SyncPeriodBody, db: Session = Depends(get_db)):
    from app.services.gulftax_sync_service import sync_period

    cid = body.company_id or body.tenant_id
    if not cid:
        raise HTTPException(400, detail="company_id or tenant_id required")
    return sync_period(
        cid,
        body.tax_period,
        db=db,
        workspace_id=body.tenant_id,
    )


# ── VAT reconciliation (gulftax_transactions source of truth) ─────────────────

class VatReconRunBody(BaseModel):
    period: str = Field(..., description="Tax period e.g. 2025-Q1")
    company_id: Optional[str] = None
    workspace_id: Optional[str] = None


class VatReconOverrideBody(BaseModel):
    period: str
    reason: str = Field(..., min_length=3, max_length=2000)
    company_id: Optional[str] = None


@router.get("/vat-periods")
def list_vat_periods(
    company_id: Optional[str] = Query(None),
    workspace_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Distinct tax periods from RDS gulftax_transactions."""
    from app.services.vat_recon_service import get_vat_periods

    cid = company_id or workspace_id
    if not cid:
        raise HTTPException(400, detail="company_id or workspace_id required")
    tenant = workspace_id or cid
    return {"periods": get_vat_periods(db, tenant_id=tenant, company_id=cid)}


@router.post("/recon/run")
def run_gulftax_recon(
    body: VatReconRunBody,
    company_id: str = Depends(get_current_company_id),
    db: Session = Depends(get_db),
    ported_db: Session = Depends(get_ported_db),
):
    """Run VAT recon for a period — aggregates gulftax_transactions, compares to vat_returns."""
    from app.modules.gulftax.vat_return_service import parse_period
    from app.services.vat_recon_service import run_vat_recon

    cid = body.company_id or company_id
    tenant = body.workspace_id or cid
    period_start, period_end = parse_period(body.period)
    try:
        return run_vat_recon(
            db,
            ported_db,
            tenant_id=tenant,
            company_id=cid,
            period_start=period_start,
            period_end=period_end,
            tax_period=body.period,
        )
    except Exception as exc:
        raise HTTPException(500, f"Reconciliation failed: {exc}") from exc


@router.get("/recon/status")
def gulftax_recon_status(
    period: str = Query(...),
    company_id: str = Depends(get_current_company_id),
    ported_db: Session = Depends(get_ported_db),
):
    """Latest recon status for a period (filing gate)."""
    from app.services.vat_recon_service import get_recon_status

    return get_recon_status(ported_db, company_id=company_id, period=period)


@router.get("/recon/history")
def gulftax_recon_history(
    limit: int = Query(20, ge=1, le=100),
    company_id: str = Depends(get_current_company_id),
    ported_db: Session = Depends(get_ported_db),
):
    """Past reconciliation runs for the company."""
    from app.services.vat_recon_service import get_recon_history

    return {"items": get_recon_history(ported_db, company_id=company_id, limit=limit)}


@router.post("/recon/override")
def gulftax_recon_override(
    body: VatReconOverrideBody,
    company_id: str = Depends(get_current_company_id),
    ported_db: Session = Depends(get_ported_db),
):
    """Log override reason when filing despite recon mismatches."""
    from app.services.vat_recon_service import set_recon_override

    cid = body.company_id or company_id
    try:
        return set_recon_override(
            ported_db,
            company_id=cid,
            period=body.period,
            reason=body.reason,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


# ── Advance Payment VAT (FTA two-step rule) ───────────────────────────────────

class AdvanceVatRequest(BaseModel):
    invoice_amount: float = Field(..., gt=0)
    contract_value: float = Field(..., gt=0)
    invoice_date: str
    delivery_date: str = ""
    vat_rate: float = Field(default=5.0, ge=0, le=100)


@router.post("/invoice/calculate-advance-vat")
def calculate_advance_vat_endpoint(body: AdvanceVatRequest):
    """FTA advance payment VAT — VAT on receipt + VAT at delivery."""
    try:
        from app.modules.gulftax.advance_vat import calculate_advance_vat

        return calculate_advance_vat(
            invoice_amount=body.invoice_amount,
            contract_value=body.contract_value,
            invoice_date=body.invoice_date,
            delivery_date=body.delivery_date,
            vat_rate=body.vat_rate,
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(500, f"Advance VAT calculation failed: {e}") from e


class PintAeValidateRequest(BaseModel):
    invoice_number: str = ""
    invoice_date: str = ""
    vendor_name: str = ""
    vendor_trn: str = ""
    buyer_trn: str = ""
    total_amount: float = Field(default=0, ge=0)
    subtotal_amount: Optional[float] = None
    vat_amount: Optional[float] = None
    vat_rate: Optional[float] = 5.0
    currency: str = "AED"
    vat_treatment: str = "standard"


@router.post("/einvoicing/validate-pint-ae")
def validate_pint_ae_invoice(body: PintAeValidateRequest):
    """15+ rule Peppol PINT AE compliance check — unified validator."""
    from app.services.einvoicing_service_unified import validate_pint_ae

    net = float(body.subtotal_amount if body.subtotal_amount is not None else body.total_amount or 0)
    vat = float(body.vat_amount or 0)
    return validate_pint_ae({
        "invoice_number": body.invoice_number,
        "invoice_date": body.invoice_date,
        "vendor_name": body.vendor_name,
        "seller_trn": body.vendor_trn,
        "buyer_trn": body.buyer_trn,
        "net_amount": net,
        "vat_amount": vat,
        "gross_amount": float(body.total_amount or 0),
        "vat_rate": float(body.vat_rate or 5),
        "vat_treatment": body.vat_treatment,
        "currency": body.currency,
        "is_b2b": True,
    })


@router.post("/vat/extract-pdf-invoices")
async def extract_pdf_invoices(
    files: List[UploadFile] = File(...),
):
    """Extract and classify up to 50 PDF/image invoices."""
    from app.modules.gulftax.pdf_invoice_extractor import process_invoice_file

    if len(files) > 50:
        raise HTTPException(400, "Maximum 50 files per batch")
    results = []
    for f in files:
        data = await f.read()
        results.append(process_invoice_file(f.filename or "invoice", data))
    summary = {
        "extracted": sum(1 for r in results if r.get("status") == "extracted"),
        "review": sum(1 for r in results if r.get("status") == "review"),
        "failed": sum(1 for r in results if r.get("status") == "failed"),
    }
    return {"results": results, "summary": summary}


class SavePdfTransactionsRequest(BaseModel):
    items: List[Dict[str, Any]]


@router.post("/vat/save-pdf-transactions")
def save_pdf_transactions(
    body: SavePdfTransactionsRequest,
    company_id: str = Depends(get_current_company_id),
    db: Session = Depends(get_ported_db),
):
    """Save extracted PDF rows to VAT Classifier transaction table."""
    from app.modules.gulftax.pdf_invoice_extractor import save_to_vat_classifier

    return save_to_vat_classifier(company_id, body.items, db)


# ── UAE E-Invoicing — Peppol PINT AE (legacy paths; see gulftax_einvoicing.py) ─

class PeppolPhaseRequest(BaseModel):
    trn: str = Field(..., min_length=15, max_length=15)
    annual_revenue_aed: float = Field(..., ge=0)


class PeppolXmlValidateRequest(BaseModel):
    xml_content: str
    trn: str = ""


@router.post("/peppol/phase")
def peppol_phase_calculator(body: PeppolPhaseRequest):
    """
    Legacy alias — delegates to einvoicing_constants.calculate_phase (FTA timeline).
    Prefer POST /api/gulftax/einvoicing/calculate-phase for new integrations.
    """
    from app.services import einvoicing_service_unified as einv_svc

    result = einv_svc.calculate_phase(body.annual_revenue_aed)
    phase_num = result["phase_num"]
    mandatory = result["mandatory_date"]
    asp_deadline = result["asp_registration_deadline"]
    return {
        "trn": body.trn,
        "annual_revenue_aed": result["annual_revenue_aed"],
        "phase": phase_num,
        "phase_key": result["phase"],
        "mandatory_from": mandatory,
        "mandatory_date": mandatory,
        "asp_registration_deadline": asp_deadline,
        "voluntary_pilot_start": result["voluntary_pilot_start"],
        "standard": "Peppol PINT AE",
        "message": (
            f"TRN {body.trn} — Phase {phase_num} mandatory e-invoicing from {mandatory}; "
            f"ASP appointment by {asp_deadline}"
        ),
    }


@router.post("/peppol/trn-audit")
def peppol_trn_audit(body: PeppolPhaseRequest):
    """TRN format audit for Peppol PINT AE onboarding."""
    trn = body.trn.strip().replace(" ", "")
    valid = trn.isdigit() and len(trn) == 15
    return {
        "trn": trn,
        "valid": valid,
        "checks": {
            "length_15": len(trn) == 15,
            "numeric_only": trn.isdigit() if trn else False,
            "mod97": valid,  # full Mod-97 check can be added later
        },
        "peppol_ready": valid,
    }


@router.post("/peppol/validate-xml")
def peppol_validate_xml(body: PeppolXmlValidateRequest):
    """Basic UBL 2.1 / Peppol PINT AE XML structure validator (scaffold)."""
    xml = (body.xml_content or "").strip()
    if not xml:
        raise HTTPException(400, "xml_content is required")
    required_tags = ["Invoice", "cbc:ID", "cac:AccountingSupplierParty", "cac:TaxTotal"]
    missing = [t for t in required_tags if t not in xml]
    return {
        "valid": len(missing) == 0,
        "missing_tags": missing,
        "standard": "Peppol PINT AE / UBL 2.1",
        "trn": body.trn or None,
        "message": "Valid Peppol structure" if not missing else f"Missing: {', '.join(missing)}",
    }


# ── FTA Audit Risk Checklist ───────────────────────────────────────────────────

@router.get("/fta/audit-checklist")
def fta_audit_checklist(
    period_start: date = Query(...),
    period_end: date = Query(...),
    company_id: str = Depends(get_current_company_id),
    db: Session = Depends(get_ported_db),
):
    """
    FTA pre-audit risk checklist — validates TRN, VAT data completeness,
    classification quality, and return reconciliation for the selected period.
    """
    from app.modules.gulftax.ported_mount import _alias_ported_orm_modules
    from app.services.fta_audit_checklist_service import build_fta_audit_checklist

    _alias_ported_orm_modules()
    return build_fta_audit_checklist(db, company_id, period_start, period_end)


# ── ESR (also mounted via esr_filing; kept here so production gulftax router always exposes them) ─

@router.get("/esr/status")
def gulftax_esr_status():
    from app.modules.gulftax.esr_filing import esr_status

    return esr_status()


@router.post("/esr/calculate")
def gulftax_esr_calculate(body: dict[str, Any]):
    from app.modules.gulftax.esr_filing import ESRCalculateRequest, esr_calculate
    from fastapi import HTTPException

    try:
        req = ESRCalculateRequest(**body)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return esr_calculate(req)

# ── Designated Zones log (alias of VAT Advanced save) ─────────────────────────

@router.post("/designated-zones/log", status_code=201)
def gulftax_designated_zones_log(
    body: dict[str, Any],
    tenant_id: str = Depends(get_tenant_id),
    company_id: str = Depends(get_company_id),
    db: Session = Depends(get_db),
):
    from app.api.routes.vat_advanced_rds import DesignatedZoneIn, save_dz

    return save_dz(DesignatedZoneIn(**body), tenant_id=tenant_id, company_id=company_id, db=db)
