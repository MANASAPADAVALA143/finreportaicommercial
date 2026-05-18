"""
JE Data Adapter + Validator
Normalises column names from Tally, SAP, Oracle, QuickBooks etc.
into the canonical schema expected by JEAnomalyEngine.

Canonical schema columns
------------------------
journal_id      str   — unique entry identifier
posting_date    datetime64[ns]
posting_hour    int   — 0–23 (derived from posting_date if absent)
posting_dow     int   — 0=Monday…6=Sunday
account         str   — account / ledger name
amount          float — absolute value (debit+credit merged)
user_id         str   — preparer / entered-by
source          str   — "Manual" | "System" | "Interface" | "ERP"
description     str   — narration / reference
entity          str   — company / cost-centre (optional)
"""
from __future__ import annotations

import logging
import re
from typing import Any

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# ── Column alias table ────────────────────────────────────────────────────────

COLUMN_ALIASES: dict[str, list[str]] = {
    "journal_id": [
        "journal_id", "journal id", "je_id", "je id", "entry no", "entry_no",
        "voucher no", "voucher_no", "voucher number", "doc no", "document number",
        "transaction id", "txn_id", "txn id", "reference", "ref no", "ref_no",
        # SAP
        "belnr", "document number", "bukrs",
        # Oracle
        "je_header_id", "segment1",
        # QuickBooks
        "transaction type", "num",
    ],
    "posting_date": [
        "posting_date", "posting date", "date", "txn date", "transaction date",
        "value date", "entry date", "created date", "gl date", "effective date",
        # SAP
        "budat", "bldat",
        # Oracle
        "effective_date", "default_effective_date",
        # Tally
        "voucher date",
        # QuickBooks
        "date",
    ],
    "account": [
        "account", "account_code", "account code", "account name", "ledger",
        "ledger name", "gl account", "gl_account", "cost account",
        # SAP
        "hkont", "saknr",
        # Oracle
        "segment1", "account_segment",
        # Tally
        "ledger name", "particulars",
        # QuickBooks
        "account", "split",
    ],
    "amount": [
        "amount", "amt", "net amount", "net_amount", "transaction amount",
        "txn amount", "value",
        # SAP
        "dmbtr", "wrbtr",
        # Tally
        "amount",
    ],
    "debit": [
        "debit", "dr", "dr amount", "debit amount", "withdrawal",
        "debit_amount",
        # SAP
        "shkzg",       # H=credit K=debit — handled separately
        # Tally
        "debit amount",
        # Oracle
        "entered_dr",
    ],
    "credit": [
        "credit", "cr", "cr amount", "credit amount", "deposit",
        "credit_amount",
        # Oracle
        "entered_cr",
        # Tally
        "credit amount",
    ],
    "user_id": [
        "user_id", "user id", "user", "entered by", "entered_by", "preparer",
        "created by", "created_by", "posted by", "posted_by", "clerk",
        # SAP
        "usnam", "ernam",
        # Oracle
        "created_by",
        # QuickBooks
        "last modified by",
    ],
    "source": [
        "source", "source type", "source_type", "entry type", "entry_type",
        "voucher type", "voucher_type", "origin", "journal type",
        # SAP
        "blart",
        # Oracle
        "je_source",
        # Tally
        "voucher type",
        # QuickBooks
        "transaction type",
    ],
    "description": [
        "description", "narration", "particulars", "remarks", "memo",
        "reference", "details", "notes", "text",
        # SAP
        "sgtxt", "bktxt",
        # Oracle
        "description",
        # Tally
        "narration",
        # QuickBooks
        "memo",
    ],
    "entity": [
        "entity", "company", "company code", "company_code", "branch",
        "cost centre", "cost_centre", "cost center", "profit centre",
        "profit_centre", "bu", "business unit", "segment",
        # SAP
        "bukrs",
        # Oracle
        "set_of_books_id",
    ],
}


# ══════════════════════════════════════════════════════════════════════════════
# Column matcher
# ══════════════════════════════════════════════════════════════════════════════

def _match_column(raw_cols: list[str], candidates: list[str]) -> str | None:
    """Case-insensitive exact match first, then substring."""
    low_raw = [c.lower().strip() for c in raw_cols]
    # exact
    for cand in candidates:
        cl = cand.lower().strip()
        if cl in low_raw:
            return raw_cols[low_raw.index(cl)]
    # substring
    for cand in candidates:
        cl = cand.lower().strip()
        for i, col in enumerate(low_raw):
            if cl in col or col in cl:
                return raw_cols[i]
    return None


def auto_detect_columns(df: pd.DataFrame) -> dict[str, str | None]:
    """
    Pre-fill column mapping UI: returns canonical_name → detected_raw_col
    for each logical column.  Values are None when not found.
    """
    raw = list(df.columns)
    return {
        canonical: _match_column(raw, aliases)
        for canonical, aliases in COLUMN_ALIASES.items()
    }


# ══════════════════════════════════════════════════════════════════════════════
# JEDataAdapter
# ══════════════════════════════════════════════════════════════════════════════

class JEDataAdapter:
    """
    Transforms a raw DataFrame (any supported ERP format) into the canonical
    schema required by JEAnomalyEngine.
    """

    def adapt(
        self,
        df: pd.DataFrame,
        column_map: dict[str, str] | None = None,
    ) -> pd.DataFrame:
        """
        Parameters
        ----------
        df          : raw DataFrame from uploaded file
        column_map  : optional override — canonical_name → raw_col_name.
                      If None, auto-detected.

        Returns
        -------
        Normalised DataFrame with canonical columns.
        """
        raw_cols = list(df.columns)

        # Build effective map: auto-detect then override with user map
        detected = auto_detect_columns(df)
        if column_map:
            detected.update(column_map)

        rename: dict[str, str] = {v: k for k, v in detected.items() if v and v in raw_cols and v != k}
        out = df.rename(columns=rename).copy()

        # ── Date ─────────────────────────────────────────────────────────────
        if "posting_date" in out.columns:
            out["posting_date"] = self._parse_dates(out["posting_date"])
        else:
            out["posting_date"] = pd.NaT

        out = out.dropna(subset=["posting_date"])
        if out.empty:
            logger.warning("[JEAdapter] All rows dropped after date parsing")
            return out

        out["posting_hour"] = out["posting_date"].dt.hour.fillna(10).astype(int)
        out["posting_dow"]  = out["posting_date"].dt.weekday.fillna(0).astype(int)

        # ── Amount: merge debit / credit if separate ──────────────────────────
        if "amount" not in out.columns:
            if "debit" in out.columns or "credit" in out.columns:
                d = out.get("debit",  pd.Series(0.0, index=out.index)).apply(self._to_float)
                c = out.get("credit", pd.Series(0.0, index=out.index)).apply(self._to_float)
                # Use whichever is non-zero; if both, take max (split entries)
                out["amount"] = np.where(d > 0, d, c)
                out.drop(columns=["debit", "credit"], errors="ignore", inplace=True)
            else:
                out["amount"] = 0.0

        out["amount"] = out["amount"].apply(self._to_float).abs()

        # ── journal_id — synthesise if missing ───────────────────────────────
        if "journal_id" not in out.columns:
            out["journal_id"] = ["JE-" + str(i) for i in range(len(out))]
        out["journal_id"] = out["journal_id"].astype(str).str.strip()

        # ── Optional columns — fill blanks ────────────────────────────────────
        defaults: dict[str, Any] = {
            "account":     "Unknown",
            "user_id":     "Unknown",
            "source":      "ERP",
            "description": "",
            "entity":      "",
        }
        for col, default in defaults.items():
            if col not in out.columns:
                out[col] = default
            else:
                out[col] = out[col].fillna(default).astype(str).str.strip()

        # ── Deduplicate exact rows ────────────────────────────────────────────
        before = len(out)
        out = out.drop_duplicates(
            subset=["journal_id", "account", "amount", "posting_date"],
            keep="first",
        ).reset_index(drop=True)
        if len(out) < before:
            logger.info("[JEAdapter] Deduplicated %d → %d rows", before, len(out))

        # ── Filter zero-amount rows ───────────────────────────────────────────
        out = out[out["amount"] > 0].reset_index(drop=True)

        return out[
            ["journal_id", "posting_date", "posting_hour", "posting_dow",
             "account", "amount", "user_id", "source", "description", "entity"]
        ]

    @staticmethod
    def _parse_dates(series: pd.Series) -> pd.Series:
        """
        Robustly parse dates including:
        - ISO 8601
        - DD/MM/YYYY, DD-MM-YYYY
        - Excel serial integers (30000–60000)
        - Timestamps with time component
        """
        def _one(v: Any) -> pd.Timestamp:
            if pd.isna(v) or str(v).strip() in ("", "nan", "None"):
                return pd.NaT  # type: ignore[return-value]
            s = str(v).strip()
            # Excel serial
            try:
                serial = float(s.split()[0])
                if 30000 < serial < 60000:
                    import datetime as _dt
                    return pd.Timestamp(_dt.datetime(1899, 12, 30) + _dt.timedelta(days=serial))
            except (ValueError, TypeError):
                pass
            # Strip time if present
            if " " in s and len(s) > 10:
                s = s[:10]
            return pd.to_datetime(s, dayfirst=True, errors="coerce")  # type: ignore[return-value]

        return series.apply(_one)

    @staticmethod
    def _to_float(v: Any) -> float:
        if not v and v != 0:
            return 0.0
        s = str(v).strip()
        if s in ("", "-", "—", "nan", "NaN", "None"):
            return 0.0
        # Parentheses → negative (treat as debit)
        if s.startswith("(") and s.endswith(")"):
            s = s[1:-1]
        cleaned = re.sub(r"[₹$€,\s]", "", s).replace("CR", "").replace("DR", "")
        try:
            return float(cleaned)
        except ValueError:
            return 0.0


# ══════════════════════════════════════════════════════════════════════════════
# JEDataValidator
# ══════════════════════════════════════════════════════════════════════════════

class JEDataValidator:
    """
    Validates adapted DataFrames before passing to JEAnomalyEngine.
    Returns a validation report (does not raise exceptions — caller decides).
    """

    MIN_ENTRIES      = 5
    MIN_HIST_ENTRIES = 50

    def validate(
        self,
        df_current: pd.DataFrame,
        df_history: pd.DataFrame,
    ) -> dict[str, Any]:
        """
        Returns
        -------
        dict with keys:
          ok (bool)
          warnings (list[str])
          errors (list[str])
          layer_availability (dict)
          overlap_count (int)
        """
        errors:   list[str] = []
        warnings: list[str] = []

        # ── Current batch ────────────────────────────────────────────────────
        if df_current.empty:
            errors.append("Current batch is empty after parsing.")
        elif len(df_current) < self.MIN_ENTRIES:
            warnings.append(
                f"Only {len(df_current)} entries in current batch "
                f"(minimum {self.MIN_ENTRIES} recommended)."
            )

        # ── History ──────────────────────────────────────────────────────────
        hist_ok = not df_history.empty and len(df_history) >= self.MIN_HIST_ENTRIES

        if df_history.empty:
            warnings.append("No history loaded — ML and behavioral layers use batch-only mode.")
        elif len(df_history) < self.MIN_HIST_ENTRIES:
            warnings.append(
                f"History has only {len(df_history)} rows "
                f"(recommend {self.MIN_HIST_ENTRIES}+). Some ML features disabled."
            )

        # ── Overlap detection ─────────────────────────────────────────────────
        overlap_count = 0
        if not df_current.empty and not df_history.empty:
            curr_ids = set(df_current["journal_id"].astype(str))
            hist_ids = set(df_history["journal_id"].astype(str))
            overlap_count = len(curr_ids & hist_ids)
            if overlap_count > 0:
                warnings.append(
                    f"{overlap_count} entries appear in both history and current batch "
                    "(possible duplicate upload)."
                )

        # ── Date coverage ─────────────────────────────────────────────────────
        if not df_current.empty:
            months = df_current["posting_date"].dt.to_period("M").nunique()
            if months == 0:
                errors.append("Could not parse any valid posting dates.")

        hist_months = 0
        if not df_history.empty:
            hist_months = df_history["posting_date"].dt.to_period("M").nunique()
            if hist_months < 3:
                warnings.append(
                    f"History spans only {hist_months} month(s) — "
                    "drift detection and strong baselines need 3+ months."
                )

        # ── Layer availability ────────────────────────────────────────────────
        layers: dict[str, dict[str, Any]] = {
            "statistical": {
                "available": True,
                "note": "Always available (batch-only fallback)",
            },
            "ml": {
                "available": hist_ok,
                "note": (
                    "LOF + AutoEncoder enabled (history ≥ 50 rows)"
                    if hist_ok else
                    "Isolation Forest only (need 50+ history rows for LOF/AE)"
                ),
            },
            "pattern": {
                "available": True,
                "note": "Always available (structural analysis)",
            },
            "behavioral": {
                "available": hist_ok,
                "note": (
                    "Full behavioral analysis against history baseline"
                    if hist_ok else
                    "Timing flags only (no history baseline for actor comparison)"
                ),
            },
        }

        return {
            "ok":                 len(errors) == 0,
            "errors":             errors,
            "warnings":           warnings,
            "layer_availability": layers,
            "overlap_count":      overlap_count,
            "hist_months":        hist_months,
        }
