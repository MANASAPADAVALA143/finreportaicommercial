from fastapi import APIRouter, Request, Depends
import anthropic

from app.core.database import get_db
from app.services import cfo_uae_data_service as uae_cfo
from sqlalchemy.orm import Session

router = APIRouter(prefix="/api/covenants", tags=["covenants"])


@router.get("/summary")
async def get_covenants(
    request: Request,
    company_id: str | None = None,
    db: Session = Depends(get_db),
):
    ws = request.headers.get("X-Workspace-ID") or request.headers.get("X-Tenant-ID") or ""
    if not ws or ws == "demo":
        return uae_cfo.empty_covenants()
    if uae_cfo.has_uae_transactions(db, ws, company_id):
        return uae_cfo.build_covenants(db, ws, company_id)
    return uae_cfo.empty_covenants()


@router.post("/ai-insight")
async def covenant_insight(
    request: Request,
    company_id: str | None = None,
    db: Session = Depends(get_db),
):
    ws = request.headers.get("X-Workspace-ID") or request.headers.get("X-Tenant-ID") or ""
    data = (
        uae_cfo.build_covenants(db, ws, company_id)
        if ws and ws != "demo" and uae_cfo.has_uae_transactions(db, ws, company_id)
        else uae_cfo.empty_covenants()
    )
    if not data.get("covenants"):
        return {"insight": "No covenant data yet. Post GL transactions with debt balances to monitor covenants."}

    client = anthropic.Anthropic()
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=400,
        messages=[
            {
                "role": "user",
                "content": f"""You are a CFO assistant monitoring debt covenants.

Covenant data:
{data}

Write a 4-sentence covenant brief:
1. Which covenant is the primary concern and current trajectory
2. What happens to the ratio if current EBITDA holds
3. Specific action before the bank review
4. Risk if no action

Numbers-first. Serious tone. No fluff. Currency: AED.""",
            }
        ],
    )
    return {"insight": response.content[0].text}
