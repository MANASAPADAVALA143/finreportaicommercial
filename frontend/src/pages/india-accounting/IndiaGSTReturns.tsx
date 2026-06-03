/**
 * India GST Returns — GSTR-1 (outward) + GSTR-3B (net liability)
 */
import { useEffect, useState } from 'react';
import { Landmark, Zap, CheckCircle2, RefreshCw } from 'lucide-react';
import * as svc from '../../services/indiaAccounting.service';
import type { IndiaGSTReturn } from '../../services/indiaAccounting.service';

const THIS_PERIOD = new Date().toISOString().slice(0, 7);
const INR = (v: number) => `₹${v.toLocaleString('en-IN')}`;

export default function IndiaGSTReturns() {
  const [returns, setReturns]   = useState<IndiaGSTReturn[]>([]);
  const [period, setPeriod]     = useState(THIS_PERIOD);
  const [loading, setLoading]   = useState(true);
  const [compiling, setCompiling] = useState('');
  const [filing, setFiling]     = useState('');
  const [error, setError]       = useState('');
  const [msg, setMsg]           = useState('');

  const load = () => {
    setLoading(true);
    svc.listGSTReturns({ period })
      .then(d => setReturns(d.returns))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [period]);

  const handleCompile = async (type: 'GSTR1' | 'GSTR3B') => {
    setCompiling(type); setError(''); setMsg('');
    try {
      await svc.compileGSTReturn(period, type);
      setMsg(`${type} compiled for ${period}`);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCompiling('');
    }
  };

  const handleFile = async (returnId: string, type: string) => {
    setFiling(returnId); setError('');
    try {
      const r = await svc.fileGSTReturn(returnId);
      setMsg(`${type} filed — ARN: ${r.arn}`);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setFiling('');
    }
  };

  const gstr1 = returns.find(r => r.return_type === 'GSTR1');
  const gstr3b = returns.find(r => r.return_type === 'GSTR3B');

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Landmark size={20} className="text-purple-400" /> GST Returns
          </h1>
          <p className="text-gray-400 text-sm mt-1">GSTR-1 (outward supplies) · GSTR-3B (net tax payable)</p>
        </div>
        <div className="flex items-center gap-3">
          <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm" />
          <button onClick={load} className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg"><RefreshCw size={14} /></button>
        </div>
      </div>

      {(error || msg) && (
        <div className={`rounded-lg p-3 mb-4 text-sm ${error ? 'bg-red-900/40 text-red-300 border border-red-700' : 'bg-purple-900/40 text-purple-300 border border-purple-700'}`}>
          {error || msg}
        </div>
      )}

      {/* GST Return workflow */}
      <div className="bg-purple-900/20 border border-purple-800/40 rounded-xl p-4 mb-6">
        <p className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-3">Filing Workflow</p>
        <div className="flex items-center gap-4 flex-wrap">
          {[
            { step: '1', label: 'Post Sales Invoices',   desc: 'GST output gets recorded' },
            { step: '2', label: 'Post Purchase Invoices', desc: 'ITC gets claimed' },
            { step: '3', label: 'Compile GSTR-1',         desc: 'Outward supply summary' },
            { step: '4', label: 'Compile GSTR-3B',        desc: 'Net liability = Output − ITC' },
            { step: '5', label: 'File Return',             desc: 'Mark as filed with ARN' },
          ].map(s => (
            <div key={s.step} className="flex gap-2">
              <span className="text-lg font-bold text-purple-400">{s.step}</span>
              <div>
                <p className="text-xs font-medium text-white">{s.label}</p>
                <p className="text-xs text-gray-500">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* GSTR-1 Card */}
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">GSTR-1 — Outward Supplies</h2>
            <div className="flex gap-2">
              <button
                onClick={() => handleCompile('GSTR1')}
                disabled={!!compiling}
                className="flex items-center gap-1 text-xs bg-purple-700 hover:bg-purple-600 disabled:opacity-50 px-3 py-1.5 rounded text-white"
              >
                <Zap size={12} /> {compiling === 'GSTR1' ? 'Compiling…' : 'Compile'}
              </button>
              {gstr1 && gstr1.status === 'draft' && (
                <button
                  onClick={() => handleFile(gstr1.id, 'GSTR-1')}
                  disabled={!!filing}
                  className="flex items-center gap-1 text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-3 py-1.5 rounded text-white"
                >
                  <CheckCircle2 size={12} /> {filing === gstr1.id ? 'Filing…' : 'File'}
                </button>
              )}
            </div>
          </div>

          {gstr1 ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'B2B Taxable',    value: INR(gstr1.total_taxable * 0.6) },
                  { label: 'B2C Taxable',    value: INR(gstr1.total_taxable * 0.4) },
                  { label: 'Total Taxable',  value: INR(gstr1.total_taxable) },
                  { label: 'Total GST',      value: INR(gstr1.total_cgst + gstr1.total_sgst + gstr1.total_igst) },
                ].map(s => (
                  <div key={s.label} className="bg-gray-900/60 rounded-lg p-2">
                    <p className="text-xs text-gray-500">{s.label}</p>
                    <p className="text-sm font-bold text-purple-400">{s.value}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-gray-700">
                <span className="text-xs text-gray-400">Status</span>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${gstr1.status === 'filed' ? 'border-emerald-700 text-emerald-400 bg-emerald-900/20' : 'border-amber-700 text-amber-400 bg-amber-900/20'}`}>
                  {gstr1.status}
                </span>
              </div>
              {gstr1.arn && <p className="text-xs text-gray-500">ARN: {gstr1.arn}</p>}
            </div>
          ) : (
            <p className="text-gray-500 text-sm py-6 text-center">Click "Compile" to generate GSTR-1 for {period}</p>
          )}
        </div>

        {/* GSTR-3B Card */}
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">GSTR-3B — Net Tax Payable</h2>
            <div className="flex gap-2">
              <button
                onClick={() => handleCompile('GSTR3B')}
                disabled={!!compiling}
                className="flex items-center gap-1 text-xs bg-purple-700 hover:bg-purple-600 disabled:opacity-50 px-3 py-1.5 rounded text-white"
              >
                <Zap size={12} /> {compiling === 'GSTR3B' ? 'Compiling…' : 'Compile'}
              </button>
              {gstr3b && gstr3b.status === 'draft' && (
                <button
                  onClick={() => handleFile(gstr3b.id, 'GSTR-3B')}
                  disabled={!!filing}
                  className="flex items-center gap-1 text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-3 py-1.5 rounded text-white"
                >
                  <CheckCircle2 size={12} /> {filing === gstr3b.id ? 'Filing…' : 'File'}
                </button>
              )}
            </div>
          </div>

          {gstr3b ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Output CGST', value: INR(gstr3b.total_cgst) },
                  { label: 'Output SGST', value: INR(gstr3b.total_sgst) },
                  { label: 'ITC CGST',    value: INR(gstr3b.itc_cgst),   sub: true },
                  { label: 'ITC SGST',    value: INR(gstr3b.itc_sgst),   sub: true },
                ].map(s => (
                  <div key={s.label} className={`rounded-lg p-2 ${s.sub ? 'bg-emerald-900/20' : 'bg-gray-900/60'}`}>
                    <p className="text-xs text-gray-500">{s.label}</p>
                    <p className={`text-sm font-bold ${s.sub ? 'text-emerald-400' : 'text-purple-400'}`}>{s.value}</p>
                  </div>
                ))}
              </div>
              <div className="bg-red-900/20 border border-red-800/40 rounded-lg p-3">
                <p className="text-xs text-gray-400">Net GST Payable</p>
                <p className="text-xl font-bold text-red-400">{INR(gstr3b.total_payable)}</p>
                <div className="flex gap-4 mt-1 text-xs text-gray-500">
                  <span>CGST: {INR(gstr3b.net_cgst_payable)}</span>
                  <span>SGST: {INR(gstr3b.net_sgst_payable)}</span>
                  <span>IGST: {INR(gstr3b.net_igst_payable)}</span>
                </div>
              </div>
              {gstr3b.ai_summary && (
                <div className="bg-purple-900/20 border border-purple-800/40 rounded-lg p-3">
                  <p className="text-xs font-semibold text-purple-400 mb-1">AI Summary</p>
                  <p className="text-xs text-gray-300 whitespace-pre-wrap">{gstr3b.ai_summary}</p>
                </div>
              )}
              {gstr3b.arn && <p className="text-xs text-gray-500">ARN: {gstr3b.arn}</p>}
            </div>
          ) : (
            <p className="text-gray-500 text-sm py-6 text-center">Click "Compile" to generate GSTR-3B for {period}</p>
          )}
        </div>
      </div>

      {/* All returns history */}
      {returns.length > 0 && (
        <div className="mt-6 bg-gray-800/40 border border-gray-700/50 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700 bg-gray-800/60">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Filing History</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="px-4 py-2 text-left text-xs text-gray-500">Return Type</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500">Period</th>
                <th className="px-4 py-2 text-right text-xs text-gray-500">Taxable</th>
                <th className="px-4 py-2 text-right text-xs text-gray-500">Tax</th>
                <th className="px-4 py-2 text-right text-xs text-gray-500">Payable</th>
                <th className="px-4 py-2 text-center text-xs text-gray-500">Status</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500">ARN</th>
              </tr>
            </thead>
            <tbody>
              {returns.map(r => (
                <tr key={r.id} className="border-b border-gray-700/30">
                  <td className="px-4 py-3 font-mono text-purple-400 text-xs">{r.return_type}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{r.period}</td>
                  <td className="px-4 py-3 text-right text-white text-xs">{INR(r.total_taxable)}</td>
                  <td className="px-4 py-3 text-right text-purple-300 text-xs">{INR(r.total_cgst + r.total_sgst + r.total_igst)}</td>
                  <td className="px-4 py-3 text-right text-red-400 font-medium text-xs">{INR(r.total_payable)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${r.status === 'filed' ? 'border-emerald-700 text-emerald-400 bg-emerald-900/20' : 'border-amber-700 text-amber-400'}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs font-mono">{r.arn || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
