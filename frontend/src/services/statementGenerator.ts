// IFRS Statement Generator Service
// Converts mapped trial balance into the 4 IFRS statements

import type {
  TrialBalanceEntry,
  BalanceSheet,
  ProfitLoss,
  CashFlow,
  Equity,
  GeneratedStatements
} from '../types/ifrs';

export interface StatementInput {
  trialBalance: TrialBalanceEntry[];
  mappings: Record<string, string>;
  entityName: string;
  periodEnd: string;
  currency: string;
}

/**
 * Main function to generate all 4 IFRS statements
 */
export function generateIFRSStatements(input: StatementInput): GeneratedStatements {
  const { trialBalance, mappings, entityName, periodEnd, currency } = input;
  
  // Initialize statement structures
  const balanceSheet = initializeBalanceSheet();
  const profitLoss = initializeProfitLoss();
  const cashFlow = initializeCashFlow();
  const equity = initializeEquity();
  
  // Process each trial balance entry
  trialBalance.forEach(entry => {
    const mapping = mappings[entry.glCode];
    if (!mapping || mapping === 'unmapped') return;
    
    // Calculate net amount (debit - credit for assets/expenses, credit - debit for liabilities/equity/revenue)
    const amount = entry.debit - entry.credit;
    
    // Add to appropriate statement
    addToStatement(balanceSheet, profitLoss, cashFlow, equity, mapping, amount, entry);
  });
  
  // Calculate totals and subtotals
  calculateBalanceSheetTotals(balanceSheet);
  calculateProfitLossTotals(profitLoss);
  calculateCashFlowTotals(cashFlow);
  calculateEquityTotals(equity);
  
  return {
    entityName,
    periodEnd,
    currency,
    financialPosition: balanceSheet,
    profitLoss,
    cashFlows: cashFlow,
    changesInEquity: equity
  };
}

function initializeBalanceSheet(): BalanceSheet {
  return {
    assets: {
      current: {
        cashAndEquivalents: 0,
        tradeReceivables: 0,
        inventories: 0,
        prepayments: 0,
        otherCurrentAssets: 0,
        total: 0
      },
      nonCurrent: {
        propertyPlantEquipment: 0,
        intangibleAssets: 0,
        investments: 0,
        deferredTax: 0,
        otherNonCurrentAssets: 0,
        total: 0
      },
      total: 0
    },
    liabilities: {
      current: {
        tradePayables: 0,
        shortTermBorrowings: 0,
        currentTaxPayable: 0,
        provisions: 0,
        otherCurrentLiabilities: 0,
        total: 0
      },
      nonCurrent: {
        longTermBorrowings: 0,
        deferredTax: 0,
        provisions: 0,
        otherNonCurrentLiabilities: 0,
        total: 0
      },
      total: 0
    },
    equity: {
      shareCapital: 0,
      retainedEarnings: 0,
      reserves: 0,
      total: 0
    },
    totalEquityAndLiabilities: 0
  };
}

function initializeProfitLoss(): ProfitLoss {
  return {
    revenue: 0,
    costOfSales: 0,
    grossProfit: 0,
    operatingExpenses: {
      employeeBenefits: 0,
      depreciation: 0,
      administrative: 0,
      distribution: 0,
      other: 0,
      total: 0
    },
    operatingProfit: 0,
    financeCosts: 0,
    financeIncome: 0,
    profitBeforeTax: 0,
    incomeTax: 0,
    profitAfterTax: 0
  };
}

function initializeCashFlow(): CashFlow {
  return {
    operating: {
      profitBeforeTax: 0,
      adjustments: {
        depreciation: 0,
        interestExpense: 0,
        other: 0,
        total: 0
      },
      workingCapitalChanges: {
        inventories: 0,
        tradeReceivables: 0,
        tradePayables: 0,
        other: 0,
        total: 0
      },
      interestPaid: 0,
      taxesPaid: 0,
      netOperating: 0
    },
    investing: {
      propertyPlantEquipment: 0,
      intangibles: 0,
      investments: 0,
      netInvesting: 0
    },
    financing: {
      borrowingsDrawdown: 0,
      borrowingsRepayment: 0,
      dividendsPaid: 0,
      netFinancing: 0
    },
    netIncrease: 0,
    cashBeginning: 0,
    cashEnding: 0
  };
}

function initializeEquity(): Equity {
  return {
    shareCapital: {
      beginning: 0,
      issued: 0,
      ending: 0
    },
    retainedEarnings: {
      beginning: 0,
      profitForYear: 0,
      dividends: 0,
      ending: 0
    },
    reserves: {
      beginning: 0,
      movements: 0,
      ending: 0
    },
    total: {
      beginning: 0,
      changes: 0,
      ending: 0
    }
  };
}

function addToStatement(
  balanceSheet: BalanceSheet,
  profitLoss: ProfitLoss,
  cashFlow: CashFlow,
  equity: Equity,
  mapping: string,
  amount: number,
  entry: TrialBalanceEntry
) {
  // Parse the mapping path (e.g., "financialPosition.assets.current.cashAndEquivalents")
  const parts = mapping.split('.');
  
  if (parts[0] === 'financialPosition') {
    // Balance Sheet
    if (parts[1] === 'assets') {
      if (parts[2] === 'current') {
        const key = parts[3] as keyof typeof balanceSheet.assets.current;
        if (key && typeof balanceSheet.assets.current[key] === 'number') {
          (balanceSheet.assets.current[key] as number) += amount;
        }
      } else if (parts[2] === 'nonCurrent') {
        const key = parts[3] as keyof typeof balanceSheet.assets.nonCurrent;
        if (key && typeof balanceSheet.assets.nonCurrent[key] === 'number') {
          (balanceSheet.assets.nonCurrent[key] as number) += amount;
        }
      }
    } else if (parts[1] === 'liabilities') {
      if (parts[2] === 'current') {
        const key = parts[3] as keyof typeof balanceSheet.liabilities.current;
        if (key && typeof balanceSheet.liabilities.current[key] === 'number') {
          (balanceSheet.liabilities.current[key] as number) -= amount; // Credit balance
        }
      } else if (parts[2] === 'nonCurrent') {
        const key = parts[3] as keyof typeof balanceSheet.liabilities.nonCurrent;
        if (key && typeof balanceSheet.liabilities.nonCurrent[key] === 'number') {
          (balanceSheet.liabilities.nonCurrent[key] as number) -= amount; // Credit balance
        }
      }
    } else if (parts[1] === 'equity') {
      const key = parts[2] as keyof typeof balanceSheet.equity;
      if (key && typeof balanceSheet.equity[key] === 'number') {
        (balanceSheet.equity[key] as number) -= amount; // Credit balance
      }
    }
  } else if (parts[0] === 'profitLoss') {
    // Profit & Loss
    if (parts[1] === 'revenue') {
      profitLoss.revenue -= amount; // Credit balance
    } else if (parts[1] === 'costOfSales') {
      profitLoss.costOfSales += amount; // Debit balance
    } else if (parts[1] === 'operatingExpenses') {
      const key = parts[2] as keyof typeof profitLoss.operatingExpenses;
      if (key && typeof profitLoss.operatingExpenses[key] === 'number') {
        (profitLoss.operatingExpenses[key] as number) += amount; // Debit balance
      }
    } else if (parts[1] === 'financeCosts') {
      profitLoss.financeCosts += amount;
    } else if (parts[1] === 'financeIncome') {
      profitLoss.financeIncome -= amount; // Credit balance
    } else if (parts[1] === 'incomeTax') {
      profitLoss.incomeTax += amount;
    }
  }
  // Note: Cash Flow and Equity statements typically require additional data
  // beyond trial balance (prior period, movements, etc.)
}

function calculateBalanceSheetTotals(bs: BalanceSheet) {
  // Current Assets Total
  bs.assets.current.total =
    bs.assets.current.cashAndEquivalents +
    bs.assets.current.tradeReceivables +
    bs.assets.current.inventories +
    bs.assets.current.prepayments +
    bs.assets.current.otherCurrentAssets;
  
  // Non-Current Assets Total
  bs.assets.nonCurrent.total =
    bs.assets.nonCurrent.propertyPlantEquipment +
    bs.assets.nonCurrent.intangibleAssets +
    bs.assets.nonCurrent.investments +
    bs.assets.nonCurrent.deferredTax +
    bs.assets.nonCurrent.otherNonCurrentAssets;
  
  // Total Assets
  bs.assets.total = bs.assets.current.total + bs.assets.nonCurrent.total;
  
  // Current Liabilities Total
  bs.liabilities.current.total =
    bs.liabilities.current.tradePayables +
    bs.liabilities.current.shortTermBorrowings +
    bs.liabilities.current.currentTaxPayable +
    bs.liabilities.current.provisions +
    bs.liabilities.current.otherCurrentLiabilities;
  
  // Non-Current Liabilities Total
  bs.liabilities.nonCurrent.total =
    bs.liabilities.nonCurrent.longTermBorrowings +
    bs.liabilities.nonCurrent.deferredTax +
    bs.liabilities.nonCurrent.provisions +
    bs.liabilities.nonCurrent.otherNonCurrentLiabilities;
  
  // Total Liabilities
  bs.liabilities.total = bs.liabilities.current.total + bs.liabilities.nonCurrent.total;
  
  // Total Equity
  bs.equity.total =
    bs.equity.shareCapital +
    bs.equity.retainedEarnings +
    bs.equity.reserves;
  
  // Total Equity and Liabilities
  bs.totalEquityAndLiabilities = bs.equity.total + bs.liabilities.total;
}

function calculateProfitLossTotals(pl: ProfitLoss) {
  // Gross Profit
  pl.grossProfit = pl.revenue - pl.costOfSales;
  
  // Operating Expenses Total
  pl.operatingExpenses.total =
    pl.operatingExpenses.employeeBenefits +
    pl.operatingExpenses.depreciation +
    pl.operatingExpenses.administrative +
    pl.operatingExpenses.distribution +
    pl.operatingExpenses.other;
  
  // Operating Profit
  pl.operatingProfit = pl.grossProfit - pl.operatingExpenses.total;
  
  // Profit Before Tax
  pl.profitBeforeTax = pl.operatingProfit - pl.financeCosts + pl.financeIncome;
  
  // Profit After Tax
  pl.profitAfterTax = pl.profitBeforeTax - pl.incomeTax;
}

function calculateCashFlowTotals(cf: CashFlow) {
  // Operating Activities
  cf.operating.adjustments.total =
    cf.operating.adjustments.depreciation +
    cf.operating.adjustments.interestExpense +
    cf.operating.adjustments.other;
  
  cf.operating.workingCapitalChanges.total =
    cf.operating.workingCapitalChanges.inventories +
    cf.operating.workingCapitalChanges.tradeReceivables +
    cf.operating.workingCapitalChanges.tradePayables +
    cf.operating.workingCapitalChanges.other;
  
  cf.operating.netOperating =
    cf.operating.profitBeforeTax +
    cf.operating.adjustments.total +
    cf.operating.workingCapitalChanges.total -
    cf.operating.interestPaid -
    cf.operating.taxesPaid;
  
  // Investing Activities
  cf.investing.netInvesting =
    cf.investing.propertyPlantEquipment +
    cf.investing.intangibles +
    cf.investing.investments;
  
  // Financing Activities
  cf.financing.netFinancing =
    cf.financing.borrowingsDrawdown +
    cf.financing.borrowingsRepayment +
    cf.financing.dividendsPaid;
  
  // Net Increase in Cash
  cf.netIncrease =
    cf.operating.netOperating +
    cf.investing.netInvesting +
    cf.financing.netFinancing;
  
  cf.cashEnding = cf.cashBeginning + cf.netIncrease;
}

function calculateEquityTotals(eq: Equity) {
  // Share Capital
  eq.shareCapital.ending = eq.shareCapital.beginning + eq.shareCapital.issued;
  
  // Retained Earnings
  eq.retainedEarnings.ending =
    eq.retainedEarnings.beginning +
    eq.retainedEarnings.profitForYear -
    eq.retainedEarnings.dividends;
  
  // Reserves
  eq.reserves.ending = eq.reserves.beginning + eq.reserves.movements;
  
  // Total Equity
  eq.total.beginning =
    eq.shareCapital.beginning +
    eq.retainedEarnings.beginning +
    eq.reserves.beginning;
  
  eq.total.ending =
    eq.shareCapital.ending +
    eq.retainedEarnings.ending +
    eq.reserves.ending;
  
  eq.total.changes = eq.total.ending - eq.total.beginning;
}
