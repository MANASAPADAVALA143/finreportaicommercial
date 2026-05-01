import json
from datetime import datetime
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import inspect, text

from app.agents.intelligence import generate_board_pack_content, generate_insight
from app.agents.memory import read_agent_memory, store_agent_run, update_agent_memory
from app.board_pack_generator import generate_pdf
from app.core.config import settings
from app.core.database import SessionLocal
from app.notifications import send_email_alert, send_whatsapp_alert

scheduler = AsyncIOScheduler()


def _row_to_dict(row: Any) -> dict[str, Any]:
    if row is None:
        return {}
    mapping = getattr(row, "_mapping", None)
    if mapping is not None:
        return dict(mapping)
    if isinstance(row, dict):
        return row
    return {}


def _table_exists(db, table_name: str) -> bool:
    try:
        return bool(db.bind and inspect(db.bind).has_table(table_name))
    except Exception:
        return False


def _has_agentic_runs_schema(db) -> bool:
    try:
        cols = {c.get("name") for c in inspect(db.bind).get_columns("agent_runs")}
        required = {"agent_name", "insight", "urgency", "created_at"}
        return required.issubset(cols)
    except Exception:
        return False


async def run_variance_agent(db):
    """Autonomous variance analysis using latest FP&A result."""
    try:
        if not _table_exists(db, "fpa_results"):
            print("Variance agent skipped: fpa_results table not found")
            return None
        latest = db.execute(text("SELECT * FROM fpa_results ORDER BY created_at DESC LIMIT 1")).first()
        if not latest:
            return None

        current_data = _row_to_dict(latest)
        history = await read_agent_memory("fpa_variance", db)
        insight = await generate_insight("fpa_variance", current_data, history)

        await update_agent_memory("fpa_variance", current_data, db)
        await store_agent_run("fpa_variance", current_data, current_data, insight, db)

        if insight.get("urgency") == "red":
            message = f"FinReportAI ALERT\n{insight.get('what_happened', '')}\nAction: {insight.get('what_to_do', '')}"
            await send_whatsapp_alert(message)
            await send_email_alert("Urgent Financial Alert", insight)
        return insight
    except Exception as exc:
        print(f"Variance agent error: {exc}")
        return None


async def run_forecast_agent(db):
    """Weekly forecast update using latest forecast output."""
    try:
        if not _table_exists(db, "forecast_results"):
            print("Forecast agent skipped: forecast_results table not found")
            return None
        forecast = db.execute(text("SELECT * FROM forecast_results ORDER BY created_at DESC LIMIT 1")).first()
        if not forecast:
            return None

        current_data = _row_to_dict(forecast)
        history = await read_agent_memory("fpa_forecast", db)
        insight = await generate_insight("fpa_forecast", current_data, history)

        await update_agent_memory("fpa_forecast", current_data, db)
        await store_agent_run("fpa_forecast", current_data, current_data, insight, db)
        return insight
    except Exception as exc:
        print(f"Forecast agent error: {exc}")
        return None


async def run_daily_watchdog():
    """Master orchestrator for scheduled daily runs."""
    db = SessionLocal()
    try:
        print(f"[{datetime.now()}] Daily watchdog started")
        variance = await run_variance_agent(db)
        forecast = await run_forecast_agent(db)
        alerts = [result for result in [variance, forecast] if result]
        red_alerts = [a for a in alerts if a.get("urgency") == "red"]
        if red_alerts:
            print(f"RED ALERTS: {len(red_alerts)}")
        print(f"[{datetime.now()}] Daily watchdog complete")
    except Exception as exc:
        print(f"Watchdog error: {exc}")
    finally:
        db.close()


async def run_board_pack_agent():
    """Generate and send monthly board pack."""
    db = SessionLocal()
    try:
        if not _has_agentic_runs_schema(db):
            print("Board pack agent skipped: agent_runs schema not ready")
            return
        runs = db.execute(
            text(
                """
                SELECT agent_name, insight
                FROM agent_runs
                WHERE created_at > NOW() - INTERVAL '30 days'
                ORDER BY created_at DESC
                """
            )
        ).fetchall()

        all_results: dict[str, Any] = {}
        for run in runs:
            row = _row_to_dict(run)
            name = row.get("agent_name")
            if not name or name in all_results:
                continue
            insight_value = row.get("insight")
            if isinstance(insight_value, str):
                try:
                    insight_value = json.loads(insight_value)
                except json.JSONDecodeError:
                    insight_value = {"note": insight_value}
            all_results[name] = insight_value

        content = await generate_board_pack_content(all_results)
        now = datetime.now()
        pdf_path = await generate_pdf(content, f"board_pack_{now.year}_{now.month}.pdf")

        db.execute(
            text(
                """
                INSERT INTO board_packs (month, year, pdf_path, content, sent_to_cfo)
                VALUES (:month, :year, :pdf_path, CAST(:content AS JSONB), TRUE)
                """
            ),
            {
                "month": now.month,
                "year": now.year,
                "pdf_path": pdf_path,
                "content": json.dumps(content, default=str),
            },
        )
        db.commit()
        await send_email_alert(
            f"Board Pack Ready — {now.strftime('%B %Y')}",
            {"board_pack_path": pdf_path, "content": content},
        )
        print(f"Board pack generated: {pdf_path}")
    except Exception as exc:
        print(f"Board pack error: {exc}")
        db.rollback()
    finally:
        db.close()


def setup_scheduler():
    """Configure all scheduled jobs."""
    if scheduler.running:
        return scheduler

    scheduler.configure(timezone=settings.CFO_SCHEDULER_TZ)
    scheduler.add_job(
        run_daily_watchdog,
        CronTrigger(hour=6, minute=0),
        id="daily_watchdog",
        replace_existing=True,
    )
    scheduler.add_job(
        run_daily_watchdog,
        CronTrigger(day_of_week="mon", hour=7, minute=0),
        id="weekly_forecast",
        replace_existing=True,
    )
    scheduler.add_job(
        run_board_pack_agent,
        CronTrigger(day=1, hour=8, minute=0),
        id="monthly_board_pack",
        replace_existing=True,
    )
    return scheduler
