"""
CA Firm — Bank Statement Parser + ML Classifier API

Endpoints
---------
POST /api/bank/parse                       → parse PDF / Excel / CSV, return JSON rows
POST /api/bank/client-coa/upload           → store client Tally ledger list
GET  /api/bank/client-coa/{client_id}      → return ledger list

POST /api/bank/train                       → train ML model for org/account
POST /api/bank/classify                    → classify transactions (3-tier)
POST /api/bank/confirm                     → update approval status for txn subset
POST /api/bank/export-review               → export review-queue CSV
POST /api/bank/sync-corrections            → import corrected CSV, re-train
POST /api/bank/post-tally                  → generate Tally XML for approved txns
GET  /api/bank/model-status/{org_id}/{account_id}  → model health
"""
from __future__ import annotations

import io
import logging
from typing import Any, List, Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db.models import ClientCOA
from app.services.bank_statement_parser import (
    parse_excel_csv_statement,
    parse_pdf_bank_statement,
    parse_scanned_pdf_statement,
)
from app.services.bank_classifier_ml import (
    classify_transactions,
    extract_narration,
    model_status,
    sync_corrections,
    train_model,
)
from app.services.tally_poster import generate_summary, generate_tally_xml

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/bank", tags=["Bank Statement"])


# ═══════════════════════════════════════════════════════════════════════════════
# Pydantic models
# ═══════════════════════════════════════════════════════════════════════════════

class TransactionIn(BaseModel):
    description: str
    ledger_name: Optional[str] = None
    date: Optional[str] = None
    debit: Optional[float] = 0.0
    credit: Optional[float] = 0.0
    balance: Optional[float] = 0.0
    bank: Optional[str] = ""
    source: Optional[str] = ""
    approval_status: Optional[str] = "pending"


class TrainRequest(BaseModel):
    org_id: str
    account_id: str
    transactions: List[TransactionIn]


class ClassifyRequest(BaseModel):
    org_id: str
    account_id: str
    transactions: List[TransactionIn]


class ConfirmItem(BaseModel):
    index: int                    # 0-based index in original list
    ledger_name: str
    approval_status: str          # confirmed | auto_approved | manual


class ConfirmRequest(BaseModel):
    transactions: List[dict]      # full classified list
    confirmations: List[ConfirmItem]


class SyncRequest(BaseModel):
    org_id: str
    account_id: str
    corrections: List[TransactionIn]   # description + corrected ledger_name


class TallyPostRequest(BaseModel):
    transactions: List[dict]
    bank_ledger: str = "Bank Account"
    company_name: Optional[str] = ""


# ═══════════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════════

def _df_to_rows(df: pd.DataFrame) -> list[dict]:
    """Safely serialise DataFrame → list[dict] with JSON-safe types."""
    rows = []
    for _, r in df.iterrows():
        date_val = r.get("date")
        if hasattr(date_val, "isoformat"):
            date_str = date_val.strftime("%d-%b-%Y")
        else:
            date_str = str(date_val or "")
        rows.append({
            "date":        date_str,
            "description": str(r.get("description", "")),
            "debit":       float(r.get("debit", 0) or 0),
            "credit":      float(r.get("credit", 0) or 0),
            "balance":     float(r.get("balance", 0) or 0),
            "bank":        str(r.get("bank", "")),
            "source":      str(r.get("source", "")),
            "approval_status": "pending",
            "ledger_name": "",
        })
    return rows


def _export_review_csv(transactions: list[dict]) -> bytes:
    """Build a review CSV from transactions in the 'review' or 'manual' tier."""
    rows = []
    for i, t in enumerate(transactions):
        if t.get("tier") in ("review", "manual") or t.get("approval_status") in ("pending", "manual"):
            # Always resolve description — fall back to extract_narration if empty
            desc = t.get("description") or extract_narration(t, t.get("bank", ""))
            rows.append({
                "row_index":          i,
                "date":               t.get("date", ""),
                "description":        desc,
                "debit":              t.get("debit", 0),
                "credit":             t.get("credit", 0),
                "balance":            t.get("balance", 0),
                "predicted_ledger":   t.get("predicted_ledger", ""),
                "confidence":         t.get("confidence", ""),
                "tier":               t.get("tier", ""),
                "corrected_ledger":   t.get("ledger_name", ""),   # user fills this
                "notes":              "",
            })
    df = pd.DataFrame(rows)
    buf = io.BytesIO()
    df.to_csv(buf, index=False)
    return buf.getvalue()


# ═══════════════════════════════════════════════════════════════════════════════
# Existing endpoints
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/parse")
async def parse_bank_statement(
    file:      UploadFile = File(..., description="PDF, Excel (.xlsx/.xls) or CSV"),
    bank_type: str        = Form(default="AUTO",  description="HDFC|ICICI|SBI|AXIS|KOTAK|AUTO"),
    mode:      str        = Form(default="auto",  description="digital|scanned|auto"),
):
    """Parse a bank statement file and return structured transaction rows."""
    fname   = (file.filename or "").lower()
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        if fname.endswith(".pdf"):
            if mode == "scanned":
                df = parse_scanned_pdf_statement(content)
            elif mode == "digital":
                df = parse_pdf_bank_statement(content, bank=bank_type.upper())
            else:
                df = parse_pdf_bank_statement(content, bank=bank_type.upper())
                if df.empty:
                    logger.info("Digital PDF extraction returned 0 rows; trying OCR fallback")
                    try:
                        df = parse_scanned_pdf_statement(content)
                    except RuntimeError:
                        pass
        elif fname.endswith((".csv", ".xlsx", ".xls")):
            df = parse_excel_csv_statement(content, file.filename or "file.csv")
        else:
            raise HTTPException(
                status_code=415,
                detail="Unsupported file type. Upload a PDF, .xlsx, .xls, or .csv.",
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Bank statement parse error: %s", exc)
        raise HTTPException(status_code=500, detail=f"Parse error: {exc}") from exc

    if df.empty:
        return JSONResponse({
            "rows": [], "count": 0, "bank": bank_type,
            "message": "No transaction rows extracted. Check file format.",
        })

    rows = _df_to_rows(df)
    detected_bank = rows[0].get("bank", bank_type) if rows else bank_type
    return JSONResponse({
        "rows":    rows,
        "count":   len(rows),
        "bank":    detected_bank,
        "message": f"Parsed {len(rows)} transactions.",
    })


@router.post("/client-coa/upload")
async def upload_client_coa(
    client_id: str                  = Form(...),
    file:      Optional[UploadFile] = File(default=None),
    ledgers:   Optional[str]        = Form(default=None),
    db: Session = Depends(get_db),
):
    """Store a client's Tally Chart of Accounts."""
    entries: list[dict] = []

    if file and file.filename:
        content = await file.read()
        fname   = (file.filename or "").lower()
        try:
            if fname.endswith(".csv"):
                df = pd.read_csv(io.BytesIO(content))
            else:
                df = pd.read_excel(io.BytesIO(content), engine="openpyxl")
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Could not parse COA file: {exc}") from exc

        df.columns = [c.lower().strip() for c in df.columns]
        name_col  = next((c for c in df.columns if "ledger" in c and "group" not in c), None)
        group_col = next((c for c in df.columns if "group" in c), None)
        if not name_col:
            raise HTTPException(status_code=422, detail="COA file must have a 'ledger_name' column.")

        for _, row in df.iterrows():
            name = str(row[name_col]).strip()
            if name and name.lower() not in ("nan", ""):
                entries.append({
                    "ledger_name":  name,
                    "ledger_group": str(row[group_col]).strip() if group_col else None,
                })
    elif ledgers:
        for name in ledgers.split(","):
            name = name.strip()
            if name:
                entries.append({"ledger_name": name, "ledger_group": None})
    else:
        raise HTTPException(status_code=400, detail="Provide either a file or comma-separated ledger names.")

    if not entries:
        raise HTTPException(status_code=422, detail="No valid ledger names found.")

    try:
        db.query(ClientCOA).filter(ClientCOA.client_id == client_id).delete(synchronize_session=False)
        for e in entries:
            db.add(ClientCOA(client_id=client_id, ledger_name=e["ledger_name"], ledger_group=e["ledger_group"]))
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("COA store error: %s", exc)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    return {"client_id": client_id, "ledgers_stored": len(entries), "ledgers": [e["ledger_name"] for e in entries]}


@router.get("/client-coa/{client_id}")
def get_client_coa(client_id: str, db: Session = Depends(get_db)):
    """Return stored ledger names for a client."""
    rows = db.query(ClientCOA).filter(ClientCOA.client_id == client_id).all()
    return {
        "client_id": client_id,
        "count":     len(rows),
        "ledgers":   [{"name": r.ledger_name, "group": r.ledger_group} for r in rows],
    }


# ═══════════════════════════════════════════════════════════════════════════════
# ML endpoints
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/train")
async def train_classifier(req: TrainRequest):
    """
    Train (or re-train) the ML classifier for an org + bank account.

    Provide historical transactions with confirmed ledger_name labels.
    Returns model accuracy and class list.
    """
    txns = [t.dict() for t in req.transactions]
    try:
        meta = train_model(req.org_id, req.account_id, txns)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Training failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Training failed: {exc}") from exc

    return {
        "status":      "trained",
        "org_id":      req.org_id,
        "account_id":  req.account_id,
        "n_samples":   meta["n_samples"],
        "classes":     meta["classes"],
        "accuracy":    meta.get("accuracy"),
        "trained_at":  meta.get("trained_at"),
    }


@router.post("/classify")
async def classify(req: ClassifyRequest):
    """
    Classify new bank transactions using the trained ML model.

    Returns each transaction enriched with:
    - predicted_ledger, confidence, tier (auto/review/manual), top_suggestions
    """
    txns = [t.dict() for t in req.transactions]
    try:
        results = classify_transactions(req.org_id, req.account_id, txns)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Classification failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Classification failed: {exc}") from exc

    summary = {
        "auto":   sum(1 for r in results if r["tier"] == "auto"),
        "review": sum(1 for r in results if r["tier"] == "review"),
        "manual": sum(1 for r in results if r["tier"] == "manual"),
        "total":  len(results),
    }
    # Auto-approve high-confidence predictions
    for r in results:
        if r["tier"] == "auto":
            r["approval_status"] = "auto_approved"

    return {"transactions": results, "summary": summary}


@router.post("/confirm")
async def confirm_transactions(req: ConfirmRequest):
    """
    Apply human confirmations / corrections to classified transactions.

    Returns updated transaction list with approval_status set.
    """
    txns: list[dict] = req.transactions
    for item in req.confirmations:
        idx = item.index
        if 0 <= idx < len(txns):
            txns[idx]["ledger_name"]     = item.ledger_name
            txns[idx]["approval_status"] = item.approval_status

    summary = generate_summary(txns)
    return {"transactions": txns, "summary": summary}


class ExportReviewRequest(BaseModel):
    transactions: List[dict]


@router.post("/export-review")
async def export_review(req: ExportReviewRequest):
    """Export review-queue transactions as CSV for offline correction."""
    csv_bytes = _export_review_csv(req.transactions)
    return Response(
        content=csv_bytes,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=bank_review_corrections.csv"},
    )


@router.post("/sync-corrections")
async def sync_corrections_endpoint(
    file:       UploadFile   = File(..., description="Corrected CSV from export-review"),
    org_id:     str          = Form(...),
    account_id: str          = Form(...),
):
    """
    Accept corrected CSV (from export-review), apply corrections, and re-train.

    The CSV must have columns: description, corrected_ledger (or ledger_name).
    Returns updated model stats.
    """
    content = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(content))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not parse CSV: {exc}") from exc

    df.columns = [c.lower().strip() for c in df.columns]
    ledger_col = next(
        (c for c in ("corrected_ledger", "ledger_name", "ledger") if c in df.columns),
        None,
    )
    if "description" not in df.columns or ledger_col is None:
        raise HTTPException(
            status_code=422,
            detail="CSV must have 'description' and 'corrected_ledger' (or 'ledger_name') columns.",
        )

    corrections = []
    for _, row in df.iterrows():
        desc   = str(row.get("description", "")).strip()
        ledger = str(row.get(ledger_col, "")).strip()
        if desc and ledger and ledger.lower() not in ("nan", ""):
            corrections.append({"description": desc, "ledger_name": ledger})

    if not corrections:
        raise HTTPException(status_code=422, detail="No valid corrections found in CSV.")

    try:
        meta = sync_corrections(org_id, account_id, corrections)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("sync_corrections failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Sync failed: {exc}") from exc

    return {
        "status":               "retrained",
        "corrections_applied":  meta.get("corrections_applied", len(corrections)),
        "n_samples":            meta.get("n_samples"),
        "accuracy":             meta.get("accuracy"),
        "classes":              meta.get("classes", []),
    }


@router.post("/post-tally")
async def post_tally(req: TallyPostRequest):
    """
    Generate Tally Prime XML for all approved transactions.

    Only auto_approved, confirmed, and excel_corrected rows are included.
    Returns XML as file download.
    """
    summary = generate_summary(req.transactions)
    if summary["eligible"] == 0:
        raise HTTPException(
            status_code=422,
            detail="No approved transactions to post. Confirm at least one transaction first.",
        )

    xml_str = generate_tally_xml(
        transactions=req.transactions,
        bank_ledger=req.bank_ledger,
        company_name=req.company_name or "",
    )
    return Response(
        content=xml_str.encode("utf-8"),
        media_type="application/xml",
        headers={"Content-Disposition": "attachment; filename=tally_bank_import.xml"},
    )


@router.get("/model-status/{org_id}/{account_id}")
def get_model_status(org_id: str, account_id: str):
    """Return health and metadata of the trained model for an org + account."""
    status = model_status(org_id, account_id)
    return status
