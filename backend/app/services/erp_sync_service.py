"""
erp_sync_service.py
───────────────────
ERP Sync Orchestrator.
Coordinates the full sync pipeline for Zoho Books and TallyPrime.

Pipeline:
  1. Fetch data from ERP (Zoho or Tally)
  2. Send invoices → existing InvoiceFlow endpoint
  3. Send journal entries → existing JE Anomaly endpoint
  4. Log results → sync_logs table in Supabase
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Any

import httpx

from app.core.supabase import get_supabase
from app.services.zoho_service import ZohoService

log = logging.getLogger(__name__)

INTERNAL_API_BASE = os.getenv("API_BASE_URL", "http://localhost:8000")


class ERPSyncService:

    def __init__(self) -> None:
        self.zoho = ZohoService()

    # ── Zoho ───────────────────────────────────────────────────────────────────

    async def sync_zoho(self, connection: dict[str, Any]) -> dict[str, Any]:
        """Full Zoho sync: unpaid bills + journal entries."""
        log_id = self._start_sync_log(connection["id"], "zoho", "full")
        results: dict[str, Any] = {"invoices": 0, "je": 0, "anomalies": 0}

        try:
            # Refresh OAuth token
            token_data    = await self.zoho.refresh_access_token(connection["zoho_refresh_token"])
            access_token  = token_data.get("access_token", "")
            if not access_token:
                raise ValueError(f"Zoho token refresh failed: {token_data}")

            org_id    = connection.get("zoho_org_id", "")
            days_back = int(connection.get("days_to_pull", 30))

            # Sync AP invoices
            if connection.get("sync_invoices"):
                bills     = await self.zoho.get_unpaid_bills(org_id, access_token, days_back)
                formatted = self.zoho.format_bills_for_invoiceflow(bills)
                result    = await self._send_to_invoiceflow(formatted, connection["api_key"])
                results["invoices"] = result.get("processed", len(formatted))

            # Sync journal entries
            if connection.get("sync_journal_entries"):
                entries   = await self.zoho.get_journal_entries(org_id, access_token, days_back)
                formatted = self.zoho.format_journal_entries_for_anomaly(entries)
                result    = await self._send_to_je_anomaly(formatted, connection["api_key"])
                results["je"]        = result.get("total_entries", len(formatted))
                results["anomalies"] = result.get("anomalies_found", 0)

            self._complete_sync_log(log_id, results, "completed")
            self._update_last_sync(connection["id"], "success")
            log.info("[ERPSync] Zoho sync complete: %s", results)
            return results

        except Exception as exc:
            log.error("[ERPSync] Zoho sync failed: %s", exc)
            self._complete_sync_log(log_id, results, "failed", str(exc))
            self._update_last_sync(connection["id"], "failed")
            raise

    # ── Tally ──────────────────────────────────────────────────────────────────

    async def sync_tally(self, connection: dict[str, Any]) -> dict[str, Any]:
        """Full Tally sync: purchase vouchers + journal vouchers."""
        from app.services.tally_service import TallyService  # noqa: PLC0415

        log_id  = self._start_sync_log(connection["id"], "tally", "full")
        results: dict[str, Any] = {"invoices": 0, "je": 0, "anomalies": 0}

        cfg          = connection.get("config") or {}
        server_ip    = cfg.get("server_ip", connection.get("tally_server_ip", "localhost"))
        port         = int(cfg.get("port", connection.get("tally_port", 9000)))
        company_name = cfg.get("company_name", connection.get("tally_company_name", ""))
        days_back    = int(connection.get("days_to_pull", 30))

        tally = TallyService(host=server_ip, port=port)

        try:
            # Sync AP invoices
            if connection.get("sync_invoices"):
                vouchers  = await tally.get_purchase_vouchers(company_name, days_back)
                formatted = tally.format_vouchers_for_invoiceflow(vouchers)
                result    = await self._send_to_invoiceflow(formatted, connection["api_key"])
                results["invoices"] = result.get("processed", len(formatted))

            # Sync journal entries
            if connection.get("sync_journal_entries"):
                vouchers  = await tally.get_journal_vouchers(company_name, days_back)
                formatted = tally.format_vouchers_for_anomaly(vouchers)
                result    = await self._send_to_je_anomaly(formatted, connection["api_key"])
                results["je"]        = result.get("total_entries", len(formatted))
                results["anomalies"] = result.get("anomalies_found", 0)

            self._complete_sync_log(log_id, results, "completed")
            self._update_last_sync(connection["id"], "success")
            log.info("[ERPSync] Tally sync complete: %s", results)
            return results

        except Exception as exc:
            log.error("[ERPSync] Tally sync failed: %s", exc)
            self._complete_sync_log(log_id, results, "failed", str(exc))
            self._update_last_sync(connection["id"], "failed")
            raise

    # ── Internal pipeline calls ────────────────────────────────────────────────

    async def _send_to_invoiceflow(
        self, invoices: list[dict], api_key: str
    ) -> dict[str, Any]:
        if not invoices:
            return {"processed": 0}
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{INTERNAL_API_BASE}/api/invoices/ingest",
                json={"invoices": invoices},
                headers={"x-api-key": api_key},
            )
            return resp.json() if resp.status_code == 200 else {"processed": 0, "error": resp.text}

    async def _send_to_je_anomaly(
        self, entries: list[dict], api_key: str
    ) -> dict[str, Any]:
        if not entries:
            return {"total_entries": 0, "anomalies_found": 0}
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{INTERNAL_API_BASE}/api/r2r/analyze",
                json={"journal_entries": entries},
                headers={"x-api-key": api_key},
            )
            return resp.json() if resp.status_code == 200 else {"total_entries": 0, "error": resp.text}

    # ── Sync log helpers ───────────────────────────────────────────────────────

    def _start_sync_log(self, connection_id: str, erp_type: str, sync_type: str) -> str:
        try:
            sb = get_supabase()
            result = sb.table("sync_logs").insert({
                "connection_id": connection_id,
                "erp_type":      erp_type,
                "sync_type":     sync_type,
                "status":        "running",
            }).execute()
            return result.data[0]["id"]
        except Exception as exc:
            log.warning("[ERPSync] Could not create sync log: %s", exc)
            return "local"

    def _complete_sync_log(
        self,
        log_id: str,
        results: dict[str, Any],
        status: str,
        error: str | None = None,
    ) -> None:
        if log_id == "local":
            return
        try:
            get_supabase().table("sync_logs").update({
                "status":           status,
                "records_fetched":  results.get("invoices", 0) + results.get("je", 0),
                "anomalies_found":  results.get("anomalies", 0),
                "error_message":    error,
                "completed_at":     datetime.utcnow().isoformat(),
            }).eq("id", log_id).execute()
        except Exception as exc:
            log.warning("[ERPSync] Could not update sync log: %s", exc)

    def _update_last_sync(self, connection_id: str, status: str) -> None:
        try:
            get_supabase().table("erp_connections").update({
                "last_sync_at":     datetime.utcnow().isoformat(),
                "last_sync_status": status,
            }).eq("id", connection_id).execute()
        except Exception as exc:
            log.warning("[ERPSync] Could not update connection last_sync: %s", exc)
