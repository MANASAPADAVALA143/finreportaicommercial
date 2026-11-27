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
    "total_amount,tax_amount,tax_rate,gl_code,gl_name,erp_zoho_bill_id,erp_qbo_bill_id"
)


class QBOConflictError(Exception):
    """DocNumber exists in QBO for a different vendor or amount — do not create a second bill."""


class QBOUncertainStateError(Exception):
    """POST timed out and a re-query could not confirm whether QBO created the bill."""


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


def _build_qbo_bill_payload(inv: dict[str, Any]) -> dict[str, Any]:
    total, tax = _num(inv.get("total_amount")), _num(inv.get("tax_amount"))
    payload: dict[str, Any] = {
        "VendorRef": {"name": inv.get("vendor_name")},
        "TxnDate": inv.get("invoice_date") or datetime.now(timezone.utc).date().isoformat(),
        "DocNumber": (inv.get("invoice_number") or "")[:21],
        "PrivateNote": f"InvoiceFlow: {inv.get('invoice_number') or ''} GL {inv.get('gl_code') or ''} {inv.get('gl_name') or ''}".strip(),
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
    return payload


async def _qbo_ensure_bill(
    client: httpx.AsyncClient,
    inv: dict[str, Any],
    access: str,
    base_url: str,
    realm_id: str,
) -> str:
    """Idempotently create or find a QBO Bill for inv.

    Returns the Bill.Id on success.  Raises QBOConflictError for a DocNumber
    collision with a different vendor/amount, or QBOUncertainStateError when a
    POST timeout cannot be resolved by a re-query.

    Concurrency guard: claims erp_qbo_bill_id = 'PENDING' via an atomic
    UPDATE … WHERE erp_qbo_bill_id IS NULL before any network call.  Only the
    worker that wins the claim proceeds; others skip the invoice.
    """
    invoice_id = inv["id"]
    doc_number = (inv.get("invoice_number") or "")[:21]
    our_vendor = (inv.get("vendor_name") or "").strip().lower()
    our_amount = _num(inv.get("total_amount"))
    headers = {"Authorization": f"Bearer {access}", "Accept": "application/json"}

    # Step 1: local stamp check — already synced or in-flight by another worker
    existing_stamp = inv.get("erp_qbo_bill_id")
    if existing_stamp:
        if existing_stamp != "PENDING":
            return existing_stamp
        # PENDING → another worker owns this invoice; skip
        raise QBOConflictError(
            f"Invoice {invoice_id} already claimed by another worker (erp_qbo_bill_id=PENDING)"
        )

    # Step 2: optimistic concurrency claim — only one worker proceeds per invoice
    if not existing_stamp:
        claimed = get_supabase().table("invoices") \
            .update({"erp_qbo_bill_id": "PENDING"}) \
            .eq("id", invoice_id) \
            .is_("erp_qbo_bill_id", "null") \
            .execute()
        if not (claimed.data or []):
            raise QBOConflictError(
                f"Invoice {invoice_id} already claimed by another worker (erp_qbo_bill_id is not NULL)"
            )

    async def _query_by_docnumber() -> dict[str, Any] | None:
        resp = await client.get(
            f"{base_url}/v3/company/{realm_id}/query",
            params={"query": f"SELECT * FROM Bill WHERE DocNumber = '{doc_number}'", "minorversion": "70"},
            headers=headers,
            timeout=15.0,
        )
        bills = (resp.json().get("QueryResponse") or {}).get("Bill") or []
        return bills[0] if bills else None

    # Step 3: pre-push duplicate lookup
    our_invoice_number = inv.get("invoice_number") or ""
    existing_bill = await _query_by_docnumber()
    if existing_bill is not None:
        their_vendor = ((existing_bill.get("VendorRef") or {}).get("name") or "").strip().lower()
        their_amount = float(existing_bill.get("TotalAmt") or 0)
        their_note = existing_bill.get("PrivateNote") or ""
        vendor_match = (our_vendor == their_vendor
                        or our_vendor in their_vendor
                        or their_vendor in our_vendor)
        amount_match = abs(our_amount - their_amount) < 0.02
        # Identity check: when DocNumber was truncated (>21 chars), the full invoice number
        # must appear in PrivateNote to confirm this bill belongs to our invoice and not a
        # different invoice that shares the same first 21 characters.
        note_match = (len(our_invoice_number) <= 21) or (our_invoice_number in their_note)
        if vendor_match and amount_match and note_match:
            bill_id = existing_bill["Id"]
            _mark_erp_bill(invoice_id, "erp_qbo_bill_id", bill_id)
            return bill_id
        raise QBOConflictError(
            f"DocNumber {doc_number!r} already in QBO for vendor={their_vendor!r} "
            f"amount={their_amount} note_match={note_match}, "
            f"our invoice={our_invoice_number!r} vendor={our_vendor!r} amount={our_amount}"
        )

    # Step 4: POST new bill
    payload = _build_qbo_bill_payload(inv)
    try:
        res = await client.post(
            f"{base_url}/v3/company/{realm_id}/bill",
            params={"minorversion": "70"},
            headers=headers,
            json=payload,
        )
        data = res.json()
    except httpx.TimeoutException:
        # Step 5: timeout recovery — re-query before giving up
        try:
            recovered = await _query_by_docnumber()
        except Exception:
            recovered = None
        if recovered is not None:
            rec_note = recovered.get("PrivateNote") or ""
            if len(our_invoice_number) <= 21 or our_invoice_number in rec_note:
                bill_id = recovered["Id"]
                _mark_erp_bill(invoice_id, "erp_qbo_bill_id", bill_id)
                return bill_id
            # DocNumber collision with a different invoice — uncertain state
            log.error(
                "_qbo_ensure_bill: timeout recovery found bill %s but PrivateNote does not "
                "contain invoice_number %r — treating as uncertain state",
                recovered["Id"], our_invoice_number,
            )
        log.error(
            "_qbo_ensure_bill: POST timed out for invoice %s DocNumber=%r "
            "and re-query found nothing — manual verification required",
            invoice_id, doc_number,
        )
        raise QBOUncertainStateError(
            f"POST for DocNumber {doc_number!r} timed out; re-query found no bill"
        )

    if res.status_code >= 300:
        fault = ((data.get("Fault") or {}).get("Error") or [{}])[0]
        raise ValueError(fault.get("Detail") or fault.get("Message") or f"HTTP {res.status_code}")

    bill_id = (data.get("Bill") or {}).get("Id")
    if not bill_id:
        raise ValueError("QBO returned HTTP 200 but no Bill.Id in response")
    _mark_erp_bill(invoice_id, "erp_qbo_bill_id", bill_id)
    return bill_id


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
    bill_id = bill.get("bill_id")
    ref = bill.get("bill_number") or bill_id
    _mark_erp_bill(body.invoice_id, "erp_zoho_bill_id", str(bill_id or ref or "pushed"))
    return {
        "success": True,
        "message": f"Bill created in Zoho Books ({ref})",
        "bill_id": bill_id,
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
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            access, base_url, realm_id = await _qbo_token(client)
            bill_id = await _qbo_ensure_bill(client, inv, access, base_url, realm_id)
    except HTTPException:
        raise
    except QBOConflictError as exc:
        return {"success": False, "message": f"Conflict: {exc}"}
    except QBOUncertainStateError as exc:
        return {"success": False, "message": f"Uncertain state (manual verification required): {exc}"}
    except Exception as exc:
        return {"success": False, "message": str(exc)}
    return {
        "success": True,
        "message": f"Bill in QuickBooks Online (ID: {bill_id})",
        "bill_id": bill_id,
    }


# ── Vendor pull from ERP ──────────────────────────────────────────────────────

class VendorPullResult(BaseModel):
    created: int = 0
    updated: int = 0
    skipped: int = 0
    errors: list[str] = []


def _upsert_vendor(sb: Any, name: str, fields: dict[str, Any], company_id: str | None) -> str:
    """Insert or update a vendor row by name (case-insensitive).  Returns 'created'|'updated'|'skipped'."""
    name = (name or "").strip()
    if not name:
        return "skipped"
    try:
        q = sb.table("vendors").select("id,name").ilike("name", name)
        if company_id:
            q = q.eq("company_id", company_id)
        existing = q.limit(1).execute().data
        now = datetime.now(timezone.utc).isoformat()
        if existing:
            row_id = existing[0]["id"]
            sb.table("vendors").update({**fields, "updated_at": now}).eq("id", row_id).execute()
            return "updated"
        payload: dict[str, Any] = {"name": name, "created_at": now, "updated_at": now, **fields}
        if company_id:
            payload["company_id"] = company_id
        sb.table("vendors").insert(payload).execute()
        return "created"
    except Exception as exc:
        log.warning("vendor upsert failed for %r: %s", name, exc)
        return "error"


@router.get("/zoho/pull-vendors", dependencies=[Depends(platform_admin)])
async def pull_vendors_from_zoho(company_id: str | None = None) -> dict[str, Any]:
    """Fetch all contacts (vendors) from Zoho Books and upsert them into the vendors table."""
    org_id = get_app_setting("zoho_organization_id")
    if not org_id:
        raise HTTPException(400, detail="Zoho not connected — complete OAuth first")

    result = VendorPullResult()
    sb = get_supabase()
    page = 1

    async with httpx.AsyncClient(timeout=30.0) as client:
        access, api_domain = await _zoho_token(client)
        while True:
            resp = await client.get(
                f"{api_domain}/books/v3/contacts",
                params={
                    "organization_id": org_id,
                    "contact_type": "vendor",
                    "per_page": 200,
                    "page": page,
                },
                headers={"Authorization": f"Zoho-oauthtoken {access}"},
            )
            data = resp.json()
            if data.get("code") != 0:
                raise HTTPException(502, detail=f"Zoho error: {data.get('message')}")
            contacts = data.get("contacts") or []
            for c in contacts:
                name = (c.get("contact_name") or "").strip()
                if not name:
                    continue
                fields: dict[str, Any] = {}
                if c.get("email"):
                    fields["email"] = c["email"]
                if c.get("phone"):
                    fields["phone"] = c["phone"]
                if c.get("cf_trn") or c.get("tax_reg_no"):
                    fields["tax_id"] = c.get("cf_trn") or c.get("tax_reg_no")
                if c.get("website"):
                    fields["website"] = c["website"]
                fields["erp_zoho_contact_id"] = str(c.get("contact_id") or "")
                outcome = _upsert_vendor(sb, name, fields, company_id)
                if outcome == "created":
                    result.created += 1
                elif outcome == "updated":
                    result.updated += 1
                elif outcome == "skipped":
                    result.skipped += 1
                else:
                    result.errors.append(name)
            if not data.get("page_context", {}).get("has_more_page"):
                break
            page += 1

    msg = f"Zoho vendor pull: {result.created} created, {result.updated} updated, {result.skipped} skipped, {len(result.errors)} errors"
    _record_sync("zoho", len(result.errors) == 0, msg, result.created + result.updated)
    return {
        "ok": len(result.errors) == 0,
        "message": msg,
        "created": result.created,
        "updated": result.updated,
        "skipped": result.skipped,
        "errors": result.errors[:20],
    }


@router.get("/quickbooks/pull-vendors", dependencies=[Depends(platform_admin)])
async def pull_vendors_from_quickbooks(company_id: str | None = None) -> dict[str, Any]:
    """Fetch all vendors from QuickBooks Online and upsert them into the vendors table."""
    result = VendorPullResult()
    sb = get_supabase()
    start_pos = 1
    page_size = 100

    async with httpx.AsyncClient(timeout=30.0) as client:
        access, base_url, realm_id = await _qbo_token(client)
        while True:
            resp = await client.get(
                f"{base_url}/v3/company/{realm_id}/query",
                params={
                    "query": f"select * from Vendor startposition {start_pos} maxresults {page_size}",
                    "minorversion": "65",
                },
                headers={"Authorization": f"Bearer {access}", "Accept": "application/json"},
            )
            qr = resp.json().get("QueryResponse", {})
            vendors = qr.get("Vendor") or []
            for v in vendors:
                name = (v.get("DisplayName") or v.get("CompanyName") or "").strip()
                if not name:
                    continue
                fields: dict[str, Any] = {}
                if v.get("PrimaryEmailAddr", {}).get("Address"):
                    fields["email"] = v["PrimaryEmailAddr"]["Address"]
                if v.get("PrimaryPhone", {}).get("FreeFormNumber"):
                    fields["phone"] = v["PrimaryPhone"]["FreeFormNumber"]
                if v.get("WebAddr", {}).get("URI"):
                    fields["website"] = v["WebAddr"]["URI"]
                if v.get("TaxIdentifier"):
                    fields["tax_id"] = v["TaxIdentifier"]
                fields["erp_qbo_vendor_id"] = str(v.get("Id") or "")
                outcome = _upsert_vendor(sb, name, fields, company_id)
                if outcome == "created":
                    result.created += 1
                elif outcome == "updated":
                    result.updated += 1
                elif outcome == "skipped":
                    result.skipped += 1
                else:
                    result.errors.append(name)
            if len(vendors) < page_size:
                break
            start_pos += page_size

    msg = f"QuickBooks vendor pull: {result.created} created, {result.updated} updated, {result.skipped} skipped, {len(result.errors)} errors"
    _record_sync("quickbooks", len(result.errors) == 0, msg, result.created + result.updated)
    return {
        "ok": len(result.errors) == 0,
        "message": msg,
        "created": result.created,
        "updated": result.updated,
        "skipped": result.skipped,
        "errors": result.errors[:20],
    }


# ── Bulk sync approved invoices ────────────────────────────────────────────────

_BULK_INVOICE_FIELDS = (
    "id,company_id,vendor_name,invoice_number,invoice_date,due_date,currency,"
    "total_amount,tax_amount,tax_rate,gl_code,gl_name,erp_zoho_bill_id,erp_qbo_bill_id"
)
_BULK_PAGE = 100  # invoices per page — Supabase default max is 1 000


def _fetch_approved_unsynced(erp_col: str, company_id: str | None = None) -> list[dict[str, Any]]:
    """Return approved invoices that have not yet been pushed to the given ERP column."""
    sb = get_supabase()
    q = (
        sb.table("invoices")
        .select(_BULK_INVOICE_FIELDS)
        .eq("status", "Approved")
        .is_(erp_col, "null")
        .limit(_BULK_PAGE)
    )
    if company_id:
        q = q.eq("company_id", company_id)
    return q.execute().data or []


def _mark_erp_bill(invoice_id: str, erp_col: str, bill_ref: str) -> None:
    """Stamp the ERP bill id on the invoice row so it isn't re-synced.

    Retries once on transient failure.  After two failures the row is left
    un-stamped and an ERROR is logged so ops can re-run bulk sync to recover
    (the ERP's duplicate-rejection guard prevents a second bill from being
    created on retry).
    """
    for attempt in range(2):
        try:
            get_supabase().table("invoices").update({erp_col: bill_ref}).eq("id", invoice_id).execute()
            return
        except Exception as exc:
            if attempt == 0:
                log.warning("_mark_erp_bill attempt 1 failed for invoice %s (%s=%s): %s — retrying",
                            invoice_id, erp_col, bill_ref, exc)
            else:
                log.error("_mark_erp_bill failed permanently for invoice %s (%s=%s): %s — "
                          "invoice will be re-attempted on next bulk sync; ERP duplicate guard prevents double-billing",
                          invoice_id, erp_col, bill_ref, exc)


class BulkSyncResult(BaseModel):
    pushed: int = 0
    skipped: int = 0
    failed: int = 0
    errors: list[str] = []


@router.post("/zoho/sync-approved", dependencies=[Depends(platform_admin)])
async def bulk_sync_zoho(company_id: str | None = None) -> dict[str, Any]:
    """Push all Approved invoices that have no erp_zoho_bill_id yet to Zoho Books."""
    org_id = get_app_setting("zoho_organization_id")
    if not org_id:
        raise HTTPException(400, detail="Zoho not connected — complete OAuth first")

    invoices = _fetch_approved_unsynced("erp_zoho_bill_id", company_id)
    result = BulkSyncResult()

    async with httpx.AsyncClient(timeout=30.0) as client:
        access, api_domain = await _zoho_token(client)
        for inv in invoices:
            total, tax = _num(inv.get("total_amount")), _num(inv.get("tax_amount"))
            payload = {
                "vendor_name": inv.get("vendor_name"),
                "bill_number": inv.get("invoice_number"),
                "date": inv.get("invoice_date"),
                "due_date": inv.get("due_date"),
                "currency_code": inv.get("currency") or "AED",
                "line_items": [{
                    "description": f"Invoice {inv.get('invoice_number')} — {inv.get('vendor_name')}",
                    "rate": total - tax,
                    "quantity": 1,
                    "tax_percentage": inv.get("tax_rate") or 0,
                }],
                "notes": f"Bulk-imported from InvoiceFlow. GL: {inv.get('gl_code') or ''}".strip(),
            }
            try:
                res = await client.post(
                    f"{api_domain}/books/v3/bills",
                    params={"organization_id": org_id},
                    headers={"Authorization": f"Zoho-oauthtoken {access}"},
                    json={"JSONString": json.dumps(payload)},
                )
                data = res.json()
                if data.get("code") == 0:
                    bill = data.get("bill") or {}
                    bill_ref = bill.get("bill_id") or bill.get("bill_number") or "pushed"
                    _mark_erp_bill(inv["id"], "erp_zoho_bill_id", str(bill_ref))
                    result.pushed += 1
                elif data.get("code") == 36026:
                    # Duplicate bill number — already in Zoho, mark as synced
                    _mark_erp_bill(inv["id"], "erp_zoho_bill_id", "duplicate")
                    result.skipped += 1
                else:
                    result.failed += 1
                    result.errors.append(
                        f"{inv.get('invoice_number')}: {data.get('message') or 'unknown error'}"
                    )
            except Exception as exc:
                result.failed += 1
                result.errors.append(f"{inv.get('invoice_number')}: {exc}")

    msg = f"Zoho bulk sync: {result.pushed} pushed, {result.skipped} skipped, {result.failed} failed"
    _record_sync("zoho", result.failed == 0, msg, result.pushed)
    return {
        "ok": result.failed == 0,
        "message": msg,
        "pushed": result.pushed,
        "skipped": result.skipped,
        "failed": result.failed,
        "errors": result.errors[:20],
    }


@router.post("/quickbooks/sync-approved", dependencies=[Depends(platform_admin)])
async def bulk_sync_quickbooks(company_id: str | None = None) -> dict[str, Any]:
    """Push all Approved invoices that have no erp_qbo_bill_id yet to QuickBooks Online."""
    invoices = _fetch_approved_unsynced("erp_qbo_bill_id", company_id)
    result = BulkSyncResult()

    async with httpx.AsyncClient(timeout=30.0) as client:
        access, base_url, realm_id = await _qbo_token(client)
        for inv in invoices:
            try:
                await _qbo_ensure_bill(client, inv, access, base_url, realm_id)
                result.pushed += 1
            except QBOConflictError as exc:
                # DocNumber collision claimed by another worker or truly conflicting bill
                inv_num = inv.get("invoice_number") or inv["id"]
                log.warning("QBO bulk sync skipped %s: %s", inv_num, exc)
                result.skipped += 1
            except QBOUncertainStateError as exc:
                inv_num = inv.get("invoice_number") or inv["id"]
                log.error("QBO bulk sync uncertain state for %s: %s — manual verification required", inv_num, exc)
                result.failed += 1
                result.errors.append(f"{inv_num}: uncertain state — {exc}")
            except Exception as exc:
                inv_num = inv.get("invoice_number") or inv["id"]
                result.failed += 1
                result.errors.append(f"{inv_num}: {exc}")

    msg = f"QuickBooks bulk sync: {result.pushed} pushed, {result.skipped} skipped, {result.failed} failed"
    _record_sync("quickbooks", result.failed == 0, msg, result.pushed)
    return {
        "ok": result.failed == 0,
        "message": msg,
        "pushed": result.pushed,
        "skipped": result.skipped,
        "failed": result.failed,
        "errors": result.errors[:20],
    }


# ── PENDING recovery ──────────────────────────────────────────────────────────

_PENDING_INVOICE_FIELDS = (
    "id,company_id,vendor_name,invoice_number,invoice_date,due_date,currency,"
    "total_amount,tax_amount,tax_rate,gl_code,gl_name,erp_qbo_bill_id"
)
_PENDING_MAX_AGE_MINUTES = 10  # rows newer than this are likely still in-flight


@router.get("/quickbooks/pending-bills", dependencies=[Depends(platform_admin)])
def list_pending_qbo_bills(company_id: str | None = None) -> dict[str, Any]:
    """List invoice rows stuck at erp_qbo_bill_id='PENDING' for operator inspection."""
    sb = get_supabase()
    q = (
        sb.table("invoices")
        .select(_PENDING_INVOICE_FIELDS)
        .eq("erp_qbo_bill_id", "PENDING")
        .limit(200)
    )
    if company_id:
        q = q.eq("company_id", company_id)
    rows = q.execute().data or []
    return {"count": len(rows), "invoices": rows}


@router.post("/quickbooks/clear-pending", dependencies=[Depends(platform_admin)])
async def clear_pending_qbo_bills(
    ctx: WorkspaceContext = Depends(platform_admin),
    company_id: str | None = None,
    min_age_minutes: int = _PENDING_MAX_AGE_MINUTES,
) -> dict[str, Any]:
    """Resolve stuck PENDING rows by re-querying QBO.

    Only processes PENDING rows whose updated_at is older than min_age_minutes
    (default 10 min) to avoid racing with actively in-flight pushes.

    - If QBO has the bill: stamp the real Bill.Id (safe, idempotent).
    - If QBO does not have it: clear PENDING → NULL so bulk sync will retry.
    """
    caller = getattr(ctx.user, "email", None) or getattr(ctx.user, "id", "unknown")
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=min_age_minutes)).isoformat()

    sb = get_supabase()
    q = (
        sb.table("invoices")
        .select(_PENDING_INVOICE_FIELDS)
        .eq("erp_qbo_bill_id", "PENDING")
        .lt("updated_at", cutoff)
        .limit(200)
    )
    if company_id:
        q = q.eq("company_id", company_id)
    rows = q.execute().data or []

    resolved: int = 0
    cleared: int = 0
    skipped: int = 0
    errors: list[str] = []

    log.info("clear-pending called by %s: cutoff=%s found=%d rows", caller, cutoff, len(rows))

    if not rows:
        return {"ok": True, "message": "No PENDING rows older than cutoff found", "resolved": 0, "cleared": 0, "skipped": 0, "errors": []}

    async with httpx.AsyncClient(timeout=20.0) as client:
        try:
            access, base_url, realm_id = await _qbo_token(client)
        except Exception as exc:
            raise HTTPException(503, detail=f"Cannot connect to QuickBooks: {exc}") from exc

        headers = {"Authorization": f"Bearer {access}", "Accept": "application/json"}

        for inv in rows:
            invoice_id = inv["id"]
            inv_num = inv.get("invoice_number") or invoice_id
            doc_number = (inv.get("invoice_number") or "")[:21]
            our_invoice_number = inv.get("invoice_number") or ""

            try:
                resp = await client.get(
                    f"{base_url}/v3/company/{realm_id}/query",
                    params={"query": f"SELECT * FROM Bill WHERE DocNumber = '{doc_number}'", "minorversion": "70"},
                    headers=headers,
                    timeout=15.0,
                )
                bills = (resp.json().get("QueryResponse") or {}).get("Bill") or []
                bill = bills[0] if bills else None

                if bill is not None:
                    their_note = bill.get("PrivateNote") or ""
                    note_ok = (len(our_invoice_number) <= 21) or (our_invoice_number in their_note)
                    if note_ok:
                        _mark_erp_bill(invoice_id, "erp_qbo_bill_id", bill["Id"])
                        resolved += 1
                        log.info("clear-pending by %s: resolved %s → Bill.Id=%s", caller, inv_num, bill["Id"])
                    else:
                        # DocNumber collision — different invoice owns this QBO bill
                        errors.append(f"{inv_num}: DocNumber collision with bill {bill['Id']} — manual resolution required")
                        skipped += 1
                else:
                    # QBO has no bill for this DocNumber — safe to clear
                    sb.table("invoices").update({"erp_qbo_bill_id": None}).eq("id", invoice_id).execute()
                    cleared += 1
                    log.info("clear-pending by %s: cleared %s back to NULL (no QBO bill found)", caller, inv_num)
            except Exception as exc:
                errors.append(f"{inv_num}: {exc}")
                skipped += 1

    msg = f"clear-pending: {resolved} resolved, {cleared} cleared to NULL, {skipped} skipped"
    log.info(msg)
    return {
        "ok": len(errors) == 0,
        "message": msg,
        "resolved": resolved,
        "cleared": cleared,
        "skipped": skipped,
        "errors": errors[:20],
    }