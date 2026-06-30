"""AP invoice AI training — upload historical data and build vendor profiles."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.ap_training_service import train_from_invoices

router = APIRouter(prefix="/api/training", tags=["AP Training"])


class TrainingUploadBody(BaseModel):
    company_id: str = Field(..., min_length=1)
    invoices: list[dict[str, Any]] = Field(..., min_length=5)
    file_name: str | None = None


@router.post("/upload")
def training_upload(body: TrainingUploadBody) -> dict[str, Any]:
    try:
        return train_from_invoices(body.company_id, body.invoices, body.file_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"{exc}. Set SUPABASE_URL and SUPABASE_KEY in backend/.env and run migration 022_ap_training_tables.sql",
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
