// ==================== FP&A VARIANCE ANALYSIS — TYPE DEFINITIONS ====================

// ==================== VARIANCE DATA ====================

export interface VarianceRow {
  id: string;
  category: string;           // "Revenue", "Cost of Sales", etc.
  subcategory?: string;       // "Domestic Sales", "Export Sales"
  isHeader: boolean;
  actual: number;
  budget: number;
  variance: number;           // actual - budget
  variancePct: number;        // (variance / budget) * 100
  favorable: boolean;
  ytdActual: number;
  ytdBudget: number;
  ytdVariance: number;
  ytdVariancePct: number;
  priorYear?: number;
  priorYearVariancePct?: number;
  hasChildren: boolean;
  isExpanded: boolean;
  threshold: "critical" | "warning" | "ok"; // >10% = critical, 5-10% = warning
  level?: number;             // Indentation level (0 = top, 1 = child, 2 = grandchild)
  parentId?: string;
  department?: string;
  owner?: string;
  materialityScore?: number;
  materialityBand?: "critical" | "monitor" | "low";
  trend?: number[];
  decomposition?: {
    volume: number;
    price: number;
    mix: number;
    note?: string;
  };
  accountType?: "income" | "expense" | "other";
}

// ==================== PERIOD SELECTION ====================

export type PeriodType = "monthly" | "quarterly" | "ytd" | "annual";
export type CompareType = "budget" | "lastYear" | "lastQuarter" | "forecast";
export type DepartmentType = "all" | "sales" | "operations" | "hr" | "it" | "marketing" | "finance";
export type CurrencyType = "INR" | "USD" | "EUR" | "GBP" | "AED";

/** Indian lakh/crore grouping vs international M / compact K */
export type CurrencyFormatLocale = "IN" | "GLOBAL";

export interface PeriodSelection {
  periodType: PeriodType;
  month?: number;             // 1-12
  quarter?: number;           // 1-4
  year: number;
  compareType: CompareType;
  department: DepartmentType;
  currency: CurrencyType;
}

// ==================== KPI SUMMARY ====================

export interface KPISummary {
  id: string;
  label: string;
  actual: number;
  budget: number;
  variance: number;
  variancePct: number;
  favorable: boolean;
  threshold: "critical" | "warning" | "ok";
  icon?: string;
}

// ==================== DEPARTMENT DATA ====================

export interface DepartmentVariance {
  department: string;
  actual: number;
  budget: number;
  variance: number;
  variancePct: number;
  favorable: boolean;
  threshold: "critical" | "warning" | "ok";
}

// ==================== TREND DATA ====================

export interface TrendDataPoint {
  month: string;              // "Jan 2025", "Feb 2025", etc.
  actualRevenue: number;
  budgetRevenue: number;
  actualProfit: number;
  budgetProfit: number;
  actualGrossProfit?: number;
  budgetGrossProfit?: number;
  actualEBITDA?: number;
  budgetEBITDA?: number;
}

export type TrendMetric = "revenue" | "grossProfit" | "ebitda" | "netProfit";

// ==================== WATERFALL DATA ====================

export interface WaterfallItem {
  name: string;
  value: number;
  type: "start" | "increase" | "decrease" | "end";
  category: string;
}

// ==================== VARIANCE ALERT ====================

export interface VarianceAlert {
  id: string;
  category: string;
  variance: number;
  variancePct: number;
  threshold: "critical" | "warning" | "ok";
  message: string;
  favorable: boolean;
}

// ==================== AI COMMENTARY ====================

export interface AICommentary {
  executiveSummary: string;
  revenueAnalysis: string;
  costAnalysis: string;
  keyRisks: string[];
  managementActions: string[];
  outlook: string;
  generatedAt: string;
  rawText?: string;
}

// ==================== EXPORT OPTIONS ====================

export type ExportFormat = "pdf" | "excel" | "powerpoint" | "json";

export interface ExportOptions {
  format: ExportFormat;
  includeCharts: boolean;
  includeAICommentary: boolean;
  period: PeriodSelection;
}
