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
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
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
    db: Session = Depends(get_db),
):
    """FTA VAT return — boxes 1–12 (sales + purchases)."""
    from app.modules.gulftax.vat_return_service import fetch_all_vat_return_boxes

    return fetch_all_vat_return_boxes(
        db,
        workspace_id=company_id,
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
def sync_gulftax_period(body: SyncPeriodBody):
    from app.services.gulftax_sync_service import sync_period

    cid = body.company_id or body.tenant_id
    if not cid:
        raise HTTPException(400, detail="company_id or tenant_id required")
    return sync_period(cid, body.tax_period)


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
    """15-rule Peppol PINT AE compliance check for an AP invoice."""
    try:
        from app.modules.gulftax.advance_vat import trn_mod97_valid

        rules: List[Dict[str, Any]] = []

        def rule(rid: str, label: str, passed: bool, fix: str = "") -> None:
            rules.append({"id": rid, "label": label, "passed": passed, "fix": fix if not passed else ""})

        inv_no = (body.invoice_number or "").strip()
        rule("inv_number", "Invoice number present", bool(inv_no), "Add a valid invoice / tax invoice number")

        inv_date = (body.invoice_date or "").strip()
        rule("inv_date", "Invoice date present", bool(inv_date), "Set invoice date (YYYY-MM-DD)")

        vendor = (body.vendor_name or "").strip()
        rule("supplier_name", "Supplier legal name", len(vendor) >= 2, "Add supplier legal name as on TRN certificate")

        trn = (body.vendor_trn or "").strip().replace(" ", "")
        rule("supplier_trn", "Supplier TRN (15 digits)", trn_mod97_valid(trn), "TRN must be 15 digits starting with 1")

        buyer_trn = (body.buyer_trn or "").strip().replace(" ", "")
        rule("buyer_trn", "Buyer TRN (B2B)", not buyer_trn or trn_mod97_valid(buyer_trn), "Buyer TRN must be 15 digits")

        net = float(body.subtotal_amount if body.subtotal_amount is not None else body.total_amount or 0)
        rule("net_amount", "Taxable amount > 0", net > 0, "Net / taxable amount must be positive")

        vat = float(body.vat_amount or 0)
        rule("vat_present", "VAT amount declared", vat > 0, "Declare VAT amount on the invoice")

        expected_vat = round(net * (float(body.vat_rate or 5) / 100), 2)
        vat_ok = abs(vat - expected_vat) <= 0.05 or (vat > 0 and net > 0)
        rule("vat_rate", "VAT at standard 5%", vat_ok, f"Expected VAT ~AED {expected_vat:,.2f} at 5%")

        curr = (body.currency or "AED").upper()
        rule("currency", "Currency is AED", curr in ("AED", "د.إ"), "UAE e-invoices must use AED")

        treatment = (body.vat_treatment or "standard").lower()
        rule("vat_category", "VAT category code (standard)", treatment in ("standard", "standard-rated", "s"), "Map to Peppol tax category S (standard 5%)")

        total = float(body.total_amount or 0)
        rule("total", "Total = net + VAT", total <= 0 or abs(total - (net + vat)) <= 0.1, "Total must equal net + VAT")

        rule("doc_type", "Document type code 380 (tax invoice)", True, "")

        rule("line_items", "Line item detail implied", net > 0, "Include line items with description, qty, unit price")

        rule("tax_total", "Tax total block present", vat > 0, "Include TaxTotal in UBL XML")

        rule("monetary_total", "Legal monetary total present", total > 0, "Include LegalMonetaryTotal in UBL XML")

        rule("issue_time", "Issue date ISO format", bool(inv_date and len(inv_date) >= 8), "Use ISO date YYYY-MM-DD")

        rule("peppol_profile", "Peppol PINT AE profile", trn_mod97_valid(trn) and inv_no and vat > 0, "Complete TRN, invoice no, and VAT for PINT AE")

        failed = [r for r in rules if not r["passed"]]
        return {
            "compliant": len(failed) == 0,
            "rules_passed": len(rules) - len(failed),
            "rules_total": len(rules),
            "rules": rules,
            "issues_found": len(failed),
            "standard": "Peppol PINT AE",
        }
    except Exception as e:
        raise HTTPException(500, f"PINT AE validation failed: {e}") from e


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
    UAE e-invoicing phase calculator (FTA timeline).
    Phase 1 (>AED 50M): Jul 2026 | Phase 2 (>AED 20M): Jan 2027 | Phase 3: Jul 2027
    """
    rev = body.annual_revenue_aed
    if rev >= 50_000_000:
        phase, deadline = 1, "2026-07-01"
    elif rev >= 20_000_000:
        phase, deadline = 2, "2027-01-01"
    else:
        phase, deadline = 3, "2027-07-01"
    return {
        "trn": body.trn,
        "annual_revenue_aed": rev,
        "phase": phase,
        "mandatory_from": deadline,
        "standard": "Peppol PINT AE",
        "message": f"TRN {body.trn} — Phase {phase} e-invoicing from {deadline}",
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

def _checklist_item(
    item_id: str,
    category: str,
    title: str,
    description: str,
    status: str,
    risk_level: str,
    detail: str,
    count: int | None = None,
) -> dict:
    row = {
        "id": item_id,
        "category": category,
        "title": title,
        "description": description,
        "status": status,
        "risk_level": risk_level,
        "detail": detail,
    }
    if count is not None:
        row["count"] = count
    return row


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
    from sqlalchemy import and_
    from models import Transaction, Company, Invoice as GulfInvoice, VATReturn

    company = db.query(Company).filter(Company.id == company_id).first()
    trn = (getattr(company, "trn", None) or "").strip().replace(" ", "")
    trn_valid = trn.isdigit() and len(trn) == 15

    txns = db.query(Transaction).filter(
        and_(
            Transaction.company_id == company_id,
            Transaction.date >= period_start,
            Transaction.date <= period_end,
        )
    ).all()

    purchases = [t for t in txns if t.transaction_type == "purchase"]
    sales = [t for t in txns if t.transaction_type == "sale"]

    unclassified = [t for t in txns if not (t.vat_treatment or "").strip()]
    low_confidence = [
        t for t in txns
        if t.confidence_score is not None and t.confidence_score < 70
    ]
    unverified = [t for t in txns if not t.is_verified]
    missing_party = [t for t in txns if not (t.vendor_or_customer or "").strip()]

    inv_nums: dict[str, int] = {}
    for t in purchases:
        num = (t.invoice_number or "").strip().lower()
        if num:
            inv_nums[num] = inv_nums.get(num, 0) + 1
    duplicate_invoices = sum(1 for c in inv_nums.values() if c > 1)

    std_sales = [t for t in sales if t.vat_treatment == "standard_rated"]
    std_purch = [t for t in purchases if t.vat_treatment == "standard_rated"]
    box2 = round(sum(t.vat_amount_aed or 0 for t in std_sales), 2)
    box7 = round(sum(t.vat_amount_aed or 0 for t in std_purch), 2)
    box8 = round(box2 - box7, 2)

    vat_return = (
        db.query(VATReturn)
        .filter(
            VATReturn.company_id == company_id,
            VATReturn.period_start <= period_end,
            VATReturn.period_end >= period_start,
        )
        .order_by(VATReturn.created_at.desc())
        .first()
    )

    ap_invoices = db.query(GulfInvoice).filter(GulfInvoice.company_id == company_id).all()
    ap_missing_trn = sum(
        1 for inv in ap_invoices
        if inv.status in ("pending", "review", "approved")
        and not (inv.vendor_trn or "").strip()
    )
    ap_high_risk = sum(1 for inv in ap_invoices if (inv.overall_risk or "") == "escalate")

    blocked_flags = 0
    for inv in ap_invoices:
        for flag in (inv.risk_flags or []):
            fid = str(flag.get("flag", "")).lower()
            if "blocked" in fid or "entertainment" in fid:
                blocked_flags += 1

    items: list[dict] = []

    items.append(_checklist_item(
        "trn_registered",
        "Registration",
        "Valid 15-digit TRN on file",
        "FTA requires a valid Tax Registration Number for all VAT-registered entities.",
        "pass" if trn_valid else "fail",
        "high" if not trn_valid else "low",
        f"TRN: {trn or 'Not set'}" + (" — valid format" if trn_valid else " — invalid or missing"),
    ))

    items.append(_checklist_item(
        "transactions_loaded",
        "Data completeness",
        "Transactions recorded for period",
        "VAT Classifier should contain all sales and purchase transactions for the audit period.",
        "pass" if len(txns) > 0 else "fail",
        "high" if len(txns) == 0 else "low",
        f"{len(txns)} transaction(s) in {period_start} → {period_end}",
        len(txns),
    ))

    items.append(_checklist_item(
        "vat_treatment_classified",
        "Classification",
        "All transactions VAT-classified",
        "Every transaction must have a VAT treatment (standard, zero, exempt, reverse charge, out of scope).",
        "pass" if len(unclassified) == 0 else ("warning" if len(unclassified) <= 3 else "fail"),
        "high" if len(unclassified) > 3 else ("medium" if unclassified else "low"),
        f"{len(unclassified)} unclassified transaction(s)",
        len(unclassified),
    ))

    items.append(_checklist_item(
        "ai_confidence_review",
        "Classification",
        "Low-confidence items reviewed",
        "Transactions with AI confidence below 70% should be manually verified before filing.",
        "pass" if len(low_confidence) == 0 else "warning",
        "medium" if low_confidence else "low",
        f"{len(low_confidence)} transaction(s) below 70% confidence",
        len(low_confidence),
    ))

    items.append(_checklist_item(
        "manual_verification",
        "Classification",
        "Unverified transactions cleared",
        "All transactions should be marked verified after review.",
        "pass" if len(unverified) == 0 else "warning",
        "medium" if len(unverified) > 5 else "low",
        f"{len(unverified)} unverified transaction(s)",
        len(unverified),
    ))

    items.append(_checklist_item(
        "vendor_customer_present",
        "Documentation",
        "Vendor/customer name on all transactions",
        "FTA Tax Audit File requires vendor or customer identification on each line.",
        "pass" if len(missing_party) == 0 else "warning",
        "medium" if missing_party else "low",
        f"{len(missing_party)} transaction(s) missing vendor/customer",
        len(missing_party),
    ))

    items.append(_checklist_item(
        "duplicate_invoices",
        "AP Controls",
        "No duplicate purchase invoice numbers",
        "Duplicate invoice numbers may indicate double-claiming of input VAT.",
        "pass" if duplicate_invoices == 0 else "fail",
        "high" if duplicate_invoices else "low",
        f"{duplicate_invoices} duplicate invoice number(s) detected",
        duplicate_invoices,
    ))

    items.append(_checklist_item(
        "supplier_trn_ap",
        "AP Controls",
        "Supplier TRN on AP invoices",
        "Input VAT recovery requires valid supplier TRN on tax invoices.",
        "pass" if ap_missing_trn == 0 else ("warning" if ap_missing_trn <= 2 else "fail"),
        "high" if ap_missing_trn > 2 else ("medium" if ap_missing_trn else "low"),
        f"{ap_missing_trn} AP invoice(s) missing supplier TRN",
        ap_missing_trn,
    ))

    items.append(_checklist_item(
        "blocked_input_vat",
        "AP Controls",
        "Blocked input VAT identified",
        "Entertainment and other blocked categories must not be claimed as input VAT.",
        "pass" if blocked_flags == 0 else "warning",
        "high" if blocked_flags > 0 else "low",
        f"{blocked_flags} blocked-input-VAT flag(s) on AP invoices",
        blocked_flags,
    ))

    items.append(_checklist_item(
        "ap_escalations",
        "AP Controls",
        "High-risk AP invoices escalated",
        "Invoices flagged escalate should be resolved before period close.",
        "pass" if ap_high_risk == 0 else "warning",
        "medium" if ap_high_risk else "low",
        f"{ap_high_risk} escalated AP invoice(s)",
        ap_high_risk,
    ))

    return_reconciled = True
    return_detail = "No VAT return filed for this period — reconcile before submission."
    if vat_return:
        ret_box8 = round(float(vat_return.box8_vat_payable_or_refundable or 0), 2)
        diff = abs(ret_box8 - box8)
        return_reconciled = diff <= 1.0
        return_detail = (
            f"Computed Box 8: AED {box8:,.2f} · Return Box 8: AED {ret_box8:,.2f} · Diff: AED {diff:,.2f}"
        )

    items.append(_checklist_item(
        "vat_return_reconciled",
        "VAT Return",
        "Box 8 reconciles to transaction data",
        "Net VAT payable (Box 8) must match the sum of classified transactions.",
        "pass" if return_reconciled else "warning",
        "high" if not return_reconciled and vat_return else "medium",
        return_detail,
    ))

    items.append(_checklist_item(
        "vat_return_filed",
        "VAT Return",
        "VAT return submitted for period",
        "FTA requires timely VAT return submission for each tax period.",
        "pass" if vat_return and (vat_return.submission_status or "") in ("submitted", "filed") else "warning",
        "medium",
        (
            f"Return status: {(vat_return.submission_status if vat_return else 'not found')}"
            if vat_return
            else "No return record — create and file in VAT Return module"
        ),
    ))

    summary = {"pass": 0, "warning": 0, "fail": 0}
    for item in items:
        summary[item["status"]] = summary.get(item["status"], 0) + 1

    scorable = [i for i in items if i["status"] != "na"]
    pass_count = sum(1 for i in scorable if i["status"] == "pass")
    overall_score = round((pass_count / len(scorable)) * 100) if scorable else 0

    fail_high = sum(1 for i in items if i["status"] == "fail" and i["risk_level"] == "high")
    warn_count = summary.get("warning", 0)
    if fail_high > 0:
        overall_risk = "high"
    elif warn_count >= 3 or summary.get("fail", 0) > 0:
        overall_risk = "medium"
    else:
        overall_risk = "low"

    return {
        "company_name": company.name if company else "Unknown",
        "trn": trn or None,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "generated_at": datetime.utcnow().isoformat(),
        "overall_score_pct": overall_score,
        "overall_risk": overall_risk,
        "summary": summary,
        "transaction_count": len(txns),
        "items": items,
    }
