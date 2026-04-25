"""Option A — single TB file with Year / fiscal_year column → one TrialBalance per year (additive)."""
from __future__ import annotations

import re
from datetime import date
from pathlib import Path
from typing import Any, Optional

import pandas as pd
from sqlalchemy.orm import Session

from app.models.ifrs_statement import TBStatus, TrialBalance, TrialBalanceLine
from app.services.gl_mapping_ai import infer_account_type
from app.services.tb_column_mapper import (
    load_trial_balance_dataframe,
    resolve_trial_balance_dataframe,
    trial_balance_dataframe_to_rows,
)


def _safe_filename(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", name)[:200] or "upload"


def _parse_year(val: Any) -> int | None:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    if isinstance(val, (int, float)) and not pd.isna(val):
        y = int(val)
        return y if 1900 <= y <= 2100 else None
    s = str(val).strip()
    if not s:
        return None
    m = re.search(r"(20\d{2}|19\d{2})", s)
    if m:
        return int(m.group(1))
    try:
        y = int(float(s))
        return y if 1900 <= y <= 2100 else None
    except ValueError:
        return None


def upload_multi_year_trial_balance(
    db: Session,
    *,
    tenant_id: str,
    filename: str,
    file_bytes: bytes,
    company_name: str,
    currency: Optional[str] = None,
) -> dict[str, Any]:
    """
    Split rows by fiscal year column; create one TrialBalance per distinct year.
    Returns trial_balance_ids per year (ascending). Caller may queue AI mapping per id.
    """
    df = load_trial_balance_dataframe(filename, file_bytes)
    df, colmap = resolve_trial_balance_dataframe(df)
    if "fiscal_year" not in colmap:
        raise ValueError(
            "Multi-year upload requires a Year column (e.g. Year, FY, fiscal_year). "
            "Use standard single-year upload if you only have one period."
        )
    ycol = colmap["fiscal_year"]
    work = df.copy()
    work["_fy"] = work[ycol].map(_parse_year)
    work = work[work["_fy"].notna()]
    if work.empty:
        raise ValueError("No valid fiscal years found in Year column.")

    cur = (currency or "USD").strip().upper()[:8]
    upload_root = Path(__file__).resolve().parents[2] / "uploads" / "trial_balance" / tenant_id
    upload_root.mkdir(parents=True, exist_ok=True)

    created: list[dict[str, Any]] = []
    for year, group in work.groupby("_fy", sort=True):
        y_int = int(year)
        sub = group.drop(columns=["_fy"])
        rows, missing = trial_balance_dataframe_to_rows(sub, colmap)
        if missing or not rows:
            continue
        period_start = date(y_int, 1, 1)
        period_end = date(y_int, 12, 31)
        tb = TrialBalance(
            tenant_id=tenant_id,
            company_name=company_name,
            period_start=period_start,
            period_end=period_end,
            currency=cur,
            uploaded_by="multi_year_upload",
            status=TBStatus.uploaded,
            file_name=f"{y_int}_{filename}",
            file_path=None,
        )
        db.add(tb)
        db.flush()
        rel_path = upload_root / f"{tb.id}_{y_int}_{_safe_filename(filename)}"
        rel_path.write_bytes(file_bytes)
        tb.file_path = str(rel_path)
        for r in rows:
            net = float(r["debit_amount"]) - float(r["credit_amount"])
            acct = infer_account_type(
                float(r["debit_amount"]),
                float(r["credit_amount"]),
                r.get("account_type_raw"),
            )
            db.add(
                TrialBalanceLine(
                    trial_balance_id=tb.id,
                    tenant_id=tenant_id,
                    gl_code=r["gl_code"],
                    gl_description=r["gl_description"],
                    debit_amount=float(r["debit_amount"]),
                    credit_amount=float(r["credit_amount"]),
                    net_amount=net,
                    account_type=acct,
                )
            )
        db.commit()
        db.refresh(tb)
        created.append({"fiscal_year": y_int, "trial_balance_id": tb.id, "lines_count": len(rows)})

    if not created:
        raise ValueError("No trial balance rows could be built per year.")

    return {
        "trial_balances": created,
        "message": "Created one TB per fiscal year; map each TB (or start agentic on latest year with prior IDs).",
    }
