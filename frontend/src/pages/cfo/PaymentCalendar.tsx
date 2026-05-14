import { useEffect, useState } from 'react';
import { Sparkles, AlertTriangle } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const C = {
  bg: '#060A12', surface: '#0B1120', panel: '#0F1829', border: '#1A2640',
  teal: '#00D4B8', red: '#FF4444', yellow: '#FFB800', amber: '#F59E0B',
  textPrimary: '#E2EAF4', textDim: '#4A6080', font: "'IBM Plex Mono', monospace",
};

const CAT_COLORS: Record<string, string> = {
  Payroll: '#8B5CF6', Debt: '#3B82F6', 'Tax-VAT': '#F59E0B', 'Tax-CIT': '#78350F',
  Supplier: '#22C55E', Intercompany: '#94A3B8', 'AR-Inflow': '#00D4B8',
  'pending_approval': '#F59E0B',
};

type Payment = { description: string; entity: string; flag: string; category: string; amount_eur: number; due: string; status: string; notes: string };
type Week = { week: number; label: string; dates: string; total_eur: number; risk: string | null; projected_cash: number; cash_threshold?: number; cash_risk_note?: string; payments: Payment[] };

function fmt(n: number) {
  const abs = Math.abs(n);
  const s = abs >= 1000000 ? `€${(abs / 1000000).toFixed(2)}M` : `€${(abs / 1000).toFixed(0)}K`;
  return n < 0 ? `+${s}` : s;
}

function StatusIcon({ s }: { s: string }) {
  if (s === 'scheduled') return <span title="Scheduled" style={{ color: '#60A5FA' }}>⏳</span>;
  if (s === 'paid') return <span title="Paid" style={{ color: C.teal }}>✅</span>;
  if (s === 'at_risk') return <span title="At risk" style={{ color: C.amber }}>⚠️</span>;
  if (s === 'pending_approval') return <span title="Pending approval" style={{ color: C.yellow }}>🔐</span>;
  return <span>—</span>;
}

export default function PaymentCalendar() {
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [insight, setInsight] = useState('');
  const [insightLoading, setInsightLoading] = useState(false);
  const [totalCommitted, setTotalCommitted] = useState(0);
  const [highestWeek, setHighestWeek] = useState(0);

  useEffect(() => { void load(); }, []);

  async function load() {
    try {
      const r = await fetch(`${API}/api/payment-calendar/weeks`);
      const d = await r.json() as { weeks: Week[] };
      setWeeks(d.weeks);
      const total = d.weeks.reduce((a, w) => a + w.total_eur, 0);
      const max = Math.max(...d.weeks.map(w => w.total_eur));
      setTotalCommitted(total);
      setHighestWeek(max);
    } catch { /* ignore */ }
  }

  async function loadInsight() {
    setInsightLoading(true);
    try {
      const r = await fetch(`${API}/api/payment-calendar/ai-insight`, { method: 'POST' });
      const d = await r.json() as { insight: string };
      setInsight(d.insight);
    } catch { setInsight('Failed to load insight.'); }
    setInsightLoading(false);
  }

  const riskWeeks = weeks.filter(w => w.risk === 'critical').map(w => w.label).join(', ');

  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: C.font, color: C.textPrimary, padding: '24px 32px' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.2em', color: C.teal, textTransform: 'uppercase', marginBottom: 6 }}>CFO OPERATING DESK</div>
        <div style={{ fontSize: 22, marginBottom: 4 }}>Payment Calendar</div>
        <div style={{ fontSize: 11, color: C.textDim }}>6-week outflow forecast by entity and category</div>
      </div>

      {/* Summary bar */}
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 24, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: '14px 20px' }}>
        {[
          { label: 'Total Committed', val: fmt(totalCommitted), col: C.textPrimary },
          { label: 'Highest Week', val: fmt(highestWeek), col: C.amber },
          { label: 'Cash Risk Weeks', val: riskWeeks || 'None', col: riskWeeks ? C.red : C.teal },
        ].map(({ label, val, col }) => (
          <div key={label}>
            <div style={{ fontSize: 10, color: C.textDim, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: col }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Category legend */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        {Object.entries(CAT_COLORS).filter(([k]) => k !== 'pending_approval').map(([k, v]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.textDim }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: v }} />
            {k}
          </div>
        ))}
      </div>

      {/* Weekly cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
        {weeks.map(w => {
          const borderCol = w.risk === 'critical' ? C.red : w.risk === 'watch' ? C.amber : C.border;
          return (
            <div key={w.week} style={{ background: C.surface, border: `1px solid ${borderCol}`, borderRadius: 4, overflow: 'hidden' }}>
              {/* Week header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: `1px solid ${C.border}`, background: w.risk === 'critical' ? 'rgba(255,68,68,.06)' : 'transparent' }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{w.label} · {w.dates}</span>
                  <span style={{ marginLeft: 12, fontSize: 11, color: C.textDim }}>{w.payments.length} payment{w.payments.length !== 1 ? 's' : ''}</span>
                  {w.risk === 'critical' && <span style={{ marginLeft: 10, fontSize: 10, fontWeight: 700, color: C.red, background: 'rgba(255,68,68,.12)', padding: '2px 8px', borderRadius: 3 }}>🔴 CASH RISK</span>}
                  {w.risk === 'watch' && <span style={{ marginLeft: 10, fontSize: 10, fontWeight: 700, color: C.amber, background: 'rgba(245,158,11,.12)', padding: '2px 8px', borderRadius: 3 }}>⚠️ WATCH</span>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: w.risk === 'critical' ? C.red : C.textPrimary }}>{fmt(w.total_eur)}</div>
                  <div style={{ fontSize: 10, color: C.textDim }}>Cash: {fmt(w.projected_cash)}</div>
                </div>
              </div>

              {/* Payment rows */}
              <div style={{ padding: '0 20px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr .8fr 1fr 1fr .6fr .5fr', gap: 8, padding: '8px 0', fontSize: 10, color: C.textDim, letterSpacing: '.08em', textTransform: 'uppercase', borderBottom: `1px solid ${C.border}` }}>
                  <span>Description</span><span>Entity</span><span>Category</span><span>Amount</span><span>Due</span><span>Status</span>
                </div>
                {w.payments.map((p, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr .8fr 1fr 1fr .6fr .5fr', gap: 8, padding: '10px 0', fontSize: 12, borderBottom: i < w.payments.length - 1 ? `1px solid ${C.border}` : 'none', alignItems: 'center' }}>
                    <div>
                      <div style={{ color: C.textPrimary }}>{p.description}</div>
                      <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>{p.notes}</div>
                    </div>
                    <div>{p.flag} {p.entity}</div>
                    <div>
                      <span style={{ background: `${CAT_COLORS[p.category] ?? '#4A6080'}22`, color: CAT_COLORS[p.category] ?? C.textDim, padding: '2px 8px', borderRadius: 3, fontSize: 10, fontWeight: 600 }}>
                        {p.category}
                      </span>
                    </div>
                    <div style={{ color: p.amount_eur < 0 ? C.teal : p.status === 'at_risk' ? C.red : C.textPrimary, fontWeight: 600 }}>
                      {fmt(p.amount_eur)}
                    </div>
                    <div style={{ color: C.textDim }}>{p.due}</div>
                    <div><StatusIcon s={p.status} /></div>
                  </div>
                ))}
              </div>

              {/* Cash risk note */}
              {w.cash_risk_note && (
                <div style={{ margin: '0 20px 14px', background: 'rgba(255,68,68,.06)', border: `1px solid rgba(255,68,68,.2)`, borderRadius: 3, padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <AlertTriangle size={14} style={{ color: C.red, flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 12, color: C.textPrimary }}>{w.cash_risk_note}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* AI Insight */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderTop: `2px solid ${C.teal}`, borderRadius: 4, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 10, letterSpacing: '.15em', color: C.teal, textTransform: 'uppercase' }}>✨ Treasury AI Insight</div>
          <button onClick={() => void loadInsight()} disabled={insightLoading}
            style={{ background: insightLoading ? C.panel : C.teal, color: insightLoading ? C.textDim : C.bg, border: 'none', borderRadius: 3, padding: '6px 14px', fontFamily: C.font, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sparkles size={12} />{insightLoading ? 'Generating…' : 'Generate Insight'}
          </button>
        </div>
        {insight
          ? <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.8 }}>{insight}</div>
          : <div style={{ fontSize: 12, color: C.textDim }}>Click to generate an AI treasury brief on liquidity risk and required actions.</div>}
      </div>
    </div>
  );
}
