import React, { useState, useMemo } from 'react';
import { BarChart3, Shield, TrendingUp, Users, Building2, Clock, Hash, X } from 'lucide-react';
import {
  analysePatterns,
  detectFraudPatterns,
  type PatternAnalysisResult,
  type PatternEntry,
  type FraudPatternAlert,
} from '../../services/patternAnalysis';
import FraudPatternAlerts from './FraudPatternAlerts';
import { callAI } from '../../services/aiProvider';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface PatternIntelligenceTabProps {
  uploadedEntries: any[];
}

export const PatternIntelligenceTab: React.FC<PatternIntelligenceTabProps> = ({ uploadedEntries }) => {
  const [novaSummary, setNovaSummary] = useState<string | null>(null);
  const [novaLoading, setNovaLoading] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<PatternEntry | null>(null);
  const [riskFilter, setRiskFilter] = useState<'ALL' | 'HIGH' | 'MEDIUM' | 'LOW'>('ALL');
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

  const result = useMemo<PatternAnalysisResult | null>(() => {
    if (!uploadedEntries || uploadedEntries.length === 0) return null;
    return analysePatterns(uploadedEntries);
  }, [uploadedEntries]);

  const fraudAlerts: FraudPatternAlert[] = useMemo(() => {
    if (!result) return [];
    return detectFraudPatterns(result.patternEntries, result.baseline, uploadedEntries);
  }, [result, uploadedEntries]);

  const handleNovaSummary = async () => {
    if (!result) return;
    setNovaLoading(true);
    try {
      const prompt = `You are a CFO fraud analyst. Summarize this journal entry pattern analysis in 3-4 sentences for a board brief.

Summary:
- Total entries: ${result.summary.totalEntries}
- High Risk: ${result.summary.highRisk}, Medium: ${result.summary.mediumRisk}, Low: ${result.summary.lowRisk}
- Top risky vendor: ${result.summary.topRiskyVendor}
- Top risky user: ${result.summary.topRiskyUser}
- Dominant risk model: ${result.summary.dominantRiskModel}
- Benford: ${result.benfordResult.isSuspicious ? 'SUSPICIOUS (possible digit manipulation)' : 'Normal'}
- Client weekend posting rate: ${(result.baseline.weekendRate * 100).toFixed(1)}%

Write a concise CFO-level summary with key risks and recommended actions.`;
      const text = await callAI(prompt);
      setNovaSummary(text);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const isAuthError = /invalid|403|UnrecognizedClient|security token|credentials/i.test(msg);
      setNovaSummary(
        isAuthError
          ? 'Nova summary unavailable: AWS credentials are missing or invalid. Set VITE_AWS_ACCESS_KEY_ID and VITE_AWS_SECRET_ACCESS_KEY in .env (and VITE_AWS_REGION if needed), then restart the app.'
          : 'Unable to generate Nova summary. Review the metrics above.'
      );
    } finally {
      setNovaLoading(false);
    }
  };

  if (!result) {
    return (
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-12 text-center">
        <BarChart3 className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <p className="text-gray-600 text-lg">Upload a journal entries file above to run pattern analysis</p>
        <p className="text-sm text-gray-500 mt-2">Supports CSV and Excel (JE_ID, Date, Account, debit, credit, Vendor/Customer, etc.)</p>
      </div>
    );
  }

  const s = result.summary;
  const getRiskColor = (level: string) => {
    if (level === 'HIGH') return 'bg-red-100 text-red-800 border-red-300';
    if (level === 'MEDIUM') return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    return 'bg-green-100 text-green-800 border-green-300';
  };

  const benfordChartData = result.benfordResult.digits.map((d, i) => ({
    digit: d.toString(),
    expected: result.benfordResult.expectedPct[i],
    actual: result.benfordResult.actualPct[i],
  }));

  return (
    <div className="space-y-6">
      <FraudPatternAlerts alerts={fraudAlerts} />
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <div className="bg-white rounded-xl shadow border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase">Total</p>
          <p className="text-2xl font-bold text-gray-900">{s.totalEntries}</p>
        </div>
        <div className="bg-red-50 rounded-xl shadow border border-red-200 p-4">
          <p className="text-xs text-red-600 uppercase">High Risk</p>
          <p className="text-2xl font-bold text-red-600">{s.highRisk}</p>
        </div>
        <div className="bg-yellow-50 rounded-xl shadow border border-yellow-200 p-4">
          <p className="text-xs text-yellow-700 uppercase">Medium</p>
          <p className="text-2xl font-bold text-yellow-700">{s.mediumRisk}</p>
        </div>
        <div className="bg-green-50 rounded-xl shadow border border-green-200 p-4">
          <p className="text-xs text-green-700 uppercase">Low</p>
          <p className="text-2xl font-bold text-green-700">{s.lowRisk}</p>
        </div>
        <div className="bg-white rounded-xl shadow border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase">Dominant Model</p>
          <p className="text-lg font-bold text-purple-600 capitalize">{s.dominantRiskModel}</p>
        </div>
        <div className="bg-white rounded-xl shadow border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase">Overall Score</p>
          <p className="text-2xl font-bold text-gray-900">{s.overallRiskScore}</p>
        </div>
      </div>

      {/* Top Risks */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
            <Building2 className="w-4 h-4" /> Top Risky Vendor
          </div>
          <p className="font-bold text-gray-900">{s.topRiskyVendor}</p>
        </div>
        <div className="bg-white rounded-xl shadow border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
            <Users className="w-4 h-4" /> Top Risky User
          </div>
          <p className="font-bold text-gray-900">{s.topRiskyUser}</p>
        </div>
        <div className="bg-white rounded-xl shadow border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
            <Hash className="w-4 h-4" /> Top Risky Account
          </div>
          <p className="font-bold text-gray-900">{s.topRiskyAccount}</p>
        </div>
      </div>

      {/* Benford's Law */}
      <div className="bg-white rounded-xl shadow border border-gray-200 p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-2 flex items-center gap-2">
          <BarChart3 className="w-5 h-5" /> Benford's Law
        </h3>
        <p className={`text-sm mb-4 ${result.benfordResult.isSuspicious ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
          {result.benfordResult.interpretation}
        </p>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={benfordChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="digit" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="expected" name="Expected %" fill="#94a3b8" radius={[4, 4, 0, 0]} />
              <Bar dataKey="actual" name="Actual %" fill="#3b82f6" radius={[4, 4, 0, 0]}>
                {benfordChartData.map((_, i) => (
                  <Cell key={i} fill={result.benfordResult.suspiciousDigits.includes(i + 1) ? '#ef4444' : '#3b82f6'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Model Weights */}
      <div className="bg-gray-50 rounded-xl p-4">
        <p className="text-sm font-semibold text-gray-700 mb-2">Model Weights</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(result.modelWeights).map(([k, v]) => (
            <span key={k} className="px-2 py-1 bg-white rounded text-xs font-medium border border-gray-200">
              {k}: {v}%
            </span>
          ))}
        </div>
      </div>

      {/* Nova Summary */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-200 p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" /> Nova AI Summary
          </h3>
          <button
            onClick={handleNovaSummary}
            disabled={novaLoading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {novaLoading ? 'Generating...' : 'Generate Summary'}
          </button>
        </div>
        {novaSummary && <p className="text-gray-700 text-sm leading-relaxed">{novaSummary}</p>}
      </div>

      {/* ── PATTERN RISK ENTRIES — Professional Audit View ── */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-gray-900">Pattern Risk Entries</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              7-model client-specific detection · sorted by risk score
            </p>
          </div>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {(['ALL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setRiskFilter(f)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  riskFilter === f
                    ? f === 'HIGH'
                      ? 'bg-red-600 text-white shadow'
                      : f === 'MEDIUM'
                        ? 'bg-amber-500 text-white shadow'
                        : f === 'LOW'
                          ? 'bg-green-600 text-white shadow'
                          : 'bg-white text-gray-800 shadow'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {f === 'ALL'
                  ? `All (${result.patternEntries.length})`
                  : `${f} (${result.patternEntries.filter((e) => e.riskLevel === f).length})`}
              </button>
            ))}
          </div>
        </div>

        {/* Risk summary bar */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          {[
            {
              label: 'Amount Anomalies',
              count: result.patternEntries.filter((e) => e.modelScores.amount >= 70).length,
              color: 'border-red-200 bg-red-50',
              textColor: 'text-red-700',
              icon: '💰',
            },
            {
              label: 'Duplicate Entries',
              count: result.patternEntries.filter((e) => e.modelScores.duplicate >= 70).length,
              color: 'border-orange-200 bg-orange-50',
              textColor: 'text-orange-700',
              icon: '🔁',
            },
            {
              label: 'Behaviour Flags',
              count: result.patternEntries.filter(
                (e) => e.modelScores.user >= 40 || e.modelScores.timing >= 40
              ).length,
              color: 'border-amber-200 bg-amber-50',
              textColor: 'text-amber-700',
              icon: '👤',
            },
            {
              label: 'Account Flags',
              count: result.patternEntries.filter((e) => e.modelScores.account >= 40).length,
              color: 'border-purple-200 bg-purple-50',
              textColor: 'text-purple-700',
              icon: '📒',
            },
          ].map((card) => (
            <div key={card.label} className={`rounded-lg border ${card.color} p-3`}>
              <div className="flex items-center justify-between">
                <span className="text-lg">{card.icon}</span>
                <span className={`text-2xl font-bold ${card.textColor}`}>{card.count}</span>
              </div>
              <p className={`text-xs font-medium mt-1 ${card.textColor}`}>{card.label}</p>
            </div>
          ))}
        </div>

        {/* Main table */}
        <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto max-h-[28rem]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider w-24">
                    Entry
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider">
                    Vendor / Account
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider w-20">
                    Posted By
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider w-24">
                    Date
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider w-32">
                    Amount
                  </th>
                  <th
                    className="text-center px-2 py-3 text-xs font-semibold uppercase tracking-wider w-16"
                    title="Amount Outlier Score"
                  >
                    Amt
                  </th>
                  <th
                    className="text-center px-2 py-3 text-xs font-semibold uppercase tracking-wider w-16"
                    title="Duplicate Score"
                  >
                    Dup
                  </th>
                  <th
                    className="text-center px-2 py-3 text-xs font-semibold uppercase tracking-wider w-16"
                    title="User Behaviour Score"
                  >
                    User
                  </th>
                  <th
                    className="text-center px-2 py-3 text-xs font-semibold uppercase tracking-wider w-16"
                    title="Timing Score"
                  >
                    Time
                  </th>
                  <th
                    className="text-center px-2 py-3 text-xs font-semibold uppercase tracking-wider w-16"
                    title="Account Score"
                  >
                    Acct
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider w-28">
                    Risk Score
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.patternEntries
                  .filter((e) => riskFilter === 'ALL' || e.riskLevel === riskFilter)
                  .map((entry, i) => {
                    const isHigh = entry.riskLevel === 'HIGH';
                    const isMedium = entry.riskLevel === 'MEDIUM';
                    const rowBg = i % 2 === 0 ? 'bg-white' : 'bg-gray-50';
                    const leftBorderClass = isHigh
                      ? 'border-l-4 border-l-red-500'
                      : isMedium
                        ? 'border-l-4 border-l-amber-400'
                        : 'border-l-4 border-l-transparent';

                    const scoreCell = (score: number, key: string) => {
                      if (score <= 0)
                        return (
                          <td key={key} className="text-center px-2 py-3">
                            <span className="text-gray-300 text-xs">—</span>
                          </td>
                        );
                      const style =
                        score >= 70
                          ? 'bg-red-500 text-white'
                          : score >= 40
                            ? 'bg-gray-700 text-white'
                            : 'bg-gray-200 text-gray-600';
                      return (
                        <td key={key} className="text-center px-2 py-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${style}`}
                          >
                            {score}
                          </span>
                        </td>
                      );
                    };

                    const badgeClass = isHigh
                      ? 'bg-red-100 text-red-700'
                      : isMedium
                        ? 'bg-gray-100 text-gray-600'
                        : 'bg-gray-100 text-gray-400';

                    return (
                      <React.Fragment key={entry.entryId}>
                        <tr
                          className={`border-t border-gray-100 cursor-pointer transition-colors hover:bg-slate-50 ${rowBg} ${leftBorderClass}`}
                          onClick={() =>
                            setExpandedEntry(expandedEntry === entry.entryId ? null : entry.entryId)
                          }
                        >
                          <td className="px-4 py-3">
                            <span className="font-mono text-xs font-bold text-gray-800">
                              {entry.entryId}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-900 text-sm">{entry.vendor}</p>
                            <p className="text-xs text-gray-400 mt-0.5">{entry.account}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full font-medium">
                              {entry.userId}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-xs text-gray-700">
                              {entry.date
                                ? new Date(entry.date).toLocaleDateString('en-IN', {
                                    day: '2-digit',
                                    month: 'short',
                                    year: '2-digit',
                                  })
                                : '—'}
                            </p>
                            {entry.isWeekend && (
                              <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded font-medium block">
                                Wknd
                              </span>
                            )}
                            {entry.isMonthEnd && (
                              <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded font-medium block">
                                M-End
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <p className="font-bold text-sm text-gray-900">
                              ₹{entry.amount.toLocaleString('en-IN')}
                            </p>
                            {Math.abs(entry.zScoreAmount) > 1.5 && (
                              <p className="text-xs text-gray-400">
                                z={entry.zScoreAmount > 0 ? '+' : ''}
                                {entry.zScoreAmount}σ
                              </p>
                            )}
                          </td>
                          {scoreCell(entry.modelScores.amount, 'amt')}
                          {scoreCell(entry.modelScores.duplicate, 'dup')}
                          {scoreCell(entry.modelScores.user, 'user')}
                          {scoreCell(entry.modelScores.timing, 'time')}
                          {scoreCell(entry.modelScores.account, 'acct')}
                          <td className="px-4 py-3 text-center">
                            <div className="flex flex-col items-center gap-1">
                              <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    isHigh
                                      ? 'bg-red-500'
                                      : isMedium
                                        ? 'bg-amber-400'
                                        : 'bg-green-400'
                                  }`}
                                  style={{ width: `${entry.patternRiskScore}%` }}
                                />
                              </div>
                              <span className="text-xs font-bold text-gray-700">
                                {entry.patternRiskScore}
                              </span>
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full font-semibold ${badgeClass}`}
                              >
                                {entry.riskLevel}
                              </span>
                            </div>
                          </td>
                        </tr>
                        {expandedEntry === entry.entryId && entry.patternFlags.length > 0 && (
                          <tr className="bg-white border-t border-dashed border-gray-100">
                            <td colSpan={11} className="px-6 py-3">
                              <div className="flex flex-wrap gap-2">
                                {entry.patternFlags.map((flag, fi) => (
                                  <span
                                    key={fi}
                                    className="inline-flex items-center gap-1 px-3 py-1 bg-white border border-gray-200 rounded-full text-xs text-gray-700 shadow-sm"
                                  >
                                    <span className="text-red-500">⚑</span>
                                    {flag}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {/* Empty state */}
          {result.patternEntries.filter(
            (e) => riskFilter === 'ALL' || e.riskLevel === riskFilter
          ).length === 0 && (
            <div className="py-12 text-center text-gray-400">
              <p className="text-sm">No {riskFilter} risk entries found</p>
            </div>
          )}
        </div>

        {/* Table legend */}
        <div className="flex items-center gap-6 mt-3 px-1 flex-wrap">
          <p className="text-xs text-gray-400">
            Column headers: Amt = Amount model · Dup = Duplicate · User = User behaviour ·
            Time = Timing · Acct = Account
          </p>
          <p className="text-xs text-gray-400">Click any row to see detailed flags</p>
        </div>
      </div>

      {/* Entry Detail Modal */}
      {selectedEntry && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b flex justify-between items-center">
              <h3 className="text-xl font-bold">Entry {selectedEntry.entryId}</h3>
              <button onClick={() => setSelectedEntry(null)} className="p-2 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p><strong>Vendor:</strong> {selectedEntry.vendor}</p>
              <p><strong>Amount:</strong> ₹{selectedEntry.amount.toLocaleString('en-IN')}</p>
              <p><strong>Account:</strong> {selectedEntry.account}</p>
              <p><strong>Date:</strong> {selectedEntry.date} ({selectedEntry.dayOfWeek})</p>
              <p><strong>Pattern Risk Score:</strong> {selectedEntry.patternRiskScore}</p>
              <div>
                <p className="font-semibold mb-2">Flags:</p>
                <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                  {selectedEntry.patternFlags.length > 0
                    ? selectedEntry.patternFlags.map((f, i) => <li key={i}>{f}</li>)
                    : <li>No specific flags</li>}
                </ul>
              </div>
              <div>
                <p className="font-semibold mb-2">Model Scores:</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(selectedEntry.modelScores)
                    .filter(([, v]) => v > 0)
                    .map(([k, v]) => (
                      <span key={k} className="px-2 py-1 bg-gray-100 rounded text-xs">
                        {k}: {v}
                      </span>
                    ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
