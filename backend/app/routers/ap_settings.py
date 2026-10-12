"""AP settings + one-time Supabase bootstrap for missing core tables."""
from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.company_access import require_company_access
from app.core.database import get_db
from app.core.tenant_scope import platform_admin, workspace_member
from app.middleware.workspace import WorkspaceContext
from app.services.ap_settings_service import (
    READABLE_KEYS,
    SECRET_KEYS,
    WRITABLE_KEYS,
    get_app_settings,
    get_app_settings_map,
    get_company_settings,
    upsert_app_setting,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ap", tags=["ap-settings"], dependencies=[Depends(workspace_member)])

_BACKEND = Path(__file__).resolve().parents[2]
_BOOTSTRAP_SCRIPT = _BACKEND / "scripts" / "bootstrap_ap_supabase.py"
_TRAINING_BOOTSTRAP = _BACKEND / "scripts" / "bootstrap_training_tables.py"


@router.get("/app-settings")
def read_app_settings() -> dict[str, str]:
    """n8n webhook URLs — works even when Supabase app_settings table is missing."""
    return get_app_settings()


class SharedSettingsIn(BaseModel):
    settings: dict[str, str]


def _without_password(raw: str) -> str:
    try:
        cfg = json.loads(raw or "{}")
    except ValueError:
        return ""
    if isinstance(cfg, dict):
        cfg.pop("password", None)
    return json.dumps(cfg)


@router.get("/shared-settings")
def read_shared_settings(keys: str = Query(..., description="Comma-separated setting keys")) -> dict[str, str]:
    """Deployment-wide AP settings any member may read (secrets and the mailbox password are never returned)."""
    wanted = [k.strip() for k in keys.split(",") if k.strip() in READABLE_KEYS]
    values = get_app_settings_map(wanted)
    if "email_config" in values:
        values["email_config"] = _without_password(values["email_config"])
    return values


@router.put("/shared-settings", dependencies=[Depends(platform_admin)])
def write_shared_settings(body: SharedSettingsIn) -> dict[str, list[str]]:
    """Blank secrets (and a blank mailbox password) keep the stored value, since the UI never sees them."""
    unknown = sorted(set(body.settings) - WRITABLE_KEYS)
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown or read-only settings: {', '.join(unknown)}")
    saved = []
    for key, value in body.settings.items():
        if key in SECRET_KEYS and not value.strip():
            continue
        if key == "email_config":
            value = _keep_mailbox_password(value)
        upsert_app_setting(key, value)
        saved.append(key)
    return {"saved": sorted(saved)}


def _keep_mailbox_password(raw: str) -> str:
    try:
        cfg = json.loads(raw or "{}")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="email_config must be JSON") from exc
    if isinstance(cfg, dict) and not cfg.get("password"):
        try:
            old = json.loads(get_app_settings_map(["email_config"]).get("email_config") or "{}")
        except ValueError:
            old = {}
        if isinstance(old, dict) and old.get("password"):
            cfg["password"] = old["password"]
    return json.dumps(cfg)

@router.get("/company-settings")
def read_company_settings(
    request: Request,
    company_id: str | None = Query(default=None),
    ctx: WorkspaceContext = Depends(workspace_member),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    raw = company_id or request.headers.get("x-company-id")
    if not (raw or "").strip():
        return {}
    return get_company_settings(require_company_access(db, ctx, raw, "read"))


@router.get("/properties")
def list_demo_properties() -> dict[str, Any]:
    """Return demo_properties rows for AP Property / Project dropdown."""
    try:
        from app.core.supabase import get_supabase

        sb = get_supabase()
        res = (
            sb.table("demo_properties")
            .select("id, property_name, location, property_type")
            .order("property_name")
            .execute()
        )
        rows: list[dict[str, Any]] = []
        for raw in res.data or []:
            name = (raw.get("property_name") or "").strip()
            if not name:
                continue
            rows.append(
                {
                    "id": raw.get("id"),
                    "property_name": name,
                    "location": (raw.get("location") or "").strip() or None,
                    "property_type": (raw.get("property_type") or "").strip() or None,
                }
            )
        return {"properties": rows}
    except Exception as exc:
        msg = str(exc).lower()
        if "schema cache" in msg or "does not exist" in msg or "404" in msg:
            logger.warning("demo_properties table missing: %s", exc)
            return {"properties": []}
        logger.exception("demo_properties fetch failed")
        raise HTTPException(status_code=502, detail=f"Failed to load properties: {exc}") from exc


@router.post("/bootstrap-supabase-tables", dependencies=[Depends(platform_admin)])
def bootstrap_supabase_tables() -> dict[str, str]:
    """
    Apply 017_ap_missing_core_tables.sql when SUPABASE_DB_URL is set in backend/.env.
    Otherwise run that file manually in Supabase SQL Editor.
    """
    db_url = (os.getenv("SUPABASE_DB_URL") or "").strip()
    if not db_url.startswith("postgresql"):
        raise HTTPException(
            status_code=503,
            detail=(
                "Set SUPABASE_DB_URL in backend/.env (Supabase → Database → Connection string), "
                "or run supabase/migrations/017_ap_missing_core_tables.sql in SQL Editor."
            ),
        )
    if not _BOOTSTRAP_SCRIPT.is_file():
        raise HTTPException(status_code=500, detail="bootstrap_ap_supabase.py not found")

    proc = subprocess.run(
        [sys.executable, str(_BOOTSTRAP_SCRIPT)],
        capture_output=True,
        text=True,
        cwd=str(_BACKEND),
        env={**os.environ, "SUPABASE_DB_URL": db_url},
    )
    if proc.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=(proc.stderr or proc.stdout or "bootstrap failed").strip()[:2000],
        )
    return {"message": "Applied 017_ap_missing_core_tables.sql", "output": (proc.stdout or "").strip()}


@router.post("/bootstrap-training-tables", dependencies=[Depends(platform_admin)])
def bootstrap_training_tables() -> dict[str, str]:
    """Apply 022_ap_training_tables.sql when SUPABASE_DB_URL is set."""
    db_url = (os.getenv("SUPABASE_DB_URL") or "").strip()
    if not db_url.startswith("postgresql"):
        raise HTTPException(
            status_code=503,
            detail=(
                "Set SUPABASE_DB_URL in backend/.env, or run "
                "supabase/migrations/022_ap_training_tables.sql in Supabase SQL Editor."
            ),
        )
    if not _TRAINING_BOOTSTRAP.is_file():
        raise HTTPException(status_code=500, detail="bootstrap_training_tables.py not found")

    proc = subprocess.run(
        [sys.executable, str(_TRAINING_BOOTSTRAP)],
        capture_output=True,
        text=True,
        cwd=str(_BACKEND),
        env={**os.environ, "SUPABASE_DB_URL": db_url},
    )
    if proc.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=(proc.stderr or proc.stdout or "bootstrap failed").strip()[:2000],
        )
    return {"message": "Applied 022_ap_training_tables.sql", "output": (proc.stdout or "").strip()}
