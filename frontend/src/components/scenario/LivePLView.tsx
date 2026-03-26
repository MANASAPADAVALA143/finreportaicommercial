import React, { useState } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import type { ScenarioType, ScenarioResult, MonthlyPL } from '../../types/scenarioEngine';

const SCENARIO_COLORS: Record<ScenarioType, string> = {
  base: '#3B82F6',
  growth: '#10B981',
  conservative: '#F59E0B',
  stress: '#EF4444',
};

function fmtCr(n: number) {
  return `₹${n.toFixed(1)} Cr`;
}
function fmtL(n: number) {
  return `₹${n.toFixed(1)} L`;
}

interface LivePLViewProps {
  result: ScenarioResult;
  baseResult: ScenarioResult;
  onRegenerateNarrative?: () => Promise<void>;
}

export const LivePLView: React.FC<LivePLViewProps> = ({ result, baseResult, onRegenerateNarrative }) => {
  const [regenLoading, setRegenLoading] = useState(false);

  const handleRegenerate = async () => {
    if (!onRegenerateNarrative) return;
    setRegenLoading(true);
    try {
      await onRegenerateNarrative();
    } finally {
      setRegenLoading(false);
    }
  };

  const color = SCENARIO_COLORS[result.scenarioType];
  const revData = result.monthlyPL.map((m, i) => ({
    month: m.month,
    current: m.revenue,
    base: baseResult.monthlyPL[i]?.revenue ?? m.revenue,
  }));

  const ebitdaData = result.monthlyPL.map((m) => ({
    month: m.month,
    ebitda: m.ebitda,
  }));

  const annualRev = result.annualKPIs.revenue;
  const baseRev = baseResult.annualKPIs.revenue;
  const annualCogs = result.monthlyPL.reduce((s, m) => s + m.cogs, 0);
  const baseCogs = baseResult.monthlyPL.reduce((s, m) => s + m.cogs, 0);
  const annualGross = result.monthlyPL.reduce((s, m) => s + m.grossProfit, 0);
  const baseGross = baseResult.monthlyPL.reduce((s, m) => s + m.grossProfit, 0);
  const annualOpex = result.monthlyPL.reduce((s, m) => s + m.totalOpex, 0);
  const baseOpex = baseResult.monthlyPL.reduce((s, m) => s + m.totalOpex, 0);
  const annualEbitda = result.annualKPIs.ebitda;
  const baseEbitda = baseResult.annualKPIs.ebitda;
  const annualNet = result.annualKPIs.netProfit;
  const baseNet = baseResult.annualKPIs.netProfit;
  const annualCash = result.monthlyPL.reduce((s, m) => s + m.cashFlow, 0);
  const baseCash = baseResult.monthlyPL.reduce((s, m) => s + m.cashFlow, 0);

  const dRev = annualRev - baseRev;
  const dCogs = annualCogs - baseCogs;
  const dGross = annualGross - baseGross;
  const dEbitda = annualEbitda - baseEbitda;
  const dNet = annualNet - baseNet;
  const dCash = annualCash - baseCash;

  const isBase = result.scenarioType === 'base';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg bg-[#111827] border border-[#1E2D45] p-4">
          <h3 className="text-sm font-semibold text-[#F1F5F9] mb-4">Monthly Revenue — FY2026</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={revData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E2D45" />
              <XAxis dataKey="month" stroke="#94A3B8" tick={{ fontSize: 11 }} />
              <YAxis stroke="#94A3B8" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v.toFixed(1)}`} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0D1426', border: '1px solid #1E2D45' }}
                labelStyle={{ color: '#F1F5F9' }}
                formatter={(v: number) => [fmtCr(v), '']}
                labelFormatter={(l) => l}
              />
              <ReferenceLine y={baseResult.monthlyPL[0]?.revenue} stroke="#64748B" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="base" stroke="#64748B" strokeDasharray="4 4" dot={false} name="Base" strokeWidth={1} />
              <Line type="monotone" dataKey="current" stroke={color} strokeWidth={2} dot={{ r: 3 }} name="Current" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg bg-[#111827] border border-[#1E2D45] p-4">
          <h3 className="text-sm font-semibold text-[#F1F5F9] mb-4">EBITDA Monthly — FY2026</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={ebitdaData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E2D45" />
              <XAxis dataKey="month" stroke="#94A3B8" tick={{ fontSize: 11 }} />
              <YAxis stroke="#94A3B8" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v.toFixed(1)}`} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0D1426', border: '1px solid #1E2D45' }}
                formatter={(v: number) => [fmtCr(v), 'EBITDA']}
              />
              <Bar dataKey="ebitda" radius={[4, 4, 0, 0]}>
                {ebitdaData.map((_, i) => (
                  <Cell key={i} fill={result.monthlyPL[i].ebitda >= 0 ? '#10B981' : '#EF4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg bg-[#111827] border border-[#1E2D45] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1E2D45]">
                <th className="text-left py-3 px-4 text-[#94A3B8] font-medium">FY2026 P&L</th>
                {result.monthlyPL.map((m) => (
                  <th key={m.month} className="text-right py-3 px-2 text-[#94A3B8] font-medium w-20">
                    {m.month}
                  </th>
                ))}
                <th className="text-right py-3 px-4 text-[#F1F5F9] font-semibold sticky right-0 bg-[#0D1426]">
                  Annual
                </th>
                <th className="text-right py-3 px-4 text-[#94A3B8] font-medium sticky right-0 bg-[#0D1426]">
                  Δ vs Base
                </th>
              </tr>
            </thead>
            <tbody className="text-[#F1F5F9]">
              <tr className="border-b border-[#1E2D45]">
                <td className="py-2 px-4 font-semibold" style={{ color }}>Revenue</td>
                {result.monthlyPL.map((m) => (
                  <td key={m.month} className="text-right py-2 px-2">{fmtCr(m.revenue)}</td>
                ))}
                <td className="text-right py-2 px-4 font-semibold sticky right-0 bg-[#0D1426]">{fmtCr(annualRev)}</td>
                <td className={`text-right py-2 px-4 sticky right-0 bg-[#0D1426] ${isBase ? 'text-[#64748B]' : dRev >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                  {isBase ? '—' : (dRev >= 0 ? '+' : '') + fmtCr(dRev)}
                </td>
              </tr>
              <tr className="border-b border-[#1E2D45] bg-[#0D1426]/50">
                <td className="py-2 px-4 text-[#94A3B8]">COGS</td>
                {result.monthlyPL.map((m) => (
                  <td key={m.month} className="text-right py-2 px-2 text-[#94A3B8]">{fmtCr(m.cogs)}</td>
                ))}
                <td className="text-right py-2 px-4 sticky right-0 bg-[#0D1426]">{fmtCr(annualCogs)}</td>
                <td className={`text-right py-2 px-4 sticky right-0 bg-[#0D1426] ${isBase ? 'text-[#64748B]' : dCogs <= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                  {isBase ? '—' : (dCogs >= 0 ? '+' : '') + fmtCr(dCogs)}
                </td>
              </tr>
              <tr className="border-b border-[#1E2D45]">
                <td className="py-2 px-4 font-semibold" style={{ color }}>Gross Profit</td>
                {result.monthlyPL.map((m) => (
                  <td key={m.month} className="text-right py-2 px-2">{fmtCr(m.grossProfit)}</td>
                ))}
                <td className="text-right py-2 px-4 font-semibold sticky right-0 bg-[#0D1426]">{fmtCr(annualGross)}</td>
                <td className={`text-right py-2 px-4 sticky right-0 bg-[#0D1426] ${isBase ? 'text-[#64748B]' : dGross >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                  {isBase ? '—' : (dGross >= 0 ? '+' : '') + fmtCr(dGross)}
                </td>
              </tr>
              <tr className="border-b border-[#1E2D45] bg-[#0D1426]/30">
                <td className="py-2 px-4 text-[#94A3B8]">Gross Margin %</td>
                {result.monthlyPL.map((m) => (
                  <td key={m.month} className="text-right py-2 px-2 text-[#94A3B8]">{m.grossMarginPct.toFixed(1)}%</td>
                ))}
                <td className="text-right py-2 px-4 sticky right-0 bg-[#0D1426]">{result.annualKPIs.grossMarginPct.toFixed(1)}%</td>
                <td className="text-right py-2 px-4 sticky right-0 bg-[#0D1426] text-[#64748B]">—</td>
              </tr>
              <tr className="border-b border-[#1E2D45]">
                <td className="py-2 px-4 text-[#94A3B8]">Marketing</td>
                {result.monthlyPL.map((m) => (
                  <td key={m.month} className="text-right py-2 px-2 text-[#94A3B8]">{fmtL(m.marketingExpense)}</td>
                ))}
                <td className="text-right py-2 px-4 sticky right-0 bg-[#0D1426]">{fmtL(result.assumptions.marketingSpend)}</td>
                <td className="text-right py-2 px-4 sticky right-0 bg-[#0D1426] text-[#64748B]">—</td>
              </tr>
              <tr className="border-b border-[#1E2D45]">
                <td className="py-2 px-4 text-[#94A3B8]">Headcount</td>
                {result.monthlyPL.map((m) => (
                  <td key={m.month} className="text-right py-2 px-2 text-[#94A3B8]">{fmtL(m.headcountCost)}</td>
                ))}
                <td className="text-right py-2 px-4 sticky right-0 bg-[#0D1426]">{fmtL(result.monthlyPL.reduce((s, m) => s + m.headcountCost, 0))}</td>
                <td className="text-right py-2 px-4 sticky right-0 bg-[#0D1426] text-[#64748B]">—</td>
              </tr>
              <tr className="border-b border-[#1E2D45]">
                <td className="py-2 px-4 text-[#94A3B8]">R&D</td>
                {result.monthlyPL.map((m) => (
                  <td key={m.month} className="text-right py-2 px-2 text-[#94A3B8]">{fmtL(m.rdExpense)}</td>
                ))}
                <td className="text-right py-2 px-4 sticky right-0 bg-[#0D1426]">{fmtL(result.assumptions.rdInvestment)}</td>
                <td className="text-right py-2 px-4 sticky right-0 bg-[#0D1426] text-[#64748B]">—</td>
              </tr>
              <tr className="border-b border-[#1E2D45]">
                <td className="py-2 px-4 text-[#94A3B8]">Overhead</td>
                {result.monthlyPL.map((m) => (
                  <td key={m.month} className="text-right py-2 px-2 text-[#94A3B8]">{fmtL(m.overhead)}</td>
                ))}
                <td className="text-right py-2 px-4 sticky right-0 bg-[#0D1426]">{fmtL(result.monthlyPL.reduce((s, m) => s + m.overhead, 0))}</td>
                <td className="text-right py-2 px-4 sticky right-0 bg-[#0D1426] text-[#64748B]">—</td>
              </tr>
              <tr className="border-b border-[#1E2D45]">
                <td className="py-2 px-4 font-semibold" style={{ color }}>EBITDA</td>
                {result.monthlyPL.map((m) => (
                  <td key={m.month} className="text-right py-2 px-2">{fmtCr(m.ebitda)}</td>
                ))}
                <td className="text-right py-2 px-4 font-semibold sticky right-0 bg-[#0D1426]">{fmtCr(annualEbitda)}</td>
                <td className={`text-right py-2 px-4 sticky right-0 bg-[#0D1426] ${isBase ? 'text-[#64748B]' : dEbitda >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                  {isBase ? '—' : (dEbitda >= 0 ? '+' : '') + fmtCr(dEbitda)}
                </td>
              </tr>
              <tr className="border-b border-[#1E2D45]">
                <td className="py-2 px-4 font-semibold" style={{ color }}>Net Profit</td>
                {result.monthlyPL.map((m) => (
                  <td key={m.month} className="text-right py-2 px-2">{fmtCr(m.netProfit)}</td>
                ))}
                <td className="text-right py-2 px-4 font-semibold sticky right-0 bg-[#0D1426]">{fmtCr(annualNet)}</td>
                <td className={`text-right py-2 px-4 sticky right-0 bg-[#0D1426] ${isBase ? 'text-[#64748B]' : dNet >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                  {isBase ? '—' : (dNet >= 0 ? '+' : '') + fmtCr(dNet)}
                </td>
              </tr>
              <tr className="border-b border-[#1E2D45]">
                <td className="py-2 px-4 text-[#94A3B8]">Cash Flow</td>
                {result.monthlyPL.map((m) => (
                  <td key={m.month} className="text-right py-2 px-2 text-[#94A3B8]">{fmtCr(m.cashFlow)}</td>
                ))}
                <td className="text-right py-2 px-4 sticky right-0 bg-[#0D1426]">{fmtCr(annualCash)}</td>
                <td className={`text-right py-2 px-4 sticky right-0 bg-[#0D1426] ${isBase ? 'text-[#64748B]' : dCash >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                  {isBase ? '—' : (dCash >= 0 ? '+' : '') + fmtCr(dCash)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg bg-[#111827] border border-[#1E2D45] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[#F1F5F9]">
            AI Analysis — {result.scenarioType.charAt(0).toUpperCase() + result.scenarioType.slice(1)} Case
          </h3>
          <button
            onClick={handleRegenerate}
            disabled={regenLoading}
            className="text-xs text-[#3B82F6] hover:underline disabled:opacity-50"
          >
            {regenLoading ? 'Regenerating...' : 'Regenerate Analysis'}
          </button>
        </div>
        <p className="text-sm text-[#94A3B8] leading-relaxed">
          {result.aiNarrative || 'Under the ' + result.scenarioType + ' scenario, revenue reaches ₹' + result.annualKPIs.revenue.toFixed(1) + 'Cr (FY2026). EBITDA is ₹' + result.annualKPIs.ebitda.toFixed(1) + 'Cr (' + result.annualKPIs.ebitdaMarginPct.toFixed(1) + '% margin). Net profit ₹' + result.annualKPIs.netProfit.toFixed(1) + 'Cr. End cash ₹' + result.annualKPIs.endCash.toFixed(1) + 'Cr.'}
        </p>
      </div>
    </div>
  );
};
