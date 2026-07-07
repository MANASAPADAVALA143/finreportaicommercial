import { AlertTriangle, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { REV_REC_BLUE } from '../../utils/revRecParse';
import type { LeakageSummary } from '../../utils/revRecLeakage';
import { formatTrend, leakageStatusLabel } from '../../utils/revRecLeakage';

export function RevenueLeakageCard({ summary }: { summary: LeakageSummary }) {
  const trend = formatTrend(summary);
  const isClean = summary.leakage_total <= 0 && summary.item_count === 0;

  const TrendIcon =
    summary.trend_direction === 'increase'
      ? TrendingUp
      : summary.trend_direction === 'decrease'
        ? TrendingDown
        : Minus;

  const trendColor =
    summary.trend_direction === 'increase'
      ? 'text-red-700'
      : summary.trend_direction === 'decrease'
        ? 'text-emerald-700'
        : 'text-slate-600';

  return (
    <div
      className={`rounded-xl border p-5 ${
        isClean ? 'border-emerald-200 bg-emerald-50/60' : 'border-orange-200 bg-orange-50/50'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            {!isClean ? <AlertTriangle className="w-5 h-5 text-orange-600" /> : null}
            Revenue Leakage Identified
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Under-billed or unbilled revenue from three-way match exceptions
          </p>
        </div>
        {trend ? (
          <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-white border border-slate-200 ${trendColor}`}>
            <TrendIcon className="w-3.5 h-3.5" />
            {trend}
          </span>
        ) : null}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="rounded-lg bg-white border border-slate-200 p-3 text-center">
          <p className="text-xs text-slate-500 uppercase">Leakage this period</p>
          <p className={`text-2xl font-bold mt-1 ${isClean ? 'text-emerald-700' : 'text-orange-700'}`}>
            ${summary.leakage_total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div className="rounded-lg bg-white border border-slate-200 p-3 text-center">
          <p className="text-xs text-slate-500 uppercase">% of expected revenue</p>
          <p className={`text-2xl font-bold mt-1 ${summary.leakage_pct >= 5 ? 'text-red-700' : 'text-slate-900'}`}>
            {summary.leakage_pct.toFixed(1)}%
          </p>
        </div>
        <div className="rounded-lg bg-white border border-slate-200 p-3 text-center">
          <p className="text-xs text-slate-500 uppercase">Contracts affected</p>
          <p className="text-2xl font-bold mt-1 text-slate-900">{summary.item_count}</p>
        </div>
        <div className="rounded-lg bg-white border border-slate-200 p-3 text-center">
          <p className="text-xs text-slate-500 uppercase">Prior period leakage</p>
          <p className="text-2xl font-bold mt-1 text-slate-900">
            {summary.prior_leakage_total != null
              ? `$${Number(summary.prior_leakage_total).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
              : '—'}
          </p>
          {summary.prior_period ? (
            <p className="text-[10px] text-slate-400 mt-0.5">{summary.prior_period}</p>
          ) : null}
        </div>
      </div>

      {!isClean && summary.items.length > 0 ? (
        <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-600 border-b bg-slate-50">
                <th className="px-3 py-2">Contract</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-right">Leakage $</th>
              </tr>
            </thead>
            <tbody>
              {summary.items.map((row) => (
                <tr key={row.contract_id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs">{row.contract_id}</td>
                  <td className="px-3 py-2">{row.customer}</td>
                  <td className="px-3 py-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-900 font-medium">
                      {leakageStatusLabel(row.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-orange-800">
                    ${row.leakage_amount.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-emerald-800 font-medium">No under-billed or unbilled revenue leakage identified.</p>
      )}

      <p className="text-[10px] text-slate-400 mt-3" style={{ color: REV_REC_BLUE }}>
        Expected revenue basis: schedule amount, falling back to GL when schedule is absent.
      </p>
    </div>
  );
}

export function RevenueLeakagePill({
  summary,
}: {
  summary: LeakageSummary | null;
}) {
  if (!summary) {
    return (
      <span className="rounded-full px-3 py-1.5 text-xs font-semibold border bg-slate-100 text-slate-500 border-slate-200">
        Leakage: —
      </span>
    );
  }
  if (summary.leakage_total <= 0) {
    return (
      <span className="rounded-full px-3 py-1.5 text-xs font-semibold border bg-emerald-50 text-emerald-800 border-emerald-200">
        Leakage: ✓ None
      </span>
    );
  }
  const high = summary.leakage_pct >= 5;
  return (
    <span
      className={`rounded-full px-3 py-1.5 text-xs font-semibold border ${
        high ? 'bg-red-50 text-red-800 border-red-200' : 'bg-orange-50 text-orange-900 border-orange-200'
      }`}
    >
      Leakage: ${summary.leakage_total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
    </span>
  );
}
