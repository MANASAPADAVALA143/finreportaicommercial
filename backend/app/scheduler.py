import json
from datetime import datetime
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import inspect, text

from app.agents.intelligence import generate_board_pack_content, generate_insight
from app.agents.memory import read_agent_memory, store_agent_run, update_agent_memory
from app.board_pack_generator import generate_pdf
from app.core.config import settings
from app.core.database import SessionLocal
from app.notifications import send_email_alert, send_whatsapp_alert

scheduler = AsyncIOScheduler()
_ses_scheduler_started = False


async def run_ses_email_intake_job():
    """Poll SES S3 bucket for new invoice emails."""
    try:
        from app.services.ap_ses_intake_service import process_pending_emails

        result = await process_pending_emails(limit=20)
        print(
            f"[{datetime.now()}] SES email intake: "
            f"processed={result.get('processed')} invoices={result.get('invoices_created')}"
        )
    except Exception as exc:
        print(f"SES email intake job error: {exc}")


def setup_ses_intake_scheduler():
    """Start SES poll every N minutes (independent of CFO scheduler flag)."""
    global _ses_scheduler_started
    if not settings.ENABLE_SES_EMAIL_INTAKE:
        return None
    from app.core.aws_config import aws_configured

    if not aws_configured():
        print("SES email intake scheduler not started: AWS credentials not configured")
        return None
    minutes = max(1, int(settings.SES_EMAIL_INTAKE_INTERVAL_MINUTES or 5))
    if not scheduler.running:
        scheduler.configure(timezone=settings.CFO_SCHEDULER_TZ)
        scheduler.start()
    scheduler.add_job(
        run_ses_email_intake_job,
        IntervalTrigger(minutes=minutes),
        id="ses_email_intake",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    _ses_scheduler_started = True
    print(f"SES email intake scheduler started (every {minutes} min)")
    return scheduler


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
        required = {"agent_name", "insight", "urgency", "created_at", "tenant_id"}
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


async def run_recurring_invoices_job():
    """Generate draft AR invoices from due recurring templates (all tenants)."""
    from datetime import date

    from app.services.recurring_invoice_service import generate_due_invoices_all_tenants

    db = SessionLocal()
    try:
        result = generate_due_invoices_all_tenants(db, date.today())
        print(
            f"[{datetime.now()}] Recurring invoices: "
            f"{result.get('generated_count', 0)} generated across "
            f"{result.get('tenant_count', 0)} tenant(s)"
        )
    except Exception as exc:
        print(f"Recurring invoices job error: {exc}")
    finally:
        db.close()


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


def _runs_by_workspace(db, days: int = 30) -> dict[str, dict[str, Any]]:
    """Latest insight per agent for each workspace. Runs without a tenant_id are never included."""
    since = f"datetime('now', '-{int(days)} day')" if db.bind.dialect.name == "sqlite" else f"NOW() - INTERVAL '{int(days)} days'"
    runs = db.execute(
        text(
            f"""
            SELECT tenant_id, agent_name, insight
            FROM agent_runs
            WHERE tenant_id IS NOT NULL AND tenant_id <> '' AND created_at > {since}
            ORDER BY created_at DESC
            """
        )
    ).fetchall()

    by_workspace: dict[str, dict[str, Any]] = {}
    for run in runs:
        row = _row_to_dict(run)
        name = str(row.get("agent_name") or "").split(":")[0]
        results = by_workspace.setdefault(row["tenant_id"], {})
        if not name or name in results:
            continue
        insight_value = row.get("insight")
        if isinstance(insight_value, str):
            try:
                insight_value = json.loads(insight_value)
            except json.JSONDecodeError:
                insight_value = {"note": insight_value}
        results[name] = insight_value
    return by_workspace


async def run_board_pack_agent() -> list[str]:
    """Generate one monthly board pack per workspace from that workspace's runs only."""
    db = SessionLocal()
    generated: list[str] = []
    try:
        if not _has_agentic_runs_schema(db):
            print("Board pack agent skipped: agent_runs schema not ready")
            return generated
        by_workspace = _runs_by_workspace(db)
    except Exception as exc:
        print(f"Board pack error: {exc}")
        return generated
    finally:
        db.close()

    stamp = datetime.now().strftime("%Y_%m")
    for workspace_id, all_results in by_workspace.items():
        try:
            content = await generate_board_pack_content(all_results)
            pdf_path = await generate_pdf(content, f"board_pack_{workspace_id}_{stamp}.pdf")
            generated.append(pdf_path)
            print(f"Board pack generated for workspace {workspace_id}: {pdf_path}")
        except Exception as exc:
            print(f"Board pack error for workspace {workspace_id}: {exc}")
    return generated


def setup_scheduler():
    """Configure all scheduled jobs."""
    if not scheduler.running:
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
    scheduler.add_job(
        run_recurring_invoices_job,
        CronTrigger(hour=4, minute=0, timezone="UTC"),
        id="recurring_ar_invoices",
        replace_existing=True,
    )
    return scheduler
