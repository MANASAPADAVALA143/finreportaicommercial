import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Play } from 'lucide-react';
import { FpaPageShell } from '../../components/fpa/FpaPageShell';
import { LoadingSpinner } from '../../components/fpa/LoadingSpinner';
import { ErrorBanner } from '../../components/fpa/ErrorBanner';
import { postFpaJson } from '../../lib/fpaApi';

type Dept = {
  department: string;
  current_hc: number;
  budget_hc: number;
  avg_salary: number;
  open_roles: number;
};

type Hire = { month: string; department: string; headcount: number };

type HCRes = {
  total_hc: number;
  budget_hc: number;
  hc_variance: number;
  revenue_per_employee: number;
  salary_pct_of_revenue: number;
  monthly_salary_burn: number;
  projected_year_end_payroll: number;
  by_department: { department: string; current_hc: number; budget_hc: number; variance: number; flag: string }[];
  commentary: string;
};

const defaultDepts: Dept[] = [
  { department: 'Engineering', current_hc: 42, budget_hc: 48, avg_salary: 115000, open_roles: 4 },
  { department: 'Sales', current_hc: 28, budget_hc: 32, avg_salary: 95000, open_roles: 2 },
];

export default function HeadcountPlanning() {
  const [depts, setDepts] = useState<Dept[]>(defaultDepts);
  const [revenue, setRevenue] = useState(45_000_000);
  const [target, setTarget] = useState(52_000_000);
  const [plan, setPlan] = useState<Hire[]>([{ month: 'Jan', department: 'Engineering', headcount: 2 }]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<HCRes | null>(null);

  const run = async () => {
    setErr('');
    setLoading(true);
    try {
      const out = await postFpaJson<HCRes>('/api/fpa/headcount', {
        departments: depts,
        total_revenue: revenue,
        revenue_target: target,
        hiring_plan: plan,
      });
      setRes(out);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const chart =
    res?.by_department.map((d) => ({
      name: d.department,
      current: d.current_hc,
      budget: d.budget_hc,
    })) ?? [];

  return (
    <FpaPageShell title="Headcount planning" subtitle="Efficiency · burn · variance vs budget">
      <ErrorBanner message={err} />
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm text-slate-300">
          Total revenue (£)
          <input
            type="number"
            className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1"
            value={revenue}
            onChange={(e) => setRevenue(Number(e.target.value))}
          />
        </label>
        <label className="text-sm text-slate-300">
          Revenue target (£)
          <input
            type="number"
            className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1"
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-700">
        <table className="min-w-[720px] text-left text-xs text-slate-200">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              {['department', 'current_hc', 'budget_hc', 'avg_salary', 'open_roles'].map((h) => (
                <th key={h} className="px-2 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {depts.map((row, i) => (
              <tr key={i} className="border-t border-slate-800">
                {(Object.keys(row) as (keyof Dept)[]).map((k) => (
                  <td key={k} className="p-1">
                    <input
                      className="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1"
                      value={row[k] as string | number}
                      onChange={(e) => {
                        const v = k === 'department' ? e.target.value : Number(e.target.value) || 0;
                        setDepts((prev) => prev.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          className="m-2 text-sm text-sky-400 hover:underline"
          onClick={() => setDepts((d) => [...d, { department: 'New', current_hc: 0, budget_hc: 0, avg_salary: 0, open_roles: 0 }])}
        >
          + Department
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/40 p-3">
        <div className="text-sm font-semibold text-white">Hiring plan (sample)</div>
        {plan.map((h, i) => (
          <div key={i} className="mt-2 flex flex-wrap gap-2 text-xs">
            <input
              className="rounded border border-slate-600 bg-slate-950 px-2 py-1"
              value={h.month}
              onChange={(e) => setPlan((p) => p.map((x, j) => (j === i ? { ...x, month: e.target.value } : x)))}
            />
            <input
              className="rounded border border-slate-600 bg-slate-950 px-2 py-1"
              value={h.department}
              onChange={(e) => setPlan((p) => p.map((x, j) => (j === i ? { ...x, department: e.target.value } : x)))}
            />
            <input
              type="number"
              className="w-20 rounded border border-slate-600 bg-slate-950 px-2 py-1"
              value={h.headcount}
              onChange={(e) =>
                setPlan((p) => p.map((x, j) => (j === i ? { ...x, headcount: Number(e.target.value) } : x)))
              }
            />
          </div>
        ))}
        <button
          type="button"
          className="mt-2 text-sm text-sky-400 hover:underline"
          onClick={() => setPlan((p) => [...p, { month: 'Feb', department: 'Sales', headcount: 1 }])}
        >
          + Hire row
        </button>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
        >
          <Play className="h-4 w-4" />
          Analyse
        </button>
        {loading ? <LoadingSpinner /> : null}
      </div>

      {res ? (
        <div className="mt-8 space-y-6">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {[
              ['Total HC', res.total_hc],
              ['HC vs budget', res.hc_variance],
              ['Rev / FTE', res.revenue_per_employee],
              ['Salary % rev', res.salary_pct_of_revenue],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-xl border border-slate-700 bg-slate-900/60 p-3 text-sm">
                <div className="text-slate-400">{k}</div>
                <div className="mt-1 text-lg font-bold text-white">
                  {typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v}
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-2">
            <div className="mb-2 text-sm text-slate-400">HC by department</div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="current" fill="#38bdf8" name="Current" />
                  <Bar dataKey="budget" fill="#a78bfa" name="Budget" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4 text-sm text-slate-300">
            <div className="font-semibold text-white">Burn</div>
            <p>Monthly salary burn: £{res.monthly_salary_burn.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
            <p>Projected year-end payroll: £{res.projected_year_end_payroll.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
            <h3 className="font-semibold text-white">Commentary</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm">{res.commentary}</p>
          </div>
        </div>
      ) : null}
    </FpaPageShell>
  );
}
