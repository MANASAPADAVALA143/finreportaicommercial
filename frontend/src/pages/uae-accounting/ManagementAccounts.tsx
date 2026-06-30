/**
 * Management Accounts — AI-generated 5-section CFO narrative
 * P&L + Balance Sheet + AI narrative + export
 */
import { useState, useEffect } from 'react';
import { TrendingUp, FileText, Zap, Download, CheckCircle2 } from 'lucide-react';
import * as svc from '../../services/uaeFullAccounting.service';
import { validateFS, type FSValidationResult } from '../../services/fsValidation.service';

const THIS_PERIOD = new Date().toISOString().slice(0, 7);

function fmt(n: number) {
  return `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function pct(n: number) {
  return `${n.toFixed(1)}%`;
}

interface ManagementData {
  period: string;
  pnl: Record<string, number>;
  balance_sheet: Record<string, number>;
  narrative: Record<string, string>;
  generated_at: string;
}

export default function ManagementAccounts() {
  const [period, setPeriod]   = useState(THIS_PERIOD);
  const [data, setData]       = useState<ManagementData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [fsValidation, setFsValidation] = useState<FSValidationResult | null>(null);

  useEffect(() => {
    if (!data) return;
    const [y, m] = data.period.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const periodStart = `${y}-${String(m).padStart(2, '0')}-01`;
    const periodEnd = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    void validateFS(periodStart, periodEnd).then(setFsValidation).catch(() => setFsValidation(null));
  }, [data]);

  const handleGenerate = async () => {
    setLoading(true); setError(''); setData(null);
    try {
      const r = await svc.generateManagementAccounts(period);
      setData(r as ManagementData);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const narrativeLabels: Record<string, string> = {
    executive_summary: 'Executive Summary',
    revenue_analysis:  'Revenue Analysis',
    cost_analysis:     'Cost Analysis',
    balance_sheet:     'Balance Sheet Commentary',
    outlook:           'Outlook & Recommendations',
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Management Accounts</h1>
          <p className="text-gray-400 text-sm mt-1">AI-generated CFO narrative pack</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month" value={period}
            onChange={e => setPeriod(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm"
          />
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-5 py-2 rounded-lg text-sm font-medium"
          >
            <Zap size={14} /> {loading ? 'Generating…' : 'Generate Pack'}
          </button>
          {data && (
            <button className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm">
              <Download size={14} /> Export PDF
            </button>
          )}
        </div>
      </div>

      {fsValidation?.all_passed && (
        <div className="mb-4 flex items-center gap-2 bg-green-900/40 border border-green-700 rounded-lg px-4 py-3 text-sm text-green-300">
          <CheckCircle2 size={16} /> All Statements Validated ✓
        </div>
      )}

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg p-3 mb-4 text-sm text-red-300">{error}</div>
      )}

      {!data && !loading && (
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-16 text-center">
          <TrendingUp size={40} className="text-emerald-400 mx-auto mb-4" />
          <p className="text-white font-semibold mb-2">Generate Management Accounts</p>
          <p className="text-gray-400 text-sm max-w-md mx-auto">
            Click "Generate Pack" to create an AI-authored CFO management accounts narrative
            for {period}, including P&amp;L, Balance Sheet and 5-section strategic commentary.
          </p>
        </div>
      )}

      {loading && (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-gray-800/60 border border-gray-700 rounded-xl p-6 animate-pulse">
              <div className="h-4 bg-gray-700 rounded w-1/3 mb-3" />
              <div className="h-3 bg-gray-700 rounded w-full mb-2" />
              <div className="h-3 bg-gray-700 rounded w-4/5" />
            </div>
          ))}
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {/* Header */}
          <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">Management Accounts — {data.period}</h2>
                <p className="text-xs text-gray-500 mt-1">Generated: {new Date(data.generated_at).toLocaleString()}</p>
              </div>
              <div className={`text-lg font-bold ${data.pnl.net_profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {fmt(data.pnl.net_profit)} net profit
              </div>
            </div>
          </div>

          {/* P&L + Balance Sheet */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* P&L */}
            <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <TrendingUp size={14} className="text-green-400" /> Profit & Loss
              </h3>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-700/50">
                  {[
                    { label: 'Revenue',        value: data.pnl.revenue,        color: 'text-green-400' },
                    { label: 'Gross Profit',   value: data.pnl.gross_profit,   color: 'text-emerald-400', indent: true },
                    { label: 'Gross Margin',   value: null, margin: pct(data.pnl.gross_margin), color: 'text-emerald-400', indent: true },
                    { label: 'Total Expenses', value: data.pnl.total_expenses, color: 'text-red-400' },
                    { label: 'Net Profit',     value: data.pnl.net_profit,     color: data.pnl.net_profit >= 0 ? 'text-green-400' : 'text-red-400', bold: true },
                    { label: 'Net Margin',     value: null, margin: pct(data.pnl.net_margin), color: data.pnl.net_margin >= 0 ? 'text-green-400' : 'text-red-400', indent: true },
                  ].map(row => (
                    <tr key={row.label}>
                      <td className={`py-2 text-gray-400 ${row.indent ? 'pl-4' : ''} ${row.bold ? 'font-semibold text-white' : ''}`}>
                        {row.label}
                      </td>
                      <td className={`py-2 text-right font-mono ${row.color} ${row.bold ? 'font-semibold' : ''}`}>
                        {row.margin ?? fmt(row.value ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Balance Sheet */}
            <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <FileText size={14} className="text-blue-400" /> Balance Sheet
              </h3>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-700/50">
                  {[
                    { label: 'Total Assets',      value: data.balance_sheet.total_assets,      color: 'text-blue-400' },
                    { label: 'Total Liabilities', value: data.balance_sheet.total_liabilities, color: 'text-red-400' },
                    { label: 'Total Equity',      value: data.balance_sheet.total_equity,      color: 'text-purple-400', bold: true },
                  ].map(row => (
                    <tr key={row.label}>
                      <td className={`py-2 text-gray-400 ${row.bold ? 'font-semibold text-white' : ''}`}>{row.label}</td>
                      <td className={`py-2 text-right font-mono ${row.color} ${row.bold ? 'font-semibold' : ''}`}>
                        {fmt(row.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* AI Narrative */}
          <div className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-700 bg-gray-800/80 flex items-center gap-2">
              <Zap size={14} className="text-emerald-400" />
              <h3 className="text-sm font-semibold text-white">AI CFO Narrative</h3>
            </div>
            <div className="divide-y divide-gray-700/50">
              {Object.entries(narrativeLabels).map(([key, label]) => (
                data.narrative[key] && (
                  <div key={key} className="px-5 py-4">
                    <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">{label}</h4>
                    <p className="text-sm text-gray-300 leading-relaxed">{data.narrative[key]}</p>
                  </div>
                )
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
