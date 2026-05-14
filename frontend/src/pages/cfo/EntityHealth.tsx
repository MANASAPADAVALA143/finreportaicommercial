import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, XCircle, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const C = {
  bg: '#060A12', surface: '#0B1120', panel: '#0F1829', border: '#1A2640',
  teal: '#00D4B8', red: '#FF4444', yellow: '#FFB800', amber: '#F59E0B',
  textPrimary: '#E2EAF4', textDim: '#4A6080', font: "'IBM Plex Mono', monospace",
};

type Workstream = { name: string; status: 'complete' | 'in_progress' | 'blocked'; owner: string };
type Blocker = { severity: 'critical' | 'high' | 'medium'; text: string };
type Entity = { code: string; name: string; label: string; flag: string; readiness: number; workstreams: Workstream[]; blockers: Blocker[] };
type Summary = { period: string; entities: Entity[]; group_readiness: number; total_blockers: number; critical_blockers: number; target_readiness: number; consolidation_deadline: string; days_to_deadline: number };

const PERIODS = ['2026-02', '2026-03', '2026-04'];
const PERIOD_LABELS: Record<string, string> = { '2026-02': 'Feb 2026', '2026-03': 'Mar 2026', '2026-04': 'Apr 2026' };

function readinessColor(r: number) { return r >= 85 ? C.teal : r >= 65 ? C.amber : C.red; }
function readinessIcon(r: number) { return r >= 85 ? '✅' : r >= 65 ? '🟡' : '🔴'; }

function WorkstreamRow({ ws }: { ws: Workstream }) {
  const Icon = ws.status === 'complete' ? CheckCircle2 : ws.status === 'in_progress' ? Clock : XCircle;
  const col = ws.status === 'complete' ? C.teal : ws.status === 'in_progress' ? '#60A5FA' : C.red;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: `1px solid ${C.border}` }}>
      <Icon size={14} style={{ color: col, flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 12, color: C.textPrimary }}>{ws.name}</span>
      <span style={{ fontSize: 11, color: C.textDim }}>{ws.owner}</span>
    </div>
  );
}

function BlockerBadge({ b }: { b: Blocker }) {
  const bg = b.severity === 'critical' ? '#7f1d1d' : b.severity === 'high' ? '#78350f' : '#713f12';
  const col = b.severity === 'critical' ? '#fca5a5' : b.severity === 'high' ? '#fcd34d' : '#fde68a';
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 0' }}>
      <span style={{ background: bg, color: col, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3, flexShrink: 0, letterSpacing: '.05em', textTransform: 'uppercase' }}>
        {b.severity}
      </span>
      <span style={{ fontSize: 12, color: C.textPrimary, lineHeight: 1.5 }}>{b.text}</span>
    </div>
  );
}

export default function EntityHealth() {
  const [data, setData] = useState<Summary | null>(null);
  const [insight, setInsight] = useState('');
  const [insightLoading, setInsightLoading] = useState(false);
  const [periodIdx, setPeriodIdx] = useState(PERIODS.length - 1);

  const period = PERIODS[periodIdx];

  useEffect(() => { void load(); }, [period]);

  async function load() {
    try {
      const r = await fetch(`${API}/api/entity-health/summary?period=${period}`);
      setData(await r.json() as Summary);
    } catch { /* ignore */ }
  }

  async function loadInsight() {
    setInsightLoading(true);
    try {
      const r = await fetch(`${API}/api/entity-health/ai-insight?period=${period}`, { method: 'POST' });
      const d = await r.json() as { insight: string };
      setInsight(d.insight);
    } catch { setInsight('Failed to load insight.'); }
    setInsightLoading(false);
  }

  if (!data) return <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textDim, fontFamily: C.font }}>Loading…</div>;

  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: C.font, color: C.textPrimary, padding: '24px 32px' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.2em', color: C.teal, textTransform: 'uppercase', marginBottom: 6 }}>CFO OPERATING DESK</div>
        <div style={{ fontSize: 22, marginBottom: 4 }}>Entity Health</div>
        <div style={{ fontSize: 11, color: C.textDim }}>Month-end close readiness by entity</div>
      </div>

      {/* Period selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => setPeriodIdx(i => Math.max(0, i - 1))} disabled={periodIdx === 0}
          style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 4, color: C.textDim, padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          <ChevronLeft size={14} />
        </button>
        <span style={{ fontSize: 13, fontWeight: 600, minWidth: 100, textAlign: 'center' }}>{PERIOD_LABELS[period]}</span>
        <button onClick={() => setPeriodIdx(i => Math.min(PERIODS.length - 1, i + 1))} disabled={periodIdx === PERIODS.length - 1}
          style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 4, color: C.textDim, padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Group banner */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${readinessColor(data.group_readiness)}`, borderRadius: 4, padding: '14px 20px', marginBottom: 24, display: 'flex', gap: 32, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10, color: C.textDim, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 4 }}>Group Close Readiness</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: readinessColor(data.group_readiness) }}>{data.group_readiness}%</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: C.textDim, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 4 }}>Target</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: C.textDim }}>{data.target_readiness}%</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: C.textDim, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 4 }}>Open Blockers</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: data.total_blockers > 0 ? C.red : C.teal }}>{data.total_blockers}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: C.textDim, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 4 }}>Critical Blockers</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: data.critical_blockers > 0 ? C.red : C.teal }}>{data.critical_blockers}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: C.textDim, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 4 }}>Days to Deadline</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: data.days_to_deadline <= 3 ? C.red : C.amber }}>{data.days_to_deadline}</div>
        </div>
      </div>

      {/* Entity cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
        {data.entities.map(e => (
          <div key={e.code} style={{ background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${readinessColor(e.readiness)}`, borderRadius: 4, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{e.flag} {e.name}</div>
                <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>{e.label}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: readinessColor(e.readiness) }}>{e.readiness}% {readinessIcon(e.readiness)}</div>
                <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>Close Readiness</div>
              </div>
            </div>

            {/* Progress bar */}
            <div style={{ background: C.panel, borderRadius: 2, height: 4, marginBottom: 16, overflow: 'hidden' }}>
              <div style={{ width: `${e.readiness}%`, height: '100%', background: readinessColor(e.readiness), borderRadius: 2, transition: 'width .5s' }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {/* Workstreams */}
              <div>
                <div style={{ fontSize: 10, color: C.textDim, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 8 }}>Workstreams</div>
                {e.workstreams.map((ws, i) => <WorkstreamRow key={i} ws={ws} />)}
              </div>
              {/* Blockers */}
              <div>
                <div style={{ fontSize: 10, color: C.textDim, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 8 }}>Blockers</div>
                {e.blockers.length === 0
                  ? <div style={{ fontSize: 12, color: C.teal }}>✓ No blockers</div>
                  : e.blockers.map((b, i) => <BlockerBadge key={i} b={b} />)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* AI Insight */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderTop: `2px solid ${C.teal}`, borderRadius: 4, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 10, letterSpacing: '.15em', color: C.teal, textTransform: 'uppercase' }}>✨ AI Insight</div>
          <button onClick={() => void loadInsight()} disabled={insightLoading}
            style={{ background: insightLoading ? C.panel : C.teal, color: insightLoading ? C.textDim : C.bg, border: 'none', borderRadius: 3, padding: '6px 14px', fontFamily: C.font, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sparkles size={12} />{insightLoading ? 'Generating…' : 'Generate Insight'}
          </button>
        </div>
        {insight
          ? <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.8 }}>{insight}</div>
          : <div style={{ fontSize: 12, color: C.textDim }}>Click "Generate Insight" to get an AI executive summary of the current close status.</div>}
      </div>
    </div>
  );
}
