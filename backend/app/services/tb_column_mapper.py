"""Detect trial balance columns with normalisation + alias matching."""
from __future__ import annotations

import re
from typing import Any

import pandas as pd


def _norm(name: str) -> str:
    s = str(name).strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_")


# canonical_key -> acceptable normalised aliases
_ALIASES: dict[str, list[str]] = {
    "gl_code": [
        "gl_code",
        "account_code",
        "code",
        "glcode",
        "gl",
        "acct_code",
        "accountcode",
        "acc_no",
        "account_no",
        "ledger_code",
        "acct_no",
        "a_c_code",
        "ac_code",
    ],
    "gl_description": [
        "gl_description",
        "account_name",
        "description",
        "name",
        "gl_desc",
        "accountname",
        "account_description",
        "particulars",
        "ledger_name",
        "ledger",
        "account_title",
        "title",
    ],
    "debit": [
        "debit",
        "dr",
        "debit_amount",
        "debits",
        "dr_amount",
        "debit_lakhs",
        "debit_inr_lakhs",
        "dr_amt",
        "debit_balance",
        "amount_dr",
        "dr_bal",
    ],
    "credit": [
        "credit",
        "cr",
        "credit_amount",
        "credits",
        "cr_amount",
        "credit_lakhs",
        "credit_inr_lakhs",
        "cr_amt",
        "credit_balance",
        "amount_cr",
        "cr_bal",
    ],
    "account_type": [
        "account_type",
        "accounttype",
        "type",
        "classification",
        "ifrs_category",
    ],
}

# Normalised tokens that look like column titles, not GL codes
_HEADER_CODE_TOKENS = frozenset(
    {
        "account_code",
        "gl_code",
        "code",
        "account_no",
        "acc_no",
        "ledger_code",
        "acct_code",
        "debit",
        "credit",
        "dr",
        "cr",
        "particulars",
        "description",
        "account_name",
        "ledger_name",
        "name",
        "sl_no",
        "s_no",
        "sr_no",
        "serial",
    }
)


def map_trial_balance_columns(df: pd.DataFrame) -> dict[str, str]:
    """Return canonical_key -> original dataframe column name."""
    norm_to_orig = {_norm(c): c for c in df.columns}
    mapping: dict[str, str] = {}
    for canonical, aliases in _ALIASES.items():
        for alias in aliases:
            n = _norm(alias)
            if n in norm_to_orig:
                mapping[canonical] = norm_to_orig[n]
                break
    return mapping


def _coerce_amount(val: Any) -> float:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return 0.0
    if isinstance(val, (int, float)) and not pd.isna(val):
        return float(val)
    s = str(val).strip()
    if not s or s.lower() in ("-", "nil", "na", "n/a", "--"):
        return 0.0
    s = s.replace(",", "")
    if s.startswith("(") and s.endswith(")"):
        s = "-" + s[1:-1].strip()
    try:
        return float(s)
    except ValueError:
        return 0.0


def _looks_like_header_code_cell(code: Any) -> bool:
    if code is None or (isinstance(code, float) and pd.isna(code)):
        return True
    if isinstance(code, bool):
        return False
    if isinstance(code, (int, float)):
        return False
    t = _norm(str(code))
    if not t:
        return True
    return t in _HEADER_CODE_TOKENS


_REQUIRED = ("gl_code", "gl_description", "debit", "credit")


def _missing_required_keys(colmap: dict[str, str]) -> list[str]:
    return [k for k in _REQUIRED if k not in colmap]


def trial_balance_dataframe_to_rows(
    df: pd.DataFrame, colmap: dict[str, str]
) -> tuple[list[dict[str, Any]], list[str]]:
    missing = [k for k in _REQUIRED if k not in colmap]
    if missing:
        return [], missing

    rows: list[dict[str, Any]] = []
    type_col = colmap.get("account_type")
    for _, r in df.iterrows():
        code = r[colmap["gl_code"]]
        if _looks_like_header_code_cell(code):
            continue
        desc = r[colmap["gl_description"]]
        debit = _coerce_amount(r[colmap["debit"]])
        credit = _coerce_amount(r[colmap["credit"]])
        acct_type = None
        if type_col and pd.notna(r.get(type_col)):
            raw = str(r[type_col]).strip().lower()
            acct_type = raw.replace(" ", "_")
        rows.append(
            {
                "gl_code": str(code).strip(),
                "gl_description": str(desc).strip() if pd.notna(desc) else "",
                "debit_amount": debit,
                "credit_amount": credit,
                "account_type_raw": acct_type,
            }
        )
    return rows, []


def _row_as_unique_column_names(row: pd.Series) -> list[str]:
    """Turn a header candidate row into unique, non-empty pandas column labels."""
    names: list[str] = []
    used_lower: dict[str, int] = {}
    for j, val in enumerate(row.tolist()):
        if pd.isna(val):
            s = ""
        else:
            s = str(val).strip()
        if not s or s.lower() == "nan":
            s = f"__col_{j}"
        key = s.lower()
        n = used_lower.get(key, 0)
        used_lower[key] = n + 1
        if n:
            s = f"{s}__{n}"
        names.append(s)
    return names


def resolve_trial_balance_dataframe(df: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, str]]:
    """
    If the sheet has title rows (company name, blanks) above the real TB header, pandas
    will use the wrong row as column names. Scan the first rows to find a line that maps
    to required TB columns, then rebuild the frame with that row as the header.
    """
    if df is None or df.empty:
        return df, {}

    df = df.dropna(axis=1, how="all")
    if df.empty:
        return df, {}

    cmap = map_trial_balance_columns(df)
    if not _missing_required_keys(cmap):
        return df.reset_index(drop=True), cmap

    max_scan = min(200, len(df))
    ncols = df.shape[1]
    for i in range(max_scan):
        col_names = _row_as_unique_column_names(df.iloc[i])
        if len(col_names) < ncols:
            col_names.extend(f"__pad_{k}" for k in range(len(col_names), ncols))
        col_names = col_names[:ncols]

        body = df.iloc[i + 1 :].copy()
        if body.empty:
            continue
        body.columns = col_names
        body = body.dropna(axis=1, how="all")
        body = body.reset_index(drop=True)

        cmap = map_trial_balance_columns(body)
        if _missing_required_keys(cmap):
            continue
        rows, miss = trial_balance_dataframe_to_rows(body, cmap)
        if miss or len(rows) < 1:
            continue
        return body, cmap

    return df.reset_index(drop=True), map_trial_balance_columns(df)


def _read_excel_sheets_raw(content: bytes, engine: str) -> list[tuple[str, pd.DataFrame]]:
    """All sheets with no header row — real TB header is found by resolve_trial_balance_dataframe."""
    import io

    xl = pd.ExcelFile(io.BytesIO(content), engine=engine)
    out: list[tuple[str, pd.DataFrame]] = []
    for sheet in xl.sheet_names:
        df = pd.read_excel(xl, sheet_name=sheet, header=None, dtype=object)
        out.append((sheet, df))
    return out


def load_trial_balance_dataframe(name: str, content: bytes) -> pd.DataFrame:
    """Read CSV/XLS/XLSX into a DataFrame."""
    import io

    n = (name or "trial_balance.csv").lower()
    if n.endswith(".xlsx"):
        sheets = _read_excel_sheets_raw(content, "openpyxl")
        if not sheets:
            return pd.DataFrame()
        last_df = sheets[-1][1]
        for _sheet_name, df in sheets:
            if df is None or df.empty:
                continue
            d2, cmap = resolve_trial_balance_dataframe(df)
            rows, missing = trial_balance_dataframe_to_rows(d2, cmap)
            if not missing and rows:
                return d2
            last_df = d2
        return last_df
    if n.endswith(".xls"):
        sheets = _read_excel_sheets_raw(content, "xlrd")
        if not sheets:
            return pd.DataFrame()
        last_df = sheets[-1][1]
        for _sheet_name, df in sheets:
            if df is None or df.empty:
                continue
            d2, cmap = resolve_trial_balance_dataframe(df)
            rows, missing = trial_balance_dataframe_to_rows(d2, cmap)
            if not missing and rows:
                return d2
            last_df = d2
        return last_df
    if n.endswith(".csv"):
        return pd.read_csv(io.StringIO(content.decode("utf-8", errors="replace")))
    raise ValueError("Use .csv, .xlsx, or .xls")


def load_trial_balance_dataframe_no_header(name: str, content: bytes) -> pd.DataFrame:
    import io

    bio = io.BytesIO(content)
    n = (name or "trial_balance.csv").lower()
    if n.endswith(".xlsx"):
        return pd.read_excel(bio, header=None, engine="openpyxl")
    if n.endswith(".xls"):
        return pd.read_excel(bio, header=None, engine="xlrd")
    if n.endswith(".csv"):
        return pd.read_csv(io.StringIO(content.decode("utf-8", errors="replace")), header=None)
    raise ValueError("Use .csv, .xlsx, or .xls")
