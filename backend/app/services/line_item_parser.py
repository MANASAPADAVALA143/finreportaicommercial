"""
Parse simplified management P&L uploads into a standard metrics dict.

Used by Earnings Reviewer and related IFRS management reporting flows.
"""

from __future__ import annotations

import io
import re
from typing import Any

import pandas as pd


def parse_numeric(v: Any) -> float:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    for ch in "₹$€£,\u00a0 ":
        s = s.replace(ch, "")
    s = s.replace("(", "-").replace(")", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


class LineItemParser:
    """Extract headline P&L metrics from loosely formatted management accounts."""

    _REV = re.compile(r"\b(revenue|turnover|sales|income from operations)\b", re.I)
    _GP = re.compile(r"gross\s*profit", re.I)
    _EBITDA = re.compile(r"\bebitda\b", re.I)
    _EBIT = re.compile(r"\bebit\b|operating\s*profit", re.I)
    _PBT = re.compile(r"profit\s*before\s*tax|pbt\b", re.I)
    _TAX = re.compile(r"tax\s*expense|income\s*tax|taxation", re.I)
    _NET = re.compile(
        r"net\s*income|profit\s*after\s*tax|pat\b|net\s*profit|comprehensive.*attributable",
        re.I,
    )
    _EPS = re.compile(r"\beps\b|earnings\s*per\s*share", re.I)

    @classmethod
    def read_dataframe(cls, content: bytes, filename: str) -> pd.DataFrame:
        fn = (filename or "").lower()
        bio = io.BytesIO(content)
        if fn.endswith((".xlsx", ".xls")):
            df = pd.read_excel(bio, engine="openpyxl")
        else:
            df = pd.read_csv(io.BytesIO(content))
        df.columns = [str(c).strip() for c in df.columns]
        return df

    @classmethod
    def parse_pl_to_metrics(cls, content: bytes, filename: str) -> dict[str, Any]:
        df = cls.read_dataframe(content, filename)
        if df.empty:
            raise ValueError("File is empty")

        cols_lower = {c: c.lower().replace(" ", "_") for c in df.columns}
        label_col = None
        for c, cl in cols_lower.items():
            if cl in ("metric", "line", "line_item", "item", "description", "account", "name", "label", "pl_line"):
                label_col = c
                break
        if not label_col:
            for c, cl in cols_lower.items():
                if any(x in cl for x in ("metric", "item", "description", "line")):
                    label_col = c
                    break
        if not label_col and len(df.columns) >= 2:
            label_col = df.columns[0]

        val_cols = [c for c in df.columns if c != label_col and c.lower() not in ("unit", "note", "notes")]
        if not val_cols:
            raise ValueError("No amount column found; expected a value column next to line labels.")

        amount_col = None
        for key in ("amount", "actual", "value", "current", "ytd", "total"):
            for c in val_cols:
                if c.lower() == key:
                    amount_col = c
                    break
            if amount_col:
                break
        if not amount_col:
            amount_col = val_cols[0]

        revenue = 0.0
        gross_profit = 0.0
        ebitda = 0.0
        ebit = 0.0
        pbt = 0.0
        tax = 0.0
        net_income = 0.0
        eps: float | None = None
        revenue_segments: dict[str, float] = {}

        for _, row in df.iterrows():
            label = str(row.get(label_col, "")).strip()
            if not label or label.lower() in ("total", "nan", "none"):
                continue
            val = parse_numeric(row.get(amount_col, 0))
            low = label.lower()

            if "segment" in low or "region" in low or "division" in low:
                if cls._REV.search(label) or "revenue" in low:
                    revenue_segments[label[:80]] = val
                continue

            if cls._EPS.search(label):
                eps = val
            elif cls._NET.search(label) and "comprehensive" not in low:
                net_income = val
            elif cls._TAX.search(label) and "deferred" not in low:
                tax = val
            elif cls._PBT.search(label):
                pbt = val
            elif cls._EBITDA.search(label):
                ebitda = val
            elif cls._EBIT.search(label) and "ebitda" not in low:
                ebit = val
            elif cls._GP.search(label) and "margin" not in low:
                gross_profit = val
            elif cls._REV.search(label) or (low in ("revenue", "turnover", "sales") and len(label) < 40):
                revenue = val

        if revenue == 0.0 and gross_profit == 0.0:
            for _, row in df.iterrows():
                v = parse_numeric(row.get(amount_col, 0))
                if v != 0:
                    revenue = v
                    break

        def _safe_pct(num: float, den: float) -> float:
            if den and abs(den) > 1e-9:
                return 100.0 * num / den
            return 0.0

        gross_margin_pct = _safe_pct(gross_profit, revenue)
        ebitda_margin_pct = _safe_pct(ebitda, revenue)
        ebit_margin_pct = _safe_pct(ebit, revenue)
        pbt_margin_pct = _safe_pct(pbt, revenue)
        net_margin_pct = _safe_pct(net_income, revenue)

        return {
            "revenue": revenue,
            "gross_profit": gross_profit,
            "gross_margin_pct": gross_margin_pct,
            "ebitda": ebitda,
            "ebitda_margin_pct": ebitda_margin_pct,
            "ebit": ebit,
            "ebit_margin_pct": ebit_margin_pct,
            "pbt": pbt,
            "pbt_margin_pct": pbt_margin_pct,
            "tax_expense": tax,
            "net_income": net_income,
            "net_margin_pct": net_margin_pct,
            "eps": eps,
            "revenue_segments": revenue_segments,
        }
