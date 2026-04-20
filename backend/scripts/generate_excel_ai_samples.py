"""Generate sample .xlsx files for Excel AI Suite (Prism Manufacturing style)."""
from __future__ import annotations

from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "sample_data" / "excel_ai"
OUT.mkdir(parents=True, exist_ok=True)

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

def _row(account: str, base: float, drift: float = 0.04) -> dict:
    vals = {}
    for i, m in enumerate(MONTHS):
        vals[m] = round(base / 12 * (1 + (i % 3 - 1) * drift), 0)
    vals["YTD"] = sum(vals[m] for m in MONTHS)
    return {"Account": account, **vals}


def main() -> None:
    # Variance + budget input: Actual vs Budget
    actual_rows = [
        _row("Revenue - Manufacturing", 48_000_000, 0.02),
        _row("Revenue - Services", 12_000_000, 0.03),
        _row("Other Income", 800_000, 0),
        _row("Cost of Materials", -22_000_000, 0.02),
        _row("Payroll & Benefits", -9_500_000, 0.01),
        _row("Rent & Facilities", -2_400_000, 0),
        _row("Marketing", -1_800_000, 0.05),
        _row("EBITDA", 0, 0),
    ]
    budget_rows = []
    for r in actual_rows:
        br = dict(r)
        if "EBITDA" in br["Account"]:
            continue
        for m in MONTHS:
            if "Revenue" in br["Account"] or "Income" in br["Account"]:
                br[m] = round(float(br[m]) * 1.08, 0)
            else:
                br[m] = round(float(br[m]) * 0.96, 0) if br[m] else 0
        br["YTD"] = sum(float(br[m]) for m in MONTHS)
        budget_rows.append(br)
    # EBITDA as sum placeholder
    act_df = pd.DataFrame(actual_rows)
    bud_df = pd.DataFrame(budget_rows)
    p = OUT / "sample_actual_budget.xlsx"
    with pd.ExcelWriter(p, engine="openpyxl") as w:
        act_df.to_excel(w, sheet_name="Actual", index=False)
        bud_df.to_excel(w, sheet_name="Budget", index=False)
    print("Wrote", p)

    # Rolling forecast: same Actual + Budget
    p2 = OUT / "sample_rolling_forecast.xlsx"
    with pd.ExcelWriter(p2, engine="openpyxl") as w:
        act_df.to_excel(w, sheet_name="Actual", index=False)
        bud_df.to_excel(w, sheet_name="Budget", index=False)
    print("Wrote", p2)

    # P&L + BS for KPI / cashflow samples (simplified)
    pl = pd.DataFrame(
        [
            {"Line": "Revenue", "Amount": 52_000_000},
            {"Line": "Gross Profit", "Amount": 24_000_000},
            {"Line": "Operating Expenses", "Amount": -14_000_000},
            {"Line": "EBITDA", "Amount": 10_000_000},
        ]
    )
    bs = pd.DataFrame(
        [
            {"Line": "Cash", "Amount": 8_500_000},
            {"Line": "Accounts Receivable", "Amount": 12_000_000},
            {"Line": "Accounts Payable", "Amount": -6_200_000},
            {"Line": "Long-term Debt", "Amount": -18_000_000},
        ]
    )
    p3 = OUT / "sample_pl_bs.xlsx"
    with pd.ExcelWriter(p3, engine="openpyxl") as w:
        pl.to_excel(w, sheet_name="P_L", index=False)
        bs.to_excel(w, sheet_name="Balance_Sheet", index=False)
    print("Wrote", p3)

    # Base model for scenarios (accounts + base amount)
    base = pd.DataFrame(
        [
            {"Account": "Revenue", "Amount": 100},
            {"Account": "COGS", "Amount": -45},
            {"Account": "Opex", "Amount": -30},
            {"Account": "EBIT", "Amount": 25},
        ]
    )
    p4 = OUT / "sample_base_model.xlsx"
    base.to_excel(p4, sheet_name="Model", index=False)
    print("Wrote", p4)


if __name__ == "__main__":
    main()
