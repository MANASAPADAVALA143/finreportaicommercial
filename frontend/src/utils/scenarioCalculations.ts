/**
 * Scenario Planning Financial Calculation Engine
 * 
 * This module calculates financial outcomes based on user-defined assumptions
 * Converts slider inputs into complete P&L, Balance Sheet, and Cash Flow projections
 */

export interface BaselineData {
  // Prior year actuals (FY2025)
  priorRevenue: number;
  priorCOGS: number;
  priorGrossProfit: number;
  priorOpex: number;
  priorPayroll: number;
  priorAdmin: number;
  priorDepreciation: number;
  priorInterest: number;
  priorTax: number;
  
  // Starting position
  openingCash: number;
  avgMonthlyBurn: number;
  
  // Operational metrics
  domesticRevenueMix: number;  // % of revenue from domestic
  exportRevenueMix: number;    // % of revenue from export
}

export interface ScenarioAssumptions {
  revenueGrowth: number;        // Overall revenue growth %
  domesticMix: number;          // Domestic sales mix %
  exportGrowth: number;         // Export sales growth %
  newCustomerRev: number;       // New customer revenue (₹Cr)
  cogsPercent: number;          // COGS as % of revenue
  payrollGrowth: number;        // Payroll growth %
  opexGrowth: number;           // Operating expense growth %
  adminPercent: number;         // Admin as % of revenue
  marketGrowth: number;         // Market growth rate %
  priceChange: number;          // Price change %
  churnPercent: number;         // Customer churn %
}

export interface CalculatedResults {
  revenue: number;
  grossProfit: number;
  grossMargin: number;
  ebitda: number;
  ebitdaMargin: number;
  netProfit: number;
  netMargin: number;
  cashPosition: number;
  breakEvenMonth: string;
  runway: number;
}

// Default baseline from October 2025 actuals
export const DEFAULT_BASELINE: BaselineData = {
  priorRevenue: 330000000,      // ₹33Cr
  priorCOGS: 185000000,          // ₹18.5Cr
  priorGrossProfit: 145000000,   // ₹14.5Cr
  priorOpex: 126000000,          // ₹12.6Cr (total opex)
  priorPayroll: 32000000,        // ₹3.2Cr
  priorAdmin: 14500000,          // ₹1.45Cr
  priorDepreciation: 14000000,   // ₹1.4Cr
  priorInterest: 8000000,        // ₹0.8Cr
  priorTax: 27000000,            // ₹2.7Cr (est. 30% rate)
  
  openingCash: 25000000,         // ₹2.5Cr starting cash
  avgMonthlyBurn: 1800000,       // ₹18L/month average burn
  
  domesticRevenueMix: 76,
  exportRevenueMix: 24
};

/**
 * Calculate scenario results based on assumptions
 */
export function calculateScenario(
  assumptions: ScenarioAssumptions,
  baseline: BaselineData = DEFAULT_BASELINE
): CalculatedResults {
  
  // ========================================
  // STEP 1: REVENUE CALCULATION
  // ========================================
  
  // Base revenue growth from prior year
  let baseRevenue = baseline.priorRevenue * (1 + assumptions.revenueGrowth / 100);
  
  // Adjust for price changes
  baseRevenue = baseRevenue * (1 + assumptions.priceChange / 100);
  
  // Adjust for customer churn (reduces revenue)
  baseRevenue = baseRevenue * (1 - assumptions.churnPercent / 100);
  
  // Add new customer revenue
  const newCustomerRevenue = assumptions.newCustomerRev * 10000000; // Convert Cr to ₹
  
  // Calculate domestic vs export split
  const domesticRevenue = baseRevenue * (assumptions.domesticMix / 100);
  const exportRevenue = baseRevenue * ((100 - assumptions.domesticMix) / 100);
  
  // Apply export-specific growth
  const adjustedExportRevenue = exportRevenue * (1 + (assumptions.exportGrowth - assumptions.revenueGrowth) / 100);
  
  // Total revenue
  const totalRevenue = domesticRevenue + adjustedExportRevenue + newCustomerRevenue;
  
  
  // ========================================
  // STEP 2: COST OF GOODS SOLD (COGS)
  // ========================================
  
  const cogs = totalRevenue * (assumptions.cogsPercent / 100);
  const grossProfit = totalRevenue - cogs;
  const grossMargin = (grossProfit / totalRevenue) * 100;
  
  
  // ========================================
  // STEP 3: OPERATING EXPENSES
  // ========================================
  
  // Payroll
  const payroll = baseline.priorPayroll * (1 + assumptions.payrollGrowth / 100);
  
  // Admin expenses (% of revenue)
  const adminExpenses = totalRevenue * (assumptions.adminPercent / 100);
  
  // Other operating expenses (excluding payroll and admin)
  const otherOpex = (baseline.priorOpex - baseline.priorPayroll - baseline.priorAdmin) * 
                    (1 + assumptions.opexGrowth / 100);
  
  // Depreciation (assume stays constant)
  const depreciation = baseline.priorDepreciation;
  
  // Total operating expenses
  const totalOpex = payroll + adminExpenses + otherOpex + depreciation;
  
  
  // ========================================
  // STEP 4: EBITDA & NET PROFIT
  // ========================================
  
  const ebitda = grossProfit - (totalOpex - depreciation); // EBITDA = before depreciation
  const ebitdaMargin = (ebitda / totalRevenue) * 100;
  
  const ebit = ebitda - depreciation;
  
  // Interest expense (assume stays constant)
  const interestExpense = baseline.priorInterest;
  
  // Earnings before tax
  const ebt = ebit - interestExpense;
  
  // Tax (30% effective rate, only on positive earnings)
  const taxRate = 0.30;
  const taxExpense = ebt > 0 ? ebt * taxRate : 0;
  
  // Net profit
  const netProfit = ebt - taxExpense;
  const netMargin = (netProfit / totalRevenue) * 100;
  
  
  // ========================================
  // STEP 5: CASH POSITION & RUNWAY
  // ========================================
  
  // Simplified cash flow (Net Profit + Depreciation - CapEx)
  // Assume CapEx = 50% of depreciation (maintenance level)
  const operatingCashFlow = netProfit + depreciation - (depreciation * 0.5);
  
  // End of year cash position (12 months)
  const endingCash = baseline.openingCash + operatingCashFlow;
  
  // Monthly burn rate calculation
  // If profitable: burn = 0, build cash
  // If loss-making: burn = (loss / 12) + working capital
  let monthlyBurn: number;
  if (netProfit > 0) {
    // Building cash, not burning
    monthlyBurn = 0;
    const monthsOfBuffer = endingCash / baseline.avgMonthlyBurn;
    var runway = Math.min(36, Math.round(monthsOfBuffer)); // Cap at 36 months
  } else {
    // Burning cash
    const annualLoss = Math.abs(netProfit);
    monthlyBurn = annualLoss / 12;
    var runway = Math.round(endingCash / monthlyBurn);
  }
  
  
  // ========================================
  // STEP 6: BREAK-EVEN CALCULATION
  // ========================================
  
  // Calculate which month the business breaks even on a monthly basis
  const monthlyRevenue = totalRevenue / 12;
  const monthlyCOGS = cogs / 12;
  const monthlyOpex = totalOpex / 12;
  const monthlyFixedCosts = monthlyOpex + baseline.priorInterest / 12;
  
  // Break-even occurs when: monthlyRevenue - monthlyCOGS - monthlyFixedCosts >= 0
  const monthlyContributionMargin = monthlyRevenue - monthlyCOGS;
  const breakEvenReached = monthlyContributionMargin >= monthlyFixedCosts;
  
  let breakEvenMonth: string;
  if (breakEvenReached) {
    // Assume seasonal revenue pattern - stronger in Q1 and Q4
    const seasonalityFactor = [1.15, 1.10, 1.20, 1.05, 1.08, 1.12, 1.02, 0.98, 1.00, 1.05, 0.95, 1.30]; // Jan-Dec
    let cumulativeCash = baseline.openingCash;
    let monthIndex = 0;
    
    for (let i = 0; i < 12; i++) {
      const monthRev = monthlyRevenue * seasonalityFactor[i];
      const monthProfit = monthRev * (netMargin / 100);
      cumulativeCash += monthProfit;
      
      if (cumulativeCash >= baseline.openingCash && monthIndex === 0) {
        monthIndex = i;
        break;
      }
    }
    
    const months = ["Jan 26", "Feb 26", "Mar 26", "Apr 26", "May 26", "Jun 26", 
                    "Jul 26", "Aug 26", "Sep 26", "Oct 26", "Nov 26", "Dec 26"];
    breakEvenMonth = months[monthIndex];
  } else {
    // Never breaks even in the year
    breakEvenMonth = "Not achieved";
  }
  
  
  // ========================================
  // RETURN RESULTS
  // ========================================
  
  return {
    revenue: Math.round(totalRevenue),
    grossProfit: Math.round(grossProfit),
    grossMargin: parseFloat(grossMargin.toFixed(1)),
    ebitda: Math.round(ebitda),
    ebitdaMargin: parseFloat(ebitdaMargin.toFixed(1)),
    netProfit: Math.round(netProfit),
    netMargin: parseFloat(netMargin.toFixed(1)),
    cashPosition: Math.round(endingCash),
    breakEvenMonth,
    runway: runway
  };
}

/**
 * Generate monthly projections for charting
 */
export function calculateMonthlyProjections(
  assumptions: ScenarioAssumptions,
  baseline: BaselineData = DEFAULT_BASELINE
): Array<{ month: string; revenue: number; profit: number; cash: number }> {
  
  const annualResults = calculateScenario(assumptions, baseline);
  
  // Seasonality factors for revenue (Jan-Dec)
  const seasonality = [1.15, 1.10, 1.20, 1.05, 1.08, 1.12, 1.02, 0.98, 1.00, 1.05, 0.95, 1.30];
  const months = ["Jan 26", "Feb 26", "Mar 26", "Apr 26", "May 26", "Jun 26", 
                  "Jul 26", "Aug 26", "Sep 26", "Oct 26", "Nov 26", "Dec 26"];
  
  const avgMonthlyRevenue = annualResults.revenue / 12;
  const avgMonthlyProfit = annualResults.netProfit / 12;
  
  let cumulativeCash = baseline.openingCash;
  
  return months.map((month, idx) => {
    const monthRevenue = avgMonthlyRevenue * seasonality[idx];
    const monthProfit = avgMonthlyProfit * seasonality[idx];
    cumulativeCash += monthProfit;
    
    return {
      month,
      revenue: Math.round(monthRevenue),
      profit: Math.round(monthProfit),
      cash: Math.round(cumulativeCash)
    };
  });
}

/**
 * Calculate sensitivity analysis
 * Shows impact on net profit when each variable changes by -20%, -10%, 0%, +10%, +20%
 */
export function calculateSensitivity(
  baseAssumptions: ScenarioAssumptions,
  baseline: BaselineData = DEFAULT_BASELINE
) {
  const baseResults = calculateScenario(baseAssumptions, baseline);
  const baseNetProfit = baseResults.netProfit;
  
  const variables: Array<keyof ScenarioAssumptions> = [
    'revenueGrowth',
    'cogsPercent',
    'priceChange',
    'payrollGrowth',
    'adminPercent',
    'marketGrowth'
  ];
  
  const variableLabels: Record<string, string> = {
    revenueGrowth: 'Revenue Growth %',
    cogsPercent: 'COGS %',
    priceChange: 'Price Change %',
    payrollGrowth: 'Payroll Growth %',
    adminPercent: 'Admin Costs %',
    marketGrowth: 'Market Growth %'
  };
  
  return variables.map(variable => {
    const baseValue = baseAssumptions[variable];
    
    // Calculate profit at different levels
    const results: Record<string, number> = {};
    
    for (const change of [-20, -10, 0, 10, 20]) {
      const testAssumptions = { ...baseAssumptions };
      
      // For percentage variables, adjust by percentage points
      // For COGS, inverse relationship (higher COGS = lower profit)
      if (variable === 'cogsPercent') {
        testAssumptions[variable] = baseValue * (1 + change / 100);
      } else {
        testAssumptions[variable] = baseValue + (baseValue * change / 100);
      }
      
      const result = calculateScenario(testAssumptions, baseline);
      results[`${change}`] = result.netProfit;
    }
    
    const impact = Math.abs(results['20'] - results['-20']);
    const sensitivity: 'high' | 'medium' | 'low' = 
      impact > 50000000 ? 'high' : 
      impact > 20000000 ? 'medium' : 
      'low';
    
    return {
      variable: variableLabels[variable],
      baseValue,
      minus20: results['-20'],
      minus10: results['-10'],
      base: results['0'],
      plus10: results['10'],
      plus20: results['20'],
      impactOnNetProfit: impact,
      sensitivity
    };
  });
}
