"""Bulk upsert AP invoices into Supabase via service role (bypasses RLS)."""

from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

# Columns commonly present on public.invoices — extras are stripped on error.
_SAFE_KEYS = {
    "company_id",
    "invoice_number",
    "invoice_date",
    "due_date",
    "vendor_name",
    "vendor_email",
    "vendor_phone",
    "vendor_address",
    "vendor_trn",
    "gstin",
    "total_amount",
    "subtotal_amount",
    "tax_amount",
    "tax_type",
    "tax_rate",
    "vat_amount",
    "vat_rate",
    "vat_treatment",
    "currency",
    "exchange_rate_to_base",
    "status",
    "description",
    "po_number",
    "invoice_language",
    "approval_level",
    "approved_by",
    "approved_at",
    "processing_time_seconds",
    "risk_flags",
    "risk_score",
    "risk_level",
    "gulftax_decision",
    "gulftax_risk_score",
    "gulftax_confidence",
    "ifrs_category",
    "ifrs_confidence",
    "ifrs_explanation",
    "source",
    "updated_at",
    "created_at",
}


def _strip_unknown(payload: dict[str, Any], err_msg: str) -> dict[str, Any] | None:
    m = re.search(r"Could not find the '([^']+)' column", err_msg or "")
    if m and m.group(1) in payload:
        out = dict(payload)
        out.pop(m.group(1), None)
        return out
    # Also strip keys not in safe set as a fallback
    return None


def _sanitize_row(row: dict[str, Any], company_id: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in row.items():
        if k in _SAFE_KEYS and v is not None:
            out[k] = v
    out["company_id"] = company_id or out.get("company_id")
    if "risk_flags" in out and isinstance(out["risk_flags"], str):
        out["risk_flags"] = []
    if "source" not in out:
        out["source"] = "excel"
    return out


def bulk_upsert_invoices(
    *,
    company_id: str,
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """Upsert many invoice rows with service role. Returns per-row results."""
    from app.core.supabase import get_supabase

    if not company_id:
        return {"ok": False, "success": 0, "failed": len(rows), "error": "company_id required", "results": []}
    if not rows:
        return {"ok": True, "success": 0, "failed": 0, "results": []}

    sb = get_supabase()
    success = 0
    failed = 0
    results: list[dict[str, Any]] = []

    for idx, raw in enumerate(rows):
        payload = _sanitize_row(dict(raw or {}), company_id)
        inv_no = str(payload.get("invoice_number") or f"row-{idx + 1}")
        last_err = ""
        saved: dict[str, Any] | None = None

        for _attempt in range(12):
            try:
                # supabase-py 2.x: do not chain .select() after upsert()
                res = sb.table("invoices").upsert(payload, on_conflict="invoice_number").execute()
                data = res.data
                if isinstance(data, list) and data:
                    saved = data[0]
                elif isinstance(data, dict):
                    saved = data
                if saved:
                    break
                fetch = (
                    sb.table("invoices")
                    .select("*")
                    .eq("invoice_number", inv_no)
                    .eq("company_id", company_id)
                    .limit(1)
                    .execute()
                )
                if fetch.data:
                    saved = fetch.data[0]
                    break
                last_err = "upsert returned no row"
                break
            except Exception as exc:
                last_err = str(exc)
                stripped = _strip_unknown(payload, last_err)
                if stripped is not None:
                    payload = stripped
                    continue
                for drop in (
                    "gulftax_decision",
                    "gulftax_risk_score",
                    "gulftax_confidence",
                    "vendor_trn",
                    "vat_treatment",
                    "vat_rate",
                    "vat_amount",
                    "source",
                    "ifrs_explanation",
                    "exchange_rate_to_base",
                ):
                    if drop in payload:
                        payload.pop(drop, None)
                        break
                else:
                    break

        if saved and saved.get("id"):
            success += 1
            results.append(
                {
                    "ok": True,
                    "invoice_number": inv_no,
                    "id": saved.get("id"),
                    "invoice": saved,
                }
            )
        else:
            failed += 1
            results.append(
                {
                    "ok": False,
                    "invoice_number": inv_no,
                    "error": last_err or "upsert failed",
                }
            )
            logger.warning("bulk upsert failed for %s: %s", inv_no, last_err)

    return {
        "ok": failed == 0,
        "success": success,
        "failed": failed,
        "results": results,
    }
