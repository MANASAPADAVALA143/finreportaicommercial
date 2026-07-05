"""Sync approved AP invoices into GulfTax gulftax_transactions store."""
from __future__ import annotations

import logging
from datetime import date
from typing import Any

logger = logging.getLogger(__name__)


def _norm_treatment(raw: str | None) -> str:
    t = (raw or "standard_rated").lower().replace("-", "_").strip()
    if t in ("standard", "standard_rated"):
        return "standard"
    if t in ("zero", "zero_rated"):
        return "zero"
    if t in ("exempt",):
        return "exempt"
    if t in ("reverse_charge", "rcm"):
        return "reverse_charge"
    if t in ("out_of_scope", "outofscope"):
        return "out_of_scope"
    if t in ("blocked", "non_recoverable"):
        return "standard"
    return "standard"


def _direction(invoice_type: str | None) -> str:
    return "output" if (invoice_type or "purchase").lower() == "sales" else "input"


def _fta_box(vat_category: str, direction: str) -> str:
    if direction == "output":
        if vat_category == "standard":
            return "box1"
        if vat_category == "zero":
            return "box3"
        if vat_category == "exempt":
            return "box5"
        if vat_category == "reverse_charge":
            return "box3"
        return "box1"
    if vat_category == "standard":
        return "box9"
    if vat_category in ("zero", "reverse_charge"):
        return "box10"
    if vat_category == "exempt":
        return "box5"
    return "box9"


def tax_period_for_date(invoice_date: date, filing_frequency: str) -> str:
    freq = (filing_frequency or "quarterly").lower()
    if freq == "monthly":
        return f"{invoice_date.year}-{invoice_date.month:02d}"
    q = (invoice_date.month - 1) // 3 + 1
    return f"{invoice_date.year}-Q{q}"


def parse_period_range(tax_period: str) -> tuple[date, date]:
    from app.modules.gulftax.vat_return_service import parse_period

    return parse_period(tax_period)


def _fetch_company_config(company_id: str) -> dict[str, Any]:
    try:
        from app.core.supabase import get_supabase

        sb = get_supabase()
        res = (
            sb.table("companies")
            .select("id, vat_filing_frequency, vat_rate, workspace_id, name, entity_type")
            .eq("id", company_id)
            .maybe_single()
            .execute()
        )
        return res.data or {}
    except Exception:
        logger.exception("Failed to load company %s", company_id)
        return {}


def _fetch_invoice(invoice_id: str) -> dict[str, Any] | None:
    try:
        from app.core.supabase import get_supabase

        sb = get_supabase()
        res = sb.table("invoices").select("*").eq("id", invoice_id).maybe_single().execute()
        return res.data
    except Exception:
        logger.exception("Failed to fetch invoice %s", invoice_id)
        return None


def _vat_rate_for_invoice(invoice: dict[str, Any], company: dict[str, Any]) -> float:
    for key in ("vat_rate", "tax_rate"):
        val = invoice.get(key)
        if val is not None:
            try:
                rate = float(val)
                if rate > 1:
                    return rate / 100.0 if rate > 5 else rate
                return rate
            except (TypeError, ValueError):
                pass
    try:
        cr = float(company.get("vat_rate") or 5)
        return cr / 100.0 if cr > 1 else cr
    except (TypeError, ValueError):
        return 0.05


def build_transaction_row(
    invoice: dict[str, Any],
    *,
    company_id: str,
    workspace_id: str | None = None,
) -> dict[str, Any]:
    company = _fetch_company_config(company_id)
    ws_id = workspace_id or company.get("workspace_id") or company_id

    inv_date_raw = invoice.get("invoice_date") or date.today().isoformat()
    inv_date = date.fromisoformat(str(inv_date_raw)[:10])

    filing = company.get("vat_filing_frequency") or "quarterly"
    tax_period = tax_period_for_date(inv_date, filing)

    gross = round(float(invoice.get("total_amount") or 0), 2)
    vat = round(float(invoice.get("vat_amount") or invoice.get("tax_amount") or 0), 2)
    if vat <= 0 and gross > 0:
        cat = _norm_treatment(invoice.get("vat_treatment"))
        if cat == "standard":
            rate = _vat_rate_for_invoice(invoice, company)
            net = round(gross / (1 + rate), 2) if rate else gross
            vat = round(gross - net, 2)

    direction = _direction(invoice.get("invoice_type"))
    vat_category = _norm_treatment(invoice.get("vat_treatment"))
    fta_box = _fta_box(vat_category, direction)

    from app.modules.gulftax.vat_return_service import resolve_dz_locations_for_transaction

    entity_type = company.get("entity_type") or "mainland"
    inv_dz = bool(invoice.get("designated_zone"))
    dz_flag, tx_kind, sup_loc, cust_loc = resolve_dz_locations_for_transaction(
        direction=direction,
        company_entity_type=entity_type,
        invoice_designated_zone=inv_dz,
    )

    return {
        "source": "ap_invoiceflow",
        "ap_invoice_id": invoice.get("id"),
        "company_id": company_id,
        "workspace_id": ws_id,
        "tax_period": tax_period,
        "transaction_date": inv_date.isoformat(),
        "vendor_name": invoice.get("vendor_name"),
        "vendor_trn": invoice.get("vendor_trn") or invoice.get("gstin"),
        "invoice_number": invoice.get("invoice_number"),
        "gross_amount": gross,
        "vat_amount": vat,
        "vat_category": vat_category,
        "fta_box": fta_box,
        "direction": direction,
        "status": "posted",
        "designated_zone": dz_flag,
        "transaction_kind": tx_kind,
        "dz_supplier_location": sup_loc,
        "dz_customer_location": cust_loc,
        "updated_at": date.today().isoformat(),
    }


def _existing_for_invoice(invoice_id: str) -> bool:
    try:
        from app.core.supabase import get_supabase

        sb = get_supabase()
        res = (
            sb.table("gulftax_transactions")
            .select("id")
            .eq("ap_invoice_id", invoice_id)
            .eq("status", "posted")
            .limit(1)
            .execute()
        )
        return bool(res.data)
    except Exception:
        return False


def sync_approved_invoice_to_gulftax(
    invoice_id: str,
    company_id: str,
    *,
    workspace_id: str | None = None,
) -> dict[str, Any]:
    """Insert one approved AP invoice into gulftax_transactions (idempotent)."""
    if not invoice_id or not company_id:
        return {"ok": False, "error": "invoice_id and company_id required"}

    if _existing_for_invoice(invoice_id):
        return {"ok": True, "skipped": True, "reason": "already_synced"}

    invoice = _fetch_invoice(invoice_id)
    if not invoice:
        return {"ok": False, "error": "invoice_not_found"}

    status = (invoice.get("status") or "").strip()
    if status != "Approved":
        return {"ok": False, "error": f"invoice_not_approved:{status}"}

    row = build_transaction_row(invoice, company_id=company_id, workspace_id=workspace_id)

    try:
        from app.core.supabase import get_supabase

        sb = get_supabase()
        res = sb.table("gulftax_transactions").insert(row).execute()
        inserted = (res.data or [None])[0]
        return {
            "ok": True,
            "transaction_id": inserted.get("id") if inserted else None,
            "tax_period": row["tax_period"],
            "fta_box": row["fta_box"],
            "company_id": company_id,
        }
    except Exception as exc:
        logger.exception("gulftax sync failed for invoice %s", invoice_id)
        return {"ok": False, "error": str(exc)}


def list_transactions(
    company_id: str,
    tax_period: str,
    *,
    workspace_id: str | None = None,
) -> list[dict[str, Any]]:
    try:
        from app.core.supabase import get_supabase

        sb = get_supabase()
        q = (
            sb.table("gulftax_transactions")
            .select("*")
            .eq("company_id", company_id)
            .eq("tax_period", tax_period)
            .eq("status", "posted")
            .order("transaction_date", desc=True)
        )
        if workspace_id:
            q = q.eq("workspace_id", workspace_id)
        res = q.execute()
        return res.data or []
    except Exception:
        logger.exception("list_transactions failed")
        return []


def aggregate_vat_return_summary(company_id: str, tax_period: str) -> dict[str, Any]:
    rows = list_transactions(company_id, tax_period)
    summary: dict[str, dict[str, float]] = {
        "box1": {"gross": 0.0, "vat": 0.0},
        "box3": {"gross": 0.0, "vat": 0.0},
        "box5": {"gross": 0.0, "vat": 0.0},
        "box9": {"gross": 0.0, "vat": 0.0},
        "box10": {"gross": 0.0, "vat": 0.0},
    }
    ap_count = 0
    for r in rows:
        box = (r.get("fta_box") or "box9").lower()
        if box not in summary:
            continue
        gross = float(r.get("gross_amount") or 0)
        vat = float(r.get("vat_amount") or 0)
        net = float(r.get("net_amount") or gross - vat)
        if r.get("direction") == "output":
            summary[box]["gross"] += net if box in ("box1", "box3", "box5") else gross
        else:
            summary[box]["gross"] += net if box in ("box9", "box10") else gross
        summary[box]["vat"] += vat
        if r.get("source") == "ap_invoiceflow":
            ap_count += 1

    for box in summary:
        summary[box]["gross"] = round(summary[box]["gross"], 2)
        summary[box]["vat"] = round(summary[box]["vat"], 2)

    return {
        "company_id": company_id,
        "tax_period": tax_period,
        "transaction_count": len(rows),
        "ap_invoiceflow_count": ap_count,
        **summary,
    }


def sync_period(company_id: str, tax_period: str) -> dict[str, Any]:
    """Backfill approved invoices in period that lack gulftax_transactions rows."""
    period_start, period_end = parse_period_range(tax_period)
    try:
        from app.core.supabase import get_supabase

        sb = get_supabase()
        inv_res = (
            sb.table("invoices")
            .select("id, status, company_id, invoice_date")
            .eq("company_id", company_id)
            .eq("status", "Approved")
            .gte("invoice_date", period_start.isoformat())
            .lte("invoice_date", period_end.isoformat())
            .execute()
        )
        invoices = inv_res.data or []
    except Exception as exc:
        logger.exception("sync_period invoice fetch failed")
        return {"ok": False, "error": str(exc), "synced": 0, "skipped": 0}

    synced = 0
    skipped = 0
    errors: list[str] = []
    for inv in invoices:
        iid = inv.get("id")
        if not iid:
            continue
        if _existing_for_invoice(iid):
            skipped += 1
            continue
        result = sync_approved_invoice_to_gulftax(iid, company_id)
        if result.get("ok"):
            synced += 1
        else:
            errors.append(f"{iid}:{result.get('error')}")

    return {
        "ok": True,
        "synced": synced,
        "skipped": skipped,
        "total_invoices": len(invoices),
        "errors": errors[:20],
    }


def log_sync_failure(
    *,
    invoice_id: str,
    company_id: str | None,
    error: str,
    workspace_id: str | None = None,
) -> None:
    try:
        from app.core.supabase import get_supabase

        sb = get_supabase()
        sb.table("audit_logs").insert(
            {
                "invoice_id": invoice_id,
                "action": "gulftax_sync_failed",
                "field_changed": "gulftax_transactions",
                "new_value": error[:500],
                "user_name": "system",
            }
        ).execute()
    except Exception:
        logger.exception("audit log for gulftax_sync_failed failed")
