/**
 * Period-End Close — 13-item checklist + period lock
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
  multi_currency_revaluation:  'FX Revaluation completed',
  intercompany_balances_reconciled: 'Intercompany balances reconciled',
  ifrs_adjustments_posted:     'IFRS adjustments posted (IFRS 16 / IFRS 9 / IFRS 15)',
  audit_trail_exported:        'Audit trail exported (CFO sign-off)',
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
  const [fxOpen, setFxOpen]         = useState(false);
  const [fxRunning, setFxRunning]   = useState(false);
  const [fxRates, setFxRates]       = useState<Record<string, { current: string; original: string }>>({});
  const [fxDate, setFxDate]         = useState(new Date().toISOString().slice(0, 10));
  const [error, setError]           = useState('');
  const [msg, setMsg]               = useState('');
  const checklist    = activeRun?.checklist ?? {};
  const totalItems   = Object.keys(CHECKLIST_LABELS).length;
  const doneItems    = Object.values(checklist).filter(Boolean).length;
  const progress     = totalItems ? Math.round(doneItems / totalItems * 100) : 0;
  const allDone      = doneItems === totalItems;
  const statusInfo   = STATUS_STYLE[activeRun?.status ?? 'open'];

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

  useEffect(() => {
    const syncAutoTicks = async () => {
      if (!activeRun || activeRun.is_locked) return;
      try {
        const posted = await svc.listJournals({ period, status: 'posted' });
        const entries = posted.entries || [];
        const sources = new Set(entries.map((e) => String(e.source || '').toUpperCase()));
        const fxDone = sources.has('FX_REVALUATION');
        const ifrs16Done = Array.from(sources).some((s) => s.startsWith('IFRS16_'));
        const ifrs9Done = sources.has('IFRS9_ECL') || sources.has('IFRS9_ECL_REVERSAL');
        const ifrs15Done = sources.has('IFRS15_REVENUE');
        const ifrsDone = ifrs16Done && ifrs9Done && ifrs15Done;

        if (fxDone && !checklist.multi_currency_revaluation) {
          await svc.updateChecklist(activeRun.id, 'multi_currency_revaluation', true);
        }
        if (ifrsDone && !checklist.ifrs_adjustments_posted) {
          await svc.updateChecklist(activeRun.id, 'ifrs_adjustments_posted', true);
        }
        if ((fxDone && !checklist.multi_currency_revaluation) || (ifrsDone && !checklist.ifrs_adjustments_posted)) {
          load();
        }
      } catch {
        // keep checklist usable even if auto-detection fails
      }
    };
    void syncAutoTicks();
  }, [activeRun?.id, activeRun?.is_locked, period, checklist.multi_currency_revaluation, checklist.ifrs_adjustments_posted]);

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

  const handleOpenFx = async () => {
    setError('');
    setMsg('');
    try {
      const accounts = await svc.listAccounts();
      const currencies = Array.from(
        new Set(
          (accounts.accounts || [])
            .map((a) => (a.currency || '').toUpperCase())
            .filter((c) => c && c !== 'AED')
        )
      );
      const next: Record<string, { current: string; original: string }> = {};
      currencies.forEach((c) => {
        next[c] = fxRates[c] || { current: '', original: '' };
      });
      setFxRates(next);
      setFxOpen(true);
    } catch (e: any) {
      setError(e.message || 'Failed to load foreign currency accounts');
    }
  };

  const handleRunFx = async () => {
    if (!activeRun) return;
    setFxRunning(true);
    setError('');
    setMsg('');
    try {
      const exchange_rates: Record<string, { current_rate: number; original_rate: number }> = {};
      Object.entries(fxRates).forEach(([ccy, val]) => {
        const current = Number(val.current);
        const original = Number(val.original);
        if (Number.isFinite(current) && current > 0 && Number.isFinite(original) && original > 0) {
          exchange_rates[ccy] = { current_rate: current, original_rate: original };
        }
      });
      if (Object.keys(exchange_rates).length === 0) {
        throw new Error('Enter current and original exchange rates (AED per 1 unit) for each currency');
      }
      const wsId =
        localStorage.getItem('gnanova_workspace_id') ??
        localStorage.getItem('tenantId') ??
        '';
      const result = await svc.runFxRevaluation({
        workspace_id: wsId,
        company_id: localStorage.getItem('active_company_id') ?? undefined,
        period,
        revaluation_date: fxDate,
        exchange_rates,
      });
      if (activeRun) {
        await svc.updateChecklist(activeRun.id, 'multi_currency_revaluation', true);
      }
      const jeRef = result.journal_entry_number ? ` JE ${result.journal_entry_number}` : '';
      const adj = result.total_adjustment_aed ? ` (AED ${result.total_adjustment_aed.toLocaleString()})` : '';
      setMsg(`${result.message}${jeRef}${adj}`);
      setFxOpen(false);
      load();
    } catch (e: any) {
      setError(e.message || 'FX revaluation failed');
    } finally {
      setFxRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Period-End Close</h1>
          <p className="text-gray-400 text-sm mt-1">13-item checklist + period lock</p>
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
                    {!activeRun.is_locked && key === 'multi_currency_revaluation' ? (
                      <button
                        onClick={handleOpenFx}
                        className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                          done
                            ? 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                            : 'bg-amber-700 hover:bg-amber-600 text-white'
                        }`}
                      >
                        {done ? 'Re-run FX' : 'Run FX Revaluation'}
                      </button>
                    ) : !activeRun.is_locked && key === 'intercompany_balances_reconciled' ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => (window.location.href = '/consolidation')}
                          className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
                        >
                          Open Consolidation
                        </button>
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
                      </div>
                    ) : !activeRun.is_locked && key === 'ifrs_adjustments_posted' ? (
                      <span className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300">
                        Auto-check from posted IFRS JEs
                      </span>
                    ) : !activeRun.is_locked && key === 'audit_trail_exported' ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => (window.location.href = '/ap-invoices/audit-trail')}
                          className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
                        >
                          Open Audit Trail
                        </button>
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
                      </div>
                    ) : !activeRun.is_locked ? (
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
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {fxOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-xl p-5">
            <h3 className="text-lg font-semibold text-white mb-1">Run FX Revaluation</h3>
            <p className="text-xs text-gray-400 mb-4">
              Enter AED per 1 unit of foreign currency: original rate (when booked) and current month-end rate.
            </p>
            <div className="mb-3">
              <label className="text-xs text-gray-400">Revaluation Date</label>
              <input
                type="date"
                value={fxDate}
                onChange={(e) => setFxDate(e.target.value)}
                className="mt-1 w-full bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm"
              />
            </div>
            <div className="space-y-2 max-h-56 overflow-auto">
              {Object.keys(fxRates).length === 0 && (
                <p className="text-sm text-gray-500">No foreign-currency accounts found.</p>
              )}
              {Object.entries(fxRates).map(([ccy, val]) => (
                <div key={ccy} className="grid grid-cols-[4rem_1fr_1fr] gap-2 items-center">
                  <div className="text-sm text-gray-200 font-mono">{ccy}</div>
                  <input
                    type="number"
                    step="0.0001"
                    value={val.original}
                    onChange={(e) => setFxRates((prev) => ({
                      ...prev,
                      [ccy]: { ...prev[ccy], original: e.target.value },
                    }))}
                    placeholder="Original rate"
                    className="bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm"
                  />
                  <input
                    type="number"
                    step="0.0001"
                    value={val.current}
                    onChange={(e) => setFxRates((prev) => ({
                      ...prev,
                      [ccy]: { ...prev[ccy], current: e.target.value },
                    }))}
                    placeholder="Current rate"
                    className="bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm"
                  />
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="px-4 py-2 rounded-lg text-sm bg-gray-700 hover:bg-gray-600"
                onClick={() => setFxOpen(false)}
                disabled={fxRunning}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 rounded-lg text-sm bg-amber-700 hover:bg-amber-600 disabled:opacity-50"
                onClick={handleRunFx}
                disabled={fxRunning}
              >
                {fxRunning ? 'Posting…' : 'Post FX Revaluation JE'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
