/**
 * India TDS — Tax Deducted at Source
 * 194A/194C/194H/194I/194J/194Q sections
 */
import { useEffect, useState } from 'react';
import { Calculator, Zap, Download, RefreshCw } from 'lucide-react';
import * as svc from '../../services/indiaAccounting.service';
import type { IndiaTDSEntry } from '../../services/indiaAccounting.service';

const THIS_PERIOD = new Date().toISOString().slice(0, 7);

const INR = (v: number) => `₹${v.toLocaleString('en-IN')}`;

const STATUS_STYLE: Record<string, string> = {
  deducted:           'border-amber-700 text-amber-400 bg-amber-900/20',
  deposited:          'border-blue-700 text-blue-400 bg-blue-900/20',
  certificate_issued: 'border-emerald-700 text-emerald-400 bg-emerald-900/20',
};

interface TDSSection { code: string; desc: string; rate_company: number; }

export default function IndiaTDS() {
  const [entries, setEntries]     = useState<IndiaTDSEntry[]>([]);
  const [sections, setSections]   = useState<TDSSection[]>([]);
  const [summary, setSummary]     = useState<any>(null);
  const [period, setPeriod]       = useState(THIS_PERIOD);
  const [loading, setLoading]     = useState(true);
  const [depositing, setDepositing] = useState(false);
  const [challan, setChallan]     = useState('');
  const [error, setError]         = useState('');
  const [msg, setMsg]             = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([
      svc.listTDS({ period }),
      svc.getTDSSections(),
      svc.getTDSSummary(period),
    ])
      .then(([tds, secs, summ]) => {
        setEntries(tds.entries);
        setSections(secs.sections);
        setSummary(summ);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [period]);

  const handleDeposit = async () => {
    if (!challan) return;
    setDepositing(true); setError(''); setMsg('');
    try {
      const r = await svc.depositTDS({ period, challan_number: challan });
      setMsg(`Deposited ₹${r.total_tds_deposited.toLocaleString('en-IN')} for ${r.entries_deposited} entries — Challan ${challan}`);
      setChallan('');
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDepositing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Calculator size={20} className="text-red-400" /> TDS Management
          </h1>
          <p className="text-gray-400 text-sm mt-1">Tax Deducted at Source — 194A/C/H/I/J/Q</p>
        </div>
        <div className="flex items-center gap-3">
          <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm" />
          <button onClick={load} className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg"><RefreshCw size={14} /></button>
        </div>
      </div>

      {(error || msg) && (
        <div className={`rounded-lg p-3 mb-4 text-sm ${error ? 'bg-red-900/40 text-red-300 border border-red-700' : 'bg-emerald-900/40 text-emerald-300 border border-emerald-700'}`}>
          {error || msg}
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total TDS Deducted',    value: INR(summary.total_tds),         color: 'text-red-400' },
            { label: 'Deposited',             value: INR(summary.deposited || 0),    color: 'text-emerald-400' },
            { label: 'Pending Deposit',       value: INR(summary.pending_deposit),   color: 'text-amber-400' },
            { label: 'Payment Base',          value: INR(summary.total_payment || 0),color: 'text-white' },
          ].map(s => (
            <div key={s.label} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
              <p className="text-xs text-gray-400">{s.label}</p>
              <p className={`text-lg font-bold ${s.color} mt-1`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Section rates */}
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">TDS Rates Reference</h3>
          <div className="space-y-2">
            {sections.map(s => (
              <div key={s.code} className="flex items-center justify-between py-1 border-b border-gray-700/30">
                <div>
                  <span className="text-xs font-mono text-red-400 mr-2">u/s {s.code}</span>
                  <span className="text-xs text-gray-400">{s.desc}</span>
                </div>
                <span className="text-xs font-bold text-white">{s.rate_company}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Deposit panel */}
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Deposit TDS (ITNS 281)</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Period</label>
              <p className="text-sm text-white font-medium">{period}</p>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Challan Number</label>
              <input
                value={challan} onChange={e => setChallan(e.target.value)}
                placeholder="ITNS 281 challan no."
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500"
              />
            </div>
            <div className="bg-gray-900/60 rounded-lg p-2">
              <p className="text-xs text-gray-500">Pending deposit</p>
              <p className="text-sm font-bold text-amber-400">{summary ? INR(summary.pending_deposit) : '—'}</p>
            </div>
            <button
              onClick={handleDeposit}
              disabled={depositing || !challan || !summary?.pending_deposit}
              className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-50 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              <Zap size={14} /> {depositing ? 'Depositing…' : 'Mark as Deposited'}
            </button>
          </div>
        </div>

        {/* By section */}
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">By Section — {period}</h3>
          {summary?.by_section?.length > 0 ? (
            <div className="space-y-2">
              {summary.by_section.map((s: any) => (
                <div key={s.section} className="flex items-center justify-between py-1 border-b border-gray-700/30">
                  <div>
                    <span className="text-xs font-mono text-red-400">u/s {s.section}</span>
                    <span className="text-xs text-gray-500 ml-2">({s.count})</span>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-white">{INR(s.tds)}</p>
                    <p className="text-xs text-gray-500">of {INR(s.payment)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm text-center py-4">No TDS entries for {period}</p>
          )}
        </div>
      </div>

      {/* TDS entries table */}
      <div className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800/80">
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Deductee</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">PAN</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Section</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Nature</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">Payment</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">Rate</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">TDS</th>
              <th className="px-4 py-3 text-center text-xs text-gray-400 font-semibold">Status</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Challan</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-700/50">
                  {Array.from({ length: 9 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-3 bg-gray-700 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-gray-500">
                  No TDS entries for {period}.
                </td>
              </tr>
            ) : (
              entries.map(e => (
                <tr key={e.id} className="border-b border-gray-700/30 hover:bg-gray-700/20 transition-colors">
                  <td className="px-4 py-3 text-white text-xs">{e.deductee_name}</td>
                  <td className="px-4 py-3 font-mono text-gray-400 text-xs">{e.deductee_pan || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono text-red-400 bg-red-900/20 px-2 py-0.5 rounded">u/s {e.section}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{e.nature}</td>
                  <td className="px-4 py-3 text-right text-white text-xs">{INR(e.payment_amount)}</td>
                  <td className="px-4 py-3 text-right text-gray-400 text-xs">{e.tds_rate}%</td>
                  <td className="px-4 py-3 text-right text-red-400 font-medium text-xs">{INR(e.net_tds)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_STYLE[e.status] || 'border-gray-600 text-gray-400'}`}>
                      {e.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{e.challan_number || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
