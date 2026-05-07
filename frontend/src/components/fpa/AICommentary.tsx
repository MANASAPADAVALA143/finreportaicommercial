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

export const AICommentary = ({ varianceData, period, entityName }: Props) => {
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

  const streamCommentary = async (type: CommentaryTabId, force = false) => {
    if (!API_BASE || !hasData || loading) return;
    if (!force && loadedTabs.has(type) && texts[type]) {
      setActiveTab(type);
      return;
    }
    setActiveTab(type);
    setLoading(true);
    setTexts((prev) => ({ ...prev, [type]: '' }));
    try {
      const response = await fetch(`${API_BASE}/api/fpa/variance/commentary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variance_data: payloadRows,
          commentary_type: type,
          period,
          entity_name: entityName,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No stream returned from server.');
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const evt of events) {
          const lines = evt.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const chunk = line.slice(6);
              if (chunk !== '[DONE]') {
                setTexts((prev) => ({ ...prev, [type]: prev[type] + chunk }));
              }
            }
          }
        }
      }
      setLoadedTabs((prev) => new Set(prev).add(type));
    } catch (err: any) {
      setTexts((prev) => ({ ...prev, [type]: `Failed to generate commentary: ${String(err?.message || err)}` }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!hasData || !API_BASE) return;
    setLoadedTabs(new Set());
    setTexts({ executive: '', cfo: '', board: '', risk: '' });
    void streamCommentary('cfo', true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData, API_BASE, JSON.stringify(payloadRows)]);

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
            onClick={() => void streamCommentary(activeTab, true)}
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
            onClick={() => void streamCommentary(t.id)}
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
