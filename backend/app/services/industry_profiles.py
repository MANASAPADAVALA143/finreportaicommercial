"""Industry-specific hints for trial-balance variance AI commentary."""
from __future__ import annotations

INDUSTRY_PROFILES: dict[str, dict] = {
    "manufacturing": {
        "label": "Manufacturing",
        "key_metrics": [
            "Gross margin",
            "COGS ratio",
            "Inventory turnover",
            "Capacity utilization",
        ],
        "revenue_drivers": [
            "Volume vs pricing mix",
            "Product line performance",
            "Export vs domestic split",
        ],
        "red_flags": [
            "COGS growing faster than revenue",
            "Inventory buildup without revenue growth",
            "Depreciation spike without capex",
            "Raw material price inflation",
        ],
        "account_hints": {
            "revenue": (
                "Validate volume vs price mix. Check if new orders support growth "
                "and whether capacity utilization backs the trend."
            ),
            "inventory": (
                "Rising inventory with flat revenue = demand risk. Check DIO trend "
                "and IAS 2 lower of cost/NRV for slow movers."
            ),
            "ppe": "Capex increase — validate against approved capital budget and IAS 16 useful lives.",
            "employee_benefits": "Labour cost per unit — check productivity ratios vs output.",
            "depreciation": "New asset additions increasing charge — confirm useful life and impairment triggers (IAS 36).",
            "cogs": "Split raw material price variance vs volume variance; watch margin compression.",
        },
        "ifrs_watchpoints": [
            "IAS 2 — Inventory at lower of cost/NRV",
            "IAS 16 — PPE useful life review annually",
            "IAS 36 — Impairment if utilisation drops",
            "IFRS 15 — Revenue recognition at delivery / over time",
        ],
        "commentary_tone": "operational",
    },
    "services": {
        "label": "Professional Services / IT",
        "key_metrics": [
            "Revenue per employee",
            "Utilisation rate",
            "Gross margin",
            "Unbilled revenue",
        ],
        "revenue_drivers": [
            "Headcount and billable hours",
            "Realization rate",
            "New client wins vs churn",
        ],
        "red_flags": [
            "Revenue up but headcount flat (burn risk)",
            "Unbilled/WIP growing without invoicing",
            "High contract liability (deferred revenue concern)",
            "Employee costs growing faster than revenue",
        ],
        "account_hints": {
            "revenue": (
                "Check contract performance obligations. Is recognition timing correct per IFRS 15 "
                "(milestones vs over-time)?"
            ),
            "trade_receivables": "DSO increase = collection risk. Review ageing and IFRS 9 ECL provision.",
            "contract_assets": "Unbilled revenue growing — ensure milestone billing is on track.",
            "contract_liabilities": "Deferred revenue — confirm when performance obligations are satisfied.",
            "employee_benefits": "People cost is primary driver — monitor cost per billable hour.",
        },
        "ifrs_watchpoints": [
            "IFRS 15 — 5-step model for contract revenue",
            "IFRS 15 — Contract modifications",
            "IAS 19 — Employee benefit obligations",
            "IFRS 9 — ECL on trade receivables",
        ],
        "commentary_tone": "strategic",
    },
    "trading": {
        "label": "Trading / Distribution",
        "key_metrics": [
            "Gross margin %",
            "Inventory turnover",
            "Working capital cycle",
            "Debtor days",
        ],
        "revenue_drivers": [
            "Volume growth",
            "Pricing power vs competition",
            "Supplier cost pass-through",
        ],
        "red_flags": [
            "Margin compression (suppliers raising prices)",
            "Slow inventory turnover",
            "Debtor days extending",
            "High concentration in few customers",
        ],
        "account_hints": {
            "revenue": "Check if growth is volume or price; margin compression is the key commercial risk.",
            "inventory": "High inventory = working capital trap. Validate NRV for slow-moving stock (IAS 2).",
            "trade_receivables": "Extending debtor days = cash flow risk. Review top debtors and IFRS 9 ECL.",
            "cogs": "Monitor supplier cost trends — are price increases being passed through?",
        },
        "ifrs_watchpoints": [
            "IAS 2 — NRV write-down for slow-moving stock",
            "IFRS 9 — ECL provision on receivables",
            "IAS 7 — Cash flow from working capital changes",
        ],
        "commentary_tone": "commercial",
    },
    "real_estate": {
        "label": "Real Estate / Construction",
        "key_metrics": [
            "% completion vs revenue",
            "Project-wise margin",
            "Collections vs billings",
            "Land bank value",
        ],
        "revenue_drivers": [
            "Project completion milestones",
            "Units handed over vs booked",
            "Realization per sq ft",
        ],
        "red_flags": [
            "Revenue recognised without collections",
            "High contract liabilities (customer advances)",
            "Construction cost overruns",
            "Interest capitalised beyond proportions",
        ],
        "account_hints": {
            "revenue": (
                "Verify % completion / over-time recognition. Check handovers match revenue per IFRS 15."
            ),
            "contract_liabilities": "Customer advances — when will performance obligations be met?",
            "ppe": "Capitalised borrowing costs — IAS 23 qualifying asset check.",
            "borrowings": "Project financing — check loan covenant compliance.",
        },
        "ifrs_watchpoints": [
            "IFRS 15 — Point in time vs over time",
            "IAS 23 — Borrowing costs capitalisation",
            "IAS 2 — Land inventory at lower of cost/NRV",
            "IFRS 9 — ECL on receivables",
        ],
        "commentary_tone": "project-based",
    },
    "financial_services": {
        "label": "Financial Services / NBFC",
        "key_metrics": [
            "Net interest margin",
            "NPA ratio",
            "GNPA / NNPA",
            "Capital adequacy ratio",
        ],
        "revenue_drivers": [
            "Loan book growth",
            "Yield on advances",
            "Fee income growth",
        ],
        "red_flags": [
            "NPA increasing faster than loan book",
            "ECL provision inadequate",
            "Interest income not matching loan book growth",
            "Fee income declining (cross-sell weakness)",
        ],
        "account_hints": {
            "revenue": "Interest income — validate against average loan book size and yield.",
            "trade_receivables": "Loan book — check Stage 1/2/3 split and IFRS 9 ECL adequacy.",
            "borrowings": "Cost of funds trend — impact on NIM going forward.",
        },
        "ifrs_watchpoints": [
            "IFRS 9 — ECL Stage 1/2/3 classification",
            "IFRS 9 — Effective interest rate method",
            "IFRS 7 — Financial instrument disclosures",
        ],
        "commentary_tone": "regulatory",
    },
    "healthcare": {
        "label": "Healthcare / Pharma",
        "key_metrics": [
            "Revenue per bed/visit",
            "Occupancy rate",
            "Generic vs branded mix",
            "R&D spend ratio",
        ],
        "revenue_drivers": [
            "Patient volumes / prescriptions",
            "Payer mix (insurance vs OPD)",
            "New product launches",
        ],
        "red_flags": [
            "R&D expenses not capitalised correctly",
            "Revenue recognition on bundled services",
            "Inventory expiry risk (pharma)",
            "Insurance receivable ageing",
        ],
        "account_hints": {
            "revenue": "Validate payer mix; insurance collections vs direct billing imply different ECL profiles.",
            "research_development": "Check IAS 38 — only development phase capitalised, not research.",
            "inventory": "Expiry date risk — NRV write-down for near-expiry stock (IAS 2).",
        },
        "ifrs_watchpoints": [
            "IAS 38 — R&D capitalisation criteria",
            "IFRS 15 — Bundled service revenue allocation",
            "IAS 2 — Pharmaceutical inventory NRV",
            "IFRS 9 — Insurance receivable ECL",
        ],
        "commentary_tone": "clinical-operational",
    },
    "technology": {
        "label": "Technology / SaaS",
        "key_metrics": [
            "ARR / MRR growth",
            "Churn rate",
            "CAC payback period",
            "Gross margin %",
        ],
        "revenue_drivers": [
            "New customer acquisition",
            "Expansion revenue (upsell)",
            "Churn reduction",
        ],
        "red_flags": [
            "Deferred revenue declining (churn signal)",
            "CAC rising without revenue growth",
            "High capitalized software costs",
            "Revenue concentration in few clients",
        ],
        "account_hints": {
            "revenue": "SaaS: is revenue recognized ratably? Check deferred revenue movement for churn signal.",
            "contract_liabilities": "Deferred revenue declining = churn or slower new bookings — investigate.",
            "intangibles": "Capitalised software — validate IAS 38 criteria met.",
            "employee_benefits": "Eng costs — check capex vs opex split for software development.",
        },
        "ifrs_watchpoints": [
            "IFRS 15 — SaaS revenue over time",
            "IAS 38 — Software capitalisation criteria",
            "IFRS 16 — Data centre lease recognition",
            "IFRS 2 — Share-based payment (ESOP)",
        ],
        "commentary_tone": "growth-focused",
    },
    "general": {
        "label": "General / Other",
        "key_metrics": ["Revenue", "Gross margin", "EBIT", "Cash"],
        "revenue_drivers": ["Volume", "Pricing", "Mix"],
        "red_flags": ["Margin compression", "Cash burn", "Leverage"],
        "account_hints": {},
        "ifrs_watchpoints": ["IAS 1", "IFRS 15", "IFRS 9"],
        "commentary_tone": "general",
    },
}

_INDUSTRY_ALIASES: dict[str, str] = {
    "manufacturing": "manufacturing",
    "services": "services",
    "services_it": "services",
    "professional_services": "services",
    "it_services": "services",
    "trading": "trading",
    "distribution": "trading",
    "trading_distribution": "trading",
    "real_estate": "real_estate",
    "construction": "real_estate",
    "real_estate_construction": "real_estate",
    "financial_services": "financial_services",
    "nbfc": "financial_services",
    "financial_services_nbfc": "financial_services",
    "healthcare": "healthcare",
    "pharma": "healthcare",
    "healthcare_pharma": "healthcare",
    "technology": "technology",
    "saas": "technology",
    "technology_saas": "technology",
    "general": "general",
    "other": "general",
    "general_other": "general",
}


def _norm_industry_key(industry: str) -> str:
    s = (industry or "").strip().lower().replace(" ", "_").replace("/", "_")
    s = "".join(c for c in s if c.isalnum() or c == "_")
    return s or "general"


def get_profile(industry: str) -> dict:
    key = _norm_industry_key(industry)
    mapped = _INDUSTRY_ALIASES.get(key, key)
    if mapped in INDUSTRY_PROFILES:
        return INDUSTRY_PROFILES[mapped]
    if key in INDUSTRY_PROFILES:
        return INDUSTRY_PROFILES[key]
    return INDUSTRY_PROFILES["general"]


def get_account_hint(industry: str, ifrs_line_item: str) -> str:
    profile = get_profile(industry)
    hints = profile.get("account_hints") or {}
    item_lower = (ifrs_line_item or "").lower()
    for key, hint in hints.items():
        if key in item_lower:
            return str(hint)
    return ""
