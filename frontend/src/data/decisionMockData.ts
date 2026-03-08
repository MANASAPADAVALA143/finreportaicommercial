import { AuditTrailEntry, RiskData, MorningBriefItem } from '../types/decisions';

export const morningBriefData: MorningBriefItem[] = [
  {
    urgency: "critical",
    title: "Cash runway drops to 2.8 months next week",
    decision: "Draw credit line OR cut costs immediately",
    impact: "₹85L monthly burn",
    action: "cost_cut_vs_invest"
  },
  {
    urgency: "warning", 
    title: "ERP Project ROI dropped from 28% to 19%",
    decision: "Continue or pause implementation?",
    impact: "₹2Cr at risk",
    action: "investment"
  },
  {
    urgency: "info",
    title: "Admin costs back on track this month",
    decision: "No action needed",
    impact: "Variance resolved",
    action: null
  }
];

export const auditTrailData: AuditTrailEntry[] = [
  { 
    id: "d001", 
    date: "2026-03-15", 
    type: "investment", 
    title: "ERP System ₹2Cr", 
    aiOutcome: "conditional", 
    cfoOutcome: "approve", 
    tracked: false,
    confidence: 76
  },
  { 
    id: "d002", 
    date: "2026-03-10", 
    type: "internal_vs_external", 
    title: "Outsource AP Processing", 
    aiOutcome: "hybrid", 
    cfoOutcome: "reject", 
    tracked: false,
    confidence: 65
  },
  { 
    id: "d003", 
    date: "2026-03-05", 
    type: "hire_vs_automate", 
    title: "Hire 2 Sales Reps", 
    aiOutcome: "automate", 
    cfoOutcome: "approve", 
    tracked: false,
    confidence: 89
  },
  { 
    id: "d004", 
    date: "2026-02-28", 
    type: "cost_cut_vs_invest", 
    title: "Cut Travel 50%", 
    aiOutcome: "approve", 
    cfoOutcome: "approve", 
    tracked: true, 
    outcome: "Saved ₹18L, no impact", 
    aiCorrect: true,
    confidence: 84
  },
  { 
    id: "d005", 
    date: "2026-02-15", 
    type: "build_vs_buy", 
    title: "Buy Anaplan vs Build", 
    aiOutcome: "build", 
    cfoOutcome: "build", 
    tracked: true, 
    outcome: "Built internally, saved ₹200L", 
    aiCorrect: true,
    confidence: 71
  },
  { 
    id: "d006", 
    date: "2026-02-01", 
    type: "investment", 
    title: "Market expansion ₹50L", 
    aiOutcome: "approve", 
    cfoOutcome: "approve", 
    tracked: true, 
    outcome: "22% revenue growth achieved", 
    aiCorrect: true,
    confidence: 82
  },
];

export const riskData: RiskData = {
  liquidity: { 
    score: 7.2, 
    status: "high", 
    trend: "worsening", 
    action: "Draw ₹2Cr credit line by week 2" 
  },
  credit: { 
    score: 4.1, 
    status: "medium", 
    trend: "stable", 
    action: "Monitor DSO - currently 45 days" 
  },
  operational: { 
    score: 3.2, 
    status: "low", 
    trend: "improving", 
    action: "None required - on track" 
  },
  market: { 
    score: 5.8, 
    status: "medium", 
    trend: "worsening", 
    action: "Diversify customer base - reduce top-3 dependency" 
  },
  compliance: { 
    score: 2.1, 
    status: "low", 
    trend: "stable", 
    action: "None required - all audits passed" 
  },
  fx: { 
    score: 6.4, 
    status: "high", 
    trend: "worsening", 
    action: "Hedge 50% export receivables (₹1.8Cr)" 
  },
  concentration: { 
    score: 5.1, 
    status: "medium", 
    trend: "stable", 
    action: "Win 2 new enterprise clients this quarter" 
  },
  overall: 6.1
};

export const compareProjectsData = [
  {
    name: "ERP System",
    investment: 20000000,
    npv: 180000,
    irr: 14.8,
    payback: 4.0,
    score: 72,
    decision: "approve"
  },
  {
    name: "Sales Expansion",
    investment: 5000000,
    npv: 820000,
    irr: 28.3,
    payback: 1.8,
    score: 91,
    decision: "approve"
  },
  {
    name: "New Office",
    investment: 15000000,
    npv: -320000,
    irr: 9.1,
    payback: 6.5,
    score: 38,
    decision: "reject"
  },
  {
    name: "AI Platform",
    investment: 8000000,
    npv: 510000,
    irr: 21.4,
    payback: 2.4,
    score: 85,
    decision: "approve"
  }
];
