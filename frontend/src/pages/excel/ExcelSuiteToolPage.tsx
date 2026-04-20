import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Download, Loader2, Upload } from 'lucide-react';
import { getModuleBySlug } from './excelModules';

function apiBase(): string {
  return (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || 'http://localhost:8000';
}

const DEFAULT_SCENARIO = `{
  "base_revenue_growth_pct": 10,
  "bull_revenue_growth_pct": 20,
  "bear_revenue_growth_pct": 0,
  "base_cost_inflation_pct": 5,
  "bull_cost_inflation_pct": 3,
  "bear_cost_inflation_pct": 8
}`;

export function ExcelSuiteToolPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const mod = useMemo(() => getModuleBySlug(slug), [slug]);

  const [file, setFile] = useState<File | null>(null);
  const [file2, setFile2] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [industry, setIndustry] = useState('Manufacturing (Prism)');
  const [revGrowth, setRevGrowth] = useState(10);
  const [costInfl, setCostInfl] = useState(5);
  const [hires, setHires] = useState(0);
  const [fyLabel, setFyLabel] = useState('FY2026');
  const [currentMonth, setCurrentMonth] = useState(9);
  const [minCash, setMinCash] = useState(1_500_000);
  const [mgmtFormat, setMgmtFormat] = useState<'ICAI' | 'CIMA'>('ICAI');
  const [scenarioJson, setScenarioJson] = useState(DEFAULT_SCENARIO);

  if (!mod) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center p-8">
          <p className="text-gray-700 mb-4">Unknown module.</p>
          <button type="button" className="text-emerald-700 underline" onClick={() => navigate('/excel-suite')}>
            Back to Excel AI Suite
          </button>
        </div>
      </div>
    );
  }

  async function runDownload() {
    if (!file) {
      toast.error('Choose an Excel file first.');
      return;
    }

    const fd = new FormData();
    fd.append('file', file);
    if (mod.secondFile && file2) {
      fd.append('budget_file', file2);
    }
    if (mod.extraFields === 'budgetAssumptions') {
      fd.append('industry', industry);
      fd.append('revenue_growth_pct', String(revGrowth));
      fd.append('cost_inflation_pct', String(costInfl));
      fd.append('new_hires', String(hires));
      fd.append('fy_label', fyLabel);
    }
    if (mod.extraFields === 'rollingMonth') {
      fd.append('current_month', String(currentMonth));
    }
    if (mod.extraFields === 'minCash') {
      fd.append('min_cash', String(minCash));
    }
    if (mod.extraFields === 'mgmtFormat') {
      fd.append('format_id', mgmtFormat);
    }
    if (mod.extraFields === 'scenarioJson') {
      fd.append('assumptions_json', scenarioJson);
    }

    setBusy(true);
    try {
      const url = `${apiBase()}${mod.endpoint}`;
      const res = await fetch(url, { method: 'POST', body: fd });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition');
      let name = `FinReportAI_${mod.slug}.xlsx`;
      const m = cd?.match(/filename="?([^";]+)"?/i);
      if (m) name = m[1];
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = name;
      a.click();
      URL.revokeObjectURL(href);
      toast.success('Download started');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-emerald-50/30 to-slate-50">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <button
          type="button"
          onClick={() => navigate('/excel-suite')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Excel AI Suite
        </button>

        <div className="bg-white rounded-xl border border-emerald-100 shadow-sm p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{mod.title}</h1>
          <p className="text-gray-600 text-sm mb-6">{mod.description}</p>

          <label className="block text-sm font-medium text-gray-700 mb-2">Excel file</label>
          <label className="flex items-center gap-3 border-2 border-dashed border-emerald-200 rounded-lg p-4 cursor-pointer hover:bg-emerald-50/50 transition-colors mb-6">
            <Upload className="w-5 h-5 text-emerald-600 shrink-0" />
            <span className="text-sm text-gray-600 truncate">{file ? file.name : 'Click to select .xlsx'}</span>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>

          {mod.secondFile && (
            <>
              <label className="block text-sm font-medium text-gray-700 mb-2">Budget trial balance (optional)</label>
              <label className="flex items-center gap-3 border-2 border-dashed border-slate-200 rounded-lg p-4 cursor-pointer hover:bg-slate-50 transition-colors mb-6">
                <Upload className="w-5 h-5 text-slate-500 shrink-0" />
                <span className="text-sm text-gray-600 truncate">{file2 ? file2.name : 'Second .xlsx (optional)'}</span>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => setFile2(e.target.files?.[0] ?? null)}
                />
              </label>
            </>
          )}

          {mod.extraFields === 'budgetAssumptions' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Industry</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">FY label</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={fyLabel}
                  onChange={(e) => setFyLabel(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Revenue growth %</label>
                <input
                  type="number"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={revGrowth}
                  onChange={(e) => setRevGrowth(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Cost inflation %</label>
                <input
                  type="number"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={costInfl}
                  onChange={(e) => setCostInfl(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">New hires (FTE)</label>
                <input
                  type="number"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={hires}
                  onChange={(e) => setHires(Number(e.target.value))}
                />
              </div>
            </div>
          )}

          {mod.extraFields === 'rollingMonth' && (
            <div className="mb-6">
              <label className="block text-xs font-medium text-gray-600 mb-1">Last actual month (1–12)</label>
              <input
                type="number"
                min={1}
                max={12}
                className="w-full border rounded-lg px-3 py-2 text-sm max-w-xs"
                value={currentMonth}
                onChange={(e) => setCurrentMonth(Number(e.target.value))}
              />
            </div>
          )}

          {mod.extraFields === 'minCash' && (
            <div className="mb-6">
              <label className="block text-xs font-medium text-gray-600 mb-1">Minimum cash threshold (₹)</label>
              <input
                type="number"
                className="w-full border rounded-lg px-3 py-2 text-sm max-w-xs"
                value={minCash}
                onChange={(e) => setMinCash(Number(e.target.value))}
              />
            </div>
          )}

          {mod.extraFields === 'mgmtFormat' && (
            <div className="mb-6">
              <label className="block text-xs font-medium text-gray-600 mb-1">Format</label>
              <select
                className="w-full border rounded-lg px-3 py-2 text-sm max-w-xs"
                value={mgmtFormat}
                onChange={(e) => setMgmtFormat(e.target.value as 'ICAI' | 'CIMA')}
              >
                <option value="ICAI">ICAI (India)</option>
                <option value="CIMA">CIMA (UK / UAE)</option>
              </select>
            </div>
          )}

          {mod.extraFields === 'scenarioJson' && (
            <div className="mb-6">
              <label className="block text-xs font-medium text-gray-600 mb-1">Scenario assumptions (JSON)</label>
              <textarea
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono h-40"
                value={scenarioJson}
                onChange={(e) => setScenarioJson(e.target.value)}
              />
            </div>
          )}

          <button
            type="button"
            disabled={busy || !file}
            onClick={() => void runDownload()}
            className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-3 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
            {busy ? 'Processing…' : 'Run AI & download Excel'}
          </button>

          <p className="text-xs text-gray-500 mt-4">
            Backend: <code className="bg-slate-100 px-1 rounded">{apiBase()}{mod.endpoint}</code>
          </p>
        </div>
      </div>
    </div>
  );
}
