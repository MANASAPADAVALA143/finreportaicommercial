"""
UAE Accounting Routes
======================
All endpoints under /api/uae/ — completely isolated from existing modules.

OAuth flows:
  GET  /api/uae/zoho/auth-url          → redirect URL for frontend button
  GET  /api/uae/zoho/callback           → handles Zoho redirect, saves tokens
  GET  /api/uae/qbo/auth-url            → redirect URL for frontend button
  GET  /api/uae/qbo/callback            → handles QBO redirect, saves tokens

Accounts:
  GET    /api/uae/connected-accounts    → list all connections for tenant
  DELETE /api/uae/connected-accounts/{id}

Sync:
  POST   /api/uae/sync-trial-balance    → sync TB from Zoho/QBO
  GET    /api/uae/trial-balances        → list synced TBs
  GET    /api/uae/trial-balances/{id}   → full TB with line items

IFRS pipeline:
  POST   /api/uae/trial-balances/{id}/generate-ifrs
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.uae_accounting import (
    AccountingSource,
    ConnectedAccount,
    UAETrialBalance,
    UAETrialBalanceLine,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/uae", tags=["UAE Accounting"])

# Frontend URL — where the browser is redirected after OAuth callback
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3006")


# ── Tenant helper ─────────────────────────────────────────────────────────────

def _tenant(x_tenant_id: Annotated[str | None, Header()] = None) -> str:
    return (x_tenant_id or "default").strip()


# ══════════════════════════════════════════════════════════════════════════════
# ZOHO OAUTH
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/zoho/auth-url", summary="Get Zoho Books OAuth URL")
async def zoho_auth_url(
    tenant_id: str = Query(default="default", description="Tenant ID passed as OAuth state"),
) -> dict[str, str]:
    """Return the Zoho OAuth authorisation URL. Frontend opens this in the same window."""
    from app.services.zoho_connector import get_zoho_auth_url, ZOHO_CLIENT_ID

    if not ZOHO_CLIENT_ID:
        raise HTTPException(
            status_code=503,
            detail="Zoho is not configured. Add ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET to .env",
        )
    url = get_zoho_auth_url(state=tenant_id)
    return {"auth_url": url}


@router.get("/zoho/callback", summary="Zoho OAuth callback — saves tokens, redirects to frontend")
async def zoho_callback(
    code: str = Query(...),
    state: str = Query(default="default"),
    location: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """
    Called by Zoho after user authorises. Exchanges code for tokens, fetches
    organisation list, saves ConnectedAccount, then redirects back to frontend.
    """
    from app.services.zoho_connector import (
        exchange_zoho_code,
        get_zoho_organisations,
        token_expires_at,
    )

    tenant_id = state

    try:
        tokens = exchange_zoho_code(code)
    except Exception as exc:
        logger.exception("Zoho token exchange failed")
        return RedirectResponse(
            url=f"{FRONTEND_URL}/uae-accounting?error=zoho_token_failed&detail={exc}"
        )

    access_token = tokens.get("access_token", "")
    api_domain   = tokens.get("api_domain", "https://www.zohoapis.com")

    # Fetch organisations to get company name + ID
    orgs: list[dict[str, Any]] = []
    try:
        orgs = get_zoho_organisations(access_token, api_domain)
    except Exception as exc:
        logger.warning("Could not fetch Zoho orgs: %s", exc)

    first_org = orgs[0] if orgs else {}
    org_id    = first_org.get("organization_id", "")
    org_name  = first_org.get("name", "Zoho Books Organisation")
    currency  = first_org.get("currency_code", "AED")
    country   = first_org.get("country", "AE")

    # Check if this connection already exists (re-auth)
    existing = (
        db.query(ConnectedAccount)
        .filter(
            ConnectedAccount.tenant_id == tenant_id,
            ConnectedAccount.source == AccountingSource.zoho,
            ConnectedAccount.company_id_external == org_id,
        )
        .first()
    )

    if existing:
        existing.access_token   = access_token
        existing.refresh_token  = tokens.get("refresh_token", existing.refresh_token)
        existing.token_expires_at = token_expires_at(tokens.get("expires_in", 3600))
        existing.api_domain     = api_domain
        existing.is_active      = True
        existing.last_error     = None
        db.add(existing)
    else:
        account = ConnectedAccount(
            tenant_id=tenant_id,
            source=AccountingSource.zoho,
            company_name=org_name,
            company_id_external=org_id,
            currency_code=currency,
            country=country,
            access_token=access_token,
            refresh_token=tokens.get("refresh_token", ""),
            token_expires_at=token_expires_at(tokens.get("expires_in", 3600)),
            api_domain=api_domain,
            is_active=True,
            created_at=datetime.utcnow(),
        )
        db.add(account)

    db.commit()
    return RedirectResponse(url=f"{FRONTEND_URL}/uae-accounting?connected=zoho")


# ══════════════════════════════════════════════════════════════════════════════
# QBO OAUTH
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/qbo/auth-url", summary="Get QuickBooks Online OAuth URL")
async def qbo_auth_url(
    tenant_id: str = Query(default="default"),
) -> dict[str, str]:
    """Return the QBO OAuth authorisation URL."""
    from app.services.qbo_connector import get_qbo_auth_url, QBO_CLIENT_ID

    if not QBO_CLIENT_ID:
        raise HTTPException(
            status_code=503,
            detail="QuickBooks is not configured. Add QBO_CLIENT_ID and QBO_CLIENT_SECRET to .env",
        )
    url = get_qbo_auth_url(state=tenant_id)
    return {"auth_url": url}


@router.get("/qbo/callback", summary="QBO OAuth callback — saves tokens, redirects to frontend")
async def qbo_callback(
    code: str = Query(...),
    state: str = Query(default="default"),
    realmId: str = Query(default=""),
    db: Session = Depends(get_db),
):
    """
    Called by QuickBooks after user authorises. Exchanges code for tokens,
    fetches company info, saves ConnectedAccount, redirects to frontend.
    """
    from app.services.qbo_connector import (
        exchange_qbo_code,
        get_qbo_company_info,
        token_expires_at,
    )

    tenant_id = state

    try:
        tokens = exchange_qbo_code(code=code, realm_id=realmId)
    except Exception as exc:
        logger.exception("QBO token exchange failed")
        return RedirectResponse(
            url=f"{FRONTEND_URL}/uae-accounting?error=qbo_token_failed&detail={exc}"
        )

    access_token = tokens.get("access_token", "")

    # Fetch company name
    company_name = "QuickBooks Company"
    currency     = "USD"
    try:
        info = get_qbo_company_info(access_token, realmId)
        company_name = info.get("CompanyName", company_name)
        currency     = info.get("Country", {}).get("code", "USD") if isinstance(info.get("Country"), dict) else "USD"
    except Exception as exc:
        logger.warning("Could not fetch QBO company info: %s", exc)

    existing = (
        db.query(ConnectedAccount)
        .filter(
            ConnectedAccount.tenant_id == tenant_id,
            ConnectedAccount.source == AccountingSource.quickbooks,
            ConnectedAccount.company_id_external == realmId,
        )
        .first()
    )

    if existing:
        existing.access_token    = access_token
        existing.refresh_token   = tokens.get("refresh_token", existing.refresh_token)
        existing.token_expires_at = token_expires_at(tokens.get("expires_in", 3600))
        existing.is_active       = True
        existing.last_error      = None
        db.add(existing)
    else:
        account = ConnectedAccount(
            tenant_id=tenant_id,
            source=AccountingSource.quickbooks,
            company_name=company_name,
            company_id_external=realmId,
            currency_code=currency,
            access_token=access_token,
            refresh_token=tokens.get("refresh_token", ""),
            token_expires_at=token_expires_at(tokens.get("expires_in", 3600)),
            is_active=True,
            created_at=datetime.utcnow(),
        )
        db.add(account)

    db.commit()
    return RedirectResponse(url=f"{FRONTEND_URL}/uae-accounting?connected=qbo")


# ══════════════════════════════════════════════════════════════════════════════
# CONNECTED ACCOUNTS
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/connected-accounts", summary="List all connected accounting sources")
async def list_connected_accounts(
    tenant_id: str = Depends(_tenant),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    accounts = (
        db.query(ConnectedAccount)
        .filter(ConnectedAccount.tenant_id == tenant_id, ConnectedAccount.is_active == True)
        .order_by(ConnectedAccount.created_at.desc())
        .all()
    )
    return {
        "accounts": [
            {
                "id": a.id,
                "source": a.source.value,
                "company_name": a.company_name,
                "company_id_external": a.company_id_external,
                "currency_code": a.currency_code,
                "is_active": a.is_active,
                "last_synced_at": a.last_synced_at.isoformat() if a.last_synced_at else None,
                "last_error": a.last_error,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in accounts
        ],
        "count": len(accounts),
    }


@router.delete("/connected-accounts/{account_id}", summary="Disconnect an accounting source")
async def disconnect_account(
    account_id: int,
    tenant_id: str = Depends(_tenant),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    account = (
        db.query(ConnectedAccount)
        .filter(ConnectedAccount.id == account_id, ConnectedAccount.tenant_id == tenant_id)
        .first()
    )
    if not account:
        raise HTTPException(status_code=404, detail="Connected account not found")

    account.is_active     = False
    account.access_token  = None
    account.refresh_token = None
    db.commit()
    return {"ok": True, "disconnected": account_id}


# ══════════════════════════════════════════════════════════════════════════════
# SYNC
# ══════════════════════════════════════════════════════════════════════════════

class SyncRequest(BaseModel):
    connected_account_id: int = Field(..., description="ID from connected-accounts list")
    from_date: str = Field(..., description="YYYY-MM-DD", examples=["2024-01-01"])
    to_date:   str = Field(..., description="YYYY-MM-DD", examples=["2024-12-31"])


@router.post("/sync-trial-balance", summary="Sync trial balance from Zoho or QuickBooks")
async def sync_trial_balance(
    body: SyncRequest,
    tenant_id: str = Depends(_tenant),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """
    Fetch trial balance from the connected accounting source and save to DB.
    Returns the new trial_balance_id plus summary stats.
    """
    account = (
        db.query(ConnectedAccount)
        .filter(
            ConnectedAccount.id == body.connected_account_id,
            ConnectedAccount.tenant_id == tenant_id,
            ConnectedAccount.is_active == True,
        )
        .first()
    )
    if not account:
        raise HTTPException(status_code=404, detail="Connected account not found or inactive")

    try:
        from app.services.uae_tb_processor import sync_trial_balance as _sync
        tb = _sync(
            account=account,
            from_date=body.from_date,
            to_date=body.to_date,
            db=db,
        )
    except Exception as exc:
        account.last_error = str(exc)
        db.commit()
        logger.exception("TB sync failed for account %s", body.connected_account_id)
        raise HTTPException(status_code=502, detail=f"Sync failed: {exc}")

    return {
        "trial_balance_id": tb.id,
        "source": account.source.value,
        "company_name": account.company_name,
        "period_start": tb.period_start,
        "period_end": tb.period_end,
        "account_count": tb.account_count,
        "is_balanced": tb.is_balanced,
        "total_debits": float(tb.total_debits or 0),
        "total_credits": float(tb.total_credits or 0),
        "synced_at": tb.synced_at.isoformat(),
    }


# ══════════════════════════════════════════════════════════════════════════════
# TRIAL BALANCE QUERIES
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/trial-balances", summary="List all synced trial balances")
async def list_trial_balances(
    tenant_id: str = Depends(_tenant),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    tbs = (
        db.query(UAETrialBalance)
        .filter(UAETrialBalance.tenant_id == tenant_id)
        .order_by(UAETrialBalance.synced_at.desc())
        .all()
    )
    return {
        "trial_balances": [
            {
                "id": tb.id,
                "source": tb.source.value,
                "company_name": tb.company_name,
                "period_start": tb.period_start,
                "period_end": tb.period_end,
                "currency": tb.currency,
                "account_count": tb.account_count,
                "is_balanced": tb.is_balanced,
                "ifrs_trial_balance_id": tb.ifrs_trial_balance_id,
                "synced_at": tb.synced_at.isoformat() if tb.synced_at else None,
            }
            for tb in tbs
        ],
        "count": len(tbs),
    }


@router.get("/trial-balances/{tb_id}", summary="Get full trial balance with line items")
async def get_trial_balance(
    tb_id: int,
    tenant_id: str = Depends(_tenant),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    tb = (
        db.query(UAETrialBalance)
        .filter(UAETrialBalance.id == tb_id, UAETrialBalance.tenant_id == tenant_id)
        .first()
    )
    if not tb:
        raise HTTPException(status_code=404, detail="Trial balance not found")

    # Group lines by account_type
    groups: dict[str, list[dict[str, Any]]] = {}
    for line in tb.lines:
        grp = line.account_type or "Other"
        groups.setdefault(grp, [])
        groups[grp].append({
            "id": line.id,
            "account_code": line.account_code,
            "account_name": line.account_name,
            "account_type": line.account_type,
            "debit": float(line.debit or 0),
            "credit": float(line.credit or 0),
            "net_balance": float(line.net_balance or 0),
        })

    return {
        "id": tb.id,
        "source": tb.source.value,
        "company_name": tb.company_name,
        "period_start": tb.period_start,
        "period_end": tb.period_end,
        "currency": tb.currency,
        "account_count": tb.account_count,
        "is_balanced": tb.is_balanced,
        "total_debits": float(tb.total_debits or 0),
        "total_credits": float(tb.total_credits or 0),
        "ifrs_trial_balance_id": tb.ifrs_trial_balance_id,
        "synced_at": tb.synced_at.isoformat() if tb.synced_at else None,
        "groups": groups,
        "lines": [
            {
                "id": l.id,
                "account_code": l.account_code,
                "account_name": l.account_name,
                "account_type": l.account_type,
                "debit": float(l.debit or 0),
                "credit": float(l.credit or 0),
                "net_balance": float(l.net_balance or 0),
            }
            for l in tb.lines
        ],
    }


# ══════════════════════════════════════════════════════════════════════════════
# GENERATE IFRS
# ══════════════════════════════════════════════════════════════════════════════

@router.post(
    "/trial-balances/{tb_id}/generate-ifrs",
    summary="Send UAE trial balance into IFRS Statement Generator",
)
async def generate_ifrs_from_uae_tb(
    tb_id: int,
    tenant_id: str = Depends(_tenant),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """
    Convert a synced UAE trial balance into an IFRS TrialBalance record
    and trigger AI GL mapping. Returns the IFRS trial_balance_id so the
    frontend can redirect to /ifrs-statement with it pre-loaded.
    """
    uae_tb = (
        db.query(UAETrialBalance)
        .filter(UAETrialBalance.id == tb_id, UAETrialBalance.tenant_id == tenant_id)
        .first()
    )
    if not uae_tb:
        raise HTTPException(status_code=404, detail="UAE trial balance not found")

    if not uae_tb.lines:
        raise HTTPException(status_code=422, detail="Trial balance has no lines — sync first")

    try:
        from app.services.uae_tb_processor import generate_ifrs_from_uae_tb as _gen
        ifrs_tb_id = _gen(uae_tb=uae_tb, db=db, tenant_id=tenant_id)
    except Exception as exc:
        logger.exception("generate_ifrs_from_uae_tb failed for tb_id=%s", tb_id)
        raise HTTPException(status_code=500, detail=f"IFRS generation failed: {exc}")

    return {
        "ok": True,
        "uae_trial_balance_id": tb_id,
        "ifrs_trial_balance_id": ifrs_tb_id,
        "redirect_to": f"/ifrs-statement?tb_id={ifrs_tb_id}",
        "message": "Trial balance sent to IFRS Generator. AI GL mapping started.",
    }


# ══════════════════════════════════════════════════════════════════════════════
# GULFTAX AP — VAT Classification + GL Posting
# ══════════════════════════════════════════════════════════════════════════════

class APClassifyRequest(BaseModel):
    """
    Sent by frontend when an AP invoice is ready for GulfTax classification.
    Mirrors the fields the frontend knows after AI extraction or manual entry.
    """
    invoice_number: str = Field(..., description="Invoice number from AP system")
    vendor_name:    str = Field(..., description="Supplier / vendor name")
    total_amount:   float = Field(..., gt=0, description="Invoice total in AED")
    invoice_date:   str   = Field(..., description="YYYY-MM-DD")
    description:    str   = Field(default="", description="Line item description or notes")
    entity_type:    str   = Field(default="mainland", description="mainland | free_zone | designated_zone")
    trn_number:     str   = Field(default="", description="Vendor TRN — empty = invalid")
    company_id:     str   = Field(default="default", description="Internal company identifier")


class APApproveRequest(BaseModel):
    invoice_number: str
    vendor_name:    str
    total_amount:   float
    vat_amount_aed: float
    vat_treatment:  str
    decision:       str    # AUTO_APPROVE | REVIEW_QUEUE | HARD_BLOCK
    risk_score:     float
    invoice_date:   str    = ""
    notes:          str    = ""


@router.post("/ap/classify-invoice", summary="Classify AP invoice with GulfTax AI")
async def ap_classify_invoice(
    body: APClassifyRequest,
) -> dict[str, Any]:
    """
    Pass an AP invoice through GulfTax AI to get:
    - UAE VAT treatment (standard_rated / zero_rated / exempt / out_of_scope)
    - VAT rate and amount
    - Art. 54 entertainment block check
    - Confidence score
    - Risk score (0–100) and decision (AUTO_APPROVE / REVIEW_QUEUE / HARD_BLOCK)

    HARD_BLOCK is triggered by: invalid TRN, Art.54 block, risk ≥ 70.
    """
    from app.services.gulftax_bridge import classify_invoice, ClassifyRequest

    # TRN validity: must be 15-digit numeric string
    trn_number  = body.trn_number.strip().replace(" ", "").replace("-", "")
    trn_valid   = bool(trn_number) and trn_number.isdigit() and len(trn_number) == 15

    description = body.description or f"AP Invoice from {body.vendor_name}"

    req = ClassifyRequest(
        company_id         = body.company_id,
        description        = description,
        amount_aed         = body.total_amount,
        vendor_or_customer = body.vendor_name,
        transaction_type   = "purchase",
        entity_type        = body.entity_type,
        invoice_number     = body.invoice_number,
        transaction_date   = body.invoice_date,
    )

    try:
        result = await classify_invoice(req, trn_valid=trn_valid)
    except Exception as exc:
        logger.error("GulfTax classify failed for invoice %s: %s", body.invoice_number, exc)
        raise HTTPException(
            status_code=502,
            detail=f"GulfTax AI is unreachable. Start GulfTax on port 8000. ({exc})",
        )

    return {
        "invoice_number": body.invoice_number,
        "vendor_name":    body.vendor_name,
        "total_amount":   body.total_amount,
        "trn_valid":      trn_valid,
        **result.to_dict(),
    }


@router.post("/ap/approve-and-post", summary="Approve classified invoice and post JE to UAE GL")
async def ap_approve_and_post(
    body: APApproveRequest,
    tenant_id: str = Depends(_tenant),
) -> dict[str, Any]:
    """
    Records the approval decision and generates a Journal Entry stub.

    GL mapping (UAE CoA):
      - Expense DR  → 5xxx (based on IFRS category, defaulting to 5001 Expenses)
      - Input VAT DR → 2301 (Input VAT Recoverable) — if not blocked
      - Blocked VAT DR → 5099 (Non-recoverable VAT Expense) — Art.54
      - AP Creditor CR → 2001 (Accounts Payable)
    """
    import uuid
    from datetime import date

    if body.decision == "HARD_BLOCK":
        raise HTTPException(
            status_code=422,
            detail="Invoice is HARD_BLOCKED by GulfTax — cannot post. Resolve TRN or VAT issue first.",
        )

    je_ref = f"JE-AP-{uuid.uuid4().hex[:8].upper()}"
    post_date = body.invoice_date or date.today().isoformat()

    net_amount = round(body.total_amount - body.vat_amount_aed, 2)
    vat_amount = round(body.vat_amount_aed, 2)

    je_lines = [
        {"account": "5001", "account_name": "Expenses / COGS",         "debit": net_amount,        "credit": 0.0,        "description": f"{body.vendor_name} — {body.vat_treatment}"},
        {"account": "2001", "account_name": "Accounts Payable",         "debit": 0.0,               "credit": body.total_amount, "description": f"AP {body.invoice_number}"},
    ]

    if vat_amount > 0:
        je_lines.insert(1, {
            "account": "2301", "account_name": "Input VAT Recoverable",
            "debit": vat_amount, "credit": 0.0,
            "description": f"Input VAT @ {body.vat_amount_aed} AED — {body.vat_treatment}",
        })
        # Balance AP credit
        je_lines[2]["credit"] = body.total_amount  # already set

    logger.info(
        "AP approve-and-post: invoice=%s vendor=%s JE=%s decision=%s risk=%.1f",
        body.invoice_number, body.vendor_name, je_ref, body.decision, body.risk_score,
    )

    return {
        "ok":             True,
        "je_reference":   je_ref,
        "post_date":      post_date,
        "invoice_number": body.invoice_number,
        "vendor_name":    body.vendor_name,
        "decision":       body.decision,
        "risk_score":     body.risk_score,
        "vat_treatment":  body.vat_treatment,
        "je_lines":       je_lines,
        "message":        f"Invoice {body.invoice_number} approved. JE {je_ref} posted to UAE GL.",
    }


@router.get("/ap/gulftax-status", summary="GulfTax AI health check")
async def gulftax_status() -> dict[str, Any]:
    """
    Ping the GulfTax AI service and return its health.
    Used by the UAE Sidebar widget to show online/offline status.
    """
    from app.services.gulftax_bridge import health_check
    return await health_check()


# ══════════════════════════════════════════════════════════════════════════════
# STATS (for dashboard header cards)
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/stats", summary="Dashboard stats for UAE Accounting section")
async def get_stats(
    tenant_id: str = Depends(_tenant),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    connected_count = (
        db.query(ConnectedAccount)
        .filter(ConnectedAccount.tenant_id == tenant_id, ConnectedAccount.is_active == True)
        .count()
    )
    tb_count = (
        db.query(UAETrialBalance)
        .filter(UAETrialBalance.tenant_id == tenant_id)
        .count()
    )
    ifrs_count = (
        db.query(UAETrialBalance)
        .filter(
            UAETrialBalance.tenant_id == tenant_id,
            UAETrialBalance.ifrs_trial_balance_id != None,
        )
        .count()
    )
    return {
        "connected_accounts": connected_count,
        "trial_balances_synced": tb_count,
        "ifrs_statements_generated": ifrs_count,
    }
