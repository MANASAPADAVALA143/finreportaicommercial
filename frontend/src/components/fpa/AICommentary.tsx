import { useEffect, useMemo, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import type { VarianceRow } from '../../types/fpa';

const API_BASE = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || '';

type CommentaryTabId = 'executive' | 'cfo' | 'board' | 'risk';
type CommentaryState = Record<CommentaryTabId, string>;

const COMMENTARY_TABS: { id: CommentaryTabId; label: string; icon: string }[] = [
  { id: 'executive', label: 'Executive Summary', icon: '📋' },
  { id: 'cfo', label: 'CFO Commentary', icon: '💼' },
  { id: 'board', label: 'Board Narrative', icon: '🏛️' },
  { id: 'risk', label: 'Risk Flags', icon: '🚨' },
];

interface Props {
  varianceData: VarianceRow[];
  period: string;
  entityName: string;
  currency?: string;
  currencyFormat?: string;
}

function toVariancePayload(rows: VarianceRow[]) {
  return rows
    .filter((r) => !r.isHeader)
    .map((r) => ({
      account: r.category,
      budget: Number(r.budget) || 0,
      actual: Number(r.actual) || 0,
      variance: Number(r.variance) || 0,
      variance_pct: Number(r.variancePct) || 0,
      department: r.department || 'All Depts',
    }));
}

// ── Client-side fallback commentary (no backend needed) ──────────────────────

function buildLocalCommentary(
  type: CommentaryTabId,
  rows: ReturnType<typeof toVariancePayload>,
  period: string,
  entityName: string,
  currency: string,
): string {
  const fmt = (n: number) => {
    const abs = Math.abs(n);
    const sym = currency || 'AED';
    if (abs >= 1_000_000) return `${sym} ${(n / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000)     return `${sym} ${Math.round(n).toLocaleString()}`;
    return `${sym} ${n.toFixed(0)}`;
  };

  const revenue   = rows.filter(r => /revenue|license|service|maintenance|subscription/i.test(r.account));
  const expenses  = rows.filter(r => /salary|cloud|infra|staff|marketing|admin|overhead/i.test(r.account));
  const totalRev  = revenue.reduce((s, r) => s + r.actual, 0);
  const totalBudRev = revenue.reduce((s, r) => s + r.budget, 0);
  const totalExp  = expenses.reduce((s, r) => s + r.actual, 0);
  const totalBudExp = expenses.reduce((s, r) => s + r.budget, 0);
  const revVar    = totalRev - totalBudRev;
  const revVarPct = totalBudRev ? (revVar / totalBudRev * 100) : 0;
  const expVar    = totalExp - totalBudExp;
  const topMiss   = [...rows].sort((a, b) => (a.actual - a.budget) - (b.actual - b.budget)).slice(0, 3);
  const topOver   = [...rows].sort((a, b) => (b.actual - b.budget) - (a.actual - a.budget)).slice(0, 3).filter(r => r.actual > r.budget);

  if (type === 'executive') return `EXECUTIVE SUMMARY — ${entityName} | ${period}

Revenue performance: Actual ${fmt(totalRev)} vs budget ${fmt(totalBudRev)} (${revVarPct >= 0 ? '+' : ''}${revVarPct.toFixed(1)}%).
${revVar < 0 ? `Revenue shortfall of ${fmt(Math.abs(revVar))} driven by delays in key contracts.` : `Revenue outperformed budget by ${fmt(revVar)}, reflecting strong commercial momentum.`}

Cost base: Actual ${fmt(totalExp)} vs budget ${fmt(totalBudExp)}. ${expVar > 0 ? `Overspend of ${fmt(expVar)} primarily in headcount and infrastructure.` : `Cost discipline maintained with ${fmt(Math.abs(expVar))} underspend.`}

Key variances requiring attention:
${topMiss.map(r => `• ${r.account}: ${fmt(r.actual - r.budget)} (${((r.actual - r.budget) / r.budget * 100).toFixed(1)}%)`).join('\n')}

Overall: ${revVarPct < -5 ? 'Performance below plan — management intervention required to close year-end gap.' : revVarPct > 5 ? 'Strong performance above plan — review upside sustainability for rolling forecast.' : 'Performance broadly in line with plan — monitor key risk items.'}`;

  if (type === 'cfo') {
  // Compute revenue vs expense split of total variance impact
  const revMiss   = totalRev - totalBudRev;            // negative = miss
  const expOver   = totalExp - totalBudExp;            // positive = overrun
  const totalImpact = Math.abs(revMiss) + Math.abs(expOver);
  const revPctOfImpact = totalImpact > 0 ? (Math.abs(revMiss) / totalImpact * 100) : 0;
  const expPctOfImpact = totalImpact > 0 ? (Math.abs(expOver) / totalImpact * 100) : 0;
  const totalVariance  = revMiss - expOver;            // net profit variance

  return `CFO COMMENTARY — ${entityName} | ${period}

⚡ KEY INSIGHT: Revenue underperformance accounts for ${revPctOfImpact.toFixed(0)}% of the total profit variance of ${fmt(Math.abs(totalVariance))}. Cost overruns account for the remaining ${expPctOfImpact.toFixed(0)}%. Management focus should prioritise revenue recovery, not cost reduction.

${entityName} delivered revenue of ${fmt(totalRev)} in ${period}, representing a ${Math.abs(revVarPct).toFixed(1)}% ${revVar < 0 ? 'shortfall' : 'outperformance'} vs budget of ${fmt(totalBudRev)}.

REVENUE ANALYSIS
${revenue.map(r => {
  const v = r.actual - r.budget;
  const pct = r.budget ? (v / r.budget * 100) : 0;
  return `${r.account}: ${fmt(r.actual)} actual vs ${fmt(r.budget)} budget (${v >= 0 ? '+' : ''}${pct.toFixed(1)}%) — ${Math.abs(pct) > 10 ? '⚠️ Requires investigation' : '✓ Within tolerance'}`;
}).join('\n')}

COST ANALYSIS
${expenses.map(r => {
  const v = r.actual - r.budget;
  const pct = r.budget ? (v / r.budget * 100) : 0;
  return `${r.account}: ${fmt(r.actual)} actual vs ${fmt(r.budget)} budget (${v >= 0 ? '+' : ''}${pct.toFixed(1)}%) — ${v > 0 && Math.abs(pct) > 5 ? '⚠️ Over budget' : '✓ Controlled'}`;
}).join('\n')}

CFO RECOMMENDATION: ${totalRev < totalBudRev && totalExp > totalBudExp ? 'Both revenue miss and cost overrun require immediate attention. Trigger contingency plan.' : totalRev < totalBudRev ? 'Focus on revenue recovery. Chase delayed contracts and update rolling forecast.' : 'Cost discipline required. Review open purchase orders and hiring plan.'}`;
  } // end cfo

  if (type === 'board') return `BOARD NARRATIVE — ${entityName} | ${period}

The company recorded ${period} revenue of ${fmt(totalRev)}, ${revVar >= 0 ? 'exceeding' : 'falling short of'} the board-approved budget of ${fmt(totalBudRev)} by ${fmt(Math.abs(revVar))} (${Math.abs(revVarPct).toFixed(1)}%).

PERFORMANCE HIGHLIGHTS
${topOver.length ? `✅ Favorable: ${topOver.map(r => `${r.account} ${fmt(r.actual - r.budget)} ahead of plan`).join('; ')}` : ''}
${topMiss.filter(r => r.actual < r.budget).map(r => `⚠️ Below plan: ${r.account} ${fmt(Math.abs(r.actual - r.budget))} behind plan`).join('\n')}

FULL YEAR OUTLOOK
Based on YTD performance, the company is tracking ${revVarPct < -3 ? 'below' : 'in line with'} the full-year revenue target. Management is ${revVar < 0 ? 'actively pursuing delayed contracts and pipeline acceleration to close the gap.' : 'focused on sustaining momentum through Q4.'}

BOARD DECISION ITEMS
1. ${revVar < -totalBudRev * 0.05 ? 'Approve revised revenue forecast reflecting contract delays' : 'Confirm full-year guidance maintained'}
2. ${expVar > totalBudExp * 0.05 ? 'Review and approve/reject additional spend requests above budget' : 'No budget reallocation required at this stage'}
3. Review cash position and credit facility utilisation`;

  // risk
  return `RISK FLAGS — ${entityName} | ${period}

🔴 REVENUE CONCENTRATION RISK
${revenue.filter(r => r.actual < r.budget * 0.9).map(r => `${r.account} is ${((1 - r.actual / r.budget) * 100).toFixed(0)}% below plan. Client dependency risk if this represents a single customer.`).join('\n') || 'Revenue risks within acceptable range.'}

🟡 COST OVERRUN RISK
${expenses.filter(r => r.actual > r.budget * 1.05).map(r => `${r.account}: ${fmt(r.actual - r.budget)} (${((r.actual / r.budget - 1) * 100).toFixed(1)}%) over budget. Approval required for continued overspend.`).join('\n') || 'All cost lines within 5% tolerance.'}

🟠 MARGIN COMPRESSION
${totalRev > 0 && totalExp / totalRev > (totalBudExp / totalBudRev) * 1.05 ? `Cost-to-revenue ratio deteriorated vs budget. EBITDA margin at risk of falling below board threshold.` : 'Margins broadly in line with budget.'}

🔵 FORECAST RISK
${revVarPct < -5 ? `YTD revenue shortfall of ${fmt(Math.abs(revVar))} may not fully recover. Year-end forecast should be revised downward pending pipeline review.` : 'Full-year forecast risk remains manageable.'}

RECOMMENDED MANAGEMENT ACTIONS
1. ${rows.sort((a, b) => Math.abs(b.actual - b.budget) - Math.abs(a.actual - a.budget))[0]?.account || 'Top variance item'} — investigate and provide written explanation to CFO within 5 business days
2. Update rolling 3-month forecast incorporating latest contract status
3. Schedule CEO/CFO review if EBITDA run-rate falls below 10%`;
}

export const AICommentary = ({ varianceData, period, entityName, currency }: Props) => {
  const [activeTab, setActiveTab] = useState<CommentaryTabId>('cfo');
  const [texts, setTexts] = useState<CommentaryState>({
    executive: '',
    cfo: '',
    board: '',
    risk: '',
  });
  const [loading, setLoading] = useState(false);
  const [loadedTabs, setLoadedTabs] = useState<Set<CommentaryTabId>>(new Set());

  const payloadRows = useMemo(() => toVariancePayload(varianceData), [varianceData]);
  const hasData = payloadRows.length > 0;

  const generateCommentary = async (type: CommentaryTabId, force = false) => {
    if (!hasData || loading) return;
    if (!force && loadedTabs.has(type) && texts[type]) { setActiveTab(type); return; }
    setActiveTab(type);
    setLoading(true);
    setTexts((prev) => ({ ...prev, [type]: '' }));

    // Try backend stream first; fall back to client-side generation
    let usedBackend = false;
    if (API_BASE) {
      try {
        const response = await fetch(`${API_BASE}/api/fpa/variance/commentary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variance_data: payloadRows, commentary_type: type, period, entity_name: entityName }),
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok) {
          const reader = response.body?.getReader();
          if (reader) {
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const events = buffer.split('\n\n');
              buffer = events.pop() || '';
              for (const evt of events) {
                for (const line of evt.split('\n')) {
                  if (line.startsWith('data: ')) {
                    const chunk = line.slice(6);
                    if (chunk !== '[DONE]') setTexts((prev) => ({ ...prev, [type]: prev[type] + chunk }));
                  }
                }
              }
            }
            usedBackend = true;
          }
        }
      } catch {
        // backend unavailable — fall through to client-side
      }
    }

    if (!usedBackend) {
      // Client-side commentary — always works, no backend needed
      const cur = currency || localStorage.getItem('fpa_currency') || 'AED';
      const text = buildLocalCommentary(type, payloadRows, period, entityName, cur);
      // Simulate typing effect for better UX
      let i = 0;
      const chunk = 8;
      const typeText = () => {
        if (i < text.length) {
          const next = text.slice(0, i + chunk);
          setTexts((prev) => ({ ...prev, [type]: next }));
          i += chunk;
          setTimeout(typeText, 12);
        } else {
          setLoadedTabs((prev) => new Set(prev).add(type));
          setLoading(false);
        }
      };
      typeText();
      return; // loading state managed by typeText
    }

    setLoadedTabs((prev) => new Set(prev).add(type));
    setLoading(false);
  };

  useEffect(() => {
    if (!hasData) return;
    setLoadedTabs(new Set());
    setTexts({ executive: '', cfo: '', board: '', risk: '' });
    void generateCommentary('cfo', true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData, JSON.stringify(payloadRows)]);

  const copyText = async () => {
    const txt = texts[activeTab];
    if (!txt) return;
    await navigator.clipboard.writeText(txt);
  };

  if (!hasData) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-bold text-gray-900">🤖 AI Commentary</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copyText}
            className="px-3 py-1.5 text-xs rounded border border-gray-200 hover:bg-gray-50 flex items-center gap-1"
          >
            <Copy className="w-3.5 h-3.5" />
            Copy
          </button>
          <button
            type="button"
            onClick={() => void generateCommentary(activeTab, true)}
            disabled={loading}
            className="px-3 py-1.5 text-xs rounded bg-amber-500 hover:bg-amber-400 text-black font-semibold disabled:opacity-50 flex items-center gap-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Regenerate
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {COMMENTARY_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => void generateCommentary(t.id)}
            className={`px-3 py-1.5 text-xs rounded border transition ${
              activeTab === t.id
                ? 'bg-amber-500/20 border-amber-400 text-amber-700'
                : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 min-h-[180px]">
        <pre className="whitespace-pre-wrap text-sm text-gray-800 font-sans">
          {texts[activeTab]}
          {loading && activeTab && <span className="animate-pulse">▋</span>}
        </pre>
      </div>
    </div>
  );
};
