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
_PORTED_ORM_ALIASED = False


def _ensure_ported_path() -> None:
    root = str(PORTED_ROOT)
    if root not in sys.path:
        sys.path.insert(0, root)


def _alias_ported_orm_modules() -> None:
    """Make sys.path and package imports resolve to the SAME module objects.

    Root cause of InvalidRequestError (sqlalchemy f405) on ``companies``:
    ``PORTED_ROOT`` is on ``sys.path``, so routers do ``from models import Company``.
    The same files also live under ``app.modules.gulftax.ported``, so
    ``from app.modules.gulftax.ported.models import Company`` re-executes
    ``models.py`` against the same ``database.Base`` MetaData and crashes.

    Canonical load is via sys.path (``models`` / ``database``). We then register
    those modules under the package names so absolute imports are no-ops.
    """
    global _PORTED_ORM_ALIASED
    if _PORTED_ORM_ALIASED:
        return

    import importlib
    import types

    _ensure_ported_path()

    # Parent package must exist before we pin submodule aliases.
    importlib.import_module("app.modules.gulftax")
    ported_pkg_name = "app.modules.gulftax.ported"
    if ported_pkg_name not in sys.modules:
        pkg = types.ModuleType(ported_pkg_name)
        pkg.__path__ = [str(PORTED_ROOT)]  # type: ignore[attr-defined]
        pkg.__package__ = ported_pkg_name
        sys.modules[ported_pkg_name] = pkg

    pkg_database = f"{ported_pkg_name}.database"
    pkg_models = f"{ported_pkg_name}.models"

    # If either import path already loaded the ORM, unify — never re-execute models.py.
    if pkg_models in sys.modules:
        models_mod = sys.modules[pkg_models]
        sys.modules["models"] = models_mod
        if pkg_database in sys.modules:
            sys.modules["database"] = sys.modules[pkg_database]
        elif "database" in sys.modules:
            sys.modules[pkg_database] = sys.modules["database"]
        database_mod = sys.modules.get("database") or sys.modules.get(pkg_database)
    elif "models" in sys.modules:
        models_mod = sys.modules["models"]
        sys.modules[pkg_models] = models_mod
        database_mod = importlib.import_module("database")
        sys.modules[pkg_database] = database_mod
    else:
        database_mod = importlib.import_module("database")
        models_mod = importlib.import_module("models")
        sys.modules[pkg_database] = database_mod
        sys.modules[pkg_models] = models_mod

    _PORTED_ORM_ALIASED = True
    logger.info(
        "GulfTax ORM modules aliased: models=%s database=%s",
        getattr(models_mod, "__name__", models_mod),
        getattr(database_mod, "__name__", database_mod),
    )


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
    _alias_ported_orm_modules()
    _ensure_database_url()
    from database import SessionLocal  # noqa: WPS433 — ported package

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _patch_auth() -> None:
    _alias_ported_orm_modules()
    import middleware.auth as auth_mod  # noqa: WPS433
    from app.modules.gulftax.auth_cfo import get_current_company_id as cfo_company_id

    auth_mod.get_current_company_id = cfo_company_id


def _run_migrations() -> None:
    _alias_ported_orm_modules()
    _ensure_database_url()
    from database import engine, Base  # noqa: WPS433

    Base.metadata.create_all(bind=engine)
    # Extend shared FinReportAI `companies` for GulfTax ported ORM columns.
    # create_all will not alter an existing table; without these, Company queries
    # raise UndefinedColumn and /api/dashboard/summary returns 500.
    migrations = [
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS trade_license_number VARCHAR(100)",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS trn VARCHAR(50)",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50)",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS free_zone_name VARCHAR(255)",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_qfzp BOOLEAN DEFAULT FALSE",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS vat_registered BOOLEAN DEFAULT FALSE",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS ct_registered BOOLEAN DEFAULT FALSE",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS annual_revenue_aed DOUBLE PRECISION",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS asp_appointed BOOLEAN DEFAULT FALSE",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS country VARCHAR(50) DEFAULT 'UAE'",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS fiscal_year_start INTEGER DEFAULT 1",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS vat_registered_date DATE",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS plan VARCHAR(50) DEFAULT 'starter'",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS settings JSONB",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS external_id VARCHAR(64)",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(64)",
        "ALTER TABLE reconciliation_results ADD COLUMN IF NOT EXISTS tax_period VARCHAR(16)",
        "ALTER TABLE reconciliation_results ADD COLUMN IF NOT EXISTS period_start DATE",
        "ALTER TABLE reconciliation_results ADD COLUMN IF NOT EXISTS period_end DATE",
        "ALTER TABLE reconciliation_results ADD COLUMN IF NOT EXISTS box_breakdown JSON",
        "ALTER TABLE reconciliation_results ADD COLUMN IF NOT EXISTS source VARCHAR(64)",
        "ALTER TABLE reconciliation_results ADD COLUMN IF NOT EXISTS override_reason VARCHAR(2000)",
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
    _alias_ported_orm_modules()
    _ensure_database_url()
    _patch_auth()
    _run_migrations()
    _DB_INITIALIZED = True
    logger.info("GulfTax ported DB initialized at %s", os.getenv("DATABASE_URL"))


def register_gulftax_ported_routers(app: FastAPI) -> None:
    """Include uaetax API routers (GulfTax company auth lives under /api/gulftax/auth)."""
    # Alias BEFORE any router import so package-path leftovers cannot re-register ORM.
    _alias_ported_orm_modules()
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
