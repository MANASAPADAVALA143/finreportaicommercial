import { useCallback, useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import toast from 'react-hot-toast';
import { RefreshCw } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { fetchO2CSummary, type O2CSummary } from '../../services/o2cService';

const C = {
  bg: '#060A12', surface: '#0B1120', panel: '#0F1829', border: '#1A2640',
  teal: '#00D4B8', red: '#FF4444', amber: '#FFB800', blue: '#60A5FA',
  textPrimary: '#E2EAF4', textDim: '#4A6080', font: "'IBM Plex Mono', monospace",
};

const RISK_COL: Record<string, string> = {
  LOW: C.teal, MEDIUM: C.amber, HIGH: '#FB923C', CRITICAL: C.red,
};

function fmt(n: number) {
  return `AED ${n.toLocaleString('en-AE', { maximumFractionDigits: 0 })}`;
}

export default function O2CDashboard() {
  const { activeCompanyId } = useCompany();
  const [data, setData] = useState<O2CSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    setError(null);
    try {
      setData(await fetchO2CSummary(activeCompanyId));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load O2C summary';
      setError(msg);
      setData(null);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId]);

  useEffect(() => { void load(); }, [load]);

  if (!activeCompanyId) {
    return (
      <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textDim, fontFamily: C.font }}>
        Select a company to view the O2C dashboard.
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textDim, fontFamily: C.font }}>
        Loading O2C dashboard…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: C.textDim, fontFamily: C.font, padding: 24 }}>
        <div style={{ color: C.red, fontSize: 14 }}>Could not load O2C dashboard</div>
        <div style={{ fontSize: 12, maxWidth: 480, textAlign: 'center' }}>{error ?? 'No data returned'}</div>
        <button type="button" onClick={() => void load()} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, padding: '8px 16px', color: C.teal, cursor: 'pointer', fontSize: 12 }}>
          Retry
        </button>
      </div>
    );
  }

  const k = data.kpis;
  const dsoGood = k.dso_vs_benchmark <= 0;

  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: C.font, color: C.textPrimary, padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.2em', color: C.teal, textTransform: 'uppercase', marginBottom: 6 }}>ORDER TO CASH</div>
          <div style={{ fontSize: 22 }}>O2C Dashboard</div>
          <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>Deal → invoice → collect → measure</div>
        </div>
        <button type="button" onClick={() => void load()} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, padding: '8px 12px', color: C.teal, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'DSO', value: `${k.dso_current} days`, sub: k.dso_vs_benchmark_label, col: dsoGood ? C.teal : C.red },
          { label: 'Collections efficiency', value: `${k.collections_efficiency_pct}%`, col: C.blue },
          { label: 'Portfolio risk', value: `${k.portfolio_risk_score}/100`, col: k.portfolio_risk_score > 50 ? C.amber : C.teal },
          { label: 'Cash next 30 days', value: fmt(k.expected_cash_30_days), col: C.teal },
          { label: 'Total overdue', value: fmt(k.total_overdue_aed), col: C.red },
        ].map((card) => (
          <div key={card.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: 16 }}>
            <div style={{ fontSize: 10, color: C.textDim, textTransform: 'uppercase', letterSpacing: '.1em' }}>{card.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: card.col, marginTop: 6 }}>{card.value}</div>
            {card.sub && <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>{card.sub}</div>}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <Section title="Pipeline (CRM)">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {data.pipeline.stages.map((s) => (
              <div key={s.stage} style={{ background: C.panel, borderRadius: 4, padding: '8px 12px', fontSize: 11 }}>
                <div style={{ color: C.textDim }}>{s.stage}</div>
                <div style={{ fontWeight: 700 }}>{s.count} · {fmt(s.value_aed)}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: C.teal }}>
            Won this month: {data.pipeline.won_this_month_count} deals · {fmt(data.pipeline.won_this_month_revenue_aed)}
          </div>
        </Section>

        <Section title="AR Status">
          {data.ar_status.by_status.map((s) => (
            <div key={s.status} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: `1px solid ${C.border}` }}>
              <span className="capitalize">{s.status}</span>
              <span>{s.count} · {fmt(s.amount_aed)}</span>
            </div>
          ))}
          <div style={{ marginTop: 12, fontSize: 10, color: C.textDim, textTransform: 'uppercase' }}>Aging</div>
          {data.ar_status.aging_buckets.map((b) => (
            <div key={b.bucket} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0' }}>
              <span>{b.bucket}</span>
              <span style={{ color: C.amber }}>{fmt(b.amount_aed)}</span>
            </div>
          ))}
        </Section>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <Section title="Credit Risk">
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 11 }}>
            {Object.entries(data.credit_risk.distribution).map(([k2, v]) => (
              <span key={k2} style={{ color: RISK_COL[k2.toUpperCase()] ?? C.textDim }}>{k2}: {v}</span>
            ))}
          </div>
          {data.credit_risk.top_risk_customers.length === 0 ? (
            <p style={{ fontSize: 12, color: C.textDim }}>No high-risk customers</p>
          ) : (
            data.credit_risk.top_risk_customers.map((c) => (
              <div key={c.customer_name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 0', borderBottom: `1px solid ${C.border}` }}>
                <span>{c.customer_name}</span>
                <span style={{ color: RISK_COL[c.risk_category] ?? C.textDim }}>{c.risk_category} · {c.credit_score}</span>
              </div>
            ))
          )}
        </Section>

        <Section title="Cash Forecast">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={data.cash_forecast.chart}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="period" tick={{ fontSize: 10, fill: C.textDim }} />
              <YAxis tick={{ fontSize: 10, fill: C.textDim }} />
              <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, fontSize: 11 }} formatter={(v: number) => [fmt(v), 'Expected']} />
              <Bar dataKey="amount" fill={C.teal} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11 }}>
            <span>30d: <strong style={{ color: C.teal }}>{fmt(data.cash_forecast.next_30_days)}</strong></span>
            <span>60d: <strong>{fmt(data.cash_forecast.next_60_days)}</strong></span>
            <span>90d: <strong>{fmt(data.cash_forecast.next_90_days)}</strong></span>
          </div>
        </Section>
      </div>

      <Section title="Collections Activity">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>Recent dunning</div>
            {data.collections_activity.recent_dunning.length === 0 ? (
              <p style={{ fontSize: 12, color: C.textDim }}>None this week</p>
            ) : (
              data.collections_activity.recent_dunning.map((d) => (
                <div key={d.invoice_number} style={{ fontSize: 11, padding: '4px 0' }}>
                  {d.invoice_number} · {d.customer} · L{d.level}
                </div>
              ))
            )}
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>
              Payments this week · {fmt(data.collections_activity.payments_this_week_total)}
            </div>
            {data.collections_activity.payments_this_week.map((p) => (
              <div key={p.invoice_number} style={{ fontSize: 11, padding: '4px 0' }}>
                {p.invoice_number} · {fmt(p.amount)} · {p.paid_date}
              </div>
            ))}
          </div>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: 20 }}>
      <div style={{ fontSize: 10, color: C.textDim, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}
