"""AP anomaly detection — ported from standalone InvoiceFlow backend."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.ap_anomaly_engine import detect_batch

router = APIRouter(prefix="/api/ap", tags=["ap-anomaly"])


class DetectRequest(BaseModel):
    invoice: dict[str, Any]
    vendor_history: list[dict[str, Any]] = []
    vendor: dict[str, Any] = {}
    approval_threshold: float = 10_000.0


@router.post("/detect-anomalies")
def detect_anomalies(req: DetectRequest):
    return detect_batch(req.model_dump())


@router.post("/bg-expiry-check")
def bg_expiry_check():
    """Placeholder — BG expiry reminders run via Supabase / scheduled job."""
    return {"status": "ok", "message": "Use bank guarantee service for expiry tracking"}
