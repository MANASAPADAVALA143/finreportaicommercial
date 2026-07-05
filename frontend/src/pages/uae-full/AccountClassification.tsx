/**
 * AI Account Classification — map GL accounts to BS/PL, Cash Flow, CIT, IFRS notes
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Bot, RefreshCw, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import * as svc from '../../services/accountClassification.service';
import type { ClassifiedAccount, ClassificationSummary } from '../../services/accountClassification.service';

const ROW_BG: Record<string, string> = {
  not_classified: 'bg-red-950/40',
  partial: 'bg-amber-950/30',
  classified: 'bg-gray-900/40',
};

function fmt(n: number) {
  return `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2 })}`;
}

export default function AccountClassification() {
  const [accounts, setAccounts] = useState<ClassifiedAccount[]>([]);
  const [summary, setSummary] = useState<ClassificationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [classifying, setClassifying] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<ClassifiedAccount>>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await svc.fetchAccounts();
      setAccounts(data.accounts);
      setSummary(data.summary);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load accounts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const missingAccounts = useMemo(
    () => accounts.filter((a) => a.status !== 'classified'),
    [accounts],
  );

  const handleAIClassify = async () => {
    setClassifying(true);
    setProgress('Balance Sheet & P&L — processing…');
    try {
      await svc.aiClassify();
      setProgress('Balance Sheet & P&L — completed ✓');
      toast.success('AI classification complete');
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'AI classification failed');
    } finally {
      setClassifying(false);
      setShowModal(false);
      setProgress(null);
    }
  };

  const handleSaveRow = async (acct: ClassifiedAccount) => {
    const patch = edits[acct.account_id] ?? {};
    try {
      await svc.manualClassify(acct.account_id, {
        bs_pl_main: patch.bs_pl_main ?? acct.bs_pl_main,
        bs_pl_sub: patch.bs_pl_sub ?? acct.bs_pl_sub,
        fs_note_number: patch.fs_note_number ?? acct.fs_note_number,
        cash_flow_category: patch.cash_flow_category ?? acct.cash_flow_category,
        cit_category: patch.cit_category ?? acct.cit_category,
        cit_add_back: patch.cit_add_back ?? acct.cit_add_back,
      });
      toast.success(`Saved ${acct.account_code}`);
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const handleClear = async () => {
    if (!window.confirm('Clear all classifications?')) return;
    try {
      await svc.clearClassifications();
      toast.success('Classifications cleared');
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Clear failed');
    }
  };

  const pct = summary?.classification_pct ?? 0;
  const ready = summary?.ready_for_fs ?? false;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      {/* Status bar */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">Classify Accounts</h1>
        <p className="text-gray-400 text-sm mb-4">AI maps GL accounts to BS/PL, Cash Flow, CIT & IFRS notes</p>
        {summary && (
          <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-gray-300">
                  Progress: <span className="font-semibold text-white">{summary.classified} of {summary.total_accounts}</span> accounts classified ({pct}%)
                </p>
                <div className="mt-2 flex h-2 w-full max-w-md rounded-full overflow-hidden bg-gray-700">
                  <div className="bg-green-500" style={{ width: `${(summary.classified / Math.max(summary.total_accounts, 1)) * 100}%` }} />
                  <div className="bg-amber-500" style={{ width: `${(summary.partial / Math.max(summary.total_accounts, 1)) * 100}%` }} />
                  <div className="bg-red-500" style={{ width: `${(summary.not_classified / Math.max(summary.total_accounts, 1)) * 100}%` }} />
                </div>
              </div>
              {ready ? (
                <div className="flex items-center gap-2 text-green-400 font-semibold text-sm">
                  <CheckCircle2 size={16} /> Classification Status: All Clear ✓
                </div>
              ) : (
                <div className="flex items-center gap-2 text-red-400 font-semibold text-sm bg-red-950/50 px-3 py-2 rounded-lg border border-red-800">
                  <AlertTriangle size={16} /> {missingAccounts.length} Accounts Need Attention
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Buttons */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setShowModal(true)}
          disabled={classifying}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Bot size={14} /> Auto-Assign Classes
        </button>
        <button onClick={() => void handleAIClassify()} disabled={classifying}
          className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm">
          Auto-Allocate Notes
        </button>
        <button onClick={() => void handleAIClassify()} disabled={classifying}
          className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm">
          AI Re-Align Notes
        </button>
        <button className="bg-amber-800/60 hover:bg-amber-700/60 px-4 py-2 rounded-lg text-sm text-amber-200">
          AI Forensic Review
        </button>
        <button onClick={() => void handleClear()}
          className="flex items-center gap-2 bg-red-900/60 hover:bg-red-800/60 px-4 py-2 rounded-lg text-sm text-red-200">
          <Trash2 size={14} /> Clear Classifications
        </button>
        <button onClick={() => void load()} className="ml-auto flex items-center gap-2 bg-gray-700 px-3 py-2 rounded-lg text-sm">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Main table */}
      <div className="bg-gray-800/40 border border-gray-700 rounded-xl overflow-x-auto mb-8">
        <table className="w-full text-sm min-w-[1300px]">
          <thead className="bg-gray-800/80 text-gray-400 text-xs uppercase">
            <tr>
              <th className="px-3 py-3 text-left">Sr</th>
              <th className="px-3 py-3 text-left">ACC Code</th>
              <th className="px-3 py-3 text-left">Account Name</th>
              <th className="px-3 py-3 text-right">Balance</th>
              <th className="px-3 py-3 text-left">1st BS PLS</th>
              <th className="px-3 py-3 text-left">2nd BS PLS</th>
              <th className="px-3 py-3 text-left">Note BS/PLS</th>
              <th className="px-3 py-3 text-left">Note Cash Flow</th>
              <th className="px-3 py-3 text-left">CIT Category</th>
              <th className="px-3 py-3 text-center">CIT Add-back</th>
              <th className="px-3 py-3 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            ) : accounts.map((a, i) => {
              const edit = edits[a.account_id] ?? {};
              return (
                <tr key={a.account_id} className={`border-t border-gray-700/50 ${ROW_BG[a.status]}`}>
                  <td className="px-3 py-2 text-gray-500">{i + 1}</td>
                  <td className="px-3 py-2 font-mono text-teal-400">{a.account_code}</td>
                  <td className="px-3 py-2">{a.account_name}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(a.balance)}</td>
                  <td className="px-3 py-2">
                    <select
                      value={edit.bs_pl_main ?? a.bs_pl_main ?? ''}
                      onChange={(e) => setEdits((p) => ({ ...p, [a.account_id]: { ...p[a.account_id], bs_pl_main: e.target.value } }))}
                      className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs w-full max-w-[160px]"
                    >
                      <option value="">—</option>
                      {svc.BS_PL_MAIN_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={edit.bs_pl_sub ?? a.bs_pl_sub ?? ''}
                      onChange={(e) => setEdits((p) => ({ ...p, [a.account_id]: { ...p[a.account_id], bs_pl_sub: e.target.value } }))}
                      className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs w-full max-w-[140px]"
                      placeholder="Sub-category"
                    />
                  </td>
                  <td className="px-3 py-2 text-xs">{a.fs_note_number ?? '—'}</td>
                  <td className="px-3 py-2">
                    <select
                      value={edit.cash_flow_category ?? a.cash_flow_category ?? ''}
                      onChange={(e) => setEdits((p) => ({ ...p, [a.account_id]: { ...p[a.account_id], cash_flow_category: e.target.value } }))}
                      className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs w-full max-w-[120px]"
                    >
                      <option value="">—</option>
                      {svc.CASH_FLOW_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={edit.cit_category ?? a.cit_category ?? ''}
                      onChange={(e) => setEdits((p) => ({ ...p, [a.account_id]: { ...p[a.account_id], cit_category: e.target.value } }))}
                      className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs w-full max-w-[140px]"
                    >
                      <option value="">—</option>
                      {svc.CIT_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={edit.cit_add_back ?? a.cit_add_back ?? false}
                      onChange={(e) => setEdits((p) => ({ ...p, [a.account_id]: { ...p[a.account_id], cit_add_back: e.target.checked } }))}
                      className="rounded"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => void handleSaveRow(a)}
                      className="bg-emerald-700 hover:bg-emerald-600 px-2 py-1 rounded text-xs">
                      Save
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Missing classifications */}
      {missingAccounts.length > 0 && (
        <div className="bg-red-950/30 border border-red-800 rounded-xl p-5">
          <h3 className="text-red-300 font-semibold mb-1">Accounts with Transactions Missing Required Classifications</h3>
          <p className="text-red-400 text-sm mb-4">{missingAccounts.length} Accounts Need Attention</p>
          <table className="w-full text-sm">
            <thead className="text-gray-400 text-xs">
              <tr>
                <th className="text-left py-2">Code</th>
                <th className="text-left py-2">Account Name</th>
                <th className="text-right py-2">Balance</th>
                <th className="text-left py-2">Missing Classifications</th>
              </tr>
            </thead>
            <tbody>
              {missingAccounts.map((a) => (
                <tr key={a.account_id} className="border-t border-red-900/50">
                  <td className="py-2 font-mono text-teal-400">{a.account_code}</td>
                  <td className="py-2">{a.account_name}</td>
                  <td className="py-2 text-right font-mono">{fmt(a.balance)}</td>
                  <td className="py-2 flex flex-wrap gap-1">
                    {a.missing_classifications.map((m) => (
                      <span key={m} className="bg-red-900/60 text-red-200 text-xs px-2 py-0.5 rounded">{m}</span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* AI modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-md w-full">
            <h3 className="text-lg font-bold text-white mb-4">AI Classification</h3>
            <div className="space-y-2 text-sm text-gray-300 mb-6">
              {['Balance Sheet & P&L', 'Statement of Changes in Equity', 'Cash Flow Statement', 'Corporate Tax Return', 'CIT Tax Impact'].map((label) => (
                <label key={label} className="flex items-center gap-2">
                  <input type="checkbox" defaultChecked={!label.includes('CIT Tax')} className="rounded" />
                  {label}
                </label>
              ))}
            </div>
            {progress && <p className="text-sm text-blue-300 mb-4">{progress}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 rounded-lg bg-gray-700 text-sm">Cancel</button>
              <button onClick={() => void handleAIClassify()} disabled={classifying}
                className="px-4 py-2 rounded-lg bg-blue-600 text-sm font-medium disabled:opacity-50">
                {classifying ? 'Processing…' : 'Start AI Classification'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
