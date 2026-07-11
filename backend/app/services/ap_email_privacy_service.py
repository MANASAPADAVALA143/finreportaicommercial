"""Email invoice intake — consent logging and erasure (DPDP)."""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

EMAIL_INVOICE_CONSENT_TYPE = "email_invoice_processing"
EMAIL_INVOICE_CONSENT_VERSION = "2026-07-09-v1"
EMAIL_SOURCES = ("email", "email_n8n")


def _sb():
    from app.core.supabase import get_supabase

    return get_supabase()


def assert_company_member_access(
    company_id: str,
    *,
    user_id: str | None,
    user_email: str | None,
    is_super_admin: bool = False,
) -> None:
    if is_super_admin:
        return
    sb = _sb()
    if user_id:
        res = (
            sb.table("company_members")
            .select("id")
            .eq("company_id", company_id)
            .eq("user_id", user_id)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        if res.data:
            return
    if user_email:
        res = (
            sb.table("company_members")
            .select("id")
            .eq("company_id", company_id)
            .eq("email", user_email)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        if res.data:
            return
    raise PermissionError("Not authorized for this company")


def get_active_consent(company_id: str) -> dict[str, Any] | None:
    sb = _sb()
    res = (
        sb.table("consent_log")
        .select("*")
        .eq("company_id", company_id)
        .eq("consent_type", EMAIL_INVOICE_CONSENT_TYPE)
        .is_("withdrawn_at", "null")
        .order("accepted_at", desc=True)
        .limit(1)
        .maybe_single()
        .execute()
    )
    return res.data if res.data else None


def record_consent(
    *,
    company_id: str,
    accepted_by_user_id: str | None,
    accepted_by_email: str | None,
    consent_version: str,
    ip_address: str | None,
    user_agent: str | None,
) -> dict[str, Any]:
    sb = _sb()
    existing = get_active_consent(company_id)
    if existing and existing.get("consent_version") == consent_version:
        return existing

    if existing:
        sb.table("consent_log").update(
            {"withdrawn_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", existing["id"]).execute()

    payload = {
        "company_id": company_id,
        "consent_type": EMAIL_INVOICE_CONSENT_TYPE,
        "accepted_by_user_id": accepted_by_user_id,
        "accepted_by_email": accepted_by_email,
        "consent_version": consent_version,
        "ip_address": ip_address,
        "user_agent": user_agent,
        "metadata": {"product": "finreportai", "module": "ap_email_intake"},
    }
    res = sb.table("consent_log").insert(payload).select("*").single().execute()
    if not res.data:
        raise RuntimeError("Failed to record consent")
    return res.data


def withdraw_consent(company_id: str) -> int:
    sb = _sb()
    now = datetime.now(timezone.utc).isoformat()
    res = (
        sb.table("consent_log")
        .update({"withdrawn_at": now})
        .eq("company_id", company_id)
        .eq("consent_type", EMAIL_INVOICE_CONSENT_TYPE)
        .is_("withdrawn_at", "null")
        .execute()
    )
    return len(res.data or [])


def _storage_path_from_url(file_url: str | None) -> str | None:
    if not file_url or not isinstance(file_url, str):
        return None
    if file_url.startswith("email-"):
        return None
    marker = "/storage/v1/object/public/invoice-files/"
    if marker in file_url:
        return file_url.split(marker, 1)[1].split("?")[0]
    if not file_url.startswith("http"):
        return file_url.lstrip("/")
    return None


def purge_email_intake_data(company_id: str) -> dict[str, int]:
    """Delete email intake logs, deactivate inbox, remove email-sourced invoices + files."""
    sb = _sb()
    counts = {
        "intake_log_deleted": 0,
        "inbox_deactivated": 0,
        "invoices_deleted": 0,
        "storage_files_deleted": 0,
        "consent_withdrawn": 0,
    }

    counts["consent_withdrawn"] = withdraw_consent(company_id)

    log_res = sb.table("email_intake_log").delete().eq("company_id", company_id).execute()
    counts["intake_log_deleted"] = len(log_res.data or [])

    inbox_res = (
        sb.table("email_inbox_config")
        .update({"is_active": False})
        .eq("company_id", company_id)
        .eq("is_active", True)
        .execute()
    )
    counts["inbox_deactivated"] = len(inbox_res.data or [])

    inv_res = (
        sb.table("invoices")
        .select("id, file_url")
        .eq("company_id", company_id)
        .in_("source", list(EMAIL_SOURCES))
        .execute()
    )
    invoices = inv_res.data or []
    paths: list[str] = []
    for inv in invoices:
        path = _storage_path_from_url(inv.get("file_url"))
        if path:
            paths.append(path)

    if paths:
        try:
            sb.storage.from_("invoice-files").remove(paths)
            counts["storage_files_deleted"] = len(paths)
        except Exception as exc:
            logger.warning("Storage purge partial failure for %s: %s", company_id, exc)

    if invoices:
        ids = [str(i["id"]) for i in invoices if i.get("id")]
        del_res = sb.table("invoices").delete().in_("id", ids).execute()
        counts["invoices_deleted"] = len(del_res.data or [])

    try:
        sb.table("audit_logs").insert(
            {
                "action": "email_intake_erasure",
                "details": {"company_id": company_id, **counts},
            }
        ).execute()
    except Exception as exc:
        logger.warning("audit_logs insert after erasure failed: %s", exc)

    return counts


def suggest_forwarding_address(company_slug: str) -> str:
    safe = re.sub(r"[^a-z0-9-]", "", (company_slug or "company").lower())[:32] or "company"
    return f"invoices+{safe}@intake.finreportai.com"
