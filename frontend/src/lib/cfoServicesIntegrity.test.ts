import { describe, expect, it } from 'vitest';
import {
  SAFE_SUGGESTED_QUESTIONS,
  applyUploadContext,
  assessUploadCompleteness,
  assistantSourcesFor,
  buildChatPrompt,
  canClaimLedger,
  chatAllowed,
  emptyOperationalState,
  looksLikeRetiredMockIdentity,
  sourceLabel,
} from './cfoServicesIntegrity';
import {
  financialContext,
  mockHealthScore,
  mockInsights,
} from '../data/cfoMockData';

describe('emptyOperationalState', () => {
  it('does not show synthetic figures or MANASA identity', () => {
    const state = emptyOperationalState();
    expect(state.source).toBe('unavailable');
    expect(state.insights).toEqual([]);
    expect(state.alerts).toEqual([]);
    expect(state.healthScore).toBeNull();
    expect(state.effectiveContext).toBe('');
    expect(looksLikeRetiredMockIdentity(state.messages[0].content)).toBe(false);
    expect(state.messages[0].content).not.toMatch(/₹33|Net Profit ₹5/);
  });
});

describe('API / chat failure policy', () => {
  it('does not allow chat without a loaded source', () => {
    expect(chatAllowed('unavailable', false)).toBe(false);
    expect(chatAllowed('upload', false)).toBe(false);
    expect(chatAllowed('upload', true)).toBe(true);
    expect(chatAllowed('demo', true)).toBe(true);
  });

  it('never claims ledger without ledger source', () => {
    expect(canClaimLedger('upload')).toBe(false);
    expect(canClaimLedger('demo')).toBe(false);
    expect(canClaimLedger('unavailable')).toBe(false);
    expect(canClaimLedger('ledger')).toBe(true);
  });

  it('prompt discloses source and refuses invention language for unavailable', () => {
    const demo = buildChatPrompt('cash?', 'x', 'demo');
    expect(demo).toMatch(/DEMO/);
    const upload = buildChatPrompt('cash?', 'uploaded block', 'upload');
    expect(upload).toMatch(/UPLOADED/);
    expect(upload).not.toMatch(/POSTED LEDGER/);
    const sources = assistantSourcesFor('upload');
    expect(sources.some((s) => /Uploaded/i.test(s))).toBe(true);
    expect(sources.some((s) => /Live ledger/i.test(s))).toBe(false);
  });
});

describe('demo identification', () => {
  it('labels demo clearly and keeps mock pack identifiable', () => {
    expect(sourceLabel('demo')).toBe('Demo data');
    expect(looksLikeRetiredMockIdentity(financialContext)).toBe(true);
    expect(mockInsights.length).toBeGreaterThan(0);
    expect(mockHealthScore.overall).toBeGreaterThan(0);
  });
});

describe('upload integrity', () => {
  it('identifies uploaded data and does not invent health from partial upload', () => {
    const partial = applyUploadContext({
      aiAssistantContext: 'Revenue: 100\nExpenses: 80',
      kpiAlerts: [],
      healthScore: null,
      strategicInsightsSeeds: [{ id: '1', priority: 'P1', category: 'cash', trigger: 'Cash tight' }],
      fileName: 'partial.xlsx',
    });
    expect(partial.source).toBe('upload');
    expect(partial.healthScore).toBeNull();
    expect(partial.insights.length).toBe(1);
    expect(partial.warning).toMatch(/Health score was not present|incomplete/i);
    expect(partial.messages[0].dataSource).toBe('upload');
    expect(partial.effectiveContext).toMatch(/from upload/);
    expect(partial.effectiveContext).not.toMatch(/posted ledger\)\nCOMPANY FINANCIAL DATA — October/);
  });

  it('marks incomplete upload when almost empty', () => {
    const c = assessUploadCompleteness({
      aiAssistantContext: 'x',
      kpiAlerts: [],
      strategicInsightsSeeds: [],
    });
    expect(c.isComplete).toBe(false);
    expect(c.missing).toContain('assistant context');
  });

  it('accepts complete upload with health', () => {
    const applied = applyUploadContext({
      aiAssistantContext: 'Revenue: 100\nCash: 50\nMargin: 20%\nRunway: 12 months',
      kpiAlerts: [
        {
          id: 'a1',
          kpi: 'Margin',
          current: 10,
          threshold: 15,
          severity: 'warning',
          message: 'low',
          recommendation: 'fix',
          triggeredAt: new Date().toISOString(),
        },
      ],
      healthScore: mockHealthScore,
      strategicInsightsSeeds: [{ id: '1', priority: 'P1', category: 'cost', trigger: 'Costs up' }],
      fileName: 'full.xlsx',
    });
    expect(applied.completeness.isComplete).toBe(true);
    expect(applied.healthScore?.overall).toBe(mockHealthScore.overall);
    expect(sourceLabel(applied.source)).toBe('Uploaded Excel/CSV');
  });
});

describe('mixed-source prevention', () => {
  it('empty state does not mix demo figures into context', () => {
    const empty = emptyOperationalState();
    expect(empty.effectiveContext).toBe('');
    expect(empty.insights).toHaveLength(0);
  });

  it('safe suggested questions contain no monetary demo figures', () => {
    for (const q of SAFE_SUGGESTED_QUESTIONS) {
      expect(q).not.toMatch(/₹|MANASA|33Cr/);
    }
  });
});

describe('parser — no synthetic health fill', () => {
  it('returns null health when health section is absent', async () => {
    const { parseCFOServicesContextFromRows } = await import('../utils/cfoContextParser');
    const ctx = parseCFOServicesContextFromRows(
      [
        { Section: 'AI Assistant', Metric: 'Revenue', Value: '100' },
        { Section: 'AI Assistant', Metric: 'Cash', Value: '50' },
      ],
      'ai-only.xlsx'
    );
    expect(ctx).not.toBeNull();
    expect(ctx!.healthScore).toBeNull();
    expect(ctx!.aiAssistantContext).toMatch(/Revenue/);
  });

  it('keeps missing health components as null, not zero', async () => {
    const { parseCFOServicesContextFromRows } = await import('../utils/cfoContextParser');
    const ctx = parseCFOServicesContextFromRows(
      [
        { Section: 'Financial Health', Overall: 70, Grade: 'B', Profitability: 65 },
      ],
      'partial-health.xlsx'
    );
    expect(ctx!.healthScore?.overall).toBe(70);
    expect(ctx!.healthScore?.components.profitability).toBe(65);
    expect(ctx!.healthScore?.components.liquidity).toBeNull();
    expect(ctx!.healthScore?.components.efficiency).toBeNull();
    expect(ctx!.healthScore?.benchmarkVsIndustry).toBeNull();
  });
});

describe('localStorage schema versioning', () => {
  it('rejects unversioned legacy contexts', async () => {
    const { isCurrentCFOServicesContext, CFO_SERVICES_CONTEXT_VERSION } = await import(
      '../types/cfoServicesContext'
    );
    expect(CFO_SERVICES_CONTEXT_VERSION).toBe(2);
    expect(isCurrentCFOServicesContext({ aiAssistantContext: 'x'.repeat(30), kpiAlerts: [], strategicInsightsSeeds: [] })).toBe(
      false
    );
    expect(
      isCurrentCFOServicesContext({
        aiAssistantContext: 'x'.repeat(30),
        kpiAlerts: [],
        strategicInsightsSeeds: [],
        _schemaVersion: 2,
      })
    ).toBe(true);
  });
});
