"""
FP&A Master Upload — POST /api/fpa/upload-master
==================================================
Accept ONE CSV or Excel file → parse section column → store in fpa_master_data.

Section routing:
  PL  → Variance Analysis, Budget Management, Forecasting, Scenario, 3-Statement
  BS  → Balance Sheet (3-Statement, KPI Dashboard)
  HC  → Headcount Planning
  ARR → ARR Dashboard

Column spec (case-insensitive, flexible):
  section, account_code, account_name, account_type, category,
  department, owner,
  jan_act..dec_act  (monthly actuals)
  jan_bud..dec_bud  (monthly budgets)
  fy2024_actual | fy_prior | prior_year,
  opening_cash,
  currency,
  fiscal_year,
  notes
"""
from __future__ import annotations

import io
import json
import uuid
from typing import Annotated

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.fpa_master import FpaMasterRow

router = APIRouter(prefix="/api/fpa", tags=["FP&A Master Upload"])

# ── Month column aliases ──────────────────────────────────────────────────────

MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun",
               "jul", "aug", "sep", "oct", "nov", "dec"]

# Patterns that map to each month index (0-based) for actuals
ACT_PATTERNS: list[list[str]] = [
    ["jan_act", "jan_actual", "actual_jan", "act_jan", "january_actual"],
    ["feb_act", "feb_actual", "actual_feb", "act_feb", "february_actual"],
    ["mar_act", "mar_actual", "actual_mar", "act_mar", "march_actual"],
    ["apr_act", "apr_actual", "actual_apr", "act_apr", "april_actual"],
    ["may_act", "may_actual", "actual_may", "act_may"],
    ["jun_act", "jun_actual", "actual_jun", "act_jun", "june_actual"],
    ["jul_act", "jul_actual", "actual_jul", "act_jul", "july_actual"],
    ["aug_act", "aug_actual", "actual_aug", "act_aug", "august_actual"],
    ["sep_act", "sep_actual", "actual_sep", "act_sep", "september_actual"],
    ["oct_act", "oct_actual", "actual_oct", "act_oct", "october_actual"],
    ["nov_act", "nov_actual", "actual_nov", "act_nov", "november_actual"],
    ["dec_act", "dec_actual", "actual_dec", "act_dec", "december_actual"],
]

BUD_PATTERNS: list[list[str]] = [
    ["jan_bud", "jan_budget", "budget_jan", "bud_jan"],
    ["feb_bud", "feb_budget", "budget_feb", "bud_feb"],
    ["mar_bud", "mar_budget", "budget_mar", "bud_mar"],
    ["apr_bud", "apr_budget", "budget_apr", "bud_apr"],
    ["may_bud", "may_budget", "budget_may", "bud_may"],
    ["jun_bud", "jun_budget", "budget_jun", "bud_jun"],
    ["jul_bud", "jul_budget", "budget_jul", "bud_jul"],
    ["aug_bud", "aug_budget", "budget_aug", "bud_aug"],
    ["sep_bud", "sep_budget", "budget_sep", "bud_sep"],
    ["oct_bud", "oct_budget", "budget_oct", "bud_oct"],
    ["nov_bud", "nov_budget", "budget_nov", "bud_nov"],
    ["dec_bud", "dec_budget", "budget_dec", "bud_dec"],
]

# Quarterly pattern → 3 months each (calendar year Q1=Jan-Mar)
QACT_PATTERNS = [
    (["q1_act", "q1_actual", "q1 actual", "act_q1"], [0, 1, 2]),
    (["q2_act", "q2_actual", "q2 actual", "act_q2"], [3, 4, 5]),
    (["q3_act", "q3_actual", "q3 actual", "act_q3"], [6, 7, 8]),
    (["q4_act", "q4_actual", "q4 actual", "act_q4"], [9, 10, 11]),
]

QBUD_PATTERNS = [
    (["q1_bud", "q1_budget", "q1 budget", "bud_q1"], [0, 1, 2]),
    (["q2_bud", "q2_budget", "q2 budget", "bud_q2"], [3, 4, 5]),
    (["q3_bud", "q3_budget", "q3 budget", "bud_q3"], [6, 7, 8]),
    (["q4_bud", "q4_budget", "q4 budget", "bud_q4"], [9, 10, 11]),
]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _norm(s: str) -> str:
    return str(s).strip().lower().replace(" ", "_").replace("-", "_")


def _pn(val) -> float:
    try:
        if val is None or (isinstance(val, float) and pd.isna(val)):
            return 0.0
        return float(str(val).replace(",", "").replace(" ", "") or 0)
    except Exception:
        return 0.0


def _find_col(cols_norm: list[str], patterns: list[str]) -> str | None:
    for p in patterns:
        if p in cols_norm:
            return p
    return None


def _extract_monthly(row: dict, patterns_list: list[list[str]]) -> list[float]:
    vals = [0.0] * 12
    for i, pats in enumerate(patterns_list):
        for p in pats:
            if p in row:
                vals[i] = _pn(row[p])
                break
    return vals


def _extract_quarterly(row: dict, q_patterns: list, monthly: list[float]) -> list[float]:
    """Fill monthly from quarterly columns if monthly is all zeros."""
    if any(v != 0 for v in monthly):
        return monthly
    result = monthly[:]
    for pats, month_idxs in q_patterns:
        for p in pats:
            if p in row:
                val = _pn(row[p]) / 3  # spread equally across 3 months
                for mi in month_idxs:
                    result[mi] = val
                break
    return result


def _annual_to_monthly(row: dict, monthly: list[float]) -> list[float]:
    """If monthly still all zero, try annual columns and spread evenly."""
    if any(v != 0 for v in monthly):
        return monthly
    for key in ["annual_budget", "annual_actual", "fy_budget", "fy_actual", "annual", "total"]:
        if key in row:
            val = _pn(row[key])
            if val:
                return [val / 12] * 12
    return monthly


def _parse_df(df: pd.DataFrame, company_id: str, upload_id: str) -> list[FpaMasterRow]:
    # Normalise column names
    col_map = {c: _norm(c) for c in df.columns}
    df = df.rename(columns=col_map)
    cols = list(df.columns)

    # Identify key columns
    name_col  = next((c for c in cols if _norm(c) in ["account_name", "account", "name", "line_item", "category", "description"]), cols[0])
    code_col  = next((c for c in cols if _norm(c) in ["account_code", "code", "acc_code"]), None)
    sect_col  = next((c for c in cols if _norm(c) in ["section", "module", "type_section"]), None)
    type_col  = next((c for c in cols if _norm(c) in ["account_type", "type", "acc_type"]), None)
    cat_col   = next((c for c in cols if _norm(c) in ["category", "cat"]), None)
    dept_col  = next((c for c in cols if _norm(c) in ["department", "dept"]), None)
    owner_col = next((c for c in cols if _norm(c) in ["owner", "responsible", "manager"]), None)
    cur_col   = next((c for c in cols if _norm(c) in ["currency", "ccy"]), None)
    fy_col    = next((c for c in cols if _norm(c) in ["fiscal_year", "fy", "year"]), None)
    prior_col = next((c for c in cols if _norm(c) in ["fy2024_actual", "fy_prior", "prior_year", "fy2024", "fy24"]), None)
    cash_col  = next((c for c in cols if _norm(c) in ["opening_cash", "cash", "opening_balance"]), None)
    notes_col = next((c for c in cols if _norm(c) in ["notes", "note", "comments"]), None)

    rows_out: list[FpaMasterRow] = []
    for _, row in df.iterrows():
        row_d = {k: row[k] for k in cols}

        name = str(row_d.get(name_col, "") or "").strip()
        if not name or name.lower() in {"nan", "none", ""}:
            continue

        # Section detection
        if sect_col:
            section = str(row_d.get(sect_col, "PL") or "PL").strip().upper()
        else:
            # Infer from account_type or name
            atype = str(row_d.get(type_col, "") or "").lower()
            if any(k in atype for k in ["asset", "liabilit", "equity"]):
                section = "BS"
            elif any(k in atype for k in ["headcount", "hc", "employee"]):
                section = "HC"
            elif any(k in atype for k in ["arr", "mrr", "churn"]):
                section = "ARR"
            else:
                section = "PL"  # income, revenue, expense, cogs, opex, operating expenses → PL

        currency = str(row_d.get(cur_col, "AED") or "AED").strip().upper() if cur_col else "AED"
        fiscal_year = str(row_d.get(fy_col, "FY2025") or "FY2025").strip() if fy_col else "FY2025"

        # Monthly actuals
        actuals = _extract_monthly(row_d, ACT_PATTERNS)
        actuals = _extract_quarterly(row_d, QACT_PATTERNS, actuals)
        actuals = _annual_to_monthly(row_d, actuals)

        # Monthly budgets
        budgets = _extract_monthly(row_d, BUD_PATTERNS)
        budgets = _extract_quarterly(row_d, QBUD_PATTERNS, budgets)
        if all(v == 0 for v in budgets) and any(v != 0 for v in actuals):
            # Fall back: use actuals as budget when budget columns missing
            budgets = actuals[:]

        rows_out.append(FpaMasterRow(
            upload_id      = upload_id,
            section        = section,
            currency       = currency,
            fiscal_year    = fiscal_year,
            account_code   = str(row_d.get(code_col, "") or "")[:32] if code_col else None,
            account_name   = name[:255],
            account_type   = str(row_d.get(type_col, "") or "")[:32] if type_col else None,
            category       = str(row_d.get(cat_col, "") or "")[:128] if cat_col else None,
            department     = str(row_d.get(dept_col, "") or "")[:128] if dept_col else None,
            owner          = str(row_d.get(owner_col, "") or "")[:128] if owner_col else None,
            monthly_actuals  = json.dumps(actuals),
            monthly_budgets  = json.dumps(budgets),
            fy_prior_actual  = _pn(row_d.get(prior_col)) if prior_col else 0.0,
            opening_cash     = _pn(row_d.get(cash_col)) if cash_col else 0.0,
            notes            = str(row_d.get(notes_col, "") or "")[:500] if notes_col else None,
            company_id       = company_id,
        ))
    return rows_out


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/upload-master", summary="Upload master FP&A file (one file → all modules)")
async def upload_master(
    file: UploadFile = File(...),
    company_id: str = Form(default="default"),
    replace_existing: bool = Form(default=True),
    db: Session = Depends(get_db),
):
    """
    Upload ONE CSV or Excel file that feeds ALL FP&A modules.

    The file must have a `section` column (PL | BS | HC | ARR).
    Monthly actuals: jan_act..dec_act  or  q1_act..q4_act
    Monthly budgets: jan_bud..dec_bud  or  q1_bud..q4_bud

    On success returns section counts and a summary for the UI banner.
    """
    raw = await file.read()
    filename = file.filename or ""

    try:
        if filename.lower().endswith((".xlsx", ".xls")):
            df = pd.read_excel(io.BytesIO(raw), dtype=str)
        else:
            for enc in ("utf-8", "utf-8-sig", "latin-1"):
                try:
                    df = pd.read_csv(io.StringIO(raw.decode(enc)), dtype=str)
                    break
                except Exception:
                    continue
            else:
                raise HTTPException(400, "Could not decode CSV — try UTF-8 encoding.")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, f"Could not parse file: {exc}")

    df = df.dropna(how="all")
    if df.empty:
        raise HTTPException(400, "File is empty after removing blank rows.")

    upload_id = str(uuid.uuid4())
    rows = _parse_df(df, company_id, upload_id)

    if not rows:
        raise HTTPException(422, "No valid data rows found. Check the file has an account_name/line_item column and at least one numeric column.")

    # Optionally delete previous upload for this company
    if replace_existing:
        db.query(FpaMasterRow).filter(FpaMasterRow.company_id == company_id).delete()

    db.add_all(rows)
    db.commit()

    # Section summary
    section_counts: dict[str, int] = {}
    for r in rows:
        section_counts[r.section] = section_counts.get(r.section, 0) + 1

    currencies = list({r.currency for r in rows})

    return {
        "ok": True,
        "upload_id": upload_id,
        "total_rows": len(rows),
        "section_counts": section_counts,
        "currencies": currencies,
        "message": (
            f"Master upload complete — "
            + ", ".join(f"{v} {k} rows" for k, v in sorted(section_counts.items()))
        ),
    }


@router.get("/master-data", summary="Retrieve parsed master FP&A data by section")
def get_master_data(
    section: str | None = None,
    currency: str | None = None,
    company_id: str = "default",
    db: Session = Depends(get_db),
):
    """
    Return all rows for a given section / currency.
    Used by module frontends instead of their own upload endpoints.
    """
    q = db.query(FpaMasterRow).filter(FpaMasterRow.company_id == company_id)
    if section:
        q = q.filter(FpaMasterRow.section == section.upper())
    if currency:
        q = q.filter(FpaMasterRow.currency == currency.upper())
    rows = q.order_by(FpaMasterRow.id).all()

    if not rows:
        return {"rows": [], "section": section, "count": 0}

    result = [r.to_dict() for r in rows]

    # Build summary for PL section
    if section and section.upper() == "PL":
        INCOME_TYPES  = {"income", "revenue", "income tax exempt", "other income"}
        EXPENSE_TYPES = {"expense", "expenses", "cogs", "cost of revenue", "cost of goods sold",
                         "operating expenses", "opex", "income tax", "finance costs", "cost"}
        income = [r for r in rows if (r.account_type or "").strip().lower() in INCOME_TYPES
                  or any(k in (r.account_name or "").lower() for k in ("revenue", "income", "sales", "license", "service", "subscription"))]
        expense = [r for r in rows if (r.account_type or "").strip().lower() in EXPENSE_TYPES
                   or any(k in (r.account_name or "").lower() for k in ("cost", "expense", "salary", "cloud", "infra", "marketing", "admin", "depreciation", "staff", "overhead"))]
        total_rev  = sum(r.annual_actual for r in income)
        total_exp  = sum(r.annual_actual for r in expense)
        budget_rev = sum(r.annual_budget for r in income)
        budget_exp = sum(r.annual_budget for r in expense)
        return {
            "rows": result,
            "section": section,
            "count": len(result),
            "summary": {
                "total_revenue_actual": total_rev,
                "total_expenses_actual": total_exp,
                "net_profit_actual": total_rev - total_exp,
                "ebitda_actual": (total_rev - total_exp) * 1.15,
                "total_revenue_budget": budget_rev,
                "total_expenses_budget": budget_exp,
                "net_profit_budget": budget_rev - budget_exp,
            },
        }

    return {"rows": result, "section": section, "count": len(result)}


@router.get("/master-status", summary="Check if master data has been uploaded")
def master_status(
    company_id: str = "default",
    db: Session = Depends(get_db),
):
    """Quick status check for the UI upload button."""
    rows = db.query(FpaMasterRow).filter(FpaMasterRow.company_id == company_id).all()
    if not rows:
        return {"uploaded": False, "message": "No master data uploaded yet."}
    counts: dict[str, int] = {}
    for r in rows:
        counts[r.section] = counts.get(r.section, 0) + 1
    currencies = list({r.currency for r in rows})
    latest = max(r.uploaded_at for r in rows if r.uploaded_at)
    return {
        "uploaded": True,
        "total_rows": len(rows),
        "section_counts": counts,
        "currencies": currencies,
        "last_uploaded": latest.isoformat() if latest else None,
        "message": ", ".join(f"{v} {k} rows" for k, v in sorted(counts.items())),
    }
