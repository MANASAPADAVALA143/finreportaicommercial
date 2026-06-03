"""
QuickBooks Online (QBO) API Connector
======================================
Handles OAuth 2.0 flow and Trial Balance extraction from QuickBooks Online.

QBO API docs:  https://developer.intuit.com/app/developer/qbo/docs
OAuth docs:    https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization
"""
from __future__ import annotations

import base64
import logging
import os
from datetime import datetime, timedelta
from typing import Any

import requests

logger = logging.getLogger(__name__)

QBO_CLIENT_ID     = os.getenv("QBO_CLIENT_ID", "")
QBO_CLIENT_SECRET = os.getenv("QBO_CLIENT_SECRET", "")
QBO_REDIRECT_URI  = os.getenv("QBO_REDIRECT_URI", "http://localhost:8000/api/uae/qbo/callback")
QBO_ENVIRONMENT   = os.getenv("QBO_ENVIRONMENT", "sandbox")   # "sandbox" | "production"

QBO_BASE_URL = (
    "https://sandbox-quickbooks.api.intuit.com"
    if QBO_ENVIRONMENT == "sandbox"
    else "https://quickbooks.api.intuit.com"
)
QBO_AUTH_URL    = "https://appcenter.intuit.com/connect/oauth2"
QBO_TOKEN_URL   = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
QBO_REVOKE_URL  = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke"

QBO_SCOPE = "com.intuit.quickbooks.accounting"


def _basic_auth() -> str:
    """Return Base64-encoded Basic auth header value."""
    return base64.b64encode(f"{QBO_CLIENT_ID}:{QBO_CLIENT_SECRET}".encode()).decode()


def get_qbo_auth_url(state: str) -> str:
    """
    Build the QuickBooks Online OAuth 2.0 authorisation URL.

    Parameters
    ----------
    state : str  Opaque value passed back on callback (use tenant_id).

    Returns
    -------
    str  URL to redirect the user's browser to.
    """
    return (
        f"{QBO_AUTH_URL}"
        f"?client_id={QBO_CLIENT_ID}"
        f"&scope={QBO_SCOPE}"
        f"&redirect_uri={QBO_REDIRECT_URI}"
        f"&response_type=code"
        f"&state={state}"
    )


def exchange_qbo_code(code: str, realm_id: str) -> dict[str, Any]:
    """
    Exchange authorisation code for access + refresh tokens.

    Parameters
    ----------
    code     : str  The `code` query parameter from QBO callback.
    realm_id : str  The `realmId` query parameter from QBO callback (= company ID).

    Returns
    -------
    dict  {access_token, refresh_token, expires_in, x_refresh_token_expires_in, realm_id}
    """
    if not QBO_CLIENT_ID or not QBO_CLIENT_SECRET:
        raise ValueError("QBO_CLIENT_ID / QBO_CLIENT_SECRET not configured in .env")

    resp = requests.post(
        QBO_TOKEN_URL,
        headers={
            "Authorization": f"Basic {_basic_auth()}",
            "Content-Type":  "application/x-www-form-urlencoded",
            "Accept":        "application/json",
        },
        data={
            "grant_type":   "authorization_code",
            "code":         code,
            "redirect_uri": QBO_REDIRECT_URI,
        },
        timeout=15,
    )
    resp.raise_for_status()
    result = resp.json()
    if "error" in result:
        raise ValueError(f"QBO token exchange error: {result['error']}: {result.get('error_description', '')}")
    result["realm_id"] = realm_id
    return result


def refresh_qbo_token(refresh_token: str) -> dict[str, Any]:
    """
    Use a refresh token to obtain a new access token.

    Returns
    -------
    dict  {access_token, refresh_token, expires_in, x_refresh_token_expires_in}
    """
    resp = requests.post(
        QBO_TOKEN_URL,
        headers={
            "Authorization": f"Basic {_basic_auth()}",
            "Content-Type":  "application/x-www-form-urlencoded",
            "Accept":        "application/json",
        },
        data={
            "grant_type":    "refresh_token",
            "refresh_token": refresh_token,
        },
        timeout=15,
    )
    resp.raise_for_status()
    result = resp.json()
    if "error" in result:
        raise ValueError(f"QBO token refresh error: {result['error']}")
    return result


def get_qbo_company_info(access_token: str, realm_id: str) -> dict[str, Any]:
    """
    Fetch company info (name, country, currency) from QBO.
    """
    resp = requests.get(
        f"{QBO_BASE_URL}/v3/company/{realm_id}/companyinfo/{realm_id}",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept":        "application/json",
        },
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json().get("CompanyInfo", {})


def get_qbo_trial_balance(
    access_token: str,
    realm_id: str,
    start_date: str,
    end_date: str,
) -> dict[str, Any]:
    """
    Pull a Trial Balance report from QuickBooks Online.

    Parameters
    ----------
    access_token : str  Valid QBO OAuth access token.
    realm_id     : str  QBO company ID (from token exchange).
    start_date   : str  "YYYY-MM-DD"
    end_date     : str  "YYYY-MM-DD"

    Returns
    -------
    dict  Raw QBO TrialBalance API response.
    """
    resp = requests.get(
        f"{QBO_BASE_URL}/v3/company/{realm_id}/reports/TrialBalance",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept":        "application/json",
        },
        params={
            "start_date":          start_date,
            "end_date":            end_date,
            "accounting_method":   "Accrual",
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def normalise_qbo_tb(raw: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Normalise QBO TrialBalance response into standard FinReportAI format.

    QBO nests accounts inside "Section" rows within "Rows.Row".

    Returns
    -------
    list  Each item: {account_code, account_name, account_type, debit, credit, net_balance}
    """
    lines: list[dict[str, Any]] = []
    rows_block = raw.get("Rows", {}).get("Row", [])

    for row in rows_block:
        row_type = row.get("type", "")
        # Top-level section (e.g. "Assets", "Liabilities")
        if row_type == "Section":
            section_name = row.get("group", row.get("Header", {}).get("ColData", [{}])[0].get("value", "Unknown"))
            sub_rows = row.get("Rows", {}).get("Row", [])
            for sub in sub_rows:
                if sub.get("type") in ("Data", ""):
                    cols = sub.get("ColData", [])
                    if len(cols) >= 3:
                        name   = cols[0].get("value", "")
                        debit  = float(cols[1].get("value", 0) or 0)
                        credit = float(cols[2].get("value", 0) or 0)
                        if name:
                            lines.append({
                                "account_code": "",
                                "account_name": name,
                                "account_type": section_name,
                                "debit":        debit,
                                "credit":       credit,
                                "net_balance":  debit - credit,
                            })
                # Handle nested sub-sections
                elif sub.get("type") == "Section":
                    sub_section = sub.get("group", section_name)
                    for sub2 in sub.get("Rows", {}).get("Row", []):
                        cols = sub2.get("ColData", [])
                        if len(cols) >= 3:
                            name   = cols[0].get("value", "")
                            debit  = float(cols[1].get("value", 0) or 0)
                            credit = float(cols[2].get("value", 0) or 0)
                            if name:
                                lines.append({
                                    "account_code": "",
                                    "account_name": name,
                                    "account_type": sub_section,
                                    "debit":        debit,
                                    "credit":       credit,
                                    "net_balance":  debit - credit,
                                })

    logger.info("normalise_qbo_tb: %d lines extracted", len(lines))
    return lines


def token_expires_at(expires_in: int | str) -> datetime:
    """Convert expires_in seconds to an absolute datetime (UTC)."""
    secs = int(expires_in or 3600)
    return datetime.utcnow() + timedelta(seconds=secs - 60)
