import type { KPIAlert, FinancialHealthScore } from './cfo';

/** Bump when persisted shape or parser semantics change in a breaking way. */
export const CFO_SERVICES_CONTEXT_VERSION = 2;

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
  /** Persistence schema version — absent/legacy values are discarded on load. */
  _schemaVersion?: number;
}

const CFO_SERVICES_CONTEXT_KEY = 'cfo_services_context';
const LEGACY_KEYS = ['finreport_cfo_context', CFO_SERVICES_CONTEXT_KEY] as const;

function clearLegacyKeys(): void {
  for (const key of LEGACY_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

/** True when a stored blob is safe to treat as a post-Step-2 upload context. */
export function isCurrentCFOServicesContext(raw: unknown): raw is CFOServicesContext {
  if (!raw || typeof raw !== 'object') return false;
  const v = (raw as CFOServicesContext)._schemaVersion;
  return v === CFO_SERVICES_CONTEXT_VERSION;
}

export function loadCFOServicesContext(): CFOServicesContext | null {
  try {
    const raw =
      localStorage.getItem('finreport_cfo_context') || localStorage.getItem(CFO_SERVICES_CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isCurrentCFOServicesContext(parsed)) {
      // Drop pre-Step-2 / unversioned contexts so invented health scores cannot resurface as uploads.
      clearLegacyKeys();
      return null;
    }
    return parsed;
  } catch {
    clearLegacyKeys();
    return null;
  }
}

export function saveCFOServicesContext(ctx: CFOServicesContext): void {
  const stamped: CFOServicesContext = { ...ctx, _schemaVersion: CFO_SERVICES_CONTEXT_VERSION };
  localStorage.setItem(CFO_SERVICES_CONTEXT_KEY, JSON.stringify(stamped));
  localStorage.setItem('finreport_cfo_context', JSON.stringify(stamped));
}
