from fastapi import APIRouter
import anthropic
import json

router = APIRouter(prefix="/api/entity-health", tags=["entity-health"])

ENTITIES = [
    {
        "code": "DE", "name": "Germany (DE)", "label": "Holding Company",
        "flag": "🇩🇪", "readiness": 92,
        "workstreams": [
            {"name": "Bank statements", "status": "complete", "owner": "Accounting DE"},
            {"name": "AR reconciliation", "status": "complete", "owner": "Accounting DE"},
            {"name": "AP accruals", "status": "complete", "owner": "Accounting DE"},
            {"name": "Payroll booking", "status": "complete", "owner": "HR / Payroll"},
            {"name": "ICO confirmations", "status": "complete", "owner": "ICO team DE"},
            {"name": "Manual journals", "status": "complete", "owner": "Controller DE"},
            {"name": "Consolidation upload", "status": "in_progress", "owner": "Finance DE"},
        ],
        "blockers": [
            {"severity": "medium", "text": "OPEX above budget — legal & professional fees €47K one-off"}
        ],
    },
    {
        "code": "PL", "name": "Poland (PL)", "label": "Operations",
        "flag": "🇵🇱", "readiness": 71,
        "workstreams": [
            {"name": "Bank statements", "status": "complete", "owner": "Accounting PL"},
            {"name": "AR reconciliation", "status": "in_progress", "owner": "Accounting PL"},
            {"name": "AP accruals", "status": "complete", "owner": "Accounting PL"},
            {"name": "Payroll booking", "status": "complete", "owner": "HR / Payroll"},
            {"name": "ICO confirmations", "status": "blocked", "owner": "ICO team PL"},
            {"name": "Manual journals", "status": "in_progress", "owner": "Controller PL"},
            {"name": "Consolidation upload", "status": "in_progress", "owner": "Finance PL"},
        ],
        "blockers": [
            {"severity": "critical", "text": "ICO confirmation with DE not received"},
            {"severity": "high", "text": "7 manual journals pending — 2 material (>€50K each)"},
        ],
    },
    {
        "code": "LV", "name": "Latvia (LV)", "label": "Distribution",
        "flag": "🇱🇻", "readiness": 62,
        "workstreams": [
            {"name": "Bank statements", "status": "blocked", "owner": "Accounting LV"},
            {"name": "AR reconciliation", "status": "in_progress", "owner": "Accounting LV"},
            {"name": "AP accruals", "status": "in_progress", "owner": "Accounting LV"},
            {"name": "Payroll booking", "status": "complete", "owner": "HR / Payroll"},
            {"name": "ICO confirmations", "status": "blocked", "owner": "ICO team LV"},
            {"name": "Manual journals", "status": "in_progress", "owner": "Controller LV"},
            {"name": "Consolidation upload", "status": "in_progress", "owner": "Finance LV"},
        ],
        "blockers": [
            {"severity": "critical", "text": "April bank statement for SEB Latvia missing — blocks cash reconciliation"},
            {"severity": "critical", "text": "ICO confirmation with DE not received"},
            {"severity": "high", "text": "VAT accrual draft for April pending technical review"},
            {"severity": "high", "text": "7 manual journals pending — 2 material (>€50K each)"},
        ],
    },
    {
        "code": "US", "name": "North America (US)", "label": "USA",
        "flag": "🇺🇸", "readiness": 88,
        "workstreams": [
            {"name": "Bank statements", "status": "complete", "owner": "Accounting US"},
            {"name": "AR reconciliation", "status": "in_progress", "owner": "Accounting US"},
            {"name": "AP accruals", "status": "complete", "owner": "Accounting US"},
            {"name": "Payroll booking", "status": "complete", "owner": "HR / Payroll"},
            {"name": "ICO confirmations", "status": "complete", "owner": "ICO team US"},
            {"name": "Manual journals", "status": "complete", "owner": "Controller US"},
            {"name": "Consolidation upload", "status": "in_progress", "owner": "Finance US"},
        ],
        "blockers": [
            {"severity": "medium", "text": "AR reconciliation incomplete for 3 disputed invoices (Atlas, Apex, Cascade)"}
        ],
    },
]


@router.get("/summary")
async def get_entity_health_summary(period: str = "2026-04"):
    total_readiness = sum(e["readiness"] for e in ENTITIES) / len(ENTITIES)
    total_blockers = sum(len(e["blockers"]) for e in ENTITIES)
    critical_count = sum(
        1 for e in ENTITIES for b in e["blockers"] if b["severity"] == "critical"
    )
    return {
        "period": period,
        "entities": ENTITIES,
        "group_readiness": round(total_readiness, 1),
        "total_blockers": total_blockers,
        "critical_blockers": critical_count,
        "target_readiness": 85,
        "consolidation_deadline": "2026-05-17",
        "days_to_deadline": 3,
    }


@router.post("/ai-insight")
async def generate_entity_insight(period: str = "2026-04"):
    client = anthropic.Anthropic()
    summary = await get_entity_health_summary(period)
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

Be specific with numbers. No fluff. CFO-level language.""",
            }
        ],
    )
    return {"insight": response.content[0].text, "period": period}
