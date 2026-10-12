"""
AP Integrations — Zoho Books & QuickBooks OAuth for InvoiceFlow.

OAuth tokens are persisted to Supabase app_settings (same keys as AP Settings UI).
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.company_access import require_invoice_access
from app.core.config import settings
from app.core.database import get_db
from app.core.supabase import get_supabase
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
    domain = _zoho_domain(get_app_setting("zoho_domain") or "com")
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
        json.dumps(
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


# -- Status, credentials & sync -------------------------------------------------

@router.get("/status")
def integration_status() -> dict[str, Any]:
    zoho_rt = get_app_setting("zoho_refresh_token")
    zoho_org = get_app_setting("zoho_organization_id")
    qb_rt = get_app_setting("qb_refresh_token")
    qb_realm = get_app_setting("qb_realm_id")

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


@router.get("/credentials", dependencies=[Depends(platform_admin)])
def integration_credentials() -> dict[str, Any]:
    """Non-secret connection fields for the Settings form; secrets are reported only as present or not."""
    return {
        "zoho": {
            "client_id": get_app_setting("zoho_client_id") or "",
            "organization_id": get_app_setting("zoho_organization_id") or "",
            "domain": get_app_setting("zoho_domain") or "in",
            "has_client_secret": bool(get_app_setting("zoho_client_secret")),
            "has_refresh_token": bool(get_app_setting("zoho_refresh_token")),
        },
        "quickbooks": {
            "client_id": get_app_setting("qb_client_id") or "",
            "realm_id": get_app_setting("qb_realm_id") or "",
            "environment": get_app_setting("qb_environment") or "production",
            "has_client_secret": bool(get_app_setting("qb_client_secret")),
            "has_refresh_token": bool(get_app_setting("qb_refresh_token")),
        },
    }


def _expiry_ms(tokens: dict[str, Any]) -> str:
    expires = int(tokens.get("expires_in", 3600))
    return str(int(datetime.now(timezone.utc).timestamp() * 1000) + expires * 1000)


def _cached_token(prefix: str) -> str | None:
    token = get_app_setting(f"{prefix}_access_token")
    expiry = get_app_setting(f"{prefix}_access_token_expiry") or ""
    now_ms = datetime.now(timezone.utc).timestamp() * 1000
    if token and expiry.isdigit() and now_ms < int(expiry) - 60_000:
        return token
    return None


async def _zoho_token(client: httpx.AsyncClient) -> tuple[str, str]:
    """Access token and API base for the shared Zoho org, refreshing (and caching) when needed."""
    client_id, client_secret, domain = _zoho_creds()
    api_domain = f"https://www.zohoapis.{domain}"
    cached = _cached_token("zoho")
    if cached:
        return cached, api_domain
    refresh = get_app_setting("zoho_refresh_token")
    if not refresh:
        raise HTTPException(400, detail="Zoho not connected — complete OAuth first")
    tr = await client.post(
        f"https://accounts.zoho.{domain}/oauth/v2/token",
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
    upsert_app_setting("zoho_access_token", access)
    upsert_app_setting("zoho_access_token_expiry", _expiry_ms(tokens))
    return access, tokens.get("api_domain", api_domain)


async def _qbo_token(client: httpx.AsyncClient) -> tuple[str, str, str]:
    """Access token, API base and realm for the shared QuickBooks company; Intuit rotates refresh tokens."""
    client_id, client_secret, environment = _qbo_creds()
    refresh = get_app_setting("qb_refresh_token")
    realm_id = get_app_setting("qb_realm_id")
    if not refresh or not realm_id:
        raise HTTPException(400, detail="QuickBooks not connected — complete OAuth first")
    base_url = (
        "https://sandbox-quickbooks.api.intuit.com"
        if environment == "sandbox"
        else "https://quickbooks.api.intuit.com"
    )
    cached = _cached_token("qb")
    if cached:
        return cached, base_url, realm_id
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    tr = await client.post(
        "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
        headers={
            "Authorization": f"Basic {basic}",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        data={"grant_type": "refresh_token", "refresh_token": refresh},
    )
    tokens = tr.json()
    access = tokens.get("access_token")
    if not access:
        raise ValueError(tokens.get("error_description") or tokens.get("error") or "token refresh failed")
    upsert_app_setting("qb_access_token", access)
    upsert_app_setting("qb_access_token_expiry", _expiry_ms(tokens))
    if tokens.get("refresh_token"):
        upsert_app_setting("qb_refresh_token", tokens["refresh_token"])
    return access, base_url, realm_id


@router.post("/zoho/sync", dependencies=[Depends(platform_admin)])
async def sync_zoho() -> dict[str, Any]:
    """Refresh Zoho token and verify API access (bill list probe)."""
    org_id = get_app_setting("zoho_organization_id")
    if not org_id:
        raise HTTPException(400, detail="Zoho not connected — complete OAuth first")
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            access, api_domain = await _zoho_token(client)
            bills = await client.get(
                f"{api_domain}/books/v3/bills",
                params={"organization_id": org_id, "per_page": 1},
                headers={"Authorization": f"Zoho-oauthtoken {access}"},
            )
            count = bills.json().get("page_context", {}).get("total", 0)
    except HTTPException:
        raise
    except Exception as exc:
        _record_sync("zoho", False, str(exc))
        raise HTTPException(500, detail=f"Zoho sync failed: {exc}") from exc

    msg = f"Zoho connected — {count} bills in organisation"
    _record_sync("zoho", True, msg, int(count))
    return {"ok": True, "message": msg, "count": int(count)}


@router.post("/quickbooks/sync", dependencies=[Depends(platform_admin)])
async def sync_quickbooks() -> dict[str, Any]:
    """Refresh QBO token and verify API access."""
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            access, base_url, realm_id = await _qbo_token(client)
            bills = await client.get(
                f"{base_url}/v3/company/{realm_id}/query",
                params={"query": "select count(*) from Bill", "minorversion": "65"},
                headers={"Authorization": f"Bearer {access}", "Accept": "application/json"},
            )
            qr = bills.json().get("QueryResponse", {})
            count = int(qr["totalCount"]) if "totalCount" in qr else len(qr.get("Bill") or [])
    except HTTPException:
        raise
    except Exception as exc:
        _record_sync("quickbooks", False, str(exc))
        raise HTTPException(500, detail=f"QuickBooks sync failed: {exc}") from exc

    msg = f"QuickBooks connected — {count} vendor bills found"
    _record_sync("quickbooks", True, msg, count)
    return {"ok": True, "message": msg, "count": count}


# -- Push approved invoices as bills ---------------------------------------------

class PushBillIn(BaseModel):
    invoice_id: str


_INVOICE_FIELDS = (
    "id,company_id,vendor_name,invoice_number,invoice_date,due_date,currency,"
    "total_amount,tax_amount,tax_rate,gl_code,gl_name"
)


def _load_invoice(db: Session, ctx: WorkspaceContext, invoice_id: str) -> dict[str, Any]:
    require_invoice_access(db, ctx, [invoice_id], "write")
    rows = get_supabase().table("invoices").select(_INVOICE_FIELDS).eq("id", invoice_id).limit(1).execute().data
    if not rows:
        raise HTTPException(404, detail="Invoice not found")
    return rows[0]


def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


@router.post("/zoho/push-bill")
async def push_bill_to_zoho(
    body: PushBillIn,
    ctx: WorkspaceContext = Depends(platform_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Create a Zoho Books bill for an invoice (the shared org, so platform admins only)."""
    inv = _load_invoice(db, ctx, body.invoice_id)
    org_id = get_app_setting("zoho_organization_id")
    if not org_id:
        raise HTTPException(400, detail="Zoho not connected — complete OAuth first")
    total, tax = _num(inv.get("total_amount")), _num(inv.get("tax_amount"))
    payload = {
        "vendor_name": inv.get("vendor_name"),
        "bill_number": inv.get("invoice_number"),
        "date": inv.get("invoice_date"),
        "due_date": inv.get("due_date"),
        "currency_code": inv.get("currency") or "INR",
        "line_items": [{
            "description": f"Invoice {inv.get('invoice_number')} — {inv.get('vendor_name')}",
            "rate": total - tax,
            "quantity": 1,
            "tax_percentage": inv.get("tax_rate") or 0,
        }],
        "notes": f"Imported from InvoiceFlow. GL: {inv.get('gl_code') or ''} {inv.get('gl_name') or ''}".strip(),
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            access, api_domain = await _zoho_token(client)
            res = await client.post(
                f"{api_domain}/books/v3/bills",
                params={"organization_id": org_id},
                headers={"Authorization": f"Zoho-oauthtoken {access}"},
                json={"JSONString": json.dumps(payload)},
            )
            data = res.json()
    except HTTPException:
        raise
    except Exception as exc:
        return {"success": False, "message": str(exc)}
    if data.get("code") != 0:
        return {"success": False, "message": data.get("message") or f"Zoho error code {data.get('code')}"}
    bill = data.get("bill") or {}
    ref = bill.get("bill_number") or bill.get("bill_id")
    return {
        "success": True,
        "message": f"Bill created in Zoho Books ({ref})",
        "bill_id": bill.get("bill_id"),
        "bill_number": bill.get("bill_number"),
    }


@router.post("/quickbooks/push-bill")
async def push_bill_to_quickbooks(
    body: PushBillIn,
    ctx: WorkspaceContext = Depends(platform_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Create a QuickBooks Online bill for an invoice (the shared company, so platform admins only)."""
    inv = _load_invoice(db, ctx, body.invoice_id)
    total, tax = _num(inv.get("total_amount")), _num(inv.get("tax_amount"))
    payload = {
        "VendorRef": {"name": inv.get("vendor_name")},
        "TxnDate": inv.get("invoice_date") or datetime.now(timezone.utc).date().isoformat(),
        "DocNumber": inv.get("invoice_number"),
        "PrivateNote": f"InvoiceFlow: GL {inv.get('gl_code') or ''} {inv.get('gl_name') or ''}".strip(),
        "Line": [{
            "Amount": total - tax,
            "DetailType": "AccountBasedExpenseLineDetail",
            "Description": f"Invoice {inv.get('invoice_number')} — {inv.get('vendor_name')}",
            "AccountBasedExpenseLineDetail": {
                "AccountRef": {"name": inv.get("gl_name") or "Expenses"},
                "TaxCodeRef": {"value": "TAX" if tax else "NON"},
            },
        }],
        "TotalAmt": total,
    }
    if inv.get("due_date"):
        payload["DueDate"] = inv["due_date"]
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            access, base_url, realm_id = await _qbo_token(client)
            res = await client.post(
                f"{base_url}/v3/company/{realm_id}/bill",
                params={"minorversion": "70"},
                headers={"Authorization": f"Bearer {access}", "Accept": "application/json"},
                json=payload,
            )
            data = res.json()
    except HTTPException:
        raise
    except Exception as exc:
        return {"success": False, "message": str(exc)}
    if res.status_code >= 300:
        err = ((data.get("Fault") or {}).get("Error") or [{}])[0]
        return {"success": False, "message": err.get("Detail") or err.get("Message") or f"HTTP {res.status_code}"}
    bill_id = (data.get("Bill") or {}).get("Id")
    return {
        "success": True,
        "message": f"Bill created in QuickBooks Online (ID: {bill_id or 'unknown'})",
        "bill_id": bill_id,
    }