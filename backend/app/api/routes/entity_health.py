from fastapi import APIRouter, Request, Depends
import anthropic
import json

from app.core.database import get_db
from app.services import cfo_uae_data_service as uae_cfo
from sqlalchemy.orm import Session

router = APIRouter(prefix="/api/entity-health", tags=["entity-health"])


@router.get("/summary")
async def get_entity_health_summary(
    request: Request,
    period: str = "2026-04",
    db: Session = Depends(get_db),
):
    ws = request.headers.get("X-Workspace-ID") or request.headers.get("X-Tenant-ID") or ""
    if not ws or ws == "demo":
        return uae_cfo.empty_entity_health(period)
    if uae_cfo.has_uae_data(db, ws):
        data = uae_cfo.build_entity_health(db, ws, period)
        if data.get("entities"):
            data.pop("_empty", None)
            return data
    return uae_cfo.empty_entity_health(period)


@router.post("/ai-insight")
async def generate_entity_insight(
    request: Request,
    period: str = "2026-04",
    db: Session = Depends(get_db),
):
    summary = await get_entity_health_summary(request, period, db)
    if not summary.get("entities"):
        return {
            "insight": "No entity health data yet. Complete company setup and post journal entries.",
            "period": period,
        }

    client = anthropic.Anthropic()
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=400,
        messages=[
            {
                "role": "user",
                "content": f"""You are a CFO assistant analysing month-end close status.

Entity health data:
{json.dumps(summary, indent=2)}

Write a 3-4 sentence executive insight covering:
1. Group readiness vs target and biggest gap
2. Which entity is the critical bottleneck and why
3. Specific action to take TODAY to hit deadline
4. Risk if no action taken

Be specific with numbers. No fluff. CFO-level language. Currency: AED.""",
            }
        ],
    )
    return {"insight": response.content[0].text, "period": period}
