import { useMemo, useState, useCallback } from 'react';
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

type PlainSummary = {
  risk_explanation:  string;
  what_is_score:     string;
  amount_check:      string;
  pattern_check:     string;
  range_check:       string;
  controls_check:    string;
  behaviour_alerts:  string[];
  key_findings:      { feature: string; label: string }[];
};

type DigitScore = {
  observed_count: number;
  observed_pct:   number;
  expected_pct:   number;
  deviation_pct:  number;
};

type LayerDetail = {
  statistical: { score: number; ctx_zscore: number; iqr_score: number; mad_score: number };
  ml:          { score: number; if_score: number; lof_score: number; ae_score: number };
  pattern:     { score: number; duplicate: number; round_number: number; velocity: number; sequence: number; splitting: number };
  behavioral:  { score: number; new_actor: number; timing: number; monthend: number };
};

type HistoricalResult = {
  baseline_quality: string;
  batch_stats?: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  population_analysis: {
    benford: {
      chi2?:          number;
      p_value:        number;
      digit_scores?:  Record<string, DigitScore>;
      /** legacy */
      observed_distribution?: Record<string, number>;
      expected_distribution?: Record<string, number>;
      interpretation: string;
    };
    drift: {
      overall_drift_flag?:    boolean;
      summary?:               string;
      message?:               string;
      volume_drift_pct?:      number;   // SIGNED: positive=above baseline, negative=below
      volume_drift_direction?: string;  // "above" | "below"
      volume_baseline_avg?:   number;
      volume_current?:        number;
      volume_drift_flag?:     boolean;  // true when |drift| > 20%
    };
    total_entries_analysed: number;
    flagged_count:  number;
    flag_rate_pct:  number;
  };
  entries: Array<{
    journal_id:   string;
    account:      string;
    amount:       number;
    plain?:       PlainSummary;
    composite: {
      composite_score: number;
      risk_level:      'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
      top_reasons:     string[];
      layer_scores?:   { statistical: number; ml: number; pattern: number; behavioral: number };
      score_breakdown?: Record<string, number>;
    };
    layer_detail?: LayerDetail;
    /** LLM-generated audit narrative (CRITICAL/HIGH entries only) */
    audit_narrative?: string | null;
    /** legacy — may be absent in new engine results */
    models?: {
      zscore:     { baseline_source: string; zscore: number };
      iqr:        { flag: boolean; extreme: boolean; upper_fence: number; lower_fence: number };
      isolation:  { risk_score: number; training_source: string; shap_top_features: string[] };
      behaviour:  { flags_triggered: string[]; behaviour_score: number };
      compliance: { compliance_score: number; large_manual: boolean; duplicate_entry: boolean; no_reference: boolean };
    };
  }>;
};

// ── File parsing ──────────────────────────────────────────────────────────────

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
  const norm: Record<string, any> = {};
  for (const k of Object.keys(r)) {
    norm[k.toLowerCase().trim().replace(/[\s\-]+/g, '_')] = r[k];
  }
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = norm[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return undefined;
  };

  let rawDate = get(
    'posting_date', 'date', 'txn_date', 'transaction_date',
    'je_date', 'value_date', 'doc_date', 'posting_dt', 'entry_date',
    'voucher_date', 'period',
  );
  if (rawDate !== undefined) {
    const serial = Number(rawDate);
    if (!isNaN(serial) && serial > 30000 && serial < 60000) {
      const ms = (serial - 25569) * 86400 * 1000;
      const d = new Date(ms);
      rawDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    } else {
      rawDate = String(rawDate);
    }
  }

  return {
    journal_id: String(
      get('journal_id', 'entry_id', 'je_id', 'id', 'voucher_no', 'voucher_number',
          'jeid', 'jnl_id', 'ref_no', 'reference_no', 'doc_no', 'document_no') ?? '',
    ),
    posting_date: rawDate ? String(rawDate) : '',
    account: String(
      get('account', 'gl_account', 'ledger', 'account_name', 'account_code',
          'acc', 'acct', 'gl_code', 'gl_name', 'account_head') ?? '',
    ),
    amount: Number(
      get('amount', 'debit', 'credit', 'net_amount', 'value', 'amt', 'dr', 'cr') ?? 0,
    ) || 0,
    user_id: String(
      get('user_id', 'user', 'posted_by', 'created_by', 'preparer',
          'approver', 'userid', 'entered_by', 'modified_by') ?? '',
    ),
    source:      String(get('source', 'entry_type', 'type', 'posting_type', 'origin') ?? 'ERP'),
    description: String(
      get('description', 'narration', 'remarks', 'desc', 'memo',
          'particulars', 'note', 'notes', 'details', 'line_description') ?? '',
    ),
    entity: String(get('entity', 'company', 'subsidiary', 'bu', 'business_unit', 'cost_center') ?? ''),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const riskColor = (level: string) =>
  level === 'CRITICAL' ? 'bg-red-500'
    : level === 'HIGH' ? 'bg-orange-500'
    : level === 'MEDIUM' ? 'bg-amber-500'
    : 'bg-emerald-500';

const riskText = (level: string) =>
  level === 'CRITICAL' ? 'text-red-400'
    : level === 'HIGH' ? 'text-orange-400'
    : level === 'MEDIUM' ? 'text-amber-400'
    : 'text-emerald-400';

// ── Narrative card ────────────────────────────────────────────────────────────

function NarrativeCard({
  narrative,
  riskLevel,
}: {
  narrative?: string | null;
  riskLevel: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!narrative) return;
    navigator.clipboard.writeText(narrative).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [narrative]);

  const isHighRisk = riskLevel === 'CRITICAL' || riskLevel === 'HIGH';
  if (!isHighRisk) return null;

  const borderColor =
    riskLevel === 'CRITICAL' ? 'border-red-500/40' : 'border-orange-500/40';
  const bgColor =
    riskLevel === 'CRITICAL' ? 'bg-red-500/5' : 'bg-orange-500/5';
  const labelColor =
    riskLevel === 'CRITICAL' ? 'text-red-300' : 'text-orange-300';

  if (!narrative) {
    // Skeleton loading state
    return (
      <div className={`rounded-lg border ${borderColor} ${bgColor} p-3`}>
        <div className="flex items-center justify-between mb-2">
          <p className={`text-xs font-semibold ${labelColor} flex items-center gap-1`}>
            ✦ AI Audit Observation
            <span className="ml-1 inline-block h-2 w-2 rounded-full bg-current animate-pulse" />
          </p>
          <span className="text-xs text-slate-500">Generating…</span>
        </div>
        <div className="space-y-1.5">
          <div className="h-2.5 w-full rounded bg-slate-700 animate-pulse" />
          <div className="h-2.5 w-5/6 rounded bg-slate-700 animate-pulse" />
          <div className="h-2.5 w-4/6 rounded bg-slate-700 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border ${borderColor} ${bgColor} p-3`}>
      <div className="flex items-center justify-between mb-2">
        <p className={`text-xs font-semibold ${labelColor} flex items-center gap-1`}>
          ✦ AI Audit Observation
        </p>
        <button
          onClick={handleCopy}
          title="Copy to clipboard"
          className="rounded px-2 py-0.5 text-xs text-slate-400 hover:text-slate-200 border border-slate-600 hover:border-slate-400 transition-colors"
        >
          {copied ? '✓ Copied' : '⎘ Copy'}
        </button>
      </div>
      <p className="text-slate-300 leading-relaxed" style={{ fontSize: '0.72rem' }}>
        {narrative}
      </p>
    </div>
  );
}

function LayerBar({ label, score, color }: { label: string; score: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 flex-none text-slate-400" style={{ fontSize: '0.7rem' }}>{label}</span>
      <div className="flex-1 rounded bg-slate-700" style={{ height: 8 }}>
        <div className={`h-full rounded ${color}`} style={{ width: `${Math.min(100, score)}%` }} />
      </div>
      <span className="w-8 text-right text-slate-300" style={{ fontSize: '0.7rem' }}>{Math.round(score)}</span>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

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
  const [showTechnical, setShowTechnical] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const loadStatus = async () => {
    if (!API_BASE || !companyId) return;
    setLoadingStatus(true);
    try {
      const r = await fetch(`${API_BASE}/api/v2/history/baseline-status?company_id=${encodeURIComponent(companyId)}`);
      setStatus(await r.json());
    } finally {
      setLoadingStatus(false);
    }
  };

  const uploadMonthly = async () => {
    if (!API_BASE || !monthFile) { setUploadError('Select a file first.'); return; }
    setUploading(true);
    setUploadError(null);
    try {
      const rows = await parseUploadRows(monthFile);
      const entries = rows.map(mapEntry).filter((e) => e.journal_id && e.account && e.posting_date);
      if (!entries.length) {
        setUploadError('No valid rows found. File must have columns: journal_id (or id), account, posting_date (or date), amount.');
        return;
      }
      const r = await fetch(`${API_BASE}/api/v2/history/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, upload_month: month, entries }),
      });
      if (!r.ok) throw new Error(await r.text());
      await loadStatus();
      setUploadError(null);
      alert('Monthly data uploaded and baseline rebuilt.');
    } catch (e: any) {
      setUploadError(e?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const resetBaseline = async () => {
    if (!API_BASE) return;
    try {
      const r = await fetch(`${API_BASE}/api/v2/history/reset?company_id=${encodeURIComponent(companyId)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await r.text());
      await loadStatus();
      setResult(null);
    } catch (e: any) {
      setUploadError(e?.message || 'Reset failed');
    }
  };

  const runHistorical = async () => {
    if (!API_BASE) { setRunError('API URL not configured.'); return; }
    if (!analysisFile) { setRunError('Upload a file first using "Upload current month file".'); return; }
    setRunning(true);
    setRunError(null);
    try {
      const rows = await parseUploadRows(analysisFile);
      const entries = rows.map(mapEntry).filter((e) => e.journal_id && e.account && e.posting_date);
      if (!entries.length) {
        const sampleKeys = rows.length ? Object.keys(rows[0]).join(', ') : '(no rows)';
        setRunError(
          `No valid rows found after reading ${rows.length} row(s) from the file.\n` +
          `Detected columns: ${sampleKeys}\n\n` +
          `Required columns (any of these names work):\n` +
          `  • Journal ID  →  journal_id, id, entry_id, je_id, voucher_no\n` +
          `  • Account     →  account, gl_account, ledger, account_name\n` +
          `  • Date        →  posting_date, date, txn_date, je_date\n` +
          `  • Amount      →  amount, debit, credit, net_amount\n\n` +
          `Column names are matched case-insensitively. Check your file headers.`,
        );
        return;
      }
      const r = await fetch(`${API_BASE}/api/v2/analyze-historical`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, entries, analysis_months: analysisMonths }),
      });
      if (!r.ok) {
        const errText = await r.text();
        let detail = errText;
        try { detail = JSON.parse(errText)?.detail || errText; } catch { /* keep raw */ }
        throw new Error(detail);
      }
      setResult(await r.json());
    } catch (e: any) {
      setRunError(e?.message || 'Analysis failed');
    } finally {
      setRunning(false);
    }
  };

  const topRows = useMemo(() => (result?.entries || []).slice(0, 20), [result]);

  const exportCsv = () => {
    if (!result?.entries?.length) return;
    // BUG 2 FIX — composite_score was reading correctly but formatting as bare JS number;
    // now explicit Number().toFixed(1) and all 4 layer scores included for auditability
    const header = [
      'journal_id', 'account', 'amount', 'posting_date', 'user_id', 'source',
      'risk_level', 'composite_score',
      'stat_score', 'ml_score', 'pattern_score', 'behavioral_score',
      'top_reason',
    ].join(',');
    const lines = [header];
    for (const e of result.entries) {
      const ld = e.layer_detail;
      const safe = (v: unknown) => String(v ?? '').replace(/,/g, ' ').replace(/\n/g, ' ');
      lines.push([
        safe(e.journal_id),
        safe(e.account),
        Number(e.amount).toFixed(2),
        safe((e as any).posting_date ?? ''),
        safe((e as any).user_id ?? ''),
        safe((e as any).source ?? ''),
        e.composite.risk_level,
        Number(e.composite.composite_score ?? 0).toFixed(1),
        ld ? Number(ld.statistical.score).toFixed(1) : '',
        ld ? Number(ld.ml.score).toFixed(1)          : '',
        ld ? Number(ld.pattern.score).toFixed(1)     : '',
        ld ? Number(ld.behavioral.score).toFixed(1)  : '',
        safe(e.composite.top_reasons?.[0] ?? ''),
      ].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'historical_intelligence_results.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  // Derive batch_stats from result (support both new and legacy shapes)
  const batchStats = useMemo(() => {
    if (!result) return null;
    if (result.batch_stats) return result.batch_stats;
    // Legacy: count from entries
    const entries = result.entries ?? [];
    return {
      total:    entries.length,
      critical: entries.filter((e) => e.composite.risk_level === 'CRITICAL').length,
      high:     entries.filter((e) => e.composite.risk_level === 'HIGH').length,
      medium:   entries.filter((e) => e.composite.risk_level === 'MEDIUM').length,
      low:      entries.filter((e) => e.composite.risk_level === 'LOW').length,
    };
  }, [result]);

  return (
    <div className="space-y-5">
      <BaselineManager
        companyId={companyId}
        status={status}
        loading={loadingStatus || uploading}
        onCompanyChange={(v) => { setCompanyId(v); setUploadError(null); setRunError(null); }}
        onUploadClick={() => void uploadMonthly()}
        onResetClick={() => void resetBaseline()}
      />

      {/* ── Controls ────────────────────────────────────────────────────────── */}
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
            <button
              onClick={() => void runHistorical()}
              disabled={running}
              className="rounded bg-[#F5A623] px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
            >
              {running ? '⏳ Running…' : '🔍 Run Historical Analysis'}
            </button>
            <button onClick={exportCsv} className="rounded border border-slate-600 px-3 py-2 text-sm text-slate-200">Export Results</button>
          </div>
        </div>
      </div>

      {/* ── Errors ──────────────────────────────────────────────────────────── */}
      {uploadError && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300 whitespace-pre-line">⚠️ {uploadError}</div>
      )}
      {runError && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300 whitespace-pre-line">⚠️ {runError}</div>
      )}

      {/* ── Results ─────────────────────────────────────────────────────────── */}
      {result && batchStats && (
        <>
          {/* ── 5 Stat Cards ──────────────────────────────────────────────── */}
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div className="rounded-xl border border-[#1e293b] bg-[#141B2D] p-4">
              <p className="text-xs text-slate-400">Total Entries</p>
              <p className="text-2xl font-bold text-white">{batchStats.total}</p>
            </div>
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
              <p className="text-xs text-red-400">Critical</p>
              <p className="text-2xl font-bold text-red-300">{batchStats.critical}</p>
            </div>
            <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-4">
              <p className="text-xs text-orange-400">High</p>
              <p className="text-2xl font-bold text-orange-300">{batchStats.high}</p>
            </div>
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="text-xs text-amber-400">Medium</p>
              <p className="text-2xl font-bold text-amber-300">{batchStats.medium}</p>
            </div>
            <div className={`rounded-xl border p-4 ${
              result.population_analysis.benford.p_value < 0.05
                ? 'border-red-500/30 bg-red-500/10'
                : 'border-emerald-500/30 bg-emerald-500/10'
            }`}>
              <p className={`text-xs ${result.population_analysis.benford.p_value < 0.05 ? 'text-red-400' : 'text-emerald-400'}`}>Benford's Law</p>
              <p className={`text-xl font-bold ${result.population_analysis.benford.p_value < 0.05 ? 'text-red-300' : 'text-emerald-300'}`}>
                {result.population_analysis.benford.p_value < 0.05 ? '⚠️ Deviated' : '✅ Normal'}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">p = {result.population_analysis.benford.p_value.toFixed(4)}</p>
            </div>
          </div>

          {/* ── Drift alert ───────────────────────────────────────────────── */}
          {(() => {
            const drift = result.population_analysis.drift;
            const volPct   = drift.volume_drift_pct ?? 0;
            const volFlag  = drift.volume_drift_flag;
            const isAbove  = volPct > 0;
            // Within ±10%: silent (no banner for volume drift alone)
            const volSilent = Math.abs(volPct) <= 10;

            // Show banner only when there's a real alert or non-volume drift issue
            const showBanner = drift.overall_drift_flag && !volSilent;
            if (!showBanner && !drift.message) return null;

            // Color: positive volume drift = red, negative = green, no volume drift flag = amber
            const bannerColor = !volFlag
              ? 'bg-slate-700/40 text-slate-300'
              : isAbove
                ? 'bg-red-500/20 text-red-300'
                : 'bg-emerald-500/15 text-emerald-300';

            const icon = !volFlag ? '📊' : isAbove ? '🔴' : '🟢';

            return (
              <div className={`rounded-lg px-4 py-2 text-sm ${bannerColor}`}>
                {icon} {drift.summary || drift.message}
                {drift.volume_drift_pct !== undefined && !volSilent && (
                  <span className="ml-2 opacity-70 text-xs">
                    (current: {drift.volume_current} entries, baseline avg: {drift.volume_baseline_avg}/mo)
                  </span>
                )}
              </div>
            );
          })()}

          {/* ── Benford Chart ─────────────────────────────────────────────── */}
          <BenfordChart
            digit_scores={result.population_analysis.benford.digit_scores}
            chi2={result.population_analysis.benford.chi2}
            p_value={result.population_analysis.benford.p_value}
            observed={result.population_analysis.benford.observed_distribution}
            expected={result.population_analysis.benford.expected_distribution}
          />

          {/* ── Entry Table ───────────────────────────────────────────────── */}
          <div className="rounded-xl border border-[#1e293b] bg-[#141B2D] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Top Risk Entries</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-400">
                    <th className="py-2 pr-3">Journal ID</th>
                    <th className="pr-3">Account</th>
                    <th className="pr-3">Amount</th>
                    <th className="pr-3">Risk</th>
                    <th className="pr-3">Score</th>
                    <th className="pr-3">Top Reason</th>
                    <th className="pr-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {topRows.map((e) => (
                    <>
                      <tr key={e.journal_id} className="border-b border-slate-800 text-slate-200 hover:bg-slate-800/30">
                        <td className="py-2 pr-3 font-mono">{e.journal_id}</td>
                        <td className="pr-3">{e.account}</td>
                        <td className="pr-3">{e.amount.toLocaleString()}</td>
                        <td className="pr-3">
                          <span className={`rounded px-2 py-0.5 text-white text-xs ${riskColor(e.composite.risk_level)}`}>
                            {e.composite.risk_level}
                          </span>
                        </td>
                        <td className="pr-3">
                          <div className="flex items-center gap-1">
                            <div className="w-20 rounded bg-slate-700 h-1.5">
                              <div className={`h-full rounded ${riskColor(e.composite.risk_level)}`} style={{ width: `${Math.min(100, e.composite.composite_score)}%` }} />
                            </div>
                            <span className={`font-mono ${riskText(e.composite.risk_level)}`}>{e.composite.composite_score}</span>
                          </div>
                        </td>
                        <td className="pr-3 max-w-xs truncate text-slate-300">{e.composite.top_reasons?.[0] || '—'}</td>
                        <td>
                          <button
                            onClick={() => setExpanded(expanded === e.journal_id ? null : e.journal_id)}
                            className="text-[#F5A623] hover:underline"
                          >
                            {expanded === e.journal_id ? 'Collapse ▲' : 'Expand ▼'}
                          </button>
                        </td>
                      </tr>

                      {/* ── Expanded detail panel ─────────────────────────── */}
                      {expanded === e.journal_id && (
                        <tr className="border-b border-slate-800">
                          <td colSpan={7} className="bg-[#0A0F1E] p-4 text-xs">
                            {e.plain ? (
                              <div className="space-y-3">
                                {/* Header */}
                                <div className="rounded-lg border border-slate-700 bg-[#141B2D] p-3">
                                  <p className="mb-1 font-semibold text-white">{e.plain.risk_explanation}</p>
                                  <p className="text-slate-400">{e.plain.what_is_score}</p>
                                </div>

                                {/* ── AI Audit Narrative (CRITICAL/HIGH only) ── */}
                                <NarrativeCard
                                  narrative={e.audit_narrative}
                                  riskLevel={e.composite.risk_level}
                                />

                                {/* 4-Layer Breakdown Bars */}
                                {e.composite.layer_scores && (
                                  <div className="rounded-lg border border-slate-700 bg-[#141B2D] p-3">
                                    <p className="mb-2 font-semibold text-slate-300">⚙️ Detection Layer Scores</p>
                                    <div className="space-y-2">
                                      <LayerBar label="📊 Statistical" score={e.composite.layer_scores.statistical} color="bg-blue-500" />
                                      <LayerBar label="🤖 ML Models"   score={e.composite.layer_scores.ml}          color="bg-purple-500" />
                                      <LayerBar label="🔍 Pattern"     score={e.composite.layer_scores.pattern}     color="bg-orange-500" />
                                      <LayerBar label="👤 Behavioral"  score={e.composite.layer_scores.behavioral}  color="bg-teal-500" />
                                    </div>
                                    {e.layer_detail && (
                                      <div className="mt-3 grid gap-2 sm:grid-cols-2 text-slate-400">
                                        <div>
                                          <span className="text-slate-500">Z-score: </span>
                                          <span className={e.layer_detail.statistical.ctx_zscore > 3 ? 'text-orange-300' : 'text-slate-300'}>
                                            {e.layer_detail.statistical.ctx_zscore.toFixed(2)}σ
                                          </span>
                                        </div>
                                        <div>
                                          <span className="text-slate-500">Isolation Forest: </span>
                                          <span className={e.layer_detail.ml.if_score > 65 ? 'text-orange-300' : 'text-slate-300'}>
                                            {e.layer_detail.ml.if_score}/100
                                          </span>
                                        </div>
                                        <div>
                                          <span className="text-slate-500">Duplicate: </span>
                                          <span className={e.layer_detail.pattern.duplicate > 50 ? 'text-red-300' : 'text-slate-300'}>
                                            {e.layer_detail.pattern.duplicate > 50 ? '⚠️ Yes' : 'No'}
                                          </span>
                                        </div>
                                        <div>
                                          <span className="text-slate-500">New actor: </span>
                                          <span className={e.layer_detail.behavioral.new_actor > 40 ? 'text-orange-300' : 'text-slate-300'}>
                                            {e.layer_detail.behavioral.new_actor > 40 ? '⚠️ Yes' : 'No'}
                                          </span>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Four plain-English checks */}
                                <div className="grid gap-2 md:grid-cols-2">
                                  <div className="rounded-lg border border-slate-700 bg-[#141B2D] p-3">
                                    <p className="mb-1 font-semibold text-slate-300">📊 Amount Check</p>
                                    <p className="text-slate-400">{e.plain.amount_check}</p>
                                  </div>
                                  <div className="rounded-lg border border-slate-700 bg-[#141B2D] p-3">
                                    <p className="mb-1 font-semibold text-slate-300">🔍 Pattern Check</p>
                                    <p className="text-slate-400">{e.plain.pattern_check}</p>
                                  </div>
                                  <div className="rounded-lg border border-slate-700 bg-[#141B2D] p-3">
                                    <p className="mb-1 font-semibold text-slate-300">📏 Range Check</p>
                                    <p className="text-slate-400">{e.plain.range_check}</p>
                                  </div>
                                  <div className="rounded-lg border border-slate-700 bg-[#141B2D] p-3">
                                    <p className="mb-1 font-semibold text-slate-300">🛡️ Controls Check</p>
                                    <p className="text-slate-400">{e.plain.controls_check}</p>
                                  </div>
                                </div>

                                {/* Behaviour alerts */}
                                {e.plain.behaviour_alerts.length > 0 && (
                                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                                    <p className="mb-2 font-semibold text-amber-300">⚠️ Behaviour Alerts</p>
                                    <ul className="space-y-1">
                                      {e.plain.behaviour_alerts.map((a, i) => (
                                        <li key={i} className="text-amber-200">• {a}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}

                                {/* Key findings */}
                                {e.plain.key_findings.length > 0 && (
                                  <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
                                    <p className="mb-2 font-semibold text-blue-300">🔎 Key Findings</p>
                                    <ul className="space-y-1">
                                      {e.plain.key_findings.map((f, i) => (
                                        <li key={i} className="text-blue-200">• {f.label}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}

                                {/* Technical details toggle */}
                                <button
                                  onClick={() => setShowTechnical(showTechnical === e.journal_id ? null : e.journal_id)}
                                  className="text-slate-500 hover:text-slate-300 text-xs underline-offset-2 hover:underline"
                                >
                                  {showTechnical === e.journal_id ? '▲ Hide technical details' : '▼ Show technical details'}
                                </button>
                                {showTechnical === e.journal_id && (
                                  <div className="rounded-lg border border-slate-700 bg-[#0d1424] p-3 font-mono space-y-1 text-slate-400">
                                    {e.layer_detail ? (
                                      <>
                                        <div>Statistical  — Z={e.layer_detail.statistical.ctx_zscore.toFixed(2)} · IQR={e.layer_detail.statistical.iqr_score} · MAD={e.layer_detail.statistical.mad_score}</div>
                                        <div>ML           — IF={e.layer_detail.ml.if_score} · LOF={e.layer_detail.ml.lof_score} · AE={e.layer_detail.ml.ae_score}</div>
                                        <div>Pattern      — dup={e.layer_detail.pattern.duplicate} · round={e.layer_detail.pattern.round_number} · vel={e.layer_detail.pattern.velocity} · split={e.layer_detail.pattern.splitting}</div>
                                        <div>Behavioral   — new_actor={e.layer_detail.behavioral.new_actor} · timing={e.layer_detail.behavioral.timing} · monthend={e.layer_detail.behavioral.monthend}</div>
                                        <div>Composite    — {e.composite.composite_score} ({e.composite.risk_level})</div>
                                      </>
                                    ) : e.models ? (
                                      <>
                                        <div>Z-Score {e.models.zscore.zscore.toFixed(2)} · source: {e.models.zscore.baseline_source}</div>
                                        <div>Isolation {e.models.isolation.risk_score}/100 · training: {e.models.isolation.training_source}</div>
                                        <div>IQR {e.models.iqr.extreme ? 'Extreme' : e.models.iqr.flag ? 'Outlier' : 'Normal'} · upper ₹{e.models.iqr.upper_fence.toLocaleString()}</div>
                                        <div>Behaviour flags: {e.models.behaviour.flags_triggered.join(' | ') || 'none'}</div>
                                        <div>Compliance score: {e.models.compliance.compliance_score}</div>
                                      </>
                                    ) : null}
                                  </div>
                                )}
                              </div>
                            ) : (
                              /* Fallback — no plain summary */
                              <div className="space-y-2 text-slate-300">
                                <NarrativeCard
                                  narrative={e.audit_narrative}
                                  riskLevel={e.composite.risk_level}
                                />
                                <p className="font-semibold">Risk: {e.composite.risk_level} — Score {e.composite.composite_score}</p>
                                {e.composite.top_reasons?.map((r, i) => <p key={i} className="text-slate-400">• {r}</p>)}
                              </div>
                            )}
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
