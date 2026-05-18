/**
 * CA Firm — ML Bank Statement Processor (4-Tab Workflow)
 * ────────────────────────────────────────────────────────
 * Tab 1: Client Setup   → COA upload + Train ML model
 * Tab 2: Classify       → Upload statement → 3-tier review
 * Tab 3: Post to Tally  → Approve + generate Tally XML
 * Tab 4: Dashboard      → Session history + accuracy trend
 */
import { useRef, useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  Upload, Loader2, Download, CheckCircle2, XCircle,
  AlertCircle, Sparkles, ArrowLeft, BookOpen, FileText,
  Brain, Send, BarChart3, Settings, RefreshCw, Check,
  ChevronDown, Eye, Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

const API = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');

// ── Types ─────────────────────────────────────────────────────────────────────

type Tier = 'auto' | 'review' | 'manual';
type ApprovalStatus = 'pending' | 'auto_approved' | 'confirmed' | 'excel_corrected' | 'manual';
type TabId = 'setup' | 'classify' | 'tally' | 'dashboard';

interface ClassifiedTxn {
  date:              string;
  description:       string;
  debit:             number;
  credit:            number;
  balance:           number;
  bank?:             string;
  source?:           string;
  predicted_ledger?: string;
  confidence?:       number;
  tier?:             Tier;
  top_suggestions?:  { ledger: string; confidence: number }[];
  ledger_name:       string;
  approval_status:   ApprovalStatus;
}

interface ModelMeta {
  exists:      boolean;
  n_samples?:  number;
  accuracy?:   number;
  trained_at?: string;
  classes?:    string[];
}

interface ClassifySummary {
  auto:   number;
  review: number;
  manual: number;
  total:  number;
}

interface Session {
  id:        number;
  date:      string;
  file:      string;
  total:     number;
  auto:      number;
  confirmed: number;
  posted:    boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const tierColor = (tier?: Tier | string) => {
  if (tier === 'auto')   return 'text-emerald-600 bg-emerald-50 border-emerald-200';
  if (tier === 'review') return 'text-amber-600 bg-amber-50 border-amber-200';
  return 'text-rose-600 bg-rose-50 border-rose-200';
};

const tierLabel = (tier?: Tier | string) => {
  if (tier === 'auto')   return 'Auto ✓';
  if (tier === 'review') return 'Review';
  return 'Manual';
};

const fmtAmt = (n: number) =>
  n > 0 ? `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—';

const pct = (n?: number) =>
  n != null ? `${(n * 100).toFixed(0)}%` : '—';

// ── Component ─────────────────────────────────────────────────────────────────

export default function BankStatementProcessor() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('setup');

  // ── Setup tab state ──────────────────────────────────────────────────────
  const [orgId,      setOrgId]      = useState('');
  const [accountId,  setAccountId]  = useState('');
  const [coaFile,    setCoaFile]    = useState<File | null>(null);
  const [trainFile,  setTrainFile]  = useState<File | null>(null);
  const [modelMeta,  setModelMeta]  = useState<ModelMeta | null>(null);
  const [setupBusy,  setSetupBusy]  = useState<'coa' | 'train' | 'status' | null>(null);

  // ── Classify tab state ───────────────────────────────────────────────────
  const [bankFile,      setBankFile]      = useState<File | null>(null);
  const [bankType,      setBankType]      = useState('AUTO');
  const [parseMode,     setParseMode]     = useState('auto');
  const [transactions,  setTransactions]  = useState<ClassifiedTxn[]>([]);
  const [summary,       setSummary]       = useState<ClassifySummary | null>(null);
  const [classifyBusy,  setClassifyBusy]  = useState<'parse' | 'classify' | null>(null);
  const [ledgerOptions, setLedgerOptions] = useState<string[]>([]);

  // ── Tally tab state ──────────────────────────────────────────────────────
  const [bankLedger,   setBankLedger]  = useState('');
  const [companyName,  setCompanyName] = useState('');
  const [tallyBusy,    setTallyBusy]   = useState(false);

  // ── Dashboard tab state ──────────────────────────────────────────────────
  const [sessions, setSessions] = useState<Session[]>([]);

  // Refs
  const coaRef   = useRef<HTMLInputElement>(null);
  const trainRef = useRef<HTMLInputElement>(null);
  const bankRef  = useRef<HTMLInputElement>(null);

  // ════════════════════════════════════════════════════════════════════════════
  // Setup actions
  // ════════════════════════════════════════════════════════════════════════════

  const handleCoaUpload = useCallback(async () => {
    if (!orgId)   { toast.error('Enter Client / Org ID first'); return; }
    if (!coaFile) { toast.error('Select a COA file first'); return; }
    setSetupBusy('coa');
    try {
      const fd = new FormData();
      fd.append('client_id', orgId);
      fd.append('file', coaFile);
      const res = await fetch(`${API}/api/bank/client-coa/upload`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'COA upload failed');
      setLedgerOptions(data.ledgers || []);
      toast.success(`Stored ${data.ledgers_stored} ledgers for ${orgId}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSetupBusy(null);
    }
  }, [orgId, coaFile]);

  const handleTrainModel = useCallback(async () => {
    if (!orgId || !accountId) { toast.error('Enter Org ID and Account ID'); return; }
    if (!trainFile)           { toast.error('Select a historical transactions CSV/Excel'); return; }
    setSetupBusy('train');
    try {
      // Parse training file client-side (SheetJS) to get transactions
      const buf = await trainFile.arrayBuffer();
      const wb  = XLSX.read(buf, { type: 'array' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

      // Normalise column names
      const txns = rows.map(r => {
        const keys: Record<string, string> = {};
        Object.keys(r).forEach(k => { keys[k.toLowerCase().trim()] = r[k]; });
        return {
          description: String(keys['description'] || keys['narration'] || keys['particulars'] || '').trim(),
          ledger_name: String(keys['ledger_name'] || keys['ledger'] || keys['tally ledger'] || '').trim(),
          debit:  Number(keys['debit']  || 0),
          credit: Number(keys['credit'] || 0),
        };
      }).filter(t => t.description && t.ledger_name);

      if (txns.length < 4) {
        toast.error(`Need ≥ 4 labelled rows. Found ${txns.length}.`);
        return;
      }

      const res  = await fetch(`${API}/api/bank/train`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ org_id: orgId, account_id: accountId, transactions: txns }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Training failed');
      toast.success(`Model trained! ${data.n_samples} samples, ${data.classes?.length} classes, CV accuracy: ${pct(data.accuracy)}`);
      await refreshModelStatus();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSetupBusy(null);
    }
  }, [orgId, accountId, trainFile]);

  const refreshModelStatus = useCallback(async () => {
    if (!orgId || !accountId) return;
    setSetupBusy('status');
    try {
      const res  = await fetch(`${API}/api/bank/model-status/${encodeURIComponent(orgId)}/${encodeURIComponent(accountId)}`);
      const data = await res.json();
      setModelMeta(data);
    } catch (_) {/* ignore */}
    finally { setSetupBusy(null); }
  }, [orgId, accountId]);

  // ════════════════════════════════════════════════════════════════════════════
  // Classify actions
  // ════════════════════════════════════════════════════════════════════════════

  const handleParseAndClassify = useCallback(async () => {
    if (!bankFile) { toast.error('Upload a bank statement first'); return; }
    if (!orgId || !accountId) { toast.error('Set Org ID and Account ID in Setup tab first'); return; }

    setClassifyBusy('parse');
    let rows: ClassifiedTxn[] = [];

    try {
      const fd = new FormData();
      fd.append('file',      bankFile);
      fd.append('bank_type', bankType);
      fd.append('mode',      parseMode);
      const res  = await fetch(`${API}/api/bank/parse`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Parse failed');
      rows = data.rows || [];
      toast.success(`Parsed ${rows.length} transactions`);
    } catch (e: any) {
      toast.error(e.message);
      setClassifyBusy(null);
      return;
    }

    if (rows.length === 0) { setClassifyBusy(null); return; }

    setClassifyBusy('classify');
    try {
      const res  = await fetch(`${API}/api/bank/classify`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ org_id: orgId, account_id: accountId, transactions: rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Classification failed');
      setTransactions(data.transactions || []);
      setSummary(data.summary || null);
      toast.success(`Classified: ${data.summary?.auto} auto | ${data.summary?.review} review | ${data.summary?.manual} manual`);
      setActiveTab('classify');
    } catch (e: any) {
      toast.error(e.message);
      // Still show raw rows even if classify fails
      setTransactions(rows);
    } finally {
      setClassifyBusy(null);
    }
  }, [bankFile, orgId, accountId, bankType, parseMode]);

  const updateLedger = useCallback((idx: number, ledger: string) => {
    setTransactions(prev => prev.map((t, i) =>
      i === idx
        ? { ...t, ledger_name: ledger, approval_status: 'confirmed' }
        : t
    ));
  }, []);

  const bulkApprove = useCallback((tier: Tier) => {
    setTransactions(prev => prev.map(t =>
      t.tier === tier && t.approval_status === 'pending'
        ? { ...t, approval_status: tier === 'auto' ? 'auto_approved' : 'confirmed' }
        : t
    ));
    toast.success(`Approved all "${tierLabel(tier)}" transactions`);
  }, []);

  const handleExportReview = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/bank/export-review`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ transactions }),
      });
      if (!res.ok) { toast.error('Export failed'); return; }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = 'bank_review_corrections.csv';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Review CSV downloaded');
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [transactions]);

  const handleSyncCorrections = useCallback(async (file: File) => {
    if (!orgId || !accountId) { toast.error('Set Org ID and Account ID in Setup tab'); return; }
    try {
      const fd = new FormData();
      fd.append('file',       file);
      fd.append('org_id',     orgId);
      fd.append('account_id', accountId);
      const res  = await fetch(`${API}/api/bank/sync-corrections`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Sync failed');
      toast.success(`Re-trained with ${data.corrections_applied} corrections. Accuracy: ${pct(data.accuracy)}`);
      await refreshModelStatus();
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [orgId, accountId, refreshModelStatus]);

  // ════════════════════════════════════════════════════════════════════════════
  // Tally actions
  // ════════════════════════════════════════════════════════════════════════════

  const handlePostTally = useCallback(async () => {
    if (!bankLedger) { toast.error('Enter the bank ledger name in Tally'); return; }
    const eligible = transactions.filter(t =>
      ['auto_approved', 'confirmed', 'excel_corrected'].includes(t.approval_status)
    );
    if (eligible.length === 0) { toast.error('No approved transactions to post'); return; }
    setTallyBusy(true);
    try {
      const res = await fetch(`${API}/api/bank/post-tally`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ transactions, bank_ledger: bankLedger, company_name: companyName }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Failed'); }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = 'tally_bank_import.xml';
      a.click();
      URL.revokeObjectURL(url);
      // Record session
      setSessions(prev => [{
        id:        Date.now(),
        date:      new Date().toLocaleDateString('en-IN'),
        file:      bankFile?.name || 'bank statement',
        total:     transactions.length,
        auto:      transactions.filter(t => t.approval_status === 'auto_approved').length,
        confirmed: transactions.filter(t => t.approval_status === 'confirmed').length,
        posted:    true,
      }, ...prev]);
      toast.success(`Tally XML downloaded — ${eligible.length} vouchers`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setTallyBusy(false);
    }
  }, [bankLedger, companyName, transactions, bankFile]);

  // ════════════════════════════════════════════════════════════════════════════
  // Derived state
  // ════════════════════════════════════════════════════════════════════════════

  const autoTxns    = transactions.filter(t => t.tier === 'auto');
  const reviewTxns  = transactions.filter(t => t.tier === 'review');
  const manualTxns  = transactions.filter(t => t.tier === 'manual' || !t.tier);
  const approvedCnt = transactions.filter(t =>
    ['auto_approved', 'confirmed', 'excel_corrected'].includes(t.approval_status)
  ).length;

  // ════════════════════════════════════════════════════════════════════════════
  // Render helpers
  // ════════════════════════════════════════════════════════════════════════════

  const TxnTable = ({ txns, showApprove }: { txns: ClassifiedTxn[]; showApprove?: boolean }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-slate-50 text-slate-500 uppercase text-[10px]">
            <th className="px-3 py-2 text-left w-20">Date</th>
            <th className="px-3 py-2 text-left">Description</th>
            <th className="px-3 py-2 text-right w-24">Debit</th>
            <th className="px-3 py-2 text-right w-24">Credit</th>
            <th className="px-3 py-2 text-left w-32">Tier / Conf</th>
            <th className="px-3 py-2 text-left w-48">Ledger</th>
            <th className="px-3 py-2 text-center w-24">Status</th>
          </tr>
        </thead>
        <tbody>
          {txns.map((t, i) => {
            const globalIdx = transactions.indexOf(t);
            const approved  = ['auto_approved', 'confirmed', 'excel_corrected'].includes(t.approval_status);
            return (
              <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{t.date}</td>
                <td className="px-3 py-2 text-slate-700 max-w-xs truncate" title={t.description}>{t.description}</td>
                <td className="px-3 py-2 text-right text-rose-600">{fmtAmt(t.debit)}</td>
                <td className="px-3 py-2 text-right text-emerald-600">{fmtAmt(t.credit)}</td>
                <td className="px-3 py-2">
                  {t.tier ? (
                    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${tierColor(t.tier)}`}>
                      {tierLabel(t.tier)} {t.confidence != null && `${pct(t.confidence)}`}
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {ledgerOptions.length > 0 ? (
                    <div className="relative">
                      <select
                        value={t.ledger_name || ''}
                        onChange={e => updateLedger(globalIdx, e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1 pr-6 bg-white appearance-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      >
                        <option value="">— select —</option>
                        {ledgerOptions.map(l => <option key={l} value={l}>{l}</option>)}
                        {t.ledger_name && !ledgerOptions.includes(t.ledger_name) && (
                          <option value={t.ledger_name}>{t.ledger_name}</option>
                        )}
                      </select>
                      <ChevronDown className="absolute right-1.5 top-1.5 w-3 h-3 text-slate-400 pointer-events-none" />
                    </div>
                  ) : (
                    <input
                      value={t.ledger_name || ''}
                      onChange={e => updateLedger(globalIdx, e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      placeholder="Enter ledger…"
                    />
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  {approved ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                      <Check className="w-3 h-3" /> OK
                    </span>
                  ) : showApprove ? (
                    <button
                      onClick={() => {
                        setTransactions(prev => prev.map((tx, idx) =>
                          idx === globalIdx ? { ...tx, approval_status: 'confirmed' } : tx
                        ));
                      }}
                      className="text-[10px] px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200"
                    >
                      Confirm
                    </button>
                  ) : (
                    <span className="text-slate-300 text-[10px]">pending</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  // ════════════════════════════════════════════════════════════════════════════
  // Tab definitions
  // ════════════════════════════════════════════════════════════════════════════

  const TABS: { id: TabId; label: string; icon: any }[] = [
    { id: 'setup',    label: 'Client Setup',   icon: Settings   },
    { id: 'classify', label: 'Classify & Review', icon: Brain  },
    { id: 'tally',    label: 'Post to Tally',  icon: Send       },
    { id: 'dashboard',label: 'Dashboard',      icon: BarChart3  },
  ];

  // ════════════════════════════════════════════════════════════════════════════
  // Main render
  // ════════════════════════════════════════════════════════════════════════════

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-4">
        <button
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-indigo-600" />
          <h1 className="text-lg font-semibold text-slate-800">ML Bank Classifier</h1>
          <span className="text-xs px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full font-medium">Enterprise</span>
        </div>
        {orgId && (
          <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
            <span className="px-2 py-1 bg-slate-100 rounded font-mono">{orgId}</span>
            {accountId && <span className="px-2 py-1 bg-slate-100 rounded font-mono">{accountId}</span>}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="bg-white border-b border-slate-200 px-6">
        <div className="flex gap-1">
          {TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {tab.id === 'classify' && summary && (
                  <span className="ml-1 text-[10px] px-1.5 py-0.5 bg-indigo-100 text-indigo-600 rounded-full">
                    {summary.total}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">

        {/* ══════════════════════════════════════════════════════════════════
            TAB 1: Client Setup
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'setup' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Org + Account ID */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6">
              <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <Settings className="w-4 h-4 text-slate-500" /> Client / Account Identity
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Client / Org ID *</label>
                  <input
                    value={orgId}
                    onChange={e => setOrgId(e.target.value.trim())}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="e.g. sharma-traders"
                  />
                  <p className="text-xs text-slate-400 mt-1">Used for COA storage and model identity</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Bank Account ID *</label>
                  <input
                    value={accountId}
                    onChange={e => setAccountId(e.target.value.trim())}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="e.g. hdfc-current-001"
                  />
                  <p className="text-xs text-slate-400 mt-1">Separate model per bank account</p>
                </div>
              </div>
              {orgId && accountId && (
                <button
                  onClick={refreshModelStatus}
                  disabled={setupBusy === 'status'}
                  className="mt-3 flex items-center gap-2 text-xs text-indigo-600 hover:underline"
                >
                  {setupBusy === 'status'
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <RefreshCw className="w-3 h-3" />
                  }
                  Check model status
                </button>
              )}
            </div>

            {/* Model status card */}
            {modelMeta && (
              <div className="lg:col-span-2">
                <div className={`rounded-xl border p-4 ${modelMeta.exists ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                  <div className="flex items-start gap-3">
                    {modelMeta.exists
                      ? <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
                      : <AlertCircle  className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                    }
                    <div>
                      <p className={`text-sm font-medium ${modelMeta.exists ? 'text-emerald-800' : 'text-amber-800'}`}>
                        {modelMeta.exists ? 'Model ready' : 'No model trained yet'}
                      </p>
                      {modelMeta.exists && (
                        <div className="mt-1 flex flex-wrap gap-4 text-xs text-emerald-700">
                          <span>Samples: <strong>{modelMeta.n_samples ?? '—'}</strong></span>
                          <span>Classes: <strong>{modelMeta.classes?.length ?? '—'}</strong></span>
                          <span>CV Accuracy: <strong>{pct(modelMeta.accuracy)}</strong></span>
                          <span>Trained: <strong>{modelMeta.trained_at?.slice(0, 10) ?? '—'}</strong></span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* COA Upload */}
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h2 className="font-semibold text-slate-800 mb-1 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-slate-500" /> Chart of Accounts (Tally COA)
              </h2>
              <p className="text-xs text-slate-500 mb-4">
                Upload client's Tally ledger list. Used as dropdown options during review.
                Excel/CSV with columns: <code className="bg-slate-100 px-1 rounded">ledger_name</code>, <code className="bg-slate-100 px-1 rounded">ledger_group</code> (optional)
              </p>
              <input ref={coaRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={e => setCoaFile(e.target.files?.[0] || null)} />
              <button
                onClick={() => coaRef.current?.click()}
                className="w-full border-2 border-dashed border-slate-200 rounded-lg p-4 text-sm text-slate-500 hover:border-indigo-300 hover:text-indigo-500 transition-colors flex flex-col items-center gap-2"
              >
                <Upload className="w-5 h-5" />
                {coaFile ? coaFile.name : 'Click to select COA file'}
              </button>
              {coaFile && (
                <button
                  onClick={handleCoaUpload}
                  disabled={setupBusy === 'coa'}
                  className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {setupBusy === 'coa' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  Upload COA
                </button>
              )}
              {ledgerOptions.length > 0 && (
                <p className="mt-2 text-xs text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> {ledgerOptions.length} ledgers loaded
                </p>
              )}
            </div>

            {/* Train Model */}
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h2 className="font-semibold text-slate-800 mb-1 flex items-center gap-2">
                <Brain className="w-4 h-4 text-slate-500" /> Train ML Model
              </h2>
              <p className="text-xs text-slate-500 mb-4">
                Upload 3–5 years of historical Tally transactions (Excel/CSV) with columns:
                <code className="bg-slate-100 px-1 rounded ml-1">description</code>,
                <code className="bg-slate-100 px-1 rounded ml-1">ledger_name</code>.
                Minimum 4 labelled rows required.
              </p>
              <input ref={trainRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={e => setTrainFile(e.target.files?.[0] || null)} />
              <button
                onClick={() => trainRef.current?.click()}
                className="w-full border-2 border-dashed border-slate-200 rounded-lg p-4 text-sm text-slate-500 hover:border-indigo-300 hover:text-indigo-500 transition-colors flex flex-col items-center gap-2"
              >
                <FileText className="w-5 h-5" />
                {trainFile ? trainFile.name : 'Click to select historical data file'}
              </button>
              {trainFile && (
                <button
                  onClick={handleTrainModel}
                  disabled={setupBusy === 'train'}
                  className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700 disabled:opacity-50"
                >
                  {setupBusy === 'train' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
                  {setupBusy === 'train' ? 'Training…' : 'Train Model'}
                </button>
              )}
              <p className="mt-3 text-xs text-slate-400">
                Algorithm: TF-IDF + Voting(LogisticRegression, RandomForest). Model stored per account on the server.
              </p>
            </div>

            {/* Next step hint */}
            <div className="lg:col-span-2 bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-sm text-indigo-800 flex items-start gap-3">
              <Zap className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
              <div>
                <strong>Next:</strong> Once the model is trained, go to the <strong>Classify & Review</strong> tab.
                Upload this month's bank statement — the ML model will auto-classify transactions into 3 confidence tiers.
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB 2: Classify & Review
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'classify' && (
          <div className="space-y-6">

            {/* Upload + classify bar */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <Upload className="w-4 h-4 text-slate-500" /> Upload Bank Statement
              </h2>
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Bank</label>
                  <select
                    value={bankType}
                    onChange={e => setBankType(e.target.value)}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    {['AUTO','HDFC','ICICI','SBI','AXIS','KOTAK','YES','INDUSIND','FEDERAL','PNB','OTHER'].map(b =>
                      <option key={b} value={b}>{b}</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">PDF Mode</label>
                  <select
                    value={parseMode}
                    onChange={e => setParseMode(e.target.value)}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="auto">Auto</option>
                    <option value="digital">Digital PDF</option>
                    <option value="scanned">Scanned / OCR</option>
                  </select>
                </div>
                <div className="flex-1 min-w-48">
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Statement File</label>
                  <input ref={bankRef} type="file" accept=".pdf,.xlsx,.xls,.csv" className="hidden"
                    onChange={e => setBankFile(e.target.files?.[0] || null)} />
                  <button
                    onClick={() => bankRef.current?.click()}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-left text-slate-500 hover:border-indigo-300 flex items-center gap-2"
                  >
                    <FileText className="w-4 h-4 shrink-0" />
                    <span className="truncate">{bankFile ? bankFile.name : 'Choose PDF / Excel / CSV…'}</span>
                  </button>
                </div>
                <button
                  onClick={handleParseAndClassify}
                  disabled={!!classifyBusy || !bankFile}
                  className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
                >
                  {classifyBusy === 'parse'    && <><Loader2 className="w-4 h-4 animate-spin" /> Parsing…</>}
                  {classifyBusy === 'classify' && <><Loader2 className="w-4 h-4 animate-spin" /> Classifying…</>}
                  {!classifyBusy && <><Brain className="w-4 h-4" /> Parse & Classify</>}
                </button>
              </div>
            </div>

            {/* Summary pills */}
            {summary && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Total',   val: summary.total,  color: 'bg-slate-100 text-slate-700' },
                  { label: 'Auto ✓',  val: summary.auto,   color: 'bg-emerald-100 text-emerald-700' },
                  { label: 'Review',  val: summary.review, color: 'bg-amber-100 text-amber-700'   },
                  { label: 'Manual',  val: summary.manual, color: 'bg-rose-100 text-rose-700'     },
                ].map(s => (
                  <div key={s.label} className={`rounded-lg p-3 ${s.color}`}>
                    <p className="text-2xl font-bold">{s.val}</p>
                    <p className="text-xs font-medium mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
            )}

            {transactions.length > 0 && (
              <>
                {/* Action bar */}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => bulkApprove('auto')}
                    className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700"
                  >
                    <CheckCircle2 className="w-3 h-3" /> Approve all Auto
                  </button>
                  <button
                    onClick={() => bulkApprove('review')}
                    className="flex items-center gap-2 px-3 py-1.5 bg-amber-500 text-white text-xs rounded-lg hover:bg-amber-600"
                  >
                    <Check className="w-3 h-3" /> Confirm all Review
                  </button>
                  <button
                    onClick={handleExportReview}
                    className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 text-xs rounded-lg hover:bg-slate-50"
                  >
                    <Download className="w-3 h-3" /> Export Review CSV
                  </button>
                  {/* Hidden file input for sync-corrections */}
                  <label className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 text-xs rounded-lg hover:bg-slate-50 cursor-pointer">
                    <RefreshCw className="w-3 h-3" /> Sync Corrections
                    <input type="file" accept=".csv" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleSyncCorrections(f); e.target.value = ''; }} />
                  </label>
                  <div className="ml-auto text-xs text-slate-500 flex items-center gap-1">
                    <Check className="w-3 h-3 text-emerald-500" />
                    {approvedCnt} / {transactions.length} approved
                  </div>
                </div>

                {/* Auto tier */}
                {autoTxns.length > 0 && (
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 bg-emerald-50 border-b border-emerald-100 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span className="text-sm font-semibold text-emerald-800">
                        Auto-approved ({autoTxns.length}) — confidence ≥ 90%
                      </span>
                    </div>
                    <TxnTable txns={autoTxns} showApprove={false} />
                  </div>
                )}

                {/* Review tier */}
                {reviewTxns.length > 0 && (
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
                      <Eye className="w-4 h-4 text-amber-600" />
                      <span className="text-sm font-semibold text-amber-800">
                        Needs Review ({reviewTxns.length}) — confidence 70–89%
                      </span>
                    </div>
                    <TxnTable txns={reviewTxns} showApprove={true} />
                  </div>
                )}

                {/* Manual tier */}
                {manualTxns.length > 0 && (
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 bg-rose-50 border-b border-rose-100 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-600" />
                      <span className="text-sm font-semibold text-rose-800">
                        Manual Classification Required ({manualTxns.length}) — confidence &lt; 70%
                      </span>
                      <span className="ml-auto text-xs text-rose-500">Select ledger and click Confirm</span>
                    </div>
                    <TxnTable txns={manualTxns} showApprove={true} />
                  </div>
                )}

                {/* Go to Tally */}
                {approvedCnt > 0 && (
                  <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-center gap-4">
                    <Send className="w-5 h-5 text-indigo-500 shrink-0" />
                    <div className="flex-1 text-sm text-indigo-800">
                      <strong>{approvedCnt}</strong> transactions approved and ready to post.
                    </div>
                    <button
                      onClick={() => setActiveTab('tally')}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
                    >
                      Post to Tally <Send className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </>
            )}

            {transactions.length === 0 && !classifyBusy && (
              <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
                <Brain className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Upload a bank statement above to classify transactions.</p>
                <p className="text-xs mt-1">Make sure the ML model is trained in the Setup tab first.</p>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB 3: Post to Tally
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'tally' && (
          <div className="space-y-6">

            {/* Session summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Total Txns',    val: transactions.length },
                { label: 'Auto-approved', val: transactions.filter(t => t.approval_status === 'auto_approved').length },
                { label: 'Confirmed',     val: transactions.filter(t => t.approval_status === 'confirmed').length },
                { label: 'Ready to Post', val: approvedCnt },
              ].map(s => (
                <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-4">
                  <p className="text-2xl font-bold text-slate-800">{s.val}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Approval breakdown by method */}
            {transactions.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h2 className="font-semibold text-slate-800 mb-4">Approval Breakdown</h2>
                <div className="space-y-3">
                  {[
                    { label: 'Auto-approved (ML confidence ≥ 90%)', status: 'auto_approved',    color: 'bg-emerald-500' },
                    { label: 'Manually confirmed by reviewer',       status: 'confirmed',        color: 'bg-indigo-500'  },
                    { label: 'Excel correction synced',             status: 'excel_corrected',  color: 'bg-violet-500'  },
                    { label: 'Pending / not yet approved',          status: 'pending',           color: 'bg-slate-300'   },
                    { label: 'Flagged manual (not posting)',        status: 'manual',            color: 'bg-rose-400'    },
                  ].map(s => {
                    const cnt = transactions.filter(t => t.approval_status === s.status).length;
                    const pct_ = transactions.length > 0 ? (cnt / transactions.length) * 100 : 0;
                    return (
                      <div key={s.status} className="flex items-center gap-3">
                        <div className="w-36 text-xs text-slate-600 shrink-0">{s.label.split('(')[0].trim()}</div>
                        <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                          <div className={`h-full rounded-full ${s.color}`} style={{ width: `${pct_}%` }} />
                        </div>
                        <span className="text-xs font-mono text-slate-600 w-8 text-right">{cnt}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tally config */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <Send className="w-4 h-4 text-slate-500" /> Tally Export Settings
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Bank Ledger Name in Tally *</label>
                  <input
                    value={bankLedger}
                    onChange={e => setBankLedger(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="e.g. HDFC Current Account"
                  />
                  <p className="text-xs text-slate-400 mt-1">Must match exactly the ledger name in Tally Prime</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Company Name (optional)</label>
                  <input
                    value={companyName}
                    onChange={e => setCompanyName(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="e.g. Sharma Traders Pvt Ltd"
                  />
                </div>
              </div>

              {approvedCnt === 0 && transactions.length > 0 && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  No approved transactions yet. Go to Classify & Review tab and approve transactions first.
                </div>
              )}

              <button
                onClick={handlePostTally}
                disabled={tallyBusy || approvedCnt === 0 || !bankLedger}
                className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                {tallyBusy
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
                  : <><Download className="w-4 h-4" /> Download Tally XML ({approvedCnt} vouchers)</>
                }
              </button>
              <p className="mt-2 text-xs text-slate-400">
                In Tally Prime: Gateway → Import Data → select the downloaded XML file.
              </p>
            </div>

            {transactions.length === 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
                <Send className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No transactions loaded. Go to Classify & Review to upload and classify a statement.</p>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB 4: Dashboard
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">

            {/* KPI row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Sessions Posted',    val: sessions.length },
                { label: 'Total Transactions', val: sessions.reduce((s, x) => s + x.total, 0) },
                { label: 'Auto-classified',    val: sessions.reduce((s, x) => s + x.auto, 0) },
                { label: 'Human Confirmed',    val: sessions.reduce((s, x) => s + x.confirmed, 0) },
              ].map(k => (
                <div key={k.label} className="bg-white rounded-xl border border-slate-200 p-4">
                  <p className="text-3xl font-bold text-slate-800">{k.val}</p>
                  <p className="text-xs text-slate-500 mt-1">{k.label}</p>
                </div>
              ))}
            </div>

            {/* Model status */}
            {modelMeta?.exists && (
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h2 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                  <Brain className="w-4 h-4 text-slate-500" /> Model Health
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-slate-500">Training Samples</p>
                    <p className="text-lg font-bold text-slate-800">{modelMeta.n_samples ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">CV Accuracy</p>
                    <p className="text-lg font-bold text-slate-800">{pct(modelMeta.accuracy)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Ledger Classes</p>
                    <p className="text-lg font-bold text-slate-800">{modelMeta.classes?.length ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Last Trained</p>
                    <p className="text-lg font-bold text-slate-800">{modelMeta.trained_at?.slice(0, 10) ?? '—'}</p>
                  </div>
                </div>
                {modelMeta.classes && modelMeta.classes.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-medium text-slate-600 mb-2">Known Ledger Classes</p>
                    <div className="flex flex-wrap gap-1.5">
                      {modelMeta.classes.map(c => (
                        <span key={c} className="text-[11px] px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full border border-indigo-100">
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Session history */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100">
                <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-slate-500" /> Session History
                </h2>
              </div>
              {sessions.length === 0 ? (
                <div className="p-10 text-center text-slate-400">
                  <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No sessions posted yet. Sessions appear here after you post to Tally.</p>
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 uppercase text-[10px]">
                      <th className="px-4 py-2 text-left">Date</th>
                      <th className="px-4 py-2 text-left">File</th>
                      <th className="px-4 py-2 text-right">Total</th>
                      <th className="px-4 py-2 text-right">Auto</th>
                      <th className="px-4 py-2 text-right">Confirmed</th>
                      <th className="px-4 py-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map(s => (
                      <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-2">{s.date}</td>
                        <td className="px-4 py-2 text-slate-600 max-w-xs truncate" title={s.file}>{s.file}</td>
                        <td className="px-4 py-2 text-right">{s.total}</td>
                        <td className="px-4 py-2 text-right text-emerald-600">{s.auto}</td>
                        <td className="px-4 py-2 text-right text-indigo-600">{s.confirmed}</td>
                        <td className="px-4 py-2 text-center">
                          {s.posted
                            ? <span className="text-emerald-600 flex items-center justify-center gap-1"><CheckCircle2 className="w-3 h-3" /> Posted</span>
                            : <span className="text-slate-400">Draft</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Workflow guide */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-500" /> ML Workflow Guide
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { step: '1', title: 'Setup',    desc: 'Upload Tally COA. Train model with 3–5 yrs of historical bank transactions.',    icon: Settings,      color: 'text-slate-600 bg-slate-50 border-slate-200' },
                  { step: '2', title: 'Classify', desc: 'Upload new bank statement. ML model auto-classifies into 3 confidence tiers.',    icon: Brain,         color: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
                  { step: '3', title: 'Review',   desc: 'Approve auto tier. Correct review/manual rows or export CSV for offline fixing.', icon: Eye,           color: 'text-amber-600 bg-amber-50 border-amber-200' },
                  { step: '4', title: 'Post',     desc: 'Generate Tally XML. Import in Tally Prime. Model learns from corrections.',       icon: Send,          color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
                ].map(s => {
                  const Icon = s.icon;
                  return (
                    <div key={s.step} className={`rounded-lg border p-4 ${s.color}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-bold opacity-60">STEP {s.step}</span>
                        <Icon className="w-4 h-4 ml-auto" />
                      </div>
                      <p className="font-semibold text-sm mb-1">{s.title}</p>
                      <p className="text-xs opacity-75">{s.desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
