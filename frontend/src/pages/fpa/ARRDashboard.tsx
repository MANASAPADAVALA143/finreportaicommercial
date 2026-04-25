import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Play } from 'lucide-react';
import { FpaPageShell } from '../../components/fpa/FpaPageShell';
import { CSVUploader } from '../../components/fpa/CSVUploader';
import { LoadingSpinner } from '../../components/fpa/LoadingSpinner';
import { ErrorBanner } from '../../components/fpa/ErrorBanner';
import { postFpaJson } from '../../lib/fpaApi';
import { exportRowsToExcel } from '../../utils/fpaExport';

type Month = {
  month: string;
  beginning_arr: number;
  new_arr: number;
  expansion: number;
  contraction: number;
  churn: number;
  ending_arr: number;
  mrr: number;
};

type ARRRes = {
  arr_total: number;
  mrr: number;
  nrr_pct: number;
  grr_pct: number;
  rule_of_40: number;
  cac_payback_months: number;
  commentary: string;
  benchmarks: { nrr_target_pct: number; nrr_ok: boolean; rule40_ok: boolean };
  waterfall_avg_month: Record<string, number>;
};

const blankMonths = (): Month[] =>
  Array.from({ length: 12 }, (_, i) => ({
    month: `M${i + 1}`,
    beginning_arr: 0,
    new_arr: 0,
    expansion: 0,
    contraction: 0,
    churn: 0,
    ending_arr: 0,
    mrr: 0,
  }));

export default function ARRDashboard() {
  const [months, setMonths] = useState<Month[]>(blankMonths());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<ARRRes | null>(null);

  const run = async () => {
    setErr('');
    setLoading(true);
    try {
      const hasData = months.some((m) => m.beginning_arr !== 0 || m.ending_arr !== 0);
      const out = await postFpaJson<ARRRes>('/api/fpa/arr-dashboard', { months: hasData ? months : [] });
      setRes(out);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const wfChart = res
    ? [
        { name: 'Beginning', v: res.waterfall_avg_month.beginning },
        { name: 'New', v: res.waterfall_avg_month.new },
        { name: 'Expansion', v: res.waterfall_avg_month.expansion },
        { name: 'Contraction', v: -res.waterfall_avg_month.contraction },
        { name: 'Churn', v: -res.waterfall_avg_month.churn },
        { name: 'Ending', v: res.waterfall_avg_month.ending },
      ]
    : [];

  return (
    <FpaPageShell title="ARR / SaaS dashboard" subtitle="Trailing metrics · NRR · Rule of 40">
      <ErrorBanner message={err} />
      <div className="flex flex-wrap items-center gap-3">
        <CSVUploader
          label="Import monthly CSV"
          onRows={(rows) => {
            const next = blankMonths();
            rows.slice(0, 12).forEach((r, i) => {
              const num = (k: string) => Number(String(r[k] ?? '').replace(/,/g, '')) || 0;
              next[i] = {
                month: String(r.month || r.Month || `M${i + 1}`),
                beginning_arr: num('beginning_arr') || num('Beginning_ARR'),
                new_arr: num('new_arr') || num('New_ARR'),
                expansion: num('expansion') || num('Expansion'),
                contraction: num('contraction') || num('Contraction'),
                churn: num('churn') || num('Churn'),
                ending_arr: num('ending_arr') || num('Ending_ARR'),
                mrr: num('mrr') || num('MRR'),
              };
            });
            setMonths(next);
          }}
        />
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
        >
          <Play className="h-4 w-4" />
          Calculate
        </button>
        {loading ? <LoadingSpinner /> : null}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-700">
        <table className="min-w-[900px] text-left text-xs text-slate-200">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              {['month', 'beginning_arr', 'new_arr', 'expansion', 'contraction', 'churn', 'ending_arr', 'mrr'].map(
                (h) => (
                  <th key={h} className="px-2 py-2">
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {months.map((row, i) => (
              <tr key={i} className="border-t border-slate-800">
                {(Object.keys(row) as (keyof Month)[]).map((k) => (
                  <td key={k} className="p-1">
                    <input
                      className="w-full min-w-[72px] rounded border border-slate-700 bg-slate-950 px-1 py-1"
                      value={row[k] as string | number}
                      onChange={(e) => {
                        const v = k === 'month' ? e.target.value : Number(e.target.value) || 0;
                        setMonths((prev) => prev.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {res ? (
        <div className="mt-8 space-y-6">
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            {[
              ['ARR', res.arr_total],
              ['MRR', res.mrr],
              ['NRR %', res.nrr_pct],
              ['GRR %', res.grr_pct],
              ['Rule of 40', res.rule_of_40],
              ['CAC payback (mo)', res.cac_payback_months],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-xl border border-slate-700 bg-slate-900/60 p-3 text-sm">
                <div className="text-slate-400">{k}</div>
                <div className="mt-1 text-lg font-bold text-white">
                  {typeof v === 'number' && k !== 'NRR %' && k !== 'GRR %'
                    ? v.toLocaleString(undefined, { maximumFractionDigits: 0 })
                    : Number(v).toFixed(1)}
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-emerald-700/40 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-100">
            Your NRR: {res.nrr_pct.toFixed(0)}% — Benchmark: &gt;{res.benchmarks.nrr_target_pct}%{' '}
            {res.benchmarks.nrr_ok ? '✅' : '⚠️'} · Rule of 40: {res.rule_of_40.toFixed(1)}{' '}
            {res.benchmarks.rule40_ok ? '✅' : '⚠️'}
          </div>
          <div className="h-64 rounded-xl border border-slate-700 bg-slate-900/40 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={wfChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="v" fill="#818cf8" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
            <h3 className="font-semibold text-white">Commentary</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{res.commentary}</p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
            onClick={() =>
              exportRowsToExcel('arr-export.xlsx', [{ name: 'Summary', rows: [res as unknown as Record<string, unknown>] }])
            }
          >
            Export summary Excel
          </button>
        </div>
      ) : null}
    </FpaPageShell>
  );
}
