// Decision types and interfaces for CFO Decision Intelligence module

export type DecisionType = 
  | "investment"
  | "build_vs_buy"
  | "internal_vs_external"
  | "hire_vs_automate"
  | "cost_cut_vs_invest"
  | "capital_allocation"
  | "risk";

export type DecisionOutcome = "approve" | "reject" | "conditional" | "review" | "hybrid" | "build" | "buy" | "internal" | "external" | "hire" | "automate";

export interface Decision {
  id: string;
  type: DecisionType;
  title: string;
  date: string;
  inputs: Record<string, any>;
  results: DecisionResults;
  aiRecommendation: string;
  aiOutcome: DecisionOutcome;
  confidence: number;        // 0-100 — how sure AI is
  confidenceFactors: ConfidenceFactor[];
  cfoOverride?: DecisionOutcome;
  cfoNotes?: string;
  savedToAuditTrail: boolean;
  outcome?: string;          // tracked later — was AI right?
  aiCorrect?: boolean;
}

export interface DecisionResults {
  primaryMetric: number;
  secondaryMetrics: Record<string, number>;
  riskScore: number;
  recommendation: DecisionOutcome;
}

export interface ConfidenceFactor {
  factor: string;
  status: "positive" | "negative" | "neutral";
  impact: "high" | "medium" | "low";
  detail: string;
}

export interface MorningBriefItem {
  urgency: "critical" | "warning" | "info";
  title: string;
  decision: string;
  impact: string;
  action: DecisionType | null;
}

export interface RiskCategory {
  score: number;
  status: "low" | "medium" | "high";
  trend: "improving" | "stable" | "worsening";
  action: string;
}

export interface RiskData {
  liquidity: RiskCategory;
  credit: RiskCategory;
  operational: RiskCategory;
  market: RiskCategory;
  compliance: RiskCategory;
  fx: RiskCategory;
  concentration: RiskCategory;
  overall: number;
}

export interface AuditTrailEntry {
  id: string;
  date: string;
  type: DecisionType;
  title: string;
  aiOutcome: DecisionOutcome;
  cfoOutcome: DecisionOutcome;
  tracked: boolean;
  outcome?: string;
  aiCorrect?: boolean;
  confidence?: number;
}

export interface InvestmentInputs {
  projectName: string;
  investment: number;
  annualReturns: number;
  projectLife: number;
  riskLevel: "low" | "medium" | "high";
  discountRate: number;
  strategicValue: "low" | "medium" | "high";
  cashPosition: number;
}

export interface BuildVsBuyInputs {
  requirement: string;
  coreRequirement: string;
  buildCost: number;
  buildTimeline: number;
  buildTeam: number;
  buildMaintenance: number;
  buildCustomization: "full" | "partial" | "none";
  vendorName: string;
  buyCost: number;
  buyImplementation: number;
  buyTimeline: number;
  buyCustomization: "full" | "partial" | "none";
  vendorLockIn: "high" | "medium" | "low";
}

export interface InternalVsExternalInputs {
  functionName: string;
  category: string;
  currentTeam: number;
  costPerPerson: number;
  currentTime: number;
  errorRate: number;
  teamUtilization: number;
  trainingCost: number;
  vendorName: string;
  vendorMonthlyCost: number;
  vendorSLA: number;
  vendorErrorRate: number;
  transitionTime: number;
  exitClause: string;
}

export interface HireVsAutomateInputs {
  process: string;
  currentTeam: number;
  monthlyVolume: number;
  hoursPerUnit: number;
  additionalNeeded: number;
  avgSalary: number;
  automationTool: string;
  setupCost: number;
  monthlyCost: number;
  automationPercentage: number;
}

export interface CapitalAllocationOption {
  id: string;
  name: string;
  amount: number;
  expectedReturn: number;
  risk: "low" | "medium" | "high";
  selected: boolean;
}
