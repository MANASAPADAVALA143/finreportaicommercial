import {
  MonthlyRevenueForecast,
  DepartmentExpenseForecast,
  HeadcountForecast,
  WeeklyCashFlow,
  CashFlowAlert,
  ARAPSchedule,
  ScenarioMultipliers
} from '../types/forecast';

// Scenario multipliers
export const scenarioMultipliers: Record<string, ScenarioMultipliers> = {
  best: { revenue: 1.15, expenses: 0.95, growth: 1.20 },
  base: { revenue: 1.00, expenses: 1.00, growth: 1.00 },
  worst: { revenue: 0.85, expenses: 1.10, growth: 0.75 }
};

// Revenue Forecast Data
export const revenueForecastData: MonthlyRevenueForecast[] = [
  {
    month: "Oct 25",
    actual: 33000000,
    forecast: 33000000,
    budget: 35000000,
    lastYear: 28000000,
    variance_vs_budget: -5.7,
    variance_vs_ly: 17.9,
    method: "actual",
    isActual: true
  },
  {
    month: "Nov 25",
    forecast: 34200000,
    budget: 35500000,
    lastYear: 29100000,
    variance_vs_budget: -3.7,
    variance_vs_ly: 17.5,
    confidence: 87,
    method: "ai_forecast",
    isActual: false
  },
  {
    month: "Dec 25",
    forecast: 38500000,
    budget: 39000000,
    lastYear: 32800000,
    variance_vs_budget: -1.3,
    variance_vs_ly: 17.4,
    confidence: 82,
    method: "ai_forecast",
    isActual: false
  },
  {
    month: "Jan 26",
    forecast: 31200000,
    budget: 32000000,
    lastYear: 26500000,
    variance_vs_budget: -2.5,
    variance_vs_ly: 17.7,
    confidence: 79,
    method: "ai_forecast",
    isActual: false
  },
  {
    month: "Feb 26",
    forecast: 32800000,
    budget: 33500000,
    lastYear: 27800000,
    variance_vs_budget: -2.1,
    variance_vs_ly: 18.0,
    confidence: 76,
    method: "ai_forecast",
    isActual: false
  },
  {
    month: "Mar 26",
    forecast: 36500000,
    budget: 37000000,
    lastYear: 31000000,
    variance_vs_budget: -1.4,
    variance_vs_ly: 17.7,
    confidence: 73,
    method: "ai_forecast",
    isActual: false
  },
  {
    month: "Apr 26",
    forecast: 33900000,
    budget: 35000000,
    lastYear: 28800000,
    variance_vs_budget: -3.1,
    variance_vs_ly: 17.7,
    confidence: 70,
    method: "ai_forecast",
    isActual: false
  },
  {
    month: "May 26",
    forecast: 35200000,
    budget: 36000000,
    lastYear: 29900000,
    variance_vs_budget: -2.2,
    variance_vs_ly: 17.7,
    confidence: 68,
    method: "trend",
    isActual: false
  },
  {
    month: "Jun 26",
    forecast: 37800000,
    budget: 38500000,
    lastYear: 32100000,
    variance_vs_budget: -1.8,
    variance_vs_ly: 17.8,
    confidence: 65,
    method: "trend",
    isActual: false
  },
  {
    month: "Jul 26",
    forecast: 36100000,
    budget: 37000000,
    lastYear: 30600000,
    variance_vs_budget: -2.4,
    variance_vs_ly: 18.0,
    confidence: 62,
    method: "trend",
    isActual: false
  },
  {
    month: "Aug 26",
    forecast: 34500000,
    budget: 35500000,
    lastYear: 29300000,
    variance_vs_budget: -2.8,
    variance_vs_ly: 17.7,
    confidence: 60,
    method: "trend",
    isActual: false
  },
  {
    month: "Sep 26",
    forecast: 36000000,
    budget: 37000000,
    lastYear: 30500000,
    variance_vs_budget: -2.7,
    variance_vs_ly: 18.0,
    confidence: 58,
    method: "trend",
    isActual: false
  }
];

// Expense Forecast Data
export const expenseForecastData: DepartmentExpenseForecast[] = [
  {
    department: "Payroll",
    oct: 3200000,
    nov: 3200000,
    dec: 3400000,
    q1: 9800000,
    q2: 10100000,
    fy26: 38400000,
    budget: 36000000,
    variance: -2400000,
    variancePct: -6.7
  },
  {
    department: "IT & Tech",
    oct: 450000,
    nov: 480000,
    dec: 500000,
    q1: 1400000,
    q2: 1500000,
    fy26: 5800000,
    budget: 5400000,
    variance: -400000,
    variancePct: -7.4
  },
  {
    department: "Marketing",
    oct: 1200000,
    nov: 1300000,
    dec: 1500000,
    q1: 4000000,
    q2: 4200000,
    fy26: 15600000,
    budget: 15000000,
    variance: -600000,
    variancePct: -4.0
  },
  {
    department: "Travel",
    oct: 600000,
    nov: 500000,
    dec: 400000,
    q1: 1500000,
    q2: 1600000,
    fy26: 5400000,
    budget: 6000000,
    variance: 600000,
    variancePct: 10.0
  },
  {
    department: "Admin",
    oct: 850000,
    nov: 850000,
    dec: 900000,
    q1: 2600000,
    q2: 2700000,
    fy26: 10200000,
    budget: 9600000,
    variance: -600000,
    variancePct: -6.25
  }
];

// Headcount Forecast Data
export const headcountForecastData: HeadcountForecast[] = [
  {
    department: "Sales",
    current: 45,
    newHires: 8,
    attrition: 3,
    q1End: 50,
    q2End: 54,
    fy26End: 60,
    avgSalary: 800000
  },
  {
    department: "Engineering",
    current: 30,
    newHires: 5,
    attrition: 2,
    q1End: 33,
    q2End: 36,
    fy26End: 40,
    avgSalary: 1200000
  },
  {
    department: "Finance",
    current: 12,
    newHires: 2,
    attrition: 1,
    q1End: 13,
    q2End: 14,
    fy26End: 15,
    avgSalary: 900000
  },
  {
    department: "HR",
    current: 8,
    newHires: 1,
    attrition: 0,
    q1End: 9,
    q2End: 9,
    fy26End: 10,
    avgSalary: 700000
  },
  {
    department: "Marketing",
    current: 20,
    newHires: 4,
    attrition: 2,
    q1End: 22,
    q2End: 24,
    fy26End: 28,
    avgSalary: 750000
  },
  {
    department: "Operations",
    current: 85,
    newHires: 5,
    attrition: 2,
    q1End: 88,
    q2End: 91,
    fy26End: 92,
    avgSalary: 500000
  }
];

// Cash Flow Forecast Data (13 weeks)
export const cashFlowForecastData: WeeklyCashFlow[] = [
  {
    week: 1,
    weekLabel: "Nov 3-7",
    openingBalance: 2500000,
    inflows: { customerCollections: 1150000, otherIncome: 50000, total: 1200000 },
    outflows: { payroll: 0, supplierPayments: 700000, rent: 0, utilities: 100000, loanRepayments: 0, taxes: 0, other: 50000, total: 850000 },
    netCashFlow: 350000,
    closingBalance: 2850000,
    minimumBuffer: 1000000,
    belowBuffer: false,
    isActual: false,
    confidence: 85
  },
  {
    week: 2,
    weekLabel: "Nov 10-14",
    openingBalance: 2850000,
    inflows: { customerCollections: 900000, otherIncome: 50000, total: 950000 },
    outflows: { payroll: 0, supplierPayments: 1200000, rent: 150000, utilities: 50000, loanRepayments: 0, taxes: 0, other: 50000, total: 1450000 },
    netCashFlow: -500000,
    closingBalance: 2350000,
    minimumBuffer: 1000000,
    belowBuffer: false,
    isActual: false,
    confidence: 82
  },
  {
    week: 3,
    weekLabel: "Nov 17-21",
    openingBalance: 2350000,
    inflows: { customerCollections: 1400000, otherIncome: 100000, total: 1500000 },
    outflows: { payroll: 0, supplierPayments: 750000, rent: 0, utilities: 100000, loanRepayments: 0, taxes: 0, other: 50000, total: 900000 },
    netCashFlow: 600000,
    closingBalance: 2950000,
    minimumBuffer: 1000000,
    belowBuffer: false,
    isActual: false,
    confidence: 80
  },
  {
    week: 4,
    weekLabel: "Nov 24-28",
    openingBalance: 2950000,
    inflows: { customerCollections: 750000, otherIncome: 50000, total: 800000 },
    outflows: { payroll: 3200000, supplierPayments: 0, rent: 0, utilities: 0, loanRepayments: 0, taxes: 0, other: 0, total: 3200000 },
    netCashFlow: -2400000,
    closingBalance: 550000,
    minimumBuffer: 1000000,
    belowBuffer: true,
    isActual: false,
    confidence: 78
  },
  {
    week: 5,
    weekLabel: "Dec 1-5",
    openingBalance: 550000,
    inflows: { customerCollections: 2000000, otherIncome: 100000, total: 2100000 },
    outflows: { payroll: 0, supplierPayments: 850000, rent: 150000, utilities: 0, loanRepayments: 0, taxes: 0, other: 50000, total: 1050000 },
    netCashFlow: 1050000,
    closingBalance: 1600000,
    minimumBuffer: 1000000,
    belowBuffer: false,
    isActual: false,
    confidence: 75
  },
  {
    week: 6,
    weekLabel: "Dec 8-12",
    openingBalance: 1600000,
    inflows: { customerCollections: 1050000, otherIncome: 50000, total: 1100000 },
    outflows: { payroll: 0, supplierPayments: 900000, rent: 0, utilities: 100000, loanRepayments: 0, taxes: 1350000, other: 50000, total: 2400000 },
    netCashFlow: -1300000,
    closingBalance: 300000,
    minimumBuffer: 1000000,
    belowBuffer: true,
    isActual: false,
    confidence: 72
  },
  {
    week: 7,
    weekLabel: "Dec 15-19",
    openingBalance: 300000,
    inflows: { customerCollections: 1700000, otherIncome: 100000, total: 1800000 },
    outflows: { payroll: 0, supplierPayments: 800000, rent: 0, utilities: 50000, loanRepayments: 0, taxes: 0, other: 50000, total: 900000 },
    netCashFlow: 900000,
    closingBalance: 1200000,
    minimumBuffer: 1000000,
    belowBuffer: false,
    isActual: false,
    confidence: 70
  },
  {
    week: 8,
    weekLabel: "Dec 22-26",
    openingBalance: 1200000,
    inflows: { customerCollections: 850000, otherIncome: 50000, total: 900000 },
    outflows: { payroll: 3200000, supplierPayments: 950000, rent: 0, utilities: 100000, loanRepayments: 0, taxes: 0, other: 50000, total: 1100000 },
    netCashFlow: -200000,
    closingBalance: 1000000,
    minimumBuffer: 1000000,
    belowBuffer: false,
    isActual: false,
    confidence: 68
  },
  {
    week: 9,
    weekLabel: "Dec 29-Jan 2",
    openingBalance: 1000000,
    inflows: { customerCollections: 2400000, otherIncome: 100000, total: 2500000 },
    outflows: { payroll: 0, supplierPayments: 650000, rent: 150000, utilities: 0, loanRepayments: 0, taxes: 0, other: 0, total: 800000 },
    netCashFlow: 1700000,
    closingBalance: 2700000,
    minimumBuffer: 1000000,
    belowBuffer: false,
    isActual: false,
    confidence: 65
  },
  {
    week: 10,
    weekLabel: "Jan 5-9",
    openingBalance: 2700000,
    inflows: { customerCollections: 1050000, otherIncome: 50000, total: 1100000 },
    outflows: { payroll: 0, supplierPayments: 750000, rent: 0, utilities: 100000, loanRepayments: 0, taxes: 0, other: 50000, total: 900000 },
    netCashFlow: 200000,
    closingBalance: 2900000,
    minimumBuffer: 1000000,
    belowBuffer: false,
    isActual: false,
    confidence: 62
  },
  {
    week: 11,
    weekLabel: "Jan 12-16",
    openingBalance: 2900000,
    inflows: { customerCollections: 900000, otherIncome: 50000, total: 950000 },
    outflows: { payroll: 0, supplierPayments: 750000, rent: 0, utilities: 50000, loanRepayments: 0, taxes: 0, other: 50000, total: 850000 },
    netCashFlow: 100000,
    closingBalance: 3000000,
    minimumBuffer: 1000000,
    belowBuffer: false,
    isActual: false,
    confidence: 60
  },
  {
    week: 12,
    weekLabel: "Jan 19-23",
    openingBalance: 3000000,
    inflows: { customerCollections: 1150000, otherIncome: 50000, total: 1200000 },
    outflows: { payroll: 3200000, supplierPayments: 850000, rent: 0, utilities: 100000, loanRepayments: 0, taxes: 0, other: 50000, total: 950000 },
    netCashFlow: 250000,
    closingBalance: 3250000,
    minimumBuffer: 1000000,
    belowBuffer: false,
    isActual: false,
    confidence: 58
  },
  {
    week: 13,
    weekLabel: "Jan 26-30",
    openingBalance: 3250000,
    inflows: { customerCollections: 1450000, otherIncome: 50000, total: 1500000 },
    outflows: { payroll: 0, supplierPayments: 1200000, rent: 150000, utilities: 0, loanRepayments: 0, taxes: 0, other: 0, total: 1350000 },
    netCashFlow: 150000,
    closingBalance: 3400000,
    minimumBuffer: 1000000,
    belowBuffer: false,
    isActual: false,
    confidence: 55
  }
];

// Cash Flow Alerts
export const cashFlowAlerts: CashFlowAlert[] = [
  {
    week: 4,
    weekLabel: "Nov 24-28",
    severity: "critical",
    message: "Payroll week — closing balance drops to ₹0.55Cr. Below minimum buffer of ₹1.0Cr",
    action: "Accelerate ₹0.5Cr collections before Nov 24"
  },
  {
    week: 6,
    weekLabel: "Dec 8-12",
    severity: "critical",
    message: "Quarterly tax payment (₹1.35Cr) due. Closing balance drops to ₹0.3Cr",
    action: "Defer non-critical supplier payments or arrange short-term facility"
  },
  {
    week: 8,
    weekLabel: "Dec 22-26",
    severity: "warning",
    message: "Year-end supplier payments + payroll. Closing balance at buffer limit (₹1.0Cr)",
    action: "Negotiate extended payment terms with key suppliers"
  },
  {
    week: 9,
    weekLabel: "Dec 29-Jan 2",
    severity: "positive",
    message: "Strong year-end collections expected (₹2.4Cr). Closing balance improves to ₹2.7Cr",
    action: "Maintain collection focus post-holidays"
  },
  {
    week: 13,
    weekLabel: "Jan 26-30",
    severity: "positive",
    message: "Healthy closing balance of ₹3.4Cr, well above buffer. Cash position stable",
    action: "Consider investing excess cash or accelerating growth investments"
  }
];

// AR/AP Schedule
export const arSchedule: ARAPSchedule = {
  type: "AR",
  overdue: 800000,
  dueThisWeek: 1200000,
  dueNext2Weeks: 2100000,
  dueThisMonth: 3400000
};

export const apSchedule: ARAPSchedule = {
  type: "AP",
  overdue: 0,
  dueThisWeek: 850000,
  dueNext2Weeks: 1450000,
  dueThisMonth: 2800000
};
