// Helper to load FP&A data from localStorage
// Each module reads only what it needs
import { backendOrigin } from './backendOrigin';

import {
  BUDGET_MONTH_KEYS,
  forwardFillMonthlyBudget,
  inferBudgetDepartment,
  getBudgetSection,
} from './budgetUtils';

const FPA_MONTH_KEYS = BUDGET_MONTH_KEYS;

function getFirstStored(keys: string[]): any | null {
  for (const k of keys) {
    const raw = localStorage.getItem(k);
    if (!raw) continue;
    try {
      return JSON.parse(raw);
    } catch {
      // ignore malformed entries and continue
    }
  }
  return null;
}

export const loadFPAActual = () =>
  getFirstStored(['fpa_actual', 'fpa_actual_tb', 'finreport_fpa_actuals']);

export const loadFPABudget = () =>
  getFirstStored(['fpa_budget', 'fpa_budget_tb', 'finreport_fpa_budget']);

export const loadFPAPriorYear = () => {
  const stored = localStorage.getItem('fpa_prior_year');
  return stored ? JSON.parse(stored) : null;
};

export const loadFPAForecast = () =>
  getFirstStored(['fpa_forecast', 'fpa_forecast_data']);

export const loadFPADepartments = () =>
  getFirstStored(['fpa_departments']);

export const loadFPAScenarios = () =>
  getFirstStored(['fpa_scenarios']);

// Calculate variance from actual and budget data
export const calculateVariance = (actual: any, budget: any) => {
  if (!actual || !budget) return null;

  const variance = actual - budget;
  const variancePct = budget !== 0 ? (variance / budget) * 100 : 0;

  return {
    variance,
    variancePct,
    favorable: variance > 0 // For revenue, positive is favorable
  };
};

// BUG 2 FIX: Normalise scale (Lakhs vs Crores). If budget is 10x+ larger than actual, assume budget in Lakhs â†’ convert to Crores.
const normaliseBudgetScale = (actualData: any, budgetData: any): any => {
  if (!actualData || !budgetData) return budgetData;
  const ref = (actualData.totalRevenue || actualData.domesticRevenue || 0) || 1;
  const budgetVal = budgetData.totalRevenue || budgetData.domesticRevenue || 0;
  if (budgetVal > ref * 50) {
    const scaled: any = {};
    for (const k of Object.keys(budgetData)) {
      const v = (budgetData as any)[k];
      scaled[k] = typeof v === 'number' ? v / 100 : v;
    }
    return scaled;
  }
  return budgetData;
};

// Convert uploaded financial data to variance analysis format
export const convertToVarianceData = (actualData: any, budgetData: any) => {
  if (!actualData || !budgetData) return [];

  const budget = normaliseBudgetScale(actualData, budgetData);

  const varianceRows = [
    // Revenue Section
    {
      id: 'revenue-header',
      category: 'Revenue',
      isHeader: true,
      actual: 0,
      budget: 0,
      variance: 0,
      variancePct: 0,
      ytdActual: 0,
      ytdBudget: 0,
      ytdVariance: 0,
      ytdVariancePct: 0,
      favorable: true,
      threshold: 'ok' as const
    },
    {
      id: 'domestic-revenue',
      category: 'Domestic Revenue',
      isHeader: false,
      actual: actualData.domesticRevenue || 0,
      budget: budget.domesticRevenue || 0,
      variance: (actualData.domesticRevenue || 0) - (budget.domesticRevenue || 0),
      variancePct: budget.domesticRevenue ? ((actualData.domesticRevenue - budget.domesticRevenue) / budget.domesticRevenue) * 100 : 0,
      ytdActual: (actualData.domesticRevenue || 0) * 10, // Assuming Oct = 10 months
      ytdBudget: (budget.domesticRevenue || 0) * 10,
      ytdVariance: ((actualData.domesticRevenue || 0) - (budget.domesticRevenue || 0)) * 10,
      ytdVariancePct: budget.domesticRevenue ? ((actualData.domesticRevenue - budget.domesticRevenue) / budget.domesticRevenue) * 100 : 0,
      favorable: (actualData.domesticRevenue || 0) > (budget.domesticRevenue || 0),
      threshold: Math.abs(budget.domesticRevenue ? ((actualData.domesticRevenue - budget.domesticRevenue) / budget.domesticRevenue) * 100 : 0) > 10 ? 'critical' as const : Math.abs(budget.domesticRevenue ? ((actualData.domesticRevenue - budget.domesticRevenue) / budget.domesticRevenue) * 100 : 0) > 5 ? 'warning' as const : 'ok' as const
    },
    {
      id: 'export-revenue',
      category: 'Export Revenue',
      isHeader: false,
      actual: actualData.exportRevenue || 0,
      budget: budget.exportRevenue || 0,
      variance: (actualData.exportRevenue || 0) - (budget.exportRevenue || 0),
      variancePct: budget.exportRevenue ? ((actualData.exportRevenue - budget.exportRevenue) / budget.exportRevenue) * 100 : 0,
      ytdActual: (actualData.exportRevenue || 0) * 10,
      ytdBudget: (budget.exportRevenue || 0) * 10,
      ytdVariance: ((actualData.exportRevenue || 0) - (budget.exportRevenue || 0)) * 10,
      ytdVariancePct: budget.exportRevenue ? ((actualData.exportRevenue - budget.exportRevenue) / budget.exportRevenue) * 100 : 0,
      favorable: (actualData.exportRevenue || 0) > (budget.exportRevenue || 0),
      threshold: Math.abs(budget.exportRevenue ? ((actualData.exportRevenue - budget.exportRevenue) / budget.exportRevenue) * 100 : 0) > 10 ? 'critical' as const : Math.abs(budget.exportRevenue ? ((actualData.exportRevenue - budget.exportRevenue) / budget.exportRevenue) * 100 : 0) > 5 ? 'warning' as const : 'ok' as const
    },
    {
      id: 'service-revenue',
      category: 'Service Revenue',
      isHeader: false,
      actual: actualData.serviceRevenue || 0,
      budget: budget.serviceRevenue || 0,
      variance: (actualData.serviceRevenue || 0) - (budget.serviceRevenue || 0),
      variancePct: budget.serviceRevenue ? ((actualData.serviceRevenue - budget.serviceRevenue) / budget.serviceRevenue) * 100 : 0,
      ytdActual: (actualData.serviceRevenue || 0) * 10,
      ytdBudget: (budget.serviceRevenue || 0) * 10,
      ytdVariance: ((actualData.serviceRevenue || 0) - (budget.serviceRevenue || 0)) * 10,
      ytdVariancePct: budget.serviceRevenue ? ((actualData.serviceRevenue - budget.serviceRevenue) / budget.serviceRevenue) * 100 : 0,
      favorable: (actualData.serviceRevenue || 0) > (budget.serviceRevenue || 0),
      threshold: Math.abs(budget.serviceRevenue ? ((actualData.serviceRevenue - budget.serviceRevenue) / budget.serviceRevenue) * 100 : 0) > 10 ? 'critical' as const : Math.abs(budget.serviceRevenue ? ((actualData.serviceRevenue - budget.serviceRevenue) / budget.serviceRevenue) * 100 : 0) > 5 ? 'warning' as const : 'ok' as const
    },
    {
      id: 'total-revenue',
      category: 'Total Revenue',
      isHeader: false,
      actual: actualData.totalRevenue || 0,
      budget: budget.totalRevenue || 0,
      variance: (actualData.totalRevenue || 0) - (budget.totalRevenue || 0),
      variancePct: budget.totalRevenue ? ((actualData.totalRevenue - budget.totalRevenue) / budget.totalRevenue) * 100 : 0,
      ytdActual: (actualData.totalRevenue || 0) * 10,
      ytdBudget: (budget.totalRevenue || 0) * 10,
      ytdVariance: ((actualData.totalRevenue || 0) - (budget.totalRevenue || 0)) * 10,
      ytdVariancePct: budget.totalRevenue ? ((actualData.totalRevenue - budget.totalRevenue) / budget.totalRevenue) * 100 : 0,
      favorable: (actualData.totalRevenue || 0) > (budget.totalRevenue || 0),
      threshold: Math.abs(budget.totalRevenue ? ((actualData.totalRevenue - budget.totalRevenue) / budget.totalRevenue) * 100 : 0) > 10 ? 'critical' as const : Math.abs(budget.totalRevenue ? ((actualData.totalRevenue - budget.totalRevenue) / budget.totalRevenue) * 100 : 0) > 5 ? 'warning' as const : 'ok' as const
    },
    // Expenses Section
    {
      id: 'expenses-header',
      category: 'Operating Expenses',
      isHeader: true,
      actual: 0,
      budget: 0,
      variance: 0,
      variancePct: 0,
      ytdActual: 0,
      ytdBudget: 0,
      ytdVariance: 0,
      ytdVariancePct: 0,
      favorable: true,
      threshold: 'ok' as const
    },
    {
      id: 'cogs',
      category: 'Cost of Goods Sold',
      isHeader: false,
      actual: actualData.costOfGoodsSold || 0,
      budget: budget.costOfGoodsSold || 0,
      variance: (actualData.costOfGoodsSold || 0) - (budget.costOfGoodsSold || 0),
      variancePct: budget.costOfGoodsSold ? ((actualData.costOfGoodsSold - budget.costOfGoodsSold) / budget.costOfGoodsSold) * 100 : 0,
      ytdActual: (actualData.costOfGoodsSold || 0) * 10,
      ytdBudget: (budget.costOfGoodsSold || 0) * 10,
      ytdVariance: ((actualData.costOfGoodsSold || 0) - (budget.costOfGoodsSold || 0)) * 10,
      ytdVariancePct: budget.costOfGoodsSold ? ((actualData.costOfGoodsSold - budget.costOfGoodsSold) / budget.costOfGoodsSold) * 100 : 0,
      favorable: (actualData.costOfGoodsSold || 0) < (budget.costOfGoodsSold || 0),
      threshold: Math.abs(budget.costOfGoodsSold ? ((actualData.costOfGoodsSold - budget.costOfGoodsSold) / budget.costOfGoodsSold) * 100 : 0) > 10 ? 'critical' as const : Math.abs(budget.costOfGoodsSold ? ((actualData.costOfGoodsSold - budget.costOfGoodsSold) / budget.costOfGoodsSold) * 100 : 0) > 5 ? 'warning' as const : 'ok' as const
    },
    {
      id: 'payroll',
      category: 'Payroll Expenses',
      isHeader: false,
      actual: actualData.payroll || 0,
      budget: budget.payroll || 0,
      variance: (actualData.payroll || 0) - (budget.payroll || 0),
      variancePct: budget.payroll ? ((actualData.payroll - budget.payroll) / budget.payroll) * 100 : 0,
      ytdActual: (actualData.payroll || 0) * 10,
      ytdBudget: (budget.payroll || 0) * 10,
      ytdVariance: ((actualData.payroll || 0) - (budget.payroll || 0)) * 10,
      ytdVariancePct: budget.payroll ? ((actualData.payroll - budget.payroll) / budget.payroll) * 100 : 0,
      favorable: (actualData.payroll || 0) < (budget.payroll || 0),
      threshold: Math.abs(budget.payroll ? ((actualData.payroll - budget.payroll) / budget.payroll) * 100 : 0) > 10 ? 'critical' as const : Math.abs(budget.payroll ? ((actualData.payroll - budget.payroll) / budget.payroll) * 100 : 0) > 5 ? 'warning' as const : 'ok' as const
    },
    {
      id: 'admin',
      category: 'Admin Expenses',
      isHeader: false,
      actual: actualData.adminExpenses || 0,
      budget: budget.adminExpenses || 0,
      variance: (actualData.adminExpenses || 0) - (budget.adminExpenses || 0),
      variancePct: budget.adminExpenses ? ((actualData.adminExpenses - budget.adminExpenses) / budget.adminExpenses) * 100 : 0,
      ytdActual: (actualData.adminExpenses || 0) * 10,
      ytdBudget: (budget.adminExpenses || 0) * 10,
      ytdVariance: ((actualData.adminExpenses || 0) - (budget.adminExpenses || 0)) * 10,
      ytdVariancePct: budget.adminExpenses ? ((actualData.adminExpenses - budget.adminExpenses) / budget.adminExpenses) * 100 : 0,
      favorable: (actualData.adminExpenses || 0) < (budget.adminExpenses || 0),
      threshold: Math.abs(budget.adminExpenses ? ((actualData.adminExpenses - budget.adminExpenses) / budget.adminExpenses) * 100 : 0) > 10 ? 'critical' as const : Math.abs(budget.adminExpenses ? ((actualData.adminExpenses - budget.adminExpenses) / budget.adminExpenses) * 100 : 0) > 5 ? 'warning' as const : 'ok' as const
    },
    {
      id: 'marketing',
      category: 'Marketing Costs',
      isHeader: false,
      actual: actualData.marketingCosts || 0,
      budget: budget.marketingCosts || 0,
      variance: (actualData.marketingCosts || 0) - (budget.marketingCosts || 0),
      variancePct: budget.marketingCosts ? ((actualData.marketingCosts - budget.marketingCosts) / budget.marketingCosts) * 100 : 0,
      ytdActual: (actualData.marketingCosts || 0) * 10,
      ytdBudget: (budget.marketingCosts || 0) * 10,
      ytdVariance: ((actualData.marketingCosts || 0) - (budget.marketingCosts || 0)) * 10,
      ytdVariancePct: budget.marketingCosts ? ((actualData.marketingCosts - budget.marketingCosts) / budget.marketingCosts) * 100 : 0,
      favorable: (actualData.marketingCosts || 0) < (budget.marketingCosts || 0),
      threshold: Math.abs(budget.marketingCosts ? ((actualData.marketingCosts - budget.marketingCosts) / budget.marketingCosts) * 100 : 0) > 10 ? 'critical' as const : Math.abs(budget.marketingCosts ? ((actualData.marketingCosts - budget.marketingCosts) / budget.marketingCosts) * 100 : 0) > 5 ? 'warning' as const : 'ok' as const
    },
    {
      id: 'rent',
      category: 'Rent & Facilities',
      isHeader: false,
      actual: actualData.rentExpense || 0,
      budget: budget.rentExpense || 0,
      variance: (actualData.rentExpense || 0) - (budget.rentExpense || 0),
      variancePct: budget.rentExpense ? ((actualData.rentExpense - budget.rentExpense) / budget.rentExpense) * 100 : 0,
      ytdActual: (actualData.rentExpense || 0) * 10,
      ytdBudget: (budget.rentExpense || 0) * 10,
      ytdVariance: ((actualData.rentExpense || 0) - (budget.rentExpense || 0)) * 10,
      ytdVariancePct: budget.rentExpense ? ((actualData.rentExpense - budget.rentExpense) / budget.rentExpense) * 100 : 0,
      favorable: (actualData.rentExpense || 0) < (budget.rentExpense || 0),
      threshold: Math.abs(budget.rentExpense ? ((actualData.rentExpense - budget.rentExpense) / budget.rentExpense) * 100 : 0) > 10 ? 'critical' as const : Math.abs(budget.rentExpense ? ((actualData.rentExpense - budget.rentExpense) / budget.rentExpense) * 100 : 0) > 5 ? 'warning' as const : 'ok' as const
    },
    {
      id: 'depreciation',
      category: 'Depreciation',
      isHeader: false,
      actual: actualData.depreciation || 0,
      budget: budget.depreciation || 0,
      variance: (actualData.depreciation || 0) - (budget.depreciation || 0),
      variancePct: budget.depreciation ? ((actualData.depreciation - budget.depreciation) / budget.depreciation) * 100 : 0,
      ytdActual: (actualData.depreciation || 0) * 10,
      ytdBudget: (budget.depreciation || 0) * 10,
      ytdVariance: ((actualData.depreciation || 0) - (budget.depreciation || 0)) * 10,
      ytdVariancePct: budget.depreciation ? ((actualData.depreciation - budget.depreciation) / budget.depreciation) * 100 : 0,
      favorable: (actualData.depreciation || 0) < (budget.depreciation || 0),
      threshold: Math.abs(budget.depreciation ? ((actualData.depreciation - budget.depreciation) / budget.depreciation) * 100 : 0) > 10 ? 'critical' as const : Math.abs(budget.depreciation ? ((actualData.depreciation - budget.depreciation) / budget.depreciation) * 100 : 0) > 5 ? 'warning' as const : 'ok' as const
    }
  ];

  return varianceRows;
};

// Calculate KPIs from uploaded actual and budget data
export const calculateRealKPIs = (actualData: any, budgetData: any) => {
  if (!actualData || !budgetData) return null;

  const actual = actualData;
  const budget = budgetData;

  // Revenue KPIs
  const revenueKPIs = [
    {
      id: 'total-revenue',
      name: 'Total Revenue',
      value: actual.totalRevenue || 0,
      target: budget.totalRevenue || 0,
      variance: ((actual.totalRevenue || 0) - (budget.totalRevenue || 0)) / (budget.totalRevenue || 1) * 100,
      status: ((actual.totalRevenue || 0) >= (budget.totalRevenue || 0)) ? 'good' as const : 'warning' as const,
      trend: 'up' as const,
      unit: 'currency' as const
    },
    {
      id: 'domestic-revenue',
      name: 'Domestic Revenue',
      value: actual.domesticRevenue || 0,
      target: budget.domesticRevenue || 0,
      variance: ((actual.domesticRevenue || 0) - (budget.domesticRevenue || 0)) / (budget.domesticRevenue || 1) * 100,
      status: ((actual.domesticRevenue || 0) >= (budget.domesticRevenue || 0)) ? 'good' as const : 'warning' as const,
      trend: 'up' as const,
      unit: 'currency' as const
    },
    {
      id: 'export-revenue',
      name: 'Export Revenue',
      value: actual.exportRevenue || 0,
      target: budget.exportRevenue || 0,
      variance: ((actual.exportRevenue || 0) - (budget.exportRevenue || 0)) / (budget.exportRevenue || 1) * 100,
      status: ((actual.exportRevenue || 0) >= (budget.exportRevenue || 0)) ? 'good' as const : 'warning' as const,
      trend: 'up' as const,
      unit: 'currency' as const
    },
    {
      id: 'service-revenue',
      name: 'Service Revenue',
      value: actual.serviceRevenue || 0,
      target: budget.serviceRevenue || 0,
      variance: ((actual.serviceRevenue || 0) - (budget.serviceRevenue || 0)) / (budget.serviceRevenue || 1) * 100,
      status: ((actual.serviceRevenue || 0) >= (budget.serviceRevenue || 0)) ? 'good' as const : 'warning' as const,
      trend: 'up' as const,
      unit: 'currency' as const
    }
  ];

  // Profitability KPIs
  const grossProfit = (actual.totalRevenue || 0) - (actual.costOfGoodsSold || 0);
  const grossMargin = (actual.totalRevenue || 0) > 0 ? (grossProfit / actual.totalRevenue) * 100 : 0;
  const netProfit = grossProfit - (actual.totalOperatingExpenses || 0);
  const netMargin = (actual.totalRevenue || 0) > 0 ? (netProfit / actual.totalRevenue) * 100 : 0;
  const ebitda = netProfit + (actual.depreciation || 0) + (actual.interestExpense || 0);

  const budgetGrossProfit = (budget.totalRevenue || 0) - (budget.costOfGoodsSold || 0);
  const budgetGrossMargin = (budget.totalRevenue || 0) > 0 ? (budgetGrossProfit / budget.totalRevenue) * 100 : 0;
  const budgetNetProfit = budgetGrossProfit - (budget.totalOperatingExpenses || 0);
  const budgetNetMargin = (budget.totalRevenue || 0) > 0 ? (budgetNetProfit / budget.totalRevenue) * 100 : 0;

  const profitabilityKPIs = [
    {
      id: 'gross-margin',
      name: 'Gross Margin %',
      value: grossMargin,
      target: budgetGrossMargin,
      variance: grossMargin - budgetGrossMargin,
      status: (grossMargin >= budgetGrossMargin) ? 'good' as const : 'warning' as const,
      trend: 'up' as const,
      unit: 'percentage' as const
    },
    {
      id: 'net-margin',
      name: 'Net Margin %',
      value: netMargin,
      target: budgetNetMargin,
      variance: netMargin - budgetNetMargin,
      status: (netMargin >= budgetNetMargin) ? 'good' as const : 'warning' as const,
      trend: 'up' as const,
      unit: 'percentage' as const
    },
    {
      id: 'ebitda',
      name: 'EBITDA',
      value: ebitda,
      target: (budget.totalRevenue || 0) * 0.20, // Assume 20% target
      variance: (ebitda - ((budget.totalRevenue || 0) * 0.20)) / ((budget.totalRevenue || 0) * 0.20) * 100,
      status: (ebitda >= (budget.totalRevenue || 0) * 0.15) ? 'good' as const : 'warning' as const,
      trend: 'up' as const,
      unit: 'currency' as const
    },
    {
      id: 'operating-expenses',
      name: 'Operating Expense Ratio',
      value: (actual.totalRevenue || 0) > 0 ? ((actual.totalOperatingExpenses || 0) / actual.totalRevenue) * 100 : 0,
      target: (budget.totalRevenue || 0) > 0 ? ((budget.totalOperatingExpenses || 0) / budget.totalRevenue) * 100 : 0,
      variance: ((actual.totalOperatingExpenses || 0) / (actual.totalRevenue || 1) * 100) - ((budget.totalOperatingExpenses || 0) / (budget.totalRevenue || 1) * 100),
      status: (((actual.totalOperatingExpenses || 0) / (actual.totalRevenue || 1)) <= ((budget.totalOperatingExpenses || 0) / (budget.totalRevenue || 1))) ? 'good' as const : 'warning' as const,
      trend: 'down' as const,
      unit: 'percentage' as const
    }
  ];

  // Liquidity KPIs
  const currentRatio = (actual.accountsPayable || 1) > 0 ? ((actual.cashAndEquivalents || 0) + (actual.accountsReceivable || 0)) / (actual.accountsPayable || 1) : 0;
  const quickRatio = (actual.accountsPayable || 1) > 0 ? (actual.cashAndEquivalents || 0) / (actual.accountsPayable || 1) : 0;
  const dso = (actual.totalRevenue || 1) > 0 ? ((actual.accountsReceivable || 0) / (actual.totalRevenue || 1)) * 365 : 0;
  const dpo = (actual.costOfGoodsSold || 1) > 0 ? ((actual.accountsPayable || 0) / (actual.costOfGoodsSold || 1)) * 365 : 0;

  const liquidityKPIs = [
    {
      id: 'cash-position',
      name: 'Cash & Equivalents',
      value: actual.cashAndEquivalents || 0,
      target: budget.cashAndEquivalents || (actual.totalRevenue || 0) * 0.15, // 15% of revenue target
      variance: ((actual.cashAndEquivalents || 0) - (budget.cashAndEquivalents || 0)) / (budget.cashAndEquivalents || 1) * 100,
      status: (actual.cashAndEquivalents || 0) >= (budget.cashAndEquivalents || 0) ? 'good' as const : 'warning' as const,
      trend: 'up' as const,
      unit: 'currency' as const
    },
    {
      id: 'current-ratio',
      name: 'Current Ratio',
      value: currentRatio,
      target: 1.5,
      variance: ((currentRatio - 1.5) / 1.5) * 100,
      status: currentRatio >= 1.2 ? 'good' as const : 'warning' as const,
      trend: 'stable' as const,
      unit: 'ratio' as const
    },
    {
      id: 'quick-ratio',
      name: 'Quick Ratio',
      value: quickRatio,
      target: 1.0,
      variance: ((quickRatio - 1.0) / 1.0) * 100,
      status: quickRatio >= 0.8 ? 'good' as const : 'warning' as const,
      trend: 'stable' as const,
      unit: 'ratio' as const
    },
    {
      id: 'working-capital',
      name: 'Working Capital',
      value: ((actual.cashAndEquivalents || 0) + (actual.accountsReceivable || 0) + (actual.inventory || 0)) - (actual.accountsPayable || 0),
      target: ((budget.cashAndEquivalents || 0) + (budget.accountsReceivable || 0) + (budget.inventory || 0)) - (budget.accountsPayable || 0),
      variance: ((((actual.cashAndEquivalents || 0) + (actual.accountsReceivable || 0) + (actual.inventory || 0)) - (actual.accountsPayable || 0)) - (((budget.cashAndEquivalents || 0) + (budget.accountsReceivable || 0) + (budget.inventory || 0)) - (budget.accountsPayable || 0))) / (((budget.cashAndEquivalents || 0) + (budget.accountsReceivable || 0) + (budget.inventory || 0)) - (budget.accountsPayable || 0) || 1) * 100,
      status: ((((actual.cashAndEquivalents || 0) + (actual.accountsReceivable || 0) + (actual.inventory || 0)) - (actual.accountsPayable || 0)) >= (((budget.cashAndEquivalents || 0) + (budget.accountsReceivable || 0) + (budget.inventory || 0)) - (budget.accountsPayable || 0))) ? 'good' as const : 'warning' as const,
      trend: 'up' as const,
      unit: 'currency' as const
    }
  ];

  // Efficiency KPIs
  const assetTurnover = (actual.totalAssets || 1) > 0 ? (actual.totalRevenue || 0) / (actual.totalAssets || 1) : 0;
  const roa = (actual.totalAssets || 1) > 0 ? (netProfit / (actual.totalAssets || 1)) * 100 : 0;
  const _roe = (actual.equity || 1) > 0 ? (netProfit / (actual.equity || 1)) * 100 : 0;
  void _roe; // reserved for future ROE KPI card

  const efficiencyKPIs = [
    {
      id: 'dso',
      name: 'Days Sales Outstanding',
      value: dso,
      target: 45,
      variance: ((dso - 45) / 45) * 100,
      status: dso <= 60 ? 'good' as const : 'warning' as const,
      trend: 'down' as const,
      unit: 'days' as const
    },
    {
      id: 'dpo',
      name: 'Days Payable Outstanding',
      value: dpo,
      target: 38,
      variance: ((dpo - 38) / 38) * 100,
      status: dpo >= 30 ? 'good' as const : 'warning' as const,
      trend: 'up' as const,
      unit: 'days' as const
    },
    {
      id: 'asset-turnover',
      name: 'Asset Turnover',
      value: assetTurnover,
      target: 1.2,
      variance: ((assetTurnover - 1.2) / 1.2) * 100,
      status: assetTurnover >= 1.0 ? 'good' as const : 'warning' as const,
      trend: 'up' as const,
      unit: 'ratio' as const
    },
    {
      id: 'roa',
      name: 'Return on Assets %',
      value: roa,
      target: 12,
      variance: roa - 12,
      status: roa >= 10 ? 'good' as const : 'warning' as const,
      trend: 'up' as const,
      unit: 'percentage' as const
    }
  ];

  return {
    revenueKPIs,
    profitabilityKPIs,
    liquidityKPIs,
    efficiencyKPIs,
    allKPIs: [...revenueKPIs, ...profitabilityKPIs, ...liquidityKPIs, ...efficiencyKPIs]
  };
};

// Convert budget data to line items for Budget Management module

/** Normalize COA account_type (Income/Expense/revenue/etc.) → income | expense | other */
export function normalizeFpaAccountType(raw: unknown, accountName = ''): 'income' | 'expense' | 'other' {
  const t = String(raw || '').toLowerCase().trim();
  const name = String(accountName || '').toLowerCase();
  if (
    t.includes('expense') || t.includes('cost') || t === 'cogs' || t.includes('opex') ||
    t.includes('operating expense')
  ) {
    return 'expense';
  }
  if (t.includes('income') || t.includes('revenue')) return 'income';
  if (/cost|expense|salary|salaries|cloud|infra|marketing|admin|overhead|payroll|depreciation|interest|staff|cogs|opex/i.test(name)) {
    return 'expense';
  }
  if (/revenue|income|sales|license|service|subscri|maintenance/i.test(name)) return 'income';
  return 'other';
}

export const convertBudgetToLineItems = (budgetData: any) => {
  if (!budgetData) return [];

  // â”€â”€ Fast path: use real uploaded lineItems when available â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // These are stored by BudgetManagement.handleFileUpload or master upload.
  if (budgetData.lineItems && Array.isArray(budgetData.lineItems) && budgetData.lineItems.length > 0) {
    return budgetData.lineItems.map((item: any, idx: number) => {
      let monthly: Record<(typeof BUDGET_MONTH_KEYS)[number], number> = {
        jan: 0, feb: 0, mar: 0, apr: 0, may: 0, jun: 0, jul: 0, aug: 0, sep: 0, oct: 0, nov: 0, dec: 0,
      };
      if (item.monthly && typeof item.monthly === 'object') {
        monthly = { ...monthly, ...item.monthly };
      } else if (Array.isArray(item.monthlyBudgets) && item.monthlyBudgets.length === 12) {
        BUDGET_MONTH_KEYS.forEach((k, i) => {
          monthly[k] = Number(item.monthlyBudgets[i]) || 0;
        });
      } else {
        const annual = Number(item.budget || item.annual_budget || 0);
        BUDGET_MONTH_KEYS.forEach((k) => {
          monthly[k] = annual / 12;
        });
      }
      monthly = { ...forwardFillMonthlyBudget(monthly) };

      let monthlyActuals: Record<string, number> | undefined;
      if (item.monthlyActuals && typeof item.monthlyActuals === 'object' && !Array.isArray(item.monthlyActuals)) {
        monthlyActuals = {
          jan: 0, feb: 0, mar: 0, apr: 0, may: 0, jun: 0, jul: 0, aug: 0, sep: 0, oct: 0, nov: 0, dec: 0,
        };
        BUDGET_MONTH_KEYS.forEach((k) => {
          monthlyActuals![k] = Number(item.monthlyActuals[k]) || 0;
        });
      } else if (Array.isArray(item.monthlyActuals) && item.monthlyActuals.length === 12) {
        monthlyActuals = {
          jan: 0, feb: 0, mar: 0, apr: 0, may: 0, jun: 0, jul: 0, aug: 0, sep: 0, oct: 0, nov: 0, dec: 0,
        };
        BUDGET_MONTH_KEYS.forEach((k, i) => {
          monthlyActuals![k] = Number(item.monthlyActuals[i]) || 0;
        });
      }

      const rawName = String(item.account || item.account_name || item.category || item.lineItem || `Item ${idx + 1}`);
      const normalizedType = normalizeFpaAccountType(item.accountType || item.account_type, rawName);
      const section = getBudgetSection(normalizedType, rawName);
      const sectionLabel =
        section === 'REVENUE' ? 'Revenue' : section === 'COGS' ? 'Cost of Goods Sold' : section === 'EXPENSE' ? 'Operating Expenses' : 'Other';
      const annualBudget = BUDGET_MONTH_KEYS.reduce((s, k) => s + (Number(monthly[k]) || 0), 0);
      const priorYear = Number(item.priorYearActual || item.fy_prior_actual || 0) || 0;

      return {
        id: `budget-item-${idx}`,
        category: sectionLabel,
        lineItem: rawName,
        department: inferBudgetDepartment(rawName, item.category, item.department),
        owner: String(item.owner || 'CFO'),
        monthly,
        monthlyActuals,
        fy2025Budget: annualBudget,
        fy2024Actual: priorYear,
        accountType: normalizedType,
        variance: 0,
        variancePct: 0,
        status: 'On Track' as const,
        isEditable: true,
        isHeader: false,
        priorYearActual: priorYear,
        indent: 0,
      };
    });
  }

  const budget = budgetData;
  const totalRevenue = Number(budget.totalRevenue || 0) || 0;
  // Some client TBs provide only totalRevenue; split conservatively so Budget Management still works.
  const hasRevenueBreakdown =
    Number(budget.domesticRevenue || 0) > 0 ||
    Number(budget.exportRevenue || 0) > 0 ||
    Number(budget.serviceRevenue || 0) > 0;
  const domesticRevenue = hasRevenueBreakdown
    ? Number(budget.domesticRevenue || 0)
    : totalRevenue > 0
      ? totalRevenue * 0.7
      : 0;
  const exportRevenue = hasRevenueBreakdown
    ? Number(budget.exportRevenue || 0)
    : totalRevenue > 0
      ? totalRevenue * 0.2
      : 0;
  const serviceRevenue = hasRevenueBreakdown
    ? Number(budget.serviceRevenue || 0)
    : totalRevenue > 0
      ? totalRevenue * 0.1
      : 0;
  
  // Helper to generate monthly breakdown from annual total
  const generateMonthly = (annual: number) => {
    const monthly = (annual && !isNaN(annual)) ? annual / 12 : 0;
    return {
      jan: monthly,
      feb: monthly,
      mar: monthly,
      apr: monthly,
      may: monthly,
      jun: monthly,
      jul: monthly,
      aug: monthly,
      sep: monthly,
      oct: monthly,
      nov: monthly,
      dec: monthly
    };
  };

  const lineItems = [
    // Revenue Items
    {
      id: 'revenue-domestic',
      category: 'Revenue' as const,
      lineItem: 'Domestic Revenue',
      department: 'Sales',
      monthly: generateMonthly(domesticRevenue),
      fy2025Budget: domesticRevenue,
      fy2024Actual: domesticRevenue * 0.92,
      variance: 0,
      variancePct: 0,
      status: 'On Track' as const,
      isEditable: true
    },
    {
      id: 'revenue-export',
      category: 'Revenue' as const,
      lineItem: 'Export Revenue',
      department: 'Sales',
      monthly: generateMonthly(exportRevenue),
      fy2025Budget: exportRevenue,
      fy2024Actual: exportRevenue * 0.88,
      variance: 0,
      variancePct: 0,
      status: 'On Track' as const,
      isEditable: true
    },
    {
      id: 'revenue-service',
      category: 'Revenue' as const,
      lineItem: 'Service Revenue',
      department: 'Sales',
      monthly: generateMonthly(serviceRevenue),
      fy2025Budget: serviceRevenue,
      fy2024Actual: serviceRevenue * 0.85,
      variance: 0,
      variancePct: 0,
      status: 'On Track' as const,
      isEditable: true
    },
    // Expense Items
    {
      id: 'expense-cogs',
      category: 'Cost of Sales' as const,
      lineItem: 'Cost of Goods Sold',
      department: 'Operations',
      monthly: generateMonthly(budget.costOfGoodsSold || 0),
      fy2025Budget: budget.costOfGoodsSold || 0,
      fy2024Actual: (budget.costOfGoodsSold || 0) * 0.94,
      variance: 0,
      variancePct: 0,
      status: 'On Track' as const,
      isEditable: true
    },
    {
      id: 'expense-payroll',
      category: 'Operating Expenses' as const,
      lineItem: 'Payroll & Benefits (HR)',
      department: 'HR',
      monthly: generateMonthly((budget.hrCosts || 0) > 0 ? (budget.hrCosts || 0) : (budget.payroll || 0)),
      fy2025Budget: (budget.hrCosts || 0) > 0 ? (budget.hrCosts || 0) : (budget.payroll || 0),
      fy2024Actual: (((budget.hrCosts || 0) > 0 ? (budget.hrCosts || 0) : (budget.payroll || 0))) * 0.96,
      variance: 0,
      variancePct: 0,
      status: 'On Track' as const,
      isEditable: true
    },
    {
      id: 'expense-admin',
      category: 'Operating Expenses' as const,
      lineItem: 'Administrative Expenses (Finance)',
      department: 'Finance',
      monthly: generateMonthly((budget.financeCosts || 0) > 0 ? (budget.financeCosts || 0) : (budget.adminExpenses || 0)),
      fy2025Budget: (budget.financeCosts || 0) > 0 ? (budget.financeCosts || 0) : (budget.adminExpenses || 0),
      fy2024Actual: (((budget.financeCosts || 0) > 0 ? (budget.financeCosts || 0) : (budget.adminExpenses || 0))) * 0.93,
      variance: 0,
      variancePct: 0,
      status: 'On Track' as const,
      isEditable: true
    },
    {
      id: 'expense-marketing',
      category: 'Operating Expenses' as const,
      lineItem: 'Marketing & Advertising',
      department: 'Marketing',
      monthly: generateMonthly(budget.marketingCosts || 0),
      fy2025Budget: budget.marketingCosts || 0,
      fy2024Actual: (budget.marketingCosts || 0) * 0.89,
      variance: 0,
      variancePct: 0,
      status: 'On Track' as const,
      isEditable: true
    },
    {
      id: 'expense-distribution',
      category: 'Operating Expenses' as const,
      lineItem: 'Distribution & Logistics',
      department: 'Operations',
      monthly: generateMonthly(budget.distributionCosts || 0),
      fy2025Budget: budget.distributionCosts || 0,
      fy2024Actual: (budget.distributionCosts || 0) * 0.91,
      variance: 0,
      variancePct: 0,
      status: 'On Track' as const,
      isEditable: true
    },
    {
      id: 'expense-rent',
      category: 'Operating Expenses' as const,
      lineItem: 'Rent & Facilities',
      department: 'Operations',
      monthly: generateMonthly(budget.rentExpense || 0),
      fy2025Budget: budget.rentExpense || 0,
      fy2024Actual: (budget.rentExpense || 0) * 0.98,
      variance: 0,
      variancePct: 0,
      status: 'On Track' as const,
      isEditable: true
    },
    {
      id: 'expense-depreciation',
      category: 'Operating Expenses' as const,
      lineItem: 'Depreciation & Amortization',
      department: 'Finance',
      monthly: generateMonthly(budget.depreciation || 0),
      fy2025Budget: budget.depreciation || 0,
      fy2024Actual: (budget.depreciation || 0) * 0.95,
      variance: 0,
      variancePct: 0,
      status: 'On Track' as const,
      isEditable: true
    }
  ];

  return lineItems.map((item) => ({
    isHeader: false,
    ...item,
  }));
};

// Generate forecast data from actual, budget, and monthly revenue data
export const generateForecastFromReal = (actualData: any, budgetData: any, monthlyData: any) => {
  if (!actualData || !budgetData) return { revenue: [], expenses: [] };

  const budget = budgetData;
  const actual = actualData;
  const MONTH_KEYS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const months    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // â”€â”€ Extract real monthly actuals from lineItems if available â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Check actual lineItems for monthly arrays
  const getMonthlyArray = (data: any, type: 'actual' | 'budget'): number[] => {
    if (!data?.lineItems?.length) return new Array(12).fill(0);
    const incomeItems = data.lineItems.filter((r: any) => {
      const accType = String(r.accountType || r.account_type || '').toLowerCase();
      const name = String(r.account || r.account_name || r.category || '').toLowerCase();
      return accType === 'income' || accType === 'revenue'
        || (/^(total\s+)?(revenue|income|sales|license|service|subscri|maintenance)/i.test(name)
            && !/cost|expense|salary/i.test(name));
    });
    const monthly = new Array(12).fill(0);
    incomeItems.forEach((item: any) => {
      const arr = type === 'actual'
        ? (item.monthlyActuals || (item.monthly && Object.values(item.monthly)))
        : (item.monthlyBudgets || (item.monthly && Object.values(item.monthly)));
      if (arr && arr.length === 12) {
        arr.forEach((v: any, i: number) => { monthly[i] += Number(v) || 0; });
      }
    });
    return monthly;
  };

  const monthlyActuals = getMonthlyArray(actual, 'actual');
  const monthlyBudgets = getMonthlyArray(budget, 'budget');

  // Detect how many months have real actuals (non-zero)
  const lastActualIdx = monthlyActuals.reduce((last, v, i) => (v > 0 ? i : last), -1);
  const numActualMonths = lastActualIdx + 1 || 10; // default Oct = 10 months

  // Linear regression on actuals to forecast remaining months
  const actualValues = monthlyActuals.slice(0, numActualMonths).filter(v => v > 0);
  let growthRate = 0.02; // 2% monthly default
  if (actualValues.length >= 3) {
    const n = actualValues.length;
    const avgX = (n - 1) / 2;
    const avgY = actualValues.reduce((s, v) => s + v, 0) / n;
    const slope = actualValues.reduce((s, v, i) => s + (i - avgX) * (v - avgY), 0)
      / actualValues.reduce((s, _, i) => s + Math.pow(i - avgX, 2), 0);
    growthRate = avgY > 0 ? slope / avgY : 0.02;
    growthRate = Math.max(-0.05, Math.min(0.15, growthRate)); // clamp to Â±15% monthly
  }

  const lastActualVal = actualValues[actualValues.length - 1] || (actual.totalRevenue || 0) / 12;
  const fallbackBudgetMonthly = (budget.totalRevenue || actual.totalRevenue || 0) / 12;

  // Revenue Forecast
  const revenueForecast = months.map((month, idx) => {
    const isActual = idx < numActualMonths && monthlyActuals[idx] > 0;
    const hasMonthlyData = monthlyActuals.some(v => v > 0);

    let actualRevenue: number;
    let forecastRevenue: number;

    if (isActual && hasMonthlyData) {
      actualRevenue  = monthlyActuals[idx];
      forecastRevenue = actualRevenue;
    } else if (hasMonthlyData) {
      // Project from last actual using growth rate
      const monthsAhead = idx - lastActualIdx;
      actualRevenue  = 0;
      forecastRevenue = lastActualVal * Math.pow(1 + growthRate, monthsAhead);
    } else {
      // No monthly data â€” use annual total spread
      actualRevenue  = isActual ? (actual.totalRevenue || 0) / 12 : 0;
      forecastRevenue = isActual ? actualRevenue : ((actual.totalRevenue || 0) / 12) * 1.05;
    }

    const budgetMonthly = (monthlyBudgets[idx] > 0 ? monthlyBudgets[idx] : fallbackBudgetMonthly);
    const lastYearMonthly = budgetMonthly * 0.90;
    const variance = forecastRevenue - budgetMonthly;
    const variancePct = budgetMonthly > 0 ? (variance / budgetMonthly) * 100 : 0;
    const varianceVsLY = lastYearMonthly > 0 ? ((forecastRevenue - lastYearMonthly) / lastYearMonthly) * 100 : 0;

    return {
      month: `${month} 26`,
      actual: isActual ? Math.round(actualRevenue) : null,
      forecast: Math.round(forecastRevenue),
      budget: Math.round(budgetMonthly),
      lastYear: Math.round(lastYearMonthly),
      variance_vs_budget: variancePct,
      variance_vs_ly: varianceVsLY,
      isActual,
      confidence: isActual ? 100 : Math.max(60, 90 - (idx - lastActualIdx) * 5),
      method: isActual ? 'Actual' : (idx === lastActualIdx + 1 ? 'AI Forecast' : 'Trend'),
    };
  });

  // Expense Forecast â€” BUG 3 FIX: Use same growth rate as revenue so expenses are projected consistently (avoid 93% margin)
  const totalBudgetExpenses =
    (budget.costOfGoodsSold || 0) + (budget.payroll || 0) + (budget.adminExpenses || 0) +
    (budget.marketingCosts || 0) + (budget.distributionCosts || 0) + (budget.rentExpense || 0) + (budget.depreciation || 0);
  const totalActualExpenses =
    (actualData.costOfGoodsSold || 0) + (actualData.payroll || 0) + (actualData.adminExpenses || 0) +
    (actualData.marketingCosts || 0) + (actualData.distributionCosts || 0) + (actualData.rentExpense || 0) + (actualData.depreciation || 0);
  const expenseGrowthRate = totalBudgetExpenses !== 0
    ? (totalActualExpenses - totalBudgetExpenses) / totalBudgetExpenses
    : 0.05;

  const expenseCategories = [
    { name: 'Cost of Goods Sold', actual: actualData.costOfGoodsSold, budget: budget.costOfGoodsSold },
    { name: 'Payroll & Benefits', actual: actualData.payroll, budget: budget.payroll },
    { name: 'Administrative Expenses', actual: actualData.adminExpenses, budget: budget.adminExpenses },
    { name: 'Marketing & Advertising', actual: actualData.marketingCosts, budget: budget.marketingCosts },
    { name: 'Distribution & Logistics', actual: actualData.distributionCosts, budget: budget.distributionCosts },
    { name: 'Rent & Facilities', actual: actualData.rentExpense, budget: budget.rentExpense },
    { name: 'Depreciation', actual: actualData.depreciation, budget: budget.depreciation }
  ];

  const expenseForecast = expenseCategories.map(cat => {
    const budgetExpenses = cat.budget || 0;
    const forecastExpenses = budgetExpenses * (1 + expenseGrowthRate);
    const variance = forecastExpenses - budgetExpenses;
    const variancePct = budgetExpenses > 0 ? (variance / budgetExpenses) * 100 : 0;

    return {
      category: cat.name,
      fy25Actual: cat.actual || 0,
      fy26: Math.round(forecastExpenses),
      budget: budgetExpenses,
      variance: Math.round(variance),
      variancePct,
      status: Math.abs(variancePct) > 10 ? 'warning' : 'on-track'
    };
  });

  return {
    revenue: revenueForecast,
    expenses: expenseForecast
  };
};

// Generate board pack sections from real data
export const generateBoardPackSections = (actualData: any, budgetData: any) => {
  if (!actualData || !budgetData) return [];

  const actual = actualData;
  const budget = budgetData;

  const grossProfit = (actual.totalRevenue || 0) - (actual.costOfGoodsSold || 0);
  const grossMargin = actual.totalRevenue > 0 ? (grossProfit / actual.totalRevenue) * 100 : 0;
  const netProfit = grossProfit - (actual.totalOperatingExpenses || 0);
  const netMargin = actual.totalRevenue > 0 ? (netProfit / actual.totalRevenue) * 100 : 0;
  const ebitda = netProfit + (actual.depreciation || 0) + (actual.interestExpense || 0);

  const budgetGrossProfit = (budget.totalRevenue || 0) - (budget.costOfGoodsSold || 0);
  const budgetNetProfit = budgetGrossProfit - (budget.totalOperatingExpenses || 0);

  const revenueVariance = ((actual.totalRevenue || 0) - (budget.totalRevenue || 0)) / (budget.totalRevenue || 1) * 100;
  const profitVariance = (netProfit - budgetNetProfit) / Math.abs(budgetNetProfit || 1) * 100;

  const sections = [
    {
      id: 'exec-summary',
      title: 'Executive Summary',
      order: 1,
      included: true,
      approved: true,
      metrics: [
        {
          label: 'Revenue',
          value: `â‚¹${((actual.totalRevenue || 0) / 10000000).toFixed(1)}Cr`,
          change: `${revenueVariance >= 0 ? '+' : ''}${revenueVariance.toFixed(1)}%`,
          status: revenueVariance >= 0 ? 'positive' : 'negative'
        },
        {
          label: 'EBITDA',
          value: `â‚¹${(ebitda / 10000000).toFixed(1)}Cr`,
          change: `Margin: ${(ebitda / (actual.totalRevenue || 1) * 100).toFixed(1)}%`,
          status: 'positive'
        },
        {
          label: 'Net Profit',
          value: `â‚¹${(netProfit / 10000000).toFixed(1)}Cr`,
          change: `${profitVariance >= 0 ? '+' : ''}${profitVariance.toFixed(1)}%`,
          status: profitVariance >= 0 ? 'positive' : 'negative'
        },
        {
          label: 'Cash Position',
          value: `â‚¹${((actual.cashAndEquivalents || 0) / 10000000).toFixed(1)}Cr`,
          change: 'Strong liquidity',
          status: 'positive'
        }
      ]
    },
    {
      id: 'financial-summary',
      title: 'Financial Highlights',
      order: 2,
      included: true,
      approved: false,
      metrics: [
        {
          label: 'Total Revenue',
          value: `â‚¹${((actual.totalRevenue || 0) / 10000000).toFixed(2)}Cr`,
          change: `vs Budget: ${revenueVariance >= 0 ? '+' : ''}${revenueVariance.toFixed(1)}%`,
          status: revenueVariance >= 0 ? 'positive' : 'negative'
        },
        {
          label: 'Gross Profit',
          value: `â‚¹${(grossProfit / 10000000).toFixed(2)}Cr`,
          change: `Margin: ${grossMargin.toFixed(1)}%`,
          status: 'positive'
        },
        {
          label: 'Operating Expenses',
          value: `â‚¹${((actual.totalOperatingExpenses || 0) / 10000000).toFixed(2)}Cr`,
          change: `${((actual.totalOperatingExpenses || 0) / (actual.totalRevenue || 1) * 100).toFixed(1)}% of Revenue`,
          status: 'neutral'
        },
        {
          label: 'Net Margin',
          value: `${netMargin.toFixed(1)}%`,
          change: `vs Budget: ${(netMargin - (budgetNetProfit / (budget.totalRevenue || 1) * 100)).toFixed(1)}pp`,
          status: netMargin >= 10 ? 'positive' : 'warning'
        }
      ]
    },
    {
      id: 'variance-analysis',
      title: 'Variance Analysis',
      order: 3,
      included: true,
      approved: false,
      metrics: [
        {
          label: 'Revenue Variance',
          value: `â‚¹${(((actual.totalRevenue || 0) - (budget.totalRevenue || 0)) / 10000000).toFixed(2)}Cr`,
          change: `${revenueVariance >= 0 ? '+' : ''}${revenueVariance.toFixed(1)}%`,
          status: revenueVariance >= 0 ? 'positive' : 'negative'
        },
        {
          label: 'COGS Variance',
          value: `â‚¹${(((actual.costOfGoodsSold || 0) - (budget.costOfGoodsSold || 0)) / 10000000).toFixed(2)}Cr`,
          change: `${(((actual.costOfGoodsSold || 0) - (budget.costOfGoodsSold || 0)) / (budget.costOfGoodsSold || 1) * 100).toFixed(1)}%`,
          status: (actual.costOfGoodsSold || 0) <= (budget.costOfGoodsSold || 0) ? 'positive' : 'negative'
        },
        {
          label: 'OpEx Variance',
          value: `â‚¹${(((actual.totalOperatingExpenses || 0) - (budget.totalOperatingExpenses || 0)) / 10000000).toFixed(2)}Cr`,
          change: `${(((actual.totalOperatingExpenses || 0) - (budget.totalOperatingExpenses || 0)) / (budget.totalOperatingExpenses || 1) * 100).toFixed(1)}%`,
          status: (actual.totalOperatingExpenses || 0) <= (budget.totalOperatingExpenses || 0) ? 'positive' : 'negative'
        }
      ]
    },
    {
      id: 'cash-flow',
      title: 'Cash Flow & Liquidity',
      order: 4,
      included: true,
      approved: false,
      metrics: [
        {
          label: 'Cash & Equivalents',
          value: `â‚¹${((actual.cashAndEquivalents || 0) / 10000000).toFixed(2)}Cr`,
          change: 'Strong position',
          status: 'positive'
        },
        {
          label: 'Accounts Receivable',
          value: `â‚¹${((actual.accountsReceivable || 0) / 10000000).toFixed(2)}Cr`,
          change: `DSO: ${((actual.accountsReceivable || 0) / ((actual.totalRevenue || 1) / 365)).toFixed(0)} days`,
          status: 'neutral'
        },
        {
          label: 'Accounts Payable',
          value: `â‚¹${((actual.accountsPayable || 0) / 10000000).toFixed(2)}Cr`,
          change: `DPO: ${((actual.accountsPayable || 0) / ((actual.costOfGoodsSold || 1) / 365)).toFixed(0)} days`,
          status: 'neutral'
        },
        {
          label: 'Working Capital',
          value: `â‚¹${(((actual.cashAndEquivalents || 0) + (actual.accountsReceivable || 0) + (actual.inventory || 0) - (actual.accountsPayable || 0)) / 10000000).toFixed(2)}Cr`,
          change: 'Adequate',
          status: 'positive'
        }
      ]
    },
    {
      id: 'operational-kpis',
      title: 'Operational KPIs',
      order: 5,
      included: true,
      approved: false,
      metrics: [
        {
          label: 'Gross Margin %',
          value: `${grossMargin.toFixed(1)}%`,
          change: 'Target: 50%',
          status: grossMargin >= 50 ? 'positive' : 'warning'
        },
        {
          label: 'EBITDA Margin %',
          value: `${(ebitda / (actual.totalRevenue || 1) * 100).toFixed(1)}%`,
          change: 'Target: 20%',
          status: (ebitda / (actual.totalRevenue || 1) * 100) >= 20 ? 'positive' : 'warning'
        },
        {
          label: 'Net Margin %',
          value: `${netMargin.toFixed(1)}%`,
          change: 'Target: 15%',
          status: netMargin >= 15 ? 'positive' : 'warning'
        },
        {
          label: 'ROA %',
          value: `${((actual.totalAssets || 0) > 0 ? (netProfit / actual.totalAssets * 100) : 0).toFixed(1)}%`,
          change: 'Target: 12%',
          status: ((actual.totalAssets || 0) > 0 ? (netProfit / actual.totalAssets * 100) : 0) >= 12 ? 'positive' : 'warning'
        }
      ]
    }
  ];

  return sections;
};

// Keys that loaders also check (e.g. UploadData uses finreport_*)
const DATA_KEY_ALIASES: Record<string, string[]> = {
  'fpa_actual': ['fpa_actual', 'fpa_actual_tb', 'finreport_fpa_actuals'],
  'fpa_budget': ['fpa_budget', 'fpa_budget_tb', 'finreport_fpa_budget'],
  'fpa_forecast': ['fpa_forecast', 'fpa_forecast_data'],
};

function hasDataForKey(key: string): boolean {
  const aliases = DATA_KEY_ALIASES[key];
  if (aliases) {
    return aliases.some(k => !!localStorage.getItem(k));
  }
  return !!localStorage.getItem(key);
}

export const checkDataAvailability = (required: string[]) => {
  const missing: string[] = [];
  required.forEach(key => {
    if (!hasDataForKey(key)) missing.push(key);
  });
  return {
    available: missing.length === 0,
    missing
  };
};

// Format missing data message
export const getMissingDataMessage = (missing: string[]) => {
  const labels: Record<string, string> = {
    'fpa_actual': 'Actual Trial Balance',
    'fpa_budget': 'Budget Trial Balance',
    'fpa_prior_year': 'Prior Year Trial Balance',
    'fpa_forecast': 'Forecast Data',
    'fpa_departments': 'Department Expenses',
    'fpa_scenarios': 'Scenario Planning Data'
  };

  const missingLabels = missing.map(key => labels[key] || key);
  
  if (missingLabels.length === 1) {
    return `Upload ${missingLabels[0]} to see this analysis`;
  }
  
  return `Upload ${missingLabels.join(' and ')} to see this analysis`;
};

/** True when localStorage has non-zero FP&A line items or totals. */
export function hasFpaLineData(): boolean {
  const actual = loadFPAActual();
  const budget = loadFPABudget();
  const items = actual?.lineItems || budget?.lineItems || [];
  if (Array.isArray(items) && items.length > 0) {
    return items.some(
      (i: any) => Number(i.actual || 0) !== 0 || Number(i.budget || 0) !== 0
    );
  }
  const rev = Number(actual?.totalRevenue || budget?.totalRevenue || 0);
  const exp = Number(actual?.totalExpenses || budget?.totalExpenses || 0);
  return rev !== 0 || exp !== 0;
}

/** Dispatched after a successful master upload + localStorage sync. */
export const FPA_MASTER_UPDATED_EVENT = 'fpa-master-updated';

const FPA_MASTER_JUNK_NAMES = new Set([
  'section',
  'pl',
  'bs',
  'hc',
  'arr',
  'module',
  'modules',
  'description',
  'instructions',
]);

/** Rows from template/instruction sheets (not real accounts). */
export function isFpaMasterJunkRow(r: any): boolean {
  const name = String(r.account_name || r.account || '').trim().toLowerCase();
  if (!name) return true;
  return FPA_MASTER_JUNK_NAMES.has(name);
}

export function hasFpaMasterAmounts(r: any): boolean {
  const act = Number(r.annual_actual || 0);
  const bud = Number(r.annual_budget || 0);
  const ma: any[] = r.monthly_actuals || [];
  const mb: any[] = r.monthly_budgets || [];
  if (act !== 0 || bud !== 0) return true;
  if (ma.some((v) => Number(v) !== 0)) return true;
  if (mb.some((v) => Number(v) !== 0)) return true;
  return false;
}

/** PL rows with real budget/actual values (excludes template label rows). */
export function filterUsablePlRows(rows: any[]): any[] {
  return rows.filter((r) => !isFpaMasterJunkRow(r) && hasFpaMasterAmounts(r));
}

export function buildFpaStorageFromPlRows(
  rows: any[],
  options?: { currency?: string; fileName?: string }
) {
  const usable = filterUsablePlRows(rows);
  const source = usable.length > 0 ? usable : rows.filter((r) => !isFpaMasterJunkRow(r));
  const lineItems = source.map((r: any) => ({
    account: r.account_name,
    category: r.account_name,
    budget: Number(r.annual_budget || 0),
    actual: Number(r.annual_actual || 0),
    monthly: (() => {
      const o: Record<string, number> = {};
      FPA_MONTH_KEYS.forEach((k, i) => {
        o[k] = Number(r.monthly_budgets?.[i] || 0);
      });
      return forwardFillMonthlyBudget(o);
    })(),
    monthlyActuals: (() => {
      const o: Record<string, number> = {};
      FPA_MONTH_KEYS.forEach((k, i) => {
        o[k] = Number(r.monthly_actuals?.[i] || 0);
      });
      return o;
    })(),
    monthlyBudgets: r.monthly_budgets || [],
    accountType: normalizeFpaAccountType(r.account_type, r.account_name),
    department: inferBudgetDepartment(r.account_name || '', r.category, r.department),
    owner: r.owner || 'CFO',
    priorYearActual: Number(r.fy_prior_actual || 0),
    opening_cash: Number(r.opening_cash || 0),
  }));

  const totalRevAct = lineItems
    .filter((r: any) => r.accountType === 'income')
    .reduce((s: number, r: any) => s + r.actual, 0);
  const totalExpAct = lineItems
    .filter((r: any) => r.accountType === 'expense')
    .reduce((s: number, r: any) => s + r.actual, 0);
  const totalRevBud = lineItems
    .filter((r: any) => r.accountType === 'income')
    .reduce((s: number, r: any) => s + r.budget, 0);
  const totalExpBud = lineItems
    .filter((r: any) => r.accountType === 'expense')
    .reduce((s: number, r: any) => s + r.budget, 0);
  const openingCash = source.find((r: any) => Number(r.opening_cash || 0) > 0)?.opening_cash || 0;

  const actualPayload = {
    totalRevenue: totalRevAct,
    totalExpenses: totalExpAct,
    netProfit: totalRevAct - totalExpAct,
    ebitda: (totalRevAct - totalExpAct) * 1.15,
    cashAndEquivalents: openingCash,
    rowCount: source.length,
    lineItems,
    uploadedAt: new Date().toISOString(),
  };
  const budgetPayload = {
    totalRevenue: totalRevBud,
    totalExpenses: totalExpBud,
    netProfit: totalRevBud - totalExpBud,
    ebitda: (totalRevBud - totalExpBud) * 1.15,
    cashAndEquivalents: openingCash,
    rowCount: source.length,
    lineItems,
    uploadedAt: new Date().toISOString(),
  };
  const scenarioPayload = {
    totalRevenue: totalRevAct,
    domesticRevenue: totalRevAct * 0.7,
    exportRevenue: totalRevAct * 0.2,
    serviceRevenue: totalRevAct * 0.1,
    costOfGoodsSold:
      lineItems
        .filter((r: any) => /cogs|cost.of.rev/i.test(r.account))
        .reduce((s: number, r: any) => s + r.actual, 0) || totalExpAct * 0.35,
    payroll:
      lineItems
        .filter((r: any) => /salary|payroll|staff/i.test(r.account))
        .reduce((s: number, r: any) => s + r.actual, 0) || totalExpAct * 0.4,
    adminExpenses:
      lineItems
        .filter((r: any) => /admin|overhead/i.test(r.account))
        .reduce((s: number, r: any) => s + r.actual, 0) || totalExpAct * 0.1,
    distributionCosts: 0,
    marketingCosts:
      lineItems
        .filter((r: any) => /marketing/i.test(r.account))
        .reduce((s: number, r: any) => s + r.actual, 0) || totalExpAct * 0.08,
    rentExpense: 0,
    depreciation: 0,
    interestExpense: 0,
    otherExpenses: 0,
    totalOperatingExpenses: totalExpAct,
    cashAndEquivalents: openingCash,
    totalCurrentAssets: openingCash * 2.5,
    totalAssets: openingCash * 5,
    totalCurrentLiabilities: totalExpAct * 0.15,
    totalLiabilities: totalExpAct * 0.3,
    totalEquity: openingCash * 3,
    fileName: options?.fileName || 'master_upload',
    uploadedAt: new Date().toISOString(),
  };

  const currencies = [...new Set(source.map((r: any) => String(r.currency || '').toUpperCase()).filter(Boolean))];
  const currency =
    options?.currency ||
    (currencies.includes('AED') ? 'AED' : currencies.includes('INR') ? 'INR' : currencies[0] || 'AED');

  return { actualPayload, budgetPayload, scenarioPayload, currency };
}

export function persistFpaMasterPayloads(payloads: {
  actualPayload: any;
  budgetPayload: any;
  scenarioPayload: any;
  currency: string;
}) {
  const { actualPayload, budgetPayload, scenarioPayload, currency } = payloads;
  localStorage.setItem('fpa_actual', JSON.stringify(actualPayload));
  localStorage.setItem('fpa_actual_tb', JSON.stringify(actualPayload));
  localStorage.setItem('fpa_budget', JSON.stringify(budgetPayload));
  localStorage.setItem('fpa_budget_tb', JSON.stringify(budgetPayload));
  localStorage.setItem('finreportai_fpa_data', JSON.stringify(scenarioPayload));
  localStorage.setItem('fpa_currency', currency);
  if (currency === 'INR') {
    localStorage.setItem('fpa_india_actual', JSON.stringify(actualPayload));
    localStorage.setItem('fpa_india_budget', JSON.stringify(budgetPayload));
  }
}

/** Pull master PL rows from API → localStorage (shared by hub + all FP&A modules). */
export async function syncFpaMasterFromApi(companyId: string): Promise<{
  ok: boolean;
  rowCount: number;
  usableRowCount: number;
  message: string;
}> {
  const base = backendOrigin();
  if (!base) {
    return { ok: false, rowCount: 0, usableRowCount: 0, message: 'Backend API not configured' };
  }
  if (!companyId) {
    return { ok: false, rowCount: 0, usableRowCount: 0, message: 'company_id is required — select an AP company' };
  }
  try {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
    const { workspaceHeaders } = await import('../services/workspaceService');
    const res = await fetch(
      `${base}/api/fpa/master-data?section=PL&company_id=${encodeURIComponent(companyId)}`,
      { headers: workspaceHeaders(token), credentials: 'include' },
    );
    if (!res.ok) {
      return { ok: false, rowCount: 0, usableRowCount: 0, message: `Master data fetch failed (${res.status})` };
    }
    const pl = await res.json();
    if (!pl.rows?.length) {
      return { ok: false, rowCount: 0, usableRowCount: 0, message: 'No PL rows found — upload master data first' };
    }
    const usable = filterUsablePlRows(pl.rows);
    const built = buildFpaStorageFromPlRows(pl.rows);
    persistFpaMasterPayloads(built);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(FPA_MASTER_UPDATED_EVENT, { detail: { companyId, usableRowCount: usable.length } }));
    }
    if (!usable.length) {
      return {
        ok: false,
        rowCount: pl.rows.length,
        usableRowCount: 0,
        message:
          'Master file uploaded but no rows have budget/actual values. Use account names (Revenue, Salaries…) with Budget & Actual columns.',
      };
    }
    return {
      ok: true,
      rowCount: pl.rows.length,
      usableRowCount: usable.length,
      message: `Synced ${usable.length} variance lines from master upload`,
    };
  } catch (e: any) {
    return { ok: false, rowCount: 0, usableRowCount: 0, message: e?.message || String(e) };
  }
}

