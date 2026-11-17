import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../../../context/AuthContext';
import {
  getGroupPosition,
  getGroupSeries,
  shiftMonth,
  showMoney,
  type GroupPosition,
  type GroupSeries,
  type Money,
} from '../../../services/groupIntelligence.service';
import { C, currentPeriod, GroupFilters, Notice } from './ui';

const CARDS: { key: keyof GroupPosition['kpis']; label: string }[] = [
  { key: 'group_revenue', label: 'Group revenue' },
  { key: 'ebitda', label: 'EBITDA' },
  { key: 'net_profit', label: 'Net profit' },
  { key: 'total_assets', label: 'Total assets' },
  { key: 'total_liabilities', label: 'Total liabilities' },
  { key: 'gl_cash', label: 'GL cash' },
  { key: 'bank_cash', label: 'Bank cash' },
  { key: 'net_debt', label: 'Net debt' },
  { key: 'working_capital', label: 'Working capital' },
];

export default function CommandCentre() {
  const { accessToken } = useAuth();
  const [period, setPeriod] = useState(currentPeriod);
  const [currency, setCurrency] = useState('');
  const [companyIds, setCompanyIds] = useState<string[]>([]);
  const [position, setPosition] = useState<GroupPosition | null>(null);
  const [series, setSeries] = useState<GroupSeries | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const start = shiftMonth(period, -5);
    Promise.all([
      getGroupPosition(accessToken, period, currency, companyIds),
      getGroupSeries(accessToken, start, period, currency, companyIds),
    ])
      .then(([nextPosition, nextSeries]) => {
        if (cancelled) return;
        setPosition(nextPosition);
        setSeries(nextSeries);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || 'The group position could not be loaded');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, period, currency, companyIds]);

  const trend = (series?.points ?? []).map((point) => ({
    period: point.period,
    Revenue: point.revenue.available ? point.revenue.value : null,
    EBITDA: point.ebitda.available ? point.ebitda.value : null,
    'Net margin %': point.margin_pct.available ? point.margin_pct.value : null,
  }));
  const contribution = (position?.entities ?? [])
    .filter((entity) => entity.reporting.revenue.available)
    .map((entity) => ({
      name: entity.company_name,
      Revenue: entity.reporting.revenue.value,
      EBITDA: entity.reporting.ebitda.available ? entity.reporting.ebitda.value : null,
    }));

  return (
    <div style={{ background: C.bg, minHeight: '100%', color: C.text, padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: C.gold, letterSpacing: '0.14em', fontSize: 12 }}>GNANOVA CFO</div>
          <h1 style={{ margin: '4px 0 0', fontSize: 28 }}>Group financial command centre</h1>
          <p style={{ color: C.dim, marginTop: 6 }}>
            Figures come from the group intelligence service. Unavailable metrics stay blank.
          </p>
        </div>
        <Link to="/cfo/group/entities" style={{ color: C.teal, alignSelf: 'center' }}>Entity performance</Link>
      </div>

      <div style={{ marginTop: 20 }}>
        <GroupFilters
          token={accessToken}
          period={period}
          currency={currency}
          companyIds={companyIds}
          onPeriod={setPeriod}
          onCurrency={setCurrency}
          onCompanies={setCompanyIds}
        />
      </div>

      {loading && <div style={{ marginTop: 20 }}><Notice text="Loading the group position from posted journals." /></div>}
      {error && <div style={{ marginTop: 20 }}><Notice tone="error" text={error} /></div>}

      {position && !loading && (
        <>
          <div style={{ color: C.dim, fontSize: 12, marginTop: 16 }}>
            Period {position.period} · Reporting currency {position.reporting_currency || 'not set'} · Status {position.status}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 12 }}>
            {CARDS.map((card) => (
              <Kpi key={card.key} label={card.label} money={position.kpis[card.key]} period={position.period} />
            ))}
          </div>

          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginTop: 20 }}>
            <ChartCard title="Monthly revenue and EBITDA" caption={`Actuals in ${series?.reporting_currency || position.reporting_currency}. Forecasts are not shown.`}>
              <TrendChart data={trend} />
            </ChartCard>
            <ChartCard title="Net margin" caption="Consolidated net profit divided by consolidated revenue.">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trend}>
                  <CartesianGrid stroke={C.border} />
                  <XAxis dataKey="period" stroke={C.dim} fontSize={11} />
                  <YAxis stroke={C.dim} fontSize={11} unit="%" />
                  <Tooltip />
                  <Line dataKey="Net margin %" stroke={C.gold} dot={false} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Entity contribution" caption="Reporting currency only. Entities without a rate are omitted.">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={contribution}>
                  <CartesianGrid stroke={C.border} />
                  <XAxis dataKey="name" stroke={C.dim} fontSize={11} />
                  <YAxis stroke={C.dim} fontSize={11} />
                  <Tooltip />
                  <Bar dataKey="Revenue" fill={C.teal} />
                  <Bar dataKey="EBITDA" fill={C.gold} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Budget versus actual" caption={series?.points[0]?.budget.reason || 'Budget is not available for these entities.'}>
              <Notice text={series?.points[0]?.budget.reason || 'Budget versus actual is unavailable.'} />
            </ChartCard>
          </section>

          <section style={{ marginTop: 20 }}>
            <h2 style={{ fontSize: 16, color: C.gold }}>Entity comparison</h2>
            <EntityStrip position={position} />
          </section>

          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginTop: 20 }}>
            <div>
              <h2 style={{ fontSize: 16, color: C.gold }}>Exceptions</h2>
              {position.alerts.length === 0 && <Notice text="No group exceptions for this period." />}
              {position.alerts.map((alert) => (
                <Link key={alert.title} to={alert.href} style={panelLink}>
                  <strong>{alert.title}</strong>
                  <div style={{ color: C.dim, fontSize: 12, marginTop: 4 }}>{alert.detail}</div>
                  <div style={{ color: C.teal, fontSize: 11, marginTop: 6 }}>Source: {alert.source}</div>
                </Link>
              ))}
            </div>
            <div>
              <h2 style={{ fontSize: 16, color: C.gold }}>Rule-based insights</h2>
              {position.insights.length === 0 && <Notice text="No material movement was detected from the verified figures." />}
              {position.insights.map((insight) => (
                <div key={insight.title} style={panel}>
                  <strong>{insight.title}</strong>
                  <div style={{ color: C.dim, fontSize: 13, marginTop: 6 }}>{insight.detail}</div>
                  {insight.figures.map((figure) => (
                    <div key={figure.label || figure.method} style={{ fontSize: 12, marginTop: 4 }}>
                      {figure.label}: {showMoney(figure)}
                    </div>
                  ))}
                  <div style={{ marginTop: 8 }}>{insight.action}</div>
                  <Link to={insight.href} style={{ color: C.teal, fontSize: 12 }}>Open the source screen</Link>
                </div>
              ))}
            </div>
          </section>

          <p style={{ color: C.dim, fontSize: 12, marginTop: 16 }}>
            {position.bridge.reconciled
              ? `Revenue bridge closes: entities ${position.bridge.revenue.entity_reporting_sum} − eliminations ${position.bridge.revenue.eliminations} = group ${position.bridge.revenue.group_consolidated} ${position.bridge.revenue.currency}.`
              : position.bridge.revenue.method}
          </p>
        </>
      )}
    </div>
  );
}

function Kpi({ label, money, period }: { label: string; money: Money; period: string }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
      <div style={{ color: C.gold, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 22, marginTop: 8, color: money.available ? C.teal : C.amber }}>{showMoney(money)}</div>
      <div style={{ color: C.dim, fontSize: 11, marginTop: 8 }}>
        {money.currency || '—'} · {period} · {money.available ? 'Available' : 'Unavailable'}
      </div>
      <div style={{ color: C.dim, fontSize: 11, marginTop: 4 }}>{money.available ? money.method : money.reason}</div>
    </div>
  );
}

function ChartCard({ title, caption, children }: { title: string; caption: string; children: ReactNode }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
      <div style={{ fontWeight: 600 }}>{title}</div>
      <div style={{ color: C.dim, fontSize: 12, margin: '4px 0 8px' }}>{caption}</div>
      {children}
    </div>
  );
}

function TrendChart({ data }: { data: Array<Record<string, string | number | null>> }) {
  const hasPoint = data.some((row) => row.Revenue != null || row.EBITDA != null);
  if (!hasPoint) return <Notice text="No translated monthly actuals in this range." />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}>
        <CartesianGrid stroke={C.border} />
        <XAxis dataKey="period" stroke={C.dim} fontSize={11} />
        <YAxis stroke={C.dim} fontSize={11} />
        <Tooltip />
        <Line dataKey="Revenue" stroke={C.teal} dot={false} connectNulls={false} />
        <Line dataKey="EBITDA" stroke={C.gold} dot={false} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function EntityStrip({ position }: { position: GroupPosition }) {
  if (!position.entities.length) return <Notice text="This workspace has no active entities." />;
  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 12 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ color: C.dim, textAlign: 'left' }}>
            <th style={th}>Entity</th><th style={th}>Revenue</th><th style={th}>EBITDA</th><th style={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {position.entities.map((entity) => (
            <tr key={entity.company_id} style={{ borderTop: `1px solid ${C.border}` }}>
              <td style={td}>{entity.company_name}</td>
              <td style={td}>{showMoney(entity.reporting.revenue)}</td>
              <td style={td}>{showMoney(entity.reporting.ebitda)}</td>
              <td style={td}>{entity.health.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const panel: CSSProperties = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginTop: 8 };
const panelLink: CSSProperties = { ...panel, display: 'block', color: C.text, textDecoration: 'none' };
const th: CSSProperties = { padding: '10px 12px' };
const td: CSSProperties = { padding: '10px 12px' };
