import asyncio
import json
import logging
import os
import tempfile
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv()

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import inspect, text
from app.core.config import settings
from app.core.mcp_auth_middleware import add_mcp_api_key_middleware
from app.core.database import get_db
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
    rev_rec_recon,
)
from app.db import init_db
from app.agents.intelligence import generate_board_pack_content
from app.board_pack_generator import generate_pdf
from app.scheduler import run_daily_watchdog, scheduler, setup_scheduler
from app.agents.command_center.registry import list_agent_names
from app.services.cfo_orchestrator_service import create_queued_run, execute_cfo_agent_task

_BOARD_PACK_DIR = Path(__file__).resolve().parent.parent / "board_packs"
os.makedirs(_BOARD_PACK_DIR, exist_ok=True)


def _init_db_safe() -> None:
    try:
        init_db()
    except Exception:
        logger.exception("init_db failed — API will run but DB-backed routes may error until fixed")


def _is_sqlite(db) -> bool:
    try:
        return db.bind is not None and db.bind.dialect.name == "sqlite"
    except Exception:
        return False


def _has_agentic_runs_schema(db) -> bool:
    try:
        cols = {c.get("name") for c in inspect(db.bind).get_columns("agent_runs")}
        required = {"agent_name", "insight", "urgency", "created_at"}
        return required.issubset(cols)
    except Exception:
        return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run DB setup in a thread so startup does not block the server from accepting
    # connections (slow/unreachable DB or SQLite on a synced drive otherwise looks like a hung tab).
    asyncio.create_task(asyncio.to_thread(_init_db_safe))
    if settings.ENABLE_CFO_SCHEDULER:
        setup_scheduler()
        if not scheduler.running:
            scheduler.start()
            print("Agentic scheduler started")
            logger.info("Agentic scheduler started")
        asyncio.create_task(run_daily_watchdog())
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    lifespan=lifespan,
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
app.include_router(rev_rec_recon.router)

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
    # Local: return HTML so embedded browsers (e.g. VS Code Simple Browser) show content; redirects there are often blank.
    if settings.DEBUG and not os.environ.get("RAILWAY_ENVIRONMENT"):
        return HTMLResponse(
            "<!DOCTYPE html><html lang='en'><head><meta charset='utf-8'/>"
            f"<title>{settings.APP_NAME} API</title></head>"
            "<body style='font-family:system-ui,sans-serif;max-width:42rem;margin:2rem;line-height:1.5'>"
            f"<h1 style='font-size:1.25rem'>{settings.APP_NAME} — API</h1>"
            "<p>This port is the FastAPI backend. The React UI is started with Vite, usually at "
            "<a href='http://localhost:3006'>http://localhost:3006</a>.</p>"
            "<ul>"
            "<li><a href='/docs'>Swagger UI</a> (<code>/docs</code>)</li>"
            "<li><a href='/redoc'>ReDoc</a> (<code>/redoc</code>)</li>"
            "<li><a href='/health'>Health</a> (<code>/health</code>)</li>"
            "</ul></body></html>"
        )
    return {
        "app": settings.APP_NAME,
        "version": settings.VERSION,
        "status": "running",
    }

@app.get("/health")
async def health():
    return {"status": "healthy"}


class RunAgentCompatBody(BaseModel):
    agent_name: str = Field(..., min_length=1)
    test_mode: bool = False
    context: dict = Field(default_factory=dict)


@app.post("/api/agents/run")
async def run_agent_compat(
    body: RunAgentCompatBody,
    background_tasks: BackgroundTasks,
    db=Depends(get_db),
):
    """
    Compatibility endpoint for one-body agent trigger style.
    """
    agent_name = body.agent_name.strip().lower()
    valid_agents = list_agent_names()
    if agent_name not in valid_agents:
        raise HTTPException(status_code=400, detail=f"Unknown agent. Valid: {', '.join(valid_agents)}")
    row = create_queued_run(db, "default", agent_name, body.context or {})
    background_tasks.add_task(execute_cfo_agent_task, row.id)
    return {"cfo_run_id": row.run_id, "id": row.id, "agent": agent_name, "status": "queued"}


@app.get("/api/agents/latest-brief")
async def get_latest_brief(db=Depends(get_db)):
    """
    Called automatically on CFO login.
    Returns today's insights with 3-tier urgency buckets.
    """
    try:
        if not _has_agentic_runs_schema(db):
            return {
                "date": datetime.now().isoformat(),
                "alerts": {"red": [], "yellow": [], "green": []},
                "total_agents_run": 0,
                "last_run": None,
            }

        if _is_sqlite(db):
            rows = db.execute(
                text(
                    """
                    SELECT ar.agent_name, ar.insight, ar.urgency, ar.created_at
                    FROM agent_runs ar
                    INNER JOIN (
                      SELECT agent_name, MAX(created_at) AS max_created_at
                      FROM agent_runs
                      WHERE created_at > datetime('now', '-1 day')
                      GROUP BY agent_name
                    ) latest
                      ON ar.agent_name = latest.agent_name
                     AND ar.created_at = latest.max_created_at
                    ORDER BY ar.created_at DESC
                    """
                )
            ).fetchall()
        else:
            rows = db.execute(
                text(
                    """
                    SELECT DISTINCT ON (agent_name)
                      agent_name, insight, urgency, created_at
                    FROM agent_runs
                    WHERE created_at > NOW() - INTERVAL '24 hours'
                    ORDER BY agent_name, created_at DESC
                    """
                )
            ).fetchall()

        alerts: dict[str, list[dict]] = {"red": [], "yellow": [], "green": []}
        for row in rows:
            item = dict(row._mapping)
            insight = item.get("insight")
            if isinstance(insight, str):
                try:
                    insight = json.loads(insight)
                except json.JSONDecodeError:
                    insight = {"what_happened": insight}
            urgency = (item.get("urgency") or "green").lower()
            if urgency not in alerts:
                urgency = "green"
            alerts[urgency].append(
                {
                    "agent": item.get("agent_name"),
                    "insight": insight,
                    "time": str(item.get("created_at")),
                }
            )

        return {
            "date": datetime.now().isoformat(),
            "alerts": alerts,
            "total_agents_run": len(rows),
            "last_run": str(rows[0]._mapping["created_at"]) if rows else None,
        }
    except Exception as exc:
        return {
            "date": datetime.now().isoformat(),
            "alerts": {"red": [], "yellow": [], "green": []},
            "total_agents_run": 0,
            "error": str(exc),
        }


@app.post("/api/board-pack/generate")
async def generate_board_pack(db=Depends(get_db)):
    """
    Generate board pack with streaming progress updates.
    """

    async def stream_progress():
        steps = [
            "Collecting variance data",
            "Running forecast analysis",
            "Analysing cash position",
            "Generating AI commentary",
            "Compiling board pack",
            "Generating PDF",
        ]

        for step in steps:
            yield f"data: {json.dumps({'step': step, 'status': 'running'})}\n\n"
            await asyncio.sleep(1)

        rows = []
        if _has_agentic_runs_schema(db):
            if _is_sqlite(db):
                rows = db.execute(
                    text(
                        """
                        SELECT ar.agent_name, ar.insight
                        FROM agent_runs ar
                        INNER JOIN (
                          SELECT agent_name, MAX(created_at) AS max_created_at
                          FROM agent_runs
                          WHERE created_at > datetime('now', '-30 days')
                          GROUP BY agent_name
                        ) latest
                          ON ar.agent_name = latest.agent_name
                         AND ar.created_at = latest.max_created_at
                        ORDER BY ar.created_at DESC
                        """
                    )
                ).fetchall()
            else:
                rows = db.execute(
                    text(
                        """
                        SELECT DISTINCT ON (agent_name)
                          agent_name, insight
                        FROM agent_runs
                        WHERE created_at > NOW() - INTERVAL '30 days'
                        ORDER BY agent_name, created_at DESC
                        """
                    )
                ).fetchall()
        all_results = {}
        for row in rows:
            item = dict(row._mapping)
            insight = item.get("insight")
            if isinstance(insight, str):
                try:
                    insight = json.loads(insight)
                except json.JSONDecodeError:
                    insight = {"note": insight}
            all_results[item.get("agent_name", "unknown")] = insight

        content = await generate_board_pack_content(all_results)
        pdf_path = await generate_pdf(content, f"board_pack_{datetime.now().strftime('%Y_%m')}.pdf")
        yield f"data: {json.dumps({'step': 'complete', 'pdf_path': pdf_path, 'content': content}, default=str)}\n\n"

    return StreamingResponse(stream_progress(), media_type="text/event-stream")


@app.get("/api/board-pack/download-file/{filename}")
async def download_board_pack(filename: str):
    """Download generated board pack PDF."""
    path = os.path.join(tempfile.gettempdir(), filename)
    if os.path.exists(path):
        return FileResponse(path, media_type="application/pdf", filename=filename)
    return {"error": "Board pack not found"}
