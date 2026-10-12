"""CFO Command Center brief and on-demand board pack, scoped to the caller's workspace."""

import asyncio
import json
import os
import tempfile
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.core.company_access import require_workspace_level
from app.core.database import get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace

router = APIRouter(tags=["agents"], dependencies=[Depends(validate_workspace)])

_RUN_COLUMNS = {"agent_name", "insight", "urgency", "created_at", "tenant_id"}


def _is_sqlite(db: Session) -> bool:
    try:
        return db.bind is not None and db.bind.dialect.name == "sqlite"
    except Exception:
        return False


def _has_runs_schema(db: Session) -> bool:
    try:
        cols = {c.get("name") for c in inspect(db.bind).get_columns("agent_runs")}
        return _RUN_COLUMNS.issubset(cols)
    except Exception:
        return False


def _latest_runs(db: Session, workspace_id: str, days: int) -> list[dict]:
    """Most recent run per agent key for this workspace. Untagged runs are never returned."""
    if not _has_runs_schema(db):
        return []
    since = f"datetime('now', '-{int(days)} day')" if _is_sqlite(db) else f"NOW() - INTERVAL '{int(days)} days'"
    rows = db.execute(
        text(
            f"""
            SELECT agent_name, insight, urgency, created_at
            FROM agent_runs
            WHERE tenant_id = :ws AND created_at > {since}
            ORDER BY created_at DESC
            """
        ),
        {"ws": workspace_id},
    ).fetchall()
    latest: dict[str, dict] = {}
    for row in rows:
        item = dict(row._mapping)
        latest.setdefault(item["agent_name"], item)
    return list(latest.values())


def _insight(raw, fallback_key: str):
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {fallback_key: raw}
    return raw


def _board_pack_prefix(workspace_id: str) -> str:
    return f"board_pack_{workspace_id}_"


class RunAgentCompatBody(BaseModel):
    agent_name: str = Field(..., min_length=1)
    test_mode: bool = False
    context: dict = Field(default_factory=dict)


@router.post("/api/agents/run")
async def run_agent_compat(
    body: RunAgentCompatBody,
    background_tasks: BackgroundTasks,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
):
    """
    Compatibility endpoint for one-body agent trigger style.
    """
    from app.agents.command_center.registry import list_agent_names
    from app.services.cfo_orchestrator_service import create_queued_run, execute_cfo_agent_task

    require_workspace_level(db, ctx, "write")
    agent_name = body.agent_name.strip().lower()
    valid_agents = list_agent_names()
    if agent_name not in valid_agents:
        raise HTTPException(status_code=400, detail=f"Unknown agent. Valid: {', '.join(valid_agents)}")
    row = create_queued_run(db, ctx.workspace_id, agent_name, body.context or {})
    background_tasks.add_task(execute_cfo_agent_task, row.id)
    return {"cfo_run_id": row.run_id, "id": row.id, "agent": agent_name, "status": "queued"}


@router.get("/api/agents/latest-brief")
async def get_latest_brief(
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
):
    """
    Called automatically on CFO login.
    Returns today's insights with 3-tier urgency buckets.
    """
    require_workspace_level(db, ctx, "read")
    try:
        rows = _latest_runs(db, ctx.workspace_id, days=1)
        alerts: dict[str, list[dict]] = {"red": [], "yellow": [], "green": []}
        for item in rows:
            urgency = (item.get("urgency") or "green").lower()
            if urgency not in alerts:
                urgency = "green"
            alerts[urgency].append(
                {
                    "agent": str(item.get("agent_name") or "").split(":")[0],
                    "insight": _insight(item.get("insight"), "what_happened"),
                    "time": str(item.get("created_at")),
                }
            )
        return {
            "date": datetime.now().isoformat(),
            "alerts": alerts,
            "total_agents_run": len(rows),
            "last_run": str(rows[0]["created_at"]) if rows else None,
        }
    except Exception as exc:
        return {
            "date": datetime.now().isoformat(),
            "alerts": {"red": [], "yellow": [], "green": []},
            "total_agents_run": 0,
            "error": str(exc),
        }


@router.post("/api/board-pack/generate")
async def generate_board_pack(
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
):
    """
    Generate board pack with streaming progress updates.
    """
    from app.agents.intelligence import generate_board_pack_content
    from app.board_pack_generator import generate_pdf

    require_workspace_level(db, ctx, "read")
    workspace_id = ctx.workspace_id
    all_results: dict = {}
    for item in _latest_runs(db, workspace_id, days=30):
        name = str(item.get("agent_name") or "unknown").split(":")[0]
        all_results.setdefault(name, _insight(item.get("insight"), "note"))

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

        content = await generate_board_pack_content(all_results)
        filename = f"{_board_pack_prefix(workspace_id)}{datetime.now().strftime('%Y_%m')}.pdf"
        await generate_pdf(content, filename)
        yield f"data: {json.dumps({'step': 'complete', 'pdf_path': filename, 'content': content}, default=str)}\n\n"

    return StreamingResponse(stream_progress(), media_type="text/event-stream")


@router.get("/api/board-pack/download-file/{filename}")
async def download_board_pack(
    filename: str,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
):
    """Download generated board pack PDF."""
    require_workspace_level(db, ctx, "read")
    if (
        os.path.basename(filename) != filename
        or not filename.startswith(_board_pack_prefix(ctx.workspace_id))
        or not filename.endswith(".pdf")
    ):
        raise HTTPException(status_code=404, detail="Board pack not found")
    path = os.path.join(tempfile.gettempdir(), filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Board pack not found")
    return FileResponse(path, media_type="application/pdf", filename=filename)
