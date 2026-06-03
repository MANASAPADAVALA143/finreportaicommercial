/**
 * India Journal Entries — double-entry GL
 */
import { useEffect, useState } from 'react';
import { FileText, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import * as svc from '../../services/indiaAccounting.service';
import type { IndiaJournalEntry } from '../../services/indiaAccounting.service';

const THIS_PERIOD = new Date().toISOString().slice(0, 7);

const SOURCE_BADGE: Record<string, string> = {
  manual:  'border-gray-600 text-gray-400',
  gst:     'border-purple-700 text-purple-400 bg-purple-900/20',
  tds:     'border-red-700 text-red-400 bg-red-900/20',
  payroll: 'border-cyan-700 text-cyan-400 bg-cyan-900/20',
  asset:   'border-pink-700 text-pink-400 bg-pink-900/20',
};

const INR = (v: number) => `₹${v.toLocaleString('en-IN')}`;

export default function IndiaJournalEntries() {
  const [entries, setEntries]   = useState<IndiaJournalEntry[]>([]);
  const [period, setPeriod]     = useState(THIS_PERIOD);
  const [loading, setLoading]   = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lineData, setLineData] = useState<Record<string, IndiaJournalEntry>>({});
  const [posting, setPosting]   = useState('');
  const [error, setError]       = useState('');
  const [msg, setMsg]           = useState('');

  const load = () => {
    setLoading(true);
    svc.listIndiaJournals({ period })
      .then(d => setEntries(d.entries))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [period]);

  const handleExpand = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!lineData[id]) {
      const full = await svc.getIndiaJE(id).catch(() => null);
      if (full) setLineData(prev => ({ ...prev, [id]: full }));
    }
  };

  const handlePost = async (id: string) => {
    setPosting(id); setError('');
    try {
      await svc.postIndiaJE(id);
      setMsg('Journal entry posted');
      load();
    } catch (e: any) { setError(e.message); } finally { setPosting(''); }
  };

  const totalDr = entries.filter(e => e.status === 'posted').reduce((s, e) => s + e.total_debit, 0);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Journal Entries</h1>
          <p className="text-gray-400 text-sm mt-1">Double-entry GL — GST, TDS, Payroll, Asset auto-postings</p>
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

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
          <p className="text-xs text-gray-400">Total Entries</p>
          <p className="text-2xl font-bold text-white mt-1">{entries.length}</p>
        </div>
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
          <p className="text-xs text-gray-400">Total Debits (Posted)</p>
          <p className="text-2xl font-bold text-emerald-400 mt-1">{INR(totalDr)}</p>
        </div>
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
          <p className="text-xs text-gray-400">Draft Entries</p>
          <p className="text-2xl font-bold text-amber-400 mt-1">{entries.filter(e => e.status === 'draft').length}</p>
        </div>
      </div>

      <div className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800/80">
              <th className="px-4 py-3 w-6"></th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Date</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Description</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Source</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">Debit</th>
              <th className="px-4 py-3 text-center text-xs text-gray-400 font-semibold">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-700/50">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-3 bg-gray-700 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                  No journal entries for {period}. Post invoices or run payroll to auto-generate.
                </td>
              </tr>
            ) : (
              entries.map(e => (
                <>
                  <tr key={e.id}
                    className="border-b border-gray-700/30 hover:bg-gray-700/20 cursor-pointer transition-colors"
                    onClick={() => handleExpand(e.id)}>
                    <td className="px-4 py-3 text-gray-500">
                      {expandedId === e.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{e.entry_date}</td>
                    <td className="px-4 py-3 text-white text-sm max-w-xs truncate">{e.description}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${SOURCE_BADGE[e.source] || 'border-gray-600 text-gray-400'}`}>
                        {e.source}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-white text-xs font-medium">{INR(e.total_debit)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${e.status === 'posted' ? 'border-emerald-700 text-emerald-400 bg-emerald-900/20' : 'border-amber-700 text-amber-400'}`}>
                        {e.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {e.status === 'draft' && (
                        <button
                          onClick={ev => { ev.stopPropagation(); handlePost(e.id); }}
                          disabled={!!posting}
                          className="text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-2 py-1 rounded text-white"
                        >
                          {posting === e.id ? '…' : 'Post'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expandedId === e.id && lineData[e.id] && (
                    <tr key={`${e.id}-lines`}>
                      <td colSpan={7} className="bg-gray-900/60 px-6 py-3 border-b border-gray-700">
                        <table className="text-xs w-full">
                          <thead>
                            <tr className="text-gray-500">
                              <th className="text-left py-1 pr-4 font-normal">Account</th>
                              <th className="text-left py-1 pr-4 font-normal">Description</th>
                              <th className="text-right py-1 pr-4 font-normal">Dr</th>
                              <th className="text-right py-1 font-normal">Cr</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lineData[e.id].lines?.map((l: any) => (
                              <tr key={l.id} className="border-t border-gray-800">
                                <td className="py-1 pr-4 font-mono text-orange-400">{l.account_code}</td>
                                <td className="py-1 pr-4 text-gray-400">{l.description}</td>
                                <td className="py-1 pr-4 text-right text-emerald-400">{l.debit > 0 ? INR(l.debit) : ''}</td>
                                <td className="py-1 text-right text-red-400">{l.credit > 0 ? INR(l.credit) : ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
