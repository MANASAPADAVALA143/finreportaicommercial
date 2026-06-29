"""Mount uaetax (GulfTax standalone) FastAPI routers inside FinReportAI."""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Generator

from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

PORTED_ROOT = Path(__file__).resolve().parent / "ported"
_DB_INITIALIZED = False


def _ensure_ported_path() -> None:
    root = str(PORTED_ROOT)
    if root not in sys.path:
        sys.path.insert(0, root)


def _ensure_database_url() -> None:
    """Use unified AWS RDS — never fall back to local gulftax.db."""
    main_url = (os.getenv("DATABASE_URL") or "").strip()
    gulftax_url = (os.getenv("GULFTAX_DATABASE_URL") or "").strip()
    if gulftax_url:
        os.environ["DATABASE_URL"] = gulftax_url
    elif main_url:
        os.environ["DATABASE_URL"] = main_url
    else:
        logger.warning(
            "DATABASE_URL not set — GulfTax ported module requires AWS RDS. "
            "Set DATABASE_URL in backend/.env (estatecfo RDS)."
        )


def get_ported_db() -> Generator[Session, None, None]:
    _ensure_ported_path()
    _ensure_database_url()
    from database import SessionLocal  # noqa: WPS433 — ported package

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _patch_auth() -> None:
    _ensure_ported_path()
    import middleware.auth as auth_mod  # noqa: WPS433
    from app.modules.gulftax.auth_cfo import get_current_company_id as cfo_company_id

    auth_mod.get_current_company_id = cfo_company_id


def _run_migrations() -> None:
    _ensure_ported_path()
    _ensure_database_url()
    from database import engine, Base  # noqa: WPS433

    Base.metadata.create_all(bind=engine)
    migrations = [
        "ALTER TABLE companies ADD COLUMN external_id VARCHAR(64)",
        "ALTER TABLE companies ADD COLUMN workspace_id VARCHAR(64)",
    ]
    try:
        with engine.connect() as conn:
            for sql in migrations:
                try:
                    conn.execute(text(sql))
                except Exception:
                    pass
            conn.commit()
    except Exception:
        logger.exception("GulfTax ported column migrations failed")


def init_gulftax_ported_db() -> None:
    global _DB_INITIALIZED
    if _DB_INITIALIZED:
        return
    _ensure_ported_path()
    _ensure_database_url()
    _patch_auth()
    _run_migrations()
    _DB_INITIALIZED = True
    logger.info("GulfTax ported DB initialized at %s", os.getenv("DATABASE_URL"))


def register_gulftax_ported_routers(app: FastAPI) -> None:
    """Include uaetax API routers (GulfTax company auth lives under /api/gulftax/auth)."""
    init_gulftax_ported_db()
    _patch_auth()

    from routers.auth_router import router as auth_router  # noqa: WPS433
    from routers.automations import router as automations_router
    from routers.corporate_tax import router as corporate_tax_router
    from routers.corporatetax_routes import router as corporatetax_spec_router
    from routers.dashboard import router as dashboard_router
    from routers.einvoicing import router as einvoicing_router
    from routers.fta_reports import router as fta_reports_router
    from routers.invoice_flow import router as invoice_flow_router
    from routers.tax_memo import router as tax_memo_router
    from routers.trn_validator import router as trn_validator_router
    from routers.vat_classifier import router as vat_classifier_router
    from routers.vat_return import router as vat_return_router

    app.include_router(auth_router)
    app.include_router(dashboard_router)
    app.include_router(vat_return_router)
    app.include_router(vat_classifier_router)
    app.include_router(automations_router, prefix="/api/automations", tags=["gulftax-automations"])
    app.include_router(corporate_tax_router, prefix="/api/ct", tags=["gulftax-ct"])
    app.include_router(corporatetax_spec_router)
    app.include_router(einvoicing_router)
    app.include_router(tax_memo_router)
    app.include_router(invoice_flow_router)
    app.include_router(fta_reports_router)
    app.include_router(trn_validator_router)
    logger.info("GulfTax ported routers registered")
