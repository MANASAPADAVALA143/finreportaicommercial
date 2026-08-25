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


class CheckAnomalyBody(BaseModel):
    company_id: str = Field(..., min_length=1)
    vendor_name: str = ""
    amount: float = 0
    invoice_date: str = ""


@router.post("/check-anomaly")
def check_anomaly(body: CheckAnomalyBody) -> dict[str, Any]:
    """Lightweight vendor-profile check used by InvoiceFlow upload/import."""
    vendor = (body.vendor_name or "").strip()
    empty = {
        "profile_found": False,
        "is_new_vendor": True,
        "anomaly_flags": [],
        "risk_score_addition": 0,
        "explanations": [],
        "recommended_gl": None,
        "recommended_ifrs": None,
        "recommendation": "no_profile",
    }
    if not vendor:
        return empty
    try:
        from app.core.supabase import get_supabase

        sb = get_supabase()
        res = (
            sb.table("vendor_profiles")
            .select("*")
            .eq("company_id", body.company_id.strip())
            .ilike("vendor_name", vendor)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return {
                **empty,
                "anomaly_flags": ["new_vendor_no_history"],
                "explanations": [f"No trained profile for vendor '{vendor}'"],
                "recommendation": "review_new_vendor",
            }
        p = rows[0] if isinstance(rows[0], dict) else {}
        mean = float(p.get("mean_amount") or p.get("avg_amount") or 0)
        std = float(p.get("std_deviation") or p.get("std_amount") or 0)
        flags: list[str] = []
        explanations: list[str] = []
        risk_add = 0
        if mean > 0 and std >= 0 and body.amount > 0:
            z = (body.amount - mean) / (std if std > 0 else mean * 0.25)
            if z >= 3:
                flags.append("extreme_amount_anomaly")
                explanations.append(f"Amount is far above vendor mean ({mean:.0f})")
                risk_add += 30
            elif z >= 2:
                flags.append("high_amount_anomaly")
                explanations.append(f"Amount is above typical range for this vendor (mean {mean:.0f})")
                risk_add += 15
        if p.get("is_splitting_vendor"):
            flags.append("potential_invoice_splitting")
            explanations.append("Vendor historically shows invoice-splitting pattern")
            risk_add += 20
        return {
            "profile_found": True,
            "is_new_vendor": False,
            "anomaly_flags": flags,
            "risk_score_addition": risk_add,
            "explanations": explanations,
            "recommended_gl": p.get("typical_gl_code") or p.get("typical_gl"),
            "recommended_ifrs": p.get("typical_ifrs"),
            "recommendation": "ok" if not flags else "review",
            "vendor_profile": {
                "mean_amount": mean,
                "std_deviation": std,
                "is_recurring": bool(p.get("is_recurring")),
                "is_splitting_vendor": bool(p.get("is_splitting_vendor")),
                "typical_gl": str(p.get("typical_gl_code") or p.get("typical_gl") or ""),
                "typical_ifrs": str(p.get("typical_ifrs") or ""),
                "trained_on": int(p.get("invoice_count") or p.get("trained_on") or 0),
                "auto_approve_range": {
                    "min": float(p.get("auto_approve_min") or max(0, mean - std)),
                    "max": float(p.get("auto_approve_max") or mean + std),
                },
            },
        }
    except Exception:
        return empty
