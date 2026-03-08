export type Scenario = "base" | "best" | "worst";

export type ForecastMethod = "actual" | "ai_forecast" | "trend" | "manual";

export interface ScenarioMultipliers {
  revenue: number;
  expenses: number;
  growth: number;
}

export interface MonthlyRevenueForecast {
  month: string;
  actual?: number;
  forecast: number;
  budget: number;
  lastYear: number;
  variance_vs_budget: number;
  variance_vs_ly: number;
  confidence?: number;
  method: ForecastMethod;
  isActual: boolean;
}

export interface DepartmentExpenseForecast {
  department: string;
  oct: number;
  nov: number;
  dec: number;
  q1: number;
  q2: number;
  fy26: number;
  budget: number;
  variance: number;
  variancePct: number;
}

export interface HeadcountForecast {
  department: string;
  current: number;
  newHires: number;
  attrition: number;
  q1End: number;
  q2End: number;
  fy26End: number;
  avgSalary: number;
}

export interface WeeklyCashFlow {
  week: number;
  weekLabel: string;
  openingBalance: number;
  inflows: {
    customerCollections: number;
    otherIncome: number;
    total: number;
  };
  outflows: {
    payroll: number;
    supplierPayments: number;
    rent: number;
    utilities: number;
    loanRepayments: number;
    taxes: number;
    other: number;
    total: number;
  };
  netCashFlow: number;
  closingBalance: number;
  minimumBuffer: number;
  belowBuffer: boolean;
  isActual: boolean;
  confidence: number;
}

export interface CashFlowAlert {
  week: number;
  weekLabel: string;
  severity: "critical" | "warning" | "positive";
  message: string;
  action?: string;
}

export interface AIForecastResult {
  forecasts: Array<{
    month: string;
    amount: number;
    confidence: number;
    reasoning: string;
  }>;
  annualForecast: number;
  keyAssumptions: string[];
  risks: string[];
}

export interface ARAPSchedule {
  type: "AR" | "AP";
  overdue: number;
  dueThisWeek: number;
  dueNext2Weeks: number;
  dueThisMonth: number;
}

export interface ForecastSummary {
  label: string;
  value: number;
  comparison: number;
  change: number;
  changePct: number;
  status: "good" | "warning" | "critical";
  sublabel?: string;
}
