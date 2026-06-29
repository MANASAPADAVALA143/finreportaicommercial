/**
 * AR Collections Enhanced — Full AR module
 * Aging table · Payment prediction · AI dunning emails · Credit limits · AR-Bank recon · AI insight
 */
import { useState, useRef } from 'react';
import {
  Upload, RefreshCw, AlertTriangle, CheckCircle, TrendingDown,
  Mail, Shield, BarChart2, ArrowLeft, Download, Zap, ChevronDown, ChevronRight,
} from 'lucide-react';
import { runCollectionsDunning } from '../../services/arService';

const API = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8001');

const fmt = (n: number) =>
  `AED ${Math.abs(n).toLocaleString('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const pct = (n: number) => `${n.toFixed(1)}%`;

type Tab = 'aging' | 'prediction' | 'dunning' | 'credit' | 'recon' | 'insight';

const TABS: { id: Tab; label: string; icon: typeof BarChart2 }[] = [
  { id: 'aging',      label: 'Invoice Aging',       icon: BarChart2 },
  { id: 'prediction', label: 'Payment Prediction',  icon: TrendingDown },
  { id: 'dunning',    label: 'Dunning Emails',      icon: Mail },
  { id: 'credit',     label: 'Credit Limits',       icon: Shield },
  { id: 'recon',      label: 'AR-Bank Recon',       icon: CheckCircle },
  { id: 'insight',    label: 'AI Insight',          icon: Zap },
];

const RISK_COLOR: Record<string, string> = {
  '🔴 Critical': 'text-red-400',
  '🟠 High':     'text-orange-400',
  '🟡 Medium':   'text-amber-400',
  '🟢 Good':     'text-green-400',
  Critical:      'text-red-400',
  High:          'text-orange-400',
  Medium:        'text-amber-400',
  Low:           'text-green-400',
};

// ── File upload helper ───────────────────────────────────────────────────────

function FileDropzone({ onFile, label, accept = '.csv', secondary }: {
  onFile: (f: File) => void; label: string; accept?: string; secondary?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <label
      className={`flex flex-col items-center gap-2 border-2 border-dashed rounded-xl p-6 cursor-pointer transition-colors
        ${secondary ? 'border-gray-700 hover:border-blue-600' : 'border-teal-700 hover:border-teal-500'}`}
    >
      <Upload size={24} className={secondary ? 'text-gray-500' : 'text-teal-400'} />
      <span className="text-sm text-gray-300">{label}</span>
      <span className="text-xs text-gray-500">CSV or Excel</span>
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
    </label>
  );
}

// ── 1. Aging Tab ─────────────────────────────────────────────────────────────

function AgingTab() {
  const [data, setData]     = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const run = async (file: File) => {
    setLoading(true); setError('');
    const form = new FormData(); form.append('file', file);
    try {
      const r = await fetch(`${API}/api/ar/invoice-aging`, { method: 'POST', body: form });
      if (!r.ok) throw new Error(await r.text());
      setData(await r.json());
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  const BUCKETS = [
    { key: 'current',      label: 'Current',     color: 'bg-green-500' },
    { key: 'days_1_30',    label: '1-30 days',   color: 'bg-yellow-500' },
    { key: 'days_31_60',   label: '31-60 days',  color: 'bg-orange-500' },
    { key: 'days_61_90',   label: '61-90 days',  color: 'bg-red-500' },
    { key: 'days_90_plus', label: '90+ days',    color: 'bg-red-700' },
  ];

  return (
    <div className="space-y-6">
      {!data && <FileDropzone onFile={run} label="Upload gnanova_ar_invoices.csv" />}
      {loading && <div className="text-center py-10 text-teal-400 flex items-center justify-center gap-2"><RefreshCw size={16} className="animate-spin" /> Analysing AR portfolio…</div>}
      {error && <div className="bg-red-900/40 border border-red-700 rounded-lg p-3 text-sm text-red-300">{error}</div>}

      {data && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total AR',      value: fmt(data.total_ar_aed),   color: 'text-white' },
              { label: 'Overdue',       value: fmt(data.overdue_ar_aed), color: 'text-red-400' },
              { label: 'Overdue %',     value: pct(data.overdue_pct),    color: data.overdue_pct > 30 ? 'text-red-400' : 'text-amber-400' },
            ].map(k => (
              <div key={k.label} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
                <p className="text-xs text-gray-400">{k.label}</p>
                <p className={`text-xl font-bold mt-1 ${k.color}`}>{k.value}</p>
              </div>
            ))}
          </div>

          {/* Aging buckets */}
          <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-5">
            <p className="text-sm font-semibold text-gray-300 mb-4">Aging Buckets</p>
            <div className="space-y-2">
              {BUCKETS.map(b => {
                const val = data.aging_summary?.[b.key] || 0;
                const width = data.total_ar_aed > 0 ? Math.max(2, val / data.total_ar_aed * 100) : 0;
                return (
                  <div key={b.key} className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-20 shrink-0">{b.label}</span>
                    <div className="flex-1 bg-gray-700 rounded-full h-2">
                      <div className={`${b.color} h-2 rounded-full transition-all`} style={{ width: `${width}%` }} />
                    </div>
                    <span className="text-xs text-white font-medium w-28 text-right">{fmt(val)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Customer table */}
          <div className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-700 text-sm font-semibold text-gray-300">Per-Customer Aging</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-700">
                    <th className="px-4 py-2 text-left">Customer</th>
                    <th className="px-4 py-2 text-right">Outstanding</th>
                    <th className="px-4 py-2 text-right">Max Days</th>
                    <th className="px-4 py-2 text-center">Risk</th>
                    <th className="px-4 py-2 text-left">Manager</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.customer_summary || []).map((c: any) => (
                    <>
                      <tr key={c.customer_name}
                        className="border-b border-gray-700/50 hover:bg-gray-700/30 cursor-pointer"
                        onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(c.customer_name) ? n.delete(c.customer_name) : n.add(c.customer_name); return n; })}>
                        <td className="px-4 py-2.5 font-medium text-white flex items-center gap-1">
                          {expanded.has(c.customer_name) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          {c.customer_name}
                        </td>
                        <td className="px-4 py-2.5 text-right text-white font-medium">{fmt(c.total_outstanding)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-300">{c.max_days_overdue}d</td>
                        <td className={`px-4 py-2.5 text-center font-semibold ${RISK_COLOR[c.risk_flag] || 'text-gray-400'}`}>{c.risk_flag}</td>
                        <td className="px-4 py-2.5 text-gray-400">{c.account_manager || '—'}</td>
                      </tr>
                      {expanded.has(c.customer_name) && (
                        <tr key={`${c.customer_name}-detail`} className="bg-gray-900/40 border-b border-gray-700/30">
                          <td colSpan={5} className="px-6 py-3">
                            <div className="grid grid-cols-3 gap-4 text-xs text-gray-400">
                              <div><span className="text-gray-500">Invoices:</span> {c.invoice_count}</div>
                              <div><span className="text-gray-500">Avg Pay Prob:</span> {c.avg_payment_prob?.toFixed(0)}%</div>
                              <div><span className="text-gray-500">Contact:</span> {c.contact_email || '—'}</div>
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

          <button onClick={() => setData(null)} className="text-xs text-gray-500 hover:text-gray-300">
            ← Upload new file
          </button>
        </>
      )}
    </div>
  );
}

// ── 2. Payment Prediction Tab ─────────────────────────────────────────────────

function PredictionTab() {
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const run = async (file: File) => {
    setLoading(true); setError('');
    const form = new FormData(); form.append('file', file);
    try {
      const r = await fetch(`${API}/api/ar/payment-prediction`, { method: 'POST', body: form });
      if (!r.ok) throw new Error(await r.text());
      setData(await r.json());
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      {!data && <FileDropzone onFile={run} label="Upload AR invoices for payment risk scoring" />}
      {loading && <div className="text-center py-10 text-teal-400 flex items-center justify-center gap-2"><RefreshCw size={16} className="animate-spin" /> Scoring payment risk…</div>}
      {error && <div className="bg-red-900/40 border border-red-700 rounded-lg p-3 text-sm text-red-300">{error}</div>}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'At Risk (High+Critical)', value: fmt(data.at_risk_amount_aed), color: 'text-red-400' },
              { label: 'At Risk Count',           value: `${data.at_risk_count} invoices`, color: 'text-orange-400' },
              { label: 'Expected 30-day Collect', value: fmt(data.expected_collection_30d), color: 'text-green-400' },
            ].map(k => (
              <div key={k.label} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
                <p className="text-xs text-gray-400">{k.label}</p>
                <p className={`text-lg font-bold mt-1 ${k.color}`}>{k.value}</p>
              </div>
            ))}
          </div>

          <div className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-700 text-sm font-semibold text-gray-300">Risk Scoring by Invoice</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-700">
                  <th className="px-4 py-2 text-left">Customer</th>
                  <th className="px-4 py-2 text-right">Outstanding</th>
                  <th className="px-4 py-2 text-right">Days Overdue</th>
                  <th className="px-4 py-2 text-center">Pay Probability</th>
                  <th className="px-4 py-2 text-center">Risk</th>
                  <th className="px-4 py-2 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {(data.predictions || []).map((p: any, i: number) => (
                  <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/20">
                    <td className="px-4 py-2.5 font-medium text-white">{p.customer_name}</td>
                    <td className="px-4 py-2.5 text-right">{fmt(p.outstanding_aed)}</td>
                    <td className="px-4 py-2.5 text-right">{p.days_overdue}d</td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-16 bg-gray-700 rounded-full h-1.5">
                          <div className="h-1.5 rounded-full" style={{ width: `${p.payment_probability_pct}%`, backgroundColor: p.payment_probability_pct > 70 ? '#22c55e' : p.payment_probability_pct > 40 ? '#f59e0b' : '#ef4444' }} />
                        </div>
                        <span className={RISK_COLOR[p.risk_level] || ''}>{p.payment_probability_pct}%</span>
                      </div>
                    </td>
                    <td className={`px-4 py-2.5 text-center font-semibold ${RISK_COLOR[p.risk_level]}`}>{p.risk_level}</td>
                    <td className="px-4 py-2.5 text-gray-400 max-w-[180px] truncate">{p.recommended_action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={() => setData(null)} className="text-xs text-gray-500 hover:text-gray-300">← Upload new file</button>
        </>
      )}
    </div>
  );
}

// ── 3. Dunning Email Tab ──────────────────────────────────────────────────────

function DunningTab() {
  const companyId = localStorage.getItem('active_company_id') ?? '';
  const [chaseResult, setChaseResult] = useState<string[] | null>(null);
  const [chaseLoading, setChaseLoading] = useState(false);

  const runChase = async () => {
    if (!companyId) return;
    setChaseLoading(true);
    try {
      const res = await runCollectionsDunning(companyId);
      setChaseResult(res.summary.length ? res.summary : [`No emails sent (${res.sent_count})`]);
    } catch (e: unknown) {
      setChaseResult([e instanceof Error ? e.message : 'Failed']);
    } finally {
      setChaseLoading(false);
    }
  };

  const [form, setForm] = useState({
    customer_name: 'ADNOC Digital PJSC',
    invoice_id: 'AR-2025-001',
    outstanding_aed: 925000,
    days_overdue: 33,
    contact_name: 'Mohammed Al Hammadi',
    our_company: 'Al Futtaim Digital Services',
    dunning_level: 1,
  });
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(`${API}/api/ar/dunning-email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error(await r.text());
      setResult(await r.json());
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  const inputCls = 'w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm';
  const labelCls = 'block text-xs text-gray-400 mb-1';

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-800/50 bg-amber-950/20 p-4">
        <h3 className="text-sm font-semibold text-amber-200 mb-2">Automated Collections Chase</h3>
        <p className="text-xs text-gray-400 mb-3">Send level 1–4 dunning emails to overdue AR invoices (max once per 7 days per invoice).</p>
        <button
          type="button"
          disabled={chaseLoading || !companyId}
          onClick={() => void runChase()}
          className="flex items-center gap-2 bg-amber-700 hover:bg-amber-600 px-4 py-2 rounded-lg text-sm disabled:opacity-50"
        >
          <Mail size={14} /> {chaseLoading ? 'Running…' : 'Run Collections Chase'}
        </button>
        {chaseResult && (
          <ul className="mt-3 text-xs text-gray-300 space-y-1">
            {chaseResult.map((line) => <li key={line}>• {line}</li>)}
          </ul>
        )}
      </div>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Form */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-300">Generate Dunning Email (draft)</h3>
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map(l => (
            <button key={l} onClick={() => setForm(f => ({ ...f, dunning_level: l }))}
              className={`py-2 rounded-lg text-xs font-medium transition-colors ${form.dunning_level === l
                ? l === 1 ? 'bg-green-700 text-white' : l === 2 ? 'bg-amber-700 text-white' : 'bg-red-700 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
              Level {l}: {l === 1 ? 'Polite' : l === 2 ? 'Firm' : 'Final Notice'}
            </button>
          ))}
        </div>
        {[
          { label: 'Customer Name', key: 'customer_name', type: 'text' },
          { label: 'Invoice ID',    key: 'invoice_id',    type: 'text' },
          { label: 'Outstanding (AED)', key: 'outstanding_aed', type: 'number' },
          { label: 'Days Overdue', key: 'days_overdue', type: 'number' },
          { label: 'Contact Name', key: 'contact_name', type: 'text' },
          { label: 'Our Company',  key: 'our_company',  type: 'text' },
        ].map(f => (
          <div key={f.key}>
            <label className={labelCls}>{f.label}</label>
            <input type={f.type} value={(form as any)[f.key]}
              onChange={e => setForm(p => ({ ...p, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value }))}
              className={inputCls} />
          </div>
        ))}
        <button onClick={generate} disabled={loading}
          className="w-full flex items-center justify-center gap-2 bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium">
          {loading ? <><RefreshCw size={14} className="animate-spin" /> Generating…</> : <><Mail size={14} /> Generate Email</>}
        </button>
        {error && <div className="text-red-400 text-xs">{error}</div>}
      </div>

      {/* Result */}
      <div>
        {result ? (
          <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${result.dunning_level === 1 ? 'bg-green-900 text-green-300' : result.dunning_level === 2 ? 'bg-amber-900 text-amber-300' : 'bg-red-900 text-red-300'}`}>
                {result.level_label}
              </span>
              <button onClick={() => { navigator.clipboard.writeText(`Subject: ${result.subject}\n\n${result.body}`); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                className="text-xs text-gray-400 hover:text-white flex items-center gap-1">
                <Download size={11} /> {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="bg-gray-900/60 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Subject:</p>
              <p className="text-sm font-medium text-white">{result.subject}</p>
            </div>
            <div className="bg-gray-900/60 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-2">Body:</p>
              <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">{result.body}</p>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-600 text-sm border-2 border-dashed border-gray-700 rounded-xl">
            Email preview will appear here
          </div>
        )}
      </div>
    </div>
    </div>
  );
}

// ── 4. Credit Limits Tab ──────────────────────────────────────────────────────

function CreditTab() {
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const run = async (file: File) => {
    setLoading(true); setError('');
    const form = new FormData(); form.append('file', file);
    try {
      const r = await fetch(`${API}/api/ar/credit-limits`, { method: 'POST', body: form });
      if (!r.ok) throw new Error(await r.text());
      setData(await r.json());
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      {!data && <FileDropzone onFile={run} label="Upload AR invoices for credit limit analysis" />}
      {loading && <div className="text-center py-10 text-teal-400 flex items-center justify-center gap-2"><RefreshCw size={16} className="animate-spin" /> Analysing credit limits…</div>}
      {error && <div className="bg-red-900/40 border border-red-700 rounded-lg p-3 text-sm text-red-300">{error}</div>}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total Credit Extended', value: fmt(data.total_credit_extended), color: 'text-blue-400' },
              { label: 'Total Utilised',        value: fmt(data.total_utilised),        color: 'text-amber-400' },
              { label: 'Overall Utilisation',   value: pct(data.overall_utilisation_pct), color: data.overall_utilisation_pct > 80 ? 'text-red-400' : 'text-green-400' },
            ].map(k => (
              <div key={k.label} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
                <p className="text-xs text-gray-400">{k.label}</p>
                <p className={`text-lg font-bold mt-1 ${k.color}`}>{k.value}</p>
              </div>
            ))}
          </div>
          {(data.exceeded_count > 0 || data.warning_count > 0) && (
            <div className="bg-red-900/20 border border-red-700/40 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-semibold text-red-300">{data.exceeded_count} customers exceeded credit limit · {data.warning_count} in warning zone (&gt;80%)</p>
                <p className="text-gray-400 text-xs mt-1">Review credit terms before issuing new invoices to flagged accounts.</p>
              </div>
            </div>
          )}
          <div className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-700">
                  <th className="px-4 py-2 text-left">Customer</th>
                  <th className="px-4 py-2 text-right">Outstanding</th>
                  <th className="px-4 py-2 text-right">Credit Limit</th>
                  <th className="px-4 py-2 text-right">Utilisation</th>
                  <th className="px-4 py-2 text-right">Available</th>
                  <th className="px-4 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {(data.credit_summary || []).sort((a: any, b: any) => b.utilisation_pct - a.utilisation_pct).map((c: any, i: number) => (
                  <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/20">
                    <td className="px-4 py-2.5 font-medium text-white">{c.customer_name}</td>
                    <td className="px-4 py-2.5 text-right">{fmt(c.total_outstanding)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-400">{fmt(c.credit_limit)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={c.utilisation_pct > 80 ? 'text-red-400 font-bold' : c.utilisation_pct > 60 ? 'text-amber-400' : 'text-green-400'}>
                        {pct(c.utilisation_pct)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-400">{fmt(Math.max(0, c.available_credit))}</td>
                    <td className={`px-4 py-2.5 text-center text-xs font-semibold ${RISK_COLOR[c.credit_status] || ''}`}>{c.credit_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={() => setData(null)} className="text-xs text-gray-500 hover:text-gray-300">← Upload new file</button>
        </>
      )}
    </div>
  );
}

// ── 5. AR-Bank Recon Tab ──────────────────────────────────────────────────────

function ReconTab() {
  const [arFile, setArFile]     = useState<File | null>(null);
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [data, setData]         = useState<any>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const run = async () => {
    if (!arFile || !bankFile) return;
    setLoading(true); setError('');
    const form = new FormData();
    form.append('file_ar', arFile);
    form.append('file_bank', bankFile);
    try {
      const r = await fetch(`${API}/api/ar/ar-bank-recon`, { method: 'POST', body: form });
      if (!r.ok) throw new Error(await r.text());
      setData(await r.json());
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <div className="space-y-5">
      {!data && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <FileDropzone onFile={setArFile}   label={arFile   ? `✅ ${arFile.name}`   : 'Upload AR Invoices CSV'} />
            <FileDropzone onFile={setBankFile} label={bankFile ? `✅ ${bankFile.name}` : 'Upload Bank Statement CSV'} secondary />
          </div>
          <button onClick={run} disabled={!arFile || !bankFile || loading}
            className="w-full flex items-center justify-center gap-2 bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white py-3 rounded-xl font-medium">
            {loading ? <><RefreshCw size={14} className="animate-spin" /> Matching…</> : <><CheckCircle size={14} /> Run AR-Bank Reconciliation</>}
          </button>
          {error && <div className="text-red-400 text-sm">{error}</div>}
        </>
      )}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Matched',          value: `${data.matched_count} (${fmt(data.matched_amount)})`, color: 'text-green-400' },
              { label: 'Unmatched AR',     value: `${data.unmatched_ar?.length} items`,  color: 'text-amber-400' },
              { label: 'Recon Rate',       value: pct(data.reconciliation_rate_pct), color: data.reconciliation_rate_pct > 90 ? 'text-green-400' : 'text-red-400' },
            ].map(k => (
              <div key={k.label} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
                <p className="text-xs text-gray-400">{k.label}</p>
                <p className={`text-lg font-bold mt-1 ${k.color}`}>{k.value}</p>
              </div>
            ))}
          </div>
          {data.matched?.length > 0 && (
            <div className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
              <div className="px-4 py-2 border-b border-gray-700 text-xs font-semibold text-green-400">✅ Matched ({data.matched.length})</div>
              <table className="w-full text-xs"><thead><tr className="text-gray-500 border-b border-gray-700">
                <th className="px-3 py-2 text-left">Invoice</th><th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-right">AR Amount</th><th className="px-3 py-2 text-right">Bank Amount</th>
                <th className="px-3 py-2 text-center">Type</th><th className="px-3 py-2 text-left">Bank Ref</th>
              </tr></thead><tbody>
                {data.matched.map((m: any, i: number) => (
                  <tr key={i} className="border-b border-gray-700/40 hover:bg-gray-700/20">
                    <td className="px-3 py-2 text-gray-300">{m.invoice_id}</td><td className="px-3 py-2 text-white">{m.customer}</td>
                    <td className="px-3 py-2 text-right text-green-400">{fmt(m.ar_amount)}</td>
                    <td className="px-3 py-2 text-right">{fmt(m.bank_amount)}</td>
                    <td className="px-3 py-2 text-center text-xs">{m.match_type}</td>
                    <td className="px-3 py-2 text-gray-500 font-mono text-[10px]">{m.bank_ref}</td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          )}
          {data.unmatched_ar?.length > 0 && (
            <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl p-4">
              <p className="text-xs font-semibold text-amber-400 mb-2">⚠️ Unmatched in AR ({data.unmatched_ar.length})</p>
              {data.unmatched_ar.map((u: any, i: number) => (
                <div key={i} className="text-xs text-gray-300 py-1 border-b border-amber-900/30 last:border-0">
                  {u.invoice_id} · {u.customer} · {fmt(u.amount)} — {u.issue}
                </div>
              ))}
            </div>
          )}
          <button onClick={() => { setData(null); setArFile(null); setBankFile(null); }} className="text-xs text-gray-500 hover:text-gray-300">← New reconciliation</button>
        </>
      )}
    </div>
  );
}

// ── 6. AI Insight Tab ─────────────────────────────────────────────────────────

function InsightTab() {
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const run = async (file: File) => {
    setLoading(true); setError('');
    const form = new FormData(); form.append('file', file);
    try {
      const r = await fetch(`${API}/api/ar/ai-dunning-insight`, { method: 'POST', body: form });
      if (!r.ok) throw new Error(await r.text());
      setData(await r.json());
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <div className="space-y-5">
      {!data && <FileDropzone onFile={run} label="Upload AR invoices for Claude AI portfolio analysis" />}
      {loading && (
        <div className="text-center py-16 space-y-3">
          <RefreshCw size={24} className="animate-spin text-teal-400 mx-auto" />
          <p className="text-teal-400">Claude AI is analysing your AR portfolio…</p>
          <p className="text-gray-500 text-sm">Identifying top priority, cash forecast, and collection strategy</p>
        </div>
      )}
      {error && <div className="bg-red-900/40 border border-red-700 rounded-lg p-3 text-sm text-red-300">{error}</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
              <p className="text-xs text-gray-400">Total AR Analysed</p>
              <p className="text-xl font-bold text-white mt-1">{fmt(data.total_ar_aed)}</p>
            </div>
            <div className="bg-red-900/20 border border-red-700/40 rounded-xl p-4">
              <p className="text-xs text-gray-400">Critical (60+ days) · {data.critical_accounts} accounts</p>
              <p className="text-xl font-bold text-red-400 mt-1">{fmt(data.critical_amount_aed)}</p>
            </div>
          </div>

          <div className="bg-gradient-to-br from-teal-900/20 to-blue-900/20 border border-teal-700/40 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Zap size={16} className="text-teal-400" />
              <h3 className="text-sm font-bold text-white">Claude AI Collection Intelligence</h3>
            </div>
            <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{data.ai_insight}</div>
          </div>

          <button onClick={() => setData(null)} className="text-xs text-gray-500 hover:text-gray-300">← Upload new file</button>
        </>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ARCollectionsEnhanced() {
  const [tab, setTab] = useState<Tab>('aging');

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <BarChart2 size={24} className="text-teal-400" /> AR Collections
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Aging · Payment Prediction · Dunning Emails · Credit Limits · Bank Recon · AI Insight
          </p>
        </div>
        <a href="/cfo" className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300">
          <ArrowLeft size={12} /> Back to CFO
        </a>
      </div>

      {/* Tab strip */}
      <div className="flex gap-1 mb-6 bg-gray-800/40 border border-gray-700 rounded-xl p-1 overflow-x-auto">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors
                ${tab === t.id ? 'bg-teal-700 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'}`}>
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="max-w-5xl">
        {tab === 'aging'      && <AgingTab />}
        {tab === 'prediction' && <PredictionTab />}
        {tab === 'dunning'    && <DunningTab />}
        {tab === 'credit'     && <CreditTab />}
        {tab === 'recon'      && <ReconTab />}
        {tab === 'insight'    && <InsightTab />}
      </div>
    </div>
  );
}
