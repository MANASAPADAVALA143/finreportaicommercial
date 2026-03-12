import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { ScenarioType, ScenarioResult } from '../../types/scenarioEngine';

const SCENARIO_CONFIG: Record<ScenarioType, { label: string; color: string }> = {
  base: { label: 'Base', color: '#3B82F6' },
  growth: { label: 'Growth', color: '#10B981' },
  conservative: { label: 'Conservative', color: '#F59E0B' },
  stress: { label: 'Stress', color: '#EF4444' },
};

function fmtCr(n: number) {
  return `₹${n.toFixed(1)} Cr`;
}

interface CompareViewProps {
  results: Record<ScenarioType, ScenarioResult>;
  fy25Actual?: { revenue: number; grossProfit: number; grossMarginPct: number; ebitda: number; ebitdaMarginPct: number; netProfit: number; endCash: number };
}

const FY25_ACTUAL = {
  revenue: 36,
  grossProfit: 25,
  grossMarginPct: 69.4,
  ebitda: 5.2,
  ebitdaMarginPct: 14.4,
  netProfit: 3.1,
  endCash: 16.2,
};

export const CompareView: React.FC<CompareViewProps> = ({
  results,
  fy25Actual = FY25_ACTUAL,
}) => {
  const scenarios: ScenarioType[] = ['base', 'growth', 'conservative', 'stress'];

  const mergedRev = results.base.monthlyPL.map((m, i) => {
    const row: Record<string, string | number> = { month: m.month };
    scenarios.forEach((s) => (row[s] = results[s].monthlyPL[i]?.revenue ?? 0));
    return row;
  });

  const mergedEbitda = results.base.monthlyPL.map((m, i) => {
    const row: Record<string, string | number> = { month: m.month };
    scenarios.forEach((s) => (row[s] = results[s].monthlyPL[i]?.ebitda ?? 0));
    return row;
  });

  const metrics = [
    { key: 'revenue', label: 'Revenue' },
    { key: 'grossProfit', label: 'Gross Profit' },
    { key: 'grossMarginPct', label: 'Gross Margin %', isPct: true },
    { key: 'ebitda', label: 'EBITDA' },
    { key: 'ebitdaMarginPct', label: 'EBITDA Margin %', isPct: true },
    { key: 'netProfit', label: 'Net Profit' },
    { key: 'endCash', label: 'End Cash' },
  ];

  const fmt = (v: number, isPct?: boolean) =>
    isPct ? `${v.toFixed(1)}%` : fmtCr(v);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg bg-[#111827] border border-[#1E2D45] p-4">
          <h3 className="text-sm font-semibold text-[#F1F5F9] mb-4">Revenue — All Scenarios</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={mergedRev}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E2D45" />
              <XAxis dataKey="month" stroke="#94A3B8" tick={{ fontSize: 11 }} />
              <YAxis stroke="#94A3B8" tick={{ fontSize: 11 }} tickFormatter={(v) => v.toFixed(1)} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0D1426', border: '1px solid #1E2D45' }}
                formatter={(v: number) => [fmtCr(v), '']}
              />
              <Legend />
              {scenarios.map((s) => (
                <Line
                  key={s}
                  type="monotone"
                  dataKey={s}
                  stroke={SCENARIO_CONFIG[s].color}
                  strokeWidth={2}
                  dot={false}
                  name={SCENARIO_CONFIG[s].label}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg bg-[#111827] border border-[#1E2D45] p-4">
          <h3 className="text-sm font-semibold text-[#F1F5F9] mb-4">EBITDA — All Scenarios</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={mergedEbitda}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E2D45" />
              <XAxis dataKey="month" stroke="#94A3B8" tick={{ fontSize: 11 }} />
              <YAxis stroke="#94A3B8" tick={{ fontSize: 11 }} tickFormatter={(v) => v.toFixed(1)} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0D1426', border: '1px solid #1E2D45' }}
                formatter={(v: number) => [fmtCr(v), '']}
              />
              <Legend />
              {scenarios.map((s) => (
                <Line
                  key={s}
                  type="monotone"
                  dataKey={s}
                  stroke={SCENARIO_CONFIG[s].color}
                  strokeWidth={2}
                  dot={false}
                  name={SCENARIO_CONFIG[s].label}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg bg-[#111827] border border-[#1E2D45] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#1E2D45]">
              <th className="text-left py-3 px-4 text-[#94A3B8] font-medium">Metric</th>
              <th className="text-right py-3 px-4 text-[#F1F5F9] font-medium">FY25 Actual</th>
              {scenarios.map((s) => (
                <th key={s} className="text-right py-3 px-4 font-medium" style={{ color: SCENARIO_CONFIG[s].color }}>
                  {SCENARIO_CONFIG[s].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-[#F1F5F9]">
            {metrics.map((m) => {
              const isPct = m.key.includes('Margin') || m.key.includes('Pct');
              const getVal = (s: ScenarioResult) => {
                if (m.key === 'grossProfit')
                  return s.annualKPIs.revenue * (s.annualKPIs.grossMarginPct / 100);
                return (s.annualKPIs as Record<string, number>)[m.key];
              };
              const actualVal = (fy25Actual as Record<string, number>)[m.key];
              return (
                <tr key={m.key} className="border-b border-[#1E2D45]">
                  <td className="py-2 px-4 text-[#94A3B8]">{m.label}</td>
                  <td className="text-right py-2 px-4 text-[#F1F5F9]">{fmt(actualVal ?? 0, isPct)}</td>
                  {scenarios.map((s) => (
                    <td key={s} className="text-right py-2 px-4" style={{ color: SCENARIO_CONFIG[s].color }}>
                      {fmt(getVal(results[s]) ?? 0, isPct)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
