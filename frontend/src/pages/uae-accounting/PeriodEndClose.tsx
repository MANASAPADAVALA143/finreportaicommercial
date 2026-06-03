/**
 * Period-End Close — 9-item checklist + period lock
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Lock, Play, RefreshCw } from 'lucide-react';
import * as svc from '../../services/uaeFullAccounting.service';
import type { PeriodClose } from '../../services/uaeFullAccounting.service';

const THIS_PERIOD = new Date().toISOString().slice(0, 7);

const CHECKLIST_LABELS: Record<string, string> = {
  bank_reconciliation:         'Bank Reconciliation completed',
  ar_invoice_review:           'AR Invoices reviewed & posted',
  accruals_posted:             'All accruals (incl. EOSB) posted',
  fixed_asset_depreciation:    'Fixed Asset depreciation run',
  vat_return_prepared:         'UAE VAT Return prepared (FTA)',
  intercompany_eliminations:   'Intercompany eliminations done',
  prepayments_amortised:       'Prepayments amortised',
  payroll_posted:              'Payroll journal posted',
  management_accounts_reviewed:'Management Accounts reviewed & approved',
};

const STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  open:           { label: 'Open',           color: 'text-amber-400',  bg: 'bg-amber-900/30 border-amber-700' },
  ready_to_close: { label: 'Ready to Close', color: 'text-green-400',  bg: 'bg-green-900/30 border-green-700' },
  closed:         { label: 'Closed',         color: 'text-gray-400',   bg: 'bg-gray-700/40 border-gray-600' },
};

export default function PeriodEndClose() {
  const [runs, setRuns]             = useState<PeriodClose[]>([]);
  const [activeRun, setActiveRun]   = useState<PeriodClose | null>(null);
  const [period, setPeriod]         = useState(THIS_PERIOD);
  const [loading, setLoading]       = useState(true);
  const [starting, setStarting]     = useState(false);
  const [locking, setLocking]       = useState(false);
  const [error, setError]           = useState('');
  const [msg, setMsg]               = useState('');

  const load = () => {
    setLoading(true);
    svc.listCloseRuns()
      .then(d => {
        setRuns(d.runs);
        const current = d.runs.find(r => r.period === period) ?? null;
        setActiveRun(current);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [period]);

  const handleStart = async () => {
    setStarting(true); setError('');
    try {
      const r = await svc.startClose(period);
      setMsg(`Close run started for ${period}`);
      const run: PeriodClose = { id: r.id, period: r.period, status: r.status, is_locked: false, checklist: r.checklist };
      setActiveRun(run);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  };

  const handleCheck = async (item: string, done: boolean) => {
    if (!activeRun) return;
    try {
      const r = await svc.updateChecklist(activeRun.id, item, done);
      setActiveRun(prev => prev ? { ...prev, checklist: r.checklist, status: r.status } : null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleLock = async () => {
    if (!activeRun) return;
    setLocking(true); setError('');
    try {
      await svc.lockPeriod(activeRun.id);
      setMsg(`Period ${period} locked successfully. GL entries are now immutable.`);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLocking(false);
    }
  };

  const checklist    = activeRun?.checklist ?? {};
  const totalItems   = Object.keys(CHECKLIST_LABELS).length;
  const doneItems    = Object.values(checklist).filter(Boolean).length;
  const progress     = totalItems ? Math.round(doneItems / totalItems * 100) : 0;
  const allDone      = doneItems === totalItems;
  const statusInfo   = STATUS_STYLE[activeRun?.status ?? 'open'];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Period-End Close</h1>
          <p className="text-gray-400 text-sm mt-1">9-item checklist + period lock</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month" value={period}
            onChange={e => setPeriod(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm"
          />
          <button onClick={load} className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg"><RefreshCw size={14} /></button>
        </div>
      </div>

      {(error || msg) && (
        <div className={`rounded-lg p-3 mb-4 text-sm ${error ? 'bg-red-900/40 text-red-300 border border-red-700' : 'bg-green-900/40 text-green-300 border border-green-700'}`}>
          {error || msg}
        </div>
      )}

      {!activeRun ? (
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-12 text-center">
          <Play size={32} className="text-green-400 mx-auto mb-4" />
          <p className="text-white font-semibold mb-2">No close run for {period}</p>
          <p className="text-gray-400 text-sm mb-6">Start the period-end close process to begin tracking completion.</p>
          <button
            onClick={handleStart}
            disabled={starting}
            className="bg-green-700 hover:bg-green-600 disabled:opacity-50 px-6 py-2.5 rounded-lg text-sm font-medium"
          >
            {starting ? 'Starting…' : `Start Close for ${period}`}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Progress Panel */}
          <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">Progress</h2>
              <span className={`text-xs border px-2 py-0.5 rounded-full ${statusInfo.bg} ${statusInfo.color}`}>
                {statusInfo.label}
              </span>
            </div>

            {/* Progress bar */}
            <div className="mb-4">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>{doneItems} of {totalItems} complete</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${allDone ? 'bg-green-500' : 'bg-amber-500'}`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* Lock button */}
            {!activeRun.is_locked && (
              <button
                onClick={handleLock}
                disabled={!allDone || locking}
                className="w-full flex items-center justify-center gap-2 bg-red-700 hover:bg-red-600 disabled:opacity-40 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                <Lock size={14} /> {locking ? 'Locking…' : 'Lock Period'}
              </button>
            )}
            {activeRun.is_locked && (
              <div className="flex items-center justify-center gap-2 bg-gray-700/60 border border-gray-600 py-2.5 rounded-lg text-sm text-gray-400">
                <Lock size={14} /> Period Locked
              </div>
            )}

            {!allDone && !activeRun.is_locked && (
              <p className="text-xs text-gray-500 text-center mt-2">
                Complete all {totalItems} items to lock the period
              </p>
            )}

            {/* Recent runs */}
            {runs.length > 1 && (
              <div className="mt-6">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Recent Periods</p>
                <div className="space-y-1">
                  {runs.slice(0, 5).map(r => (
                    <button
                      key={r.id}
                      onClick={() => { setPeriod(r.period); setActiveRun(r); }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors ${r.period === period ? 'bg-gray-700' : 'hover:bg-gray-700/50'}`}
                    >
                      <span className="text-white">{r.period}</span>
                      <span className={STATUS_STYLE[r.status]?.color ?? 'text-gray-400'}>{r.status}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Checklist */}
          <div className="lg:col-span-2 bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-700 bg-gray-800/80">
              <h2 className="text-sm font-semibold text-white">Close Checklist — {period}</h2>
            </div>
            <div className="divide-y divide-gray-700/50">
              {Object.entries(CHECKLIST_LABELS).map(([key, label], idx) => {
                const done = checklist[key] === true;
                return (
                  <div key={key} className={`px-5 py-4 flex items-center justify-between transition-colors ${done ? 'bg-green-900/10' : 'hover:bg-gray-700/20'}`}>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-600 w-5 text-right">{idx + 1}</span>
                      {done
                        ? <CheckCircle2 size={18} className="text-green-400 flex-shrink-0" />
                        : <Circle size={18} className="text-gray-600 flex-shrink-0" />
                      }
                      <span className={`text-sm ${done ? 'text-gray-400 line-through' : 'text-white'}`}>
                        {label}
                      </span>
                    </div>
                    {!activeRun.is_locked && (
                      <button
                        onClick={() => handleCheck(key, !done)}
                        className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                          done
                            ? 'bg-gray-700 hover:bg-gray-600 text-gray-400'
                            : 'bg-green-700 hover:bg-green-600 text-white'
                        }`}
                      >
                        {done ? 'Undo' : 'Mark Done'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
