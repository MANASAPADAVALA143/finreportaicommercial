"""Sync FinReportAI workspaces (SQLite) to AP Supabase companies (service role)."""

from __future__ import annotations

import logging
import re
from typing import Any

from app.core.supabase import get_supabase
from app.models.workspace import Workspace

logger = logging.getLogger(__name__)


def _slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return base or "company"


def sync_ap_company_for_workspace(ws: Workspace) -> dict[str, Any] | None:
    """Upsert a Supabase companies row linked to this workspace. Uses service role (bypasses RLS)."""
    try:
        sb = get_supabase()
    except RuntimeError as exc:
        logger.warning("AP company sync skipped — Supabase not configured: %s", exc)
        return None

    ws_id = ws.id
    try:
        existing = (
            sb.table("companies")
            .select("*")
            .eq("workspace_id", ws_id)
            .maybe_single()
            .execute()
        )
        if existing.data:
            company = existing.data
            country = (ws.country or "").lower()
            if country in ("uae", "ae") and company.get("market") != "uae":
                try:
                    sb.table("companies").update({"market": "uae"}).eq("id", company["id"]).execute()
                    company = {**company, "market": "uae"}
                except Exception as exc:
                    logger.warning("companies market→uae update failed: %s", exc)
            return company
    except Exception as exc:
        logger.warning("companies lookup by workspace_id failed (%s): %s", ws_id, exc)

    slug = f"{_slugify(ws.name)}-{ws_id[:8]}"
    country = (ws.country or "").lower()
    market = "uae" if country in ("uae", "ae") else "india"

    row: dict[str, Any] = {
        "name": ws.name,
        "slug": slug,
        "industry": ws.industry or "general",
        "accounting_standard": "IFRS",
        "market": market,
        "subscription_tier": "starter",
        "subscription_status": "trial",
        "max_invoices_per_month": 100,
        "max_users": 5,
        "workspace_id": ws_id,
    }

    try:
        inserted = sb.table("companies").insert(row).execute()
        if inserted.data:
            company = inserted.data[0]
            _ensure_company_config(sb, company["id"])
            return company
    except Exception as exc:
        logger.warning("companies insert failed (%s): %s", ws_id, exc)
        # Race on slug — re-fetch
        try:
            retry = (
                sb.table("companies")
                .select("*")
                .eq("workspace_id", ws_id)
                .maybe_single()
                .execute()
            )
            if retry.data:
                return retry.data
        except Exception:
            pass

    return None


def _ensure_company_config(sb: Any, company_id: str) -> None:
    try:
        sb.table("company_config").upsert({"company_id": company_id}, on_conflict="company_id").execute()
    except Exception as exc:
        logger.warning("company_config upsert failed for %s: %s", company_id, exc)
