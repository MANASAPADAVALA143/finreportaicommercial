from fastapi import APIRouter
import anthropic

router = APIRouter(prefix="/api/covenants", tags=["covenants"])

COVENANTS = [
    {
        "name": "Net Debt / EBITDA",
        "type": "max",
        "current": 2.8,
        "threshold": 3.5,
        "unit": "×",
        "headroom": 0.7,
        "headroom_pct": 20,
        "status": "watch",
        "trend": "tightening",
        "trend_history": [1.2, 1.5, 1.8, 2.1, 2.5, 2.8],
        "trend_labels": ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr"],
        "next_review": "2026-06-25",
        "action": "Refresh TTM EBITDA forecast before May 19. Flag trend to CFO before next banking update.",
        "owner": "CFO / FP&A",
        "bank": "NordBank AG",
    },
    {
        "name": "Interest Coverage (EBIT/Interest)",
        "type": "min",
        "current": 4.2,
        "threshold": 3.0,
        "unit": "×",
        "headroom": 1.2,
        "headroom_pct": 40,
        "status": "safe",
        "trend": "stable",
        "trend_history": [4.8, 4.6, 4.5, 4.3, 4.2, 4.2],
        "trend_labels": ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr"],
        "action": None,
        "owner": "CFO / Treasury",
    },
    {
        "name": "Current Ratio (Liquidity)",
        "type": "min",
        "current": 1.8,
        "threshold": 1.2,
        "unit": "×",
        "headroom": 0.6,
        "headroom_pct": 50,
        "status": "safe",
        "trend": "stable",
        "trend_history": [2.1, 2.0, 1.9, 1.9, 1.8, 1.8],
        "trend_labels": ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr"],
        "action": None,
        "owner": "Head of Treasury",
    },
    {
        "name": "Minimum Cash Floor",
        "type": "min",
        "current": 6170000,
        "threshold": 4500000,
        "unit": "€",
        "headroom": 1670000,
        "headroom_pct": 37,
        "status": "safe",
        "trend": "stable",
        "scenario_w7": 4890000,
        "scenario_risk": True,
        "trend_history": [6420000, 6380000, 6200000, 6100000, 6050000, 6170000],
        "trend_labels": ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr"],
        "action": "Monitor W7 payment calendar. Stagger Arco Materials payment to add €115K buffer.",
        "owner": "Head of Treasury",
    },
]


@router.get("/summary")
async def get_covenants():
    watch_count = sum(1 for c in COVENANTS if c["status"] == "watch")
    breach_count = sum(1 for c in COVENANTS if c["status"] == "breach_risk")
    return {
        "covenants": COVENANTS,
        "watch_count": watch_count,
        "breach_risk_count": breach_count,
        "next_bank_review": "2026-06-25",
    }


@router.post("/ai-insight")
async def covenant_insight():
    client = anthropic.Anthropic()
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=400,
        messages=[
            {
                "role": "user",
                "content": """You are a CFO assistant monitoring debt covenants.

Covenant data:
- Net Debt/EBITDA: 2.8× vs 3.5× threshold. Headroom fallen from 1.2× (6 months ago) to 0.7× now. April EBITDA margin 13% vs 15% plan.
- Interest Coverage: 4.2× vs 3.0× minimum. Stable.
- Current Ratio: 1.8× vs 1.2× minimum. Stable.
- Cash Floor: €6.17M vs €4.5M minimum. W7 downside scenario projects €4.89M.
- Next bank review: June 25, 2026

Write a 4-sentence covenant brief:
1. Which covenant is the primary concern and current trajectory
2. What happens to the ratio if May EBITDA holds at current level
3. Specific action before the bank review
4. Risk if no action

Numbers-first. Serious tone. No fluff.""",
            }
        ],
    )
    return {"insight": response.content[0].text}
