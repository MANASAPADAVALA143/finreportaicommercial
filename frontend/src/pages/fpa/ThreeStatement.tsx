import { useState } from 'react';
import { Download, Play } from 'lucide-react';
import { FpaPageShell } from '../../components/fpa/FpaPageShell';
import { LoadingSpinner } from '../../components/fpa/LoadingSpinner';
import { ErrorBanner } from '../../components/fpa/ErrorBanner';
import { postFpaJson } from '../../lib/fpaApi';

type Row = Record<string, number>;

type TSResponse = {
  pl_data: Row[];
  bs_data: Row[];
  cf_data: Row[];
  excel_base64: string;
  commentary: string;
  flags: string[];
};

export default function ThreeStatement() {
  const [tab, setTab] = useState<'pl' | 'bs' | 'cf'>('pl');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<TSResponse | null>(null);
  const [form, setForm] = useState({
    company_name: 'Demo Co',
    industry: 'Software',
    projection_years: 5 as 3 | 5 | 10,
    revenue_base: 10_000_000,
    revenue_growth_pct: 0.12,
    gross_margin_pct: 0.72,
    ebitda_margin_pct: 0.25,
    net_margin_pct: 0.15,
    starting_cash: 3_000_000,
    total_debt: 5_000_000,
    capex_pct_revenue: 0.05,
    dso_days: 45,
    dpo_days: 30,
    dio_days: 20,
    scenario: 'base' as 'base' | 'bull' | 'bear',
  });

  const run = async () => {
    setErr('');
    setLoading(true);
    try {
      const out = await postFpaJson<TSResponse>('/api/fpa/three-statement', form);
      setRes(out);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const rows = res ? (tab === 'pl' ? res.pl_data : tab === 'bs' ? res.bs_data : res.cf_data) : [];
  const keys = rows[0] ? Object.keys(rows[0]) : [];

  const downloadXlsx = () => {
    if (!res?.excel_base64) return;
    const bin = atob(res.excel_base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'three_statement_model.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <FpaPageShell title="3-Statement Model" subtitle="P&amp;L · Balance sheet · Cash flow (simplified engine)">
      <div className="space-y-4">
        <ErrorBanner message={err} />
        <div className="grid gap-3 rounded-xl border border-slate-700 bg-slate-900/50 p-4 md:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ['company_name', 'Company'],
              ['industry', 'Industry'],
              ['revenue_base', 'Base revenue (£)'],
              ['revenue_growth_pct', 'Growth rate (decimal)'],
              ['gross_margin_pct', 'Gross margin % (decimal)'],
              ['ebitda_margin_pct', 'EBITDA margin % (decimal)'],
              ['starting_cash', 'Starting cash'],
              ['total_debt', 'Debt'],
              ['capex_pct_revenue', 'CapEx % of revenue (decimal)'],
              ['dso_days', 'DSO days'],
              ['dpo_days', 'DPO days'],
              ['dio_days', 'DIO days'],
            ] as const
          ).map(([k, lab]) => (
            <label key={k} className="text-xs text-slate-300">
              {lab}
              <input
                className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm"
                value={String((form as any)[k])}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    [k]:
                      k === 'company_name' || k === 'industry'
                        ? e.target.value
                        : Number(e.target.value),
                  }))
                }
              />
            </label>
          ))}
          <label className="text-xs text-slate-300">
            Projection years
            <select
              className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm"
              value={form.projection_years}
              onChange={(e) =>
                setForm((f) => ({ ...f, projection_years: Number(e.target.value) as 3 | 5 | 10 }))
              }
            >
              {[3, 5, 10].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-300">
            Scenario
            <select
              className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm"
              value={form.scenario}
              onChange={(e) =>
                setForm((f) => ({ ...f, scenario: e.target.value as 'base' | 'bull' | 'bear' }))
              }
            >
              <option value="base">Base</option>
              <option value="bull">Bull</option>
              <option value="bear">Bear</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={run}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            Build model
          </button>
          {loading ? <LoadingSpinner label="Building statements…" /> : null}
          {res ? (
            <button
              type="button"
              onClick={downloadXlsx}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-100 hover:bg-slate-800"
            >
              <Download className="h-4 w-4" />
              Download Excel
            </button>
          ) : null}
        </div>

        {res ? (
          <>
            <div className="flex gap-2 border-b border-slate-700 pb-2">
              {(['pl', 'bs', 'cf'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`rounded-lg px-3 py-1 text-sm font-medium ${
                    tab === t ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {t === 'pl' ? 'P&L' : t === 'bs' ? 'Balance sheet' : 'Cash flow'}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-700">
              <table className="min-w-full text-left text-xs text-slate-200">
                <thead className="bg-slate-900 text-slate-400">
                  <tr>
                    {keys.map((k) => (
                      <th key={k} className="px-2 py-2 font-medium">
                        {k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t border-slate-800">
                      {keys.map((k) => (
                        <td key={k} className="px-2 py-1">
                          {typeof r[k] === 'number' ? (r[k] as number).toLocaleString(undefined, { maximumFractionDigits: 0 }) : r[k]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {res.flags?.length ? (
              <div className="rounded-lg border border-amber-600/40 bg-amber-950/30 p-3 text-sm text-amber-100">
                <strong>Flags:</strong> {res.flags.join(' ')}
              </div>
            ) : null}
            <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
              <h3 className="mb-2 font-semibold text-white">AI review</h3>
              <p className="whitespace-pre-wrap text-sm text-slate-300">{res.commentary}</p>
            </div>
          </>
        ) : null}
      </div>
    </FpaPageShell>
  );
}
