import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.mcp_auth_middleware import add_mcp_api_key_middleware
from app.api.routes import (
    upload_routes,
    auth_routes,
    cfo_dashboard,
    ifrs_statements,
    ifrs_week1,
    nova,
    fpa_variance,
    r2r_history,
    stateful_journal,
    bank_recon,
    erp_integration,
    bookkeeping,
    r2r_pattern,
    r2r_learning_routes,
    board_pack_routes,
    excel_suite,
    excel_addon_routes,
    voice_inbound,
)
from app.db import init_db

_BOARD_PACK_DIR = Path(__file__).resolve().parent.parent / "board_packs"
os.makedirs(_BOARD_PACK_DIR, exist_ok=True)

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION
)

# CORS — list from env + in DEBUG allow any localhost port (avoids 3006 missing from .env)
_cors_kwargs: dict = {
    "allow_origins": settings.BACKEND_CORS_ORIGINS,
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}
if settings.DEBUG:
    _cors_kwargs["allow_origin_regex"] = r"https?://(localhost|127\.0\.0\.1)(:\d+)?"
app.add_middleware(CORSMiddleware, **_cors_kwargs)
add_mcp_api_key_middleware(app, settings.CLIENT_API_KEY)


@app.on_event("startup")
def startup():
    init_db()


# Routes
app.include_router(auth_routes.router)
app.include_router(upload_routes.router)
app.include_router(cfo_dashboard.router)
app.include_router(ifrs_statements.router)
app.include_router(ifrs_week1.router, prefix="/api/ifrs")
app.include_router(nova.router, prefix="/api")
app.include_router(fpa_variance.router)
app.include_router(r2r_history.router)
app.include_router(stateful_journal.router)
app.include_router(bank_recon.router)
app.include_router(erp_integration.router, prefix="/api")
app.include_router(bookkeeping.router)
app.include_router(r2r_pattern.router)
app.include_router(r2r_learning_routes.router)
app.include_router(board_pack_routes.router, prefix="/api/board-pack")
app.include_router(excel_suite.router, prefix="/api/excel")
app.include_router(excel_addon_routes.router)
app.include_router(voice_inbound.router)

if settings.ENABLE_FASTAPI_MCP:
    import logging

    _log = logging.getLogger(__name__)
    try:
        from fastapi_mcp import FastApiMCP

        FastApiMCP(app).mount()
    except ImportError:
        _log.warning(
            "fastapi-mcp is not installed; MCP is disabled (pip install fastapi-mcp)."
        )
    except Exception as e:
        # Do not fail the whole API if MCP mount breaks in production.
        _log.warning("fastapi-mcp mount skipped: %s", e)

@app.get("/")
async def root():
    return {
        "app": settings.APP_NAME,
        "version": settings.VERSION,
        "status": "running"
    }

@app.get("/health")
async def health():
    return {"status": "healthy"}
