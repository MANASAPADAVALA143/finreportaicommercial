from fastapi import APIRouter
import anthropic
import json

router = APIRouter(prefix="/api/payment-calendar", tags=["payment-calendar"])

PAYMENT_WEEKS = [
    {
        "week": 1, "label": "Week 1", "dates": "5–9 May 2026",
        "total_eur": 312000, "risk": None, "projected_cash": 6170000,
        "payments": [
            {
                "description": "Poland Payroll Run", "entity": "PL", "flag": "🇵🇱",
                "category": "Payroll", "amount_eur": 241000, "due": "7 May",
                "status": "scheduled",
                "notes": "May salary — ICO transfer from DE must be approved by May 6.",
            },
            {
                "description": "Latvia VAT Q1 Settlement", "entity": "LV", "flag": "🇱🇻",
                "category": "Tax-VAT", "amount_eur": 71000, "due": "9 May",
                "status": "scheduled",
                "notes": "Q1 VAT return settlement. Covered by LV operating cash.",
            },
        ],
    },
    {
        "week": 2, "label": "Week 2", "dates": "12–16 May 2026",
        "total_eur": 485000, "risk": "watch", "projected_cash": 5820000,
        "payments": [
            {
                "description": "Germany IT Services (TechHub)", "entity": "DE", "flag": "🇩🇪",
                "category": "Supplier", "amount_eur": 74000, "due": "14 May",
                "status": "scheduled",
                "notes": "Monthly auto-debit. Low impact.",
            },
            {
                "description": "Atlas Retail Group — Expected Collection", "entity": "US", "flag": "🇺🇸",
                "category": "AR-Inflow", "amount_eur": -287000, "due": "13 May",
                "status": "at_risk",
                "notes": "€287K expected but collection delayed. 61-90 day bucket.",
            },
            {
                "description": "Intercompany DE → PL Transfer", "entity": "DE", "flag": "🇩🇪",
                "category": "Intercompany", "amount_eur": 207000, "due": "15 May",
                "status": "pending_approval",
                "notes": "Funds PL payroll. Requires CFO approval before May 15.",
            },
        ],
    },
    {
        "week": 4, "label": "Week 4", "dates": "2–6 June 2026",
        "total_eur": 496000, "risk": "watch", "projected_cash": 5340000,
        "payments": [
            {
                "description": "Germany Payroll Run", "entity": "DE", "flag": "🇩🇪",
                "category": "Payroll", "amount_eur": 380000, "due": "5 Jun",
                "status": "scheduled",
                "notes": "June salary — routine. To be funded from expected collections.",
            },
            {
                "description": "Polish Tax Authority", "entity": "PL", "flag": "🇵🇱",
                "category": "Tax-CIT", "amount_eur": 42000, "due": "3 Jun",
                "status": "scheduled",
                "notes": "Q1 corporate income tax installment.",
            },
            {
                "description": "TechHub Solutions GmbH", "entity": "DE", "flag": "🇩🇪",
                "category": "Supplier", "amount_eur": 74000, "due": "4 Jun",
                "status": "scheduled",
                "notes": "IT services monthly contract. Auto-debit.",
            },
        ],
    },
    {
        "week": 7, "label": "Week 7", "dates": "16–20 June 2026",
        "total_eur": 611000, "risk": "critical", "projected_cash": 4890000,
        "cash_threshold": 5500000,
        "cash_risk_note": "Three large outflows coincide. Projected cash €4.89M below €5.5M threshold. Stagger Arco Materials supplier payment by 7 days → adds €115K buffer.",
        "payments": [
            {
                "description": "US Payroll Run", "entity": "US", "flag": "🇺🇸",
                "category": "Payroll", "amount_eur": 290000, "due": "16 Jun",
                "status": "scheduled",
                "notes": "US salary. Funded from US operating account.",
            },
            {
                "description": "Term Loan Repayment", "entity": "DE", "flag": "🇩🇪",
                "category": "Debt", "amount_eur": 250000, "due": "17 Jun",
                "status": "scheduled",
                "notes": "Q2 loan installment — NordBank AG. Committed.",
            },
            {
                "description": "Latvia VAT April", "entity": "LV", "flag": "🇱🇻",
                "category": "Tax-VAT", "amount_eur": 41000, "due": "16 Jun",
                "status": "scheduled",
                "notes": "April VAT settlement.",
            },
        ],
    },
]


@router.get("/weeks")
async def get_payment_calendar():
    return {"weeks": PAYMENT_WEEKS, "cash_threshold": 5500000, "currency": "EUR"}


@router.post("/ai-insight")
async def payment_calendar_insight():
    client = anthropic.Anthropic()
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=400,
        messages=[
            {
                "role": "user",
                "content": f"""You are a treasury analyst. Analyse this 6-week payment schedule:
{json.dumps(PAYMENT_WEEKS, indent=2)}

Write a 3-sentence treasury brief:
1. Which week creates the highest liquidity risk and why
2. Specific staggering action to relieve pressure
3. What approval must happen THIS WEEK to prevent W7 cash breach

Numbers-first. CFO-level. No fluff.""",
            }
        ],
    )
    return {"insight": response.content[0].text}
