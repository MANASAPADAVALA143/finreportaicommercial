import type { KPIAlert, FinancialHealthScore } from './cfo';

/** Parsed from CFO_Services_Context sheet (central upload). */

export interface CFOServicesContext {
  /** 22 financial metrics for AI Assistant */
  aiAssistantContext: string;
  /** KPI Monitor: thresholds and current alerts (12 KPIs, 3 in alert state) */
  kpiAlerts: KPIAlert[];
  /** Financial Health Score: 5 components (Profitability, Liquidity, Efficiency, Growth, Risk) + overall + grade */
  healthScore: FinancialHealthScore;
  /** 6 strategic insight seeds (P1/P2/P3) — AI expands into full insights */
  strategicInsightsSeeds: Array<{
    id: string;
    priority: 'P1' | 'P2' | 'P3';
    category: string;
    trigger: string;
    impact?: string;
    urgency?: string;
  }>;
  fileName?: string;
}

const CFO_SERVICES_CONTEXT_KEY = 'cfo_services_context';

export function loadCFOServicesContext(): CFOServicesContext | null {
  try {
    const raw = localStorage.getItem('finreport_cfo_context') || localStorage.getItem(CFO_SERVICES_CONTEXT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveCFOServicesContext(ctx: CFOServicesContext): void {
  localStorage.setItem(CFO_SERVICES_CONTEXT_KEY, JSON.stringify(ctx));
}
