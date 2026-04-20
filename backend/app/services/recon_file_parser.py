"""
Bank / GL file parsing: CSV, Excel, OFX, MT940, PDF (via LLM).
"""
from __future__ import annotations

import io
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import pandas as pd
from dateutil import parser as date_parser
from rapidfuzz import fuzz

_DATE_HINTS = ["date", "txn_date", "posting_date", "value_date", "dtposted", "valdat"]
_AMOUNT_HINTS = ["amount", "debit", "credit", "dr", "cr", "value", "trnamt"]
_DESC_HINTS = ["description", "narration", "memo", "remarks", "payee", "name"]
_REF_HINTS = ["reference", "doc_no", "voucher", "cheque", "check", "fitid", "bank_reference"]
_GL_HINTS = ["gl_account", "account", "acct"]


def _normalize_col_name(c: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(c).lower())


def _score_column(keys: list[str], name: str) -> int:
    n = _normalize_col_name(name)
    best = 0
    for k in keys:
        kk = _normalize_col_name(k)
        if kk == n:
            return 100
        best = max(best, fuzz.partial_ratio(kk, n))
    return best


def detect_columns(df: pd.DataFrame) -> dict[str, str | None]:
    cols = list(df.columns)
    mapping: dict[str, str | None] = {
        "date": None,
        "amount": None,
        "debit": None,
        "credit": None,
        "description": None,
        "reference": None,
        "gl_account": None,
    }
    for c in cols:
        if mapping["date"] is None and _score_column(_DATE_HINTS, c) >= 85:
            mapping["date"] = c
        if mapping["amount"] is None and _score_column(["amount", "value", "trnamt"], c) >= 85:
            mapping["amount"] = c
        if mapping["debit"] is None and _score_column(["debit", "dr"], c) >= 85:
            mapping["debit"] = c
        if mapping["credit"] is None and _score_column(["credit", "cr"], c) >= 85:
            mapping["credit"] = c
        if mapping["description"] is None and _score_column(_DESC_HINTS, c) >= 80:
            mapping["description"] = c
        if mapping["reference"] is None and _score_column(_REF_HINTS, c) >= 80:
            mapping["reference"] = c
        if mapping["gl_account"] is None and _score_column(_GL_HINTS, c) >= 80:
            mapping["gl_account"] = c
    return mapping


def _parse_date(val: Any) -> date | None:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    s = str(val).strip()
    if not s:
        return None
    try:
        if len(s) >= 10 and s[4] == "-" and s[7] == "-":
            return datetime.strptime(s[:10], "%Y-%m-%d").date()
        return date_parser.parse(s, dayfirst=True).date()
    except (ValueError, TypeError, OverflowError):
        return None


def _parse_decimal(val: Any) -> Decimal:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return Decimal("0")
    if isinstance(val, (int, float)):
        return Decimal(str(val))
    s = str(val).strip().replace(",", "")
    s = re.sub(r"[\$€£₹]", "", s)
    try:
        return Decimal(s)
    except InvalidOperation:
        return Decimal("0")


def rows_from_dataframe(df: pd.DataFrame, *, for_gl: bool) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    df = df.copy()
    mapping = detect_columns(df)
    rows: list[dict[str, Any]] = []
    for idx, row in df.iterrows():
        def cell(col: str | None):
            if col is None or col not in df.columns:
                return None
            return row.get(col)

        d_raw = mapping["date"]
        txn_date = _parse_date(cell(d_raw))
        if txn_date is None:
            continue

        debit_c = mapping["debit"]
        credit_c = mapping["credit"]
        amt_c = mapping["amount"]
        debit = _parse_decimal(cell(debit_c)) if debit_c else Decimal("0")
        credit = _parse_decimal(cell(credit_c)) if credit_c else Decimal("0")

        if amt_c and cell(amt_c) is not None and str(cell(amt_c)).strip():
            amount = _parse_decimal(cell(amt_c))
        elif debit > 0 or credit > 0:
            amount = debit - credit
        else:
            amount = Decimal("0")

        dc = "D" if amount >= 0 else "C"
        amount_abs = abs(amount)

        desc = cell(mapping["description"])
        ref = cell(mapping["reference"])
        gl = cell(mapping["gl_account"]) if for_gl else None

        r: dict[str, Any] = {
            "txn_date": txn_date,
            "value_date": txn_date,
            "posting_date": txn_date,
            "amount": amount_abs,
            "debit_credit": dc,
            "description": str(desc or "").strip() or None,
            "reference": str(ref or "").strip() or None,
        }
        if for_gl and gl is not None:
            r["gl_account"] = str(gl).strip()
        rows.append(r)
    return rows, {"column_map": {k: v for k, v in mapping.items() if v}}


def parse_csv_excel_bytes(
    content: bytes, filename: str, *, for_gl: bool
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    fn = filename.lower()
    if fn.endswith(".csv"):
        for enc in ("utf-8", "latin-1"):
            try:
                df = pd.read_csv(io.BytesIO(content), encoding=enc)
                break
            except UnicodeDecodeError:
                df = None
        else:
            df = pd.read_csv(io.BytesIO(content), encoding="utf-8", errors="replace")
    elif fn.endswith(".xlsx") or fn.endswith(".xlsm"):
        df = pd.read_excel(io.BytesIO(content), engine="openpyxl")
    elif fn.endswith(".xls"):
        df = pd.read_excel(io.BytesIO(content), engine="xlrd")
    else:
        raise ValueError(f"Unsupported tabular format: {filename}")
    return rows_from_dataframe(df, for_gl=for_gl)


def parse_ofx_bytes(content: bytes) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    text = content.decode("utf-8", errors="ignore")
    if "<OFX>" not in text.upper() and "OFXHEADER" not in text.upper():
        raise ValueError("Not a valid OFX file")

    transactions: list[dict[str, Any]] = []
    for block in re.finditer(
        r"<STMTTRN>(.*?)</STMTTRN>",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    ):
        chunk = block.group(1)
        def tag(name: str) -> str | None:
            m = re.search(rf"<{name}>([^<\n]+)", chunk, re.IGNORECASE)
            return m.group(1).strip() if m else None

        dt = tag("DTPOSTED") or tag("DTUSER") or tag("DTAVAIL")
        amt_s = tag("TRNAMT")
        memo = tag("MEMO") or tag("NAME") or ""
        fitid = tag("FITID") or ""

        if not dt or amt_s is None:
            continue
        dt_clean = dt[:8] if len(dt) >= 8 else dt
        try:
            txn_date = datetime.strptime(dt_clean, "%Y%m%d").date()
        except ValueError:
            txn_date = _parse_date(dt_clean)
        if txn_date is None:
            continue
        amount = _parse_decimal(amt_s)
        dc = "D" if amount >= 0 else "C"
        transactions.append(
            {
                "txn_date": txn_date,
                "value_date": txn_date,
                "amount": abs(amount),
                "debit_credit": dc,
                "description": memo.strip() or None,
                "bank_reference": fitid or None,
            }
        )
    return transactions, {"format": "ofx"}


def parse_mt940_bytes(content: bytes) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    text = content.decode("utf-8", errors="ignore")
    rows: list[dict[str, Any]] = []
    for m in re.finditer(r":61:(\d{6})([CD])([\d,]+)N(.+)", text):
        yymmdd, dc_flag, raw_amt, rest = m.groups()
        try:
            yy = int(yymmdd[:2])
            mm = int(yymmdd[2:4])
            dd = int(yymmdd[4:6])
            year = 2000 + yy if yy < 70 else 1900 + yy
            txn_date = date(year, mm, dd)
        except ValueError:
            continue
        amt = _parse_decimal(raw_amt.replace(",", "."))
        dc = "D" if dc_flag.upper() == "D" else "C"
        desc = rest.strip()[:512]
        rows.append(
            {
                "txn_date": txn_date,
                "value_date": txn_date,
                "amount": amt,
                "debit_credit": dc,
                "description": desc or None,
                "bank_reference": None,
            }
        )
    if not rows and ":61:" in text:
        for line in text.splitlines():
            if ":61:" in line:
                sub = line.split(":61:", 1)[-1]
                m2 = re.match(r"(\d{6})([CD])([\d,]+)(.*)", sub)
                if not m2:
                    continue
                yymmdd, dc_flag, raw_amt, rest = m2.groups()
                try:
                    yy = int(yymmdd[:2])
                    mm = int(yymmdd[2:4])
                    dd = int(yymmdd[4:6])
                    year = 2000 + yy if yy < 70 else 1900 + yy
                    txn_date = date(year, mm, dd)
                except ValueError:
                    continue
                amt = _parse_decimal(raw_amt.replace(",", "."))
                dc = "D" if dc_flag.upper() == "D" else "C"
                rows.append(
                    {
                        "txn_date": txn_date,
                        "value_date": txn_date,
                        "amount": amt,
                        "debit_credit": dc,
                        "description": rest.strip() or None,
                        "bank_reference": None,
                    }
                )
    return rows, {"format": "mt940"}


def parse_pdf_bytes_via_llm(content: bytes, filename: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    try:
        from pypdf import PdfReader
    except ImportError:
        raise ValueError("pypdf is required for PDF parsing")

    reader = PdfReader(io.BytesIO(content))
    parts: list[str] = []
    for page in reader.pages[:15]:
        t = page.extract_text() or ""
        parts.append(t)
    raw = "\n".join(parts)
    if not raw.strip():
        raise ValueError("Could not extract text from PDF")

    from app.services.llm_service import invoke

    system = (
        "You extract bank transactions from raw PDF text. "
        'Return ONLY valid JSON: {"rows":[{"date":"YYYY-MM-DD","amount":123.45,'
        '"description":"...","reference":""}]}. Use signed amount or positive with debit/credit if needed; normalize to positive amount and omit debit_credit if unknown.'
    )
    prompt = f"Filename: {filename}\n\nPDF_TEXT:\n{raw[:12000]}"
    raw_out = invoke(prompt=prompt, system=system, max_tokens=4000)
    raw_out = raw_out.strip()
    if raw_out.startswith("```"):
        raw_out = re.sub(r"^```(?:json)?\s*", "", raw_out)
        raw_out = re.sub(r"\s*```$", "", raw_out)

    import json

    data = json.loads(raw_out)
    out_rows: list[dict[str, Any]] = []
    for r in data.get("rows", []):
        txn_date = _parse_date(r.get("date"))
        if not txn_date:
            continue
        amt = _parse_decimal(r.get("amount", 0))
        dc = "D" if amt >= 0 else "C"
        out_rows.append(
            {
                "txn_date": txn_date,
                "value_date": txn_date,
                "amount": abs(amt),
                "debit_credit": dc,
                "description": r.get("description"),
                "bank_reference": r.get("reference") or r.get("bank_reference"),
            }
        )
    return out_rows, {"format": "pdf_llm"}


def parse_upload(content: bytes, filename: str, *, side: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    fn = filename.lower()
    if fn.endswith(".pdf"):
        return parse_pdf_bytes_via_llm(content, filename)
    if fn.endswith(".ofx") or fn.endswith(".qfx"):
        return parse_ofx_bytes(content)
    if "mt940" in fn or fn.endswith(".940") or fn.endswith(".sta"):
        try:
            return parse_mt940_bytes(content)
        except Exception:
            pass
    return parse_csv_excel_bytes(content, filename, for_gl=(side == "book"))
