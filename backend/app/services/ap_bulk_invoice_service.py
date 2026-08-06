"""Bulk upsert AP invoices into Supabase via service role (bypasses RLS)."""

from __future__ import annotations

import logging
import re
from datetime import date, timedelta
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
    return None


def _ensure_dates(payload: dict[str, Any]) -> dict[str, Any]:
    """invoices.due_date is NOT NULL — default to invoice_date + 30 days."""
    inv_date = str(payload.get("invoice_date") or "").strip()[:10]
    if not inv_date:
        inv_date = date.today().isoformat()
        payload["invoice_date"] = inv_date
    due = str(payload.get("due_date") or "").strip()[:10]
    if not due:
        try:
            y, m, d = (int(x) for x in inv_date.split("-"))
            payload["due_date"] = (date(y, m, d) + timedelta(days=30)).isoformat()
        except ValueError:
            payload["due_date"] = (date.today() + timedelta(days=30)).isoformat()
    return payload


def _sanitize_row(row: dict[str, Any], company_id: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in row.items():
        if k in _SAFE_KEYS and v is not None and v != "":
            out[k] = v
    out["company_id"] = company_id or out.get("company_id")
    if "risk_flags" in out and isinstance(out["risk_flags"], str):
        out["risk_flags"] = []
    if "source" not in out:
        out["source"] = "excel"
    return _ensure_dates(out)


def _row_data(res: Any) -> dict[str, Any] | None:
    data = getattr(res, "data", None)
    if isinstance(data, list) and data:
        return data[0] if isinstance(data[0], dict) else None
    if isinstance(data, dict) and data.get("id"):
        return data
    return None


def _fetch_invoice(sb: Any, company_id: str, inv_no: str) -> dict[str, Any] | None:
    """Fetch without chaining .select() twice (postgrest 0.18 SyncSelectRequestBuilder)."""
    try:
        res = (
            sb.table("invoices")
            .select("*")
            .eq("invoice_number", inv_no)
            .eq("company_id", company_id)
            .limit(1)
            .execute()
        )
        return _row_data(res)
    except Exception as exc:
        logger.warning("fetch invoice %s failed: %s", inv_no, exc)
        return None


def _save_invoice(sb: Any, payload: dict[str, Any], company_id: str, inv_no: str) -> tuple[dict[str, Any] | None, str]:
    """
    Insert or update without chaining .select() after upsert.

    supabase-py 2.10 / postgrest 0.18: upsert() returns SyncQueryRequestBuilder
    which has .execute() but NOT .select() — chaining .select() raises AttributeError.
    """
    last_err = ""
    working = dict(payload)

    for _attempt in range(12):
        try:
            existing = _fetch_invoice(sb, company_id, inv_no)
            if existing and existing.get("id"):
                update_payload = {k: v for k, v in working.items() if k not in ("created_at",)}
                res = (
                    sb.table("invoices")
                    .update(update_payload)
                    .eq("id", existing["id"])
                    .execute()
                )
                saved = _row_data(res) or _fetch_invoice(sb, company_id, inv_no)
            else:
                # Prefer insert; on unique conflict fall back to upsert without .select()
                try:
                    res = sb.table("invoices").insert(working).execute()
                    saved = _row_data(res) or _fetch_invoice(sb, company_id, inv_no)
                except Exception as insert_exc:
                    msg = str(insert_exc)
                    if "duplicate" in msg.lower() or "23505" in msg:
                        res = sb.table("invoices").upsert(working, on_conflict="invoice_number").execute()
                        saved = _row_data(res) or _fetch_invoice(sb, company_id, inv_no)
                    else:
                        raise

            if saved and saved.get("id"):
                return saved, ""
            last_err = "save returned no row"
            break
        except Exception as exc:
            last_err = str(exc)
            # Never retry the broken upsert().select() pattern — strip bad columns instead
            if "has no attribute 'select'" in last_err:
                last_err = "internal: invalid supabase select chain (fixed) — retrying without select"
                # fall through to strip/retry once more with insert/update only
            stripped = _strip_unknown(working, last_err)
            if stripped is not None:
                working = _ensure_dates(stripped)
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
                "subtotal_amount",
                "invoice_language",
                "approval_level",
                "processing_time_seconds",
            ):
                if drop in working:
                    working.pop(drop, None)
                    working = _ensure_dates(working)
                    break
            else:
                break

    return None, last_err or "upsert failed"


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
        saved, last_err = _save_invoice(sb, payload, company_id, inv_no)

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


def list_invoices_for_company(
    *,
    company_id: str,
    limit: int = 500,
) -> dict[str, Any]:
    """List invoices via service role so FinReport-JWT sessions (no Supabase auth) can still see rows."""
    from app.core.supabase import get_supabase

    if not company_id:
        return {"ok": False, "invoices": [], "count": 0, "error": "company_id required"}
    sb = get_supabase()
    try:
        res = (
            sb.table("invoices")
            .select("*")
            .eq("company_id", company_id.strip())
            .order("created_at", desc=True)
            .limit(max(1, min(limit, 2000)))
            .execute()
        )
        rows = res.data if isinstance(res.data, list) else []
        return {"ok": True, "invoices": rows, "count": len(rows)}
    except Exception as exc:
        logger.exception("list invoices failed for company %s", company_id)
        return {"ok": False, "invoices": [], "count": 0, "error": str(exc)}


def get_invoice_for_match(
    *,
    company_id: str,
    invoice_id: str | None = None,
    invoice_number: str | None = None,
) -> dict[str, Any]:
    """Fetch one invoice by id, then by invoice_number — service role (bypasses RLS)."""
    from app.core.supabase import get_supabase

    cid = (company_id or "").strip()
    iid = (invoice_id or "").strip()
    ino = (invoice_number or "").strip()
    if not cid:
        return {"ok": False, "invoice": None, "error": "company_id required"}
    if not iid and not ino:
        return {"ok": False, "invoice": None, "error": "invoice_id or invoice_number required"}

    sb = get_supabase()
    try:
        if iid:
            res = (
                sb.table("invoices")
                .select("*")
                .eq("company_id", cid)
                .eq("id", iid)
                .limit(1)
                .execute()
            )
            rows = res.data if isinstance(res.data, list) else []
            if rows:
                return {"ok": True, "invoice": rows[0]}

        if ino:
            res = (
                sb.table("invoices")
                .select("*")
                .eq("company_id", cid)
                .ilike("invoice_number", ino)
                .limit(1)
                .execute()
            )
            rows = res.data if isinstance(res.data, list) else []
            if rows:
                return {"ok": True, "invoice": rows[0]}

        return {"ok": False, "invoice": None, "error": "Invoice not found"}
    except Exception as exc:
        logger.exception("get_invoice_for_match failed company=%s id=%s no=%s", cid, iid, ino)
        return {"ok": False, "invoice": None, "error": str(exc)}


_PATCH_SAFE_KEYS = {
    "po_id",
    "grn_id",
    "po_number",
    "match_status",
    "match_score",
    "match_notes",
    "match_result_id",
    "auto_matched",
    "match_attempted_at",
    "grn_confirmed",
    "match_difference",
    "match_percentage",
    "po_amount",
    "grn_amount",
    "approval_status",
    "status",
    "approved_at",
    "approved_by",
    "updated_at",
}


def patch_invoice_for_match(
    *,
    company_id: str,
    invoice_id: str,
    fields: dict[str, Any],
) -> dict[str, Any]:
    """Update match fields on an invoice via service role."""
    from app.core.supabase import get_supabase

    cid = (company_id or "").strip()
    iid = (invoice_id or "").strip()
    if not cid or not iid:
        return {"ok": False, "error": "company_id and invoice_id required"}

    payload = {k: v for k, v in (fields or {}).items() if k in _PATCH_SAFE_KEYS}
    if not payload:
        return {"ok": False, "error": "no patchable fields"}
    payload["updated_at"] = payload.get("updated_at") or (
        __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
    )

    sb = get_supabase()
    try:
        res = (
            sb.table("invoices")
            .update(payload)
            .eq("company_id", cid)
            .eq("id", iid)
            .execute()
        )
        rows = res.data if isinstance(res.data, list) else []
        return {"ok": True, "invoice": rows[0] if rows else None}
    except Exception as exc:
        logger.exception("patch_invoice_for_match failed %s", iid)
        return {"ok": False, "error": str(exc)}


def list_purchase_orders_for_company(
    *,
    company_id: str,
    limit: int = 500,
) -> dict[str, Any]:
    from app.core.supabase import get_supabase

    cid = (company_id or "").strip()
    if not cid:
        return {"ok": False, "purchase_orders": [], "error": "company_id required"}
    sb = get_supabase()
    try:
        res = (
            sb.table("purchase_orders")
            .select("*")
            .eq("company_id", cid)
            .order("created_at", desc=True)
            .limit(max(1, min(limit, 2000)))
            .execute()
        )
        rows = res.data if isinstance(res.data, list) else []
        return {"ok": True, "purchase_orders": rows, "count": len(rows)}
    except Exception as exc:
        logger.exception("list_purchase_orders failed for %s", cid)
        return {"ok": False, "purchase_orders": [], "error": str(exc)}


def list_goods_receipts_for_company(
    *,
    company_id: str,
    po_id: str | None = None,
    limit: int = 500,
) -> dict[str, Any]:
    from app.core.supabase import get_supabase

    cid = (company_id or "").strip()
    if not cid:
        return {"ok": False, "goods_receipts": [], "error": "company_id required"}
    sb = get_supabase()
    try:
        q = (
            sb.table("goods_receipts")
            .select("*, grn_line_items(*)")
            .eq("company_id", cid)
            .order("received_date", desc=True)
            .limit(max(1, min(limit, 2000)))
        )
        if (po_id or "").strip():
            q = q.eq("po_id", po_id.strip())
        res = q.execute()
        rows = res.data if isinstance(res.data, list) else []
        return {"ok": True, "goods_receipts": rows, "count": len(rows)}
    except Exception as exc:
        # Fallback without nested line items if relation name differs
        try:
            q2 = sb.table("goods_receipts").select("*").eq("company_id", cid).limit(max(1, min(limit, 2000)))
            if (po_id or "").strip():
                q2 = q2.eq("po_id", po_id.strip())
            res2 = q2.execute()
            rows2 = res2.data if isinstance(res2.data, list) else []
            return {"ok": True, "goods_receipts": rows2, "count": len(rows2)}
        except Exception as exc2:
            logger.exception("list_goods_receipts failed for %s", cid)
            return {"ok": False, "goods_receipts": [], "error": str(exc2) or str(exc)}


def insert_match_result(row: dict[str, Any]) -> dict[str, Any]:
    from app.core.supabase import get_supabase

    sb = get_supabase()
    try:
        res = sb.table("match_results").insert(row).execute()
        rows = res.data if isinstance(res.data, list) else []
        return {"ok": True, "id": (rows[0] or {}).get("id") if rows else None}
    except Exception as exc:
        logger.warning("match_results insert failed: %s", exc)
        return {"ok": False, "error": str(exc)}
