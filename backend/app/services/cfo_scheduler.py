"""Optional APScheduler jobs for CFO Command Center (morning briefing)."""
from __future__ import annotations

import logging
from datetime import date

from app.core.config import settings
from app.core.database import SessionLocal
from app.services import cfo_briefing_service

logger = logging.getLogger(__name__)

_scheduler = None


def _job_morning_briefings() -> None:
    raw = (getattr(settings, "CFO_BRIEFING_TENANT_IDS", None) or "default").strip()
    tenants = [t.strip() for t in raw.split(",") if t.strip()]
    db = SessionLocal()
    try:
        for tid in tenants:
            if not str(tid).strip():
                continue
            existing = cfo_briefing_service.get_briefing_today(db, tid)
            if existing:
                continue
            cfo_briefing_service.build_briefing_for_tenant(db, tid, date.today())
            logger.info("CFO morning briefing generated for tenant=%s", tid)
    except Exception:
        logger.exception("CFO morning briefing job failed")
    finally:
        db.close()


def start_cfo_scheduler() -> None:
    global _scheduler
    if not getattr(settings, "ENABLE_CFO_SCHEDULER", False):
        return
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger
    except ImportError:
        logger.warning("apscheduler not installed; CFO scheduler disabled")
        return
    if _scheduler is not None:
        return
    hour = int(getattr(settings, "CFO_BRIEFING_HOUR_LOCAL", 7))
    minute = int(getattr(settings, "CFO_BRIEFING_MINUTE", 0))
    sched = BackgroundScheduler(timezone=str(getattr(settings, "CFO_SCHEDULER_TZ", "UTC")))
    sched.add_job(_job_morning_briefings, CronTrigger(hour=hour, minute=minute), id="cfo_morning_briefing", replace_existing=True)
    sched.start()
    _scheduler = sched
    logger.info("CFO APScheduler started (briefing at %02d:%02d %s)", hour, minute, getattr(settings, "CFO_SCHEDULER_TZ", "UTC"))
