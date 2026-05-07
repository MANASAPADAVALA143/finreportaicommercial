import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import BaselineManager from '../../components/BaselineManager';
import BenfordChart from '../../components/BenfordChart';

const API_BASE = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || '';

type HistoryStatus = {
  company_id: string;
  has_baseline: boolean;
  months_loaded: number;
  total_entries: number;
  accounts_covered: number;
  quality: 'strong' | 'building' | 'weak' | 'none';
  account_summary: { account: string; entries: number; mean: number; std: number }[];
  month_breakdown?: { month: string; entries: number }[];
};

type HistoricalResult = {
  baseline_quality: string;
  population_analysis: {
    benford: {
      observed_distribution: Record<string, number>;
      expected_distribution: Record<string, number>;
      interpretation: string;
      p_value: number;
    };
    drift: { overall_drift_flag?: boolean; summary?: string; message?: string };
    total_entries_analysed: number;
    flagged_count: number;
    flag_rate_pct: number;
  };
  entries: Array<{
    journal_id: string;
    account: string;
    amount: number;
    composite: {
      composite_score: number;
      risk_level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
      top_reasons: string[];
    };
    models: {
      zscore: { baseline_source: string; zscore: number };
      iqr: { flag: boolean; extreme: boolean; upper_fence: number };
      isolation: { risk_score: number; training_source: string; shap_top_features: string[] };
      behaviour: { flags_triggered: string[]; behaviour_score: number };
      compliance: { compliance_score: number; large_manual: boolean; duplicate_entry: boolean; no_reference: boolean };
    };
  }>;
};

function parseUploadRows(file: File): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const isCsv = file.name.toLowerCase().endsWith('.csv');
    reader.onload = (ev) => {
      try {
        const data = ev.target?.result;
        if (!data) return resolve([]);
        if (isCsv) {
          const text = typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBuffer);
          const lines = text.split(/\r?\n/).filter(Boolean);
          const headers = lines[0].split(',').map((h) => h.trim());
          const rows = lines.slice(1).map((line) => {
            const vals = line.split(',').map((v) => v.trim());
            const obj: Record<string, string> = {};
            headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
            return obj;
          });
          resolve(rows);
          return;
        }
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(ws));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = reject;
    if (isCsv) reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });
}

function mapEntry(r: any) {
  return {
    journal_id: String(r.journal_id ?? r.entry_id ?? r.id ?? ''),
    posting_date: String(r.posting_date ?? r.date ?? ''),
    account: String(r.account ?? r.gl_account ?? ''),
    amount: Number(r.amount ?? r.debit ?? r.credit ?? 0) || 0,
    user_id: String(r.user_id ?? r.user ?? r.posted_by ?? ''),
    source: String(r.source ?? 'ERP'),
    description: String(r.description ?? r.narration ?? ''),
    entity: String(r.entity ?? ''),
  };
}

const riskColor = (level: string) =>
  level === 'CRITICAL' ? 'bg-red-500' : level === 'HIGH' ? 'bg-orange-500' : level === 'MEDIUM' ? 'bg-amber-500' : 'bg-emerald-500';

export default function HistoricalTab() {
  const [companyId, setCompanyId] = useState('gnanova_demo');
  const [status, setStatus] = useState<HistoryStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [monthFile, setMonthFile] = useState<File | null>(null);
  const [month, setMonth] = useState('2025-01');
  const [analysisFile, setAnalysisFile] = useState<File | null>(null);
  const [analysisMonths, setAnalysisMonths] = useState(6);
  const [result, setResult] = useState<HistoricalResult | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadStatus = async () => {
    if (!API_BASE || !companyId) return;
    setLoadingStatus(true);
    try {
      const r = await fetch(`${API_BASE}/api/v2/history/baseline-status?company_id=${encodeURIComponent(companyId)}`);
      const j = await r.json();
      setStatus(j);
    } finally {
      setLoadingStatus(false);
    }
  };

  const uploadMonthly = async () => {
    if (!API_BASE || !monthFile) return;
    const rows = await parseUploadRows(monthFile);
    const entries = rows.map(mapEntry).filter((e) => e.journal_id && e.account && e.posting_date);
    const r = await fetch(`${API_BASE}/api/v2/history/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId, upload_month: month, entries }),
    });
    if (!r.ok) throw new Error(await r.text());
    await loadStatus();
    alert('Monthly data uploaded and baseline rebuilt.');
  };

  const resetBaseline = async () => {
    if (!API_BASE) return;
    const r = await fetch(`${API_BASE}/api/v2/history/reset?company_id=${encodeURIComponent(companyId)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(await r.text());
    await loadStatus();
    setResult(null);
  };

  const runHistorical = async () => {
    if (!API_BASE || !analysisFile) return;
    const rows = await parseUploadRows(analysisFile);
    const entries = rows.map(mapEntry).filter((e) => e.journal_id && e.account && e.posting_date);
    const r = await fetch(`${API_BASE}/api/v2/analyze-historical`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId, entries, analysis_months: analysisMonths }),
    });
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json();
    setResult(j);
  };

  const topRows = useMemo(() => (result?.entries || []).slice(0, 20), [result]);

  const exportCsv = () => {
    if (!result?.entries?.length) return;
    const lines = ['journal_id,account,amount,risk_level,composite_score,top_reason,zscore_source'];
    for (const e of result.entries) {
      lines.push(
        [
          e.journal_id,
          e.account,
          e.amount,
          e.composite.risk_level,
          e.composite.composite_score,
          (e.composite.top_reasons?.[0] || '').replace(/,/g, ' '),
          e.models.zscore.baseline_source,
        ].join(',')
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'historical_intelligence_results.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <BaselineManager
        companyId={companyId}
        status={status}
        loading={loadingStatus}
        onCompanyChange={setCompanyId}
        onUploadClick={() => void uploadMonthly()}
        onResetClick={() => void resetBaseline()}
      />

      <div className="rounded-xl border border-[#1e293b] bg-[#141B2D] p-5">
        <h2 className="mb-3 text-lg font-semibold text-white">📊 Analyse New Month Against Baseline</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Monthly baseline file</label>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setMonthFile(e.target.files?.[0] || null)} className="w-full rounded border border-slate-600 bg-[#0A0F1E] p-2 text-xs text-slate-200" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Upload month</label>
            <input value={month} onChange={(e) => setMonth(e.target.value)} className="w-full rounded border border-slate-600 bg-[#0A0F1E] p-2 text-sm text-slate-200" />
          </div>
          <div className="flex items-end">
            <button onClick={() => void loadStatus()} className="rounded border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:border-[#F5A623]">Refresh baseline status</button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Upload current month file</label>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setAnalysisFile(e.target.files?.[0] || null)} className="w-full rounded border border-slate-600 bg-[#0A0F1E] p-2 text-xs text-slate-200" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Analysis period</label>
            <select value={analysisMonths} onChange={(e) => setAnalysisMonths(Number(e.target.value))} className="w-full rounded border border-slate-600 bg-[#0A0F1E] p-2 text-sm text-slate-200">
              <option value={3}>3 months</option>
              <option value={6}>6 months</option>
              <option value={12}>12 months</option>
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button onClick={() => void runHistorical()} className="rounded bg-[#F5A623] px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400">🔍 Run Historical Analysis</button>
            <button onClick={exportCsv} className="rounded border border-slate-600 px-3 py-2 text-sm text-slate-200">Export Results</button>
          </div>
        </div>
      </div>

      {result && (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-[#1e293b] bg-[#141B2D] p-4"><p className="text-xs text-slate-400">Total Entries</p><p className="text-2xl font-bold text-white">{result.population_analysis.total_entries_analysed}</p></div>
            <div className="rounded-xl border border-[#1e293b] bg-[#141B2D] p-4"><p className="text-xs text-slate-400">Flagged</p><p className="text-2xl font-bold text-white">{result.population_analysis.flagged_count} ({result.population_analysis.flag_rate_pct}%)</p></div>
            <div className="rounded-xl border border-[#1e293b] bg-[#141B2D] p-4"><p className="text-xs text-slate-400">Benford's</p><p className="text-2xl font-bold text-white">{result.population_analysis.benford.p_value < 0.05 ? '⚠️ Deviated' : '✅ Normal'}</p></div>
          </div>
          {(result.population_analysis.drift.overall_drift_flag || result.population_analysis.drift.summary) && (
            <div className="rounded-lg bg-red-500/20 px-4 py-2 text-sm text-red-300">
              🔴 {result.population_analysis.drift.summary || result.population_analysis.drift.message}
            </div>
          )}
          <BenfordChart
            observed={result.population_analysis.benford.observed_distribution}
            expected={result.population_analysis.benford.expected_distribution}
          />
          <div className="rounded-xl border border-[#1e293b] bg-[#141B2D] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Top Risk Entries</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-400">
                    <th className="py-2">Journal ID</th><th>Account</th><th>Amount</th><th>Risk</th><th>Composite</th><th>Top Reason</th><th>Z-Score Source</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {topRows.map((e) => (
                    <>
                      <tr key={e.journal_id} className="border-b border-slate-800 text-slate-200">
                        <td className="py-2">{e.journal_id}</td>
                        <td>{e.account}</td>
                        <td>{e.amount.toLocaleString()}</td>
                        <td><span className={`rounded px-2 py-0.5 text-white ${riskColor(e.composite.risk_level)}`}>{e.composite.risk_level}</span></td>
                        <td>
                          <div className="w-28 rounded bg-slate-700">
                            <div className={`h-2 rounded ${riskColor(e.composite.risk_level)}`} style={{ width: `${Math.min(100, e.composite.composite_score)}%` }} />
                          </div>
                          <span>{e.composite.composite_score}</span>
                        </td>
                        <td>{e.composite.top_reasons?.[0] || '—'}</td>
                        <td>{e.models.zscore.baseline_source}</td>
                        <td><button onClick={() => setExpanded(expanded === e.journal_id ? null : e.journal_id)} className="text-[#F5A623]">{expanded === e.journal_id ? 'Collapse' : 'Expand'}</button></td>
                      </tr>
                      {expanded === e.journal_id && (
                        <tr className="border-b border-slate-800">
                          <td colSpan={8} className="bg-[#0A0F1E] p-3 text-xs text-slate-300">
                            <div className="grid gap-2 md:grid-cols-2">
                              <div>📊 Z-Score {e.models.zscore.zscore} ({e.models.zscore.baseline_source})</div>
                              <div>📦 IQR {e.models.iqr.extreme ? 'Extreme outlier' : e.models.iqr.flag ? 'Outlier' : 'Normal'} (upper {e.models.iqr.upper_fence})</div>
                              <div>🤖 Isolation {e.models.isolation.risk_score}/100 ({e.models.isolation.training_source})</div>
                              <div>👤 Behaviour {e.models.behaviour.flags_triggered.join(' | ') || 'none'}</div>
                              <div>✅ Compliance score {e.models.compliance.compliance_score}</div>
                              <div>Top contributors: {e.models.isolation.shap_top_features.join(', ') || 'n/a'}</div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
