from fastapi import APIRouter
import anthropic
import json

router = APIRouter(prefix="/api/ar-collections", tags=["ar-collections"])

AR_DATA = {
    "total_ar": 1392000,
    "total_overdue": 892000,
    "dso_current": 34,
    "dso_target": 30,
    "dso_trend": [
        {"month": "Nov", "dso": 28}, {"month": "Dec", "dso": 29},
        {"month": "Jan", "dso": 30}, {"month": "Feb", "dso": 31},
        {"month": "Mar", "dso": 33}, {"month": "Apr", "dso": 34},
    ],
    "aging_buckets": [
        {"bucket": "Current (0-30d)", "amount": 500000, "pct": 36, "risk": "low"},
        {"bucket": "31-60 days", "amount": 320000, "pct": 23, "risk": "medium"},
        {"bucket": "61-90 days", "amount": 287000, "pct": 21, "risk": "high"},
        {"bucket": "91-120 days", "amount": 185000, "pct": 13, "risk": "high"},
        {"bucket": "120+ days", "amount": 100000, "pct": 7, "risk": "critical"},
    ],
    "customers": [
        {
            "name": "Atlas Retail Group", "amount": 287000, "bucket": "61-90d",
            "risk": "high", "last_contact": "May 8", "entity": "US",
            "note": "Moved from 31-60d bucket. €287K = 20.6% of total overdue. W4 cash impact if delayed.",
        },
        {
            "name": "Apex Industries", "amount": 143000, "bucket": "91-120d",
            "risk": "high", "last_contact": "Apr 25", "entity": "US",
            "note": "Dispute raised March 12. Legal team engaged.",
        },
        {
            "name": "Cascade Partners", "amount": 100000, "bucket": "120+d",
            "risk": "critical", "last_contact": "Apr 10", "entity": "US",
            "note": "120+ days. Provision review required per policy.",
        },
        {
            "name": "Meridian Corp", "amount": 185000, "bucket": "31-60d",
            "risk": "medium", "last_contact": "May 12", "entity": "DE",
            "note": "Routine delay. Payment confirmed for May 20.",
        },
        {
            "name": "Vantage Group", "amount": 135000, "bucket": "31-60d",
            "risk": "medium", "last_contact": "May 11", "entity": "PL",
            "note": "New customer. 45-day terms. First invoice.",
        },
    ],
}


@router.get("/summary")
async def get_ar_summary():
    return AR_DATA


@router.post("/ai-insight")
async def ar_insight():
    client = anthropic.Anthropic()
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=500,
        messages=[
            {
                "role": "user",
                "content": f"""You are a CFO assistant analysing accounts receivable.

AR data:
{json.dumps(AR_DATA, indent=2)}

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
Return ONLY valid JSON. No prose outside the object.""",
            }
        ],
    )
    try:
        return json.loads(response.content[0].text)
    except Exception:
        return {"module": "AR & COLLECTIONS", "impact": "high impact",
                "title": "AI insight unavailable", "body": response.content[0].text,
                "data_tag": "", "action": ""}
