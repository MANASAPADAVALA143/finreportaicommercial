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
        # supabase-py 2.x: .select() is not valid after .eq() on update filters
        sb.table("companies").update({"workspace_id": ws_id}).eq("id", chosen["id"]).execute()
        refreshed = (
            sb.table("companies")
            .select("*")
            .eq("id", chosen["id"])
            .maybe_single()
            .execute()
        )
        company = refreshed.data or {**chosen, "workspace_id": ws_id}
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


def _ensure_company_config(sb: Any, company_id: str) -> None:
    try:
        sb.table("company_config").upsert({"company_id": company_id}, on_conflict="company_id").execute()
    except Exception as exc:
        logger.warning("company_config upsert failed for %s: %s", company_id, exc)


def ensure_company_member(
    company_id: str,
    user_id: str,
    *,
    role: str = "admin",
    email: str | None = None,
    name: str | None = None,
) -> bool:
    """Add (or reactivate) auth user as company_members row — required for invoices RLS inserts."""
    if not company_id or not user_id:
        return False
    try:
        sb = get_supabase()
    except RuntimeError:
        return False

    role_ok = role if role in (
        "super_admin", "owner", "admin", "finance_manager", "approver", "viewer"
    ) else "admin"
    row: dict[str, Any] = {
        "company_id": company_id,
        "user_id": user_id,
        "role": role_ok,
        "is_active": True,
        "joined_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
    }
    if email:
        row["email"] = email
    if name:
        row["name"] = name

    try:
        sb.table("company_members").upsert(row, on_conflict="company_id,user_id").execute()
        logger.info("Ensured company_members company=%s user=%s", company_id, user_id)
        return True
    except Exception as exc:
        logger.warning("company_members upsert failed: %s — trying insert", exc)
        try:
            existing = (
                sb.table("company_members")
                .select("id")
                .eq("company_id", company_id)
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
            if existing.data:
                sb.table("company_members").update(
                    {"is_active": True, "role": role_ok}
                ).eq("company_id", company_id).eq("user_id", user_id).execute()
                return True
            sb.table("company_members").insert(row).execute()
            return True
        except Exception as exc2:
            logger.exception("company_members ensure failed: %s", exc2)
            return False


def sync_ap_company_for_workspace(
    ws: Workspace,
    *,
    supabase_user_id: str | None = None,
    user_email: str | None = None,
    user_name: str | None = None,
) -> dict[str, Any] | None:
    """Upsert a Supabase companies row linked to this workspace. Uses service role (bypasses RLS).

    When supabase_user_id is provided, also ensures company_members so browser inserts
    (Excel upload) pass invoices RLS.
    """
    try:
        sb = get_supabase()
    except RuntimeError as exc:
        logger.warning("AP company sync skipped — Supabase not configured: %s", exc)
        return None

    ws_id = ws.id
    company: dict[str, Any] | None = None
    try:
        existing = (
            sb.table("companies")
            .select("*")
            .eq("workspace_id", ws_id)
            .maybe_single()
            .execute()
        )
        if existing.data:
            company = _apply_uae_market(sb, ws, existing.data)
    except Exception as exc:
        logger.warning("companies lookup by workspace_id failed (%s): %s", ws_id, exc)

    if not company:
        linked = _link_orphan_company(sb, ws, ws_id)
        if linked:
            company = linked

    if not company:
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
            "max_invoices_per_month": 10000,
            "max_users": 5,
            "workspace_id": ws_id,
        }

        try:
            inserted = sb.table("companies").insert(row).execute()
            if inserted.data:
                company = inserted.data[0]
                _ensure_company_config(sb, company["id"])
        except Exception as exc:
            logger.warning("companies insert failed (%s): %s", ws_id, exc)
            try:
                retry = (
                    sb.table("companies")
                    .select("*")
                    .eq("workspace_id", ws_id)
                    .maybe_single()
                    .execute()
                )
                if retry.data:
                    company = retry.data
            except Exception:
                pass

    if company and supabase_user_id:
        ensure_company_member(
            str(company["id"]),
            supabase_user_id,
            role="admin",
            email=user_email,
            name=user_name,
        )

    return company


def sync_ap_company_for_profile(
    ws: Workspace,
    *,
    company_id: str,
    company_name: str | None = None,
    supabase_user_id: str | None = None,
    user_email: str | None = None,
    user_name: str | None = None,
) -> dict[str, Any] | None:
    """Upsert Supabase AP company with the SAME id as FinReport banner company.

    Multi-company workspaces must not share one AP company via workspace_id alone —
    each FinReport company (e.g. Gnanova UAE Test FZE) owns its own invoices.
    """
    cid = (company_id or "").strip()
    if not cid:
        return None
    try:
        sb = get_supabase()
    except RuntimeError as exc:
        logger.warning("AP profile sync skipped — Supabase not configured: %s", exc)
        return None

    ws_id = ws.id
    name = (company_name or "").strip() or (ws.name or "Company")
    country = (ws.country or "").lower()
    market = "uae" if country in ("uae", "ae") else "india"
    company: dict[str, Any] | None = None

    try:
        existing = (
            sb.table("companies")
            .select("*")
            .eq("id", cid)
            .limit(1)
            .execute()
        )
        rows = list(existing.data or [])
        if rows:
            patch: dict[str, Any] = {
                "workspace_id": ws_id,
                "name": name,
            }
            if market and rows[0].get("market") != market:
                patch["market"] = market
            try:
                sb.table("companies").update(patch).eq("id", cid).execute()
            except Exception as exc:
                logger.warning("companies profile update failed (%s): %s", cid, exc)
            refreshed = (
                sb.table("companies")
                .select("*")
                .eq("id", cid)
                .limit(1)
                .execute()
            )
            company = (refreshed.data or [None])[0] or {**rows[0], **patch}
            _ensure_company_config(sb, cid)
    except Exception as exc:
        logger.warning("companies lookup by id failed (%s): %s", cid, exc)

    if not company:
        slug = f"{_slugify(name)}-{cid[:8]}"
        row: dict[str, Any] = {
            "id": cid,
            "name": name,
            "slug": slug,
            "industry": ws.industry or "general",
            "accounting_standard": "IFRS",
            "market": market,
            "subscription_tier": "starter",
            "subscription_status": "trial",
            "max_invoices_per_month": 10000,
            "max_users": 5,
            "workspace_id": ws_id,
        }
        try:
            inserted = sb.table("companies").insert(row).execute()
            if inserted.data:
                company = inserted.data[0]
            else:
                company = row
            _ensure_company_config(sb, cid)
            logger.info(
                "Created AP company %s (%s) for FinReport profile in workspace %s",
                cid,
                name,
                ws_id,
            )
        except Exception as exc:
            logger.warning("companies insert by profile id failed (%s): %s", cid, exc)
            try:
                retry = (
                    sb.table("companies")
                    .select("*")
                    .eq("id", cid)
                    .limit(1)
                    .execute()
                )
                if retry.data:
                    company = retry.data[0]
            except Exception:
                pass

    if company and supabase_user_id:
        ensure_company_member(
            str(company["id"]),
            supabase_user_id,
            role="admin",
            email=user_email,
            name=user_name,
        )

    # New company in a multi-company workspace: copy members from sibling AP companies
    # so browser RLS inserts (PO / GRN / invoices) work without waiting for re-login.
    if company:
        try:
            siblings = (
                sb.table("companies")
                .select("id")
                .eq("workspace_id", ws_id)
                .neq("id", str(company["id"]))
                .limit(20)
                .execute()
            )
            sibling_ids = [str(r["id"]) for r in (siblings.data or []) if r.get("id")]
            seen_users: set[str] = set()
            for sid in sibling_ids:
                mems = (
                    sb.table("company_members")
                    .select("user_id,role,email,name")
                    .eq("company_id", sid)
                    .eq("is_active", True)
                    .limit(50)
                    .execute()
                )
                for m in mems.data or []:
                    uid = str(m.get("user_id") or "")
                    if not uid or uid in seen_users:
                        continue
                    seen_users.add(uid)
                    ensure_company_member(
                        str(company["id"]),
                        uid,
                        role=str(m.get("role") or "admin"),
                        email=m.get("email"),
                        name=m.get("name"),
                    )
        except Exception as exc:
            logger.warning("sibling company_members copy failed for %s: %s", company.get("id"), exc)

    return company


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
