import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, ReferenceLine } from 'recharts';
import { Sparkles } from 'lucide-react';
import { cfoGet, cfoPost, fmtMoney } from '../../services/cfoDesk.service';
import { getARAging } from '../../services/arService';

const C = {
  bg: '#060A12', surface: '#0B1120', panel: '#0F1829', border: '#1A2640',
  teal: '#00D4B8', red: '#FF4444', yellow: '#FFB800', amber: '#F59E0B',
  textPrimary: '#E2EAF4', textDim: '#4A6080', font: "'IBM Plex Mono', monospace",
};

const RISK_COLORS: Record<string, string> = { low: '#22C55E', medium: '#F59E0B', high: '#FF4444', critical: '#9B1C1C' };
const RISK_LABELS: Record<string, string> = { low: '🟢 Low', medium: '🟡 Medium', high: '🔴 High', critical: '🚨 Critical' };

type Bucket = { bucket: string; amount: number; pct: number; risk: string };
type Customer = { name: string; amount: number; bucket: string; risk: string; last_contact: string; entity: string; note: string };
type DSO = { month: string; dso: number };
type ARData = { total_ar: number; total_overdue: number; dso_current: number; dso_target: number; currency?: string; dso_trend: DSO[]; aging_buckets: Bucket[]; customers: Customer[] };
type InsightCard = { module: string; impact: string; title: string; body: string; data_tag: string; action: string };

export default function ARCollections() {
  const [data, setData] = useState<ARData | null>(null);
  const [insight, setInsight] = useState<InsightCard | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [currency, setCurrency] = useState('AED');

  useEffect(() => { void load(); }, []);

  async function load() {
    try {
      const [d, aging] = await Promise.all([
        cfoGet<ARData>('/api/ar-collections/summary'),
        getARAging().catch(() => null),
      ]);
      setCurrency(d.currency || 'AED');
      if (aging?.buckets?.length) {
        const total = aging.total_outstanding || 0;
        const riskMap: Record<string, string> = {
          'Current': 'low',
          '1-30 days': 'medium',
          '31-60 days': 'high',
          '61-90 days': 'high',
          '90+ days': 'critical',
        };
        d.aging_buckets = aging.buckets.map(b => ({
          bucket: b.bucket,
          amount: b.total_aed,
          pct: total ? Math.round((b.total_aed / total) * 100) : 0,
          risk: riskMap[b.bucket] ?? 'medium',
        }));
        d.total_ar = total;
        d.total_overdue = aging.buckets
          .filter(b => b.bucket !== 'Current')
          .reduce((s, b) => s + b.total_aed, 0);
        if (aging.buckets.some(b => b.customers?.length)) {
          d.customers = aging.buckets.flatMap(b =>
            (b.customers || []).map(name => ({
              name,
              amount: b.total_aed / Math.max(1, b.customers.length),
              bucket: b.bucket,
              risk: riskMap[b.bucket] ?? 'medium',
              last_contact: '—',
              entity: 'UAE',
              note: `${b.invoice_count} invoice(s) in ${b.bucket}`,
            })),
          );
        }
      }
      setData(d);
    } catch { /* ignore */ }
  }

  async function loadInsight() {
    setInsightLoading(true);
    try {
      setInsight(await cfoPost<InsightCard>('/api/ar-collections/ai-insight'));
    } catch {
      setInsight({ module: 'AR & COLLECTIONS', impact: 'high impact', title: 'Error', body: 'Failed to load.', data_tag: '', action: '' });
    }
    setInsightLoading(false);
  }

  if (!data) return <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textDim, fontFamily: C.font }}>Loading…</div>;

  const fmt = (n: number) => fmtMoney(n, currency);
  const overduePct = data.total_ar ? Math.round((data.total_overdue / data.total_ar) * 100) : 0;
  const bucketData = data.aging_buckets.map(b => ({ name: b.bucket.replace(' days', 'd').replace('Current (0-30d)', '0-30d'), amount: b.amount / 1000, fill: RISK_COLORS[b.risk] }));

  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: C.font, color: C.textPrimary, padding: '24px 32px' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.2em', color: C.teal, textTransform: 'uppercase', marginBottom: 6 }}>CFO OPERATING DESK</div>
        <div style={{ fontSize: 22, marginBottom: 4 }}>AR & Collections</div>
        <div style={{ fontSize: 11, color: C.textDim }}>Receivables aging, collection risk, and DSO</div>
      </div>

      {/* KPI bar */}
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 24, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: '14px 20px' }}>
        {[
          { label: 'Total AR', val: fmt(data.total_ar), col: C.textPrimary },
          { label: `Overdue (${overduePct}%)`, val: fmt(data.total_overdue), col: C.red },
          { label: 'DSO Current', val: `${data.dso_current} days`, col: data.dso_current > data.dso_target ? C.red : C.teal },
          { label: 'DSO Target', val: `${data.dso_target} days`, col: C.textDim },
        ].map(({ label, val, col }) => (
          <div key={label}>
            <div style={{ fontSize: 10, color: C.textDim, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: col }}>{val}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Aging bucket chart */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: 20 }}>
          <div style={{ fontSize: 10, color: C.textDim, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 16 }}>Aging Buckets ({currency} K)</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={bucketData} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: C.textDim }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: C.textDim }} tickLine={false} axisLine={false} width={60} />
              <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, fontSize: 11, fontFamily: C.font }} formatter={(v: number) => [`${currency} ${v}K`, 'Amount']} labelStyle={{ color: C.textDim }} />
              <Bar dataKey="amount" radius={[0, 3, 3, 0]}>
                {bucketData.map((entry, i) => (
                  <rect key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {/* Bucket list */}
          <div style={{ marginTop: 12 }}>
            {data.aging_buckets.map((b, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', borderBottom: i < data.aging_buckets.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: RISK_COLORS[b.risk], flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 11, color: C.textPrimary }}>{b.bucket}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: RISK_COLORS[b.risk] }}>{fmt(b.amount)}</span>
                <span style={{ fontSize: 10, color: C.textDim, width: 32, textAlign: 'right' }}>{b.pct}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* DSO Trend */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: 20 }}>
          <div style={{ fontSize: 10, color: C.textDim, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 16 }}>DSO Trend (days)</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data.dso_trend} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: C.textDim }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: C.textDim }} tickLine={false} axisLine={false} domain={[25, 38]} />
              <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, fontSize: 11, fontFamily: C.font }} formatter={(v: number) => [`${v} days`, 'DSO']} labelStyle={{ color: C.textDim }} />
              <ReferenceLine y={data.dso_target} stroke={C.teal} strokeDasharray="4 2" label={{ value: 'Target', fill: C.teal, fontSize: 9, position: 'insideTopRight' }} />
              <Line type="monotone" dataKey="dso" stroke={C.red} strokeWidth={2} dot={{ r: 3, fill: C.red }} />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.textDim }}>
            <span>Current DSO: <span style={{ color: C.red, fontWeight: 700 }}>{data.dso_current}d</span></span>
            <span>Target: <span style={{ color: C.teal, fontWeight: 700 }}>{data.dso_target}d</span></span>
            <span>Gap: <span style={{ color: C.red, fontWeight: 700 }}>+{data.dso_current - data.dso_target}d</span></span>
          </div>
        </div>
      </div>

      {/* Customer risk table */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: 20, marginBottom: 20 }}>
        <div style={{ fontSize: 10, color: C.textDim, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 16 }}>Customer Collection Risk</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr 1fr 1fr 1fr 1.5fr', gap: 8, padding: '0 0 8px', fontSize: 10, color: C.textDim, letterSpacing: '.08em', textTransform: 'uppercase', borderBottom: `1px solid ${C.border}` }}>
          <span>Customer</span><span>Amount</span><span>Bucket</span><span>Risk</span><span>Last Contact</span><span>Action</span>
        </div>
        {data.customers.map((c, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr 1fr 1fr 1fr 1.5fr', gap: 8, padding: '10px 0', borderBottom: i < data.customers.length - 1 ? `1px solid ${C.border}` : 'none', alignItems: 'start', fontSize: 12 }}>
            <div>
              <div style={{ fontWeight: 600, color: C.textPrimary }}>{c.name}</div>
              <div style={{ fontSize: 10, color: C.textDim }}>{c.entity}</div>
            </div>
            <div style={{ fontWeight: 700, color: RISK_COLORS[c.risk] }}>{fmt(c.amount)}</div>
            <div>
              <span style={{ background: `${RISK_COLORS[c.risk]}22`, color: RISK_COLORS[c.risk], padding: '2px 8px', borderRadius: 3, fontSize: 10, fontWeight: 700 }}>
                {c.bucket}
              </span>
            </div>
            <div style={{ fontSize: 11 }}>{RISK_LABELS[c.risk]}</div>
            <div style={{ color: C.textDim }}>{c.last_contact}</div>
            <div style={{ fontSize: 11, color: C.textDim }}>{c.note}</div>
          </div>
        ))}
      </div>

      {/* AI Signal Card */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 10, letterSpacing: '.15em', color: C.teal, textTransform: 'uppercase' }}>✨ AI Signal</div>
          <button onClick={() => void loadInsight()} disabled={insightLoading}
            style={{ background: insightLoading ? C.panel : C.teal, color: insightLoading ? C.textDim : C.bg, border: 'none', borderRadius: 3, padding: '6px 14px', fontFamily: C.font, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sparkles size={12} />{insightLoading ? 'Generating…' : 'Generate Signal'}
          </button>
        </div>
        {insight ? (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.teal}`, borderRadius: 4, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 10, letterSpacing: '.1em', color: C.teal, textTransform: 'uppercase' }}>✨ {insight.module}</div>
              <span style={{ fontSize: 10, background: 'rgba(255,68,68,.12)', color: C.red, padding: '2px 8px', borderRadius: 3, fontWeight: 700 }}>{insight.impact}</span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{insight.title}</div>
            <div style={{ fontSize: 12, color: C.textPrimary, lineHeight: 1.8, marginBottom: 12 }}>{insight.body}</div>
            {insight.data_tag && (
              <code style={{ background: C.panel, color: C.teal, padding: '4px 10px', borderRadius: 3, fontSize: 11, display: 'inline-block', marginBottom: 10 }}>{insight.data_tag}</code>
            )}
            {insight.action && (
              <div style={{ background: C.panel, borderRadius: 3, padding: '8px 12px', fontSize: 12, color: C.textPrimary }}>
                <span style={{ color: C.teal, fontWeight: 700 }}>→ </span>{insight.action}
              </div>
            )}
          </div>
        ) : (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: 20, fontSize: 12, color: C.textDim }}>
            Click "Generate Signal" to get an AI analysis of the biggest AR collection risk and recommended action.
          </div>
        )}
      </div>
    </div>
  );
}
