/**
 * India Management Accounts — P&L + Compliance + AI CA commentary
 */
import { useState } from 'react';
import { BarChart2, Zap } from 'lucide-react';
import * as svc from '../../services/indiaAccounting.service';

const THIS_PERIOD = new Date().toISOString().slice(0, 7);
const INR = (v: number) => `₹${(v ?? 0).toLocaleString('en-IN')}`;

export default function IndiaManagementAccounts() {
  const [period, setPeriod]   = useState(THIS_PERIOD);
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const handleGenerate = async () => {
    setLoading(true); setError('');
    try {
      const r = await svc.generateIndiaManagementAccounts(period);
      setData(r);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const pnl     = data?.pnl     || {};
  const bs      = data?.balance_sheet || {};
  const comp    = data?.compliance    || {};
  const narr    = data?.narrative     || {};

  const PNL_ROWS = [
    { label: 'Revenue from Operations',   key: 'revenue',         positive: true },
    { label: 'Cost of Goods Sold',         key: 'cogs',            positive: false },
    { label: 'Payroll & Employee Costs',   key: 'payroll_cost',    positive: false },
    { label: 'Depreciation (Ind AS 16)',   key: 'depreciation',    positive: false },
    { label: 'Total OpEx',                 key: 'total_opex',      positive: false, bold: true },
    { label: 'EBITDA',                     key: 'ebitda',          positive: true,  bold: true },
    { label: 'EBIT',                       key: 'ebit',            positive: true,  bold: true },
    { label: 'Profit Before Tax (PBT)',    key: 'pbt',             positive: true,  bold: true },
    { label: 'Tax Provision (25%)',        key: 'tax_provision',   positive: false },
    { label: 'Profit After Tax (PAT)',     key: 'pat',             positive: true,  bold: true },
  ];

  const NARR_SECTIONS = [
    { key: 'executive_summary', label: 'Executive Summary' },
    { key: 'revenue_commentary', label: 'Revenue' },
    { key: 'cost_commentary', label: 'Cost & Efficiency' },
    { key: 'gst_tds_note', label: 'GST & TDS Compliance' },
    { key: 'outlook', label: 'Outlook' },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <BarChart2 size={20} className="text-indigo-400" /> Management Accounts
          </h1>
          <p className="text-gray-400 text-sm mt-1">Ind AS P&L · Compliance snapshot · AI CA commentary</p>
        </div>
        <div className="flex items-center gap-3">
          <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm" />
          <button
            onClick={handleGenerate} disabled={loading}
            className="flex items-center gap-2 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Zap size={14} /> {loading ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>

      {error && <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg p-3 mb-4 text-sm">{error}</div>}

      {!data && !loading && (
        <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-12 text-center">
          <BarChart2 size={40} className="text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">Select a period and click Generate to produce management accounts</p>
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {/* P&L + Balance Sheet */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* P&L */}
            <div className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-700 bg-gray-800/80">
                <h2 className="text-sm font-semibold text-white">Profit & Loss — {period}</h2>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {PNL_ROWS.map(row => {
                    const val = pnl[row.key] ?? 0;
                    const isNeg = !row.positive && val > 0;
                    return (
                      <tr key={row.key} className={`border-b border-gray-700/30 ${row.bold ? 'bg-gray-700/20' : ''}`}>
                        <td className={`px-4 py-2.5 text-xs ${row.bold ? 'font-semibold text-white' : 'text-gray-400'}`}>
                          {row.label}
                        </td>
                        <td className={`px-4 py-2.5 text-right text-xs font-medium ${
                          row.bold
                            ? val >= 0 ? 'text-emerald-400' : 'text-red-400'
                            : isNeg ? 'text-red-400' : 'text-white'
                        }`}>
                          {isNeg ? `(${INR(val)})` : INR(val)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Compliance snapshot */}
            <div className="space-y-4">
              <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-white mb-3">Balance Sheet Highlights</h2>
                <div className="space-y-2">
                  {[
                    { label: 'Fixed Assets (NBV)',      value: INR(bs.fixed_assets_nbv || 0),    color: 'text-indigo-400' },
                    { label: 'Accounts Receivable',     value: INR(bs.accounts_receivable || 0), color: 'text-yellow-400' },
                  ].map(r => (
                    <div key={r.label} className="flex justify-between items-center py-1 border-b border-gray-700/30">
                      <span className="text-xs text-gray-400">{r.label}</span>
                      <span className={`text-xs font-bold ${r.color}`}>{r.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-purple-900/20 border border-purple-800/40 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-white mb-3">Compliance — {period}</h2>
                <div className="space-y-2">
                  {[
                    { label: 'GST Payable',            value: INR(comp.gst_payable || 0),           color: 'text-purple-400' },
                    { label: 'TDS Deducted',           value: INR(comp.tds_deducted || 0),          color: 'text-red-400' },
                    { label: 'TDS Pending Deposit',    value: INR(comp.tds_pending_deposit || 0),   color: 'text-amber-400' },
                  ].map(r => (
                    <div key={r.label} className="flex justify-between items-center py-1 border-b border-purple-800/20">
                      <span className="text-xs text-gray-400">{r.label}</span>
                      <span className={`text-xs font-bold ${r.color}`}>{r.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* AI CA Commentary */}
          {Object.keys(narr).length > 0 && (
            <div className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-700 bg-gray-800/80 flex items-center gap-2">
                <Zap size={14} className="text-indigo-400" />
                <h2 className="text-sm font-semibold text-white">AI CA Commentary</h2>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-gray-700">
                {NARR_SECTIONS.map(s => narr[s.key] && (
                  <div key={s.key} className="px-5 py-4">
                    <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-2">{s.label}</p>
                    <p className="text-xs text-gray-300 leading-relaxed">{narr[s.key]}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-gray-600 text-right">Generated: {data.generated_at}</p>
        </div>
      )}
    </div>
  );
}
