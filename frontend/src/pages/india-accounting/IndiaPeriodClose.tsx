/**
 * India Period-End Close — 10-item checklist
 * GSTR-1, GSTR-3B, TDS, Payroll, Assets, Bank Recon, AR/AP, ITC, TB
 */
import { useEffect, useState } from 'react';
import { Lock, CheckCircle2, Circle, RefreshCw } from 'lucide-react';
import * as svc from '../../services/indiaAccounting.service';
import type { IndiaPeriodClose } from '../../services/indiaAccounting.service';

const THIS_PERIOD = new Date().toISOString().slice(0, 7);

const CHECKLIST_ITEMS = [
  { key: 'gstr1_filed',              label: 'GSTR-1 Filed',                    desc: 'Outward supply return submitted on GSTN portal' },
  { key: 'gstr3b_filed',             label: 'GSTR-3B Filed',                   desc: 'Monthly summary return + tax paid' },
  { key: 'tds_deposited',            label: 'TDS Deposited (ITNS 281)',         desc: 'All TDS deducted deposited with challan' },
  { key: 'payroll_posted',           label: 'Payroll Posted to GL',             desc: 'PF/ESI/PT/Gratuity entries in books' },
  { key: 'fixed_assets_depreciated', label: 'Depreciation Run',                desc: 'Monthly depreciation posted (SLM/WDV)' },
  { key: 'bank_recon_done',          label: 'Bank Reconciliation Done',         desc: 'All bank accounts reconciled' },
  { key: 'ar_reviewed',              label: 'AR Reviewed',                     desc: 'Debtors aging reviewed, provisions assessed' },
  { key: 'ap_reviewed',              label: 'AP Reviewed',                     desc: 'Creditors ledger reviewed, dues confirmed' },
  { key: 'itc_reconciled',           label: 'ITC Reconciled (GSTR-2B)',        desc: 'Input tax credit matched with GSTR-2B' },
  { key: 'tb_reconciled',            label: 'Trial Balance Tallied',            desc: 'Dr = Cr, all suspense cleared' },
];

export default function IndiaPeriodClose() {
  const [runs, setRuns]       = useState<IndiaPeriodClose[]>([]);
  const [current, setCurrent] = useState<IndiaPeriodClose | null>(null);
  const [period, setPeriod]   = useState(THIS_PERIOD);
  const [loading, setLoading] = useState(true);
  const [locking, setLocking] = useState(false);
  const [updating, setUpdating] = useState('');
  const [error, setError]     = useState('');
  const [msg, setMsg]         = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await svc.listIndiaCloseRuns();
      setRuns(data.runs);
      const match = data.runs.find(r => r.period === period);
      setCurrent(match || null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [period]);

  const handleStart = async () => {
    setError(''); setMsg('');
    try {
      const r = await svc.startIndiaClose(period);
      setCurrent(r as IndiaPeriodClose);
      setMsg(`Period close started for ${period}`);
      load();
    } catch (e: any) { setError(e.message); }
  };

  const handleCheck = async (key: string, done: boolean) => {
    if (!current) return;
    setUpdating(key);
    try {
      const r = await svc.updateIndiaChecklist(current.id, key, done);
      setCurrent(prev => prev ? { ...prev, checklist: r.checklist, status: r.status } : null);
    } catch (e: any) { setError(e.message); } finally { setUpdating(''); }
  };

  const handleLock = async () => {
    if (!current) return;
    setLocking(true); setError('');
    try {
      await svc.lockIndiaPeriod(current.id);
      setMsg(`Period ${period} locked successfully`);
      load();
    } catch (e: any) { setError(e.message); } finally { setLocking(false); }
  };

  const completed = current ? Object.values(current.checklist).filter(Boolean).length : 0;
  const total     = CHECKLIST_ITEMS.length;
  const pct       = total > 0 ? Math.round((completed / total) * 100) : 0;
  const allDone   = completed === total;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Lock size={20} className="text-amber-400" /> Period-End Close
          </h1>
          <p className="text-gray-400 text-sm mt-1">10-step checklist — GSTR, TDS, Payroll, ITC, Bank Recon</p>
        </div>
        <div className="flex items-center gap-3">
          <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm" />
          <button onClick={load} className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg"><RefreshCw size={14} /></button>
        </div>
      </div>

      {(error || msg) && (
        <div className={`rounded-lg p-3 mb-4 text-sm ${error ? 'bg-red-900/40 text-red-300 border border-red-700' : 'bg-amber-900/40 text-amber-300 border border-amber-700'}`}>
          {error || msg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Checklist */}
        <div className="lg:col-span-2 bg-gray-800/60 border border-gray-700 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Checklist — {period}</h2>
            {current?.is_locked && (
              <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-900/30 border border-amber-700 px-2 py-1 rounded-full">
                <Lock size={10} /> Locked
              </span>
            )}
          </div>

          {/* Progress */}
          {current && (
            <div className="mb-5">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>{completed}/{total} complete</span>
                <span>{pct}%</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}

          {!current ? (
            <div className="text-center py-8">
              <p className="text-gray-500 text-sm mb-4">No close run for {period}</p>
              <button
                onClick={handleStart}
                className="bg-amber-700 hover:bg-amber-600 px-6 py-2 rounded-lg text-sm font-medium"
              >
                Start Period Close
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {CHECKLIST_ITEMS.map(item => {
                const done = current.checklist?.[item.key] ?? false;
                return (
                  <div
                    key={item.key}
                    onClick={() => !current.is_locked && handleCheck(item.key, !done)}
                    className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
                      done
                        ? 'border-emerald-700/50 bg-emerald-900/10 cursor-pointer'
                        : current.is_locked
                          ? 'border-gray-700/30 opacity-50 cursor-not-allowed'
                          : 'border-gray-700/30 hover:border-gray-600 cursor-pointer'
                    }`}
                  >
                    <div className={`mt-0.5 flex-shrink-0 ${updating === item.key ? 'animate-pulse' : ''}`}>
                      {done
                        ? <CheckCircle2 size={16} className="text-emerald-400" />
                        : <Circle size={16} className="text-gray-600" />}
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${done ? 'text-emerald-400 line-through' : 'text-white'}`}>
                        {item.label}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {current && !current.is_locked && (
            <div className="mt-5 pt-4 border-t border-gray-700">
              <button
                onClick={handleLock}
                disabled={!allDone || locking}
                className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                  allDone
                    ? 'bg-amber-600 hover:bg-amber-500 text-white'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed opacity-50'
                }`}
              >
                <Lock size={14} /> {locking ? 'Locking…' : allDone ? `Lock Period ${period}` : `Complete ${total - completed} more items`}
              </button>
            </div>
          )}
        </div>

        {/* Recent periods */}
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-5">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Recent Periods</h3>
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 bg-gray-700 rounded-lg mb-2 animate-pulse" />
            ))
          ) : runs.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">No close runs yet</p>
          ) : (
            <div className="space-y-2">
              {runs.map(r => {
                const done = Object.values(r.checklist || {}).filter(Boolean).length;
                const tot  = Object.keys(r.checklist || {}).length;
                return (
                  <button
                    key={r.id}
                    onClick={() => setPeriod(r.period)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                      r.period === period ? 'border-amber-700 bg-amber-900/20' : 'border-gray-700/50 hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-white">{r.period}</span>
                      <span className={`text-xs ${r.is_locked ? 'text-amber-400' : 'text-gray-400'}`}>
                        {r.is_locked ? '🔒' : `${done}/${tot}`}
                      </span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-1 mt-1.5">
                      <div
                        className={`h-1 rounded-full ${r.is_locked ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        style={{ width: `${tot > 0 ? (done / tot) * 100 : 0}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
