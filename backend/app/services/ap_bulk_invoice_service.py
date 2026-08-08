"""Bulk upsert AP invoices into Supabase via service role (bypasses RLS)."""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta, timezone
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
    "gl_code",
    "gl_name",
    "gl_account_code",
    "gl_account_name",
    "gl_account_type",
    "property_ref",
    "cost_center",
    "department",
    "project_code",
    "po_id",
    "grn_id",
    "match_status",
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


_GL_PROPERTY_MAP = {
    "6800": "Emaar Business Bay Office",
    "6400": "All Properties",
    "6200": "Head Office",
    "6600": "Operations",
    "6500": "Corporate",
    "6300": "Head Office",
    "6100": "Corporate",
    "1500": "IT Infrastructure",
    "1510": "IT Infrastructure",
}


def property_from_gl_code(gl_code: Any) -> str | None:
    digits = "".join(ch for ch in str(gl_code or "") if ch.isdigit())
    if not digits:
        return None
    if digits in _GL_PROPERTY_MAP:
        return _GL_PROPERTY_MAP[digits]
    if len(digits) >= 4 and digits[:4] in _GL_PROPERTY_MAP:
        return _GL_PROPERTY_MAP[digits[:4]]
    return None


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
    existing_prop = str(out.get("property_ref") or "").strip()
    if not existing_prop:
        derived = property_from_gl_code(out.get("gl_account_code") or out.get("gl_code"))
        if derived:
            out["property_ref"] = derived
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


_PO_ALLOWED = {
    "po_number",
    "vendor_name",
    "po_amount",
    "po_date",
    "delivery_date",
    "description",
    "notes",
    "status",
    "currency",
    "line_items",
}


def _sanitize_po_row(raw: dict[str, Any], company_id: str) -> dict[str, Any]:
    out: dict[str, Any] = {"company_id": company_id}
    for k, v in (raw or {}).items():
        if k in _PO_ALLOWED:
            out[k] = v
    po_no = str(out.get("po_number") or "").strip()
    out["po_number"] = po_no
    if "vendor_name" in out and out["vendor_name"] is not None:
        out["vendor_name"] = str(out["vendor_name"]).strip()
    if "status" in out and out["status"]:
        out["status"] = str(out["status"]).strip() or "Open"
    else:
        out.setdefault("status", "Open")
    out["updated_at"] = datetime.now(timezone.utc).isoformat()
    return out


def bulk_upsert_purchase_orders(
    *,
    company_id: str,
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """Upsert many PO rows with service role — bypasses browser RLS for Excel import."""
    from app.core.supabase import get_supabase

    cid = (company_id or "").strip()
    if not cid:
        return {
            "ok": False,
            "success": 0,
            "failed": len(rows),
            "error": "company_id required",
            "results": [],
        }
    if not rows:
        return {"ok": True, "success": 0, "failed": 0, "results": []}

    sb = get_supabase()
    success = 0
    failed = 0
    results: list[dict[str, Any]] = []

    for idx, raw in enumerate(rows):
        payload = _sanitize_po_row(dict(raw or {}), cid)
        po_no = payload.get("po_number") or f"row-{idx + 1}"
        if not str(payload.get("po_number") or "").strip():
            failed += 1
            results.append({"ok": False, "po_number": po_no, "error": "Missing po_number"})
            continue
        if not str(payload.get("vendor_name") or "").strip():
            failed += 1
            results.append({"ok": False, "po_number": po_no, "error": "Missing vendor_name"})
            continue

        try:
            existing = (
                sb.table("purchase_orders")
                .select("id")
                .eq("company_id", cid)
                .eq("po_number", payload["po_number"])
                .limit(1)
                .execute()
            )
            existing_rows = existing.data if isinstance(existing.data, list) else []
            if existing_rows:
                po_id = existing_rows[0].get("id")
                res = (
                    sb.table("purchase_orders")
                    .update(payload)
                    .eq("id", po_id)
                    .eq("company_id", cid)
                    .execute()
                )
            else:
                res = sb.table("purchase_orders").insert(payload).execute()
            saved = (res.data or [None])[0] if isinstance(res.data, list) else None
            success += 1
            results.append(
                {
                    "ok": True,
                    "po_number": payload["po_number"],
                    "id": (saved or {}).get("id") if isinstance(saved, dict) else existing_rows[0].get("id") if existing_rows else None,
                }
            )
        except Exception as exc:
            failed += 1
            results.append({"ok": False, "po_number": po_no, "error": str(exc)})
            logger.warning("bulk PO upsert failed for %s: %s", po_no, exc)

    return {
        "ok": failed == 0,
        "success": success,
        "failed": failed,
        "results": results,
    }


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


def ensure_workspace_pos_and_relink_grns(*, company_id: str) -> dict[str, Any]:
    """Copy missing POs from sibling companies in the same workspace, then relink GRNs.

    Multi-company workspaces previously shared a global UNIQUE(po_number), so POs
    landed on the first company only. Invoices on company B still carry po_number
    but 3-way match looks up POs scoped to company B → no_po.
    """
    from app.core.supabase import get_supabase

    cid = (company_id or "").strip()
    if not cid:
        return {"ok": False, "error": "company_id required", "copied_pos": 0, "relinked_grns": 0, "properties": 0}

    sb = get_supabase()
    copied = relinked = props = 0

    try:
        co = sb.table("companies").select("id,workspace_id").eq("id", cid).limit(1).execute()
        ws_id = None
        if isinstance(co.data, list) and co.data:
            ws_id = co.data[0].get("workspace_id")
        sibling_ids: list[str] = []
        if ws_id:
            sibs = sb.table("companies").select("id").eq("workspace_id", ws_id).execute()
            sibling_ids = [str(r["id"]) for r in (sibs.data or []) if r.get("id") and str(r["id"]) != cid]

        invs = (
            sb.table("invoices")
            .select("id,po_number,gl_account_code,property_ref")
            .eq("company_id", cid)
            .limit(2000)
            .execute()
        )
        needed = {
            str(r.get("po_number") or "").strip()
            for r in (invs.data or [])
            if str(r.get("po_number") or "").strip()
        }
        local = sb.table("purchase_orders").select("id,po_number").eq("company_id", cid).limit(2000).execute()
        local_by_num = {
            str(r.get("po_number") or "").strip(): str(r["id"])
            for r in (local.data or [])
            if r.get("id") and str(r.get("po_number") or "").strip()
        }

        for po_no in needed:
            if po_no in local_by_num:
                continue
            src = None
            for sid in sibling_ids:
                found = (
                    sb.table("purchase_orders")
                    .select("*")
                    .eq("company_id", sid)
                    .eq("po_number", po_no)
                    .limit(1)
                    .execute()
                )
                rows = found.data if isinstance(found.data, list) else []
                if rows:
                    src = rows[0]
                    break
            if not src:
                continue
            payload = {
                k: src.get(k)
                for k in (
                    "po_number",
                    "vendor_name",
                    "po_amount",
                    "po_date",
                    "delivery_date",
                    "description",
                    "notes",
                    "status",
                    "currency",
                    "line_items",
                )
                if src.get(k) is not None
            }
            payload["company_id"] = cid
            payload["po_number"] = po_no
            payload.setdefault("vendor_name", "Unknown vendor")
            payload.setdefault("status", "Open")
            try:
                ins = sb.table("purchase_orders").insert(payload).execute()
                new_row = (ins.data or [None])[0] if isinstance(ins.data, list) else None
                new_id = (new_row or {}).get("id") if isinstance(new_row, dict) else None
                if not new_id:
                    lookup = (
                        sb.table("purchase_orders")
                        .select("id")
                        .eq("company_id", cid)
                        .eq("po_number", po_no)
                        .limit(1)
                        .execute()
                    )
                    lr = lookup.data if isinstance(lookup.data, list) else []
                    new_id = lr[0].get("id") if lr else None
                if new_id:
                    local_by_num[po_no] = str(new_id)
                    copied += 1
            except Exception as exc:
                logger.warning("copy PO %s to company %s failed: %s", po_no, cid, exc)

        # Relink GRNs whose po_id points at a sibling PO with the same po_number
        id_to_num: dict[str, str] = {}
        for sid in [cid, *sibling_ids]:
            pos = sb.table("purchase_orders").select("id,po_number").eq("company_id", sid).limit(2000).execute()
            for r in pos.data or []:
                if r.get("id") and r.get("po_number"):
                    id_to_num[str(r["id"])] = str(r["po_number"]).strip()

        grns = sb.table("goods_receipts").select("id,po_id,grn_number").eq("company_id", cid).limit(2000).execute()
        local_grn_po_ids: set[str] = set()
        for g in grns.data or []:
            gid = g.get("id")
            old_pid = str(g.get("po_id") or "").strip()
            po_no = id_to_num.get(old_pid) if old_pid else None
            if not po_no or po_no not in local_by_num:
                if old_pid:
                    local_grn_po_ids.add(old_pid)
                continue
            new_pid = local_by_num[po_no]
            local_grn_po_ids.add(new_pid)
            if old_pid == new_pid:
                continue
            try:
                sb.table("goods_receipts").update({"po_id": new_pid}).eq("id", gid).eq("company_id", cid).execute()
                relinked += 1
            except Exception as exc:
                logger.warning("relink GRN %s failed: %s", gid, exc)

        local_grn_nums = {
            str(r.get("grn_number") or "").strip()
            for r in (grns.data or [])
            if str(r.get("grn_number") or "").strip()
        }
        for po_no in needed:
            local_pid = local_by_num.get(po_no)
            if not local_pid or local_pid in local_grn_po_ids:
                continue
            src_grn = None
            for sid in sibling_ids:
                sib_pos = (
                    sb.table("purchase_orders")
                    .select("id")
                    .eq("company_id", sid)
                    .eq("po_number", po_no)
                    .limit(1)
                    .execute()
                )
                sib_po_rows = sib_pos.data if isinstance(sib_pos.data, list) else []
                if not sib_po_rows:
                    continue
                sib_pid = str(sib_po_rows[0]["id"])
                found_g = (
                    sb.table("goods_receipts")
                    .select("*")
                    .eq("company_id", sid)
                    .eq("po_id", sib_pid)
                    .limit(1)
                    .execute()
                )
                grow = found_g.data if isinstance(found_g.data, list) else []
                if grow:
                    src_grn = grow[0]
                    break
            if not src_grn:
                continue
            gnum = str(src_grn.get("grn_number") or "").strip() or f"GRN-{po_no}"
            if gnum in local_grn_nums:
                gnum = f"{gnum}-{cid[:8]}"
            gpayload = {
                k: src_grn.get(k)
                for k in (
                    "vendor_name",
                    "received_amount",
                    "received_date",
                    "status",
                    "received_by",
                    "notes",
                    "invoice_number",
                )
                if src_grn.get(k) is not None
            }
            gpayload["company_id"] = cid
            gpayload["grn_number"] = gnum
            gpayload["po_id"] = local_pid
            gpayload.setdefault("status", "confirmed")
            try:
                sb.table("goods_receipts").insert(gpayload).execute()
                local_grn_nums.add(gnum)
                local_grn_po_ids.add(local_pid)
                relinked += 1
            except Exception as exc:
                logger.warning("copy GRN for PO %s to company %s failed: %s", po_no, cid, exc)

        for inv in invs.data or []:
            if str(inv.get("property_ref") or "").strip():
                continue
            derived = property_from_gl_code(inv.get("gl_account_code") or inv.get("gl_code"))
            if not derived or not inv.get("id"):
                continue
            try:
                sb.table("invoices").update({"property_ref": derived}).eq("id", inv["id"]).eq("company_id", cid).execute()
                props += 1
            except Exception as exc:
                logger.warning("property fill %s failed: %s", inv.get("id"), exc)

        rematch = rematch_invoices_by_po_number(company_id=cid, tolerance_pct=5.0)
        return {
            "ok": True,
            "copied_pos": copied,
            "relinked_grns": relinked,
            "properties": props,
            "rematched": rematch.get("three_way_matched", 0),
            "rematch": rematch,
        }
    except Exception as exc:
        logger.exception("ensure_workspace_pos_and_relink_grns failed for %s", cid)
        return {"ok": False, "error": str(exc), "copied_pos": copied, "relinked_grns": relinked, "properties": props}


def _pct_diff_vat_aware(a: float, b: float) -> float:
    if a == b:
        return 0.0
    lo, hi = min(abs(a), abs(b)), max(abs(a), abs(b))
    if lo > 0 and abs(hi / lo - 1.05) < 0.01:
        return 0.0
    if hi <= 0:
        return 100.0
    return abs(a - b) / hi * 100.0


def _best_amount_pct(inv_amt: float, other_amt: float, vat: float) -> float:
    candidates = [inv_amt]
    if vat > 0 and inv_amt > vat:
        candidates.append(inv_amt - vat)
    return min(_pct_diff_vat_aware(c, other_amt) for c in candidates)


def rematch_invoices_by_po_number(*, company_id: str, tolerance_pct: float = 5.0) -> dict[str, Any]:
    """Exact po_number → PO → GRN. Amounts within tolerance (VAT-aware) → three_way_matched."""
    from datetime import datetime, timezone

    from app.core.supabase import get_supabase

    cid = (company_id or "").strip()
    out = {
        "ok": False,
        "three_way_matched": 0,
        "matched": 0,
        "mismatch": 0,
        "no_po": 0,
        "no_grn": 0,
        "error": None,
    }
    if not cid:
        out["error"] = "company_id required"
        return out

    sb = get_supabase()
    try:
        invs = (
            sb.table("invoices")
            .select("id,invoice_number,po_number,total_amount,tax_amount,vat_amount,match_status")
            .eq("company_id", cid)
            .limit(2000)
            .execute()
        )
        pos = (
            sb.table("purchase_orders")
            .select("id,po_number,po_amount")
            .eq("company_id", cid)
            .limit(2000)
            .execute()
        )
        grns = (
            sb.table("goods_receipts")
            .select("id,po_id,received_amount,status")
            .eq("company_id", cid)
            .limit(2000)
            .execute()
        )
    except Exception as exc:
        out["error"] = str(exc)
        return out

    po_by_num = {
        str(p.get("po_number") or "").strip().lower(): p
        for p in (pos.data or [])
        if str(p.get("po_number") or "").strip()
    }
    grn_by_po: dict[str, dict[str, Any]] = {}
    for g in grns.data or []:
        pid = str(g.get("po_id") or "").strip()
        if not pid:
            continue
        prev = grn_by_po.get(pid)
        if prev is None or str(g.get("status") or "") == "confirmed":
            grn_by_po[pid] = g

    now = datetime.now(timezone.utc).isoformat()
    for inv in invs.data or []:
        iid = inv.get("id")
        po_no = str(inv.get("po_number") or "").strip()
        if not iid:
            continue
        if not po_no:
            out["no_po"] += 1
            continue
        po = po_by_num.get(po_no.lower())
        if not po:
            out["no_po"] += 1
            try:
                sb.table("invoices").update(
                    {
                        "match_status": "no_po",
                        "po_id": None,
                        "grn_id": None,
                        "auto_matched": True,
                        "grn_confirmed": False,
                        "match_attempted_at": now,
                        "match_notes": f'No PO found for "{po_no}"',
                    }
                ).eq("id", iid).eq("company_id", cid).execute()
            except Exception as exc:
                logger.warning("rematch no_po patch failed %s: %s", iid, exc)
            continue

        po_id = str(po["id"])
        grn = grn_by_po.get(po_id)
        inv_amt = float(inv.get("total_amount") or 0)
        vat = float(inv.get("vat_amount") or inv.get("tax_amount") or 0)
        po_amt = float(po.get("po_amount") or 0)
        grn_amt = float((grn or {}).get("received_amount") or 0)
        inv_po_pct = _best_amount_pct(inv_amt, po_amt, vat) if po_amt else 100.0
        inv_grn_pct = _best_amount_pct(inv_amt, grn_amt, vat) if grn and grn_amt else None
        within = inv_po_pct <= tolerance_pct and (inv_grn_pct is None or inv_grn_pct <= tolerance_pct)

        if grn and within:
            status = "three_way_matched"
            notes = f"Full 3-way match: PO {po_no} · GRN · within {tolerance_pct:g}%"
            score = 95
            out["three_way_matched"] += 1
        elif within:
            status = "matched"
            notes = f"2-way match: PO {po_no} · no GRN · within {tolerance_pct:g}%"
            score = 85
            out["matched"] += 1
            out["no_grn"] += 1
        elif not grn:
            status = "partial"
            notes = f"PO {po_no} found — waiting for goods receipt"
            score = 60
            out["no_grn"] += 1
        else:
            status = "mismatch"
            notes = f"Amount variance inv/PO {inv_po_pct:.1f}% (limit {tolerance_pct:g}%)"
            score = 45
            out["mismatch"] += 1

        payload = {
            "po_id": po_id,
            "grn_id": (grn or {}).get("id") if grn else None,
            "match_status": status,
            "match_score": score,
            "match_notes": notes,
            "auto_matched": True,
            "grn_confirmed": status == "three_way_matched",
            "match_attempted_at": now,
        }
        try:
            sb.table("invoices").update(payload).eq("id", iid).eq("company_id", cid).execute()
        except Exception as exc:
            logger.warning("rematch patch failed %s: %s", iid, exc)
            stripped = _strip_unknown(payload, str(exc))
            if stripped:
                try:
                    sb.table("invoices").update(stripped).eq("id", iid).eq("company_id", cid).execute()
                except Exception as exc2:
                    logger.warning("rematch retry failed %s: %s", iid, exc2)

    out["ok"] = True
    return out


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


_GRN_ALLOWED = {
    "grn_number",
    "po_number",
    "vendor_name",
    "received_amount",
    "received_date",
    "status",
    "received_by",
    "notes",
    "invoice_number",
    "line_items",
}


def _resolve_po_id_for_company(sb: Any, company_id: str, po_number: str) -> tuple[str | None, str | None]:
    """Return (po_id, reason_if_missing). Scoped to company — never cross-tenant match."""
    po_no = (po_number or "").strip()
    if not po_no:
        return None, "No PO number"
    try:
        exact = (
            sb.table("purchase_orders")
            .select("id, po_number")
            .eq("company_id", company_id)
            .eq("po_number", po_no)
            .limit(1)
            .execute()
        )
        rows = exact.data if isinstance(exact.data, list) else []
        if rows:
            return str(rows[0]["id"]), None
        # case-insensitive fallback within same company only
        ci = (
            sb.table("purchase_orders")
            .select("id, po_number")
            .eq("company_id", company_id)
            .ilike("po_number", po_no)
            .limit(1)
            .execute()
        )
        rows2 = ci.data if isinstance(ci.data, list) else []
        if rows2:
            return str(rows2[0]["id"]), None
    except Exception as exc:
        return None, str(exc)
    return None, f'PO number "{po_no}" not found'


def bulk_upsert_goods_receipts(
    *,
    company_id: str,
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """Insert/update GRNs + line items via service role for any company (bypasses browser RLS)."""
    from app.core.supabase import get_supabase

    cid = (company_id or "").strip()
    if not cid:
        return {
            "ok": False,
            "success": 0,
            "failed": len(rows),
            "skipped": 0,
            "unlinked_po": 0,
            "needs_review": 0,
            "error": "company_id required",
            "results": [],
        }
    if not rows:
        return {
            "ok": True,
            "success": 0,
            "failed": 0,
            "skipped": 0,
            "unlinked_po": 0,
            "needs_review": 0,
            "results": [],
        }

    sb = get_supabase()
    success = failed = skipped = unlinked = needs_review = 0
    results: list[dict[str, Any]] = []

    for idx, raw in enumerate(rows):
        raw = dict(raw or {})
        grn_num = str(raw.get("grn_number") or "").strip()
        if not grn_num:
            failed += 1
            results.append({"ok": False, "grn_number": f"row-{idx + 1}", "error": "Missing grn_number"})
            continue

        try:
            dup = (
                sb.table("goods_receipts")
                .select("id")
                .eq("company_id", cid)
                .eq("grn_number", grn_num)
                .limit(1)
                .execute()
            )
            if isinstance(dup.data, list) and dup.data:
                skipped += 1
                results.append(
                    {
                        "ok": False,
                        "grn_number": grn_num,
                        "skipped": True,
                        "error": "Skipped — GRN number already exists",
                    }
                )
                continue

            po_number = str(raw.get("po_number") or "").strip()
            po_id, po_reason = _resolve_po_id_for_company(sb, cid, po_number)
            warning = None
            if po_number and not po_id:
                needs_review += 1
                unlinked += 1
                warning = po_reason or f'PO number "{po_number}" not found'
            elif not po_id:
                unlinked += 1
                warning = "GRN saved without PO link"

            line_items = raw.get("line_items")
            if not isinstance(line_items, list):
                line_items = []

            status_raw = str(raw.get("status") or "confirmed").strip().lower()
            status_db = "draft" if status_raw == "draft" else "confirmed"
            received_amount = raw.get("received_amount")
            try:
                received_amount = float(received_amount) if received_amount is not None else 0.0
            except (TypeError, ValueError):
                received_amount = 0.0

            if received_amount == 0 and line_items:
                try:
                    received_amount = sum(
                        float(li.get("received_qty") or 0) * float(li.get("unit_price") or 0)
                        for li in line_items
                        if isinstance(li, dict)
                    )
                except (TypeError, ValueError):
                    pass

            payload = {
                "company_id": cid,
                "grn_number": grn_num,
                "po_id": po_id,
                "vendor_name": str(raw.get("vendor_name") or "Unknown vendor").strip() or "Unknown vendor",
                "received_amount": received_amount,
                "received_date": raw.get("received_date") or raw.get("grn_date") or None,
                "status": status_db,
                "received_by": str(raw.get("received_by") or "Bulk import").strip() or "Bulk import",
                "notes": str(raw.get("notes") or "").strip(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            inv_no = str(raw.get("invoice_number") or "").strip()
            if inv_no:
                payload["invoice_number"] = inv_no

            res = sb.table("goods_receipts").insert(payload).execute()
            saved = (res.data or [None])[0] if isinstance(res.data, list) else None
            grn_id = (saved or {}).get("id") if isinstance(saved, dict) else None
            if not grn_id:
                # Some supabase-py versions omit returning rows — look up by company + number
                lookup = (
                    sb.table("goods_receipts")
                    .select("id")
                    .eq("company_id", cid)
                    .eq("grn_number", grn_num)
                    .limit(1)
                    .execute()
                )
                lookup_rows = lookup.data if isinstance(lookup.data, list) else []
                grn_id = lookup_rows[0].get("id") if lookup_rows else None
            if not grn_id:
                raise RuntimeError("GRN insert returned no id")

            li_rows = []
            for li in line_items:
                if not isinstance(li, dict):
                    continue
                cond = str(li.get("condition") or "good").strip().lower()
                if cond not in ("good", "damaged", "partial", "rejected"):
                    cond = "good"
                li_rows.append(
                    {
                        "grn_id": grn_id,
                        "description": str(li.get("description") or "Line item").strip() or "Line item",
                        "ordered_qty": float(li.get("ordered_qty") or 1),
                        "received_qty": float(li.get("received_qty") or 1),
                        "unit_price": float(li.get("unit_price") or 0),
                        "condition": cond,
                    }
                )
            if not li_rows:
                li_rows = [
                    {
                        "grn_id": grn_id,
                        "description": payload["notes"] or f"{payload['vendor_name']} — receipt",
                        "ordered_qty": 1,
                        "received_qty": 1,
                        "unit_price": received_amount or 0,
                        "condition": "good",
                    }
                ]
            try:
                sb.table("grn_line_items").insert(li_rows).execute()
            except Exception as li_exc:
                logger.warning("grn_line_items insert for %s: %s", grn_num, li_exc)

            success += 1
            results.append(
                {
                    "ok": True,
                    "grn_number": grn_num,
                    "id": grn_id,
                    "po_id": po_id,
                    "needs_review": bool(warning),
                    "warning": warning,
                }
            )
        except Exception as exc:
            failed += 1
            results.append({"ok": False, "grn_number": grn_num, "error": str(exc)})
            logger.warning("bulk GRN upsert failed for %s: %s", grn_num, exc)

    return {
        "ok": failed == 0,
        "success": success,
        "failed": failed,
        "skipped": skipped,
        "unlinked_po": unlinked,
        "needs_review": needs_review,
        "results": results,
    }
