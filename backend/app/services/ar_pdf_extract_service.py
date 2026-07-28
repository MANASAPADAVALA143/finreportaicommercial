"""AR sales document PDF/image extraction via Claude Vision."""

from __future__ import annotations

import base64
import logging
from typing import Any

from anthropic import Anthropic

from app.core.claude_model import DEFAULT_CLAUDE_MODEL
from app.services.json_llm_extract import parse_llm_json_dict
from app.services.llm_service import LLMNotConfiguredError, _key

logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}
ALLOWED_MIME = {
    "application/pdf",
    "image/jpeg",
    "image/jpg",
    "image/png",
}
MAX_FILE_BYTES = 10 * 1024 * 1024

AR_EXTRACT_SYSTEM = (
    "You are a UAE finance document extraction specialist. "
    "Extract structured data from this sales invoice, "
    "purchase order, or sales order document. "
    "Return ONLY valid JSON, no other text. "
    "If a field is not found, return null for that field. "
    "All amounts in AED unless currency symbol says otherwise."
)

AR_EXTRACT_USER = """Extract these fields as JSON:
{
  "document_type": "invoice|purchase_order|sales_order",
  "invoice_number": string | null,
  "invoice_date": "YYYY-MM-DD" | null,
  "due_date": "YYYY-MM-DD" | null,
  "customer_name": string | null,
  "customer_trn": string | null,
  "seller_name": string | null,
  "seller_trn": string | null,
  "line_items": [
    {
      "description": string,
      "quantity": number,
      "unit_price": number,
      "vat_rate": number,
      "line_total": number
    }
  ],
  "subtotal": number | null,
  "vat_amount": number | null,
  "total_amount": number | null,
  "currency": "AED" | string,
  "payment_terms": string | null,
  "notes": string | null
}
For UAE tax invoices, customer is the buyer and seller is the issuer.
vat_rate is typically 5 or 0."""


REQUIRED_CORE_FIELDS = (
    "customer_name",
    "invoice_number",
    "invoice_date",
    "total_amount",
)


def validate_ar_extract_file(filename: str | None, content_type: str | None, size: int) -> str:
    """Return normalized extension or raise ValueError with a clear message."""
    if size <= 0:
        raise ValueError("Uploaded file is empty")
    if size > MAX_FILE_BYTES:
        raise ValueError("File exceeds maximum size of 10MB")

    name = (filename or "").strip()
    lower = name.lower()
    ext = ""
    if "." in lower:
        ext = "." + lower.rsplit(".", 1)[-1]

    mime = (content_type or "").split(";")[0].strip().lower()
    if ext not in ALLOWED_EXTENSIONS and mime not in ALLOWED_MIME:
        raise ValueError("Invalid file type. Only PDF, JPG, and PNG are accepted (max 10MB).")

    if ext not in ALLOWED_EXTENSIONS:
        if mime == "application/pdf":
            ext = ".pdf"
        elif mime in {"image/png"}:
            ext = ".png"
        else:
            ext = ".jpg"
    return ext


def _media_block(data: bytes, ext: str, content_type: str | None) -> dict[str, Any]:
    b64 = base64.standard_b64encode(data).decode("ascii")
    if ext == ".pdf" or (content_type or "").startswith("application/pdf"):
        return {
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": b64},
        }
    mime = "image/png" if ext == ".png" else "image/jpeg"
    if content_type and content_type.startswith("image/"):
        mime = content_type.split(";")[0].strip()
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": mime, "data": b64},
    }


def _to_float(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _normalize_line_items(raw_items: Any) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    if not isinstance(raw_items, list):
        return items
    for li in raw_items:
        if not isinstance(li, dict):
            continue
        qty = _to_float(li.get("quantity"))
        unit = _to_float(li.get("unit_price"))
        vat_rate = _to_float(li.get("vat_rate"))
        line_total = _to_float(li.get("line_total"))
        if qty is None:
            qty = 1.0
        if unit is None:
            unit = 0.0
        if vat_rate is None:
            vat_rate = 5.0
        if line_total is None:
            line_total = round(qty * unit * (1 + vat_rate / 100), 2)
        items.append(
            {
                "description": str(li.get("description") or "Line item").strip() or "Line item",
                "quantity": qty,
                "unit_price": unit,
                "vat_rate": vat_rate,
                "line_total": line_total,
            }
        )
    return items


def _normalize_extracted(parsed: dict[str, Any]) -> dict[str, Any]:
    doc_type = str(parsed.get("document_type") or "invoice").strip().lower()
    if doc_type not in {"invoice", "purchase_order", "sales_order"}:
        doc_type = "invoice"
    currency = str(parsed.get("currency") or "AED").strip().upper() or "AED"
    return {
        "document_type": doc_type,
        "invoice_number": (str(parsed["invoice_number"]).strip() if parsed.get("invoice_number") else None),
        "invoice_date": (str(parsed["invoice_date"]).strip()[:10] if parsed.get("invoice_date") else None),
        "due_date": (str(parsed["due_date"]).strip()[:10] if parsed.get("due_date") else None),
        "customer_name": (str(parsed["customer_name"]).strip() if parsed.get("customer_name") else None),
        "customer_trn": (str(parsed["customer_trn"]).strip() if parsed.get("customer_trn") else None),
        "seller_name": (str(parsed["seller_name"]).strip() if parsed.get("seller_name") else None),
        "seller_trn": (str(parsed["seller_trn"]).strip() if parsed.get("seller_trn") else None),
        "line_items": _normalize_line_items(parsed.get("line_items")),
        "subtotal": _to_float(parsed.get("subtotal")),
        "vat_amount": _to_float(parsed.get("vat_amount")),
        "total_amount": _to_float(parsed.get("total_amount")),
        "currency": currency,
        "payment_terms": (str(parsed["payment_terms"]).strip() if parsed.get("payment_terms") else None),
        "notes": (str(parsed["notes"]).strip() if parsed.get("notes") else None),
    }


def detect_vat_treatment(extracted: dict[str, Any]) -> str:
    rates: list[float] = []
    for li in extracted.get("line_items") or []:
        r = _to_float(li.get("vat_rate"))
        if r is not None:
            rates.append(r)
    vat_amount = _to_float(extracted.get("vat_amount"))
    if rates:
        if any(r >= 4.5 for r in rates):
            return "standard_rated"
        if all(r == 0 for r in rates):
            if vat_amount and vat_amount > 0:
                return "standard_rated"
            return "zero_rated"
    if vat_amount is None or vat_amount == 0:
        # No line VAT and no amount → treat as exempt when totals exist without VAT line
        if extracted.get("total_amount") is not None and (
            extracted.get("subtotal") is None
            or abs(float(extracted["total_amount"]) - float(extracted.get("subtotal") or 0)) < 0.02
        ):
            return "exempt"
        return "zero_rated"
    return "standard_rated"


def _confidence_notes(extracted: dict[str, Any], status: str) -> str:
    notes: list[str] = []
    if not extracted.get("customer_trn"):
        notes.append("Customer TRN not found — please verify manually")
    if not extracted.get("seller_trn"):
        notes.append("Seller TRN not found — please verify manually")
    if not extracted.get("invoice_number"):
        notes.append("Invoice number missing")
    if not extracted.get("invoice_date"):
        notes.append("Invoice date missing")
    if not extracted.get("line_items"):
        notes.append("No line items extracted")
    if not extracted.get("total_amount") and not extracted.get("line_items"):
        notes.append("Totals could not be determined")
    if status == "failed":
        return "Extraction failed — please fill fields manually"
    if not notes:
        return "All key fields extracted"
    return "; ".join(notes)


def _extraction_status(extracted: dict[str, Any]) -> str:
    missing = [f for f in REQUIRED_CORE_FIELDS if not extracted.get(f)]
    has_lines = bool(extracted.get("line_items"))
    if not missing and has_lines:
        return "success"
    if extracted.get("customer_name") or extracted.get("invoice_number") or has_lines:
        return "partial"
    return "failed"


def extract_ar_document(
    *,
    file_bytes: bytes,
    filename: str | None,
    content_type: str | None,
) -> dict[str, Any]:
    """Run Claude Vision extraction and return the AR extract API payload."""
    ext = validate_ar_extract_file(filename, content_type, len(file_bytes))
    key = _key()
    if not key:
        raise LLMNotConfiguredError(
            "ANTHROPIC_API_KEY is not set. Add it to backend/.env and restart the API server."
        )

    media = _media_block(file_bytes, ext, content_type)
    client = Anthropic(api_key=key)
    response = client.messages.create(
        model=DEFAULT_CLAUDE_MODEL,
        max_tokens=2000,
        temperature=0,
        system=AR_EXTRACT_SYSTEM,
        messages=[
            {
                "role": "user",
                "content": [
                    media,
                    {"type": "text", "text": AR_EXTRACT_USER},
                ],
            }
        ],
    )
    raw_text = ""
    try:
        raw_text = response.content[0].text if response.content else ""
    except Exception:
        raw_text = str(getattr(response, "content", "") or "")

    parsed = parse_llm_json_dict(raw_text)
    if not parsed:
        return {
            "extraction_status": "failed",
            "extracted_data": {
                "document_type": "invoice",
                "invoice_number": None,
                "invoice_date": None,
                "due_date": None,
                "customer_name": None,
                "customer_trn": None,
                "seller_name": None,
                "seller_trn": None,
                "line_items": [],
                "subtotal": None,
                "vat_amount": None,
                "total_amount": None,
                "currency": "AED",
                "payment_terms": None,
                "notes": None,
            },
            "vat_treatment": "standard_rated",
            "confidence_notes": "Could not parse AI response as JSON — please fill manually",
            "raw_text": raw_text[:8000],
        }

    extracted = _normalize_extracted(parsed)
    status = _extraction_status(extracted)
    vat_treatment = detect_vat_treatment(extracted)
    return {
        "extraction_status": status,
        "extracted_data": extracted,
        "vat_treatment": vat_treatment,
        "confidence_notes": _confidence_notes(extracted, status),
        "raw_text": raw_text[:8000] if status != "success" else "",
    }
