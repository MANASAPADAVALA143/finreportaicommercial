export type KPIStatus = "excellent" | "good" | "warning" | "critical";
export type KPITrend = "up" | "down" | "flat";
export type KPIUnit = "currency" | "percentage" | "days" | "ratio" | "number";
export type KPICategory = "revenue" | "profitability" | "liquidity" | "efficiency";

export interface KPIMetric {
  id: string;
  title: string;
  description: string;
  value: number;
  formattedValue: string;
  target: number;
  previousValue: number;
  changePercent: number;
  unit: KPIUnit;
  trend: KPITrend;
  trendFavorable: boolean;
  status: KPIStatus;
  sparklineData: number[];
  category: KPICategory;
  icon: string;
  tooltip: string;
  subLabel?: string;
}

export interface KPIAlert {
  id: string;
  kpiId: string;
  title: string;
  message: string;
  severity: "critical" | "warning" | "info";
  action?: string;
}

export interface KPIDashboardData {
  period: string;
  company: string;
  currency: string;
  lastUpdated: string;
  revenue: KPIMetric[];
  profitability: KPIMetric[];
  liquidity: KPIMetric[];
  efficiency: KPIMetric[];
  alerts: KPIAlert[];
}

export interface MonthlyKPIData {
  month: string;
  revenue: number;
  netProfitPercent: number;
  grossMargin: number;
  ebitdaMargin: number;
  netMargin: number;
  revenueTarget: number;
}

export interface HeatmapCell {
  kpiName: string;
  month: string;
  status: KPIStatus;
  value: number;
  target: number;
}
