/**
 * Bank Reconciliation — 3-step AI matching UI
 * ENBD / FAB / ADCB / RAKBank / DIB
 */
import { useEffect, useState } from 'react';
import { Landmark, Upload, Zap, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import * as svc from '../../services/uaeFullAccounting.service';
import type { BankAccount, BankStatement } from '../../services/uaeFullAccounting.service';

const BANKS = ['ENBD', 'FAB', 'ADCB', 'RAKBank', 'DIB'];

const STATUS_STYLE: Record<string, string> = {
  pending:     'text-amber-400',
  partial:     'text-orange-400',
  reconciled:  'text-green-400',
};

export default function BankReconciliation() {
  const [accounts, setAccounts]       = useState<BankAccount[]>([]);
  const [statements, setStatements]   = useState<BankStatement[]>([]);
  const [selectedAcct, setSelectedAcct] = useState('');
  const [bankName, setBankName]       = useState('ENBD');
  const [stmtDate, setStmtDate]       = useState('');
  const [opening, setOpening]         = useState('');
  const [closing, setClosing]         = useState('');
  const [file, setFile]               = useState<File | null>(null);
  const [importing, setImporting]     = useState(false);
  const [reconciling, setReconciling] = useState<string>('');
  const [summary, setSummary]         = useState<Record<string, any> | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [msg, setMsg]                 = useState('');
  const [reconJEAmount, setReconJEAmount] = useState('');
  const [reconJEDesc, setReconJEDesc]     = useState('');
  const [creatingJE, setCreatingJE]       = useState(false);
  const [suggestedJE, setSuggestedJE]     = useState<any>(null);

  const load = () => {
    setLoading(true);
    Promise.all([svc.listBankAccounts(), svc.listStatements()])
      .then(([ba, st]) => {
        setAccounts(ba.accounts);
        setStatements(st.statements);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleImport = async () => {
    if (!selectedAcct || !file || !stmtDate) return;
    setImporting(true); setError(''); setMsg('');
    const fd = new FormData();
    fd.append('file', file);
    const base = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:8000';
    const tenantId = localStorage.getItem('tenantId');
    const params = new URLSearchParams({
      bank_name: bankName, statement_date: stmtDate,
      opening_balance: opening || '0', closing_balance: closing || '0',
    });
    try {
      const res = await fetch(
        `${base}/api/uae/full/bank-accounts/${selectedAcct}/import-statement?${params}`,
        { method: 'POST', headers: { 'X-Tenant-ID': tenantId }, body: fd }
      );
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setMsg(`Imported ${data.lines} statement lines (ID: ${data.statement_id})`);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setImporting(false);
    }
  };

  const handleCreateReconJE = async () => {
    setCreatingJE(true);
    setSuggestedJE(null);
    try {
      const res = await fetch('/api/uae/accounting/recon-to-je', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: parseFloat(reconJEAmount) || 0, description: reconJEDesc || 'Unmatched bank item' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSuggestedJE(data.suggested_je);
    } catch (e: any) {
      setError(`JE creation failed: ${e.message}`);
    } finally {
      setCreatingJE(false);
    }
  };

  const handleReconcile = async (stmtId: string) => {
    setReconciling(stmtId); setSummary(null); setError('');
    try {
      const result = await svc.reconcileStatement(stmtId);
      setSummary(result);
      setMsg(`Reconciliation complete — ${result.exact + result.fuzzy + result.ai} matched, ${result.unmatched} unmatched`);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setReconciling('');
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Bank Reconciliation</h1>
          <p className="text-gray-400 text-sm mt-1">AI-assisted 3-step matching: exact → fuzzy → Claude</p>
        </div>
        <button onClick={load} className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg"><RefreshCw size={14} /></button>
      </div>

      {(error || msg) && (
        <div className={`rounded-lg p-3 mb-4 text-sm ${error ? 'bg-red-900/40 text-red-300 border border-red-700' : 'bg-green-900/40 text-green-300 border border-green-700'}`}>
          {error || msg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Import Panel */}
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Upload size={14} className="text-blue-400" /> Import Statement
          </h2>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Bank Account</label>
              <select
                value={selectedAcct}
                onChange={e => setSelectedAcct(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">Select account…</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.bank_name} — {a.account_number}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Bank Format</label>
              <select
                value={bankName}
                onChange={e => setBankName(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              >
                {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Statement Date</label>
              <input
                type="date" value={stmtDate} onChange={e => setStmtDate(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Opening Balance</label>
                <input
                  type="number" value={opening} onChange={e => setOpening(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Closing Balance</label>
                <input
                  type="number" value={closing} onChange={e => setClosing(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">CSV File</label>
              <input
                type="file" accept=".csv,.txt"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-gray-400 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-blue-700 file:text-white hover:file:bg-blue-600"
              />
            </div>
            <button
              onClick={handleImport}
              disabled={importing || !selectedAcct || !file}
              className="w-full bg-blue-700 hover:bg-blue-600 disabled:opacity-50 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {importing ? 'Importing…' : 'Import Statement'}
            </button>
          </div>
        </div>

        {/* Statements List */}
        <div className="lg:col-span-2 bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700 bg-gray-800/80">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Landmark size={14} className="text-green-400" /> Bank Statements
            </h2>
          </div>
          <div className="divide-y divide-gray-700/50">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="px-4 py-4 flex gap-3 animate-pulse">
                  <div className="flex-1 h-4 bg-gray-700 rounded" />
                  <div className="w-24 h-4 bg-gray-700 rounded" />
                </div>
              ))
            ) : statements.length === 0 ? (
              <div className="px-4 py-12 text-center text-gray-500 text-sm">
                No statements yet — import a bank CSV to start reconciling.
              </div>
            ) : (
              statements.map(s => (
                <div key={s.id} className="px-4 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-white font-medium">{s.statement_date}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Opening: AED {s.opening_balance.toLocaleString()} →
                        Closing: AED {s.closing_balance.toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-medium ${STATUS_STYLE[s.status] ?? 'text-gray-400'}`}>
                        {s.status}
                      </span>
                      <button
                        onClick={() => handleReconcile(s.id)}
                        disabled={!!reconciling}
                        className="flex items-center gap-1 text-xs bg-purple-700 hover:bg-purple-600 disabled:opacity-50 px-3 py-1.5 rounded-lg text-white transition-colors"
                      >
                        <Zap size={12} />
                        {reconciling === s.id ? 'Matching…' : 'Run AI Match'}
                      </button>
                    </div>
                  </div>
                  {summary && reconciling === '' && statements[0]?.id === s.id && (
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      {[
                        { l: 'Exact', v: summary.exact,     c: 'text-green-400' },
                        { l: 'Fuzzy', v: summary.fuzzy,     c: 'text-blue-400' },
                        { l: 'AI',    v: summary.ai,        c: 'text-purple-400' },
                        { l: 'Unmatched',v:summary.unmatched,c:'text-red-400' },
                      ].map(b => (
                        <div key={b.l} className="bg-gray-900/60 rounded-lg p-2 text-center">
                          <p className="text-xs text-gray-500">{b.l}</p>
                          <p className={`text-sm font-bold ${b.c}`}>{b.v}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Unmatched → JE section */}
      <div className="mt-6 bg-amber-950/40 border border-amber-700/60 rounded-xl p-5">
        <p className="text-sm text-amber-300 font-semibold mb-1">Unmatched items can create Journal Entries automatically</p>
        <p className="text-xs text-gray-400 mb-4">Enter the amount and description for any unmatched bank transaction to get a suggested JE.</p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Amount (AED)</label>
            <input
              type="number"
              value={reconJEAmount}
              onChange={e => setReconJEAmount(e.target.value)}
              placeholder="0.00"
              className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white w-36 focus:outline-none focus:border-amber-500"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-gray-400 block mb-1">Description</label>
            <input
              type="text"
              value={reconJEDesc}
              onChange={e => setReconJEDesc(e.target.value)}
              placeholder="Bank charges, fees…"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
            />
          </div>
          <button
            onClick={handleCreateReconJE}
            disabled={creatingJE || !reconJEAmount}
            className="flex items-center gap-2 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors"
          >
            {creatingJE ? 'Creating…' : 'Create JE for Unmatched'}
          </button>
        </div>
        {suggestedJE && (
          <div className="mt-4 bg-gray-900/60 border border-gray-700 rounded-lg p-4 text-sm">
            <p className="text-xs text-gray-400 mb-2 font-semibold uppercase tracking-wider">Suggested Journal Entry</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-gray-500">Debit</p>
                <p className="text-white font-mono">{suggestedJE.debit_account} — {suggestedJE.debit_name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Credit</p>
                <p className="text-white font-mono">{suggestedJE.credit_account} — {suggestedJE.credit_name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Amount (AED)</p>
                <p className="text-amber-400 font-semibold">{(suggestedJE.amount ?? suggestedJE.amount_aed ?? 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Description</p>
                <p className="text-gray-300">{suggestedJE.description}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Method legend */}
      <div className="mt-6 bg-gray-800/40 border border-gray-700/50 rounded-xl p-4">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Matching Steps</h3>
        <div className="grid grid-cols-3 gap-4">
          {[
            { step: '1', label: 'Exact Match', desc: 'Amount + Date + Reference — 100% confidence', color: 'text-green-400' },
            { step: '2', label: 'Fuzzy Match', desc: 'Amount ±0.01 AED + Date ±3 days', color: 'text-blue-400' },
            { step: '3', label: 'Claude AI Match', desc: 'Semantic description matching — last resort', color: 'text-purple-400' },
          ].map(m => (
            <div key={m.step} className="flex gap-3">
              <span className={`text-lg font-bold ${m.color}`}>{m.step}</span>
              <div>
                <p className="text-xs font-medium text-white">{m.label}</p>
                <p className="text-xs text-gray-500">{m.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
