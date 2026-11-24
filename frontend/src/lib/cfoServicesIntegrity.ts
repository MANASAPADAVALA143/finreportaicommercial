/**
 * CFO Services data-source integrity helpers.
 * Pure functions — no React, no network. Used by CFOServices and unit tests.
 */

import type { ChatMessage, FinancialHealthScore, KPIAlert, StrategicInsight } from '../types/cfo';
import type { CFOServicesContext } from '../types/cfoServicesContext';

export type CFODataSource = 'demo' | 'upload' | 'ledger' | 'unavailable';

export type UploadCompleteness = {
  hasAssistantContext: boolean;
  hasHealthScore: boolean;
  hasInsights: boolean;
  hasAlerts: boolean;
  /** True when enough fields exist to treat the upload as a usable financial context. */
  isComplete: boolean;
  missing: string[];
};

export const SOURCE_LABELS: Record<CFODataSource, string> = {
  demo: 'Demo data',
  upload: 'Uploaded Excel/CSV',
  ledger: 'Live ledger',
  unavailable: 'Data unavailable',
};

export const NEUTRAL_WELCOME: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content:
    'Welcome to CFO Services. No company financial figures are loaded yet.\n\n' +
    '• Upload an Excel/CSV with a CFO_Services_Context sheet, or\n' +
    '• Load the labelled demo sample (illustrative only).\n\n' +
    'For analysis of posted ledger data, use the AI CFO Command Centre.',
  timestamp: new Date(0).toISOString(),
  sources: ['System'],
  dataSource: 'unavailable',
};

/** Questions only — no monetary figures. Safe for all source states. */
export const SAFE_SUGGESTED_QUESTIONS = [
  'What is our biggest financial risk right now?',
  'Why did gross margins change this period?',
  'What is our cash runway at the current burn rate?',
  'Which cost centre is most over budget?',
];

export function assessUploadCompleteness(ctx: Partial<CFOServicesContext> | null | undefined): UploadCompleteness {
  const hasAssistantContext = !!(ctx?.aiAssistantContext && ctx.aiAssistantContext.trim().length > 20);
  const hs = ctx?.healthScore;
  const hasHealthScore = !!(
    hs &&
    typeof hs.overall === 'number' &&
    Number.isFinite(hs.overall) &&
    hs.overall > 0 &&
    hs.components &&
    // At least one component must be an explicit number — null/missing stays unavailable.
    Object.values(hs.components).some((v) => typeof v === 'number' && Number.isFinite(v))
  );
  const hasInsights = Array.isArray(ctx?.strategicInsightsSeeds) && ctx!.strategicInsightsSeeds!.length > 0;
  const hasAlerts = Array.isArray(ctx?.kpiAlerts) && ctx!.kpiAlerts!.length > 0;

  const missing: string[] = [];
  if (!hasAssistantContext) missing.push('assistant context');
  if (!hasHealthScore) missing.push('health score');
  if (!hasInsights) missing.push('strategic insights');
  if (!hasAlerts) missing.push('KPI alerts');

  // Complete enough to operate as "upload" when we have real context plus at least one panel.
  const isComplete = hasAssistantContext && (hasHealthScore || hasInsights || hasAlerts);

  return { hasAssistantContext, hasHealthScore, hasInsights, hasAlerts, isComplete, missing };
}

export function sourceLabel(source: CFODataSource): string {
  return SOURCE_LABELS[source];
}

export function canClaimLedger(source: CFODataSource): boolean {
  return source === 'ledger';
}

export function chatAllowed(source: CFODataSource, hasContext: boolean): boolean {
  if (source === 'unavailable') return false;
  if (source === 'ledger') return true;
  return hasContext;
}

export function buildChatPrompt(userMessage: string, context: string, source: CFODataSource): string {
  const disclosure =
    source === 'demo'
      ? 'DATA SOURCE: DEMO / ILLUSTRATIVE SAMPLE. Do not present these figures as the customer\'s live books.'
      : source === 'upload'
        ? 'DATA SOURCE: USER-UPLOADED SPREADSHEET (not posted ledger). Label answers as based on uploaded data.'
        : source === 'ledger'
          ? 'DATA SOURCE: POSTED LEDGER.'
          : 'DATA SOURCE: UNAVAILABLE. Refuse to invent figures.';

  return `You are a CFO AI Assistant with deep financial expertise.
${disclosure}
Answer the CFO's question based ONLY on the financial data provided below.
If the data is insufficient, say so — never invent monetary figures.
Be specific with numbers only when they appear in the data.
Format with bullet points for lists.
Keep response under 200 words unless detailed analysis is requested.
End with 1 recommended action if relevant.

${context || '(No financial context provided.)'}

USER QUESTION: ${userMessage}`;
}

export function assistantSourcesFor(source: CFODataSource): string[] {
  return [sourceLabel(source), 'CFO Services AI'];
}

export type AppliedUploadState = {
  source: CFODataSource;
  insights: StrategicInsight[];
  alerts: KPIAlert[];
  healthScore: FinancialHealthScore | null;
  effectiveContext: string;
  completeness: UploadCompleteness;
  messages: ChatMessage[];
  warning: string | null;
};

export function applyUploadContext(ctx: CFOServicesContext): AppliedUploadState {
  const completeness = assessUploadCompleteness(ctx);
  const insights: StrategicInsight[] = (ctx.strategicInsightsSeeds ?? []).map((s, i) => ({
    id: `ctx-ins-${i + 1}`,
    category: (s.category?.toLowerCase().slice(0, 5) === 'revenu'
      ? 'revenue'
      : s.category?.toLowerCase().slice(0, 4) === 'cost'
        ? 'cost'
        : s.category?.toLowerCase().slice(0, 4) === 'cash'
          ? 'cash'
          : s.category?.toLowerCase().slice(0, 4) === 'risk'
            ? 'risk'
            : 'opportunity') as StrategicInsight['category'],
    title: s.trigger?.slice(0, 60) || s.category || 'Insight',
    summary: s.trigger || '',
    detail: s.trigger || '',
    impact: (s.impact?.toLowerCase().includes('high')
      ? 'high'
      : s.impact?.toLowerCase().includes('medium')
        ? 'medium'
        : 'low') as StrategicInsight['impact'],
    urgency: (s.urgency?.toLowerCase().includes('immediate')
      ? 'immediate'
      : s.urgency?.toLowerCase().includes('week')
        ? 'this_week'
        : 'this_month') as StrategicInsight['urgency'],
    action: 'Review and act per priority.',
    generatedAt: new Date().toISOString(),
  }));

  const healthScore = completeness.hasHealthScore ? (ctx.healthScore as FinancialHealthScore) : null;
  const effectiveContext = completeness.hasAssistantContext
    ? `COMPANY FINANCIAL DATA (from upload — not posted ledger):\n${ctx.aiAssistantContext}`
    : '';

  let warning: string | null = null;
  if (!completeness.isComplete) {
    warning = `Upload is incomplete (missing: ${completeness.missing.join(', ')}). Incomplete sections stay empty — demo figures are not used to fill gaps.`;
  } else if (!completeness.hasHealthScore) {
    warning = 'Health score was not present in the upload. The Health tab stays empty rather than inventing a score.';
  }

  const welcome: ChatMessage = {
    id: 'welcome-upload',
    role: 'assistant',
    content: completeness.isComplete
      ? `Loaded uploaded context from "${ctx.fileName || 'spreadsheet'}". Answers will use uploaded data only (not the posted ledger).`
      : `Partial upload from "${ctx.fileName || 'spreadsheet'}". ${warning}`,
    timestamp: new Date().toISOString(),
    sources: [SOURCE_LABELS.upload],
    dataSource: 'upload',
  };

  return {
    source: completeness.isComplete || completeness.hasAssistantContext || completeness.hasInsights || completeness.hasAlerts
      ? 'upload'
      : 'unavailable',
    insights: completeness.hasInsights ? insights : [],
    alerts: completeness.hasAlerts ? (ctx.kpiAlerts ?? []) : [],
    healthScore,
    effectiveContext,
    completeness,
    messages: [welcome],
    warning,
  };
}

export function emptyOperationalState(): {
  source: CFODataSource;
  insights: StrategicInsight[];
  alerts: KPIAlert[];
  healthScore: FinancialHealthScore | null;
  effectiveContext: string;
  messages: ChatMessage[];
} {
  return {
    source: 'unavailable',
    insights: [],
    alerts: [],
    healthScore: null,
    effectiveContext: '',
    messages: [{ ...NEUTRAL_WELCOME, timestamp: new Date().toISOString() }],
  };
}

/** True if a string looks like the retired MANASA / fabricated sample identity. */
export function looksLikeRetiredMockIdentity(text: string): boolean {
  return /MANASA|₹33\.0Cr|FinReport AI\n\nP&L ACTUALS/i.test(text);
}
