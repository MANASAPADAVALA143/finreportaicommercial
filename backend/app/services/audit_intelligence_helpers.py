"""Tabular upload parsing and run summaries for Audit Intelligence."""

from __future__ import annotations

import io
from typing import Any

import pandas as pd
from fastapi import HTTPException, UploadFile


async def read_upload_as_csv_text(upload: UploadFile, *, max_rows: int = 2000) -> tuple[str, int]:
    """Read CSV/XLSX upload; return (csv text for Claude, row count)."""
    raw = await upload.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file upload.")
    name = (upload.filename or "").lower()
    bio = io.BytesIO(raw)
    try:
        if name.endswith((".xlsx", ".xls")):
            df = pd.read_excel(bio)
        else:
            df = pd.read_csv(bio)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Could not parse file: {exc}") from exc

    n = len(df)
    if n > max_rows:
        df = df.head(max_rows)
    text = df.to_csv(index=False)
    return text, int(n)


async def read_upload_as_dataframe(upload: UploadFile, *, max_rows: int = 10000) -> tuple[pd.DataFrame, int]:
    """Read CSV/XLSX upload; return (dataframe for analysis, original row count)."""
    raw = await upload.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file upload.")
    name = (upload.filename or "").lower()
    bio = io.BytesIO(raw)
    try:
        if name.endswith((".xlsx", ".xls")):
            df = pd.read_excel(bio)
        else:
            df = pd.read_csv(bio)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Could not parse file: {exc}") from exc
    n = len(df)
    if n > max_rows:
        df = df.head(max_rows)
    return df, int(n)


def result_summary_for_agent(agent_type: str, result: dict[str, Any]) -> str:
    if result.get("_error"):
        return str(result.get("message") or result.get("_error"))
    if agent_type == "evidence-collector":
        s = result.get("audit_summary") or result.get("summary") or {}
        total = s.get("total_entries_analysed") or s.get("total_transactions") or "—"
        patterns = s.get("patterns_detected") or "—"
        high = s.get("high_risk_entries") or s.get("high_risk_count") or "—"
        return f"Analysed {total}; patterns {patterns}; high-risk {high}"
    if agent_type == "ifrs-checker":
        return f"Compliance score: {result.get('compliance_score', '—')} ({result.get('standard_checked', '')})"
    if agent_type == "controls-tester":
        return f"Control rating: {result.get('overall_control_rating', '—')}"
    if agent_type == "sox-checker":
        return f"SOX opinion: {result.get('sox_opinion', '—')}"
    if agent_type == "aml-monitor":
        s = result.get("summary") or {}
        return f"Flagged {s.get('flagged_count', '—')} / {s.get('total_scanned', '—')}; SAR {s.get('sar_required', '—')}"
    return "Completed"
