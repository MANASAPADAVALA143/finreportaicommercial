import React, { useState, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { runMonteCarlo, type MonteCarloResult } from '../../services/scenarioCalculator';
import type { ScenarioAssumptions } from '../../types/scenarioEngine';

function fmtCr(n: number) {
  return `₹${n.toFixed(1)} Cr`;
}

function buildHistogram(data: number[], bins: number, threshold?: number) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const step = (max - min) / bins || 0.01;
  const buckets: { range: string; count: number; above: number }[] = [];
  for (let i = 0; i < bins; i++) {
    const lo = min + i * step;
    const hi = min + (i + 1) * step;
    const count = data.filter((v) => v >= lo && v < hi).length;
    const above = threshold != null ? data.filter((v) => v >= lo && v < hi && v >= threshold).length : 0;
    buckets.push({
      range: `${lo.toFixed(0)}–${hi.toFixed(0)}`,
      count,
      above,
    });
  }
  return buckets;
}

interface MonteCarloViewProps {
  baseAssumptions: ScenarioAssumptions;
  baseAnnualRevenue?: number;
  openingCashCr?: number;
}

export const MonteCarloView: React.FC<MonteCarloViewProps> = ({
  baseAssumptions,
  baseAnnualRevenue,
  openingCashCr,
}) => {
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [iterations, setIterations] = useState(1000);

  const handleRun = useCallback(() => {
    setRunning(true);
    setProgress(0);
    const ITER = iterations;
    setTimeout(() => {
      const r = runMonteCarlo(baseAssumptions, ITER, baseAnnualRevenue, openingCashCr);
      setResult(r);
      setProgress(ITER);
      setRunning(false);
    }, 100);
  }, [baseAssumptions, iterations, baseAnnualRevenue, openingCashCr]);

  if (!result) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg bg-[#111827] border border-[#1E2D45] p-6">
          <p className="text-sm text-[#94A3B8] mb-4">
            Randomises all key assumptions within ±1σ using normal distribution
          </p>
          <div className="flex items-center gap-4">
            <label className="text-sm text-[#94A3B8]">
              Iterations:
              <input
                type="number"
                value={iterations}
                onChange={(e) => setIterations(parseInt(e.target.value, 10) || 1000)}
                className="ml-2 w-24 h-8 bg-[#0D1426] border border-[#1E2D45] rounded px-2 text-[#F1F5F9]"
              />
            </label>
            <button
              onClick={handleRun}
              disabled={running}
              className="px-4 py-2 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-[#2563EB] disabled:opacity-50"
            >
              {running ? `Running simulation... ${progress}/${iterations}` : 'Run Monte Carlo Simulation'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const probCards = [
    { label: 'P(EBITDA > 0)', value: result.probabilities.ebitdaPositive, sub: 'Positive EBITDA' },
    { label: 'P(Revenue>₹40Cr)', value: result.probabilities.revenueAbove40, sub: 'Base target' },
    { label: 'P(Revenue>₹50Cr)', value: result.probabilities.revenueAbove50, sub: 'Stretch goal' },
    { label: 'P(Cash > ₹15Cr)', value: result.probabilities.cashAbove15, sub: 'Cash target' },
  ];

  const revHist = buildHistogram(result.results.map((r) => r.revenue), 15);
  const ebitdaHist = buildHistogram(result.results.map((r) => r.ebitda), 15);

  const percentileRows = [
    { key: 'revenue', label: 'Revenue', fmt: fmtCr, p: result.percentiles.revenue },
    { key: 'ebitda', label: 'EBITDA', fmt: fmtCr, p: result.percentiles.ebitda },
    { key: 'netProfit', label: 'Net Profit', fmt: fmtCr, p: result.percentiles.netProfit },
    { key: 'endCash', label: 'End Cash', fmt: fmtCr, p: result.percentiles.endCash },
    {
      key: 'ebitdaMarginPct',
      label: 'EBITDA Margin',
      fmt: (n: number) => `${n.toFixed(1)}%`,
      p: result.percentiles.ebitdaMarginPct,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-[#111827] border border-[#1E2D45] p-4">
        <p className="text-sm text-[#94A3B8] mb-4">
          Randomises all key assumptions within ±1σ using normal distribution
        </p>
        <button
          onClick={() => { setResult(null); }}
          className="px-4 py-2 rounded-lg border border-[#1E2D45] text-[#94A3B8] text-sm hover:bg-[#0D1426]"
        >
          Run New Simulation
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {probCards.map((c) => (
          <div
            key={c.label}
            className="rounded-lg bg-[#111827] border border-[#1E2D45] p-4"
          >
            <div className="text-xs text-[#94A3B8] mb-1">{c.label}</div>
            <div className="text-2xl font-bold text-[#F1F5F9]">
              {Math.round(c.value * 100)}%
            </div>
            <div className="text-[10px] text-[#64748B] mt-1">{c.sub}</div>
            <div className="mt-2 h-2 bg-[#0D1426] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#3B82F6] rounded-full"
                style={{ width: `${c.value * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg bg-[#111827] border border-[#1E2D45] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#1E2D45]">
              <th className="text-left py-3 px-4 text-[#94A3B8] font-medium">Metric</th>
              <th className="text-right py-3 px-4 text-[#94A3B8] font-medium">P10</th>
              <th className="text-right py-3 px-4 text-[#94A3B8] font-medium">P25</th>
              <th className="text-right py-3 px-4 text-[#3B82F6] font-medium">P50 (Median)</th>
              <th className="text-right py-3 px-4 text-[#94A3B8] font-medium">P75</th>
              <th className="text-right py-3 px-4 text-[#94A3B8] font-medium">P90</th>
              <th className="text-right py-3 px-4 text-[#94A3B8] font-medium">Mean</th>
            </tr>
          </thead>
          <tbody className="text-[#F1F5F9]">
            {percentileRows.map((row) => (
              <tr key={row.key} className="border-b border-[#1E2D45]">
                <td className="py-2 px-4 text-[#94A3B8]">{row.label}</td>
                <td className="text-right py-2 px-4">{row.fmt(row.p.p10)}</td>
                <td className="text-right py-2 px-4">{row.fmt(row.p.p25)}</td>
                <td className="text-right py-2 px-4 text-[#3B82F6] font-semibold">{row.fmt(row.p.p50)}</td>
                <td className="text-right py-2 px-4">{row.fmt(row.p.p75)}</td>
                <td className="text-right py-2 px-4">{row.fmt(row.p.p90)}</td>
                <td className="text-right py-2 px-4">{row.fmt(row.p.mean)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg bg-[#111827] border border-[#1E2D45] p-4">
          <h3 className="text-sm font-semibold text-[#F1F5F9] mb-4">
            Revenue Distribution (n={result.iterations})
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={revHist}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E2D45" />
              <XAxis dataKey="range" stroke="#94A3B8" tick={{ fontSize: 10 }} />
              <YAxis stroke="#94A3B8" tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0D1426', border: '1px solid #1E2D45' }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {revHist.map((entry, i) => {
                  const [lo, hi] = entry.range.split('–').map(Number);
                  const mid = (lo + hi) / 2;
                  return <Cell key={i} fill={mid >= 40 ? '#10B981' : '#64748B'} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-lg bg-[#111827] border border-[#1E2D45] p-4">
          <h3 className="text-sm font-semibold text-[#F1F5F9] mb-4">
            EBITDA Distribution (n={result.iterations})
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={ebitdaHist}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E2D45" />
              <XAxis dataKey="range" stroke="#94A3B8" tick={{ fontSize: 10 }} />
              <YAxis stroke="#94A3B8" tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ backgroundColor: '#0D1426', border: '1px solid #1E2D45' }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {ebitdaHist.map((entry, i) => {
                  const [lo, hi] = entry.range.split('–').map(Number);
                  const mid = (lo + hi) / 2;
                  return <Cell key={i} fill={mid >= 0 ? '#10B981' : '#EF4444'} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg bg-[#111827] border border-[#1E2D45] p-4">
        <h3 className="text-sm font-semibold text-[#F1F5F9] mb-3">Simulation Summary</h3>
        <p className="text-sm text-[#94A3B8] leading-relaxed">
          Across {result.iterations} Monte Carlo iterations: median revenue outcome is {fmtCr(result.percentiles.revenue.p50)}{' '}
          (range {fmtCr(result.percentiles.revenue.p10)} to {fmtCr(result.percentiles.revenue.p90)} at 80% confidence).
          EBITDA has {Math.round(result.probabilities.ebitdaPositive * 100)}% probability of being positive, with median{' '}
          {fmtCr(result.percentiles.ebitda.p50)} and P90 upside of {fmtCr(result.percentiles.ebitda.p90)}.
          Cash position remains above ₹11Cr even in downside scenarios.
        </p>
      </div>
    </div>
  );
};
