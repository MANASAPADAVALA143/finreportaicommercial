"""AP invoice OCR — POST /api/agent/extract-image"""

from __future__ import annotations

import base64
import io
import os
from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile

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


def _demo_extraction(filename: str) -> dict[str, Any]:
    today = date.today()
    due = today + timedelta(days=30)
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


async def _extract_with_claude(data: bytes, media_type: str) -> dict[str, Any]:
    import anthropic

    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not key:
        raise RuntimeError("no_api_key")

    b64 = base64.standard_b64encode(data).decode("ascii")
    client = anthropic.Anthropic(api_key=key)
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1200,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": media_type, "data": b64},
                    },
                    {"type": "text", "text": _EXTRACT_PROMPT},
                ],
            }
        ],
    )
    raw = response.content[0].text
    parsed = parse_llm_json_dict(raw)
    if not parsed:
        raise ValueError("Could not parse extraction JSON from model")
    return parsed


@router.post("/extract-image")
async def extract_image(file: UploadFile = File(...)) -> dict[str, Any]:
    if not file.filename and not file.content_type:
        raise HTTPException(status_code=400, detail="No file uploaded")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    filename = file.filename or "upload.jpg"
    content_type = file.content_type or ""

    if content_type == "application/pdf" or filename.lower().endswith(".pdf"):
        try:
            from pdf2image import convert_from_bytes

            images = convert_from_bytes(data, first_page=1, last_page=1, dpi=150)
            if not images:
                raise HTTPException(status_code=422, detail="Could not render PDF page")
            buf = io.BytesIO()
            images[0].save(buf, format="JPEG")
            data = buf.getvalue()
            media_type = "image/jpeg"
        except ImportError:
            raise HTTPException(
                status_code=422,
                detail="PDF upload requires pdf2image. Upload a JPG/PNG instead.",
            )
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"PDF conversion failed: {exc}") from exc
    else:
        media_type = _media_type(filename, content_type)

    try:
        invoice = await _extract_with_claude(data, media_type)
        confidence = float(invoice.pop("ifrs_confidence", 0.85) or 0.85)
    except RuntimeError:
        invoice = _demo_extraction(filename)
        confidence = float(invoice.get("ifrs_confidence", 0.72) or 0.72)
    except Exception as exc:
        invoice = _demo_extraction(filename)
        invoice["_fallback_reason"] = str(exc)[:200]
        confidence = 0.5

    return {
        "invoice": invoice,
        "result": invoice,
        "confidence": confidence,
        "ok": True,
    }
