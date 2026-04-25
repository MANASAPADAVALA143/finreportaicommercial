import logging
import os
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from app.core.config import settings
from app.core.mcp_auth_middleware import add_mcp_api_key_middleware
from app.api.routes import (
    upload_routes,
    auth_routes,
    cfo_dashboard,
    ifrs_statements,
    ifrs_week1,
    ifrs_agentic,
    nova,
    fpa_variance,
    fpa_pvm,
    fpa_three_statement,
    fpa_monte_carlo,
    fpa_arr,
    fpa_headcount,
    fpa_sensitivity,
    reports_board_pack,
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
    chat,
    cfo_agents,
)
from app.db import init_db

_BOARD_PACK_DIR = Path(__file__).resolve().parent.parent / "board_packs"
os.makedirs(_BOARD_PACK_DIR, exist_ok=True)

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION
)

# CORS — explicit list + regex for localhost ports and Excel / Microsoft 365 web clients
_cors_kwargs: dict = {
    "allow_origins": list(settings.BACKEND_CORS_ORIGINS),
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}
# Excel Online / Office add-ins use subdomains of officeapps.live.com, office.com, microsoft.com
_cors_kwargs["allow_origin_regex"] = (
    r"https?://(localhost|127\.0\.0\.1)(:\d+)?"
    r"|https://([\w\-]+\.)*(officeapps\.live\.com|office\.com|microsoft\.com)"
)
app.add_middleware(CORSMiddleware, **_cors_kwargs)
add_mcp_api_key_middleware(app, settings.CLIENT_API_KEY)


@app.on_event("startup")
def startup():
    # DB init must not block the process from listening: Railway healthchecks /health
    # while startup hooks run; a failing Postgres URL would otherwise fail the deploy.
    try:
        init_db()
    except Exception:
        logger.exception("init_db failed — API will run but DB-backed routes may error until fixed")


# Routes
app.include_router(auth_routes.router)
app.include_router(upload_routes.router)
app.include_router(cfo_dashboard.router)
app.include_router(ifrs_statements.router)
app.include_router(ifrs_week1.router, prefix="/api/ifrs")
app.include_router(ifrs_agentic.router)
app.include_router(nova.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(cfo_agents.agents_router)
app.include_router(cfo_agents.briefing_router)
app.include_router(fpa_variance.router)
app.include_router(fpa_pvm.router, prefix="/api/fpa")
app.include_router(fpa_three_statement.router, prefix="/api/fpa")
app.include_router(fpa_monte_carlo.router, prefix="/api/fpa")
app.include_router(fpa_arr.router, prefix="/api/fpa")
app.include_router(fpa_headcount.router, prefix="/api/fpa")
app.include_router(fpa_sensitivity.router, prefix="/api/fpa")
app.include_router(reports_board_pack.router)
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
    try:
        from fastapi_mcp import FastApiMCP

        FastApiMCP(app).mount()
    except ImportError:
        logger.warning(
            "fastapi-mcp is not installed; MCP is disabled (pip install fastapi-mcp)."
        )
    except Exception as e:
        # Do not fail the whole API if MCP mount breaks in production.
        logger.warning("fastapi-mcp mount skipped: %s", e)

@app.get("/")
async def root():
    # Local: browser at http://127.0.0.1:8000/ jumps to Swagger. On Railway, keep JSON (RAILWAY_ENVIRONMENT is set).
    if settings.DEBUG and not os.environ.get("RAILWAY_ENVIRONMENT"):
        return RedirectResponse(url="/docs", status_code=302)
    return {
        "app": settings.APP_NAME,
        "version": settings.VERSION,
        "status": "running",
    }

@app.get("/health")
async def health():
    return {"status": "healthy"}
