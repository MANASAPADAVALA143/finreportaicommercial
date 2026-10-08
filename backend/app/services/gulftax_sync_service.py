"""Sync approved AP invoices into GulfTax gulftax_transactions store."""
from __future__ import annotations

import logging
from datetime import date
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Paid invoices were approved first, so their input VAT belongs in the return too.
POSTABLE_AP_STATUSES = ("Approved", "Paid")


def _is_no_content_company_config(exc: Exception) -> bool:
    """Treat Supabase/PostgREST 204 from maybe_single as a valid empty state."""
    text = str(exc)
    if "PGRST204" in text:
        return True
    if "'code': '204'" in text or '"code": "204"' in text:
        return True
    if "Missing response" in text and "204" in text:
        return True
    return False


def _assert_invoice_company_match(invoice: dict[str, Any], company_id: str) -> str | None:
    """Return an error code when the invoice does not belong to the requested company."""
    invoice_company = str(invoice.get("company_id") or "").strip()
    requested = str(company_id).strip()
    if not invoice_company:
        return "invoice_missing_company_id"
    if invoice_company != requested:
        return "company_id_mismatch"
    return None


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
    if t in ("blocked", "non_recoverable", "entertainment", "entertainment_restricted"):
        return "blocked"
    return "standard"


def _direction(invoice_type: str | None) -> str:
    from app.services.vat_box_mapping import direction_for_side, normalize_transaction_side

    side = normalize_transaction_side(None, invoice_type=invoice_type)
    return direction_for_side(side)


def _fta_box(vat_category: str, direction: str) -> str:
    """Map normalized category + direction → fta_box (empty string = no box)."""
    from app.services.vat_box_mapping import assign_fta_box

    side = "sale" if (direction or "").lower() == "output" else "purchase"
    # gulftax_sync uses short categories: standard/zero/exempt/...
    treatment_map = {
        "standard": "standard_rated",
        "zero": "zero_rated",
        "exempt": "exempt",
        "out_of_scope": "out_of_scope",
        "reverse_charge": "reverse_charge",
        "blocked": "blocked",
    }
    treatment = treatment_map.get((vat_category or "standard").lower(), vat_category or "standard_rated")
    box = assign_fta_box(side, treatment, direction=direction)
    return box or ""


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
    except Exception as exc:
        if _is_no_content_company_config(exc):
            logger.debug("Company %s has no config row yet (204 no content)", company_id)
            return {}
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


def _trn_key(raw: Any) -> str:
    return "".join(ch for ch in str(raw or "") if ch.isalnum()).upper()


def find_gulftax_duplicate(invoice: dict[str, Any], company_id: str) -> dict[str, Any] | None:
    """Another gulftax_transactions row for the same supplier invoice (any source).

    exact    : same vendor TRN + invoice number (same vendor when a TRN is missing)
    strong   : same vendor TRN + invoice date + gross amount, different invoice number
    possible : same normalised vendor + invoice date + gross amount, no TRN to confirm
    Two vendors sharing an invoice number (different TRNs) are not duplicates.
    """
    from app.services.vendor_normalize import same_vendor

    invoice_id = str(invoice.get("id") or "")
    inv_no = str(invoice.get("invoice_number") or "").strip()
    vendor = invoice.get("vendor_name") or ""
    trn = _trn_key(invoice.get("vendor_trn") or invoice.get("gstin"))
    inv_date = str(invoice.get("invoice_date") or "")[:10]
    gross = round(float(invoice.get("total_amount") or 0), 2)

    try:
        from app.core.supabase import get_supabase

        sb = get_supabase()
        cols = "id,ap_invoice_id,invoice_number,vendor_name,vendor_trn,transaction_date,gross_amount,source"
        candidates: list[dict[str, Any]] = []
        if inv_no:
            res = (
                sb.table("gulftax_transactions")
                .select(cols)
                .eq("company_id", company_id)
                .ilike("invoice_number", inv_no)
                .in_("status", ["posted", "pending"])
                .limit(20)
                .execute()
            )
            candidates.extend(res.data or [])
        if inv_date and gross > 0:
            res = (
                sb.table("gulftax_transactions")
                .select(cols)
                .eq("company_id", company_id)
                .eq("transaction_date", inv_date)
                .eq("gross_amount", gross)
                .in_("status", ["posted", "pending"])
                .limit(20)
                .execute()
            )
            candidates.extend(res.data or [])
    except Exception as exc:
        logger.warning("GulfTax duplicate lookup failed for %s: %s", invoice_id, exc)
        return None

    best: dict[str, Any] | None = None
    rank = {"exact": 3, "strong": 2, "possible": 1}
    for row in candidates:
        if invoice_id and str(row.get("ap_invoice_id") or "") == invoice_id:
            continue
        row_trn = _trn_key(row.get("vendor_trn"))
        both_trn = bool(trn) and bool(row_trn)
        same_supplier = (trn == row_trn) if both_trn else same_vendor(vendor, row.get("vendor_name") or "")
        if not same_supplier:
            continue
        same_no = bool(inv_no) and str(row.get("invoice_number") or "").strip().lower() == inv_no.lower()
        same_date_amt = (
            str(row.get("transaction_date") or "")[:10] == inv_date
            and round(float(row.get("gross_amount") or 0), 2) == gross
        )
        if same_no:
            kind = "exact"
        elif same_date_amt:
            kind = "strong" if both_trn else "possible"
        else:
            continue
        if best is None or rank[kind] > rank[best["kind"]]:
            best = {
                "kind": kind,
                "transaction_id": row.get("id"),
                "invoice_number": row.get("invoice_number"),
                "source": row.get("source"),
            }
    return best


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
        classifier: dict[str, Any] = {}
        try:
            from app.core.database import SessionLocal
            from app.models.client_data import GulftaxTransaction
            from app.services.vat_classifier_sync_service import sync_gulftax_orm_row_to_classifier

            db = SessionLocal()
            try:
                gt = (
                    db.query(GulftaxTransaction)
                    .filter(GulftaxTransaction.ap_invoice_id == invoice_id)
                    .first()
                )
                if gt:
                    classifier = sync_gulftax_orm_row_to_classifier(gt)
            finally:
                db.close()
        except Exception:
            logger.exception(
                "VAT Classifier mirror on skip failed for already-synced invoice %s", invoice_id
            )
            classifier = {"ok": False, "error": "classifier_mirror_exception"}
        return {
            "ok": True,
            "skipped": True,
            "reason": "already_synced",
            "classifier": classifier,
        }

    invoice = _fetch_invoice(invoice_id)
    if not invoice:
        return {"ok": False, "error": "invoice_not_found"}

    status = (invoice.get("status") or "").strip()
    if status not in POSTABLE_AP_STATUSES:
        return {"ok": False, "error": f"invoice_not_approved:{status}"}

    # Prefer UAE profile company_id (same Fix 3 resolver) — never stamp a mismatched demo company.
    resolved_company_id = company_id
    tenant_id = (workspace_id or "").strip() or None
    try:
        from app.core.database import SessionLocal
        from app.services.ap_invoice_post_service import _resolve_company_id_for_je

        company = _fetch_company_config(company_id)
        tenant_id = (
            (workspace_id or "").strip()
            or str(company.get("workspace_id") or "").strip()
            or str(invoice.get("workspace_id") or "").strip()
            or None
        )
        if tenant_id:
            db = SessionLocal()
            try:
                resolved_company_id = _resolve_company_id_for_je(
                    db,
                    tenant_id,
                    company_id,
                    invoice_ref=invoice_id,
                    company_name=invoice.get("company_name") or invoice.get("vendor_name"),
                )
            finally:
                db.close()
    except Exception:
        logger.exception(
            "company_id resolve failed for gulftax sync invoice=%s — using requested id",
            invoice_id,
        )
        resolved_company_id = company_id

    company_err = _assert_invoice_company_match(invoice, company_id)
    if company_err and resolved_company_id == company_id:
        logger.warning(
            "GulfTax sync rejected for invoice %s: %s (invoice company=%s, requested=%s)",
            invoice_id,
            company_err,
            invoice.get("company_id"),
            company_id,
        )
        return {"ok": False, "error": company_err}
    if company_err:
        logger.warning(
            "GulfTax sync company mismatch for invoice %s (%s) — stamping resolved company_id=%s",
            invoice_id,
            company_err,
            resolved_company_id,
        )

    dup = find_gulftax_duplicate(invoice, resolved_company_id)
    if dup:
        return {
            "ok": False,
            "duplicate": dup["kind"],
            "duplicate_of": dup,
            "error": f"duplicate_{dup['kind']}:{dup.get('invoice_number') or dup.get('transaction_id')}",
        }

    row = build_transaction_row(
        invoice, company_id=resolved_company_id, workspace_id=tenant_id or workspace_id
    )

    try:
        from app.core.supabase import get_supabase

        sb = get_supabase()
        # Supabase schema (024) uses workspace_id TEXT — not tenant_id.
        # Drop RDS-only keys; keep optional DZ columns (039 migration adds them).
        supabase_row = {k: v for k, v in row.items() if k != "tenant_id"}
        res = sb.table("gulftax_transactions").insert(supabase_row).execute()
        inserted = (res.data or [None])[0]
        classifier: dict[str, Any] = {}
        try:
            from app.services.vat_classifier_sync_service import upsert_classifier_transaction

            classifier = upsert_classifier_transaction(
                finreport_company_id=resolved_company_id,
                workspace_id=tenant_id or workspace_id,
                invoice_number=row.get("invoice_number"),
                vendor_or_customer=row.get("vendor_name"),
                transaction_date=row.get("transaction_date"),
                gross_amount=float(row.get("gross_amount") or 0),
                vat_amount=float(row.get("vat_amount") or 0),
                vat_category=row.get("vat_category"),
                direction=row.get("direction") or "input",
                source=row.get("source") or "ap_invoiceflow",
                vendor_trn=row.get("vendor_trn"),
                fta_box=row.get("fta_box"),
                ap_invoice_id=invoice_id,
            )
        except Exception:
            logger.exception(
                "VAT Classifier mirror after Supabase gulftax sync failed for %s", invoice_id
            )
            classifier = {"ok": False, "error": "classifier_mirror_exception"}
        return {
            "ok": True,
            "transaction_id": inserted.get("id") if inserted else None,
            "tax_period": row["tax_period"],
            "fta_box": row["fta_box"],
            "company_id": resolved_company_id,
            "classifier": classifier,
        }
    except Exception as exc:
        err = str(exc)
        # Retry without advanced-VAT columns if schema is pre-039.
        if "designated_zone" in err or "PGRST204" in err or "Could not find" in err:
            try:
                from app.core.supabase import get_supabase

                sb = get_supabase()
                core = {
                    k: row[k]
                    for k in (
                        "source",
                        "ap_invoice_id",
                        "company_id",
                        "workspace_id",
                        "tax_period",
                        "transaction_date",
                        "vendor_name",
                        "vendor_trn",
                        "invoice_number",
                        "gross_amount",
                        "vat_amount",
                        "vat_category",
                        "fta_box",
                        "direction",
                        "status",
                    )
                    if k in row
                }
                res = sb.table("gulftax_transactions").insert(core).execute()
                inserted = (res.data or [None])[0]
                return {
                    "ok": True,
                    "transaction_id": inserted.get("id") if inserted else None,
                    "tax_period": row["tax_period"],
                    "fta_box": row["fta_box"],
                    "company_id": resolved_company_id,
                    "note": "inserted_without_dz_columns",
                }
            except Exception as exc2:
                logger.exception("gulftax sync failed for invoice %s (retry)", invoice_id)
                return {"ok": False, "error": str(exc2)}
        logger.exception("gulftax sync failed for invoice %s", invoice_id)
        return {"ok": False, "error": err}


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
        if r.get("vat_category") == "blocked" and r.get("direction") != "output":
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


def sync_ap_invoice_gulftax_after_approve(
    db: "Session",
    invoice_id: str,
    company_id: str,
    *,
    workspace_id: str | None = None,
) -> dict[str, Any]:
    """Shared AP approve → gulftax_transactions sync (Supabase + RDS).

    Used by single approve (`post_invoice_to_gl_and_tax`) and bulk approve.
    Idempotent — skips when a posted row already exists for the invoice.
    """
    if not invoice_id or not company_id:
        return {"ok": False, "synced": False, "skipped": False, "error": "invoice_id and company_id required"}

    # GulfTax is UAE VAT-only. India GST invoices have their own module and
    # must never be synced into GulfTax's AED VAT-return boxes. Enforced here
    # (not per call site) so no approve path — single, bulk, or PDF-auto-sync
    # — can bypass it. Default to skip when currency is missing/blank.
    inv_for_currency = _fetch_invoice(invoice_id)
    currency = str((inv_for_currency or {}).get("currency") or "").strip().upper()
    if currency != "AED":
        return {"ok": True, "synced": False, "skipped": True, "reason": "not_uae_currency"}

    ws_id = (workspace_id or "").strip() or None
    sync_result = sync_approved_invoice_to_gulftax(
        invoice_id,
        company_id,
        workspace_id=ws_id,
    )
    if not sync_result.get("ok") and not sync_result.get("skipped"):
        logger.warning(
            "Supabase GulfTax sync failed for invoice %s: %s",
            invoice_id,
            sync_result.get("error", "unknown"),
        )
        try:
            log_sync_failure(
                invoice_id=invoice_id,
                company_id=company_id,
                error=str(sync_result.get("error", "unknown")),
                workspace_id=ws_id,
            )
        except Exception:
            pass

    rds_result: dict[str, Any] = {"ok": True, "skipped": True}
    if sync_result.get("duplicate"):
        return {
            "ok": False,
            "synced": False,
            "skipped": False,
            "duplicate": sync_result["duplicate"],
            "supabase": sync_result,
            "rds": rds_result,
            "error": sync_result.get("error"),
        }
    try:
        from app.services.ar_gulftax_sync_service import sync_ap_invoice_to_rds_gulftax

        rds_result = sync_ap_invoice_to_rds_gulftax(
            db,
            invoice_id,
            company_id,
            workspace_id=ws_id,
        )
        if not rds_result.get("ok") and not rds_result.get("skipped"):
            logger.warning(
                "RDS GulfTax sync failed for invoice %s: %s",
                invoice_id,
                rds_result.get("error", "unknown"),
            )
    except Exception as exc:
        logger.exception("RDS GulfTax sync failed for %s", invoice_id)
        rds_result = {"ok": False, "error": str(exc)}

    sup_new = bool(sync_result.get("ok")) and not bool(sync_result.get("skipped"))
    rds_new = bool(rds_result.get("ok")) and not bool(rds_result.get("skipped"))
    either_ok = bool(sync_result.get("ok")) or bool(rds_result.get("ok"))
    both_skipped = bool(sync_result.get("skipped")) and bool(rds_result.get("skipped"))
    return {
        "ok": either_ok,
        "synced": sup_new or rds_new,
        "skipped": both_skipped and either_ok,
        "supabase": sync_result,
        "rds": rds_result,
        "error": sync_result.get("error") or rds_result.get("error"),
        "fta_box": (rds_result.get("fta_box") or sync_result.get("fta_box")),
    }


def sync_period(
    company_id: str,
    tax_period: str,
    *,
    db: "Session | None" = None,
    workspace_id: str | None = None,
) -> dict[str, Any]:
    """Backfill approved invoices in period into Supabase and RDS gulftax_transactions."""
    period_start, period_end = parse_period_range(tax_period)
    try:
        from app.core.supabase import get_supabase

        sb = get_supabase()
        inv_res = (
            sb.table("invoices")
            .select("id, status, company_id, invoice_date, invoice_number, vendor_name, total_amount")
            .eq("company_id", company_id)
            .gte("invoice_date", period_start.isoformat())
            .lte("invoice_date", period_end.isoformat())
            .execute()
        )
        all_in_period = inv_res.data or []
    except Exception as exc:
        logger.exception("sync_period invoice fetch failed")
        return {"ok": False, "error": str(exc), "synced": 0, "skipped": 0}

    invoices = [i for i in all_in_period if (i.get("status") or "").strip() in POSTABLE_AP_STATUSES]
    company = _fetch_company_config(company_id)
    ws_id = workspace_id or company.get("workspace_id") or company_id

    synced = 0
    skipped = 0
    duplicates_blocked = 0
    needs_review = 0
    errors: list[str] = []
    items: list[dict[str, Any]] = []

    def _item(inv: dict[str, Any], result: str, detail: str = "") -> None:
        items.append(
            {
                "invoice_id": inv.get("id"),
                "invoice_number": inv.get("invoice_number"),
                "vendor_name": inv.get("vendor_name"),
                "total_amount": inv.get("total_amount"),
                "status": inv.get("status"),
                "result": result,
                "detail": detail,
            }
        )

    for inv in all_in_period:
        if (inv.get("status") or "").strip() not in POSTABLE_AP_STATUSES:
            _item(inv, "awaiting_approval", f"Status {inv.get('status') or 'unknown'} — syncs once approved")

    for inv in invoices:
        iid = inv.get("id")
        if not iid:
            continue

        sup_result = sync_approved_invoice_to_gulftax(iid, company_id, workspace_id=ws_id)
        sup_skipped = bool(sup_result.get("skipped"))
        dup_kind = sup_result.get("duplicate")
        if dup_kind:
            dup_of = sup_result.get("duplicate_of") or {}
            label = {
                "exact": "Exact duplicate (same vendor TRN + invoice number)",
                "strong": "Strong duplicate (same vendor TRN + date + amount)",
                "possible": "Possible duplicate (same vendor + date + amount)",
            }[dup_kind]
            detail = f"{label} of {dup_of.get('invoice_number') or 'existing GulfTax row'}"
            if dup_kind == "possible":
                needs_review += 1
                _item(inv, "needs_review", detail)
            else:
                duplicates_blocked += 1
                _item(inv, "duplicate_blocked", detail)
            continue
        if not sup_result.get("ok") and not sup_skipped:
            errors.append(f"{iid}:supabase:{sup_result.get('error')}")

        rds_skipped = True
        rds_new = False
        if db is not None:
            from app.services.ar_gulftax_sync_service import sync_ap_invoice_to_rds_gulftax

            rds_result = sync_ap_invoice_to_rds_gulftax(
                db,
                iid,
                company_id,
                workspace_id=ws_id,
            )
            rds_skipped = bool(rds_result.get("skipped"))
            rds_new = bool(rds_result.get("ok")) and not rds_skipped
            if not rds_result.get("ok") and not rds_skipped:
                errors.append(f"{iid}:rds:{rds_result.get('error')}")
        else:
            logger.warning(
                "sync_period: no RDS session — skipped RDS backfill for invoice %s",
                iid,
            )

        sup_new = bool(sup_result.get("ok")) and not sup_skipped
        if sup_new or rds_new:
            synced += 1
            _item(inv, "synced", f"Posted to {sup_result.get('fta_box') or 'GulfTax'}")
        elif sup_skipped and (db is None or rds_skipped):
            skipped += 1
            _item(inv, "already_in_gulftax", "Already exists in GulfTax — skipped")
        else:
            needs_review += 1
            _item(inv, "needs_review", str(sup_result.get("error") or "Sync failed"))

    # Also promote any Invoice Flow PDF rows that are still 'pending' for this
    # period into 'posted' so Recon Bot and VAT Return can read them.
    pdf_promoted = 0
    if db is not None:
        try:
            from app.models.client_data import GulftaxTransaction

            pending_pdf_rows = (
                db.query(GulftaxTransaction)
                .filter(
                    GulftaxTransaction.company_id == company_id,
                    GulftaxTransaction.tax_period == tax_period,
                    GulftaxTransaction.status == "pending",
                    GulftaxTransaction.source == "invoice_flow_pdf",
                )
                .all()
            )
            for row in pending_pdf_rows:
                row.status = "posted"
                pdf_promoted += 1
            if pdf_promoted:
                db.commit()
        except Exception as exc:
            logger.warning("sync_period: failed to promote Invoice Flow PDF rows: %s", exc)

    return {
        "ok": True,
        "synced": synced,
        "skipped": skipped,
        "total_invoices": len(invoices),
        "found": len(all_in_period),
        "already_in_gulftax": skipped,
        "duplicates_blocked": duplicates_blocked,
        "needs_review": needs_review,
        "awaiting_approval": len(all_in_period) - len(invoices),
        "items": items,
        "pdf_promoted": pdf_promoted,
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
