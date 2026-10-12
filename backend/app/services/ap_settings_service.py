"""AP app_settings / company_settings — Supabase with env fallbacks when tables are missing."""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

_APP_KEYS = ("api_endpoint", "api_endpoint_classify_json")

# app_settings is one deployment-wide table: members may read READABLE_KEYS, platform admins may write
# WRITABLE_KEYS, and SECRET_KEYS never leave the backend (the table itself is service-role only).
READABLE_KEYS = frozenset({
    "ifrs_enabled", "api_endpoint", "api_endpoint_classify_json",
    "email_webhook_url", "email_polling_frequency", "email_sender_whitelist", "email_config",
    "tally_url", "tally_company", "tally_enabled", "tally_version",
    "ap_zoho_last_sync", "ap_qb_last_sync",
})
SECRET_KEYS = frozenset({"zoho_client_secret", "zoho_refresh_token", "qb_client_secret", "qb_refresh_token"})
WRITABLE_KEYS = READABLE_KEYS - {"ap_zoho_last_sync", "ap_qb_last_sync"} | SECRET_KEYS | {
    "zoho_client_id", "zoho_organization_id", "zoho_domain", "qb_client_id", "qb_realm_id", "qb_environment",
}
_COMPANY_DEFAULTS: dict[str, Any] = {
    "country": "AE",
    "base_currency": "AED",
    "accounting_standard": "IFRS",
    "date_format": "DD-MM-YYYY",
    "timezone": "Asia/Dubai",
    "fy_start": "01-01",
}


def _env_app_settings() -> dict[str, str]:
    return {
        "api_endpoint": (os.getenv("N8N_WEBHOOK_URL") or os.getenv("VITE_N8N_WEBHOOK_URL") or "").strip(),
        "api_endpoint_classify_json": (
            os.getenv("N8N_CLASSIFY_JSON_URL") or os.getenv("VITE_N8N_CLASSIFY_URL") or ""
        ).strip(),
    }


def _is_missing_table_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "schema cache" in msg or "does not exist" in msg or "404" in msg


def get_app_settings() -> dict[str, str]:
    """Read n8n webhook URLs from Supabase app_settings, else env vars."""
    out = _env_app_settings()
    try:
        from app.core.supabase import get_supabase

        sb = get_supabase()
        res = (
            sb.table("app_settings")
            .select("setting_key, setting_value")
            .in_("setting_key", list(_APP_KEYS))
            .execute()
        )
        for row in res.data or []:
            key = row.get("setting_key")
            val = (row.get("setting_value") or "").strip()
            if key in _APP_KEYS and val:
                out[key] = val
    except Exception as exc:
        if not _is_missing_table_error(exc):
            logger.warning("app_settings Supabase read failed: %s", exc)
    return out


def get_app_setting(key: str) -> str | None:
    """Read a single app_settings value from Supabase."""
    try:
        from app.core.supabase import get_supabase

        sb = get_supabase()
        res = (
            sb.table("app_settings")
            .select("setting_value")
            .eq("setting_key", key)
            .maybe_single()
            .execute()
        )
        if res.data:
            val = (res.data.get("setting_value") or "").strip()
            return val or None
    except Exception as exc:
        if not _is_missing_table_error(exc):
            logger.warning("app_settings read %s failed: %s", key, exc)
    return None


def get_app_settings_map(keys: list[str]) -> dict[str, str]:
    """Read several app_settings values in one query (missing keys are omitted)."""
    if not keys:
        return {}
    try:
        from app.core.supabase import get_supabase

        res = (
            get_supabase()
            .table("app_settings")
            .select("setting_key, setting_value")
            .in_("setting_key", list(keys))
            .execute()
        )
        return {
            str(r["setting_key"]): str(r.get("setting_value") or "")
            for r in (res.data or [])
            if r.get("setting_key")
        }
    except Exception as exc:
        if not _is_missing_table_error(exc):
            logger.warning("app_settings bulk read failed: %s", exc)
        return {}


def upsert_app_setting(key: str, value: str) -> None:
    """Write or update a single app_settings row."""
    from app.core.supabase import get_supabase

    sb = get_supabase()
    existing = (
        sb.table("app_settings")
        .select("id")
        .eq("setting_key", key)
        .maybe_single()
        .execute()
    )
    payload = {"setting_value": value, "updated_at": datetime.now(timezone.utc).isoformat()}
    if existing.data:
        sb.table("app_settings").update(payload).eq("setting_key", key).execute()
    else:
        sb.table("app_settings").insert({"setting_key": key, **payload}).execute()


def get_company_settings(company_id: str | None = None) -> dict[str, Any]:
    """Read company_settings row or return safe defaults."""
    out: dict[str, Any] = dict(_COMPANY_DEFAULTS)
    try:
        from app.core.supabase import get_supabase

        sb = get_supabase()
        q = sb.table("company_settings").select("*").order("updated_at", desc=True).limit(1)
        if company_id:
            q = q.eq("company_id", company_id)
        res = q.maybe_single().execute()
        if res.data:
            out.update({k: v for k, v in res.data.items() if v is not None})
    except Exception as exc:
        if not _is_missing_table_error(exc):
            logger.warning("company_settings Supabase read failed: %s", exc)
    return out
