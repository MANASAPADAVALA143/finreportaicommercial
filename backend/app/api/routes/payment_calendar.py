from fastapi import APIRouter, Request, Depends
import anthropic
import json

from app.core.database import get_db
from app.core.tenant_scope import request_workspace, workspace_member
from app.services import cfo_uae_data_service as uae_cfo
from sqlalchemy.orm import Session

router = APIRouter(prefix="/api/payment-calendar", tags=["payment-calendar"], dependencies=[Depends(workspace_member)])


@router.get("/weeks")
async def get_payment_calendar(
    request: Request,
    company_id: str | None = None,
    db: Session = Depends(get_db),
):
    ws = request_workspace(request)
    if uae_cfo.has_uae_transactions(db, ws, company_id):
        return uae_cfo.build_payment_calendar(db, ws, company_id)
    return uae_cfo.empty_payment_calendar()


@router.post("/ai-insight")
async def payment_calendar_insight(
    request: Request,
    company_id: str | None = None,
    db: Session = Depends(get_db),
):
    ws = request_workspace(request)
    data = (
        uae_cfo.build_payment_calendar(db, ws, company_id)
        if uae_cfo.has_uae_transactions(db, ws, company_id)
        else uae_cfo.empty_payment_calendar()
    )
    if not data.get("weeks"):
        return {"insight": "No payment calendar data yet. Post transactions to generate treasury insights."}

    client = anthropic.Anthropic()
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=400,
        messages=[
            {
                "role": "user",
                "content": f"""You are a treasury analyst. Analyse this payment schedule:
{json.dumps(data.get('weeks', []), indent=2)}

Write a 3-sentence treasury brief:
1. Which week creates the highest liquidity risk and why
2. Specific staggering action to relieve pressure
3. What approval must happen THIS WEEK to prevent cash shortfall

Numbers-first. CFO-level. No fluff. Currency: AED.""",
            }
        ],
    )
    return {"insight": response.content[0].text}
