// Helper to load FP&A data from localStorage
// Each module reads only what it needs

export const loadFPAActual = () => {
  const stored = localStorage.getItem('fpa_actual');
  return stored ? JSON.parse(stored) : null;
};

export const loadFPABudget = () => {
  const stored = localStorage.getItem('fpa_budget');
  return stored ? JSON.parse(stored) : null;
};

export const loadFPAPriorYear = () => {
  const stored = localStorage.getItem('fpa_prior_year');
  return stored ? JSON.parse(stored) : null;
};

export const loadFPAForecast = () => {
  const stored = localStorage.getItem('fpa_forecast');
  return stored ? JSON.parse(stored) : null;
};

export const loadFPADepartments = () => {
  const stored = localStorage.getItem('fpa_departments');
  return stored ? JSON.parse(stored) : null;
};

export const loadFPAScenarios = () => {
  const stored = localStorage.getItem('fpa_scenarios');
  return stored ? JSON.parse(stored) : null;
};

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

// Convert uploaded financial data to variance analysis format
export const convertToVarianceData = (actualData: any, budgetData: any) => {
  if (!actualData || !budgetData) return [];

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
      budget: budgetData.domesticRevenue || 0,
      variance: (actualData.domesticRevenue || 0) - (budgetData.domesticRevenue || 0),
      variancePct: budgetData.domesticRevenue ? ((actualData.domesticRevenue - budgetData.domesticRevenue) / budgetData.domesticRevenue) * 100 : 0,
      ytdActual: (actualData.domesticRevenue || 0) * 10, // Assuming Oct = 10 months
      ytdBudget: (budgetData.domesticRevenue || 0) * 10,
      ytdVariance: ((actualData.domesticRevenue || 0) - (budgetData.domesticRevenue || 0)) * 10,
      ytdVariancePct: budgetData.domesticRevenue ? ((actualData.domesticRevenue - budgetData.domesticRevenue) / budgetData.domesticRevenue) * 100 : 0,
      favorable: (actualData.domesticRevenue || 0) > (budgetData.domesticRevenue || 0),
      threshold: Math.abs(budgetData.domesticRevenue ? ((actualData.domesticRevenue - budgetData.domesticRevenue) / budgetData.domesticRevenue) * 100 : 0) > 10 ? 'critical' as const : Math.abs(budgetData.domesticRevenue ? ((actualData.domesticRevenue - budgetData.domesticRevenue) / budgetData.domesticRevenue) * 100 : 0) > 5 ? 'warning' as const : 'ok' as const
    },
    {
      id: 'export-revenue',
      category: 'Export Revenue',
      isHeader: false,
      actual: actualData.exportRevenue || 0,
      budget: budgetData.exportRevenue || 0,
      variance: (actualData.exportRevenue || 0) - (budgetData.exportRevenue || 0),
      variancePct: budgetData.exportRevenue ? ((actualData.exportRevenue - budgetData.exportRevenue) / budgetData.exportRevenue) * 100 : 0,
      ytdActual: (actualData.exportRevenue || 0) * 10,
      ytdBudget: (budgetData.exportRevenue || 0) * 10,
      ytdVariance: ((actualData.exportRevenue || 0) - (budgetData.exportRevenue || 0)) * 10,
      ytdVariancePct: budgetData.exportRevenue ? ((actualData.exportRevenue - budgetData.exportRevenue) / budgetData.exportRevenue) * 100 : 0,
      favorable: (actualData.exportRevenue || 0) > (budgetData.exportRevenue || 0),
      threshold: Math.abs(budgetData.exportRevenue ? ((actualData.exportRevenue - budgetData.exportRevenue) / budgetData.exportRevenue) * 100 : 0) > 10 ? 'critical' as const : Math.abs(budgetData.exportRevenue ? ((actualData.exportRevenue - budgetData.exportRevenue) / budgetData.exportRevenue) * 100 : 0) > 5 ? 'warning' as const : 'ok' as const
    },
    {
      id: 'service-revenue',
      category: 'Service Revenue',
      isHeader: false,
      actual: actualData.serviceRevenue || 0,
      budget: budgetData.serviceRevenue || 0,
      variance: (actualData.serviceRevenue || 0) - (budgetData.serviceRevenue || 0),
      variancePct: budgetData.serviceRevenue ? ((actualData.serviceRevenue - budgetData.serviceRevenue) / budgetData.serviceRevenue) * 100 : 0,
      ytdActual: (actualData.serviceRevenue || 0) * 10,
      ytdBudget: (budgetData.serviceRevenue || 0) * 10,
      ytdVariance: ((actualData.serviceRevenue || 0) - (budgetData.serviceRevenue || 0)) * 10,
      ytdVariancePct: budgetData.serviceRevenue ? ((actualData.serviceRevenue - budgetData.serviceRevenue) / budgetData.serviceRevenue) * 100 : 0,
      favorable: (actualData.serviceRevenue || 0) > (budgetData.serviceRevenue || 0),
      threshold: Math.abs(budgetData.serviceRevenue ? ((actualData.serviceRevenue - budgetData.serviceRevenue) / budgetData.serviceRevenue) * 100 : 0) > 10 ? 'critical' as const : Math.abs(budgetData.serviceRevenue ? ((actualData.serviceRevenue - budgetData.serviceRevenue) / budgetData.serviceRevenue) * 100 : 0) > 5 ? 'warning' as const : 'ok' as const
    },
    {
      id: 'total-revenue',
      category: 'Total Revenue',
      isHeader: false,
      actual: actualData.totalRevenue || 0,
      budget: budgetData.totalRevenue || 0,
      variance: (actualData.totalRevenue || 0) - (budgetData.totalRevenue || 0),
      variancePct: budgetData.totalRevenue ? ((actualData.totalRevenue - budgetData.totalRevenue) / budgetData.totalRevenue) * 100 : 0,
      ytdActual: (actualData.totalRevenue || 0) * 10,
      ytdBudget: (budgetData.totalRevenue || 0) * 10,
      ytdVariance: ((actualData.totalRevenue || 0) - (budgetData.totalRevenue || 0)) * 10,
      ytdVariancePct: budgetData.totalRevenue ? ((actualData.totalRevenue - budgetData.totalRevenue) / budgetData.totalRevenue) * 100 : 0,
      favorable: (actualData.totalRevenue || 0) > (budgetData.totalRevenue || 0),
      threshold: Math.abs(budgetData.totalRevenue ? ((actualData.totalRevenue - budgetData.totalRevenue) / budgetData.totalRevenue) * 100 : 0) > 10 ? 'critical' as const : Math.abs(budgetData.totalRevenue ? ((actualData.totalRevenue - budgetData.totalRevenue) / budgetData.totalRevenue) * 100 : 0) > 5 ? 'warning' as const : 'ok' as const
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
      budget: budgetData.costOfGoodsSold || 0,
      variance: (actualData.costOfGoodsSold || 0) - (budgetData.costOfGoodsSold || 0),
      variancePct: budgetData.costOfGoodsSold ? ((actualData.costOfGoodsSold - budgetData.costOfGoodsSold) / budgetData.costOfGoodsSold) * 100 : 0,
      ytdActual: (actualData.costOfGoodsSold || 0) * 10,
      ytdBudget: (budgetData.costOfGoodsSold || 0) * 10,
      ytdVariance: ((actualData.costOfGoodsSold || 0) - (budgetData.costOfGoodsSold || 0)) * 10,
      ytdVariancePct: budgetData.costOfGoodsSold ? ((actualData.costOfGoodsSold - budgetData.costOfGoodsSold) / budgetData.costOfGoodsSold) * 100 : 0,
      favorable: (actualData.costOfGoodsSold || 0) < (budgetData.costOfGoodsSold || 0),
      threshold: Math.abs(budgetData.costOfGoodsSold ? ((actualData.costOfGoodsSold - budgetData.costOfGoodsSold) / budgetData.costOfGoodsSold) * 100 : 0) > 10 ? 'critical' as const : Math.abs(budgetData.costOfGoodsSold ? ((actualData.costOfGoodsSold - budgetData.costOfGoodsSold) / budgetData.costOfGoodsSold) * 100 : 0) > 5 ? 'warning' as const : 'ok' as const
    },
    {
      id: 'payroll',
      category: 'Payroll Expenses',
      isHeader: false,
      actual: actualData.payroll || 0,
      budget: budgetData.payroll || 0,
      variance: (actualData.payroll || 0) - (budgetData.payroll || 0),
      variancePct: budgetData.payroll ? ((actualData.payroll - budgetData.payroll) / budgetData.payroll) * 100 : 0,
      ytdActual: (actualData.payroll || 0) * 10,
      ytdBudget: (budgetData.payroll || 0) * 10,
      ytdVariance: ((actualData.payroll || 0) - (budgetData.payroll || 0)) * 10,
      ytdVariancePct: budgetData.payroll ? ((actualData.payroll - budgetData.payroll) / budgetData.payroll) * 100 : 0,
      favorable: (actualData.payroll || 0) < (budgetData.payroll || 0),
      threshold: Math.abs(budgetData.payroll ? ((actualData.payroll - budgetData.payroll) / budgetData.payroll) * 100 : 0) > 10 ? 'critical' as const : Math.abs(budgetData.payroll ? ((actualData.payroll - budgetData.payroll) / budgetData.payroll) * 100 : 0) > 5 ? 'warning' as const : 'ok' as const
    },
    {
      id: 'admin',
      category: 'Admin Expenses',
      isHeader: false,
      actual: actualData.adminExpenses || 0,
      budget: budgetData.adminExpenses || 0,
      variance: (actualData.adminExpenses || 0) - (budgetData.adminExpenses || 0),
      variancePct: budgetData.adminExpenses ? ((actualData.adminExpenses - budgetData.adminExpenses) / budgetData.adminExpenses) * 100 : 0,
      ytdActual: (actualData.adminExpenses || 0) * 10,
      ytdBudget: (budgetData.adminExpenses || 0) * 10,
      ytdVariance: ((actualData.adminExpenses || 0) - (budgetData.adminExpenses || 0)) * 10,
      ytdVariancePct: budgetData.adminExpenses ? ((actualData.adminExpenses - budgetData.adminExpenses) / budgetData.adminExpenses) * 100 : 0,
      favorable: (actualData.adminExpenses || 0) < (budgetData.adminExpenses || 0),
      threshold: Math.abs(budgetData.adminExpenses ? ((actualData.adminExpenses - budgetData.adminExpenses) / budgetData.adminExpenses) * 100 : 0) > 10 ? 'critical' as const : Math.abs(budgetData.adminExpenses ? ((actualData.adminExpenses - budgetData.adminExpenses) / budgetData.adminExpenses) * 100 : 0) > 5 ? 'warning' as const : 'ok' as const
    },
    {
      id: 'marketing',
      category: 'Marketing Costs',
      isHeader: false,
      actual: actualData.marketingCosts || 0,
      budget: budgetData.marketingCosts || 0,
      variance: (actualData.marketingCosts || 0) - (budgetData.marketingCosts || 0),
      variancePct: budgetData.marketingCosts ? ((actualData.marketingCosts - budgetData.marketingCosts) / budgetData.marketingCosts) * 100 : 0,
      ytdActual: (actualData.marketingCosts || 0) * 10,
      ytdBudget: (budgetData.marketingCosts || 0) * 10,
      ytdVariance: ((actualData.marketingCosts || 0) - (budgetData.marketingCosts || 0)) * 10,
      ytdVariancePct: budgetData.marketingCosts ? ((actualData.marketingCosts - budgetData.marketingCosts) / budgetData.marketingCosts) * 100 : 0,
      favorable: (actualData.marketingCosts || 0) < (budgetData.marketingCosts || 0),
      threshold: Math.abs(budgetData.marketingCosts ? ((actualData.marketingCosts - budgetData.marketingCosts) / budgetData.marketingCosts) * 100 : 0) > 10 ? 'critical' as const : Math.abs(budgetData.marketingCosts ? ((actualData.marketingCosts - budgetData.marketingCosts) / budgetData.marketingCosts) * 100 : 0) > 5 ? 'warning' as const : 'ok' as const
    },
    {
      id: 'rent',
      category: 'Rent & Facilities',
      isHeader: false,
      actual: actualData.rentExpense || 0,
      budget: budgetData.rentExpense || 0,
      variance: (actualData.rentExpense || 0) - (budgetData.rentExpense || 0),
      variancePct: budgetData.rentExpense ? ((actualData.rentExpense - budgetData.rentExpense) / budgetData.rentExpense) * 100 : 0,
      ytdActual: (actualData.rentExpense || 0) * 10,
      ytdBudget: (budgetData.rentExpense || 0) * 10,
      ytdVariance: ((actualData.rentExpense || 0) - (budgetData.rentExpense || 0)) * 10,
      ytdVariancePct: budgetData.rentExpense ? ((actualData.rentExpense - budgetData.rentExpense) / budgetData.rentExpense) * 100 : 0,
      favorable: (actualData.rentExpense || 0) < (budgetData.rentExpense || 0),
      threshold: Math.abs(budgetData.rentExpense ? ((actualData.rentExpense - budgetData.rentExpense) / budgetData.rentExpense) * 100 : 0) > 10 ? 'critical' as const : Math.abs(budgetData.rentExpense ? ((actualData.rentExpense - budgetData.rentExpense) / budgetData.rentExpense) * 100 : 0) > 5 ? 'warning' as const : 'ok' as const
    },
    {
      id: 'depreciation',
      category: 'Depreciation',
      isHeader: false,
      actual: actualData.depreciation || 0,
      budget: budgetData.depreciation || 0,
      variance: (actualData.depreciation || 0) - (budgetData.depreciation || 0),
      variancePct: budgetData.depreciation ? ((actualData.depreciation - budgetData.depreciation) / budgetData.depreciation) * 100 : 0,
      ytdActual: (actualData.depreciation || 0) * 10,
      ytdBudget: (budgetData.depreciation || 0) * 10,
      ytdVariance: ((actualData.depreciation || 0) - (budgetData.depreciation || 0)) * 10,
      ytdVariancePct: budgetData.depreciation ? ((actualData.depreciation - budgetData.depreciation) / budgetData.depreciation) * 100 : 0,
      favorable: (actualData.depreciation || 0) < (budgetData.depreciation || 0),
      threshold: Math.abs(budgetData.depreciation ? ((actualData.depreciation - budgetData.depreciation) / budgetData.depreciation) * 100 : 0) > 10 ? 'critical' as const : Math.abs(budgetData.depreciation ? ((actualData.depreciation - budgetData.depreciation) / budgetData.depreciation) * 100 : 0) > 5 ? 'warning' as const : 'ok' as const
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
  const roe = (actual.equity || 1) > 0 ? (netProfit / (actual.equity || 1)) * 100 : 0;

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
export const convertBudgetToLineItems = (budgetData: any) => {
  if (!budgetData) return [];

  const budget = budgetData;
  
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
      monthly: generateMonthly(budget.domesticRevenue || 0),
      fy2025Budget: budget.domesticRevenue || 0,
      fy2024Actual: (budget.domesticRevenue || 0) * 0.92,
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
      monthly: generateMonthly(budget.exportRevenue || 0),
      fy2025Budget: budget.exportRevenue || 0,
      fy2024Actual: (budget.exportRevenue || 0) * 0.88,
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
      monthly: generateMonthly(budget.serviceRevenue || 0),
      fy2025Budget: budget.serviceRevenue || 0,
      fy2024Actual: (budget.serviceRevenue || 0) * 0.85,
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
      lineItem: 'Payroll & Benefits',
      department: 'HR',
      monthly: generateMonthly(budget.payroll || 0),
      fy2025Budget: budget.payroll || 0,
      fy2024Actual: (budget.payroll || 0) * 0.96,
      variance: 0,
      variancePct: 0,
      status: 'On Track' as const,
      isEditable: true
    },
    {
      id: 'expense-admin',
      category: 'Operating Expenses' as const,
      lineItem: 'Administrative Expenses',
      department: 'Finance',
      monthly: generateMonthly(budget.adminExpenses || 0),
      fy2025Budget: budget.adminExpenses || 0,
      fy2024Actual: (budget.adminExpenses || 0) * 0.93,
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

  return lineItems;
};

// Generate forecast data from actual, budget, and monthly revenue data
export const generateForecastFromReal = (actualData: any, budgetData: any, monthlyData: any) => {
  if (!actualData || !budgetData) return { revenue: [], expenses: [] };

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  // Revenue Forecast
  const revenueForecast = months.map((month, idx) => {
    const isActual = idx < 10; // Oct = index 9, so Jan-Oct are actuals
    
    // If we have monthly revenue data, use it
    let actualRevenue = 0;
    let forecastRevenue = 0;
    
    if (monthlyData && monthlyData.months && monthlyData.months[idx]) {
      actualRevenue = (monthlyData.domesticRevenue[idx] || 0) + 
                     (monthlyData.exportRevenue[idx] || 0) + 
                     (monthlyData.serviceRevenue[idx] || 0);
      forecastRevenue = actualRevenue;
    } else {
      // Estimate monthly from annual
      actualRevenue = (actualData.totalRevenue || 0) / 12;
      // Forecast grows by 8% for future months
      forecastRevenue = isActual ? actualRevenue : actualRevenue * 1.08;
    }
    
    const budgetMonthly = (budgetData.totalRevenue || 0) / 12;
    const lastYearMonthly = budgetMonthly * 0.92; // Estimate 92% of budget as prior year
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
      confidence: isActual ? 100 : (idx < 12 ? 85 - (idx - 9) * 5 : 70),
      method: isActual ? 'Actual' : 'AI Forecast'
    };
  });

  // Expense Forecast
  const expenseCategories = [
    { name: 'Cost of Goods Sold', actual: actualData.costOfGoodsSold, budget: budgetData.costOfGoodsSold },
    { name: 'Payroll & Benefits', actual: actualData.payroll, budget: budgetData.payroll },
    { name: 'Administrative Expenses', actual: actualData.adminExpenses, budget: budgetData.adminExpenses },
    { name: 'Marketing & Advertising', actual: actualData.marketingCosts, budget: budgetData.marketingCosts },
    { name: 'Distribution & Logistics', actual: actualData.distributionCosts, budget: budgetData.distributionCosts },
    { name: 'Rent & Facilities', actual: actualData.rentExpense, budget: budgetData.rentExpense },
    { name: 'Depreciation', actual: actualData.depreciation, budget: budgetData.depreciation }
  ];

  const expenseForecast = expenseCategories.map(cat => {
    const fy26Forecast = (cat.actual || 0) * 1.05; // 5% growth assumption
    const variance = fy26Forecast - (cat.budget || 0);
    const variancePct = (cat.budget || 0) > 0 ? (variance / (cat.budget || 0)) * 100 : 0;
    
    return {
      category: cat.name,
      fy25Actual: cat.actual || 0,
      fy26: Math.round(fy26Forecast),
      budget: cat.budget || 0,
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
          value: `₹${((actual.totalRevenue || 0) / 10000000).toFixed(1)}Cr`,
          change: `${revenueVariance >= 0 ? '+' : ''}${revenueVariance.toFixed(1)}%`,
          status: revenueVariance >= 0 ? 'positive' : 'negative'
        },
        {
          label: 'EBITDA',
          value: `₹${(ebitda / 10000000).toFixed(1)}Cr`,
          change: `Margin: ${(ebitda / (actual.totalRevenue || 1) * 100).toFixed(1)}%`,
          status: 'positive'
        },
        {
          label: 'Net Profit',
          value: `₹${(netProfit / 10000000).toFixed(1)}Cr`,
          change: `${profitVariance >= 0 ? '+' : ''}${profitVariance.toFixed(1)}%`,
          status: profitVariance >= 0 ? 'positive' : 'negative'
        },
        {
          label: 'Cash Position',
          value: `₹${((actual.cashAndEquivalents || 0) / 10000000).toFixed(1)}Cr`,
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
          value: `₹${((actual.totalRevenue || 0) / 10000000).toFixed(2)}Cr`,
          change: `vs Budget: ${revenueVariance >= 0 ? '+' : ''}${revenueVariance.toFixed(1)}%`,
          status: revenueVariance >= 0 ? 'positive' : 'negative'
        },
        {
          label: 'Gross Profit',
          value: `₹${(grossProfit / 10000000).toFixed(2)}Cr`,
          change: `Margin: ${grossMargin.toFixed(1)}%`,
          status: 'positive'
        },
        {
          label: 'Operating Expenses',
          value: `₹${((actual.totalOperatingExpenses || 0) / 10000000).toFixed(2)}Cr`,
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
          value: `₹${(((actual.totalRevenue || 0) - (budget.totalRevenue || 0)) / 10000000).toFixed(2)}Cr`,
          change: `${revenueVariance >= 0 ? '+' : ''}${revenueVariance.toFixed(1)}%`,
          status: revenueVariance >= 0 ? 'positive' : 'negative'
        },
        {
          label: 'COGS Variance',
          value: `₹${(((actual.costOfGoodsSold || 0) - (budget.costOfGoodsSold || 0)) / 10000000).toFixed(2)}Cr`,
          change: `${(((actual.costOfGoodsSold || 0) - (budget.costOfGoodsSold || 0)) / (budget.costOfGoodsSold || 1) * 100).toFixed(1)}%`,
          status: (actual.costOfGoodsSold || 0) <= (budget.costOfGoodsSold || 0) ? 'positive' : 'negative'
        },
        {
          label: 'OpEx Variance',
          value: `₹${(((actual.totalOperatingExpenses || 0) - (budget.totalOperatingExpenses || 0)) / 10000000).toFixed(2)}Cr`,
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
          value: `₹${((actual.cashAndEquivalents || 0) / 10000000).toFixed(2)}Cr`,
          change: 'Strong position',
          status: 'positive'
        },
        {
          label: 'Accounts Receivable',
          value: `₹${((actual.accountsReceivable || 0) / 10000000).toFixed(2)}Cr`,
          change: `DSO: ${((actual.accountsReceivable || 0) / ((actual.totalRevenue || 1) / 365)).toFixed(0)} days`,
          status: 'neutral'
        },
        {
          label: 'Accounts Payable',
          value: `₹${((actual.accountsPayable || 0) / 10000000).toFixed(2)}Cr`,
          change: `DPO: ${((actual.accountsPayable || 0) / ((actual.costOfGoodsSold || 1) / 365)).toFixed(0)} days`,
          status: 'neutral'
        },
        {
          label: 'Working Capital',
          value: `₹${(((actual.cashAndEquivalents || 0) + (actual.accountsReceivable || 0) + (actual.inventory || 0) - (actual.accountsPayable || 0)) / 10000000).toFixed(2)}Cr`,
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

// Check if required data is available for a module
export const checkDataAvailability = (required: string[]) => {
  const missing: string[] = [];
  
  required.forEach(key => {
    if (!localStorage.getItem(key)) {
      missing.push(key);
    }
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
