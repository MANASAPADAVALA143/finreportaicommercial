from fastapi import APIRouter, Request, Depends
import anthropic
import json

from app.core.database import get_db
from app.services import cfo_uae_data_service as uae_cfo
from sqlalchemy.orm import Session

router = APIRouter(prefix="/api/ar-collections", tags=["ar-collections"])


@router.get("/summary")
async def get_ar_summary(
    request: Request,
    company_id: str | None = None,
    db: Session = Depends(get_db),
):
    ws = request.headers.get("X-Workspace-ID") or request.headers.get("X-Tenant-ID") or ""
    if not ws or ws == "demo":
        return uae_cfo.empty_ar_summary()
    if uae_cfo.has_uae_transactions(db, ws, company_id):
        return uae_cfo.build_ar_summary(db, ws, company_id)
    return uae_cfo.empty_ar_summary()


@router.post("/ai-insight")
async def ar_insight(
    request: Request,
    company_id: str | None = None,
    db: Session = Depends(get_db),
):
    ws = request.headers.get("X-Workspace-ID") or request.headers.get("X-Tenant-ID") or ""
    ar_data = (
        uae_cfo.build_ar_summary(db, ws, company_id)
        if ws and ws != "demo" and uae_cfo.has_uae_transactions(db, ws, company_id)
        else uae_cfo.empty_ar_summary()
    )
    if not ar_data.get("total_ar"):
        return {
            "module": "AR & COLLECTIONS",
            "impact": "info",
            "title": "No AR data yet",
            "body": "Post sales invoices to see accounts receivable aging and collection insights.",
            "data_tag": "",
            "action": "Create sales invoices in UAE Accounting",
        }

    client = anthropic.Anthropic()
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=500,
        messages=[
            {
                "role": "user",
                "content": f"""You are a CFO assistant analysing accounts receivable.

AR data:
{json.dumps(ar_data, indent=2)}

Generate ONE insight card as JSON:
{{
  "module": "AR & COLLECTIONS",
  "impact": "high impact",
  "title": "one-line headline",
  "body": "4-5 sentence explanation with specific numbers",
  "data_tag": "key metric as short string",
  "action": "specific next step"
}}

Focus on: biggest mover between aging buckets, cash flow impact, provision trigger risk.
Return ONLY valid JSON. No prose outside the object. Currency: AED.""",
            }
        ],
    )
    try:
        return json.loads(response.content[0].text)
    except Exception:
        return {
            "module": "AR & COLLECTIONS",
            "impact": "high impact",
            "title": "AI insight unavailable",
            "body": response.content[0].text,
            "data_tag": "",
            "action": "",
        }
