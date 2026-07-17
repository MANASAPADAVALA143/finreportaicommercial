"""Sync FinReportAI workspaces (SQLite) to AP Supabase companies (service role)."""

from __future__ import annotations

import logging
import re
from typing import Any

from sqlalchemy.orm import Session

from app.core.supabase import get_supabase
from app.models.client_data import ApCompany
from app.models.workspace import Workspace

logger = logging.getLogger(__name__)


def _slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return base or "company"


def _apply_uae_market(sb: Any, ws: Workspace, company: dict[str, Any]) -> dict[str, Any]:
    country = (ws.country or "").lower()
    if country in ("uae", "ae") and company.get("market") != "uae":
        try:
            sb.table("companies").update({"market": "uae"}).eq("id", company["id"]).execute()
            return {**company, "market": "uae"}
        except Exception as exc:
            logger.warning("companies market→uae update failed: %s", exc)
    return company


def _link_orphan_company(sb: Any, ws: Workspace, ws_id: str) -> dict[str, Any] | None:
    """
    Pre-migration / bulk-import tenants often have a single companies row with
    workspace_id NULL (e.g. slug my-company holding all invoices). Link it
    instead of inserting a second empty company for the same workspace.
    """
    try:
        orphans = (
            sb.table("companies")
            .select("*")
            .is_("workspace_id", "null")
            .execute()
        )
    except Exception as exc:
        logger.warning("orphan companies lookup failed: %s", exc)
        return None

    rows = list(orphans.data or [])
    if not rows:
        return None

    chosen: dict[str, Any] | None = None
    if len(rows) == 1:
        chosen = rows[0]
    else:
        # Prefer default slug / matching workspace name when several orphans exist
        by_slug = next((r for r in rows if (r.get("slug") or "") == "my-company"), None)
        by_name = next(
            (r for r in rows if (r.get("name") or "").strip().lower() == (ws.name or "").strip().lower()),
            None,
        )
        chosen = by_slug or by_name

    if not chosen or not chosen.get("id"):
        return None

    try:
        updated = (
            sb.table("companies")
            .update({"workspace_id": ws_id})
            .eq("id", chosen["id"])
            .select("*")
            .maybe_single()
            .execute()
        )
        company = updated.data or {**chosen, "workspace_id": ws_id}
        logger.info(
            "Linked orphan AP company %s (%s) → workspace %s",
            company.get("id"),
            company.get("name"),
            ws_id,
        )
        _ensure_company_config(sb, company["id"])
        return _apply_uae_market(sb, ws, company)
    except Exception as exc:
        logger.warning("orphan company link failed (%s → %s): %s", chosen.get("id"), ws_id, exc)
        return None


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
            return _apply_uae_market(sb, ws, existing.data)
    except Exception as exc:
        logger.warning("companies lookup by workspace_id failed (%s): %s", ws_id, exc)

    linked = _link_orphan_company(sb, ws, ws_id)
    if linked:
        return linked

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


def upsert_ap_company_rds(db: Session, workspace: Workspace, company: dict[str, Any]) -> ApCompany:
    """Mirror Supabase companies row into RDS ap_companies (same id)."""
    cid = str(company["id"])
    slug = str(company.get("slug") or _slugify(str(company.get("name") or workspace.name)))
    row = db.get(ApCompany, cid)
    if row:
        row.name = str(company.get("name") or row.name)
        row.slug = slug
        row.tenant_id = workspace.id
        row.market = str(company.get("market") or row.market or "uae")
    else:
        row = ApCompany(
            id=cid,
            tenant_id=workspace.id,
            name=str(company.get("name") or workspace.name),
            slug=slug,
            market=str(company.get("market") or "uae"),
            accounting_standard=str(company.get("accounting_standard") or "IFRS"),
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _ensure_company_config(sb: Any, company_id: str) -> None:
    try:
        sb.table("company_config").upsert({"company_id": company_id}, on_conflict="company_id").execute()
    except Exception as exc:
        logger.warning("company_config upsert failed for %s: %s", company_id, exc)
