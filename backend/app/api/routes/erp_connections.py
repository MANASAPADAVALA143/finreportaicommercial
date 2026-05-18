"""
erp_connections.py
──────────────────
ERP Connection API endpoints — Zoho Books + TallyPrime.
Prefix: /api/connections

Endpoints
─────────
POST  /api/connections/zoho/connect          Exchange OAuth code, save connection
POST  /api/connections/tally/connect         Test Tally, save config
POST  /api/connections/zoho/sync/{id}        Trigger immediate Zoho sync
POST  /api/connections/tally/sync/{id}       Trigger immediate Tally sync
GET   /api/connections/status                List all active connections
GET   /api/connections/logs/{id}             Sync history for a connection
DELETE /api/connections/{id}                 Soft-delete (deactivate) connection
GET   /api/connections/tally/companies       Probe Tally for company list
"""
from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.supabase import get_supabase
from app.services.erp_sync_service import ERPSyncService

log    = logging.getLogger(__name__)
router = APIRouter(prefix="/api/connections", tags=["ERP Connections"])
_sync  = ERPSyncService()


# ── Request models ─────────────────────────────────────────────────────────────

class ZohoConnectRequest(BaseModel):
    client_name:           str
    org_id:                str
    auth_code:             str       # one-time code from Zoho OAuth callback
    days_to_pull:          int  = 30
    sync_invoices:         bool = True
    sync_journal_entries:  bool = True
    sync_hour:             int  = 6


class TallyConnectRequest(BaseModel):
    client_name:           str
    server_ip:             str  = "localhost"
    port:                  int  = 9000
    company_name:          str
    days_to_pull:          int  = 30
    sync_invoices:         bool = True
    sync_journal_entries:  bool = True
    sync_hour:             int  = 6


# ── Zoho ───────────────────────────────────────────────────────────────────────

@router.post("/zoho/connect")
async def connect_zoho(req: ZohoConnectRequest) -> dict[str, Any]:
    """Exchange Zoho auth code for OAuth tokens and persist the connection."""
    from app.services.zoho_service import ZohoService  # noqa: PLC0415

    zoho = ZohoService()
    tokens = await zoho.exchange_auth_code(req.auth_code)

    if "access_token" not in tokens:
        raise HTTPException(400, detail=f"Zoho OAuth failed: {tokens}")

    sb = get_supabase()
    result = sb.table("erp_connections").insert({
        "client_name":          req.client_name,
        "erp_type":             "zoho",
        "zoho_org_id":          req.org_id,
        "zoho_access_token":    tokens["access_token"],
        "zoho_refresh_token":   tokens.get("refresh_token"),
        "sync_invoices":        req.sync_invoices,
        "sync_journal_entries": req.sync_journal_entries,
        "sync_hour":            req.sync_hour,
        "days_to_pull":         req.days_to_pull,
        "config":               {"org_id": req.org_id},
    }).execute()

    conn = result.data[0]
    log.info("[Connections] Zoho connected: client=%s", req.client_name)
    return {
        "success":       True,
        "connection_id": conn["id"],
        "api_key":       conn["api_key"],
        "message":       "Zoho Books connected successfully",
    }


@router.post("/zoho/sync/{connection_id}")
async def sync_zoho_now(connection_id: str) -> dict[str, Any]:
    """Trigger an immediate Zoho sync (called by 'Sync Now' button)."""
    sb   = get_supabase()
    rows = sb.table("erp_connections").select("*").eq("id", connection_id).execute()
    if not rows.data:
        raise HTTPException(404, detail="Connection not found")

    results = await _sync.sync_zoho(rows.data[0])
    return {"success": True, "results": results}


# ── Tally ──────────────────────────────────────────────────────────────────────

@router.post("/tally/connect")
async def connect_tally(req: TallyConnectRequest) -> dict[str, Any]:
    """Test Tally connectivity, then persist the connection config."""
    from app.services.tally_service import TallyService  # noqa: PLC0415

    import asyncio  # noqa: PLC0415
    tally  = TallyService(host=req.server_ip, port=req.port)
    test   = await asyncio.to_thread(tally.test_connection)
    if not test.get("connected"):
        raise HTTPException(400, detail=f"Cannot reach Tally: {test.get('error')}")

    sb     = get_supabase()
    result = sb.table("erp_connections").insert({
        "client_name":          req.client_name,
        "erp_type":             "tally",
        "tally_server_ip":      req.server_ip,
        "tally_port":           req.port,
        "tally_company_name":   req.company_name,
        "sync_invoices":        req.sync_invoices,
        "sync_journal_entries": req.sync_journal_entries,
        "sync_hour":            req.sync_hour,
        "days_to_pull":         req.days_to_pull,
        "config": {
            "server_ip":    req.server_ip,
            "port":         req.port,
            "company_name": req.company_name,
        },
    }).execute()

    conn = result.data[0]
    log.info("[Connections] Tally connected: client=%s", req.client_name)
    return {
        "success":       True,
        "connection_id": conn["id"],
        "api_key":       conn["api_key"],
        "message":       "TallyPrime connected successfully",
    }


@router.post("/tally/sync/{connection_id}")
async def sync_tally_now(connection_id: str) -> dict[str, Any]:
    """Trigger an immediate Tally sync."""
    sb   = get_supabase()
    rows = sb.table("erp_connections").select("*").eq("id", connection_id).execute()
    if not rows.data:
        raise HTTPException(404, detail="Connection not found")

    results = await _sync.sync_tally(rows.data[0])
    return {"success": True, "results": results}


@router.get("/tally/companies")
async def get_tally_companies(
    server_ip: str = "localhost",
    port:      int = 9000,
) -> dict[str, Any]:
    """Probe a Tally instance for its company list (used during setup)."""
    from app.services.tally_service import TallyService  # noqa: PLC0415

    import asyncio  # noqa: PLC0415
    tally = TallyService(host=server_ip, port=port)
    test  = await asyncio.to_thread(tally.test_connection)
    if not test.get("connected"):
        raise HTTPException(400, detail=f"Cannot reach Tally at {server_ip}:{port}")

    companies = test.get("companies", [])
    return {"connected": True, "companies": companies}


# ── Status / management ────────────────────────────────────────────────────────

@router.get("/status")
async def get_all_connections() -> dict[str, Any]:
    """Return all active ERP connections (for Connections page)."""
    sb   = get_supabase()
    rows = sb.table("erp_connections").select(
        "id, client_name, erp_type, is_active, last_sync_at, last_sync_status, "
        "sync_invoices, sync_journal_entries, sync_hour, days_to_pull, "
        "zoho_org_id, tally_server_ip, tally_port, tally_company_name"
    ).eq("is_active", True).execute()
    return {"connections": rows.data}


@router.get("/logs/{connection_id}")
async def get_sync_logs(connection_id: str, limit: int = 10) -> dict[str, Any]:
    """Return recent sync history for a connection."""
    sb   = get_supabase()
    rows = sb.table("sync_logs").select("*").eq(
        "connection_id", connection_id
    ).order("started_at", desc=True).limit(limit).execute()
    return {"logs": rows.data}


@router.delete("/{connection_id}")
async def disconnect_erp(connection_id: str) -> dict[str, Any]:
    """Soft-delete: marks the connection inactive without destroying logs."""
    sb = get_supabase()
    sb.table("erp_connections").update({"is_active": False}).eq("id", connection_id).execute()
    return {"success": True, "message": "ERP connection deactivated"}
