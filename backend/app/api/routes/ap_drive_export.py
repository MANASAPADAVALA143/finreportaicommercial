"""AP invoice Excel exports — optional auto-upload to a client's Google Drive folder.

The Excel file itself is still generated client-side exactly as before (see
InvoiceList.tsx `exportExcel`) — this endpoint only handles the new "also
save a copy to Drive" step, since the service-account credentials that talk
to Drive must never reach the browser.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.core.supabase import get_supabase
from app.services.google_drive_service import DriveNotConfigured, upload_excel_to_drive

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ap/companies", tags=["AP Drive Export"])


def _company_drive_folder_url(company_id: str) -> str | None:
    sb = get_supabase()
    res = sb.table("companies").select("drive_folder_url").eq("id", company_id).maybe_single().execute()
    row = res.data or {}
    url = (row.get("drive_folder_url") or "").strip()
    return url or None


@router.post("/{company_id}/export-to-drive")
async def export_excel_to_drive(
    company_id: str,
    file: UploadFile = File(...),
) -> dict[str, Any]:
    """Upload an already-generated Excel export to the company's configured Drive folder.

    Returns {"saved": false, "reason": "no_folder_configured"} when the
    company has no drive_folder_url set — this is the normal case for most
    companies, not an error; the frontend keeps the existing download-only
    behaviour in that case.
    """
    try:
        folder_url = _company_drive_folder_url(company_id)
    except Exception as exc:
        logger.warning("Could not look up drive_folder_url for company %s: %s", company_id, exc)
        return {"saved": False, "reason": "company_lookup_failed"}

    if not folder_url:
        return {"saved": False, "reason": "no_folder_configured"}

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    filename = file.filename or "export.xlsx"

    try:
        result = upload_excel_to_drive(folder_url_or_id=folder_url, filename=filename, content=content)
    except DriveNotConfigured:
        logger.warning("Drive folder set for company %s but GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is not configured", company_id)
        return {"saved": False, "reason": "drive_not_configured"}
    except ValueError as exc:
        return {"saved": False, "reason": "invalid_folder_url", "detail": str(exc)}
    except Exception as exc:
        logger.warning("Drive upload failed for company %s: %s", company_id, exc)
        return {"saved": False, "reason": "upload_failed", "detail": str(exc)[:300]}

    return {"saved": True, "drive_url": result["url"], "overwritten": result["overwritten"]}
