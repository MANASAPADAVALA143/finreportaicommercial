"""
IFRS Export Routes
==================
Provides file download endpoints for Excel, PDF, and Word exports,
plus the UAE Corporate Tax bridge calculation endpoint.

All routes are mounted under /api/ifrs (via main.py include_router).
"""
from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(tags=["IFRS Export & CT Bridge"])


# ── Dependency: resolve tenant ────────────────────────────────────────────────

def _tenant(x_tenant_id: Annotated[str | None, Header()] = None) -> str:
    return (x_tenant_id or "default").strip()


# ══════════════════════════════════════════════════════════════════════════════
# EXPORT ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/trial-balance/{trial_balance_id}/export/excel",
    summary="Download IFRS statements as Excel (.xlsx)",
    response_class=Response,
)
async def export_excel(
    trial_balance_id: int,
    db: Session = Depends(get_db),
):
    """
    Download all generated IFRS statements, UAE CT bridge, and disclosure notes
    as a multi-sheet Excel workbook.
    """
    try:
        from app.services.ifrs_export import export_to_excel

        data = export_to_excel(trial_balance_id, db)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("Excel export failed for tb_id=%s", trial_balance_id)
        raise HTTPException(status_code=500, detail=f"Excel export error: {e}")

    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename=IFRS_Statements_{trial_balance_id}.xlsx"
        },
    )


@router.get(
    "/trial-balance/{trial_balance_id}/export/pdf",
    summary="Download IFRS statements as PDF",
    response_class=Response,
)
async def export_pdf(
    trial_balance_id: int,
    db: Session = Depends(get_db),
):
    """
    Download all generated IFRS statements, UAE CT bridge, and disclosure notes
    as a professional multi-page PDF.
    """
    try:
        from app.services.ifrs_export import export_to_pdf

        data = export_to_pdf(trial_balance_id, db)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("PDF export failed for tb_id=%s", trial_balance_id)
        raise HTTPException(status_code=500, detail=f"PDF export error: {e}")

    return Response(
        content=data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=IFRS_Statements_{trial_balance_id}.pdf"
        },
    )


@router.get(
    "/trial-balance/{trial_balance_id}/export/word",
    summary="Download IFRS statements as Word (.docx)",
    response_class=Response,
)
async def export_word(
    trial_balance_id: int,
    db: Session = Depends(get_db),
):
    """
    Download all generated IFRS statements, UAE CT bridge, and disclosure notes
    as an editable Word document.
    """
    try:
        from app.services.ifrs_export import export_to_word

        data = export_to_word(trial_balance_id, db)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("Word export failed for tb_id=%s", trial_balance_id)
        raise HTTPException(status_code=500, detail=f"Word export error: {e}")

    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f"attachment; filename=IFRS_Statements_{trial_balance_id}.docx"
        },
    )


# ══════════════════════════════════════════════════════════════════════════════
# UAE CORPORATE TAX BRIDGE ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

class CTBridgeRequest(BaseModel):
    # Disallowed expenses (add back)
    entertainment_expense: float = Field(default=0.0, ge=0, description="Total entertainment & hospitality in P&L")
    fines_penalties: float = Field(default=0.0, ge=0, description="Total fines and penalties in P&L")
    non_business_expenses: float = Field(default=0.0, ge=0, description="Non-business expenses in P&L")
    non_qualifying_depreciation: float = Field(default=0.0, ge=0, description="Depreciation on non-business assets")
    # Exempt income (deduct)
    dividend_income_uae_sub: float = Field(default=0.0, ge=0, description="Dividends from UAE subsidiaries (Participation Exemption)")
    qualifying_capital_gains: float = Field(default=0.0, ge=0, description="Capital gains on qualifying participations")
    qualifying_free_zone_income: float = Field(default=0.0, ge=0, description="Qualifying Free Zone income (if applicable)")
    # Free Zone
    is_free_zone_person: bool = Field(default=False, description="Is entity a Qualifying Free Zone Person?")
    qualifying_income_pct: float = Field(default=100.0, ge=0, le=100, description="% of income that is qualifying FZ income (need ≥95%)")
    # Revenue for SBR
    revenue_override: float = Field(default=0.0, ge=0, description="Override revenue for SBR check (auto-read from P&L if 0)")


@router.post(
    "/trial-balance/{trial_balance_id}/ct-bridge",
    summary="Calculate UAE Corporate Tax bridge",
)
async def generate_ct_bridge(
    trial_balance_id: int,
    payload: CTBridgeRequest,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """
    Calculate UAE Corporate Tax bridge for a trial balance.

    Reads IFRS PBT from the generated P&L statement and applies:
    - Disallowed expense add-backs (entertainment 50%, fines, non-business)
    - Exempt income deductions (Participation Exemption, FZ income)
    - Small Business Relief check (0% if taxable income ≤ AED 375,000)
    - Free Zone eligibility check (0% if ≥95% qualifying income)
    - Standard 9% UAE CT rate otherwise
    """
    try:
        from app.services.uae_ct_bridge import generate_ct_bridge as _generate

        result = _generate(
            trial_balance_id=trial_balance_id,
            db=db,
            entertainment_expense=payload.entertainment_expense,
            fines_penalties=payload.fines_penalties,
            non_business_expenses=payload.non_business_expenses,
            non_qualifying_depreciation=payload.non_qualifying_depreciation,
            dividend_income_uae_sub=payload.dividend_income_uae_sub,
            qualifying_capital_gains=payload.qualifying_capital_gains,
            qualifying_free_zone_income=payload.qualifying_free_zone_income,
            is_free_zone_person=payload.is_free_zone_person,
            qualifying_income_pct=payload.qualifying_income_pct,
            revenue_override=payload.revenue_override,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("CT bridge calculation failed for tb_id=%s", trial_balance_id)
        raise HTTPException(status_code=500, detail=f"CT bridge error: {e}")


@router.get(
    "/trial-balance/{trial_balance_id}/ct-bridge",
    summary="Get saved UAE CT bridge result",
)
async def get_ct_bridge(
    trial_balance_id: int,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """
    Retrieve the most recently calculated UAE CT bridge for a trial balance.
    Returns 404 if not yet calculated.
    """
    try:
        from app.services.uae_ct_bridge import get_saved_ct_bridge

        result = get_saved_ct_bridge(trial_balance_id, db)
        if result is None:
            raise HTTPException(
                status_code=404,
                detail="No CT bridge calculated yet. POST to /ct-bridge first.",
            )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Get CT bridge failed for tb_id=%s", trial_balance_id)
        raise HTTPException(status_code=500, detail=str(e))
