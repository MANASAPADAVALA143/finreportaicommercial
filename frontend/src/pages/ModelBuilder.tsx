import { useCallback, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Loader2, Lock, Table2 } from 'lucide-react';
import { backendOrigin } from '../utils/backendOrigin';

type StmtTab = 'pl' | 'bs' | 'cfs';

interface CheckYear {
  year: number;
  pass: boolean;
  [k: string]: unknown;
}

interface CheckBlock {
  id: string;
  name: string;
  years: CheckYear[];
}

interface StmtTable {
  labels: string[];
  rows: { line: string; values?: number[]; is_header?: boolean; is_bold?: boolean; is_percent?: boolean }[];
}

export default function ModelBuilder() {
  const base = backendOrigin();
  const [companyName, setCompanyName] = useState('Demo Co');
  const [entityId, setEntityId] = useState('demo_entity');
  const [currency, setCurrency] = useState('USD');
  const [baseYear, setBaseYear] = useState(2024);
  const [forecastYears, setForecastYears] = useState(3);
  const [revGrowth, setRevGrowth] = useState([0.12, 0.1, 0.08]);
  const [grossMargin, setGrossMargin] = useState([0.45, 0.46, 0.47]);
  const [ebitdaMargin, setEbitdaMargin] = useState([0.22, 0.23, 0.24]);
  const [daPct, setDaPct] = useState(0.04);
  const [taxRate, setTaxRate] = useState(0.25);
  const [capexPct, setCapexPct] = useState(0.05);
  const [interestRate, setInterestRate] = useState(0.08);
  const [divPayout, setDivPayout] = useState(0);
  const [arDays, setArDays] = useState(45);
  const [invDays, setInvDays] = useState(30);
  const [apDays, setApDays] = useState(40);
  const [debtRepay, setDebtRepay] = useState([500000, 500000, 500000]);
  const [plFile, setPlFile] = useState<File | null>(null);
  const [bsFile, setBsFile] = useState<File | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [checks, setChecks] = useState<CheckBlock[]>([]);
  const [allPass, setAllPass] = useState<boolean | null>(null);
  const [model, setModel] = useState<Record<string, unknown> | null>(null);
  const [scenarios, setScenarios] = useState<Record<string, Record<string, unknown>> | null>(null);
  const [stmtTab, setStmtTab] = useState<StmtTab>('pl');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approver, setApprover] = useState('');
  const [history, setHistory] = useState<unknown[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [revolverNotes, setRevolverNotes] = useState<string[]>([]);

  const assumptionsJson = useMemo(
    () =>
      JSON.stringify({
        revenue_growth: revGrowth.slice(0, forecastYears),
        gross_margin: grossMargin.slice(0, forecastYears),
        ebitda_margin: ebitdaMargin.slice(0, forecastYears),
        tax_rate: taxRate,
        capex_pct_revenue: capexPct,
        da_pct_revenue: daPct,
        nwc_days: { ar_days: arDays, inventory_days: invDays, ap_days: apDays },
        debt_repayment: debtRepay.slice(0, forecastYears),
        dividend_payout: divPayout,
        interest_rate: interestRate,
      }),
    [
      revGrowth,
      grossMargin,
      ebitdaMargin,
      taxRate,
      capexPct,
      daPct,
      arDays,
      invDays,
      apDays,
      debtRepay,
      divPayout,
      interestRate,
      forecastYears,
    ]
  );

  const fmt = (n: number, curr: string) => {
    if (curr === 'INR') return `₹${Math.round(n).toLocaleString('en-IN')}`;
    return `$${Math.round(n).toLocaleString()}`;
  };

  const loadHistory = useCallback(async () => {
    if (!base) return;
    const q = entityId ? `?entity_id=${encodeURIComponent(entityId)}` : '';
    const r = await fetch(`${base}/api/model/history${q}`);
    if (!r.ok) return;
    const j = await r.json();
    setHistory(j.items || []);
  }, [base, entityId]);

  const buildModel = async () => {
    setError(null);
    if (!base) {
      setError('Set VITE_API_URL (e.g. http://127.0.0.1:8000).');
      return;
    }
    if (!plFile || !bsFile) {
      setError('Historical P&L and Balance Sheet files are required.');
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('entity_id', entityId);
      fd.append('company_name', companyName);
      fd.append('currency', currency);
      fd.append('base_year', String(baseYear));
      fd.append('forecast_years', String(forecastYears));
      fd.append('assumptions_json', assumptionsJson);
      fd.append('historical_pl_file', plFile);
      fd.append('historical_bs_file', bsFile);
      const r = await fetch(`${base}/api/model/start`, { method: 'POST', body: fd });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setModelId(j.model_id);
      setStatus('started');
      const r2 = await fetch(`${base}/api/model/build/${j.model_id}`, { method: 'POST' });
      if (!r2.ok) throw new Error(await r2.text());
      const out = await r2.json();
      setStatus(out.status || 'complete');
      const ck = (out.checks as { checks?: CheckBlock[]; summary?: { all_pass?: boolean } }) || {};
      setChecks(ck.checks || []);
      setAllPass(ck.summary?.all_pass ?? null);
      setModel((out.model as Record<string, unknown>) || null);
      const meta = (out.model as { meta?: { revolver_messages?: string[] } })?.meta;
      setRevolverNotes(meta?.revolver_messages || []);
      const scen = out.scenarios as
        | { base?: Record<string, unknown>; upside?: Record<string, unknown>; downside?: Record<string, unknown> }
        | undefined;
      if (scen?.base && scen?.upside && scen?.downside) {
        setScenarios({ base: scen.base, upside: scen.upside, downside: scen.downside });
      } else {
        const [upRes, downRes] = await Promise.all([
          fetch(`${base}/api/model/output/${j.model_id}?scenario=upside&statement=all`),
          fetch(`${base}/api/model/output/${j.model_id}?scenario=downside&statement=all`),
        ]);
        const su = upRes.ok ? await upRes.json() : null;
        const sd = downRes.ok ? await downRes.json() : null;
        setScenarios({
          base: (out.model as Record<string, unknown>) || {},
          upside: (su?.payload as Record<string, unknown>) || {},
          downside: (sd?.payload as Record<string, unknown>) || {},
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const stmt = useMemo(() => {
    if (!model) return null;
    const st = model.statements as Record<string, StmtTable> | undefined;
    if (!st) return null;
    if (stmtTab === 'pl') return st.income_statement;
    if (stmtTab === 'bs') return st.balance_sheet;
    return st.cash_flow;
  }, [model, stmtTab]);

  const scenarioCards = useMemo(() => {
    const fy = (model?.meta as { forecast_year_list?: number[] })?.forecast_year_list || [];
    const y3 = fy[fy.length - 1];
    const pick = (m: Record<string, unknown> | undefined) => {
      const f = m?.forecast as {
        pl?: { revenue: number; ebitda: number; net_income: number }[];
        bs?: { cash: number; total_debt: number }[];
      };
      const pl = f?.pl || [];
      const bs = f?.bs || [];
      const last = pl.length - 1;
      const debt = last >= 0 ? Number(bs[last]?.total_debt ?? 0) : 0;
      const cash = last >= 0 ? Number(bs[last]?.cash ?? 0) : 0;
      return {
        y: y3,
        rev: last >= 0 ? pl[last]?.revenue : 0,
        ebitda: last >= 0 ? pl[last]?.ebitda : 0,
        ni: last >= 0 ? pl[last]?.net_income : 0,
        cash,
        debt,
        netDebt: debt - cash,
      };
    };
    return {
      base: pick(scenarios?.base),
      upside: pick(scenarios?.upside),
      downside: pick(scenarios?.downside),
    };
  }, [model, scenarios]);

  const downloadPdf = () => {
    if (!base || !modelId) return;
    window.open(`${base}/api/model/report/${modelId}/pdf`, '_blank');
  };

  const downloadExcel = () => {
    if (!base || !modelId) return;
    window.open(`${base}/api/model/export/${modelId}/excel`, '_blank');
  };

  const approve = async () => {
    if (!base || !modelId || !approver.trim()) return;
    await fetch(`${base}/api/model/approve/${modelId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approver: approver.trim() }),
    });
  };

  const fyLabels = (stmt?.labels || []) as string[];
  const histCount = ((model?.historical as { pl?: unknown[] })?.pl || []).length;
  const rePlugLast =
    ((model?.historical as { bs?: { opening_balance_plug_to_re?: number }[] })?.bs || []).slice(-1)[0]
      ?.opening_balance_plug_to_re ?? 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-600/20 text-blue-300">
              <Table2 className="w-7 h-7" aria-hidden />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Model Builder</h1>
              <p className="text-sm text-slate-400">FP&A 3-statement linked model from historical P&L + BS</p>
            </div>
          </div>
          {status && (
            <span className="text-xs uppercase tracking-wide text-slate-500">
              Status: <span className="text-slate-200">{status}</span>
            </span>
          )}
        </header>

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div>
        )}

        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 md:p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Assumptions</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <label className="block text-xs text-slate-400">
              Company
              <input
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </label>
            <label className="block text-xs text-slate-400">
              Base year
              <input
                type="number"
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                value={baseYear}
                onChange={(e) => setBaseYear(Number(e.target.value))}
              />
            </label>
            <label className="block text-xs text-slate-400">
              Forecast years (1–5)
              <input
                type="number"
                min={1}
                max={5}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                value={forecastYears}
                onChange={(e) => setForecastYears(Math.min(5, Math.max(1, Number(e.target.value) || 3)))}
              />
            </label>
            <label className="block text-xs text-slate-400">
              Currency
              <select
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option value="USD">USD</option>
                <option value="INR">INR</option>
                <option value="EUR">EUR</option>
              </select>
            </label>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded border border-slate-800 p-3 space-y-2">
                <p className="text-xs text-slate-500">Forecast year {i + 1}</p>
                <label className="block text-xs text-slate-400">
                  Revenue growth
                  <input
                    type="number"
                    step="0.01"
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                    value={revGrowth[i] ?? 0}
                    onChange={(e) => {
                      const v = [...revGrowth];
                      v[i] = Number(e.target.value);
                      setRevGrowth(v);
                    }}
                  />
                </label>
                <label className="block text-xs text-slate-400">
                  Gross margin %
                  <input
                    type="number"
                    step="0.01"
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                    value={grossMargin[i] ?? 0}
                    onChange={(e) => {
                      const v = [...grossMargin];
                      v[i] = Number(e.target.value);
                      setGrossMargin(v);
                    }}
                  />
                </label>
                <label className="block text-xs text-slate-400">
                  EBITDA margin %
                  <input
                    type="number"
                    step="0.01"
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                    value={ebitdaMargin[i] ?? 0}
                    onChange={(e) => {
                      const v = [...ebitdaMargin];
                      v[i] = Number(e.target.value);
                      setEbitdaMargin(v);
                    }}
                  />
                </label>
              </div>
            ))}
          </div>

          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3">
            <label className="text-xs text-slate-400">
              D&A % revenue
              <input type="number" step="0.01" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" value={daPct} onChange={(e) => setDaPct(Number(e.target.value))} />
            </label>
            <label className="text-xs text-slate-400">
              Tax rate
              <input type="number" step="0.01" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))} />
            </label>
            <label className="text-xs text-slate-400">
              Capex % revenue
              <input type="number" step="0.01" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" value={capexPct} onChange={(e) => setCapexPct(Number(e.target.value))} />
            </label>
            <label className="text-xs text-slate-400">
              Interest rate
              <input type="number" step="0.01" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" value={interestRate} onChange={(e) => setInterestRate(Number(e.target.value))} />
            </label>
            <label className="text-xs text-slate-400">
              Dividend payout %
              <input type="number" step="0.01" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" value={divPayout} onChange={(e) => setDivPayout(Number(e.target.value))} />
            </label>
            <label className="text-xs text-slate-400">
              AR days
              <input type="number" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" value={arDays} onChange={(e) => setArDays(Number(e.target.value))} />
            </label>
            <label className="text-xs text-slate-400">
              Inventory days
              <input type="number" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" value={invDays} onChange={(e) => setInvDays(Number(e.target.value))} />
            </label>
            <label className="text-xs text-slate-400">
              AP days
              <input type="number" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" value={apDays} onChange={(e) => setApDays(Number(e.target.value))} />
            </label>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <label key={i} className="text-xs text-slate-400">
                Debt repayment Y{i + 1}
                <input
                  type="number"
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                  value={debtRepay[i] ?? 0}
                  onChange={(e) => {
                    const v = [...debtRepay];
                    v[i] = Number(e.target.value);
                    setDebtRepay(v);
                  }}
                />
              </label>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <label className="block rounded border border-dashed border-slate-600 p-4 text-sm">
              <span className="text-slate-300 font-medium">Historical P&L (CSV/XLSX)</span>
              <input type="file" accept=".csv,.xlsx,.xls" className="mt-2 block w-full text-xs text-slate-400" onChange={(e) => setPlFile(e.target.files?.[0] || null)} />
            </label>
            <label className="block rounded border border-dashed border-slate-600 p-4 text-sm">
              <span className="text-slate-300 font-medium">Historical balance sheet</span>
              <input type="file" accept=".csv,.xlsx,.xls" className="mt-2 block w-full text-xs text-slate-400" onChange={(e) => setBsFile(e.target.files?.[0] || null)} />
            </label>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => void buildModel()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Build model
          </button>
        </section>

        {model && Math.abs(Number(rePlugLast)) > 1 && (
          <div className="rounded-lg border border-slate-600 bg-slate-900/80 px-4 py-3 text-sm text-slate-300">
            <strong className="text-slate-200">Opening balance sheet plug:</strong> Retained earnings adjusted by{' '}
            {fmt(Number(rePlugLast), currency)} on the latest historical year so Assets = Liabilities + Equity before
            the forecast roll-forward. Replace with full BS lines if you need reported RE unchanged.
          </div>
        )}

        {revolverNotes.length > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
            {revolverNotes.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </div>
        )}

        {checks.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Model integrity</h2>
            {allPass && (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 px-4 py-3 text-center text-emerald-100 font-medium">
                ✅ All checks passing — model is balanced
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              {checks.map((c) => (
                <div key={c.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                  <p className="text-sm font-medium text-white mb-2">{c.name}</p>
                  <ul className="text-xs text-slate-400 space-y-1">
                    {c.years.map((y) => (
                      <li key={y.year} className={y.pass ? 'text-emerald-400' : 'text-red-400'}>
                        FY{y.year}: {y.pass ? 'Pass' : 'Fail'}
                        {' — '}
                        <span className="text-slate-500 font-mono break-all">
                          {Object.entries(y)
                            .filter(([k]) => !['year', 'pass'].includes(k))
                            .slice(0, 4)
                            .map(([k, v]) => `${k}=${String(v)}`)
                            .join(', ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        {stmt && (
          <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 md:p-6">
            <div className="flex flex-wrap gap-2 mb-4">
              {(['pl', 'bs', 'cfs'] as StmtTab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setStmtTab(t)}
                  className={`rounded-lg px-3 py-1.5 text-sm ${stmtTab === t ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'}`}
                >
                  {t === 'pl' ? 'Income statement' : t === 'bs' ? 'Balance sheet' : 'Cash flow'}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto rounded border border-slate-800">
              <table className="min-w-full text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-slate-900 px-2 py-2 text-left text-slate-400 border-b border-slate-800">Line</th>
                    {fyLabels.map((lab, j) => (
                      <th
                        key={lab}
                        className={`px-2 py-2 text-right border-b border-slate-800 whitespace-nowrap ${j < histCount ? 'bg-slate-700 text-slate-200' : 'bg-blue-950 text-blue-100'}`}
                      >
                        {lab}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stmt.rows.map((row) =>
                    row.is_header ? (
                      <tr key={row.line}>
                        <td colSpan={fyLabels.length + 1} className="bg-slate-800/80 px-2 py-1.5 font-semibold text-slate-200">
                          {row.line}
                        </td>
                      </tr>
                    ) : (
                      <tr key={row.line} className="border-b border-slate-800/80">
                        <td
                          className={`sticky left-0 z-10 bg-slate-950 px-2 py-1.5 text-slate-300 border-r border-slate-800 ${row.is_bold ? 'font-bold' : ''} ${row.is_percent ? 'italic' : ''}`}
                        >
                          {row.line}
                        </td>
                        {(row.values || []).map((v, j) => {
                          const line = String(row.line);
                          const negCf =
                            stmtTab === 'cfs' &&
                            typeof v === 'number' &&
                            v < 0 &&
                            (line.includes('Net change') || line.includes('Cash from'));
                          return (
                            <td
                              key={j}
                              className={`px-2 py-1.5 text-right tabular-nums ${j < histCount ? 'bg-slate-800/50' : ''} ${negCf ? 'text-red-400' : 'text-slate-200'}`}
                            >
                              {row.is_percent ? `${(100 * Number(v)).toFixed(1)}%` : fmt(Number(v), currency)}
                            </td>
                          );
                        })}
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {scenarios && model && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Scenarios (final year)</h2>
            <div className="grid md:grid-cols-3 gap-4">
              {(['base', 'upside', 'downside'] as const).map((k) => {
                const d = scenarioCards[k];
                const border = k === 'base' ? 'border-blue-500/40' : k === 'upside' ? 'border-emerald-500/40' : 'border-red-500/40';
                return (
                  <div key={k} className={`rounded-xl border ${border} bg-slate-900/60 p-4`}>
                    <p className="text-sm font-semibold capitalize text-white mb-2">{k}</p>
                    <dl className="space-y-1 text-xs text-slate-400">
                      <div className="flex justify-between">
                        <dt>Revenue {d.y}</dt>
                        <dd className="text-slate-200">{fmt(d.rev, currency)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>EBITDA</dt>
                        <dd className="text-slate-200">{fmt(d.ebitda, currency)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>Net income</dt>
                        <dd className="text-slate-200">{fmt(d.ni, currency)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>Cash</dt>
                        <dd className="text-slate-200">{fmt(d.cash, currency)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>Total debt</dt>
                        <dd className="text-slate-200">{fmt(d.debt, currency)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>Net debt</dt>
                        <dd className="text-slate-200">{fmt(d.netDebt, currency)}</dd>
                      </div>
                    </dl>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="flex flex-wrap gap-3 items-center">
          <button
            type="button"
            disabled={!modelId || status !== 'complete'}
            onClick={downloadPdf}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          >
            <Download className="w-4 h-4" />
            PDF report
          </button>
          <button
            type="button"
            disabled={!modelId || status !== 'complete'}
            onClick={downloadExcel}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Export Excel
          </button>
          <div className="flex items-center gap-2">
            <input
              placeholder="Approver name"
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm w-40"
              value={approver}
              onChange={(e) => setApprover(e.target.value)}
            />
            <button
              type="button"
              disabled={!modelId}
              onClick={() => void approve()}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100 hover:bg-slate-700"
            >
              <Lock className="w-4 h-4" />
              Approve &amp; lock model
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
            <input type="checkbox" checked={showHistory} onChange={(e) => { setShowHistory(e.target.checked); if (e.target.checked) void loadHistory(); }} />
            History
          </label>
        </section>

        {showHistory && (
          <div className="rounded-lg border border-slate-800 p-4 text-sm text-slate-400">
            <pre className="whitespace-pre-wrap text-xs overflow-x-auto">{JSON.stringify(history, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
