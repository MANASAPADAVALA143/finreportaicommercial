export type ScenarioType = "best" | "base" | "worst" | "custom";

export interface ScenarioAssumption {
  id: string;
  category: string;
  variable: string;
  baseValue: number;
  scenarioValue: number;
  changePercent: number;
  unit: "percentage" | "currency" | "number";
  impact: "high" | "medium" | "low";
}

export interface ScenarioResults {
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

export interface Scenario {
  id: string;
  name: string;
  type: ScenarioType;
  description: string;
  color: string;
  assumptions: ScenarioAssumption[];
  results: ScenarioResults;
  createdAt: string;
  isLocked: boolean;
  isActive: boolean;
}

export interface SensitivityItem {
  variable: string;
  baseValue: number;
  minus20: number;
  minus10: number;
  base: number;
  plus10: number;
  plus20: number;
  impactOnNetProfit: number;
  sensitivity: "high" | "medium" | "low";
}

export interface SliderConfig {
  id: string;
  label: string;
  min: number;
  max: number;
  baseValue: number;
  currentValue: number;
  unit: string;
  category: "revenue" | "costs" | "market";
  isFavorable: (value: number, base: number) => boolean;
}
