import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Download, Loader2, Play, Upload } from 'lucide-react';
import axios from 'axios';
import { ifrsService } from '../../services/ifrs.service';
import { postCfoAgentRun } from '../../services/cfoAgents';
import { useClient } from '../../context/ClientContext';

const API_BASE = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || 'http://localhost:8000';
const AGENTIC = `${API_BASE.replace(/\/$/, '')}/api/ifrs/agentic`;
const TENANT = (import.meta.env.VITE_TENANT_ID && String(import.meta.env.VITE_TENANT_ID).trim()) || 'default';

const PIPELINE = ['NEXUS', 'MAPPER', 'BUILDER', 'AUDITOR', 'FIXER', 'SCRIBE', 'NARRATOR', 'PACKAGER'] as const;

type StatusPayload = {
  run_id: string;
  status: string;
  current_agent: string | null;
  progress_pct: number;
  agents_completed: string[];
  logs: { agent_id: string; message: string; ts: string }[];
  validation_results: { check_name: string; passed: boolean; error: string | null }[];
  human_review_items: { id: number; item: string; status: string; resolution: string | null }[];
  pause_reason?: string | null;
  resume_from_agent?: string | null;
  error_message?: string | null;
  estimated_seconds_remaining?: number | null;
};

type OutputPayload = {
  statements: unknown;
  notes: unknown;
  commentary: unknown;
  exports: { xlsx_url: string; docx_url: string; pdf_url: string };
};

function wsUrlFor(runId: string) {
  const base = API_BASE.replace(/^http/, 'ws').replace(/\/$/, '');
  return `${base}/api/ifrs/agentic/${runId}/stream?tenant_id=${encodeURIComponent(TENANT)}`;
}

export default function AgenticGenerator() {
  const { activeClient } = useClient();
  const tenantId = activeClient?.companyId || TENANT;

  const [file, setFile] = useState<File | null>(null);
  const [tbId, setTbId] = useState<number | null>(null);
  const [priorTbId, setPriorTbId] = useState<string>('');
  const [manualPriorJson, setManualPriorJson] = useState<string>('');
  const [multiYearResult, setMultiYearResult] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [output, setOutput] = useState<OutputPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const fetchStatus = useCallback(async (id: string) => {
    const { data } = await axios.get<StatusPayload>(`${AGENTIC}/${id}/status`, { headers: hdr() });
    setStatus(data);
    return data;
  }, [hdr]);

  useEffect(() => {
    if (!runId) return;
    const tick = async () => {
      try {
        const s = await fetchStatus(runId);
        if (s.status === 'completed') {
          const { data } = await axios.get<OutputPayload>(`${AGENTIC}/${runId}/output`, { headers: hdr() });
          setOutput(data);
        }
      } catch {
        /* ignore poll errors */
      }
    };
    tick();
    const iv = window.setInterval(tick, 2000);
    return () => window.clearInterval(iv);
  }, [runId, fetchStatus]);

  useEffect(() => {
    if (!runId || !status) return;
    if (status.status !== 'running' && status.status !== 'started') {
      wsRef.current?.close();
      wsRef.current = null;
      return;
    }
    const ws = new WebSocket(getWsUrl(runId));
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      try {
        const j = JSON.parse(ev.data as string);
        if (j.agent_id && j.message) {
          setStatus((prev) => {
            if (!prev) return prev;
            const next = [...prev.logs, { agent_id: j.agent_id, message: j.message, ts: j.ts || '' }];
            return { ...prev, logs: next.slice(-50) };
          });
        }
        if (j.heartbeat) {
          setStatus((prev) =>
            prev
              ? {
                  ...prev,
                  status: j.status,
                  progress_pct: j.progress_pct,
                  current_agent: j.current_agent,
                }
              : prev
          );
        }
      } catch {
        /* ignore */
      }
    };
    ws.onerror = () => {};
    return () => {
      ws.close();
    };
  }, [runId, status?.status, getWsUrl]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [status?.logs]);

  async function onUpload() {
    if (!file) {
      toast.error('Choose a trial balance file first.');
      return;
    }
    setUploading(true);
    try {
      const res = await ifrsService.uploadTrialBalance(file, 'Agentic IFRS');
      setTbId(res.trial_balance_id);
      toast.success(`Uploaded TB #${res.trial_balance_id}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function onUploadMultiYear() {
    if (!file) {
      toast.error('Choose a file with a Year / FY column.');
      return;
    }
    setUploading(true);
    setMultiYearResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('company_name', 'Multi-year IFRS');
      const { data } = await axios.post<{ trial_balances: { fiscal_year: number; trial_balance_id: number }[]; message?: string }>(
        `${AGENTIC}/upload-trial-balance-multi-year`,
        fd,
        { headers: hdr() }
      );
      const ids = (data.trial_balances || []).map((t) => `${t.fiscal_year}: TB#${t.trial_balance_id}`).join(' · ');
      setMultiYearResult(ids || JSON.stringify(data));
      const latest = data.trial_balances?.[data.trial_balances.length - 1];
      if (latest) setTbId(latest.trial_balance_id);
      toast.success(data.message || 'Multi-year TBs created');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Multi-year upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function onStart() {
    if (!tbId) {
      toast.error('Upload a trial balance first.');
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { trial_balance_id: tbId };
      const p = priorTbId.trim();
      if (p) {
        const n = parseInt(p, 10);
        if (!Number.isFinite(n) || n < 1) {
          toast.error('Prior trial balance id must be a positive integer.');
          setBusy(false);
          return;
        }
        body.prior_trial_balance_id = n;
      }
      if (manualPriorJson.trim()) {
        try {
          body.manual_prior = JSON.parse(manualPriorJson) as Record<string, unknown>;
        } catch {
          toast.error('manual_prior must be valid JSON (e.g. {"revenue":11380000,"retained_earnings_closing":...}).');
          setBusy(false);
          return;
        }
      }
      const { data } = await axios.post<{ run_id: string; status: string }>(
        `${AGENTIC}/start`,
        body,
        { headers: { ...hdr(), 'Content-Type': 'application/json' } }
      );
      setRunId(data.run_id);
      setOutput(null);
      toast.success('Agent run started');
      void postCfoAgentRun(
        'ifrs',
        {
          trial_balance_id: tbId,
          ifrs_run_id: data.run_id,
          prior_trial_balance_id: body.prior_trial_balance_id,
          manual_prior: body.manual_prior,
          period: String(new Date().getFullYear()),
          company_id: tenantId,
          defer_ifrs_execute: true,
        },
        tenantId
      ).catch(() => {});
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Start failed');
    } finally {
      setBusy(false);
    }
  }

  async function onContinue() {
    if (!runId) return;
    setBusy(true);
    try {
      await axios.post(
        `${AGENTIC}/${runId}/human-input`,
        {
          action: 'continue',
          resume_from: status?.resume_from_agent || 'BUILDER',
          review_ids: [],
        },
        { headers: { ...hdr(), 'Content-Type': 'application/json' } }
      );
      toast.success('Resume queued');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Continue failed');
    } finally {
      setBusy(false);
    }
  }

  const lastLogs = (status?.logs || []).slice(-5);
  const completed = new Set(status?.agents_completed || []);

  function agentIcon(agent: string) {
    if (status?.current_agent === agent) return '🔄';
    if (completed.has(agent)) return '✅';
    if (status?.status === 'failed') return '❌';
    return '⏳';
  }

  const dl = (kind: 'xlsx' | 'docx' | 'pdf') => {
    if (!runId || !output?.exports) return;
    const path = output.exports[`${kind}_url` as keyof typeof output.exports] as string;
    const url = `${API_BASE.replace(/\/$/, '')}${path}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-slate-100">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/dashboard" className="text-slate-400 hover:text-white inline-flex items-center gap-1 text-sm">
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </Link>
          <span className="text-slate-600">/</span>
          <span className="text-indigo-300 font-medium">AI IFRS Generator</span>
          <span className="ml-2 px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-xs font-semibold border border-amber-500/40">
            AGENTIC
          </span>
        </div>

        <h1 className="text-2xl font-bold text-white mb-2">Multi-Agent IFRS Statement Generator</h1>
        <p className="text-slate-400 text-sm mb-8">
          NEXUS orchestrates MAPPER → BUILDER → AUDITOR → FIXER → SCRIBE → NARRATOR → PACKAGER on top of your existing Week 1–2
          pipeline.
        </p>

        <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6 space-y-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-300 mb-2">1. Upload trial balance</h2>
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-600 rounded-xl p-6 cursor-pointer hover:border-indigo-500/50">
              <Upload className="w-8 h-8 text-slate-500 mb-2" />
              <span className="text-sm text-slate-400">{file ? file.name : 'Click to select CSV / Excel'}</span>
              <input
                type="file"
                className="hidden"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
            <button
              type="button"
              disabled={!file || uploading}
              onClick={onUpload}
              className="mt-3 w-full py-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-sm font-medium"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin inline" /> : null} Upload to Week 1 API
            </button>
            {tbId != null && <p className="mt-2 text-xs text-emerald-400">Trial balance id: {tbId}</p>}
            <button
              type="button"
              disabled={!file || uploading}
              onClick={onUploadMultiYear}
              className="mt-2 w-full py-2 rounded-lg border border-indigo-500/40 text-indigo-200 hover:bg-indigo-500/10 text-sm"
            >
              Upload multi-year TB (requires Year / FY column)
            </button>
            {multiYearResult && (
              <p className="mt-2 text-xs text-slate-400 break-all">Created: {multiYearResult}</p>
            )}
          </div>

          <div className="rounded-lg border border-slate-700/80 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-300">IAS 1 comparatives (optional)</h2>
            <p className="text-xs text-slate-500">
              Leave blank to auto-resolve prior year from the financial vault or the latest prior TB for this company.
              Or set explicit prior TB id / manual JSON totals (Option C).
            </p>
            <label className="block text-xs text-slate-400">
              Prior trial balance id
              <input
                type="text"
                inputMode="numeric"
                value={priorTbId}
                onChange={(e) => setPriorTbId(e.target.value)}
                placeholder="e.g. 42"
                className="mt-1 w-full rounded bg-slate-950 border border-slate-600 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs text-slate-400">
              Manual prior totals (JSON)
              <textarea
                value={manualPriorJson}
                onChange={(e) => setManualPriorJson(e.target.value)}
                placeholder='{"revenue":11380000,"total_assets":18200000,"total_equity":5000000,"cash":980000,"retained_earnings_closing":1200000}'
                rows={3}
                className="mt-1 w-full rounded bg-slate-950 border border-slate-600 px-2 py-1.5 text-xs font-mono"
              />
            </label>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-slate-300 mb-2">2. Start agent run</h2>
            <button
              type="button"
              disabled={!tbId || busy}
              onClick={onStart}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 font-semibold inline-flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4" />
              Start agent run
            </button>
            {runId && <p className="mt-2 text-xs text-slate-500 break-all">run_id: {runId}</p>}
          </div>

          {status && (
            <div>
              <h2 className="text-sm font-semibold text-slate-300 mb-2">Progress</h2>
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span>{status.status}</span>
                <span>
                  {Math.round(status.progress_pct || 0)}%
                  {status.estimated_seconds_remaining != null
                    ? ` · ~${status.estimated_seconds_remaining}s left`
                    : ''}
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-indigo-500 transition-all duration-500"
                  style={{ width: `${Math.min(100, status.progress_pct || 0)}%` }}
                />
              </div>

              <ul className="mt-4 space-y-1 text-sm">
                {PIPELINE.map((a) => (
                  <li key={a} className="flex items-center gap-2 text-slate-300">
                    <span>{agentIcon(a)}</span>
                    <span>{a}</span>
                  </li>
                ))}
              </ul>

              <div ref={logRef} className="mt-4 max-h-32 overflow-y-auto rounded-lg bg-black/30 p-3 text-xs font-mono text-slate-400 space-y-1">
                {lastLogs.length === 0 && <span className="text-slate-600">No log lines yet…</span>}
                {lastLogs.map((l, i) => (
                  <div key={`${l.ts}-${i}`}>
                    <span className="text-indigo-400">{l.agent_id}</span> {l.message}
                  </div>
                ))}
              </div>

              {status.human_review_items?.length > 0 && (
                <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <p className="text-xs font-semibold text-amber-200 mb-2">Human review</p>
                  <ul className="text-xs text-amber-100/90 space-y-2">
                    {status.human_review_items.map((h) => (
                      <li key={h.id}>
                        <span className="text-slate-500">#{h.id}</span> {h.item}{' '}
                        <span className="text-slate-500">({h.status})</span>
                      </li>
                    ))}
                  </ul>
                  {status.status === 'paused' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={onContinue}
                      className="mt-3 text-xs px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white"
                    >
                      Continue after resolution
                    </button>
                  )}
                </div>
              )}

              {status.error_message && (
                <p className="mt-3 text-xs text-red-400 whitespace-pre-wrap">{status.error_message}</p>
              )}
            </div>
          )}

          {output?.exports && (
            <div>
              <h2 className="text-sm font-semibold text-slate-300 mb-2">Downloads</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => dl('xlsx')}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-700/80 hover:bg-emerald-600 text-sm"
                >
                  <Download className="w-4 h-4" /> Excel
                </button>
                <button
                  type="button"
                  onClick={() => dl('docx')}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm"
                >
                  <Download className="w-4 h-4" /> Notes
                </button>
                <button
                  type="button"
                  onClick={() => dl('pdf')}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-900/60 hover:bg-red-800/60 text-sm"
                >
                  <Download className="w-4 h-4" /> PDF pack
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="mt-6 text-xs text-slate-600">
          API: {AGENTIC}/start · Poll /status every 2s · WebSocket /stream for live logs.
        </p>
      </div>
    </div>
  );
}
