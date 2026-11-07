import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Bot, ClipboardCheck, Database, MessageSquare, RefreshCw, Search, Sparkles } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { aiCfoApi, type Overview } from '../../services/aiCfo.service';
import { ErrorBanner, errorText } from '../internal-audit/shared';
import { Card, GOLD, NAVY } from './parts';
import { InvestigationCentre } from './InvestigationCentre';
import { ActivityTab, ApprovalsTab, CopilotTab } from './OtherTabs';

type Tab = 'overview' | 'investigations' | 'copilot' | 'approvals' | 'activity';
const TABS: { value: Tab; label: string; icon: typeof Bot }[] = [
  { value: 'overview', label: 'Overview', icon: Sparkles },
  { value: 'investigations', label: 'Investigation Centre', icon: Search },
  { value: 'copilot', label: 'CFO Copilot', icon: MessageSquare },
  { value: 'approvals', label: 'Approvals', icon: ClipboardCheck },
  { value: 'activity', label: 'AI Activity', icon: Activity },
];

export default function AiCfoCommandCentrePage() {
  const { activeCompanyId, activeCompany, loading: companiesLoading, loadCompanies, setActiveCompany } = useCompany();
  const companyId = activeCompanyId ?? '';
  const currency = activeCompany?.base_currency || 'AED';
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'' | 'detect' | 'seed'>('');
  const [notice, setNotice] = useState('');
  const [period, setPeriod] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    if (!companyId) return;
    setError('');
    try {
      const o = await aiCfoApi.overview(companyId);
      setOverview(o);
      setPeriod((p) => p || o.coverage.last_period || '');
    } catch (e) {
      setError(errorText(e, 'Failed to load the AI CFO overview'));
    }
  }, [companyId]);

  useEffect(() => {
    setOverview(null);
    setPeriod('');
    void load();
  }, [load]);

  const detect = async () => {
    setBusy('detect');
    setError('');
    setNotice('');
    try {
      const res = await aiCfoApi.detect(companyId, period || undefined);
      setNotice(
        res.period
          ? `Detection for ${res.period}: ${res.findings.length} finding(s), ${res.created} new.`
          : 'No posted ledger data to analyse for this company.',
      );
      await load();
      setRefreshKey((k) => k + 1);
      if (res.findings.length) setTab('investigations');
    } catch (e) {
      setError(errorText(e, 'Detection failed'));
    } finally {
      setBusy('');
    }
  };

  const seedDemo = async () => {
    if (!window.confirm('Create (or rebuild) the synthetic demo company in this workspace? Your real companies are not changed.')) return;
    setBusy('seed');
    setError('');
    try {
      const res = await aiCfoApi.seedDemo(companyId);
      await loadCompanies();
      setActiveCompany(res.company_id);
      setNotice(`Switched to "${res.company_name}" with ${res.journal_entries} synthetic journal entries (${res.periods[0]} to ${res.periods[res.periods.length - 1]}). Run detection next.`);
      setTab('overview');
    } catch (e) {
      setError(errorText(e, 'Could not create the demo company'));
    } finally {
      setBusy('');
    }
  };

  if (!companyId) {
    return (
      <div className="p-6">
        <div className="rounded-xl border-2 border-dashed border-slate-300 py-16 text-center text-sm text-slate-500">
          {companiesLoading ? 'Loading companies…' : 'Select a company in the top banner to open the AI CFO Command Centre.'}
        </div>
      </div>
    );
  }

  const isDemo = activeCompany?.company_name?.includes('(synthetic data)');
  const cov = overview?.coverage;
  const sev = overview?.open_findings_by_severity ?? {};
  const invs = overview?.investigations_by_status ?? {};

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="px-6 py-5" style={{ background: NAVY }}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: `${GOLD}26` }}>
              <Bot className="h-5 w-5" style={{ color: GOLD }} />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">AI CFO Command Centre</h1>
              <p className="text-xs text-slate-300">
                {activeCompany?.company_name} · agents read the posted ledger; every figure is computed, never guessed
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/ai-cfo/executive-summary" className="rounded-md border border-white/20 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10">Month-end close</Link>
            <button onClick={() => { void load(); setRefreshKey((k) => k + 1); }} aria-label="Refresh" className="rounded-md border border-white/20 p-2 text-slate-200 hover:bg-white/10">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
        <nav className="mt-4 flex flex-wrap gap-1" role="tablist">
          {TABS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === value ? 'text-slate-900' : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
              style={tab === value ? { background: GOLD } : undefined}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="space-y-4 p-6">
        {isDemo && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            <span className="font-semibold">Synthetic demo company.</span> All ledger data here is generated sample data.
          </div>
        )}
        {overview && !overview.ai_configured && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
            The AI model is not configured on this server (ANTHROPIC_API_KEY). Detection works; investigations and the copilot do not.
          </div>
        )}
        <ErrorBanner message={error} />
        {notice && <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">{notice}</div>}

        {tab === 'overview' && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="Open alerts" value={(sev.high ?? 0) + (sev.medium ?? 0) + (sev.low ?? 0)} sub={`${sev.high ?? 0} high · ${sev.medium ?? 0} medium`} tone={(sev.high ?? 0) > 0 ? 'red' : 'slate'} />
              <Stat label="Investigations" value={(invs.completed ?? 0)} sub={`${invs.running ?? 0} running · ${invs.failed ?? 0} failed`} tone="blue" />
              <Stat label="Pending approvals" value={overview?.pending_approvals ?? 0} sub="Prepared by agents, awaiting a manager" tone={(overview?.pending_approvals ?? 0) > 0 ? 'amber' : 'slate'} />
              <Stat label="Ledger coverage" value={cov?.periods.length ?? 0} sub={cov?.first_period ? `months · ${cov.first_period} to ${cov.last_period}` : 'no posted data'} tone="slate" />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card title="Anomaly detection">
                <p className="mb-3 text-sm text-slate-600">
                  Deterministic rules scan the posted ledger for expense spikes against each account&apos;s recent history,
                  budget overruns against the FP&amp;A upload, and possible duplicate entries.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                    aria-label="Month to analyse"
                    className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                    disabled={!cov?.periods.length}
                  >
                    {[...(cov?.periods ?? [])].reverse().map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <button
                    onClick={() => void detect()}
                    disabled={busy !== '' || !cov?.periods.length}
                    className="rounded-md px-4 py-1.5 text-sm font-semibold text-slate-900 disabled:opacity-50"
                    style={{ background: GOLD }}
                  >
                    {busy === 'detect' ? 'Scanning…' : 'Run detection'}
                  </button>
                </div>
              </Card>

              <Card title="Data">
                <ul className="mb-3 space-y-1 text-sm text-slate-600">
                  <li className="flex items-center gap-2"><Database className="h-3.5 w-3.5" /> {cov?.posted_lines ?? 0} posted journal lines for this company</li>
                  {(cov?.limitations ?? []).map((l) => <li key={l} className="text-amber-800">• {l}</li>)}
                </ul>
                <p className="mb-3 text-xs text-slate-500">
                  Import journals from UAE Suite → Journal Entries (CSV import) and budgets from FP&amp;A → Master upload.
                  To try the full flow first, load the synthetic demo company.
                </p>
                <button
                  onClick={() => void seedDemo()}
                  disabled={busy !== ''}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {busy === 'seed' ? 'Building demo…' : 'Load synthetic demo company'}
                </button>
              </Card>
            </div>
          </>
        )}
        {tab === 'investigations' && <InvestigationCentre key={`${companyId}-${refreshKey}`} companyId={companyId} currency={currency} onChange={load} />}
        {tab === 'copilot' && <CopilotTab key={companyId} companyId={companyId} currency={currency} aiConfigured={overview?.ai_configured ?? true} />}
        {tab === 'approvals' && <ApprovalsTab key={`${companyId}-${refreshKey}`} companyId={companyId} currency={currency} onChange={load} />}
        {tab === 'activity' && <ActivityTab key={`${companyId}-${refreshKey}`} companyId={companyId} />}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number; sub: string; tone: 'red' | 'amber' | 'blue' | 'slate' }) {
  const colour = { red: 'text-red-700', amber: 'text-amber-700', blue: 'text-blue-700', slate: 'text-slate-900' }[tone];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${colour}`}>{value}</p>
      <p className="text-xs text-slate-500">{sub}</p>
    </div>
  );
}
