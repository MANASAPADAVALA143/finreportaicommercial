import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BarChart2, GitCompare, Dices } from 'lucide-react';
import { ScenarioControlPanel } from '../../components/scenario/ScenarioControlPanel';
import { ScenarioKPIBar } from '../../components/scenario/ScenarioKPIBar';
import { LivePLView } from '../../components/scenario/LivePLView';
import { CompareView } from '../../components/scenario/CompareView';
import { MonteCarloView } from '../../components/scenario/MonteCarloView';
import type { ScenarioType, ScenarioAssumptions, ScenarioResult } from '../../types/scenarioEngine';
import { DEFAULT_ASSUMPTIONS } from '../../types/scenarioEngine';
import { calculateScenario } from '../../services/scenarioCalculator';
import { api } from '../../services/api';
import toast from 'react-hot-toast';

type ViewTab = 'live' | 'compare' | 'monte';

const SCENARIO_LABELS: Record<ScenarioType, string> = {
  base: 'Base',
  growth: 'Growth',
  conservative: 'Conservative',
  stress: 'Stress',
};

const BASE_REVENUE_CR = 40;
const OPENING_CASH_CR = 8;

function buildResult(
  assumptions: ScenarioAssumptions,
  type: ScenarioType,
  aiNarrative = '',
  baseRevenueCr = BASE_REVENUE_CR,
  openingCashCr = OPENING_CASH_CR
): ScenarioResult {
  const calc = calculateScenario(assumptions, type, baseRevenueCr, openingCashCr);
  return { ...calc, aiNarrative };
}

const SNAPSHOT_KEY = 'fpa_scenario_snapshots';

interface SavedSnapshot {
  id: string;
  name: string;
  scenarioType: ScenarioType;
  assumptions: ScenarioAssumptions;
  savedAt: string;
  kpis: ScenarioResult['annualKPIs'];
}

export const ScenarioEngine: React.FC = () => {
  const navigate = useNavigate();
  const [scenarioType, setScenarioType] = useState<ScenarioType>('base');
  const [assumptions, setAssumptions] = useState<ScenarioAssumptions>(DEFAULT_ASSUMPTIONS.base);
  const [viewTab, setViewTab] = useState<ViewTab>('live');
  const [fpaData, setFpaData] = useState<ReturnType<typeof loadFPAData>>(null);
  const [aiNarratives, setAiNarratives] = useState<Record<ScenarioType, string>>({
    base: '',
    growth: '',
    conservative: '',
    stress: '',
  });

  useEffect(() => {
    setFpaData(loadFPAData());
  }, []);

  const baseRevenueCr = fpaData ? fpaData.totalRevenue / 1e7 : BASE_REVENUE_CR;
  const openingCashCr = fpaData ? fpaData.cashAndEquivalents / 1e7 : OPENING_CASH_CR;

  const baseResult = useMemo(
    () => buildResult(DEFAULT_ASSUMPTIONS.base, 'base', '', baseRevenueCr, openingCashCr),
    [baseRevenueCr, openingCashCr]
  );

  const currentResult = useMemo(() => {
    const narrative = aiNarratives[scenarioType];
    return buildResult(assumptions, scenarioType, narrative, baseRevenueCr, openingCashCr);
  }, [assumptions, scenarioType, aiNarratives, baseRevenueCr, openingCashCr]);

  const allResults = useMemo(
    () =>
      (['base', 'growth', 'conservative', 'stress'] as ScenarioType[]).reduce(
        (acc, t) => {
          const a = t === scenarioType ? assumptions : DEFAULT_ASSUMPTIONS[t];
          acc[t] = buildResult(a, t, aiNarratives[t] || '', baseRevenueCr, openingCashCr);
          return acc;
        },
        {} as Record<ScenarioType, ScenarioResult>
      ),
    [assumptions, scenarioType, aiNarratives, baseRevenueCr, openingCashCr]
  );

  const generateNarrative = useCallback(async (type: ScenarioType, result: ScenarioResult) => {
    const base = allResults.base;
    const prompt = `You are a senior CFO advisor analyzing financial scenarios.

Scenario: ${type.toUpperCase()} CASE
Annual Revenue:    ₹${result.annualKPIs.revenue}Cr
Gross Margin:      ${result.annualKPIs.grossMarginPct}%
EBITDA:            ₹${result.annualKPIs.ebitda}Cr (${result.annualKPIs.ebitdaMarginPct}%)
Net Profit:        ₹${result.annualKPIs.netProfit}Cr
End Cash:          ₹${result.annualKPIs.endCash}Cr

vs Base Case:
Revenue delta:     ₹${(result.annualKPIs.revenue - base.annualKPIs.revenue).toFixed(1)}Cr
EBITDA delta:      ₹${(result.annualKPIs.ebitda - base.annualKPIs.ebitda).toFixed(1)}Cr

Key assumptions used:
Revenue Growth: ${result.assumptions.revenueGrowthRate}%
Churn Rate: ${result.assumptions.churnRate}%
COGS: ${result.assumptions.cogsPercent}%

Write a 3-sentence CFO-level narrative:
1. Overall performance summary vs base
2. Key driver of difference
3. One risk or recommendation

Be specific with numbers. Professional tone. No bullet points.`;

    try {
      const res = await api.analyzeWithNova(prompt);
      const text = typeof res === 'string' ? res : (res.response ?? res.analysis ?? JSON.stringify(res));
      setAiNarratives((prev) => ({ ...prev, [type]: text }));
    } catch {
      const fallback =
        `Under the ${SCENARIO_LABELS[type]} scenario, revenue reaches ₹${result.annualKPIs.revenue.toFixed(1)}Cr (FY2026), ` +
        `with EBITDA at ₹${result.annualKPIs.ebitda.toFixed(1)}Cr (${result.annualKPIs.ebitdaMarginPct.toFixed(1)}% margin). ` +
        `Net profit ₹${result.annualKPIs.netProfit.toFixed(1)}Cr. End cash ₹${result.annualKPIs.endCash.toFixed(1)}Cr.`;
      setAiNarratives((prev) => ({ ...prev, [type]: fallback }));
      toast.error('AI narrative unavailable, using summary');
    }
  }, [allResults.base]);

  useEffect(() => {
    if (!aiNarratives[scenarioType]) {
      generateNarrative(scenarioType, currentResult);
    }
  }, [scenarioType]);

  const handleScenarioChange = (t: ScenarioType) => {
    setScenarioType(t);
    setAssumptions(DEFAULT_ASSUMPTIONS[t]);
  };

  const handleSaveSnapshot = () => {
    const snap: SavedSnapshot = {
      id: Date.now().toString(),
      name: `${SCENARIO_LABELS[scenarioType]} - ${new Date().toLocaleString()}`,
      scenarioType,
      assumptions: { ...assumptions },
      savedAt: new Date().toISOString(),
      kpis: { ...currentResult.annualKPIs },
    };
    try {
      const stored = localStorage.getItem(SNAPSHOT_KEY);
      const list: SavedSnapshot[] = stored ? JSON.parse(stored) : [];
      list.unshift(snap);
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(list.slice(0, 20)));
      toast.success('Scenario snapshot saved');
    } catch {
      toast.error('Failed to save snapshot');
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0F1E] text-[#F1F5F9]">
      <div className="border-b border-[#1E2D45] bg-[#0D1426] px-4 py-3">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/fpa')}
            className="flex items-center gap-2 text-sm text-[#94A3B8] hover:text-[#F1F5F9]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="text-sm text-[#64748B]">FinReportAI / FP&A / Scenario Engine</div>
        </div>
      </div>

      <div className="flex h-[calc(100vh-56px)]">
        <ScenarioControlPanel
          scenarioType={scenarioType}
          assumptions={assumptions}
          onScenarioChange={handleScenarioChange}
          onAssumptionsChange={setAssumptions}
          onSaveSnapshot={handleSaveSnapshot}
        />

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <ScenarioKPIBar
            kpis={currentResult.annualKPIs}
            baseKPIs={baseResult.annualKPIs}
            isBaseCase={scenarioType === 'base'}
          />

          <div className="flex items-center gap-2 p-2 border-b border-[#1E2D45] bg-[#0D1426]">
            {(
              [
                { id: 'live' as const, label: 'Live P&L', Icon: BarChart2 },
                { id: 'compare' as const, label: 'Compare', Icon: GitCompare },
                { id: 'monte' as const, label: 'Monte Carlo', Icon: Dices },
              ] as const
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setViewTab(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  viewTab === id
                    ? 'bg-[#3B82F6] text-white'
                    : 'text-[#94A3B8] hover:bg-[#111827] hover:text-[#F1F5F9]'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {!fpaData && (
              <div className="mb-4 rounded-lg bg-[#1E2D45] border border-[#334155] px-4 py-3 text-sm text-[#94A3B8]">
                Upload your trial balance in <strong className="text-[#F1F5F9]">FP&A → Scenario Planning</strong> to see scenarios based on your data. Until then, default base revenue (₹40 Cr) and opening cash (₹8 Cr) are used.
              </div>
            )}
            {viewTab === 'live' && (
              <LivePLView
                result={currentResult}
                baseResult={baseResult}
                onRegenerateNarrative={() => generateNarrative(scenarioType, currentResult)}
              />
            )}
            {viewTab === 'compare' && <CompareView results={allResults} />}
            {viewTab === 'monte' && (
              <MonteCarloView
                baseAssumptions={assumptions}
                baseAnnualRevenue={baseRevenueCr}
                openingCashCr={openingCashCr}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
