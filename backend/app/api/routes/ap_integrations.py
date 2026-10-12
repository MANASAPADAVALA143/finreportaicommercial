"""
AP Integrations — Zoho Books & QuickBooks OAuth for InvoiceFlow.

OAuth tokens are persisted to Supabase app_settings (same keys as AP Settings UI).
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

import re
from datetime import timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from jose import JWTError, jwt

from app.core.config import settings
from app.core.tenant_scope import platform_admin, workspace_member
from app.middleware.workspace import WorkspaceContext
from app.services.ap_settings_service import get_app_setting, upsert_app_setting

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ap/integrations", tags=["AP Integrations"], dependencies=[Depends(workspace_member)])
# OAuth providers redirect the browser here without our bearer token; the signed `state` is the guard.
callback_router = APIRouter(prefix="/api/ap/integrations", tags=["AP Integrations"])

_STATE_TTL = timedelta(minutes=15)
_ZOHO_DOMAINS = re.compile(r"^(com|eu|in|com\.au|jp|ca|com\.cn|sa|uk)$")


def _oauth_state(provider: str, ctx: WorkspaceContext) -> str:
    claims = {
        "typ": "ap_oauth_state",
        "provider": provider,
        "sub": str(getattr(ctx.user, "id", "")),
        "exp": datetime.now(timezone.utc) + _STATE_TTL,
    }
    return jwt.encode(claims, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def _check_state(provider: str, state: str | None) -> None:
    try:
        claims = jwt.decode(state or "", settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        claims = {}
    if claims.get("typ") != "ap_oauth_state" or claims.get("provider") != provider:
        raise HTTPException(400, detail="Invalid or expired OAuth state; start the connection again")


def _zoho_domain(value: str) -> str:
    domain = value.lstrip(".")
    if not _ZOHO_DOMAINS.match(domain):
        raise HTTPException(400, detail="Unknown Zoho data centre")
    return domain


def _error_redirect(provider: str, exc: Exception) -> RedirectResponse:
    query = urlencode({"error": provider, "detail": str(exc)[:300]})
    return RedirectResponse(f"{FRONTEND_URL}/ap-invoices/integrations?{query}")

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
ZOHO_REDIRECT = os.getenv(
    "AP_ZOHO_REDIRECT_URI",
    "http://localhost:8000/api/ap/integrations/zoho/callback",
)
QBO_REDIRECT = os.getenv(
    "AP_QBO_REDIRECT_URI",
    "http://localhost:8000/api/ap/integrations/qbo/callback",
)

ZOHO_AP_SCOPES = (
    "ZohoBooks.bills.CREATE,ZohoBooks.bills.READ,"
    "ZohoBooks.contacts.READ,ZohoBooks.settings.READ"
)
QBO_SCOPE = "com.intuit.quickbooks.accounting"


def _zoho_creds() -> tuple[str, str, str]:
    client_id = get_app_setting("zoho_client_id") or os.getenv("ZOHO_CLIENT_ID", "")
    client_secret = get_app_setting("zoho_client_secret") or os.getenv("ZOHO_CLIENT_SECRET", "")
    domain = get_app_setting("zoho_domain") or "com"
    if not client_id or not client_secret:
        raise HTTPException(
            503,
            detail="Zoho client_id/secret not configured — add them in AP Settings first",
        )
    return client_id, client_secret, domain


def _qbo_creds() -> tuple[str, str, str]:
    client_id = get_app_setting("qb_client_id") or os.getenv("QBO_CLIENT_ID", "")
    client_secret = get_app_setting("qb_client_secret") or os.getenv("QBO_CLIENT_SECRET", "")
    environment = get_app_setting("qb_environment") or os.getenv("QBO_ENVIRONMENT", "sandbox")
    if not client_id or not client_secret:
        raise HTTPException(
            503,
            detail="QuickBooks client_id/secret not configured — add them in AP Settings first",
        )
    return client_id, client_secret, environment


def _record_sync(provider: str, ok: bool, message: str, count: int = 0) -> None:
    key = "ap_zoho_last_sync" if provider == "zoho" else "ap_qb_last_sync"
    upsert_app_setting(
        key,
        __import__("json").dumps(
            {
                "at": datetime.now(timezone.utc).isoformat(),
                "status": "success" if ok else "error",
                "message": message,
                "count": count,
            }
        ),
    )


# ── Zoho OAuth ─────────────────────────────────────────────────────────────────

@router.get("/zoho/auth-url")
def zoho_auth_url(ctx: WorkspaceContext = Depends(platform_admin)) -> dict[str, str]:
    client_id, _, domain = _zoho_creds()
    accounts = f"https://accounts.zoho.{domain}"
    params = urlencode(
        {
            "scope": ZOHO_AP_SCOPES,
            "client_id": client_id,
            "response_type": "code",
            "redirect_uri": ZOHO_REDIRECT,
            "access_type": "offline",
            "prompt": "consent",
            "state": _oauth_state("zoho", ctx),
        }
    )
    return {"auth_url": f"{accounts}/oauth/v2/auth?{params}"}


@callback_router.get("/zoho/callback")
def zoho_callback(
    code: str = Query(...),
    state: str | None = Query(default=None),
    location: str | None = Query(default=None),
):
    _check_state("zoho", state)
    client_id, client_secret, domain = _zoho_creds()
    if location:
        domain = _zoho_domain(location)
    accounts = f"https://accounts.zoho.{domain}"

    try:
        with httpx.Client(timeout=20.0) as client:
            token_res = client.post(
                f"{accounts}/oauth/v2/token",
                data={
                    "grant_type": "authorization_code",
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uri": ZOHO_REDIRECT,
                    "code": code,
                },
            )
            tokens = token_res.json()
            if "error" in tokens or not tokens.get("access_token"):
                raise ValueError(tokens.get("error") or tokens)

            access_token = tokens["access_token"]
            api_domain = tokens.get("api_domain", f"https://www.zohoapis.{domain}")
            refresh_token = tokens.get("refresh_token", "")

            org_res = client.get(
                f"{api_domain}/books/v3/organizations",
                headers={"Authorization": f"Zoho-oauthtoken {access_token}"},
            )
            orgs = org_res.json().get("organizations", [])
            org_id = str(orgs[0].get("organization_id", "")) if orgs else ""
    except Exception as exc:
        log.exception("Zoho AP OAuth failed")
        return _error_redirect("zoho", exc)

    upsert_app_setting("zoho_client_id", client_id)
    upsert_app_setting("zoho_client_secret", client_secret)
    upsert_app_setting("zoho_domain", domain)
    if refresh_token:
        upsert_app_setting("zoho_refresh_token", refresh_token)
    if org_id:
        upsert_app_setting("zoho_organization_id", org_id)
    upsert_app_setting("zoho_access_token", access_token)
    expires = int(tokens.get("expires_in", 3600))
    upsert_app_setting(
        "zoho_access_token_expiry",
        str(int(datetime.now(timezone.utc).timestamp() * 1000) + expires * 1000),
    )
    _record_sync("zoho", True, "OAuth connected", 0)
    return RedirectResponse(f"{FRONTEND_URL}/ap-invoices/integrations?connected=zoho")


# ── QuickBooks OAuth ───────────────────────────────────────────────────────────

@router.get("/qbo/auth-url")
def qbo_auth_url(ctx: WorkspaceContext = Depends(platform_admin)) -> dict[str, str]:
    client_id, _, _ = _qbo_creds()
    params = urlencode(
        {
            "client_id": client_id,
            "scope": QBO_SCOPE,
            "redirect_uri": QBO_REDIRECT,
            "response_type": "code",
            "state": _oauth_state("qbo", ctx),
        }
    )
    return {"auth_url": f"https://appcenter.intuit.com/connect/oauth2?{params}"}


@callback_router.get("/qbo/callback")
def qbo_callback(
    code: str = Query(...),
    state: str | None = Query(default=None),
    realmId: str = Query(default=""),
):
    _check_state("qbo", state)
    client_id, client_secret, environment = _qbo_creds()
    import base64

    basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    try:
        with httpx.Client(timeout=20.0) as client:
            token_res = client.post(
                "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
                headers={
                    "Authorization": f"Basic {basic}",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/json",
                },
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": QBO_REDIRECT,
                },
            )
            tokens = token_res.json()
            if not tokens.get("access_token"):
                raise ValueError(tokens)

            access_token = tokens["access_token"]
            refresh_token = tokens.get("refresh_token", "")
    except Exception as exc:
        log.exception("QBO AP OAuth failed")
        return _error_redirect("qbo", exc)

    upsert_app_setting("qb_client_id", client_id)
    upsert_app_setting("qb_client_secret", client_secret)
    upsert_app_setting("qb_environment", environment)
    if refresh_token:
        upsert_app_setting("qb_refresh_token", refresh_token)
    if realmId:
        upsert_app_setting("qb_realm_id", realmId)
    upsert_app_setting("qb_access_token", access_token)
    expires = int(tokens.get("expires_in", 3600))
    upsert_app_setting(
        "qb_access_token_expiry",
        str(int(datetime.now(timezone.utc).timestamp() * 1000) + expires * 1000),
    )
    _record_sync("quickbooks", True, "OAuth connected", 0)
    return RedirectResponse(f"{FRONTEND_URL}/ap-invoices/integrations?connected=quickbooks")


# ── Status & sync ──────────────────────────────────────────────────────────────

@router.get("/status")
def integration_status() -> dict[str, Any]:
    zoho_rt = get_app_setting("zoho_refresh_token")
    zoho_org = get_app_setting("zoho_organization_id")
    qb_rt = get_app_setting("qb_refresh_token")
    qb_realm = get_app_setting("qb_realm_id")

    import json

    def _parse_sync(key: str) -> dict[str, Any]:
        raw = get_app_setting(key)
        if not raw:
            return {"at": None, "status": "never"}
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"at": raw, "status": "success"}

    z_sync = _parse_sync("ap_zoho_last_sync")
    q_sync = _parse_sync("ap_qb_last_sync")

    return {
        "integrations": [
            {
                "id": "zoho",
                "connected": bool(zoho_rt and zoho_org),
                "configured": bool(zoho_rt),
                "last_sync_at": z_sync.get("at"),
                "last_sync_status": z_sync.get("status", "never"),
                "message": z_sync.get("message"),
            },
            {
                "id": "quickbooks",
                "connected": bool(qb_rt and qb_realm),
                "configured": bool(qb_rt),
                "last_sync_at": q_sync.get("at"),
                "last_sync_status": q_sync.get("status", "never"),
                "message": q_sync.get("message"),
            },
        ]
    }


@router.post("/zoho/sync", dependencies=[Depends(platform_admin)])
async def sync_zoho() -> dict[str, Any]:
    """Refresh Zoho token and verify API access (bill list probe)."""
    refresh = get_app_setting("zoho_refresh_token")
    org_id = get_app_setting("zoho_organization_id")
    if not refresh or not org_id:
        raise HTTPException(400, detail="Zoho not connected — complete OAuth first")

    client_id, client_secret, domain = _zoho_creds()
    accounts = f"https://accounts.zoho.{domain}"
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            tr = await client.post(
                f"{accounts}/oauth/v2/token",
                data={
                    "grant_type": "refresh_token",
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "refresh_token": refresh,
                },
            )
            tokens = tr.json()
            access = tokens.get("access_token")
            if not access:
                raise ValueError(tokens.get("error") or "token refresh failed")

            api_domain = tokens.get("api_domain", f"https://www.zohoapis.{domain}")
            bills = await client.get(
                f"{api_domain}/books/v3/bills",
                params={"organization_id": org_id, "per_page": 1},
                headers={"Authorization": f"Zoho-oauthtoken {access}"},
            )
            count = bills.json().get("page_context", {}).get("total", 0)
            upsert_app_setting("zoho_access_token", access)
            expires = int(tokens.get("expires_in", 3600))
            upsert_app_setting(
                "zoho_access_token_expiry",
                str(int(datetime.now(timezone.utc).timestamp() * 1000) + expires * 1000),
            )
    except Exception as exc:
        _record_sync("zoho", False, str(exc))
        raise HTTPException(500, detail=f"Zoho sync failed: {exc}") from exc

    msg = f"Zoho connected — {count} bills in organisation"
    _record_sync("zoho", True, msg, int(count))
    return {"ok": True, "message": msg, "count": int(count)}


@router.post("/quickbooks/sync", dependencies=[Depends(platform_admin)])
async def sync_quickbooks() -> dict[str, Any]:
    """Refresh QBO token and verify API access."""
    refresh = get_app_setting("qb_refresh_token")
    realm_id = get_app_setting("qb_realm_id")
    if not refresh or not realm_id:
        raise HTTPException(400, detail="QuickBooks not connected — complete OAuth first")

    client_id, client_secret, environment = _qbo_creds()
    import base64

    basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    base_url = (
        "https://sandbox-quickbooks.api.intuit.com"
        if environment == "sandbox"
        else "https://quickbooks.api.intuit.com"
    )
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            tr = await client.post(
                "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
                headers={
                    "Authorization": f"Basic {basic}",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                data={"grant_type": "refresh_token", "refresh_token": refresh},
            )
            tokens = tr.json()
            access = tokens.get("access_token")
            if not access:
                raise ValueError(tokens)

            query = "select count(*) from Bill"
            bills = await client.get(
                f"{base_url}/v3/company/{realm_id}/query",
                params={"query": query, "minorversion": "65"},
                headers={
                    "Authorization": f"Bearer {access}",
                    "Accept": "application/json",
                },
            )
            data = bills.json()
            count = 0
            qr = data.get("QueryResponse", {})
            if "totalCount" in qr:
                count = int(qr["totalCount"])
            elif qr.get("Bill"):
                count = len(qr["Bill"])

            upsert_app_setting("qb_access_token", access)
            expires = int(tokens.get("expires_in", 3600))
            upsert_app_setting(
                "qb_access_token_expiry",
                str(int(datetime.now(timezone.utc).timestamp() * 1000) + expires * 1000),
            )
    except Exception as exc:
        _record_sync("quickbooks", False, str(exc))
        raise HTTPException(500, detail=f"QuickBooks sync failed: {exc}") from exc

    msg = f"QuickBooks connected — {count} vendor bills found"
    _record_sync("quickbooks", True, msg, count)
    return {"ok": True, "message": msg, "count": count}
