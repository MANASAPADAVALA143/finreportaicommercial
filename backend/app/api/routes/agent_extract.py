"""AP invoice OCR — POST /api/agent/extract-image"""

from __future__ import annotations

import base64
import os
from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.services.json_llm_extract import parse_llm_json_dict

router = APIRouter(prefix="/api/agent", tags=["agent"])

_EXTRACT_PROMPT = """Extract invoice fields from this document image. Return ONLY valid JSON:
{
  "invoice_number": "string",
  "vendor_name": "string",
  "customer_name": "string or empty",
  "invoice_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD or empty",
  "total_amount": number,
  "tax_amount": number or null,
  "currency": "AED or other ISO code",
  "line_items": [{"description": "string", "quantity": 1, "unit_price": 0, "total": 0}],
  "ifrs_category": "Operating expense category guess",
  "ifrs_confidence": 0.0 to 1.0
}
Use AED for UAE invoices. If a field is unreadable, use reasonable defaults. No markdown."""

_EXTRACT_PROMPT_INDIA = """Extract invoice fields from this Indian GST tax invoice image. Return ONLY valid JSON:
{
  "invoice_number": "string",
  "vendor_name": "string",
  "vendor_gstin": "15-char GSTIN or empty",
  "customer_name": "string or empty",
  "customer_gstin": "buyer's 15-char GSTIN or empty",
  "invoice_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD or empty",
  "taxable_amount": number,
  "cgst_amount": number or null,
  "sgst_amount": number or null,
  "igst_amount": number or null,
  "tax_amount": number or null,
  "total_amount": number,
  "currency": "INR",
  "hsn_sac": "HSN or SAC code, string, or empty",
  "payment_terms": "string or empty",
  "line_items": [{"description": "string", "quantity": 1, "unit_price": 0, "total": 0}],
  "ifrs_category": "Expense category guess",
  "ifrs_confidence": 0.0 to 1.0
}
Read the GST breakup table on the invoice carefully — CGST and SGST appear together for intra-state
supply, IGST alone for inter-state supply. If only a single combined GST/tax figure is printed, put it
in "tax_amount" and leave cgst_amount/sgst_amount/igst_amount null rather than guessing the split.
"taxable_amount" is the amount before GST. If a field is unreadable, use reasonable defaults. No markdown."""


def _demo_extraction(filename: str, market: str = "uae") -> dict[str, Any]:
    today = date.today()
    due = today + timedelta(days=30)
    if market == "india":
        return {
            "invoice_number": f"INV-{today.strftime('%Y%m%d')}-001",
            "vendor_name": "Sharma Trading Co.",
            "vendor_gstin": "27AABCS1234M1Z5",
            "customer_name": "",
            "customer_gstin": "",
            "invoice_date": today.isoformat(),
            "due_date": due.isoformat(),
            "taxable_amount": 5000.0,
            "cgst_amount": 450.0,
            "sgst_amount": 450.0,
            "igst_amount": 0.0,
            "tax_amount": 900.0,
            "total_amount": 5900.0,
            "currency": "INR",
            "hsn_sac": "9983",
            "payment_terms": "Net 30",
            "line_items": [
                {"description": "Office supplies & consumables", "quantity": 1, "unit_price": 5000.0, "total": 5000.0},
            ],
            "ifrs_category": "Operating Expenses — Office & Admin",
            "ifrs_confidence": 0.72,
            "_demo_mode": True,
            "_note": f"Demo extraction (ANTHROPIC_API_KEY not set). File: {filename}",
        }
    return {
        "invoice_number": f"INV-{today.strftime('%Y%m%d')}-001",
        "vendor_name": "Gulf Trading Supplies LLC",
        "customer_name": "",
        "invoice_date": today.isoformat(),
        "due_date": due.isoformat(),
        "total_amount": 5250.0,
        "tax_amount": 250.0,
        "currency": "AED",
        "line_items": [
            {"description": "Office supplies & consumables", "quantity": 1, "unit_price": 5000.0, "total": 5000.0},
        ],
        "ifrs_category": "Operating Expenses — Office & Admin",
        "ifrs_confidence": 0.72,
        "_demo_mode": True,
        "_note": f"Demo extraction (ANTHROPIC_API_KEY not set). File: {filename}",
    }


def _media_type(filename: str, content_type: str | None) -> str:
    if content_type and content_type.startswith("image/"):
        return content_type.split(";")[0]
    lower = (filename or "").lower()
    if lower.endswith(".png"):
        return "image/png"
    if lower.endswith(".webp"):
        return "image/webp"
    if lower.endswith(".gif"):
        return "image/gif"
    return "image/jpeg"


async def _extract_with_claude(data: bytes, media_type: str, prompt: str) -> dict[str, Any]:
    import anthropic

    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not key:
        raise RuntimeError("no_api_key")

    b64 = base64.standard_b64encode(data).decode("ascii")
    client = anthropic.Anthropic(api_key=key)

    # PDFs are sent as document blocks; images as image blocks.
    if media_type == "application/pdf":
        content_block: dict = {
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": b64},
        }
    else:
        content_block = {
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": b64},
        }

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1200,
        messages=[
            {
                "role": "user",
                "content": [content_block, {"type": "text", "text": prompt}],
            }
        ],
    )
    raw = response.content[0].text
    parsed = parse_llm_json_dict(raw)
    if not parsed:
        raise ValueError("Could not parse extraction JSON from model")
    return parsed


@router.post("/extract-image")
async def extract_image(
    file: UploadFile = File(...),
    market: str = Form("uae", description="uae (VAT prompt, default) or india (GST prompt)"),
) -> dict[str, Any]:
    market = (market or "uae").strip().lower()
    if market not in ("uae", "india"):
        market = "uae"
    prompt = _EXTRACT_PROMPT_INDIA if market == "india" else _EXTRACT_PROMPT

    if not file.filename and not file.content_type:
        raise HTTPException(status_code=400, detail="No file uploaded")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    filename = file.filename or "upload.jpg"
    content_type = file.content_type or ""

    if content_type == "application/pdf" or filename.lower().endswith(".pdf"):
        # Pass PDF bytes directly to Claude — no poppler/pdf2image required.
        media_type = "application/pdf"
    else:
        media_type = _media_type(filename, content_type)

    try:
        invoice = await _extract_with_claude(data, media_type, prompt)
        confidence = float(invoice.pop("ifrs_confidence", 0.85) or 0.85)
    except RuntimeError:
        invoice = _demo_extraction(filename, market)
        confidence = float(invoice.get("ifrs_confidence", 0.72) or 0.72)
    except Exception as exc:
        invoice = _demo_extraction(filename, market)
        invoice["_fallback_reason"] = str(exc)[:200]
        confidence = 0.5

    return {
        "invoice": invoice,
        "result": invoice,
        "confidence": confidence,
        "ok": True,
    }
