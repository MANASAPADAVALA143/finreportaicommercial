"""Build industry-aware prompts for trial balance YoY variance commentary (Claude)."""
from __future__ import annotations

from app.services.industry_profiles import get_account_hint, get_profile


def _currency_symbol(currency: str) -> str:
    c = (currency or "INR").strip().upper()
    if c == "INR":
        return "₹"
    if c == "USD":
        return "$"
    if c == "EUR":
        return "€"
    if c == "GBP":
        return "£"
    return f"{c} "


def build_variance_commentary_prompt(
    account_name: str,
    current: float,
    prior: float,
    variance: float,
    variance_pct: float | None,
    currency: str,
    industry: str,
    company_name: str,
) -> str:
    profile = get_profile(industry)
    hint = get_account_hint(industry, account_name)
    red_flags = profile.get("red_flags", [])
    ifrs_points = profile.get("ifrs_watchpoints", [])

    direction = "increased" if variance > 0 else "decreased" if variance < 0 else "unchanged"
    an = (account_name or "").lower()

    cost_tokens = (
        "cost of sales",
        "cost of goods",
        "cogs",
        "expense",
        "salary",
        "wage",
        "payroll",
        "depreciation",
        "amortisation",
        "amortization",
        "rent",
        "overhead",
        "marketing",
        "administrative",
        "finance cost",
        "interest expense",
        "tax expense",
        "employee benefit",
        "utilities",
    )
    is_cost_like = any(t in an for t in cost_tokens) or (
        "cost" in an and any(x in an for x in ("revenue", "sales", "goods", "service"))
    )

    revenue_tokens = (
        "revenue",
        "sales",
        "turnover",
        "subscription",
        "mrr",
        "arr",
        "fee income",
        "service income",
        "interest income",
        "other income",
    )
    is_revenue_like = any(t in an for t in revenue_tokens) and not is_cost_like

    liability_tokens = (
        "payable",
        "creditor",
        "borrow",
        "borrowing",
        "lease liability",
        "deferred revenue",
        "contract liabilit",
        "tax liability",
        "employee liability",
        "accrual",
    )
    is_liability_like = any(t in an for t in liability_tokens) and "receivable" not in an

    is_asset_like = any(
        t in an
        for t in (
            "receivable",
            "inventory",
            "prepayment",
            "ppe",
            "plant",
            "property",
            "goodwill",
            "intangible",
            "cash",
            "bank",
            "deposit",
        )
    )

    if is_cost_like:
        impact = "Favourable" if variance < 0 else "Unfavourable" if variance > 0 else "Neutral"
    elif is_revenue_like:
        impact = "Favourable" if variance > 0 else "Unfavourable" if variance < 0 else "Neutral"
    elif is_liability_like and not is_asset_like:
        impact = "Favourable" if variance < 0 else "Unfavourable" if variance > 0 else "Neutral"
    elif is_asset_like:
        impact = "Neutral (balance sheet — explain driver)"
    else:
        impact = "Mixed / context-dependent — explain drivers"

    sym = _currency_symbol(currency)
    pct_txt = (
        f"{abs(variance_pct or 0.0):.1f}%"
        if variance_pct is not None
        else "n/a (new account or zero prior)"
    )

    return f"""You are a senior finance analyst writing management commentary for a {profile["label"]} company.

Company: {company_name or "Entity"}
Industry: {profile["label"]}
Account: {account_name}
Movement: {direction} by {sym}{abs(variance):,.0f} ({pct_txt} vs prior period)
Indicative impact label (use only if it fits the account nature): {impact}

Industry context for this account:
{hint if hint else "No specific keyword match — use industry KPIs and IFRS watchpoints below."}

Industry red flags to watch (mention only if relevant to this movement):
{", ".join(red_flags[:4])}

Relevant IFRS / accounting angles:
{", ".join(ifrs_points[:3])}

Write 2–3 sentences of CFO-level commentary:
1) State the movement and the most likely business driver for this industry.
2) Flag one risk or opportunity specific to {profile["label"]}.
3) Recommend one concrete management or audit committee action.

Tone: {profile.get("commentary_tone", "general")}.
Be specific — avoid generic praise like "strong performance" without a driver.
Do not start with "This account" or "The variance".
Return plain text only (no JSON, no markdown fences).
"""


def build_tb_variance_system_prompt() -> str:
    return (
        "You write concise, audit-ready trial balance variance commentary. "
        "Follow the user's structure. Plain text only."
    )
