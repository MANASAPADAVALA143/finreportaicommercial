"""AR bulk Excel import — LLM header mapping + classify-before-persist."""

from __future__ import annotations

import io
import json
import logging
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

import pandas as pd
from sqlalchemy.orm import Session

from app.services.ar_sales_invoice_service import (
    ARLineItemInput,
    create_ar_invoice_with_classify,
)
from app.services.json_llm_extract import parse_llm_json_dict
from app.services.llm_service import LLMNotConfiguredError, invoke

logger = logging.getLogger(__name__)

MAX_BULK_ROWS = 100

TARGET_FIELDS = [
    "customer_name",
    "buyer_trn",
    "invoice_date",
    "due_date",
    "description",
    "qty",
    "unit_price",
    "amount",
    "vat_rate",
]

_HEADER_KEYWORDS = {
    "customer", "client", "buyer", "trn", "date", "due", "amount",
    "total", "description", "notes", "qty", "quantity", "vat", "price",
}

_FALLBACK_ALIASES: dict[str, list[str]] = {
    "customer_name": ["customer name", "customer", "client name", "client", "buyer name", "buyer"],
    "buyer_trn": ["buyer trn", "customer trn", "trn", "tax registration"],
    "invoice_date": ["invoice date", "inv date", "date", "transaction date"],
    "due_date": ["due date", "payment due"],
    "description": ["description", "notes", "remarks", "narration"],
    "qty": ["qty", "quantity"],
    "unit_price": ["unit price", "price", "rate"],
    "amount": ["amount", "total", "total aed", "invoice amount", "net amount"],
    "vat_rate": ["vat rate", "tax rate", "vat %"],
}


def _fallback_header_map(columns: list[str]) -> dict[str, str | None]:
    """Used only when LLM mapping fails — best-effort alias match."""
    norm_cols = {c: _normalize_header(c) for c in columns}
    mapping: dict[str, str | None] = {f: None for f in TARGET_FIELDS}
    for field, aliases in _FALLBACK_ALIASES.items():
        for alias in aliases:
            for col, norm in norm_cols.items():
                if norm == alias or alias in norm:
                    mapping[field] = col
                    break
            if mapping[field]:
                break
    return mapping


def _normalize_header(cell: Any) -> str:
    return re.sub(r"\s+", " ", str(cell or "").strip().lower())


def _detect_header_row(raw: pd.DataFrame) -> int:
    best_row, best_score = 0, 0
    for i in range(min(12, len(raw))):
        row_vals = [_normalize_header(v) for v in raw.iloc[i].tolist() if str(v).strip()]
        if len(row_vals) < 2:
            continue
        hits = sum(
            1 for v in row_vals
            for kw in _HEADER_KEYWORDS
            if kw in v
        )
        if hits > best_score:
            best_score = hits
            best_row = i
    return best_row


def _read_excel_bytes(content: bytes, filename: str) -> pd.DataFrame:
    lower = (filename or "").lower()
    if lower.endswith(".csv"):
        raw = pd.read_csv(io.BytesIO(content), header=None, dtype=object)
    else:
        raw = pd.read_excel(io.BytesIO(content), header=None, engine="openpyxl", dtype=object)

    if raw.empty:
        raise ValueError("File is empty or has no data")

    header_row = _detect_header_row(raw)
    headers = [
        str(v).strip() if pd.notna(v) and str(v).strip() else f"col_{j}"
        for j, v in enumerate(raw.iloc[header_row].tolist())
    ]
    df = raw.iloc[header_row + 1 :].copy()
    df.columns = headers
    df = df.dropna(how="all").reset_index(drop=True)
    return df


def _sample_rows_for_llm(df: pd.DataFrame, n: int = 3) -> list[dict[str, str]]:
    samples: list[dict[str, str]] = []
    for _, row in df.head(n).iterrows():
        samples.append(
            {str(k): str(v) if pd.notna(v) else "" for k, v in row.items()}
        )
    return samples


def map_headers_with_llm(columns: list[str], sample_rows: list[dict[str, str]]) -> dict[str, str | None]:
    """
    One-shot LLM call: map actual spreadsheet headers to TARGET_FIELDS.
    Returns {target_field: actual_column_name_or_null}.
    """
    prompt = f"""You map spreadsheet column headers to AR sales invoice fields.

Actual column headers in the file:
{json.dumps(columns, ensure_ascii=False)}

Sample data rows (first rows after header):
{json.dumps(sample_rows, ensure_ascii=False)}

Target schema fields (map each to the best matching actual column name, or null if absent):
- customer_name: buyer / customer / client name
- buyer_trn: customer TRN / tax registration number
- invoice_date: invoice or transaction date
- due_date: payment due date
- description: line description, notes, or remarks
- qty: quantity (optional; default 1 if missing)
- unit_price: unit price per line (optional if amount is present)
- amount: line total or invoice amount (use if no separate unit_price)
- vat_rate: VAT percentage (optional; default 5)

Return ONLY valid JSON object mapping each target field to the exact header string from the file, or null:
{{
  "customer_name": "Customer Name",
  "buyer_trn": null,
  "invoice_date": "Invoice Date",
  "due_date": "Due Date",
  "description": "Notes",
  "qty": null,
  "unit_price": null,
  "amount": "Total AED",
  "vat_rate": null
}}"""

    system = (
        "You are a data-mapping assistant for UAE AR invoice imports. "
        "Return only JSON. Use exact header strings from the file."
    )
    try:
        raw = invoke(prompt=prompt, system=system, max_tokens=800, temperature=0.1)
        parsed = parse_llm_json_dict(raw)
        if not parsed:
            raise ValueError("LLM returned non-object JSON")
        mapping: dict[str, str | None] = {}
        col_set = set(columns)
        for field in TARGET_FIELDS:
            val = parsed.get(field)
            if val is None or val == "" or str(val).lower() == "null":
                mapping[field] = None
            else:
                s = str(val).strip()
                if s in col_set:
                    mapping[field] = s
                else:
                    # fuzzy: case-insensitive match
                    match = next((c for c in columns if c.lower() == s.lower()), None)
                    mapping[field] = match
        return mapping
    except LLMNotConfiguredError:
        logger.warning("LLM not configured — using fallback header mapping")
        return _fallback_header_map(columns)
    except Exception as exc:
        logger.warning("LLM header mapping failed (%s) — using fallback", exc)
        fallback = _fallback_header_map(columns)
        if fallback.get("customer_name") and (fallback.get("amount") or fallback.get("unit_price")):
            return fallback
        raise ValueError(
            f"Could not map spreadsheet columns automatically ({exc}). "
            "Ensure headers include customer name, date, and amount columns."
        ) from exc


def _parse_date(val: Any) -> date | None:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    if isinstance(val, (int, float)) and 25000 < val < 80000:
        excel_epoch = datetime(1899, 12, 30)
        return (excel_epoch + timedelta(days=float(val))).date()
    s = str(val).strip()
    if not s:
        return None
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return date.fromisoformat(s)
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y", "%d %b %Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    try:
        return pd.to_datetime(s, dayfirst=True).date()
    except Exception:
        return None


def _parse_amount(val: Any) -> float | None:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    if isinstance(val, (int, float)):
        return float(val) if val >= 0 else None
    s = re.sub(r"[^\d.,-]", "", str(val).strip())
    if not s:
        return None
    if re.match(r"^\d{1,3}(,\d{2,3})+(\.\d+)?$", s):
        s = s.replace(",", "")
    else:
        s = s.replace(",", "")
    try:
        n = float(s)
        return n if n >= 0 else None
    except ValueError:
        return None


def _cell(row: pd.Series, col: str | None) -> Any:
    if not col or col not in row.index:
        return None
    value = row[col]
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except Exception:
        pass
    return value


def _clean_text(val: Any) -> str:
    if val is None:
        return ""
    try:
        if pd.isna(val):
            return ""
    except Exception:
        pass
    s = str(val).strip()
    return "" if s.lower() == "nan" else s


@dataclass
class ParsedBulkRow:
    row_number: int
    customer_name: str
    buyer_trn: str | None
    invoice_date: date
    due_date: date
    line_items: list[ARLineItemInput]


def _build_line_items(
    description: str | None,
    qty_val: Any,
    unit_price_val: Any,
    amount_val: Any,
    vat_rate_val: Any,
) -> list[ARLineItemInput]:
    qty = _parse_amount(qty_val) or 1.0
    unit_price = _parse_amount(unit_price_val)
    amount = _parse_amount(amount_val)
    vat_rate = _parse_amount(vat_rate_val) or 5.0

    if unit_price is None and amount is not None:
        unit_price = amount / qty if qty else amount
    if unit_price is None:
        return []

    desc = (description or "").strip() or "Imported sale"
    return [
        ARLineItemInput(
            description=desc,
            qty=qty,
            unit_price=unit_price,
            vat_rate=vat_rate,
        )
    ]


def parse_bulk_rows(
    df: pd.DataFrame,
    column_map: dict[str, str | None],
    *,
    header_row_offset: int = 1,
) -> tuple[list[ParsedBulkRow], list[dict[str, Any]]]:
    """Parse dataframe rows; return (valid_rows, validation_errors)."""
    valid: list[ParsedBulkRow] = []
    errors: list[dict[str, Any]] = []

    for idx, row in df.iterrows():
        excel_row = int(idx) + header_row_offset + 2  # 1-based Excel row after header
        customer = _clean_text(_cell(row, column_map.get("customer_name")))
        buyer_trn_raw = _cell(row, column_map.get("buyer_trn"))
        buyer_trn = _clean_text(buyer_trn_raw) or None

        inv_date = _parse_date(_cell(row, column_map.get("invoice_date")))
        due_date = _parse_date(_cell(row, column_map.get("due_date")))
        description = _clean_text(_cell(row, column_map.get("description"))) or None
        qty_val = _cell(row, column_map.get("qty"))
        unit_price_val = _cell(row, column_map.get("unit_price"))
        amount_val = _cell(row, column_map.get("amount"))
        vat_rate_val = _cell(row, column_map.get("vat_rate"))

        row_errors: list[str] = []
        if not customer:
            row_errors.append("customer_name is required")
        if not inv_date:
            row_errors.append("invoice_date is required or invalid")
        line_items = _build_line_items(description, qty_val, unit_price_val, amount_val, vat_rate_val)
        if not line_items:
            row_errors.append("amount or unit_price is required and must be a valid number")

        if row_errors:
            errors.append({"row": excel_row, "error": "; ".join(row_errors)})
            continue

        if not due_date:
            due_date = inv_date + timedelta(days=30)  # type: ignore[operator]

        valid.append(
            ParsedBulkRow(
                row_number=excel_row,
                customer_name=customer,
                buyer_trn=buyer_trn,
                invoice_date=inv_date,  # type: ignore[arg-type]
                due_date=due_date,
                line_items=line_items,
            )
        )
    return valid, errors


def run_ar_bulk_import(
    db: Session,
    *,
    content: bytes,
    filename: str,
    tenant_id: str,
    company_id: str | None,
) -> dict[str, Any]:
    df = _read_excel_bytes(content, filename)

    if len(df) > MAX_BULK_ROWS:
        raise ValueError(
            f"File has {len(df)} rows; please split into batches of {MAX_BULK_ROWS} or fewer."
        )

    columns = [str(c) for c in df.columns.tolist()]
    sample = _sample_rows_for_llm(df)
    column_map = map_headers_with_llm(columns, sample)

    if not column_map.get("customer_name"):
        raise ValueError(
            "Could not identify a customer name column. "
            f"Headers found: {columns}. Ensure the file has a customer/client column."
        )
    if not column_map.get("invoice_date"):
        raise ValueError(
            "Could not identify an invoice date column. "
            f"Headers found: {columns}."
        )
    if not column_map.get("amount") and not column_map.get("unit_price"):
        raise ValueError(
            "Could not identify an amount or unit price column. "
            f"Headers found: {columns}."
        )

    parsed_rows, skipped_errors = parse_bulk_rows(df, column_map)

    imported = 0
    posted = 0
    flagged_review = 0
    skipped_hard_block: list[dict[str, Any]] = []

    for prow in parsed_rows:
        result = create_ar_invoice_with_classify(
            db,
            tenant_id=tenant_id,
            company_id=company_id,
            customer_name=prow.customer_name,
            customer_trn=prow.buyer_trn,
            invoice_date=prow.invoice_date,
            due_date=prow.due_date,
            line_items=prow.line_items,
            skip_on_hard_block=True,
            commit=True,
        )
        if result.skipped_hard_block:
            skipped_hard_block.append({
                "row": prow.row_number,
                "customer": prow.customer_name,
                "reason": result.gulftax_reasoning or "GulfTax HARD_BLOCK",
            })
            continue
        if not result.success:
            skipped_errors.append({
                "row": prow.row_number,
                "error": result.error or "Import failed",
            })
            continue

        imported += 1
        if result.posted:
            posted += 1
        if result.flag_for_review or result.gulftax_decision == "REVIEW_QUEUE":
            flagged_review += 1

    return {
        "total_rows": len(df),
        "imported": imported,
        "posted": posted,
        "flagged_review": flagged_review,
        "skipped_hard_block": skipped_hard_block,
        "skipped_errors": skipped_errors,
        "column_map": column_map,
    }
