import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { Sparkles, TrendingUp, TrendingDown, Minus } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const C = {
  bg: '#060A12', surface: '#0B1120', panel: '#0F1829', border: '#1A2640',
  teal: '#00D4B8', red: '#FF4444', yellow: '#FFB800', amber: '#F59E0B',
  textPrimary: '#E2EAF4', textDim: '#4A6080', font: "'IBM Plex Mono', monospace",
};

type Covenant = {
  name: string; type: 'min' | 'max'; current: number; threshold: number; unit: string;
  headroom: number; headroom_pct: number; status: 'safe' | 'watch' | 'breach_risk';
  trend: 'stable' | 'tightening' | 'improving'; trend_history: number[]; trend_labels: string[];
  action: string | null; owner: string; bank?: string; scenario_w7?: number; scenario_risk?: boolean;
};

type Summary = { covenants: Covenant[]; watch_count: number; breach_risk_count: number; next_bank_review: string };

function statusStyle(s: string) {
  if (s === 'safe') return { color: '#22C55E', label: '✅ Safe', border: '#22C55E' };
  if (s === 'watch') return { color: '#F59E0B', label: '🟡 Watch', border: '#F59E0B' };
  return { color: '#FF4444', label: '🔴 Breach Risk', border: '#FF4444' };
}

function TrendIcon({ t }: { t: string }) {
  if (t === 'tightening') return <TrendingUp size={13} style={{ color: '#FF4444' }} />;
  if (t === 'improving') return <TrendingDown size={13} style={{ color: '#22C55E' }} />;
  return <Minus size={13} style={{ color: '#94A3B8' }} />;
}

function fmt(v: number, unit: string) {
  if (unit === '€') return v >= 1000000 ? `€${(v / 1000000).toFixed(2)}M` : `€${(v / 1000).toFixed(0)}K`;
  return `${v}${unit}`;
}

function CovenantCard({ c }: { c: Covenant }) {
  const st = statusStyle(c.status);
  const consumed = c.type === 'max' ? (c.current / c.threshold) * 100 : ((c.threshold - c.current) < 0 ? 0 : ((c.threshold) / (c.current)) * 100);
  const barPct = c.type === 'max' ? (c.current / c.threshold) * 100 : Math.max(0, 100 - c.headroom_pct);
  const chartData = c.trend_labels.map((label, i) => ({ label, value: c.trend_history[i] }));
  const thresholdLine = c.threshold;

  return (
    <div style={{ background: C.surface, border: `1px solid ${st.border}33`, borderLeft: `3px solid ${st.border}`, borderRadius: 4, padding: 20, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{c.name}</div>
          {c.bank && <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>Bank: {c.bank}</div>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: st.color }}>{st.label}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: C.textDim }}>
            <TrendIcon t={c.trend} />
            <span style={{ textTransform: 'capitalize' }}>{c.trend}</span>
          </div>
        </div>
      </div>

      {/* Key metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Current', val: fmt(c.current, c.unit), col: st.color },
          { label: `Threshold (${c.type === 'max' ? '≤' : '≥'})`, val: fmt(c.threshold, c.unit), col: C.textDim },
          { label: 'Headroom', val: fmt(c.headroom, c.unit), col: c.headroom_pct < 20 ? C.red : c.headroom_pct < 35 ? C.amber : C.teal },
        ].map(({ label, val, col }) => (
          <div key={label} style={{ background: C.panel, borderRadius: 3, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4, letterSpacing: '.08em', textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: col }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.textDim, marginBottom: 4 }}>
          <span>{c.type === 'max' ? 'Consumed' : 'Threshold consumed'}: {Math.round(barPct)}%</span>
          <span>{Math.round(100 - barPct)}% remaining</span>
        </div>
        <div style={{ background: C.panel, borderRadius: 2, height: 6, overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(barPct, 100)}%`, height: '100%', background: barPct > 80 ? C.red : barPct > 60 ? C.amber : C.teal, borderRadius: 2, transition: 'width .5s' }} />
        </div>
      </div>

      {/* 6-month trend chart */}
      <div style={{ marginBottom: c.action || c.scenario_risk ? 16 : 0 }}>
        <div style={{ fontSize: 10, color: C.textDim, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>6-Month Trend</div>
        <ResponsiveContainer width="100%" height={80}>
          <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: C.textDim }} tickLine={false} axisLine={false} />
            <YAxis hide domain={['auto', 'auto']} />
            <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, fontSize: 11, fontFamily: C.font }} labelStyle={{ color: C.textDim }} itemStyle={{ color: C.teal }} />
            <ReferenceLine y={thresholdLine} stroke={C.red} strokeDasharray="4 2" label={{ value: 'Limit', fill: C.red, fontSize: 9 }} />
            <Line type="monotone" dataKey="value" stroke={st.color} strokeWidth={2} dot={{ r: 3, fill: st.color }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Scenario risk */}
      {c.scenario_risk && c.scenario_w7 && (
        <div style={{ background: 'rgba(255,68,68,.06)', border: `1px solid rgba(255,68,68,.2)`, borderRadius: 3, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: C.textPrimary }}>
          ⚠️ W7 downside scenario: {fmt(c.scenario_w7, c.unit)} — below {fmt(c.threshold, c.unit)} threshold
        </div>
      )}

      {/* Action */}
      {c.action && (
        <div style={{ background: C.panel, borderRadius: 3, padding: '10px 14px' }}>
          <div style={{ fontSize: 10, color: C.teal, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 4 }}>→ Action Required</div>
          <div style={{ fontSize: 12, color: C.textPrimary }}>{c.action}</div>
          <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>Owner: {c.owner}</div>
        </div>
      )}
    </div>
  );
}

export default function CovenantTracker() {
  const [data, setData] = useState<Summary | null>(null);
  const [insight, setInsight] = useState('');
  const [insightLoading, setInsightLoading] = useState(false);

  useEffect(() => { void load(); }, []);

  async function load() {
    try {
      const r = await fetch(`${API}/api/covenants/summary`);
      setData(await r.json() as Summary);
    } catch { /* ignore */ }
  }

  async function loadInsight() {
    setInsightLoading(true);
    try {
      const r = await fetch(`${API}/api/covenants/ai-insight`, { method: 'POST' });
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
        <div style={{ fontSize: 22, marginBottom: 4 }}>Covenant Tracker</div>
        <div style={{ fontSize: 11, color: C.textDim }}>
          Live debt covenant monitoring — next bank review: {new Date(data.next_bank_review).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        </div>
      </div>

      {/* Summary strip */}
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 24, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: '14px 20px' }}>
        {[
          { label: 'Total Covenants', val: String(data.covenants.length), col: C.textPrimary },
          { label: 'On Watch', val: String(data.watch_count), col: data.watch_count > 0 ? C.amber : C.teal },
          { label: 'Breach Risk', val: String(data.breach_risk_count), col: data.breach_risk_count > 0 ? C.red : C.teal },
          { label: 'Next Bank Review', val: data.next_bank_review, col: C.textDim },
        ].map(({ label, val, col }) => (
          <div key={label}>
            <div style={{ fontSize: 10, color: C.textDim, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: col }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Covenant cards */}
      <div style={{ marginBottom: 24 }}>
        {data.covenants.map((c, i) => <CovenantCard key={i} c={c} />)}
      </div>

      {/* AI Insight */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderTop: `2px solid ${C.teal}`, borderRadius: 4, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 10, letterSpacing: '.15em', color: C.teal, textTransform: 'uppercase' }}>✨ Covenant AI Brief</div>
          <button onClick={() => void loadInsight()} disabled={insightLoading}
            style={{ background: insightLoading ? C.panel : C.teal, color: insightLoading ? C.textDim : C.bg, border: 'none', borderRadius: 3, padding: '6px 14px', fontFamily: C.font, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sparkles size={12} />{insightLoading ? 'Generating…' : 'Generate Brief'}
          </button>
        </div>
        {insight
          ? <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.8 }}>{insight}</div>
          : <div style={{ fontSize: 12, color: C.textDim }}>Click to generate an AI covenant risk brief for the CFO and banking team.</div>}
      </div>
    </div>
  );
}
