import { useCallback, useEffect, useState } from 'react';
import { Download, Info, TrendingUp } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import * as con from '../../services/consolidation.service';
import type { CompanyComparison, ConsolidationRow, SummaryCard } from '../../services/consolidation.service';

function fmt(n: number) { return con.fmtAed(n); }

const SEG_COLORS = ['#3b82f6', '#14b8a6', '#a855f7', '#f59e0b', '#ec4899'];

function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(0, 2).join(' ') : name.slice(0, 14);
}

function BreakdownBar({ card }: { card: SummaryCard }) {
  const items = (card.breakdown ?? []).filter(b => Math.abs(b.amount) > 0);
  if (items.length < 2) return null;
  const total = items.reduce((s, b) => s + Math.abs(b.amount), 0) || 1;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex h-2 rounded-full overflow-hidden bg-gray-800">
        {items.map((b, i) => (
          <div
            key={b.company_id}
            style={{
              width: `${(Math.abs(b.amount) / total) * 100}%`,
              background: SEG_COLORS[i % SEG_COLORS.length],
            }}
            title={`${b.company_name}: ${fmt(b.amount)}`}
          />
        ))}
      </div>
      <div className="space-y-0.5">
        {items.map((b, i) => (
          <div key={b.company_id} className="flex justify-between text-[10px] text-gray-500">
            <span className="flex items-center gap-1 truncate">
              <span
                className="inline-block w-2 h-2 rounded-sm shrink-0"
                style={{ background: SEG_COLORS[i % SEG_COLORS.length] }}
              />
              {shortName(b.company_name)}
            </span>
            <span className="text-gray-400 shrink-0 ml-1">{fmt(b.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Table({ rows, companies, onSave, showNotes = false }: {
  rows: ConsolidationRow[];
  companies: { id: string; company_name: string }[];
  onSave: (key: string, amt: number) => void;
  showNotes?: boolean;
}) {
  const [edit, setEdit] = useState<string | null>(null);
  const [val, setVal] = useState('');
  return (
    <div className="overflow-x-auto border border-gray-700 rounded-xl">
      <table className="w-full text-xs min-w-[640px]">
        <thead><tr className="bg-gray-800 text-gray-300">
          <th className="text-left px-3 py-2">Account</th>
          {companies.map(c => <th key={c.id} className="text-right px-3 py-2">{c.company_name}</th>)}
          <th className="text-right px-3 py-2">Eliminations</th>
          <th className="text-right px-3 py-2">Group Total</th>
        </tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} className={`border-t border-gray-800 ${r.calculated ? 'bg-gray-800/40 font-semibold' : ''}`}>
              <td className="px-3 py-2">{r.label}</td>
              {companies.map(c => (
                <td key={c.id} className="px-3 py-2 text-right" style={{ color: (r.companies[c.id] ?? 0) < 0 ? '#f87171' : undefined }}>
                  {fmt(r.companies[c.id] ?? 0)}
                </td>
              ))}
              <td className="px-3 py-2 text-right">
                <span className="inline-flex items-center justify-end gap-1">
                  {edit === r.key ? (
                    <input type="number" className="w-20 bg-gray-900 border border-teal-600 rounded px-1 text-right"
                      value={val} autoFocus onChange={e => setVal(e.target.value)}
                      onBlur={() => { onSave(r.key, Number(val) || 0); setEdit(null); }} />
                  ) : (
                    <button type="button" className="hover:text-teal-400" onClick={() => { setEdit(r.key); setVal(String(r.eliminations)); }}>
                      {fmt(r.eliminations)}
                    </button>
                  )}
                  {showNotes && r.elimination_note && (
                    <span className="relative group cursor-help text-teal-500/80">
                      <Info className="w-3.5 h-3.5" />
                      <span className="pointer-events-none absolute bottom-full right-0 mb-1 hidden group-hover:block z-20 w-48 rounded bg-gray-800 border border-gray-600 px-2 py-1 text-[10px] text-gray-200 text-left shadow-lg">
                        {r.elimination_note}
                      </span>
                    </span>
                  )}
                </span>
              </td>
              <td className="px-3 py-2 text-right">{fmt(r.group_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ConsolidationPage() {
  const { accessToken } = useAuth();
  const { companiesList } = useCompany();
  const [periods, setPeriods] = useState<con.AccountingPeriod[]>([]);
  const [periodId, setPeriodId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<SummaryCard[]>([]);
  const [pl, setPl] = useState<Awaited<ReturnType<typeof con.getPL>> | null>(null);
  const [bs, setBs] = useState<Awaited<ReturnType<typeof con.getBS>> | null>(null);
  const [comparison, setComparison] = useState<CompanyComparison[]>([]);

  useEffect(() => {
    con.listConsolidationPeriods(accessToken).then(r => {
      setPeriods(r.periods);
      if (r.periods.length) setPeriodId(p => p || r.periods[r.periods.length - 1].id);
    }).catch(e => setError(String(e)));
  }, [accessToken]);

  const load = useCallback(async () => {
    if (!periodId) return;
    setLoading(true);
    try {
      const [s, p, b, c] = await Promise.all([
        con.getSummary(accessToken, periodId),
        con.getPL(accessToken, periodId),
        con.getBS(accessToken, periodId),
        con.getComparison(accessToken, periodId),
      ]);
      setSummary(s.cards); setPl(p); setBs(b); setComparison(c.companies);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [accessToken, periodId]);

  useEffect(() => { void load(); }, [load]);

  if (companiesList.length < 2) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col items-center justify-center py-16 px-6 text-center">
        <TrendingUp className="w-12 h-12 text-gray-500 mb-4" />
        <h1 className="text-2xl font-bold mb-2">Group Consolidation</h1>
        <p className="text-gray-400 mb-6 max-w-md">Add a second company to see group consolidated view</p>
        <a href="/company-setup" className="inline-flex items-center gap-2 bg-teal-700 hover:bg-teal-600 px-4 py-2 rounded-lg text-sm text-white">
          Add Company
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-5 flex flex-wrap justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><TrendingUp className="text-teal-400" /> Group Consolidation</h1>
          <p className="text-sm text-gray-400">Consolidated view across {companiesList.length} companies</p>
        </div>
        <div className="flex gap-2">
          <select value={periodId} onChange={e => setPeriodId(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            {periods.map(p => <option key={p.id} value={p.id}>{p.period_name} ({p.status})</option>)}
          </select>
          <button type="button" disabled={!periodId} onClick={() => con.exportConsolidationPdf(accessToken, periodId).then(b => {
            const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'group-report.pdf'; a.click();
          })} className="flex items-center gap-1 px-3 py-2 bg-teal-600 rounded-lg text-sm"><Download className="w-4 h-4" /> Export PDF</button>
        </div>
      </div>
      <div className="p-6 space-y-8">
        {error && <div className="text-red-400 text-sm">{error}</div>}
        {loading ? <p className="text-gray-400">Loading…</p> : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {summary.map(c => (
                <div key={c.key} className="bg-gray-900 border border-gray-700 rounded-xl p-4">
                  <p className="text-xs text-gray-400">{c.label}</p>
                  <p className="text-lg font-bold text-teal-400">{fmt(c.total)}</p>
                  <BreakdownBar card={c} />
                </div>
              ))}
            </div>
            {pl && <section><h2 className="text-sm font-semibold text-gray-400 mb-2 uppercase">Consolidated P&amp;L</h2>
              <Table rows={pl.rows} companies={pl.companies} showNotes
                onSave={(k, a) => con.saveElimination(accessToken, { period_id: periodId, account_category: k, amount: a }).then(load)} /></section>}
            {bs && <section><h2 className="text-sm font-semibold text-gray-400 mb-2 uppercase">Consolidated Balance Sheet</h2>
              <Table rows={bs.rows} companies={bs.companies}
                onSave={(k, a) => con.saveElimination(accessToken, { period_id: periodId, account_category: k, amount: a }).then(load)} />
              <p className={`mt-2 text-sm px-3 py-2 rounded-lg ${bs.is_balanced ? 'bg-green-900/30 text-green-300' : 'bg-amber-900/30 text-amber-200'}`}>
                {bs.is_balanced ? 'Balance sheet balanced ✓' : 'Balance sheet does not balance — check eliminations or opening balances'}
              </p></section>}
            <section><h2 className="text-sm font-semibold text-gray-400 mb-2 uppercase">Company Comparison</h2>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                {comparison.map(c => (
                  <div key={c.company_id} className="bg-gray-900 border border-gray-700 rounded-xl p-4">
                    <div className="flex justify-between mb-2"><span className="font-semibold">{c.company_name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${c.status_ok ? 'bg-green-900/40 text-green-400' : 'bg-amber-900/40 text-amber-400'}`}>{c.status}</span></div>
                    <div className="text-xs space-y-1"><div className="flex justify-between"><span className="text-gray-400">Revenue</span>{fmt(c.revenue)}</div>
                      <div className="flex justify-between"><span className="text-gray-400">Net Profit</span>{fmt(c.net_profit)}</div>
                      <div className="flex justify-between"><span className="text-gray-400">Assets</span>{fmt(c.total_assets)}</div></div>
                  </div>
                ))}</div></section>
          </>
        )}
      </div>
    </div>
  );
}
