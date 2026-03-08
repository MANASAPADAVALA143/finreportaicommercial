export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  isLoading?: boolean;
  sources?: string[];        // which modules data was used from
  charts?: ChartData[];      // inline charts in response
}

export interface ChartData {
  type: "line" | "bar" | "pie";
  data: any;
  title: string;
}

export interface StrategicInsight {
  id: string;
  category: "revenue" | "cost" | "cash" | "risk" | "opportunity";
  title: string;
  summary: string;
  detail: string;
  impact: "high" | "medium" | "low";
  urgency: "immediate" | "this_week" | "this_month";
  action: string;
  metric?: { label: string; value: string; change: string; };
  generatedAt: string;
}

export interface KPIAlert {
  id: string;
  kpi: string;
  current: number;
  threshold: number;
  severity: "critical" | "warning" | "info";
  message: string;
  recommendation: string;
  triggeredAt: string;
}

export interface FinancialHealthScore {
  overall: number;           // 0-100
  grade: "A" | "B" | "C" | "D" | "F";
  components: {
    profitability: number;
    liquidity: number;
    efficiency: number;
    growth: number;
    stability: number;
  };
  trend: "improving" | "stable" | "declining";
  benchmarkVsIndustry: number;
  aiSummary: string;
}

export type CFOTab = "assistant" | "insights" | "monitor" | "health";
