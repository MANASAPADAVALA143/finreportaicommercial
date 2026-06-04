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
from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from app.modules.gulftax.classifier import classify_batch, classify_transaction

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
        return {
            "job_id": job_id,
            "classified": len(classifications),
            "needs_review": needs_review,
            "classifications": [
                {**item, **clf} for item, clf in zip(items, classifications)
            ],
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
