import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot, Briefcase, ChevronRight, Download, Eye, Landmark, ListChecks, Network, PieChart, Play, Receipt, Scale, ShieldCheck, TrendingUp,
  Users, X,
} from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import {
  aiCloseApi, type AgentKey, type AskRun, type PreviewJournal, type ReportKey, type ReportView,
} from '../../services/aiClose.service';
import { ErrorBanner, errorText } from '../internal-audit/shared';
import { GOLD, NAVY, SeverityBadge, StatusPill, money } from './parts';
import { AgentCard, ReportViewer } from './closeParts';

type AgentSpec = {
  key: AgentKey; name: string; role: string; icon: typeof Bot; does: string[]; uses: string; delivers: string;
  report?: ReportKey; prompt: string; group?: 'required' | 'optional'; dataLink?: string;
};

const WORKFORCE: AgentSpec[] = [
  {
    key: 'bank_reconciliation', name: 'Reconciliation Agent', role: 'Bank-to-ledger reconciliation', icon: Landmark,
    does: ['Matches every statement line to posted cash entries', 'Finds bank-only and ledger-only items', 'Explains the balance difference', 'Proposes fee and interest journals'],
    uses: 'Bank statements, posted ledger', delivers: 'Bank Reconciliation Report', report: 'bank_reconciliation', group: 'optional',
    prompt: 'Perform October bank reconciliation. Match bank transactions with GL entries, identify unmatched transactions, investigate potential duplicates and prepare a reconciliation summary.',
  },
  {
    key: 'ap_processing', name: 'AP Agent', role: 'Invoice-to-payment control', icon: Receipt,
    does: ['Registers supplier invoices', 'PO and goods-receipt (3-way) matching', 'Catches duplicate and re-keyed invoices', 'Prepares the payment proposal and accruals for uninvoiced receipts'],
    uses: 'AP InvoiceFlow invoices, purchase orders, goods receipts', delivers: 'AP Processing Report', report: 'ap_processing', group: 'optional',
    prompt: 'Process the October supplier invoices. Validate VAT and supplier details, perform PO and GRN matching, identify duplicates and prepare an AP exception report and payment proposal.',
  },
  {
    key: 'ar_intelligence', name: 'AR Agent', role: 'Collections and cash', icon: Users,
    does: ['Ages receivables at period end', 'Ranks customers by collection risk', 'Recommends collection actions', 'Checks the AR control account'],
    uses: 'Sales invoices, receipts, posted ledger', delivers: 'AR Ageing & Collection Report', report: 'ar_collections', group: 'optional',
    prompt: 'Analyse the October accounts receivable ageing. Identify overdue customers, prioritise high-risk balances and generate recommended collection actions.',
  },
  {
    key: 'ifrs', name: 'IFRS Agent', role: 'Accounting standards and working papers', icon: Scale,
    does: ['Statement integrity checks (IAS 1)', 'IFRS 9 expected credit loss (provision matrix)', 'IFRS 16 monthly lease entries', 'Missing accruals and end-of-service benefits (IAS 37, IAS 19)'],
    uses: 'Posted ledger, lease register, receivables ageing', delivers: 'IFRS Accounting Pack', report: 'ifrs_pack', group: 'optional',
    prompt: 'Review October lease accounting under IFRS 16 and the expected credit loss under IFRS 9. Identify missing entries, prepare the supporting schedules and flag items requiring review.',
  },
  {
    key: 'fpa', name: 'FP&A Agent', role: 'Performance and forecast', icon: TrendingUp,
    does: ['Actual vs budget by account', 'Flags material overruns', 'Explains movements against prior months', '30/60/90-day cash forecast with downside and upside'],
    uses: 'Posted ledger, FP&A budgets, AR and AP schedules', delivers: 'FP&A Variance & Forecast Report', report: 'fpa_intelligence', group: 'optional',
    prompt: 'Analyse October actual performance against budget. Identify significant revenue and expense variances, explain key movements and prepare the cash forecast with best-case and worst-case scenarios.',
  },
  {
    key: 'investment', name: 'Investment Agent', role: 'Portfolio and treasury review', icon: PieChart,
    does: ['Values the portfolio and month returns', 'Fair value movements by IFRS 9 category', 'Issuer, asset-class and currency concentration limits', 'Proposes fair value journals; flags maturities and stale prices'],
    uses: 'Investment holdings and month-end valuations, investments ledger', delivers: 'Investment Review Report', report: 'investment_review',
    group: 'optional', dataLink: '/ai-cfo/investments',
    prompt: "Analyse the company's investment portfolio for October. Evaluate asset allocation, investment returns, valuation changes, concentration risks and portfolio performance, and prepare an investment review report.",
  },
  {
    key: 'consolidation', name: 'Consolidation Agent', role: 'Group results', icon: Network,
    does: ['Per-entity P&L and balance sheet', 'Matches and eliminates intercompany', 'Flags one-sided or mismatched charges', 'Subsidiary comparison'],
    uses: 'Ledgers of every group company', delivers: 'Group results (in the Close Pack and CFO Summary)', group: 'required',
    prompt: 'Consolidate the October results for the group, eliminate intercompany transactions and flag any intercompany differences.',
  },
  {
    key: 'close_manager', name: 'Close Manager Agent', role: 'Close checklist and dependencies', icon: ListChecks,
    does: ['Evaluates every close checklist item', 'Tracks what is done and what is open', 'Checks prior-period status', 'Feeds the Month-End Close Pack'],
    uses: 'Agent outcomes, ledger, period controls', delivers: 'Month-End Close Pack', report: 'close_pack', group: 'optional',
    prompt: 'What is still open for the October close?',
  },
  {
    key: 'cfo_intelligence', name: 'CFO Intelligence Agent', role: 'Executive summary', icon: Briefcase,
    does: ['Performance vs prior month', 'Major exceptions and root causes', 'Risks and recommended actions', 'Decisions the CFO must take'],
    uses: 'Every other agent, the ledger, journal proposals', delivers: 'CFO Executive Summary', report: 'cfo_summary', group: 'optional',
    prompt: 'Give me the October CFO executive summary: performance, major exceptions, risks and the decisions I need to take.',
  },
];
const POLL_MS = 2000;
const DEMO_TAG = '(synthetic data)';

export default function WorkforcePage() {
  const { activeCompanyId, activeCompany, companiesList } = useCompany();
  const companyId = activeCompanyId ?? '';
  const [asking, setAsking] = useState<AgentSpec | null>(null);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="px-6 py-6" style={{ background: NAVY }}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: `${GOLD}26` }}>
              <Bot className="h-5 w-5" style={{ color: GOLD }} />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">AI Finance Workforce</h1>
              <p className="text-xs text-slate-300">
                Nine specialised agents, coordinated by NEXUS. Each does real work on your ledger and source records.
              </p>
            </div>
          </div>
          <Link to="/ai-cfo/executive-summary" className="flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold text-slate-900" style={{ background: GOLD }}>
            <Play className="h-4 w-4" /> Run the full month-end close
          </Link>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-md bg-white/10 px-3 py-1.5 font-semibold text-white">NEXUS orchestrator</span>
          <ChevronRight className="h-4 w-4 text-slate-400" />
          {WORKFORCE.map((a, i) => (
            <span key={a.key} className="flex items-center gap-2">
              <span className="rounded-md border border-white/20 px-2.5 py-1 text-slate-200">{a.name.replace(' Agent', '')}</span>
              {i < WORKFORCE.length - 1 && <span className="text-slate-500">·</span>}
            </span>
          ))}
          <ChevronRight className="h-4 w-4 text-slate-400" />
          <span className="rounded-md px-3 py-1.5 font-semibold text-slate-900" style={{ background: GOLD }}>CFO review and approval</span>
        </div>
      </div>

      <div className="space-y-4 p-6">
        <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
          <span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-green-700" /> Every figure is computed from records, never generated</span>
          <span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-green-700" /> Agents prepare journals; only a finance manager can approve and post</span>
          <span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-green-700" /> Each output passes validation checks before it counts as complete</span>
        </div>
        {!companyId && <p className="text-sm text-slate-500">Select a company in the top banner to ask an agent.</p>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {WORKFORCE.map((a) => (
            <article key={a.key} className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${GOLD}26` }}><a.icon className="h-4 w-4" style={{ color: NAVY }} /></span>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{a.name}</h3>
                  <p className="text-[11px] text-slate-500">{a.role}</p>
                </div>
              </div>
              <ul className="mb-3 ml-4 list-disc space-y-0.5 text-xs text-slate-700">{a.does.map((d) => <li key={d}>{d}</li>)}</ul>
              <p className="text-[11px] text-slate-500"><span className="font-medium text-slate-600">Works from:</span> {a.uses}</p>
              <p className="mb-3 text-[11px] text-slate-500"><span className="font-medium text-slate-600">Delivers:</span> {a.delivers}</p>
              {a.dataLink && <Link to={a.dataLink} className="mb-2 text-[11px] font-medium text-slate-600 underline">Manage portfolio data</Link>}
              <button onClick={() => setAsking(a)} disabled={!companyId}
                className="mt-auto rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50">
                Ask this agent
              </button>
            </article>
          ))}
        </div>
      </div>
      {asking && companyId && (
        <AskPanel key={asking.key} agent={asking} companyId={companyId} currency={activeCompany?.base_currency || 'AED'}
          isDemo={!!activeCompany?.company_name?.includes(DEMO_TAG)}
          others={companiesList.filter((c) => c.id !== companyId)} onClose={() => setAsking(null)} />
      )}
    </div>
  );
}

function AskPanel({ agent, companyId, currency, isDemo, others, onClose }: {
  agent: AgentSpec; companyId: string; currency: string; isDemo: boolean;
  others: { id: string; company_name: string }[]; onClose: () => void;
}) {
  const demoSiblings = useMemo(() => others.filter((c) => c.company_name?.includes(DEMO_TAG)).map((c) => c.id), [others]);
  const [prompt, setPrompt] = useState(agent.prompt);
  const [period, setPeriod] = useState('');
  const [scope, setScope] = useState<'entity' | 'group'>(agent.group === 'required' || (isDemo && demoSiblings.length && agent.key === 'consolidation') ? 'group' : 'entity');
  const [groupIds, setGroupIds] = useState<string[]>(isDemo ? demoSiblings : []);
  const [run, setRun] = useState<AskRun | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewJournal[]>([]);
  const [report, setReport] = useState<ReportView | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const done = !!run?.ask.answer;

  useEffect(() => {
    clearTimeout(timer.current);
    if (run && !done) {
      timer.current = setTimeout(async () => {
        try {
          setRun(await aiCloseApi.askRun(companyId, run.id));
        } catch (e) {
          setError(errorText(e, 'Lost track of the agent run'));
        }
      }, POLL_MS);
    }
    return () => clearTimeout(timer.current);
  }, [run, done, companyId]);

  useEffect(() => {
    if (!done || !run) return;
    aiCloseApi.task(companyId, run.id, agent.key).then((t) => setPreview((t.output_json?.proposed_journals as PreviewJournal[]) ?? [])).catch(() => undefined);
  }, [done, run, companyId, agent.key]);

  const submit = async () => {
    setBusy(true);
    setError('');
    setRun(null);
    setPreview([]);
    try {
      setRun(await aiCloseApi.ask(companyId, agent.key, {
        prompt, period: period || undefined, scope, entity_ids: scope === 'group' ? groupIds : undefined,
      }));
    } catch (e) {
      setError(errorText(e, 'The agent could not start'));
    } finally {
      setBusy(false);
    }
  };

  const openReport = async () => {
    if (!run || !agent.report) return;
    try {
      setReport(await aiCloseApi.view(companyId, run.id, agent.report));
    } catch (e) {
      setError(errorText(e, 'Report not available'));
    }
  };

  const deliverable = run?.deliverables.find((d) => d.key === agent.report);
  const answer = run?.ask.answer;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40" role="dialog" aria-modal="true" aria-label={`Ask ${agent.name}`}>
      <div className="flex h-full w-full max-w-3xl flex-col overflow-y-auto bg-white shadow-xl">
        <header className="flex items-center justify-between px-5 py-3" style={{ background: NAVY }}>
          <div>
            <h2 className="text-sm font-semibold text-white">Ask the {agent.name}</h2>
            <p className="text-xs text-slate-300">{agent.role} · runs on live records; journals are shown as a preview, not created</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-200 hover:bg-white/10"><X className="h-4 w-4" /></button>
        </header>
        <div className="space-y-4 p-5">
          <ErrorBanner message={error} />
          <label className="block text-xs font-medium text-slate-600">Request
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} maxLength={2000}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800" />
          </label>
          <div className="flex flex-wrap items-end gap-4 text-sm">
            <label className="text-xs text-slate-600">Period (optional — read from the request otherwise)
              <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            {agent.group !== 'required' && (
              <fieldset className="flex items-center gap-3 text-xs">
                <label className="flex items-center gap-1"><input type="radio" checked={scope === 'entity'} onChange={() => setScope('entity')} /> This entity</label>
                <label className="flex items-center gap-1"><input type="radio" checked={scope === 'group'} onChange={() => setScope('group')} disabled={!others.length} /> Group</label>
              </fieldset>
            )}
            <button onClick={() => void submit()} disabled={busy || (!!run && !done) || prompt.trim().length < 3 || (scope === 'group' && !groupIds.length)}
              className="ml-auto flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold text-slate-900 disabled:opacity-50" style={{ background: GOLD }}>
              <Play className="h-4 w-4" /> {run && !done ? 'Working…' : 'Run agent'}
            </button>
          </div>
          {scope === 'group' && (
            <div className="flex flex-wrap gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
              <span className="text-slate-600">With this company:</span>
              {others.map((c) => (
                <label key={c.id} className="flex items-center gap-1">
                  <input type="checkbox" checked={groupIds.includes(c.id)}
                    onChange={(e) => setGroupIds((ids) => (e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id)))} />
                  {c.company_name}
                </label>
              ))}
            </div>
          )}

          {run && (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span className="font-semibold text-slate-900">Run #{run.id} · {run.period}</span>
                <StatusPill value={!done ? 'running' : run.status === 'failed' ? 'failed' : 'completed'} />
                <span>{run.tasks.map((t) => t.agent_name).join(' → ')}</span>
              </div>
              {!done && (
                <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800" aria-live="polite">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-blue-600" />
                  {run.tasks.map((t) => `${t.agent_name}: ${t.status.replace(/_/g, ' ')}`).join(' · ')}
                </div>
              )}
              {answer && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {answer.source === 'ai' ? 'Answer · AI-drafted from the run, every figure verified' : 'Answer · computed from the run'}
                  </p>
                  {answer.text.split('\n').filter(Boolean).map((line, i) => <p key={i} className="mb-1 text-sm leading-relaxed text-slate-800">{line}</p>)}
                  {answer.note && <p className="mt-1 text-[11px] text-slate-500">{answer.note}</p>}
                </div>
              )}
              {done && (
                <>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {run.tasks.map((t) => <AgentCard key={t.id} task={t} companyId={companyId} runId={run.id} />)}
                  </div>
                  {deliverable?.status === 'ready' && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm">
                      <span className="font-medium text-slate-800">{deliverable.title}</span>
                      <button onClick={() => void openReport()} className="ml-auto flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs"><Eye className="h-3.5 w-3.5" /> View</button>
                      {deliverable.formats.map((fmt) => (
                        <button key={fmt} onClick={() => void aiCloseApi.download(companyId, run, deliverable.key, fmt).catch((e) => setError(errorText(e, 'Download failed')))}
                          className="flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs">
                          <Download className="h-3.5 w-3.5" /> {fmt === 'xlsx' ? 'Excel' : 'PDF'}
                        </button>
                      ))}
                    </div>
                  )}
                  {preview.length > 0 && (
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Journals it would propose (preview — not created)</p>
                      <ul className="space-y-2">
                        {preview.map((j, i) => (
                          <li key={i} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 text-xs">
                            <p className="font-semibold text-slate-900">{j.title}{j.entity ? ` · ${j.entity}` : ''}</p>
                            <p className="text-slate-600">{j.rationale}</p>
                            <p className="mt-1 font-mono text-slate-700">
                              {j.lines.map((l) => `${l.account_code} ${l.debit ? `Dr ${money(l.debit, currency)}` : `Cr ${money(l.credit, currency)}`}`).join(' · ')}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {run.exceptions.length > 0 && (
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Exceptions found ({run.exceptions_total})</p>
                      <ul className="space-y-1 text-xs">
                        {run.exceptions.slice(0, 12).map((e) => (
                          <li key={e.id} className="flex items-start gap-2"><SeverityBadge severity={e.severity} /><span className="text-slate-700">{e.title}{e.entity_name && run.scope === 'group' ? ` · ${e.entity_name}` : ''}</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="text-xs text-slate-500">
                    To send these journals for approval and close the period, <Link to="/ai-cfo/executive-summary" className="font-medium underline">run the month-end close</Link>.
                  </p>
                </>
              )}
            </section>
          )}
        </div>
      </div>
      {report && <ReportViewer report={report} onClose={() => setReport(null)} />}
    </div>
  );
}
