"""
Zoho Books API Connector
=========================
Handles OAuth 2.0 flow and Trial Balance extraction from Zoho Books.

Zoho Books API docs: https://www.zoho.com/books/api/v3/
OAuth docs:         https://www.zoho.com/accounts/protocol/oauth.html
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta
from typing import Any

import requests

logger = logging.getLogger(__name__)

# UAE-specific vars take priority; fall back to generic ZOHO_* for shared apps
ZOHO_CLIENT_ID     = os.getenv("UAE_ZOHO_CLIENT_ID") or os.getenv("ZOHO_CLIENT_ID", "")
ZOHO_CLIENT_SECRET = os.getenv("UAE_ZOHO_CLIENT_SECRET") or os.getenv("ZOHO_CLIENT_SECRET", "")
ZOHO_REDIRECT_URI  = os.getenv("UAE_ZOHO_REDIRECT_URI", "http://localhost:8000/api/uae/zoho/callback")
ZOHO_ACCOUNTS_URL  = os.getenv("ZOHO_ACCOUNTS_URL", "https://accounts.zoho.in")  # India DC

# Required scopes for Trial Balance + Chart of Accounts
ZOHO_SCOPES = "ZohoBooks.reports.READ,ZohoBooks.accountants.READ,ZohoBooks.settings.READ"


def get_zoho_auth_url(state: str) -> str:
    """
    Build the Zoho OAuth 2.0 authorisation URL.

    Parameters
    ----------
    state : str
        Opaque value passed back on callback — use tenant_id for identification.

    Returns
    -------
    str  URL to redirect the user's browser to.
    """
    return (
        f"{ZOHO_ACCOUNTS_URL}/oauth/v2/auth"
        f"?scope={ZOHO_SCOPES}"
        f"&client_id={ZOHO_CLIENT_ID}"
        f"&response_type=code"
        f"&redirect_uri={ZOHO_REDIRECT_URI}"
        f"&access_type=offline"
        f"&prompt=consent"
        f"&state={state}"
    )


def exchange_zoho_code(code: str) -> dict[str, Any]:
    """
    Exchange authorisation code for access + refresh tokens.

    Returns
    -------
    dict  {access_token, refresh_token, expires_in, api_domain, token_type}
    """
    if not ZOHO_CLIENT_ID or not ZOHO_CLIENT_SECRET:
        raise ValueError("ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET not configured in .env")

    resp = requests.post(
        f"{ZOHO_ACCOUNTS_URL}/oauth/v2/token",
        data={
            "grant_type": "authorization_code",
            "client_id": ZOHO_CLIENT_ID,
            "client_secret": ZOHO_CLIENT_SECRET,
            "redirect_uri": ZOHO_REDIRECT_URI,
            "code": code,
        },
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    if "error" in data:
        raise ValueError(f"Zoho token exchange error: {data['error']}")
    return data


def refresh_zoho_token(refresh_token: str) -> dict[str, Any]:
    """
    Use refresh token to get a new access token.

    Returns
    -------
    dict  {access_token, expires_in, api_domain, token_type}
    """
    resp = requests.post(
        f"{ZOHO_ACCOUNTS_URL}/oauth/v2/token",
        data={
            "grant_type": "refresh_token",
            "client_id": ZOHO_CLIENT_ID,
            "client_secret": ZOHO_CLIENT_SECRET,
            "refresh_token": refresh_token,
        },
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    if "error" in data:
        raise ValueError(f"Zoho token refresh error: {data['error']}")
    return data


def get_zoho_organisations(access_token: str, api_domain: str | None = None) -> list[dict[str, Any]]:
    """
    Fetch all Zoho Books organisations the user has access to.

    Returns
    -------
    list  Each item: {organization_id, name, country, currency_code, ...}
    """
    base = (api_domain or "https://www.zohoapis.in").rstrip("/")
    resp = requests.get(
        f"{base}/books/v3/organizations",
        headers={"Authorization": f"Zoho-oauthtoken {access_token}"},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json().get("organizations", [])


def get_zoho_trial_balance(
    access_token: str,
    organization_id: str,
    from_date: str,
    to_date: str,
    api_domain: str | None = None,
) -> dict[str, Any]:
    """
    Pull a Trial Balance report from Zoho Books.

    Parameters
    ----------
    access_token    : str  Valid Zoho OAuth access token.
    organization_id : str  Zoho Books organisation ID.
    from_date       : str  "YYYY-MM-DD"
    to_date         : str  "YYYY-MM-DD"
    api_domain      : str  Optional — from token exchange response (regional).

    Returns
    -------
    dict  Raw Zoho API response containing "trialbalance" list.
    """
    base = (api_domain or "https://www.zohoapis.in").rstrip("/")
    resp = requests.get(
        f"{base}/books/v3/reports/trialbalance",
        headers={"Authorization": f"Zoho-oauthtoken {access_token}"},
        params={
            "organization_id": organization_id,
            "from_date": from_date,
            "to_date": to_date,
            "filter_by": "Date.CustomDate",
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def normalise_zoho_tb(raw: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Normalise Zoho TB response into standard FinReportAI format.

    Zoho nests accounts inside account_type groupings. We flatten them.

    Returns
    -------
    list  Each item: {account_code, account_name, account_type, debit, credit, net_balance}
    """
    lines: list[dict[str, Any]] = []

    # Zoho returns: {"trialbalance": [{"account_type": "...", "accounts": [...]}]}
    for group in raw.get("trialbalance", []):
        account_type = group.get("account_type", "Unknown")
        for account in group.get("accounts", []):
            debit  = float(account.get("debit",  0) or 0)
            credit = float(account.get("credit", 0) or 0)
            lines.append({
                "account_code": account.get("account_code", ""),
                "account_name": account.get("account_name", ""),
                "account_type": account_type,
                "debit":        debit,
                "credit":       credit,
                "net_balance":  debit - credit,
            })

    # Fallback: flat list (some Zoho versions)
    if not lines:
        for account in raw.get("trialbalance", []):
            if isinstance(account, dict) and "account_name" in account:
                debit  = float(account.get("debit",  0) or 0)
                credit = float(account.get("credit", 0) or 0)
                lines.append({
                    "account_code": account.get("account_code", ""),
                    "account_name": account.get("account_name", ""),
                    "account_type": account.get("account_type", "Unknown"),
                    "debit":        debit,
                    "credit":       credit,
                    "net_balance":  debit - credit,
                })

    logger.info("normalise_zoho_tb: %d lines extracted", len(lines))
    return lines


def token_expires_at(expires_in: int | str) -> datetime:
    """Convert expires_in seconds to an absolute datetime (UTC)."""
    secs = int(expires_in or 3600)
    return datetime.utcnow() + timedelta(seconds=secs - 60)   # 60s buffer
