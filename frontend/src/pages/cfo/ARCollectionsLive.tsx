import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, ReferenceLine } from 'recharts';
import { Sparkles, RefreshCw } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { cfoGet, cfoPost, fmtMoney } from '../../services/cfoDesk.service';
import { getARAging, getDSOMetrics, predictPayments, type DSOMetrics, type PaymentPrediction } from '../../services/arService';

const C = {
  bg: '#060A12', surface: '#0B1120', panel: '#0F1829', border: '#1A2640',
  teal: '#00D4B8', red: '#FF4444', yellow: '#FFB800', amber: '#F59E0B', blue: '#60A5FA',
  textPrimary: '#E2EAF4', textDim: '#4A6080', font: "'IBM Plex Mono', monospace",
};

const RISK_COLORS: Record<string, string> = { low: '#22C55E', medium: '#F59E0B', high: '#FF4444', critical: '#9B1C1C' };

type Tab = 'overview' | 'aging' | 'dso' | 'dunning';
type Bucket = { bucket: string; amount: number; pct: number; risk: string };
type ARData = { total_ar: number; total_overdue: number; dso_current: number; dso_target: number; currency?: string; aging_buckets: Bucket[]; customers: Array<{ name: string; amount: number; bucket: string; risk: string }> };
type InsightCard = { module: string; impact: string; title: string; body: string; data_tag: string; action: string };

export default function ARCollectionsLive() {
  const { activeCompanyId } = useCompany();
  const [tab, setTab] = useState<Tab>('overview');
  const [data, setData] = useState<ARData | null>(null);
  const [dso, setDso] = useState<DSOMetrics | null>(null);
  const [predictions, setPredictions] = useState<PaymentPrediction[]>([]);
  const [cashForecast, setCashForecast] = useState({ d30: 0, d60: 0, d90: 0 });
  const [insight, setInsight] = useState<InsightCard | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const currency = 'AED';

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    try {
      const [d, aging, dsoData, pred] = await Promise.all([
        cfoGet<ARData>('/api/ar-collections/summary', { company_id: activeCompanyId }),
        getARAging().catch(() => null),
        getDSOMetrics(activeCompanyId).catch(() => null),
        predictPayments({ company_id: activeCompanyId }).catch(() => null),
      ]);
      if (aging?.buckets?.length) {
        const total = aging.total_outstanding || 0;
        const riskMap: Record<string, string> = {
          Current: 'low', '1-30 days': 'medium', '31-60 days': 'high', '61-90 days': 'high', '90+ days': 'critical',
        };
        d.aging_buckets = aging.buckets.map((b) => ({
          bucket: b.bucket,
          amount: b.total_aed,
          pct: total ? Math.round((b.total_aed / total) * 100) : 0,
          risk: riskMap[b.bucket] ?? 'medium',
        }));
        d.total_ar = total;
        d.total_overdue = aging.buckets.filter((b) => b.bucket !== 'Current').reduce((s, b) => s + b.total_aed, 0);
        d.customers = aging.buckets.flatMap((b) =>
          (b.customers || []).map((name) => ({
            name,
            amount: b.total_aed / Math.max(1, b.customers.length),
            bucket: b.bucket,
            risk: riskMap[b.bucket] ?? 'medium',
          })),
        );
      }
      if (dsoData) {
        d.dso_current = dsoData.dso_current;
        d.dso_target = dsoData.industry_benchmark;
      }
      setData(d);
      setDso(dsoData);
      if (pred) {
        setPredictions(pred.predictions);
        setCashForecast({
          d30: pred.total_predicted_cash_next_30_days,
          d60: pred.total_predicted_cash_next_60_days,
          d90: pred.total_predicted_cash_next_90_days,
        });
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId]);

  useEffect(() => { void load(); }, [load]);

  async function loadInsight() {
    setInsightLoading(true);
    try {
      setInsight(await cfoPost<InsightCard>('/api/ar-collections/ai-insight', { company_id: activeCompanyId }));
    } catch {
      setInsight({ module: 'AR & COLLECTIONS', impact: 'high impact', title: 'Error', body: 'Failed to load.', data_tag: '', action: '' });
    }
    setInsightLoading(false);
  }

  if (!activeCompanyId) {
    return <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textDim, fontFamily: C.font }}>Select a company first.</div>;
  }

  if (loading || !data) {
    return <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textDim, fontFamily: C.font }}>Loading…</div>;
  }

  const fmt = (n: number) => fmtMoney(n, currency);
  const overduePct = data.total_ar ? Math.round((data.total_overdue / data.total_ar) * 100) : 0;
  const bucketData = data.aging_buckets.map((b) => ({ name: b.bucket, amount: b.amount / 1000, fill: RISK_COLORS[b.risk] }));
  const dsoGood = (dso?.dso_vs_benchmark ?? 0) <= 0;
  const chartData = dso?.dso_trend.map((t) => ({ month: t.month, dso: t.dso, benchmark: dso.industry_benchmark })) ?? [];

  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: C.font, color: C.textPrimary, padding: '24px 32px' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.2em', color: C.teal, textTransform: 'uppercase', marginBottom: 6 }}>CFO OPERATING DESK</div>
        <div style={{ fontSize: 22 }}>AR & Collections</div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {(['overview', 'aging', 'dso', 'dunning'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              padding: '8px 16px', borderRadius: 4, fontSize: 12, cursor: 'pointer', textTransform: 'capitalize',
              background: tab === t ? C.teal : C.panel,
              color: tab === t ? C.bg : C.textDim,
              border: `1px solid ${tab === t ? C.teal : C.border}`,
            }}
          >
            {t}
          </button>
        ))}
        <button type="button" onClick={() => void load()} style={{ marginLeft: 'auto', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 4, padding: '8px 12px', color: C.textDim, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {tab === 'overview' && (
        <>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 24, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: '14px 20px' }}>
            {[
              { label: 'Total AR', val: fmt(data.total_ar), col: C.textPrimary },
              { label: `Overdue (${overduePct}%)`, val: fmt(data.total_overdue), col: C.red },
              { label: 'DSO', val: `${dso?.dso_current ?? data.dso_current} days`, col: dsoGood ? C.teal : C.red },
              { label: 'Benchmark', val: `${dso?.industry_benchmark ?? 45} days`, col: C.textDim },
            ].map(({ label, val, col }) => (
              <div key={label}>
                <div style={{ fontSize: 10, color: C.textDim, textTransform: 'uppercase' }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: col }}>{val}</div>
              </div>
            ))}
          </div>
          <InsightBlock insight={insight} loading={insightLoading} onGenerate={() => void loadInsight()} />
        </>
      )}

      {tab === 'aging' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: 20 }}>
            <div style={{ fontSize: 10, color: C.textDim, textTransform: 'uppercase', marginBottom: 16 }}>Aging Buckets</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={bucketData} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 10, fill: C.textDim }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: C.textDim }} width={80} />
                <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, fontSize: 11 }} />
                <Bar dataKey="amount" radius={[0, 3, 3, 0]}>
                  {bucketData.map((e, i) => <rect key={i} fill={e.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: 20 }}>
            {data.aging_buckets.map((b, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                <span>{b.bucket}</span>
                <span style={{ color: RISK_COLORS[b.risk] }}>{fmt(b.amount)} ({b.pct}%)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'dso' && dso && (
        <>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: 48, fontWeight: 700, color: dsoGood ? C.teal : C.red }}>{dso.dso_current} days</div>
            <div style={{ fontSize: 13, color: dsoGood ? C.teal : C.red }}>vs {dso.industry_benchmark}-day UAE benchmark — {dso.dso_vs_benchmark_label}</div>
          </div>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: 20, marginBottom: 20 }}>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: C.textDim }} />
                <YAxis tick={{ fontSize: 10, fill: C.textDim }} />
                <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, fontSize: 11 }} />
                <ReferenceLine y={dso.industry_benchmark} stroke={C.textDim} strokeDasharray="4 4" />
                <Line type="monotone" dataKey="dso" stroke={C.blue} strokeWidth={2} dot={{ r: 3 }} name="Your DSO" />
                <Line type="monotone" dataKey="benchmark" stroke={C.textDim} strokeDasharray="5 5" dot={false} name="Benchmark" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
            {[
              { label: 'Best month DSO', value: `${dso.best_dso}d` },
              { label: 'Worst month DSO', value: `${dso.worst_dso}d` },
              { label: 'Collections efficiency', value: `${dso.collections_efficiency_pct}%` },
              { label: 'Outstanding', value: fmt(dso.total_outstanding_aed) },
            ].map((c) => (
              <div key={c.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: 16 }}>
                <div style={{ fontSize: 10, color: C.textDim }}>{c.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{c.value}</div>
              </div>
            ))}
          </div>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: 20 }}>
            <div style={{ fontSize: 10, color: C.textDim, textTransform: 'uppercase', marginBottom: 12 }}>Cash Flow Forecast</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {[
                { label: 'Next 30 days', amt: cashForecast.d30 },
                { label: 'Next 60 days', amt: cashForecast.d60 },
                { label: 'Next 90 days', amt: cashForecast.d90 },
              ].map((box) => (
                <div key={box.label} style={{ background: C.panel, borderRadius: 4, padding: 16, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: C.textDim }}>{box.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: C.teal, marginTop: 6 }}>{fmt(box.amt)}</div>
                  <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>expected collections</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === 'dunning' && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: 20 }}>
          <p style={{ fontSize: 13, color: C.textDim, marginBottom: 16 }}>
            Escalating payment reminders (L1–L4) are managed on the dedicated AR Dunning page.
          </p>
          <Link
            to="/uae-full/ar/dunning"
            style={{ background: C.amber, color: C.bg, borderRadius: 4, padding: '10px 20px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}
          >
            Open AR Dunning →
          </Link>
          {predictions.filter((p) => p.days_overdue > 0).length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div style={{ fontSize: 10, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>Overdue invoices</div>
              {predictions.filter((p) => p.days_overdue > 0).map((p) => (
                <div key={p.invoice_id} style={{ fontSize: 12, padding: '6px 0', borderBottom: `1px solid ${C.border}` }}>
                  {p.invoice_number} · {p.customer_name} · {fmt(p.total_aed)} · {p.days_overdue}d overdue
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InsightBlock({ insight, loading, onGenerate }: { insight: InsightCard | null; loading: boolean; onGenerate: () => void }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 10, letterSpacing: '.15em', color: C.teal, textTransform: 'uppercase' }}>AI Signal</div>
        <button type="button" onClick={onGenerate} disabled={loading} style={{ background: loading ? C.panel : C.teal, color: loading ? C.textDim : C.bg, border: 'none', borderRadius: 3, padding: '6px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Sparkles size={12} />{loading ? 'Generating…' : 'Generate Signal'}
        </button>
      </div>
      {insight ? (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.teal}`, borderRadius: 4, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{insight.title}</div>
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>{insight.body}</div>
        </div>
      ) : (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: 20, fontSize: 12, color: C.textDim }}>
          Generate an AI analysis of collection risks.
        </div>
      )}
    </div>
  );
}
