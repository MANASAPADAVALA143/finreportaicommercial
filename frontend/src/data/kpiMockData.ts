import { KPIMetric, KPIAlert, MonthlyKPIData, HeatmapCell } from '../types/kpi';

// Monthly trend data for charts
export const monthlyTrendData: MonthlyKPIData[] = [
  { month: 'Nov 24', revenue: 24000000, netProfitPercent: 20, grossMargin: 48, ebitdaMargin: 27, netMargin: 20, revenueTarget: 25000000 },
  { month: 'Dec 24', revenue: 26000000, netProfitPercent: 21, grossMargin: 47, ebitdaMargin: 28, netMargin: 21, revenueTarget: 27000000 },
  { month: 'Jan 25', revenue: 28000000, netProfitPercent: 22, grossMargin: 49, ebitdaMargin: 29, netMargin: 22, revenueTarget: 28000000 },
  { month: 'Feb 25', revenue: 30000000, netProfitPercent: 21, grossMargin: 50, ebitdaMargin: 28, netMargin: 21, revenueTarget: 29000000 },
  { month: 'Mar 25', revenue: 29000000, netProfitPercent: 19, grossMargin: 45, ebitdaMargin: 26, netMargin: 19, revenueTarget: 30000000 },
  { month: 'Apr 25', revenue: 31000000, netProfitPercent: 17, grossMargin: 44, ebitdaMargin: 25, netMargin: 17, revenueTarget: 31000000 },
  { month: 'May 25', revenue: 33000000, netProfitPercent: 18, grossMargin: 47, ebitdaMargin: 27, netMargin: 18, revenueTarget: 32000000 },
  { month: 'Jun 25', revenue: 32000000, netProfitPercent: 19, grossMargin: 48, ebitdaMargin: 28, netMargin: 19, revenueTarget: 33000000 },
  { month: 'Jul 25', revenue: 31000000, netProfitPercent: 17, grossMargin: 46, ebitdaMargin: 26, netMargin: 17, revenueTarget: 33000000 },
  { month: 'Aug 25', revenue: 33000000, netProfitPercent: 15, grossMargin: 44, ebitdaMargin: 26, netMargin: 15, revenueTarget: 35000000 },
  { month: 'Sep 25', revenue: 32000000, netProfitPercent: 16, grossMargin: 45, ebitdaMargin: 27, netMargin: 16, revenueTarget: 34000000 },
  { month: 'Oct 25', revenue: 33000000, netProfitPercent: 15, grossMargin: 44, ebitdaMargin: 26, netMargin: 15, revenueTarget: 35000000 }
];

// Revenue KPIs
export const revenueKPIs: KPIMetric[] = [
  {
    id: 'total-revenue',
    title: 'Total Revenue',
    description: 'Monthly revenue vs budget',
    value: 33000000,
    formattedValue: '₹33.0Cr',
    target: 35000000,
    previousValue: 28000000,
    changePercent: -5.7,
    unit: 'currency',
    trend: 'down',
    trendFavorable: false,
    status: 'warning',
    sparklineData: [24, 26, 28, 30, 29, 31, 33, 32, 31, 33],
    category: 'revenue',
    icon: 'TrendingUp',
    tooltip: 'Monthly revenue vs ₹35Cr budget'
  },
  {
    id: 'revenue-growth-yoy',
    title: 'Revenue Growth YoY',
    description: 'Year-over-year revenue growth',
    value: 17.9,
    formattedValue: '+17.9%',
    target: 20,
    previousValue: 28000000,
    changePercent: 17.9,
    unit: 'percentage',
    trend: 'up',
    trendFavorable: true,
    status: 'good',
    sparklineData: [12, 14, 15, 18, 16, 19, 20, 18, 17, 18],
    category: 'revenue',
    icon: 'TrendingUp',
    tooltip: 'vs last year ₹28.0Cr'
  },
  {
    id: 'mrr',
    title: 'Monthly Recurring Revenue',
    description: 'Predictable recurring revenue per month',
    value: 2750000,
    formattedValue: '₹2.75Cr/month',
    target: 2920000,
    previousValue: 2920000,
    changePercent: -5.7,
    unit: 'currency',
    trend: 'down',
    trendFavorable: false,
    status: 'warning',
    sparklineData: [2.4, 2.5, 2.6, 2.7, 2.65, 2.7, 2.75, 2.73, 2.72, 2.75],
    category: 'revenue',
    icon: 'Repeat',
    tooltip: 'Average monthly recurring revenue'
  },
  {
    id: 'revenue-per-employee',
    title: 'Revenue per Employee',
    description: 'Employee productivity metric',
    value: 165000,
    formattedValue: '₹16.5L',
    target: 180000,
    previousValue: 180000,
    changePercent: -8.3,
    unit: 'currency',
    trend: 'down',
    trendFavorable: false,
    status: 'warning',
    sparklineData: [12, 13, 14, 15, 14.5, 15.5, 16.5, 16, 15.5, 16.5],
    category: 'revenue',
    icon: 'Users',
    tooltip: 'Revenue ÷ 200 employees'
  }
];

// Profitability KPIs
export const profitabilityKPIs: KPIMetric[] = [
  {
    id: 'gross-margin',
    title: 'Gross Margin %',
    description: 'Gross profit as percentage of revenue',
    value: 43.9,
    formattedValue: '43.9%',
    target: 51.4,
    previousValue: 51.4,
    changePercent: -7.5,
    unit: 'percentage',
    trend: 'down',
    trendFavorable: false,
    status: 'critical',
    sparklineData: [48, 47, 49, 50, 45, 44, 47, 48, 46, 44],
    category: 'profitability',
    icon: 'Percent',
    tooltip: '7.5pp below budget'
  },
  {
    id: 'ebitda-margin',
    title: 'EBITDA Margin %',
    description: 'Earnings before interest, tax, depreciation & amortization',
    value: 26.2,
    formattedValue: '26.2%',
    target: 25.7,
    previousValue: 25.7,
    changePercent: 0.5,
    unit: 'percentage',
    trend: 'up',
    trendFavorable: true,
    status: 'excellent',
    sparklineData: [27, 28, 29, 28, 26, 25, 27, 28, 26, 26],
    category: 'profitability',
    icon: 'TrendingUp',
    tooltip: '0.5pp above budget'
  },
  {
    id: 'net-margin',
    title: 'Net Profit Margin %',
    description: 'Bottom line profitability',
    value: 15.5,
    formattedValue: '15.5%',
    target: 23.1,
    previousValue: 23.1,
    changePercent: -7.7,
    unit: 'percentage',
    trend: 'down',
    trendFavorable: false,
    status: 'critical',
    sparklineData: [20, 21, 22, 21, 19, 17, 18, 19, 17, 15],
    category: 'profitability',
    icon: 'DollarSign',
    tooltip: '7.7pp below budget'
  },
  {
    id: 'operating-leverage',
    title: 'Operating Leverage',
    description: 'Revenue growth vs operating expense growth',
    value: 2.1,
    formattedValue: '2.1x',
    target: 2.5,
    previousValue: 2.5,
    changePercent: -16,
    unit: 'ratio',
    trend: 'down',
    trendFavorable: false,
    status: 'warning',
    sparklineData: [2.8, 2.7, 2.6, 2.5, 2.3, 2.2, 2.4, 2.3, 2.2, 2.1],
    category: 'profitability',
    icon: 'Activity',
    tooltip: 'Revenue growth ÷ OpEx growth'
  }
];

// Liquidity KPIs
export const liquidityKPIs: KPIMetric[] = [
  {
    id: 'cash-equivalents',
    title: 'Cash & Equivalents',
    description: 'Available cash and near-cash assets',
    value: 2500000,
    formattedValue: '₹2.5Cr',
    target: 3000000,
    previousValue: 3000000,
    changePercent: -16.7,
    unit: 'currency',
    trend: 'down',
    trendFavorable: false,
    status: 'warning',
    sparklineData: [3.5, 3.3, 3.2, 3.0, 2.9, 2.8, 2.7, 2.6, 2.5, 2.5],
    category: 'liquidity',
    icon: 'Wallet',
    tooltip: '16.7% below target',
    subLabel: '3.2 months runway'
  },
  {
    id: 'current-ratio',
    title: 'Current Ratio',
    description: 'Current assets ÷ current liabilities',
    value: 1.8,
    formattedValue: '1.8x',
    target: 2.0,
    previousValue: 2.0,
    changePercent: -10,
    unit: 'ratio',
    trend: 'down',
    trendFavorable: false,
    status: 'warning',
    sparklineData: [2.2, 2.1, 2.0, 2.0, 1.9, 1.9, 1.9, 1.8, 1.8, 1.8],
    category: 'liquidity',
    icon: 'PieChart',
    tooltip: 'Current Assets ÷ Current Liabilities'
  },
  {
    id: 'quick-ratio',
    title: 'Quick Ratio',
    description: 'Liquid assets ÷ current liabilities',
    value: 1.2,
    formattedValue: '1.2x',
    target: 1.5,
    previousValue: 1.5,
    changePercent: -20,
    unit: 'ratio',
    trend: 'down',
    trendFavorable: false,
    status: 'warning',
    sparklineData: [1.6, 1.5, 1.5, 1.4, 1.4, 1.3, 1.3, 1.2, 1.2, 1.2],
    category: 'liquidity',
    icon: 'Zap',
    tooltip: '(Cash + Receivables) ÷ Current Liabilities'
  },
  {
    id: 'debt-to-equity',
    title: 'Debt to Equity',
    description: 'Financial leverage ratio',
    value: 0.68,
    formattedValue: '0.68x',
    target: 0.5,
    previousValue: 0.5,
    changePercent: 36,
    unit: 'ratio',
    trend: 'up',
    trendFavorable: false,
    status: 'warning',
    sparklineData: [0.45, 0.48, 0.50, 0.52, 0.55, 0.58, 0.60, 0.63, 0.65, 0.68],
    category: 'liquidity',
    icon: 'Scale',
    tooltip: 'Above target (higher is riskier)'
  }
];

// Efficiency KPIs
export const efficiencyKPIs: KPIMetric[] = [
  {
    id: 'dso',
    title: 'DSO — Days Sales Outstanding',
    description: 'Average collection period for receivables',
    value: 46,
    formattedValue: '46 days',
    target: 40,
    previousValue: 40,
    changePercent: 15,
    unit: 'days',
    trend: 'up',
    trendFavorable: false,
    status: 'warning',
    sparklineData: [38, 39, 40, 41, 42, 43, 44, 45, 45, 46],
    category: 'efficiency',
    icon: 'Clock',
    tooltip: 'Customers taking longer to pay'
  },
  {
    id: 'dpo',
    title: 'DPO — Days Payable Outstanding',
    description: 'Average payment period to suppliers',
    value: 38,
    formattedValue: '38 days',
    target: 45,
    previousValue: 45,
    changePercent: -15.6,
    unit: 'days',
    trend: 'down',
    trendFavorable: false,
    status: 'warning',
    sparklineData: [47, 46, 45, 44, 43, 42, 41, 40, 39, 38],
    category: 'efficiency',
    icon: 'Calendar',
    tooltip: 'Paying suppliers too quickly'
  },
  {
    id: 'dio',
    title: 'DIO — Days Inventory Outstanding',
    description: 'Average inventory holding period',
    value: 58,
    formattedValue: '58 days',
    target: 50,
    previousValue: 50,
    changePercent: 16,
    unit: 'days',
    trend: 'up',
    trendFavorable: false,
    status: 'critical',
    sparklineData: [48, 49, 50, 51, 52, 54, 55, 56, 57, 58],
    category: 'efficiency',
    icon: 'Package',
    tooltip: 'Inventory moving slowly'
  },
  {
    id: 'ccc',
    title: 'Cash Conversion Cycle',
    description: 'DSO + DIO - DPO',
    value: 66,
    formattedValue: '66 days',
    target: 45,
    previousValue: 45,
    changePercent: 46.7,
    unit: 'days',
    trend: 'up',
    trendFavorable: false,
    status: 'critical',
    sparklineData: [39, 41, 43, 45, 48, 51, 53, 57, 61, 66],
    category: 'efficiency',
    icon: 'RefreshCw',
    tooltip: 'DSO (46) + DIO (58) - DPO (38) = 66 days'
  }
];

// KPI Alerts
export const kpiAlerts: KPIAlert[] = [
  // Critical Alerts
  {
    id: 'alert-net-margin',
    kpiId: 'net-margin',
    title: 'Net Profit Margin',
    message: '15.5% — 7.7pp below 23.1% target',
    severity: 'critical',
    action: 'Review cost structure and pricing'
  },
  {
    id: 'alert-gross-margin',
    kpiId: 'gross-margin',
    title: 'Gross Margin',
    message: '43.9% — significantly below 51.4% budget',
    severity: 'critical',
    action: 'Investigate COGS increase'
  },
  {
    id: 'alert-ccc',
    kpiId: 'ccc',
    title: 'Cash Conversion Cycle',
    message: '66 days — 47% above 45-day target',
    severity: 'critical',
    action: 'Accelerate collections and inventory turnover'
  },
  {
    id: 'alert-dio',
    kpiId: 'dio',
    title: 'Days Inventory Outstanding',
    message: '58 days — inventory accumulating',
    severity: 'critical',
    action: 'Review slow-moving stock'
  },
  
  // Warning Alerts
  {
    id: 'alert-revenue',
    kpiId: 'total-revenue',
    title: 'Revenue',
    message: '₹33Cr — ₹2Cr short of monthly target',
    severity: 'warning',
    action: 'Review sales pipeline'
  },
  {
    id: 'alert-dso',
    kpiId: 'dso',
    title: 'DSO',
    message: '46 days — customers paying slower',
    severity: 'warning',
    action: 'Follow up on overdue invoices'
  },
  {
    id: 'alert-cash',
    kpiId: 'cash-equivalents',
    title: 'Cash',
    message: '₹2.5Cr — below ₹3Cr minimum threshold',
    severity: 'warning',
    action: 'Monitor cash runway'
  },
  {
    id: 'alert-current-ratio',
    kpiId: 'current-ratio',
    title: 'Current Ratio',
    message: '1.8x — approaching minimum 2.0x',
    severity: 'warning',
    action: 'Improve working capital position'
  },
  
  // Positive Info
  {
    id: 'alert-ebitda',
    kpiId: 'ebitda-margin',
    title: 'EBITDA Margin',
    message: '26.2% — slightly above 25.7% target',
    severity: 'info',
    action: 'Maintain operational efficiency'
  },
  {
    id: 'alert-yoy-growth',
    kpiId: 'revenue-growth-yoy',
    title: 'Revenue Growth YoY',
    message: '+17.9% — strong growth trajectory',
    severity: 'info'
  }
];

// Monthly heatmap data
export const heatmapData: HeatmapCell[] = [
  // Revenue vs Budget
  ...['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'].map((month, idx) => ({
    kpiName: 'Revenue vs Bud',
    month,
    status: (['good', 'good', 'warning', 'good', 'warning', 'critical', 'good', 'warning', 'warning', 'critical'] as const)[idx],
    value: [28, 30, 29, 31, 29, 27, 33, 32, 31, 33][idx],
    target: 35
  })),
  
  // Gross Margin
  ...['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'].map((month, idx) => ({
    kpiName: 'Gross Margin',
    month,
    status: (['good', 'warning', 'good', 'good', 'critical', 'warning', 'good', 'good', 'warning', 'critical'] as const)[idx],
    value: [49, 47, 49, 50, 45, 44, 47, 48, 46, 44][idx],
    target: 51
  })),
  
  // Net Margin
  ...['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'].map((month, idx) => ({
    kpiName: 'Net Margin',
    month,
    status: (['warning', 'good', 'good', 'warning', 'warning', 'critical', 'warning', 'good', 'critical', 'critical'] as const)[idx],
    value: [22, 21, 22, 21, 19, 17, 18, 19, 17, 15][idx],
    target: 23
  })),
  
  // Cash Ratio
  ...['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'].map((month, idx) => ({
    kpiName: 'Cash Ratio',
    month,
    status: (['good', 'good', 'good', 'warning', 'warning', 'warning', 'good', 'warning', 'warning', 'warning'] as const)[idx],
    value: [3.2, 3.0, 3.0, 2.9, 2.8, 2.7, 2.8, 2.6, 2.5, 2.5][idx],
    target: 3.0
  })),
  
  // DSO
  ...['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'].map((month, idx) => ({
    kpiName: 'DSO',
    month,
    status: (['good', 'good', 'warning', 'warning', 'critical', 'warning', 'warning', 'critical', 'warning', 'warning'] as const)[idx],
    value: [38, 39, 40, 41, 43, 42, 43, 45, 45, 46][idx],
    target: 40
  }))
];

// All KPIs combined
export const allKPIs: KPIMetric[] = [
  ...revenueKPIs,
  ...profitabilityKPIs,
  ...liquidityKPIs,
  ...efficiencyKPIs
];
