import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const API_BASE = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).replace(/\/$/, '')) || '';

type AgentKey =
  | 'evidence-collector'
  | 'ifrs-checker'
  | 'controls-tester'
  | 'sox-checker'
  | 'aml-monitor';

type AuditRunRow = {
  id: number;
  agent_type: string;
  client_name: string | null;
  file_name: string | null;
  run_timestamp: string | null;
  result_summary: string | null;
};

type EvidencePatternEntry = {
  date: string;
  account: string;
  amount: number;
  description: string;
  reference: string;
  flag_reason: string;
};

type EvidencePattern = {
  pattern_type: string;
  entries_affected: number;
  total_value: number;
  risk_level: string;
  description: string;
  entries: EvidencePatternEntry[];
};

type EvidenceRequired = {
  priority: number;
  entry_reference: string;
  amount: number;
  risk_level: string;
  pattern_detected: string;
  evidence_needed: string;
  isa_reference: string;
  status: string;
};

type FraudRisk = {
  fraud_risk_level: string;
  indicators_found: string[];
  recommended_procedures: string[];
};

type EvidenceResult = {
  audit_summary?: {
    total_entries_analysed?: number;
    patterns_detected?: number;
    high_risk_entries?: number;
    medium_risk_entries?: number;
    fraud_indicators?: number;
    audit_risk_rating?: string;
  };
  r2r_patterns_found?: EvidencePattern[];
  audit_evidence_required?: EvidenceRequired[];
  fraud_risk_assessment?: FraudRisk;
  auditor_findings?: string;
  management_letter_points?: string[];
};

type AuditEvidenceResult = {
  audit_summary?: {
    total_entries_analysed?: number;
    patterns_detected?: number;
    high_risk_entries?: number;
    medium_risk_entries?: number;
    fraud_indicators?: number;
    audit_risk_rating?: string;
  };
  r2r_patterns_found?: Array<{
    pattern_type?: string;
    entries_affected?: number;
    total_value?: number;
    risk_level?: string;
    description?: string;
    entries?: Array<{
      date?: string;
      account?: string;
      amount?: number;
      description?: string;
      reference?: string;
      flag_reason?: string;
    }>;
  }>;
  audit_evidence_required?: Array<{
    priority?: number;
    entry_reference?: string;
    amount?: number;
    risk_level?: string;
    pattern_detected?: string;
    evidence_needed?: string;
    isa_reference?: string;
    status?: string;
  }>;
  fraud_risk_assessment?: {
    fraud_risk_level?: string;
    indicators_found?: string[];
    recommended_procedures?: string[];
  };
  auditor_findings?: string;
  management_letter_points?: string[];
  _error?: string;
  message?: string;
};

const AGENTS: {
  key: AgentKey;
  icon: string;
  title: string;
  description: string;
  anchor: string;
}[] = [
  {
    key: 'evidence-collector',
    icon: '🔍',
    title: 'Audit Evidence Collection Agent',
    description: 'ISA 530 risk-based sampling and high-risk transaction selection from GL/transaction CSV.',
    anchor: 'evidence',
  },
  {
    key: 'ifrs-checker',
    icon: '📋',
    title: 'IFRS Compliance Checker Agent',
    description: 'Disclosure and measurement checks against IFRS 9 / 15 / 16, IAS 36 / 37.',
    anchor: 'ifrs',
  },
  {
    key: 'controls-tester',
    icon: '🛡️',
    title: 'Internal Controls Testing Agent',
    description: 'COSO-based assessment from process narratives — gaps, ratings, and actions.',
    anchor: 'controls',
  },
  {
    key: 'sox-checker',
    icon: '⚖️',
    title: 'SOX Compliance Checker Agent',
    description: 'Classify deficiencies and opinion from control testing results (302 / 404).',
    anchor: 'sox',
  },
  {
    key: 'aml-monitor',
    icon: '🚨',
    title: 'AML Transaction Monitor Agent',
    description: 'FATF-style red flags, risk scores, and SAR suggestions from transaction CSV.',
    anchor: 'aml',
  },
];

function pdfUrl(runId: number) {
  return `${API_BASE}/api/audit/runs/${runId}/pdf`;
}

function evidenceChecklistUrl(runId: number) {
  return `${API_BASE}/api/audit/runs/${runId}/evidence-checklist.xlsx`;
}

function managementLetterUrl(runId: number) {
  return `${API_BASE}/api/audit/runs/${runId}/management-letter.docx`;
}

const cardBase =
  'rounded-xl border border-[#1e293b] bg-[#141B2D] p-6 transition-colors hover:border-[#F5A623]';
const labelCls = 'block text-xs font-medium text-slate-400 mb-1';
const inputCls =
  'w-full rounded-lg border border-slate-600 bg-[#0A0F1E] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500';
const btnPrimary =
  'rounded-lg bg-[#F5A623] px-4 py-2 text-sm font-semibold text-[#0A0F1E] hover:bg-[#ffb03d] disabled:opacity-50';
const btnGhost = 'rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:border-[#F5A623]';

const badgeRisk = (risk: string) => {
  const r = String(risk || '').toLowerCase();
  if (r.includes('critical') || r.includes('high')) return 'bg-red-500/20 text-red-300 ring-1 ring-red-400/40';
  if (r.includes('medium') || r.includes('amber')) return 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/40';
  return 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40';
};

export default function AuditIntelligencePage() {
  const [histories, setHistories] = useState<Record<AgentKey, AuditRunRow[]>>({
    'evidence-collector': [],
    'ifrs-checker': [],
    'controls-tester': [],
    'sox-checker': [],
    'aml-monitor': [],
  });
  const [loadingMap, setLoadingMap] = useState<Record<AgentKey, boolean>>({
    'evidence-collector': false,
    'ifrs-checker': false,
    'controls-tester': false,
    'sox-checker': false,
    'aml-monitor': false,
  });
  const [resultMap, setResultMap] = useState<Record<AgentKey, { run_id: number; result: unknown } | null>>({
    'evidence-collector': null,
    'ifrs-checker': null,
    'controls-tester': null,
    'sox-checker': null,
    'aml-monitor': null,
  });

  const refreshHistories = useCallback(async () => {
    const entries = await Promise.all(
      AGENTS.map(async (a) => {
        const r = await fetch(`${API_BASE}/api/audit/runs?agent_type=${encodeURIComponent(a.key)}&limit=15`);
        const j = await r.json();
        return [a.key, j.runs || []] as const;
      })
    );
    setHistories(Object.fromEntries(entries) as Record<AgentKey, AuditRunRow[]>);
  }, []);

  useEffect(() => {
    refreshHistories();
  }, [refreshHistories]);

  const setBusy = (k: AgentKey, v: boolean) =>
    setLoadingMap((m) => ({ ...m, [k]: v }));

  const lastBadge = (k: AgentKey) => {
    const first = histories[k][0];
    if (!first?.run_timestamp) return 'No runs yet';
    const d = new Date(first.run_timestamp);
    return `Last run: ${d.toLocaleString()}`;
  };

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="flex min-h-screen w-full bg-[#0A0F1E] text-slate-100">
      <aside className="w-56 shrink-0 border-r border-[#1e293b] bg-[#0d1424] py-6 px-3">
        <Link to="/dashboard" className="mb-6 block px-2 text-xs text-[#F5A623] hover:underline">
          ← FinReport AI
        </Link>
        <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Audit Intelligence</p>
        <nav className="mt-3 flex flex-col gap-0.5" aria-label="Audit agents">
          {AGENTS.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => scrollTo(`agent-${a.anchor}`)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-300 transition-colors hover:bg-[#141B2D] hover:text-[#F5A623]"
            >
              <span aria-hidden>{a.icon}</span>
              <span className="truncate">{a.title.replace(' Agent', '')}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <header className="border-b border-[#1e293b] px-8 py-6">
          <h1 className="text-2xl font-bold text-white">Audit Intelligence</h1>
          <p className="mt-1 text-sm text-slate-400">
            Five Claude-powered agents for evidence, IFRS, controls, SOX, and AML — with PDF export and run history.
          </p>
        </header>

        <div className="px-8 py-8 space-y-12 max-w-5xl">
          {/* Top grid of cards */}
          <section aria-label="Agent overview">
            <h2 className="sr-only">Agents</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {AGENTS.map((a) => (
                <div key={a.key} className={cardBase}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-2xl" aria-hidden>
                      {a.icon}
                    </span>
                    <span className="rounded-full bg-[#0A0F1E] px-2 py-0.5 text-[10px] text-[#F5A623] ring-1 ring-[#F5A623]/40">
                      {lastBadge(a.key)}
                    </span>
                  </div>
                  <h3 className="mt-2 font-semibold text-white">{a.title}</h3>
                  <p className="mt-1 text-xs text-slate-400 leading-relaxed">{a.description}</p>
                  <button
                    type="button"
                    onClick={() => scrollTo(`agent-${a.anchor}`)}
                    className={`mt-4 w-full ${btnPrimary}`}
                  >
                    Run Agent
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Evidence */}
          <section id="agent-evidence" className="scroll-mt-6 space-y-4">
            <h2 className="text-lg font-semibold text-[#F5A623]">🔍 Audit Evidence Collection Agent</h2>
            <form
              className={`space-y-3 ${cardBase}`}
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy('evidence-collector', true);
                try {
                  const fd = new FormData(e.currentTarget);
                  const r = await fetch(`${API_BASE}/api/audit/evidence-collector`, { method: 'POST', body: fd });
                  const j = await r.json();
                  if (!r.ok) throw new Error(j.detail || r.statusText);
                  setResultMap((m) => ({ ...m, 'evidence-collector': { run_id: j.run_id, result: j.result } }));
                  await refreshHistories();
                } catch (err) {
                  setResultMap((m) => ({
                    ...m,
                    'evidence-collector': {
                      run_id: 0,
                      result: { _error: 'request_failed', message: String(err) },
                    },
                  }));
                } finally {
                  setBusy('evidence-collector', false);
                }
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Client Name</label>
                  <input name="client_name" className={inputCls} placeholder="e.g. Demo Co" required />
                </div>
                <div>
                  <label className={labelCls}>Upload JE / Trial Balance CSV</label>
                  <input name="file" type="file" accept=".csv,.xlsx,.xls" required className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Accounting period start</label>
                  <input name="audit_period_start" type="date" required className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Accounting period end</label>
                  <input name="audit_period_end" type="date" required className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Materiality threshold (amount)</label>
                  <input name="materiality_threshold" type="number" min="0" step="0.01" defaultValue={0} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Authorisation limit (amount)</label>
                  <input name="authorisation_limit" type="number" min="0" step="0.01" defaultValue={0} className={inputCls} />
                </div>
              </div>
              <button type="submit" className={btnPrimary} disabled={loadingMap['evidence-collector']}>
                {loadingMap['evidence-collector'] ? 'Running…' : 'Run R2R Audit Analysis'}
              </button>
            </form>
            <AuditEvidenceDashboard data={resultMap['evidence-collector']} />
            <HistoryTable rows={histories['evidence-collector']} />
          </section>

          {/* IFRS */}
          <section id="agent-ifrs" className="scroll-mt-6 space-y-4">
            <h2 className="text-lg font-semibold text-[#F5A623]">📋 IFRS Compliance Checker Agent</h2>
            <form
              className={`space-y-3 ${cardBase}`}
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy('ifrs-checker', true);
                try {
                  const fd = new FormData(e.currentTarget);
                  const r = await fetch(`${API_BASE}/api/audit/ifrs-checker`, { method: 'POST', body: fd });
                  const j = await r.json();
                  if (!r.ok) throw new Error(j.detail || r.statusText);
                  setResultMap((m) => ({ ...m, 'ifrs-checker': { run_id: j.run_id, result: j.result } }));
                  await refreshHistories();
                } catch (err) {
                  setResultMap((m) => ({
                    ...m,
                    'ifrs-checker': { run_id: 0, result: { _error: 'request_failed', message: String(err) } },
                  }));
                } finally {
                  setBusy('ifrs-checker', false);
                }
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Client name (optional)</label>
                  <input name="client_name" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>IFRS standard</label>
                  <select name="ifrs_standard" className={inputCls} required>
                    <option value="IFRS 9">IFRS 9</option>
                    <option value="IFRS 15">IFRS 15</option>
                    <option value="IFRS 16">IFRS 16</option>
                    <option value="IAS 36">IAS 36</option>
                    <option value="IAS 37">IAS 37</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Entity type</label>
                  <select name="entity_type" className={inputCls} required>
                    <option value="Listed">Listed</option>
                    <option value="SME">SME</option>
                    <option value="Group">Group</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Financial statements file (optional)</label>
                  <input name="file" type="file" accept=".csv,.xlsx,.xls,.txt" className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Or paste financial statement text</label>
                <textarea name="financial_text" className={`${inputCls} min-h-[120px]`} placeholder="Notes, disclosures, or statement excerpts…" />
              </div>
              <p className="text-xs text-slate-500">Provide a file and/or text above.</p>
              <button type="submit" className={btnPrimary} disabled={loadingMap['ifrs-checker']}>
                {loadingMap['ifrs-checker'] ? 'Running…' : 'Run Agent'}
              </button>
            </form>
            <AgentResult data={resultMap['ifrs-checker']} />
            <HistoryTable rows={histories['ifrs-checker']} />
          </section>

          {/* Controls */}
          <section id="agent-controls" className="scroll-mt-6 space-y-4">
            <h2 className="text-lg font-semibold text-[#F5A623]">🛡️ Internal Controls Testing Agent</h2>
            <form
              className={`space-y-3 ${cardBase}`}
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy('controls-tester', true);
                try {
                  const fd = new FormData(e.currentTarget);
                  const r = await fetch(`${API_BASE}/api/audit/controls-tester`, { method: 'POST', body: fd });
                  const j = await r.json();
                  if (!r.ok) throw new Error(j.detail || r.statusText);
                  setResultMap((m) => ({ ...m, 'controls-tester': { run_id: j.run_id, result: j.result } }));
                  await refreshHistories();
                } catch (err) {
                  setResultMap((m) => ({
                    ...m,
                    'controls-tester': { run_id: 0, result: { _error: 'request_failed', message: String(err) } },
                  }));
                } finally {
                  setBusy('controls-tester', false);
                }
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Client name (optional)</label>
                  <input name="client_name" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Control type</label>
                  <select name="control_type" className={inputCls} required>
                    <option value="AP">AP</option>
                    <option value="AR">AR</option>
                    <option value="Payroll">Payroll</option>
                    <option value="Revenue">Revenue</option>
                    <option value="Fixed Assets">Fixed Assets</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Company size</label>
                  <select name="company_size" className={inputCls} required>
                    <option value="SME">SME</option>
                    <option value="Mid-market">Mid-market</option>
                    <option value="Enterprise">Enterprise</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={labelCls}>Process description</label>
                <textarea name="process_description" required className={`${inputCls} min-h-[140px]`} />
              </div>
              <button type="submit" className={btnPrimary} disabled={loadingMap['controls-tester']}>
                {loadingMap['controls-tester'] ? 'Running…' : 'Run Agent'}
              </button>
            </form>
            <AgentResult data={resultMap['controls-tester']} />
            <HistoryTable rows={histories['controls-tester']} />
          </section>

          {/* SOX */}
          <section id="agent-sox" className="scroll-mt-6 space-y-4">
            <h2 className="text-lg font-semibold text-[#F5A623]">⚖️ SOX Compliance Checker Agent</h2>
            <form
              className={`space-y-3 ${cardBase}`}
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy('sox-checker', true);
                try {
                  const fd = new FormData(e.currentTarget);
                  const r = await fetch(`${API_BASE}/api/audit/sox-checker`, { method: 'POST', body: fd });
                  const j = await r.json();
                  if (!r.ok) throw new Error(j.detail || r.statusText);
                  setResultMap((m) => ({ ...m, 'sox-checker': { run_id: j.run_id, result: j.result } }));
                  await refreshHistories();
                } catch (err) {
                  setResultMap((m) => ({
                    ...m,
                    'sox-checker': { run_id: 0, result: { _error: 'request_failed', message: String(err) } },
                  }));
                } finally {
                  setBusy('sox-checker', false);
                }
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Client name (optional)</label>
                  <input name="client_name" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Control testing results (CSV / Excel)</label>
                  <input name="file" type="file" accept=".csv,.xlsx,.xls" required className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Section</label>
                  <select name="section" className={inputCls} required>
                    <option value="SOX 302">SOX 302</option>
                    <option value="SOX 404">SOX 404</option>
                    <option value="Both">Both</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Quarter</label>
                  <select name="quarter" className={inputCls} required>
                    <option value="Q1">Q1</option>
                    <option value="Q2">Q2</option>
                    <option value="Q3">Q3</option>
                    <option value="Q4">Q4</option>
                  </select>
                </div>
              </div>
              <button type="submit" className={btnPrimary} disabled={loadingMap['sox-checker']}>
                {loadingMap['sox-checker'] ? 'Running…' : 'Run Agent'}
              </button>
            </form>
            <AgentResult data={resultMap['sox-checker']} />
            <HistoryTable rows={histories['sox-checker']} />
          </section>

          {/* AML */}
          <section id="agent-aml" className="scroll-mt-6 space-y-4">
            <h2 className="text-lg font-semibold text-[#F5A623]">🚨 AML Transaction Monitor Agent</h2>
            <form
              className={`space-y-3 ${cardBase}`}
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy('aml-monitor', true);
                try {
                  const fd = new FormData(e.currentTarget);
                  const r = await fetch(`${API_BASE}/api/audit/aml-monitor`, { method: 'POST', body: fd });
                  const j = await r.json();
                  if (!r.ok) throw new Error(j.detail || r.statusText);
                  setResultMap((m) => ({ ...m, 'aml-monitor': { run_id: j.run_id, result: j.result } }));
                  await refreshHistories();
                } catch (err) {
                  setResultMap((m) => ({
                    ...m,
                    'aml-monitor': { run_id: 0, result: { _error: 'request_failed', message: String(err) } },
                  }));
                } finally {
                  setBusy('aml-monitor', false);
                }
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Client name (optional)</label>
                  <input name="client_name" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Transaction file (CSV / Excel)</label>
                  <input name="file" type="file" accept=".csv,.xlsx,.xls" required className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Threshold amount</label>
                  <input name="threshold_amount" type="number" defaultValue={10000} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Jurisdiction</label>
                  <select name="jurisdiction" className={inputCls} required>
                    <option value="India">India</option>
                    <option value="UAE">UAE</option>
                    <option value="UK">UK</option>
                    <option value="US">US</option>
                  </select>
                </div>
              </div>
              <button type="submit" className={btnPrimary} disabled={loadingMap['aml-monitor']}>
                {loadingMap['aml-monitor'] ? 'Running…' : 'Run Agent'}
              </button>
            </form>
            <AgentResult data={resultMap['aml-monitor']} />
            <HistoryTable rows={histories['aml-monitor']} />
          </section>
        </div>
      </main>
    </div>
  );
}

function AgentResult({ data }: { data: { run_id: number; result: unknown } | null }) {
  if (!data) return null;
  const { run_id, result } = data;
  const canPdf = run_id > 0;

  return (
    <div className={`${cardBase} space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">Results</h3>
        {canPdf && (
          <a href={pdfUrl(run_id)} className={btnGhost} target="_blank" rel="noreferrer">
            Download Report PDF
          </a>
        )}
      </div>
      <pre className="max-h-96 overflow-auto rounded-lg bg-[#0A0F1E] p-3 text-xs text-slate-300 whitespace-pre-wrap">
        {JSON.stringify(result, null, 2)}
      </pre>
    </div>
  );
}

function AuditEvidenceDashboard({ data }: { data: { run_id: number; result: unknown } | null }) {
  if (!data) return null;
  const { run_id, result } = data;
  const typed = (result || {}) as EvidenceResult & { _error?: string; message?: string };
  if (typed._error) {
    return <div className={`${cardBase} text-sm text-red-300`}>{typed.message || typed._error}</div>;
  }

  const summary = typed.audit_summary || {};
  const patterns = typed.r2r_patterns_found || [];
  const evidence = typed.audit_evidence_required || [];
  const fraud = typed.fraud_risk_assessment || {
    fraud_risk_level: 'Medium',
    indicators_found: [],
    recommended_procedures: [],
  };
  const mgmt = typed.management_letter_points || [];

  return (
    <div className="space-y-4">
      <div className={cardBase}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-white">Results Dashboard</h3>
          {run_id > 0 && (
            <div className="flex flex-wrap gap-2">
              <a href={pdfUrl(run_id)} className={btnGhost} target="_blank" rel="noreferrer">Download Full Audit Report PDF</a>
              <a href={evidenceChecklistUrl(run_id)} className={btnGhost} target="_blank" rel="noreferrer">Download Evidence Checklist Excel</a>
              <a href={managementLetterUrl(run_id)} className={btnGhost} target="_blank" rel="noreferrer">Download Management Letter Word</a>
            </div>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Total Entries Analysed" value={summary.total_entries_analysed ?? 0} colorCls="bg-blue-500/15 ring-blue-400/40 text-blue-200" />
          <MetricCard label="Patterns Detected" value={summary.patterns_detected ?? 0} colorCls="bg-orange-500/15 ring-orange-400/40 text-orange-200" />
          <MetricCard label="High Risk Items" value={summary.high_risk_entries ?? 0} colorCls="bg-red-500/15 ring-red-400/40 text-red-200" />
          <MetricCard label="Audit Risk Rating" value={summary.audit_risk_rating ?? 'Medium'} colorCls={badgeRisk(summary.audit_risk_rating || 'Medium')} />
        </div>
      </div>

      <div className={cardBase}>
        <h3 className="mb-3 text-sm font-semibold text-white">Patterns Detected</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-600 text-slate-400">
                <th className="py-2 pr-2">Pattern Type</th>
                <th className="py-2 pr-2">Entries Affected</th>
                <th className="py-2 pr-2">Total Value</th>
                <th className="py-2 pr-2">Risk Level</th>
                <th className="py-2">Expand</th>
              </tr>
            </thead>
            <tbody>
              {patterns.length === 0 && <tr><td colSpan={5} className="py-4 text-slate-500">No patterns detected.</td></tr>}
              {patterns.map((p, idx) => (
                <tr key={`${p.pattern_type}-${idx}`} className="border-b border-slate-700/80">
                  <td className="py-2 pr-2 text-slate-200">{p.pattern_type}</td>
                  <td className="py-2 pr-2 text-slate-300">{p.entries_affected}</td>
                  <td className="py-2 pr-2 text-slate-300">{Number(p.total_value || 0).toLocaleString()}</td>
                  <td className="py-2 pr-2"><span className={`rounded-full px-2 py-0.5 text-[10px] ${badgeRisk(p.risk_level)}`}>{p.risk_level}</span></td>
                  <td className="py-2">
                    <details>
                      <summary className="cursor-pointer text-[#F5A623] hover:underline">Show entries</summary>
                      <div className="mt-2 max-h-56 overflow-auto rounded bg-[#0A0F1E] p-2">
                        {(p.entries || []).map((e, eidx) => (
                          <div key={`${e.reference}-${eidx}`} className="border-b border-slate-800 py-1 text-[11px] text-slate-300">
                            {e.date || '—'} | {e.account || '—'} | {Number(e.amount || 0).toLocaleString()} | {e.reference || '—'} | {e.flag_reason || '—'}
                          </div>
                        ))}
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={cardBase}>
        <h3 className="mb-3 text-sm font-semibold text-white">Audit Evidence List</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-600 text-slate-400">
                <th className="py-2 pr-2">Priority</th>
                <th className="py-2 pr-2">Reference</th>
                <th className="py-2 pr-2">Amount</th>
                <th className="py-2 pr-2">Pattern Detected</th>
                <th className="py-2 pr-2">Evidence Needed</th>
                <th className="py-2 pr-2">ISA Reference</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {evidence.length === 0 && <tr><td colSpan={7} className="py-4 text-slate-500">No evidence checklist items generated.</td></tr>}
              {evidence.map((ev, idx) => (
                <tr key={`${ev.entry_reference}-${idx}`} className="border-b border-slate-700/80">
                  <td className="py-2 pr-2 text-slate-200">{ev.priority}</td>
                  <td className="py-2 pr-2 text-slate-300">{ev.entry_reference || '—'}</td>
                  <td className="py-2 pr-2 text-slate-300">{Number(ev.amount || 0).toLocaleString()}</td>
                  <td className="py-2 pr-2 text-slate-300">{ev.pattern_detected || '—'}</td>
                  <td className="py-2 pr-2 text-slate-300">{ev.evidence_needed || '—'}</td>
                  <td className="py-2 pr-2 text-slate-300">{ev.isa_reference || '—'}</td>
                  <td className="py-2"><span className="rounded-full bg-slate-700 px-2 py-0.5 text-[10px] text-slate-100">{ev.status || 'Pending'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={cardBase}>
        <h3 className="mb-3 text-sm font-semibold text-white">Fraud Risk Panel</h3>
        <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${badgeRisk(fraud.fraud_risk_level || 'Medium')}`}>
          Fraud risk level: {fraud.fraud_risk_level || 'Medium'}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="mb-1 text-xs text-slate-400">Indicators found</p>
            <ul className="space-y-1 text-xs text-slate-300">
              {(fraud.indicators_found || []).length === 0 && <li>No indicators listed.</li>}
              {(fraud.indicators_found || []).map((i, idx) => <li key={`ind-${idx}`}>- {i}</li>)}
            </ul>
          </div>
          <div>
            <p className="mb-1 text-xs text-slate-400">Recommended audit procedures</p>
            <ul className="space-y-1 text-xs text-slate-300">
              {(fraud.recommended_procedures || []).length === 0 && <li>No procedures listed.</li>}
              {(fraud.recommended_procedures || []).map((p, idx) => <li key={`proc-${idx}`}>- {p}</li>)}
            </ul>
          </div>
        </div>
      </div>

      <div className={cardBase}>
        <h3 className="mb-2 text-sm font-semibold text-white">Management Letter</h3>
        <p className="mb-2 text-xs text-slate-400">Auto-generated management letter points</p>
        <ul className="space-y-1 text-xs text-slate-300">
          {mgmt.length === 0 && <li>No management letter points generated.</li>}
          {mgmt.map((m, idx) => <li key={`mgmt-${idx}`}>- {m}</li>)}
        </ul>
      </div>
    </div>
  );
}

function MetricCard({ label, value, colorCls }: { label: string; value: string | number; colorCls: string }) {
  return (
    <div className={`rounded-lg px-3 py-3 ring-1 ${colorCls}`}>
      <p className="text-[11px]">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function HistoryTable({ rows }: { rows: AuditRunRow[] }) {
  return (
    <div className={cardBase}>
      <h3 className="text-sm font-semibold text-white mb-3">Run history</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-600 text-slate-400">
              <th className="py-2 pr-2">When</th>
              <th className="py-2 pr-2">File</th>
              <th className="py-2 pr-2">Summary</th>
              <th className="py-2">PDF</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-slate-500">
                  No runs yet for this agent.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-700/80">
                <td className="py-2 pr-2 text-slate-300">
                  {r.run_timestamp ? new Date(r.run_timestamp).toLocaleString() : '—'}
                </td>
                <td className="py-2 pr-2 text-slate-400">{r.file_name || '—'}</td>
                <td className="py-2 pr-2 text-slate-300">{r.result_summary || '—'}</td>
                <td className="py-2">
                  <a href={pdfUrl(r.id)} className="text-[#F5A623] hover:underline" target="_blank" rel="noreferrer">
                    Download
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
