export type ScenarioType = 'base' | 'growth' | 'conservative' | 'stress';

export interface ScenarioAssumptions {
  revenueGrowthRate: number;
  newClientGrowth: number;
  avgRevenuePerClient: number;
  churnRate: number;
  priceIncrease: number;
  cogsPercent: number;
  headcountGrowth: number;
  marketingSpend: number;
  rdInvestment: number;
  overheadGrowth: number;
  dso: number;
  inventoryDays: number;
  dpo: number;
  capex: number;
}

export interface MonthlyPL {
  month: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
  marketingExpense: number;
  headcountCost: number;
  rdExpense: number;
  overhead: number;
  totalOpex: number;
  ebitda: number;
  ebitdaMarginPct: number;
  depreciation: number;
  ebit: number;
  financeCost: number;
  pbt: number;
  tax: number;
  netProfit: number;
  netMarginPct: number;
  cashFlow: number;
  cumulativeCash: number;
}

export interface ScenarioResult {
  scenarioType: ScenarioType;
  assumptions: ScenarioAssumptions;
  annualKPIs: {
    revenue: number;
    grossMarginPct: number;
    ebitda: number;
    ebitdaMarginPct: number;
    netProfit: number;
    endCash: number;
  };
  monthlyPL: MonthlyPL[];
  aiNarrative: string;
}

export const DEFAULT_ASSUMPTIONS: Record<ScenarioType, ScenarioAssumptions> = {
  base: {
    revenueGrowthRate: 15,
    newClientGrowth: 20,
    avgRevenuePerClient: 8.5,
    churnRate: 3.5,
    priceIncrease: 5,
    cogsPercent: 35,
    headcountGrowth: 15,
    marketingSpend: 12,
    rdInvestment: 8,
    overheadGrowth: 8,
    dso: 45,
    inventoryDays: 30,
    dpo: 60,
    capex: 25,
  },
  growth: {
    revenueGrowthRate: 30,
    newClientGrowth: 40,
    avgRevenuePerClient: 9.5,
    churnRate: 2.5,
    priceIncrease: 8,
    cogsPercent: 33,
    headcountGrowth: 25,
    marketingSpend: 20,
    rdInvestment: 15,
    overheadGrowth: 12,
    dso: 40,
    inventoryDays: 25,
    dpo: 55,
    capex: 40,
  },
  conservative: {
    revenueGrowthRate: 8,
    newClientGrowth: 10,
    avgRevenuePerClient: 8.0,
    churnRate: 5,
    priceIncrease: 2,
    cogsPercent: 38,
    headcountGrowth: 5,
    marketingSpend: 8,
    rdInvestment: 5,
    overheadGrowth: 5,
    dso: 50,
    inventoryDays: 35,
    dpo: 65,
    capex: 15,
  },
  stress: {
    revenueGrowthRate: -5,
    newClientGrowth: -10,
    avgRevenuePerClient: 7.0,
    churnRate: 10,
    priceIncrease: 0,
    cogsPercent: 42,
    headcountGrowth: 0,
    marketingSpend: 5,
    rdInvestment: 3,
    overheadGrowth: 3,
    dso: 60,
    inventoryDays: 45,
    dpo: 70,
    capex: 5,
  },
};
