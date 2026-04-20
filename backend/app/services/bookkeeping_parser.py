"""Parse and normalize bank statement CSV/Excel rows (debit/credit, multi date formats)."""
from __future__ import annotations

import io
import re
from datetime import datetime
from typing import Any

import pandas as pd
from dateutil import parser as date_parser

# JE-style column aliases (field mapping before processing)
COLUMN_ALIASES = {
    "debit amount": "debit",
    "credit amount": "credit",
    "dr amount": "debit",
    "cr amount": "credit",
    "withdrawals": "debit",
    "deposits": "credit",
    "je_id": "id",
    "journal_id": "id",
    "user": "preparer",
    "preparer": "preparer",
    "account": "account_code",
    "account_code": "account_code",
    "account name": "account_name",
    "narration": "description",
    "particulars": "description",
    "details": "description",
    "txn date": "date",
    "transaction date": "date",
    "value date": "date",
    "posting date": "date",
    "post date": "date",
    "debit": "debit",
    "credit": "credit",
    "withdrawal": "debit",
    "deposit": "credit",
    "dr": "debit",
    "cr": "credit",
    "amount": "amount",
    "amt": "amount",
    "type": "type",
    "description": "description",
    "desc": "description",
    "payee": "description",
    "memo": "memo",
}


def _norm_col(c: str) -> str:
    s = str(c).strip().lower().replace("_", " ")
    s = re.sub(r"\s+", " ", s)
    return COLUMN_ALIASES.get(s, s.replace(" ", "_"))


def _to_float(x: Any) -> float | None:
    if x is None or (isinstance(x, float) and pd.isna(x)):
        return None
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x).strip().replace(",", "")
    if not s or s.lower() in ("nan", "none", "-"):
        return None
    s = re.sub(r"[^\d.\-]", "", s)
    if not s or s == "-" or s == ".":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_date(val: Any) -> datetime | None:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    if isinstance(val, datetime):
        return val
    if hasattr(val, "to_pydatetime"):
        try:
            return val.to_pydatetime()
        except Exception:
            pass
    s = str(val).strip()
    if not s:
        return None
    # Excel serial
    if s.replace(".", "").isdigit() and len(s) < 12:
        try:
            n = float(s)
            if 30000 < n < 60000:
                return pd.Timestamp("1899-12-30") + pd.Timedelta(days=int(n))
        except Exception:
            pass
    for dayfirst in (True, False):
        try:
            dt = date_parser.parse(s, dayfirst=dayfirst, yearfirst=True)
            return datetime(dt.year, dt.month, dt.day)
        except (ValueError, TypeError, OverflowError):
            continue
    return None


def normalize_amount_row(row: dict[str, Any]) -> float:
    """if debit > 0 → debit else credit (per autopilot spec)."""
    debit = _to_float(row.get("debit"))
    credit = _to_float(row.get("credit"))
    if debit is not None and debit > 0:
        return abs(debit)
    if credit is not None and credit != 0:
        return abs(credit)
    amt = _to_float(row.get("amount"))
    if amt is not None:
        return abs(amt)
    return 0.0


def _infer_type(row: dict[str, Any], amount: float) -> str:
    debit = _to_float(row.get("debit"))
    credit = _to_float(row.get("credit"))
    if debit is not None and debit > 0:
        return "debit"
    if credit is not None and credit > 0:
        return "credit"
    t = str(row.get("type") or "").lower().strip()
    if t in ("dr", "debit", "withdrawal", "out"):
        return "debit"
    if t in ("cr", "credit", "deposit", "in"):
        return "credit"
    return "unknown"


def _extract_vendor(description: str) -> str:
    d = (description or "").strip()
    if not d:
        return "Unknown"
    parts = re.split(r"[|\-–—/]", d, maxsplit=1)
    return parts[0].strip()[:200] or "Unknown"


_PDF_LINE_AMOUNT = re.compile(r"([\d,]+\.\d{2})\s*(?:DR|CR|Dr|Cr)?\s*$", re.IGNORECASE)
_PDF_LINE_DATE = re.compile(
    r"\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})\b"
)


def _rows_from_pdf(content: bytes) -> list[dict[str, Any]]:
    """Best-effort text extraction from bank PDFs (layout varies by bank)."""
    from pypdf import PdfReader

    bio = io.BytesIO(content)
    reader = PdfReader(bio)
    chunks: list[str] = []
    for page in reader.pages:
        t = page.extract_text()
        if t:
            chunks.append(t)
    text = "\n".join(chunks)
    if not text.strip():
        raise ValueError(
            "Could not extract text from this PDF. Export the bank statement as CSV or Excel instead."
        )

    rows: list[dict[str, Any]] = []
    for line in text.splitlines():
        line = line.strip()
        if len(line) < 10:
            continue
        m_amt = _PDF_LINE_AMOUNT.search(line)
        if not m_amt:
            continue
        rest = line[: m_amt.start()].strip()
        try:
            amount = float(m_amt.group(1).replace(",", ""))
        except ValueError:
            continue
        if amount <= 0:
            continue
        m_date = _PDF_LINE_DATE.search(rest)
        if not m_date:
            continue
        dt = _parse_date(m_date.group(1))
        if not dt:
            continue
        desc = (rest[m_date.end() :].strip() + " " + rest[: m_date.start()].strip()).strip()
        if not desc:
            desc = rest
        rows.append(
            {
                "date": dt,
                "description": (desc or "PDF import")[:500],
                "amount": float(amount),
                "type": _infer_type({}, amount),
                "vendor_name": _extract_vendor(desc),
            }
        )

    if len(rows) < 2:
        raise ValueError(
            "Could not parse enough transactions from this PDF (expected lines with a date and an amount like 1,234.56). "
            "Export as CSV or Excel for a full import."
        )
    return rows


def parse_bank_file(content: bytes, filename: str) -> list[dict[str, Any]]:
    """
    Returns list of normalized dicts:
    date (datetime ISO), description, amount, type, vendor_name,
    optional id, preparer, account_code from mapped columns.
    """
    name = (filename or "").lower()
    if name.endswith(".pdf"):
        return _rows_from_pdf(content)

    bio = io.BytesIO(content)
    if name.endswith((".xlsx", ".xlsm")):
        df = pd.read_excel(bio, engine="openpyxl")
    elif name.endswith(".xls"):
        df = pd.read_excel(bio, engine="xlrd")
    elif name.endswith(".csv"):
        df = pd.read_csv(bio)
    else:
        raise ValueError("Unsupported file type. Use .csv, .xlsx, or .xls")

    df.columns = [_norm_col(c) for c in df.columns]
    # second pass: map renamed
    rename = {}
    for c in list(df.columns):
        key = str(c).lower().replace("_", " ")
        if key in COLUMN_ALIASES:
            rename[c] = COLUMN_ALIASES[key]
    if rename:
        df = df.rename(columns=rename)

    rows: list[dict[str, Any]] = []
    for _, raw in df.iterrows():
        row = {str(k): raw[k] for k in df.columns if k is not None}
        # Map JE-style keys if present
        if "je_id" in row and "id" not in row:
            row["id"] = row.get("je_id")
        if "journal_id" in row and "id" not in row:
            row["id"] = row.get("journal_id")

        dt = None
        for key in ("date", "txn_date", "value_date", "posting_date"):
            if key in row:
                dt = _parse_date(row.get(key))
                if dt:
                    break
        if not dt:
            continue

        amount = normalize_amount_row(row)
        if amount <= 0 and not any(_to_float(row.get(k)) for k in ("debit", "credit", "amount")):
            continue
        if amount <= 0:
            continue

        desc_parts = []
        for key in ("description", "memo", "narration", "particulars"):
            if key in row and pd.notna(row.get(key)):
                desc_parts.append(str(row[key]).strip())
        description = " | ".join(desc_parts) if desc_parts else ""

        norm = {
            "date": dt,
            "description": description,
            "amount": float(amount),
            "type": _infer_type(row, amount),
            "vendor_name": _extract_vendor(description),
        }
        if row.get("id") is not None and str(row.get("id")).strip():
            norm["source_id"] = str(row["id"]).strip()
        if row.get("preparer") is not None and str(row.get("preparer")).strip():
            norm["preparer"] = str(row["preparer"]).strip()
        if row.get("account_code") is not None and str(row.get("account_code")).strip():
            norm["account_code"] = str(row["account_code"]).strip()
        if row.get("bank_account_id") is not None and str(row.get("bank_account_id")).strip():
            norm["bank_account_id"] = str(row["bank_account_id"]).strip()
        rows.append(norm)

    return rows
