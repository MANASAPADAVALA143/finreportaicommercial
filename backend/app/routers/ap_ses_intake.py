"""AWS SES → S3 email invoice intake for AP InvoiceFlow."""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, BackgroundTasks, Query

from app.services.ap_ses_intake_service import (
    fetch_intake_logs,
    process_pending_emails,
    test_email_intake_bucket,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ap/ses-intake", tags=["ap-ses-intake"])


@router.post("/process")
async def process_ses_intake(limit: int = Query(20, ge=1, le=100)) -> dict[str, Any]:
    """Poll S3 email-intake/ prefix, OCR attachments, create invoices."""
    try:
        return await process_pending_emails(limit=limit)
    except Exception as exc:
        logger.exception("ses-intake process failed")
        return {"processed": 0, "invoices_created": 0, "error": str(exc)}


@router.get("/logs")
def ses_intake_logs(
    company_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    """Last N email_intake_log rows (optionally filtered by company)."""
    try:
        logs = fetch_intake_logs(company_id, limit=limit)
        return {"logs": logs, "count": len(logs)}
    except Exception as exc:
        logger.exception("ses-intake logs failed")
        return {"logs": [], "count": 0, "error": str(exc)}


@router.get("/status")
def ses_intake_status() -> dict[str, Any]:
    """S3 connectivity + pending object count."""
    return test_email_intake_bucket()


async def _bg_process() -> None:
    try:
        result = await process_pending_emails(limit=20)
        logger.info(
            "ses-intake background: processed=%s invoices=%s",
            result.get("processed"),
            result.get("invoices_created"),
        )
    except Exception:
        logger.exception("ses-intake background process failed")


@router.post("/trigger")
async def trigger_ses_intake(background_tasks: BackgroundTasks) -> dict[str, Any]:
    """Fire-and-return processing via BackgroundTasks."""
    background_tasks.add_task(_bg_process)
    return {"ok": True, "message": "Processing started in background"}
