import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, PieChart, Trash2, Upload } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { aiCloseApi, type Holding, type HoldingInput, type ImportResult, type ValuationInput } from '../../services/aiClose.service';
import { ErrorBanner, errorText } from '../internal-audit/shared';
import { Card, GOLD, NAVY, money } from './parts';

const HOLDING_COLUMNS = ['code', 'name', 'asset_class', 'ifrs9_category', 'issuer', 'currency', 'cost', 'acquired_on', 'maturity_date'];
const VALUATION_COLUMNS = ['code', 'as_of', 'market_value', 'local_value', 'income'];
const HOLDING_SAMPLE = 'code,name,asset_class,ifrs9_category,issuer,currency,cost,acquired_on,maturity_date\n'
  + 'ENBD,Emirates NBD shares,equity,fvtpl,Emirates NBD,AED,380000,2026-04-05,\n'
  + 'UAESK29,UAE Government Sukuk 2029,sukuk,amortised_cost,UAE Federal Government,AED,250000,2026-04-05,2029-09-30\n';
const VALUATION_SAMPLE = 'code,as_of,market_value,local_value,income\nENBD,2026-10-31,420000,,\nUAESK29,2026-10-31,248500,,1040\n';
const NUMERIC = new Set(['cost', 'quantity', 'coupon_rate', 'market_value', 'local_value', 'price', 'income']);

/** Minimal CSV reader: header row, comma separated, double quotes for values containing commas. */
function parseCsv(text: string, required: string[]): Record<string, string | number | null>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const split = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = !quoted;
      } else if (ch === ',' && !quoted) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map((v) => v.trim());
  };
  const header = split(lines[0]).map((h) => h.toLowerCase());
  const missing = required.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`Missing column(s): ${missing.join(', ')}`);
  return lines.slice(1).map((line) => {
    const cells = split(line);
    return Object.fromEntries(header.map((h, i) => {
      const v = cells[i] ?? '';
      if (v === '') return [h, null];
      return [h, NUMERIC.has(h) ? Number(v.replace(/,/g, '')) : v];
    }));
  });
}

function sample(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function InvestmentsPage() {
  const { activeCompanyId, activeCompany } = useCompany();
  const companyId = activeCompanyId ?? '';
  const currency = activeCompany?.base_currency || 'AED';
  const [rows, setRows] = useState<Holding[]>([]);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<{ holdings?: File; valuations?: File }>({});

  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      setRows(await aiCloseApi.holdings(companyId));
    } catch (e) {
      setError(errorText(e, 'Could not load the portfolio'));
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  const upload = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const holdings = files.holdings ? parseCsv(await files.holdings.text(), ['code', 'name', 'asset_class', 'cost']) : [];
      const valuations = files.valuations ? parseCsv(await files.valuations.text(), ['code', 'as_of', 'market_value']) : [];
      setResult(await aiCloseApi.importPortfolio(companyId, {
        holdings: holdings as unknown as HoldingInput[], valuations: valuations as unknown as ValuationInput[],
      }));
      setFiles({});
      await load();
    } catch (e) {
      setError(errorText(e, 'Import failed'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (h: Holding) => {
    if (!window.confirm(`Delete ${h.name} and its valuations?`)) return;
    try {
      await aiCloseApi.deleteHolding(companyId, h.id);
      await load();
    } catch (e) {
      setError(errorText(e, 'Could not delete the holding'));
    }
  };

  if (!companyId) return <div className="p-6 text-sm text-slate-500">Select a company in the top banner.</div>;
  const total = rows.reduce((s, h) => s + (h.latest_value ?? 0), 0);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-5" style={{ background: NAVY }}>
        <div className="flex items-center gap-3">
          <PieChart className="h-5 w-5" style={{ color: GOLD }} />
          <div>
            <h1 className="text-lg font-semibold text-white">Investment portfolio</h1>
            <p className="text-xs text-slate-300">{activeCompany?.company_name} · holdings and month-end valuations used by the Investment Agent</p>
          </div>
        </div>
        <Link to="/ai-cfo/workforce" className="rounded-md border border-white/20 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10">AI Finance Workforce</Link>
      </div>
      <div className="space-y-4 p-6">
        <ErrorBanner message={error} />
        <Card title="Import holdings and valuations (CSV)">
          <div className="space-y-3 text-sm">
            <p className="text-xs text-slate-600">
              Holdings are matched by <b>code</b> and updated in place; valuations are matched by code and date. Market values are in {currency}.
              IFRS 9 category: <code>fvtpl</code> (fair value to profit or loss), <code>fvoci</code> (to the fair value reserve) or <code>amortised_cost</code>.
            </p>
            <div className="flex flex-wrap gap-4">
              <label className="text-xs text-slate-600">Holdings file
                <input type="file" accept=".csv,text/csv" onChange={(e) => setFiles((f) => ({ ...f, holdings: e.target.files?.[0] }))} className="mt-1 block text-xs" />
                <button type="button" onClick={() => sample('holdings-template.csv', HOLDING_SAMPLE)} className="mt-1 flex items-center gap-1 text-[11px] underline"><Download className="h-3 w-3" /> Template ({HOLDING_COLUMNS.length} columns)</button>
              </label>
              <label className="text-xs text-slate-600">Valuations file
                <input type="file" accept=".csv,text/csv" onChange={(e) => setFiles((f) => ({ ...f, valuations: e.target.files?.[0] }))} className="mt-1 block text-xs" />
                <button type="button" onClick={() => sample('valuations-template.csv', VALUATION_SAMPLE)} className="mt-1 flex items-center gap-1 text-[11px] underline"><Download className="h-3 w-3" /> Template ({VALUATION_COLUMNS.length} columns)</button>
              </label>
              <button onClick={() => void upload()} disabled={busy || (!files.holdings && !files.valuations)}
                className="ml-auto flex items-center gap-1.5 self-end rounded-md px-4 py-1.5 text-sm font-semibold text-slate-900 disabled:opacity-50" style={{ background: GOLD }}>
                <Upload className="h-4 w-4" /> {busy ? 'Importing…' : 'Import'}
              </button>
            </div>
            {result && (
              <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
                {result.holdings_created} holding(s) added, {result.holdings_updated} updated, {result.valuations_saved} valuation(s) saved.
                {result.errors.length > 0 && <ul className="mt-1 list-disc pl-4 text-red-700">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
              </div>
            )}
          </div>
        </Card>
        <Card title={`Holdings (${rows.length}) · latest value ${money(total, currency)}`}>
          {rows.length === 0 ? <p className="text-sm text-slate-500">No holdings yet. Import a holdings file to start.</p> : (
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr><th className="py-1">Code</th><th>Investment</th><th>Class</th><th>IFRS 9</th><th>Issuer</th><th>Ccy</th><th className="text-right">Cost</th><th className="text-right">Latest value</th><th>As of</th><th>Maturity</th><th /></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((h) => (
                  <tr key={h.id}>
                    <td className="py-1.5 font-mono">{h.code}</td><td className="text-slate-800">{h.name}</td><td>{h.asset_class}</td>
                    <td>{h.ifrs9_category.replace('_', ' ').toUpperCase()}</td><td>{h.issuer}</td><td>{h.currency}</td>
                    <td className="text-right font-mono">{money(h.cost, currency)}</td>
                    <td className="text-right font-mono">{h.latest_value != null ? money(h.latest_value, currency) : '—'}</td>
                    <td>{h.latest_as_of ?? '—'}</td><td>{h.maturity_date ?? '—'}</td>
                    <td><button onClick={() => void remove(h)} aria-label={`Delete ${h.name}`} className="rounded p-1 text-slate-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
