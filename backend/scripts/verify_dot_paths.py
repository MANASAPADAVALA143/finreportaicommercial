"""Fast check: all 30 IFRS_LINE_ITEMS dot-paths resolve. No DB."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.ifrs_dot_path_translate import translate_dot_path

PATHS = [
    "financialPosition.assets.current.cashAndEquivalents",
    "financialPosition.assets.current.tradeReceivables",
    "financialPosition.assets.current.inventories",
    "financialPosition.assets.current.prepayments",
    "financialPosition.assets.current.otherCurrent",
    "financialPosition.assets.nonCurrent.propertyPlantEquipment",
    "financialPosition.assets.nonCurrent.intangibleAssets",
    "financialPosition.assets.nonCurrent.investments",
    "financialPosition.assets.nonCurrent.otherNonCurrent",
    "financialPosition.liabilities.current.tradePayables",
    "financialPosition.liabilities.current.shortTermBorrowings",
    "financialPosition.liabilities.current.accruedExpenses",
    "financialPosition.liabilities.current.otherCurrent",
    "financialPosition.liabilities.nonCurrent.borrowings",
    "financialPosition.liabilities.nonCurrent.deferredTax",
    "financialPosition.liabilities.nonCurrent.provisions",
    "financialPosition.liabilities.nonCurrent.otherNonCurrent",
    "financialPosition.equity.shareCapital",
    "financialPosition.equity.retainedEarnings",
    "financialPosition.equity.otherReserves",
    "profitLoss.revenue",
    "profitLoss.costOfSales",
    "profitLoss.operatingExpenses.employeeBenefits",
    "profitLoss.operatingExpenses.administrative",
    "profitLoss.operatingExpenses.distribution",
    "profitLoss.operatingExpenses.depreciation",
    "profitLoss.operatingExpenses.other",
    "profitLoss.financeIncome",
    "profitLoss.financeCosts",
    "profitLoss.incomeTax",
]

failed = [p for p in PATHS if not translate_dot_path(p)["ok"]]
if failed:
    print("FAIL:", failed)
    raise SystemExit(1)
print(f"OK {len(PATHS)}/{len(PATHS)} dot-paths")
tr = translate_dot_path("financialPosition.liabilities.nonCurrent.otherNonCurrent")
assert tr["ifrs_line_item"] == "Other non-current liabilities"
print("OK otherNonCurrent liability line item")
