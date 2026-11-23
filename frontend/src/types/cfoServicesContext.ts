import type { KPIAlert, FinancialHealthScore } from './cfo';

/** Parsed from CFO_Services_Context sheet (central upload). */

export interface CFOServicesContext {
  /** Financial metrics block for AI Assistant (from upload sheet) */
  aiAssistantContext: string;
  /** KPI Monitor alerts — empty when the sheet has none */
  kpiAlerts: KPIAlert[];
  /**
   * Financial Health Score from the upload sheet.
   * Null/undefined when the sheet has no health section — callers must not invent a score.
   */
  healthScore?: FinancialHealthScore | null;
  /** Strategic insight seeds — empty when the sheet has none */
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
