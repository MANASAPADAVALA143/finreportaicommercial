"""
zoho_service.py
───────────────
Zoho Books ERP integration service.
Pulls invoices (bills) and journal entries from Zoho Books API.
Transforms data to match existing InvoiceFlow and JE Anomaly formats.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta
from typing import Any

import httpx

log = logging.getLogger(__name__)

ZOHO_API_BASE      = "https://www.zohoapis.in/books/v3"
ZOHO_ACCOUNTS_URL  = "https://accounts.zoho.in/oauth/v2/token"
ZOHO_CLIENT_ID     = os.getenv("ZOHO_CLIENT_ID")
ZOHO_CLIENT_SECRET = os.getenv("ZOHO_CLIENT_SECRET")
ZOHO_REDIRECT_URI  = os.getenv("ZOHO_REDIRECT_URI", "")


class ZohoService:
    """Async Zoho Books API client."""

    # ── OAuth ──────────────────────────────────────────────────────────────────

    async def refresh_access_token(self, refresh_token: str) -> dict[str, Any]:
        """Exchange refresh token for new access token (valid ~1 hour)."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                ZOHO_ACCOUNTS_URL,
                params={
                    "refresh_token": refresh_token,
                    "client_id":     ZOHO_CLIENT_ID,
                    "client_secret": ZOHO_CLIENT_SECRET,
                    "grant_type":    "refresh_token",
                },
            )
            return resp.json()

    async def exchange_auth_code(self, auth_code: str) -> dict[str, Any]:
        """Exchange one-time auth code for access + refresh tokens."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                ZOHO_ACCOUNTS_URL,
                params={
                    "grant_type":    "authorization_code",
                    "client_id":     ZOHO_CLIENT_ID,
                    "client_secret": ZOHO_CLIENT_SECRET,
                    "redirect_uri":  ZOHO_REDIRECT_URI,
                    "code":          auth_code,
                },
            )
            return resp.json()

    # ── Data fetching ──────────────────────────────────────────────────────────

    async def get_unpaid_bills(
        self,
        org_id: str,
        access_token: str,
        days_back: int = 30,
    ) -> list[dict[str, Any]]:
        """Fetch all unpaid vendor bills (AP invoices awaiting processing)."""
        date_from = (datetime.now() - timedelta(days=days_back)).strftime("%Y-%m-%d")
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{ZOHO_API_BASE}/bills",
                headers={"Authorization": f"Zoho-oauthtoken {access_token}"},
                params={
                    "organization_id": org_id,
                    "status":          "unpaid",
                    "date_start":      date_from,
                    "sort_column":     "created_time",
                    "sort_order":      "D",
                    "per_page":        200,
                },
            )
            data = resp.json()
            bills = data.get("bills", [])
            log.info("[Zoho] fetched %d unpaid bills", len(bills))
            return bills

    async def get_journal_entries(
        self,
        org_id: str,
        access_token: str,
        days_back: int = 30,
    ) -> list[dict[str, Any]]:
        """Fetch manual journal entries — feeds JE Anomaly Detection engine."""
        date_from = (datetime.now() - timedelta(days=days_back)).strftime("%Y-%m-%d")
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{ZOHO_API_BASE}/journalentries",
                headers={"Authorization": f"Zoho-oauthtoken {access_token}"},
                params={
                    "organization_id": org_id,
                    "date_start":      date_from,
                    "per_page":        500,
                },
            )
            data = resp.json()
            entries = data.get("journalentries", [])
            log.info("[Zoho] fetched %d journal entries", len(entries))
            return entries

    async def get_chart_of_accounts(
        self,
        org_id: str,
        access_token: str,
    ) -> list[dict[str, Any]]:
        """Fetch chart of accounts for GL code mapping (cache after first call)."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{ZOHO_API_BASE}/chartofaccounts",
                headers={"Authorization": f"Zoho-oauthtoken {access_token}"},
                params={"organization_id": org_id},
            )
            return resp.json().get("chartofaccounts", [])

    async def update_bill_status(
        self,
        org_id: str,
        access_token: str,
        bill_id: str,
        status: str,
    ) -> dict[str, Any]:
        """Write approval status back to Zoho after InvoiceFlow decision."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.put(
                f"{ZOHO_API_BASE}/bills/{bill_id}",
                headers={"Authorization": f"Zoho-oauthtoken {access_token}"},
                params={"organization_id": org_id},
                json={"status": status},
            )
            return resp.json()

    # ── Format transformers ────────────────────────────────────────────────────

    def format_bills_for_invoiceflow(self, bills: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Transform Zoho bill → InvoiceFlow schema."""
        out = []
        for bill in bills:
            out.append({
                "invoice_number": bill.get("bill_number"),
                "vendor_name":    bill.get("vendor_name"),
                "vendor_id":      bill.get("vendor_id"),
                "invoice_date":   bill.get("date"),
                "due_date":       bill.get("due_date"),
                "total_amount":   float(bill.get("total", 0)),
                "currency":       bill.get("currency_code", "INR"),
                "line_items": [
                    {
                        "description":  item.get("description"),
                        "quantity":     item.get("quantity"),
                        "rate":         item.get("rate"),
                        "amount":       item.get("item_total"),
                        "account_name": item.get("account_name"),
                        "account_id":   item.get("account_id"),
                    }
                    for item in bill.get("line_items", [])
                ],
                "status":       bill.get("status"),
                "source":       "zoho_books",
                "zoho_bill_id": bill.get("bill_id"),
                "notes":        bill.get("notes", ""),
            })
        return out

    def format_journal_entries_for_anomaly(
        self, entries: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """
        Transform Zoho journal entries → FinReportAI JE Anomaly format.
        Flattens line items: one row per JE line.
        """
        out = []
        for entry in entries:
            for line in entry.get("line_items", []):
                amount   = float(line.get("amount", 0))
                is_debit = line.get("debit_or_credit") == "debit"
                out.append({
                    "je_id":            entry.get("journal_id"),
                    "date":             entry.get("date"),
                    "reference_number": entry.get("reference_number", ""),
                    "narration":        entry.get("notes", ""),
                    "account":          line.get("account_name", ""),
                    "account_code":     line.get("account_id", ""),
                    "debit":            amount if is_debit else 0,
                    "credit":           0 if is_debit else amount,
                    "amount":           amount,
                    "preparer":         entry.get("created_by_name", "zoho_system"),
                    "source":           "zoho_books",
                })
        return out
