"""
Bank statement parser — handles digital PDFs, scanned PDFs (OCR), Excel, CSV.
Bank formats loaded from app/config/bank_formats.json — add new banks there,
no Python changes needed.
"""
from __future__ import annotations

import json
import logging
import re
from io import BytesIO
from pathlib import Path

import pandas as pd

logger = logging.getLogger(__name__)

# ── Load bank format config from JSON ────────────────────────────────────────

_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "bank_formats.json"

def _load_bank_formats() -> dict[str, dict]:
    try:
        with open(_CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        logger.warning("bank_formats.json not found or invalid (%s) — using empty config", exc)
        return {}

BANK_FORMATS: dict[str, dict] = _load_bank_formats()


# ── Bank detection ────────────────────────────────────────────────────────────

def detect_bank(text: str) -> str:
    """Detect bank name from PDF text or filename."""
    t = text.upper()
    for bank, cfg in BANK_FORMATS.items():
        if any(k.upper() in t for k in cfg.get("keywords", [])):
            return bank
    return "OTHER"


# ── Date parsing ─────────────────────────────────────────────────────────────

def parse_bank_date(raw_date: object) -> "pd.Timestamp | pd.NaT":
    """
    Parse a bank date that may include a time component.

    Handles all of:
      "01/04/2026"          → HDFC / KOTAK
      "01-04-2026"          → AXIS / ICICI
      "01-04-2026 13:17"    → KOTAK datetime (strip time first)
      "01 Apr 2026"         → SBI
      "01-Apr-2026"         → YES Bank
    """
    if raw_date is None or (isinstance(raw_date, float) and pd.isna(raw_date)):
        return pd.NaT
    s = str(raw_date).strip()
    # Strip time component (e.g. "01-04-2026 13:17" → "01-04-2026")
    if " " in s and len(s) > 10:
        s = s[:10]
    return pd.to_datetime(s, dayfirst=True, errors="coerce")


# ── Amount parsing ────────────────────────────────────────────────────────────

def parse_amount(val: object) -> tuple[float, str]:
    """
    Parse any Indian bank amount string.
    Returns (amount_float, txn_type) where txn_type ∈ {'debit','credit','unknown'}.

    Handles:
      "1,25,000.00 CR"  → (125000.0, 'credit')
      "2,500 DR"        → (2500.0,   'debit')
      "(5,000.00)"      → (5000.0,   'debit')   ← parentheses = negative
      "-850"            → (850.0,    'debit')   ← leading minus
      "+25000"          → (25000.0,  'credit')  ← leading plus
      "1,20,000"        → (120000.0, 'unknown') ← plain number
      ""  / "-" / "nil" → (0.0,      'unknown')
    """
    if not val:
        return 0.0, "unknown"
    s = str(val).strip()
    if s in ("", "-", "—", "nil", "NIL", "nan", "NaN"):
        return 0.0, "unknown"

    su = s.upper()
    txn_type = "unknown"

    # CR / DR suffix  (must check before stripping sign chars)
    if su.endswith(" CR") or su.endswith("CR"):
        txn_type = "credit"
        s = s[:s.upper().rfind("CR")].strip()
    elif su.endswith(" DR") or su.endswith("DR"):
        txn_type = "debit"
        s = s[:s.upper().rfind("DR")].strip()

    # Parentheses  (5,000.00)  → debit
    if s.startswith("(") and s.endswith(")"):
        txn_type = "debit"
        s = s[1:-1]

    # Leading sign
    if s.startswith("+"):
        if txn_type == "unknown":
            txn_type = "credit"
        s = s[1:]
    elif s.startswith("-"):
        if txn_type == "unknown":
            txn_type = "debit"
        s = s[1:]

    # Strip currency symbol, commas, spaces
    cleaned = re.sub(r"[₹,\s]", "", s)
    try:
        return float(cleaned), txn_type
    except ValueError:
        return 0.0, txn_type


def _to_float(val: object) -> float:
    """Convenience wrapper — just the float, type hint discarded."""
    amount, _ = parse_amount(val)
    return amount


# ── PDF parser (digital / text-based) ────────────────────────────────────────

def parse_pdf_bank_statement(file_bytes: bytes, bank: str = "AUTO") -> pd.DataFrame:
    """
    Parse a digital (text-based) PDF bank statement using pdfplumber.
    Column positions are driven by bank_formats.json pdf_cols config.
    """
    import pdfplumber

    all_rows: list[dict] = []
    with pdfplumber.open(BytesIO(file_bytes)) as pdf:
        full_text = " ".join(p.extract_text() or "" for p in pdf.pages)
        detected  = bank if bank != "AUTO" else detect_bank(full_text)
        cfg       = BANK_FORMATS.get(detected, BANK_FORMATS.get("HDFC", {}))
        pdf_cols  = cfg.get("pdf_cols", {"date": 0, "narration": 1, "debit": 4, "credit": 5, "balance": 6})
        date_re   = re.compile(cfg.get("date_fmt", r"\d{2}[\/\-]\d{2}[\/\-]\d{2,4}"))

        # Determine the highest column index we'll read
        max_col = max(pdf_cols.get(k, 0) for k in ("debit", "credit", "balance"))
        has_amount_col = "amount" in pdf_cols and "debit" not in pdf_cols

        for page in pdf.pages:
            tables = page.extract_tables() or []
            for table in tables:
                for row in (table or []):
                    if not row or len(row) <= max_col:
                        continue
                    date_cell = str(row[pdf_cols["date"]] or "").strip()
                    if not date_re.match(date_cell):
                        continue
                    try:
                        narration = str(row[pdf_cols["narration"]] or "").strip()
                        balance   = _to_float(row[pdf_cols["balance"]])

                        if has_amount_col:
                            amt, atype = parse_amount(row[pdf_cols["amount"]])
                            debit  = amt if atype == "debit"  else 0.0
                            credit = amt if atype == "credit" else 0.0
                            # Fallback: treat as credit if type unknown and positive
                            if atype == "unknown":
                                credit = amt
                        else:
                            debit  = _to_float(row[pdf_cols["debit"]])
                            credit = _to_float(row[pdf_cols["credit"]])

                        all_rows.append({
                            "date":        pd.to_datetime(date_cell, dayfirst=True, errors="coerce"),
                            "description": narration[:200],
                            "debit":       debit,
                            "credit":      credit,
                            "balance":     balance,
                            "bank":        detected,
                            "source":      "pdf_text",
                        })
                    except Exception:
                        continue

    df = pd.DataFrame(all_rows)
    if df.empty:
        return df
    return df.dropna(subset=["date"]).sort_values("date").reset_index(drop=True)


# ── PDF parser (scanned / OCR) ────────────────────────────────────────────────

def parse_scanned_pdf_statement(file_bytes: bytes) -> pd.DataFrame:
    """
    Parse scanned / WhatsApp-forwarded PDFs using OCR.
    Requires: pdf2image + pytesseract + tesseract-ocr system package.
    """
    try:
        import pytesseract
        from pdf2image import convert_from_bytes
    except ImportError as exc:
        raise RuntimeError(
            "OCR dependencies missing. "
            "Run: pip install pdf2image pytesseract  &&  apt install tesseract-ocr"
        ) from exc

    images   = convert_from_bytes(file_bytes, dpi=300)
    all_rows: list[dict] = []
    date_re   = re.compile(r"(\d{2}[\/\-]\d{2}[\/\-]\d{4}|\d{2}\s+[A-Za-z]{3}\s+\d{4})")
    amount_re = re.compile(r"[\d,]+\.\d{2}")

    for img in images:
        text = pytesseract.image_to_string(img, config="--psm 6")
        for line in text.splitlines():
            dm = date_re.search(line)
            if not dm:
                continue
            amounts = [float(a.replace(",", "")) for a in amount_re.findall(line)]
            balance = amounts[-1] if amounts else None
            debit   = amounts[0]  if len(amounts) >= 3 else None
            credit  = amounts[1]  if len(amounts) >= 3 else (amounts[0] if len(amounts) == 2 else None)
            before  = line[: dm.start()].strip()
            after   = line[dm.end():].strip()
            desc    = re.sub(r"[\d,\.]+", " ", f"{before} {after}").strip()[:120]
            all_rows.append({
                "date":        pd.to_datetime(dm.group(), dayfirst=True, errors="coerce"),
                "description": desc,
                "debit":       float(debit)   if debit   is not None else 0.0,
                "credit":      float(credit)  if credit  is not None else 0.0,
                "balance":     float(balance) if balance is not None else 0.0,
                "bank":        "SCANNED",
                "source":      "ocr",
            })

    df = pd.DataFrame(all_rows)
    if df.empty:
        return df
    return df.dropna(subset=["date"]).sort_values("date").reset_index(drop=True)


# ── Excel / CSV parser ────────────────────────────────────────────────────────

def _match_col(columns: list[str], candidates: list[str]) -> str | None:
    """
    Find the first DataFrame column that matches any candidate name.
    Matching is case-insensitive and checks for substring containment.
    """
    for cand in candidates:
        cl = cand.lower().strip()
        for col in columns:
            if col.lower().strip() == cl:
                return col                      # exact match first
    for cand in candidates:
        cl = cand.lower().strip()
        for col in columns:
            if cl in col.lower().strip():
                return col                      # substring fallback
    return None


# Generic fallback candidates used when bank-specific config has no match
_FALLBACK_CANDIDATES: dict[str, list[str]] = {
    "date":        ["date", "txn date", "value date", "posting date", "trans date", "transaction date"],
    "narration":   ["narration", "description", "particulars", "details", "remarks", "memo", "transaction remarks"],
    "debit":       ["debit", "withdrawal", "dr amount", "amount dr", "withdrawal amt", "dr"],
    "credit":      ["credit", "deposit", "cr amount", "amount cr", "deposit amt", "cr"],
    "amount":      ["amount", "amt", "net amount", "transaction amount"],
    "balance":     ["balance", "bal", "closing balance", "closing bal"],
}


def parse_excel_csv_statement(
    file_bytes: bytes,
    filename: str,
    bank: str = "AUTO",
) -> pd.DataFrame:
    """
    Parse bank statement Excel / CSV.

    Column resolution order:
      1. Bank-specific csv_cols from bank_formats.json  (exact then substring)
      2. Generic fallback candidates
    This means HDFC "Withdrawal Amt." is found before a generic "amount" catch-all.
    """
    fname = filename.lower()
    try:
        if fname.endswith(".csv"):
            df = pd.read_csv(BytesIO(file_bytes))
        else:
            df = pd.read_excel(BytesIO(file_bytes), engine="openpyxl")
    except Exception as exc:
        logger.warning("Failed to read %s: %s", filename, exc)
        return pd.DataFrame()

    raw_cols = list(df.columns)

    # ── Detect bank from filename / column headers if not provided ──────────
    if bank == "AUTO":
        hint = filename + " " + " ".join(raw_cols)
        bank = detect_bank(hint)

    # ── Build column map: logical name → actual DataFrame column ────────────
    col_map: dict[str, str] = {}
    bank_csv = BANK_FORMATS.get(bank, {}).get("csv_cols", {})

    for logical in ("date", "narration", "debit", "credit", "amount", "balance"):
        # 1. Bank-specific candidates
        specific = bank_csv.get(logical, [])
        matched  = _match_col(raw_cols, specific) if specific else None
        # 2. Generic fallback
        if not matched:
            matched = _match_col(raw_cols, _FALLBACK_CANDIDATES.get(logical, []))
        if matched:
            col_map[logical] = matched

    # Rename to logical names
    rename = {v: k for k, v in col_map.items() if v != k}
    df = df.rename(columns=rename)

    # ── Parse each logical column ────────────────────────────────────────────

    if "date" in df.columns:
        # Use parse_bank_date to handle both plain dates and datetime strings
        # (e.g. Kotak: "01-04-2026 13:17" → strips time before pandas parse)
        try:
            df["date"] = df["date"].apply(parse_bank_date)
        except Exception:
            df["date"] = pd.to_datetime(df["date"], dayfirst=True, errors="coerce", format="mixed")

    # Separate debit / credit columns
    if "debit" in df.columns:
        df["debit"] = df["debit"].apply(_to_float)
    if "credit" in df.columns:
        df["credit"] = df["credit"].apply(_to_float)

    # Single amount column — uses parse_amount to infer direction
    if "amount" in df.columns and "debit" not in df.columns:
        parsed       = df["amount"].apply(parse_amount)
        df["amount_f"]  = parsed.apply(lambda x: x[0])
        df["amount_t"]  = parsed.apply(lambda x: x[1])

        # If column has explicit CR/DR markers use them; otherwise fall back to sign
        has_type_info = df["amount_t"].ne("unknown").any()
        if has_type_info:
            df["debit"]  = df.apply(
                lambda r: r["amount_f"] if r["amount_t"] == "debit"  else 0.0, axis=1
            )
            df["credit"] = df.apply(
                lambda r: r["amount_f"] if r["amount_t"] == "credit" else 0.0, axis=1
            )
        else:
            # Fall back to raw numeric sign (negative = debit, positive = credit)
            raw_num = df["amount"].apply(lambda v: _raw_signed(v))
            df["debit"]  = raw_num.apply(lambda x: abs(x) if x < 0 else 0.0)
            df["credit"] = raw_num.apply(lambda x: x       if x > 0 else 0.0)

        df = df.drop(columns=["amount", "amount_f", "amount_t"], errors="ignore")

    if "balance" in df.columns:
        df["balance"] = df["balance"].apply(_to_float)

    # Ensure required columns exist
    for col in ("debit", "credit", "balance", "description"):
        if col not in df.columns:
            df[col] = 0.0 if col != "description" else ""

    # Rename narration → description if needed
    if "narration" in df.columns and "description" not in df.columns:
        df = df.rename(columns={"narration": "description"})

    df["bank"]   = bank if bank != "OTHER" else "CSV/Excel"
    df["source"] = "excel_csv"

    if "date" not in df.columns:
        return pd.DataFrame()

    return (
        df.dropna(subset=["date"])
        .query("debit > 0 or credit > 0 or balance > 0")
        .reset_index(drop=True)
    )


def _raw_signed(val: object) -> float:
    """Parse a raw signed number without CR/DR heuristics (for plain amount columns)."""
    if not val:
        return 0.0
    s = str(val).strip()
    if s in ("", "-", "—", "nil", "NIL", "nan"):
        return 0.0
    # Strip parentheses → negative
    if s.startswith("(") and s.endswith(")"):
        s = "-" + s[1:-1]
    cleaned = re.sub(r"[₹,\s]", "", s)
    try:
        return float(cleaned)
    except ValueError:
        return 0.0
