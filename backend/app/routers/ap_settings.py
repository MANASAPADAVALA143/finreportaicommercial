"""AP settings + one-time Supabase bootstrap for missing core tables."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.services.ap_settings_service import get_app_settings, get_company_settings

router = APIRouter(prefix="/api/ap", tags=["ap-settings"])

_BACKEND = Path(__file__).resolve().parents[2]
_BOOTSTRAP_SCRIPT = _BACKEND / "scripts" / "bootstrap_ap_supabase.py"
_TRAINING_BOOTSTRAP = _BACKEND / "scripts" / "bootstrap_training_tables.py"


@router.get("/app-settings")
def read_app_settings() -> dict[str, str]:
    """n8n webhook URLs — works even when Supabase app_settings table is missing."""
    return get_app_settings()


@router.get("/company-settings")
def read_company_settings(company_id: str | None = Query(default=None)) -> dict[str, Any]:
    return get_company_settings(company_id)


@router.post("/bootstrap-supabase-tables")
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


@router.post("/bootstrap-training-tables")
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
