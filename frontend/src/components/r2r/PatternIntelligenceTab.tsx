import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { BarChart3, Shield, Users, Building2, Hash, X } from 'lucide-react';
import {
  analyzeEntries,
  detectFraudPatterns,
  applyUserFeedback,
  type AnalyzeEntriesResult,
  type ScoredEntry,
  type FraudPatternAlert,
} from '../../services/patternAnalysis';
import FraudPatternAlerts from './FraudPatternAlerts';
import { callAI } from '../../services/aiProvider';

interface PatternIntelligenceTabProps {
  uploadedEntries: any[];
}

export const PatternIntelligenceTab: React.FC<PatternIntelligenceTabProps> = ({ uploadedEntries }) => {
  const [result, setResult] = useState<AnalyzeEntriesResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [novaSummary, setNovaSummary] = useState<string | null>(null);
  const [novaLoading, setNovaLoading] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<ScoredEntry | null>(null);
  const [riskFilter, setRiskFilter] = useState<'ALL' | 'HIGH' | 'MEDIUM' | 'LOW'>('ALL');
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

  useEffect(() => {
    if (!uploadedEntries?.length) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setAnalysisLoading(true);
    analyzeEntries(uploadedEntries, callAI)
      .then((res) => {
        if (!cancelled) setResult(res);
      })
      .finally(() => {
        if (!cancelled) setAnalysisLoading(false);
      });
    return () => { cancelled = true; };
  }, [uploadedEntries]);

  const fraudAlerts: FraudPatternAlert[] = useMemo(() => {
    if (!result) return [];
    return detectFraudPatterns(result.entries, result.baseline);
  }, [result]);

  const handleFeedback = useCallback((entryId: string, isRealAnomaly: boolean) => {
    if (!result) return;
    const entry = result.entries.find((e) => e.entryId === entryId);
    if (!entry) return;
    const updated = applyUserFeedback(entry, isRealAnomaly, 'user');
    setResult({
      ...result,
      entries: result.entries.map((e) => (e.entryId === entryId ? updated : e)),
    });
  }, [result]);

  const handleNovaSummary = async () => {
    if (!result) return;
    setNovaLoading(true);
    try {
      const prompt = `You are a CFO fraud analyst. Summarize this journal entry pattern analysis in 3-4 sentences for a board brief.

Summary:
- Total entries: ${result.summary.total}
- High Risk: ${result.summary.high}, Medium: ${result.summary.medium}, Low: ${result.summary.low}
- Anomaly rate: ${result.summary.anomalyRate}%
- Top risky vendor: ${result.summary.topRiskyVendor}
- Top risky user: ${result.summary.topRiskyUser}
- Nova AI explanations: ${result.summary.novaCallsMade} (HIGH risk only)
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

  if (!uploadedEntries?.length) {
    return (
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-12 text-center">
        <BarChart3 className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <p className="text-gray-600 text-lg">Upload a journal entries file above to run pattern analysis</p>
        <p className="text-sm text-gray-500 mt-2">Supports CSV and Excel (JE_ID, Date, Account, debit, credit, Vendor/Customer, etc.)</p>
      </div>
    );
  }

  if (analysisLoading) {
    return (
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-12 text-center">
        <div className="w-12 h-12 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-600 text-lg">Running 4-layer hybrid analysis…</p>
        <p className="text-sm text-gray-500 mt-2">ML + Statistical + Rules + Nova (HIGH risk only)</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-12 text-center">
        <p className="text-gray-600 text-lg">Analysis in progress or no data</p>
      </div>
    );
  }

  const s = result.summary;
  const getRiskColor = (level: string) => {
    if (level === 'HIGH') return 'bg-red-100 text-red-800 border-red-300';
    if (level === 'MEDIUM') return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    return 'bg-green-100 text-green-800 border-green-300';
  };

  return (
    <div className="space-y-6">
      <FraudPatternAlerts alerts={fraudAlerts} />
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <div className="bg-white rounded-xl shadow border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase">Total</p>
          <p className="text-2xl font-bold text-gray-900">{s.total}</p>
        </div>
        <div className="bg-red-50 rounded-xl shadow border border-red-200 p-4">
          <p className="text-xs text-red-600 uppercase">High Risk</p>
          <p className="text-2xl font-bold text-red-600">{s.high}</p>
        </div>
        <div className="bg-yellow-50 rounded-xl shadow border border-yellow-200 p-4">
          <p className="text-xs text-yellow-700 uppercase">Medium</p>
          <p className="text-2xl font-bold text-yellow-700">{s.medium}</p>
        </div>
        <div className="bg-green-50 rounded-xl shadow border border-green-200 p-4">
          <p className="text-xs text-green-700 uppercase">Low</p>
          <p className="text-2xl font-bold text-green-700">{s.low}</p>
        </div>
        <div className="bg-white rounded-xl shadow border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase">Anomaly Rate</p>
          <p className="text-2xl font-bold text-gray-900">{s.anomalyRate}%</p>
        </div>
        <div className="bg-white rounded-xl shadow border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase">Nova Calls</p>
          <p className="text-2xl font-bold text-purple-600">{s.novaCallsMade}</p>
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
            <Hash className="w-4 h-4" /> Top Risk Entry
          </div>
          <p className="font-bold text-gray-900 font-mono text-sm">{s.topRiskEntry}</p>
        </div>
      </div>

      {/* Score breakdown */}
      <div className="bg-gray-50 rounded-xl p-4">
        <p className="text-sm font-semibold text-gray-700 mb-2">Score breakdown (normalized 0–1)</p>
        <div className="flex flex-wrap gap-2">
          <span className="px-2 py-1 bg-white rounded text-xs font-medium border border-gray-200">ML: 40%</span>
          <span className="px-2 py-1 bg-white rounded text-xs font-medium border border-gray-200">Statistical: 30%</span>
          <span className="px-2 py-1 bg-white rounded text-xs font-medium border border-gray-200">Rules: 20%</span>
          <span className="px-2 py-1 bg-white rounded text-xs font-medium border border-gray-200">Nova: 10%</span>
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

      {/* ── PATTERN RISK ENTRIES — 4-layer hybrid ── */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-gray-900">Pattern Risk Entries</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              ML 40% · Statistical 30% · Rules 20% · Nova 10% (HIGH risk only)
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
                  ? `All (${result.entries.length})`
                  : `${f} (${result.entries.filter((e) => e.riskLevel === f).length})`}
              </button>
            ))}
          </div>
        </div>

        {/* Risk summary bar */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          {[
            { label: 'ML anomalies', count: result.entries.filter((e) => e.mlScore >= 0.7).length, color: 'border-red-200 bg-red-50', textColor: 'text-red-700', icon: '💰' },
            { label: 'Statistical flags', count: result.entries.filter((e) => e.statScore >= 0.7).length, color: 'border-orange-200 bg-orange-50', textColor: 'text-orange-700', icon: '📊' },
            { label: 'Rules triggered', count: result.entries.filter((e) => e.rulesScore >= 0.4).length, color: 'border-amber-200 bg-amber-50', textColor: 'text-amber-700', icon: '📋' },
            { label: 'Nova explained', count: result.entries.filter((e) => e.novaExplanation).length, color: 'border-purple-200 bg-purple-50', textColor: 'text-purple-700', icon: '🤖' },
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
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider w-24">Entry</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider">Vendor / Account</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider w-20">Posted By</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider w-24">Date</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider w-32">Amount</th>
                  <th className="text-center px-2 py-3 text-xs font-semibold uppercase tracking-wider w-14" title="ML score 0–100">ML</th>
                  <th className="text-center px-2 py-3 text-xs font-semibold uppercase tracking-wider w-14" title="Statistical">Stat</th>
                  <th className="text-center px-2 py-3 text-xs font-semibold uppercase tracking-wider w-14" title="Rules">Rules</th>
                  <th className="text-center px-2 py-3 text-xs font-semibold uppercase tracking-wider w-14" title="Nova">Nova</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider w-28">Score / Risk</th>
                </tr>
              </thead>
              <tbody>
                {result.entries
                  .filter((e) => riskFilter === 'ALL' || e.riskLevel === riskFilter)
                  .map((entry, i) => {
                    const isHigh = entry.riskLevel === 'HIGH';
                    const isMedium = entry.riskLevel === 'MEDIUM';
                    const rowBg = i % 2 === 0 ? 'bg-white' : 'bg-gray-50';
                    const leftBorderClass = isHigh ? 'border-l-4 border-l-red-500' : isMedium ? 'border-l-4 border-l-amber-400' : 'border-l-4 border-l-transparent';
                    const badgeClass = isHigh ? 'bg-red-100 text-red-700' : isMedium ? 'bg-gray-100 text-gray-600' : 'bg-gray-100 text-gray-400';

                    const scorePct = (v: number) => Math.round(v * 100);
                    const scoreCell = (val: number, key: string) => {
                      const s = scorePct(val);
                      if (s <= 0) return <td key={key} className="text-center px-2 py-3"><span className="text-gray-300 text-xs">—</span></td>;
                      const style = s >= 70 ? 'bg-red-500 text-white' : s >= 40 ? 'bg-gray-700 text-white' : 'bg-gray-200 text-gray-600';
                      return <td key={key} className="text-center px-2 py-3"><span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${style}`}>{s}</span></td>;
                    };

                    return (
                      <React.Fragment key={entry.entryId}>
                        <tr
                          className={`border-t border-gray-100 cursor-pointer transition-colors hover:bg-slate-50 ${rowBg} ${leftBorderClass}`}
                          onClick={() => setExpandedEntry(expandedEntry === entry.entryId ? null : entry.entryId)}
                        >
                          <td className="px-4 py-3"><span className="font-mono text-xs font-bold text-gray-800">{entry.entryId}</span></td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-900 text-sm">{entry.vendor}</p>
                            <p className="text-xs text-gray-400 mt-0.5">{entry.account}</p>
                          </td>
                          <td className="px-4 py-3"><span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full font-medium">{entry.userId}</span></td>
                          <td className="px-4 py-3">
                            <p className="text-xs text-gray-700">
                              {entry.date ? new Date(entry.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                            </p>
                            {entry.isWeekend && <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded font-medium block">Wknd</span>}
                            {entry.isMonthEnd && <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded font-medium block">M-End</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <p className="font-bold text-sm text-gray-900">₹{entry.amount.toLocaleString('en-IN')}</p>
                            {(Math.abs(entry.zAccount) > 1.5 || Math.abs(entry.zAccountMonth) > 1.5) && (
                              <p className="text-xs text-gray-400">z acct/month</p>
                            )}
                          </td>
                          {scoreCell(entry.mlScore, 'ml')}
                          {scoreCell(entry.statScore, 'stat')}
                          {scoreCell(entry.rulesScore, 'rules')}
                          {scoreCell(entry.novaScore, 'nova')}
                          <td className="px-4 py-3 text-center">
                            <div className="flex flex-col items-center gap-1">
                              <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${isHigh ? 'bg-red-500' : isMedium ? 'bg-amber-400' : 'bg-green-400'}`} style={{ width: `${entry.finalScore}%` }} />
                              </div>
                              <span className="text-xs font-bold text-gray-700">{entry.finalScore}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${badgeClass}`}>{entry.riskLevel}</span>
                            </div>
                          </td>
                        </tr>
                        {expandedEntry === entry.entryId && (entry.ruleFlags.length > 0 || entry.novaExplanation) && (
                          <tr className="bg-white border-t border-dashed border-gray-100">
                            <td colSpan={10} className="px-6 py-3">
                              {entry.ruleFlags.length > 0 && (
                                <div className="flex flex-wrap gap-2 mb-2">
                                  {entry.ruleFlags.map((flag, fi) => (
                                    <span key={fi} className="inline-flex items-center gap-1 px-3 py-1 bg-white border border-gray-200 rounded-full text-xs text-gray-700 shadow-sm">
                                      <span className="text-red-500">⚑</span>{flag}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {entry.novaExplanation && (
                                <p className="text-xs text-gray-600 mt-2 p-2 bg-blue-50 rounded border border-blue-100">
                                  <strong>Nova:</strong> {entry.novaExplanation}
                                </p>
                              )}
                              <div className="flex gap-2 items-center mt-3 flex-wrap">
                                <button
                                  type="button"
                                  onClick={(ev) => { ev.stopPropagation(); handleFeedback(entry.entryId, true); }}
                                  className="px-2.5 py-1 text-[11px] rounded-full border cursor-pointer transition-colors"
                                  style={{
                                    background: entry.userLabel === 1 ? '#EAF3DE' : 'transparent',
                                    borderColor: '#639922',
                                    color: '#3B6D11',
                                  }}
                                >
                                  ✓ Real anomaly
                                </button>
                                <button
                                  type="button"
                                  onClick={(ev) => { ev.stopPropagation(); handleFeedback(entry.entryId, false); }}
                                  className="px-2.5 py-1 text-[11px] rounded-full border cursor-pointer transition-colors"
                                  style={{
                                    background: entry.userLabel === 0 ? '#FCEBEB' : 'transparent',
                                    borderColor: '#E24B4A',
                                    color: '#A32D2D',
                                  }}
                                >
                                  ✕ False positive
                                </button>
                                {entry.userLabel !== undefined && (
                                  <span className="text-[11px] text-gray-500">Saved — improves model accuracy</span>
                                )}
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
          {result.entries.filter((e) => riskFilter === 'ALL' || e.riskLevel === riskFilter).length === 0 && (
            <div className="py-12 text-center text-gray-400"><p className="text-sm">No {riskFilter} risk entries found</p></div>
          )}
        </div>
        <div className="flex items-center gap-6 mt-3 px-1 flex-wrap">
          <p className="text-xs text-gray-400">ML / Stat / Rules / Nova = 0–100% · Click row to expand flags and Nova explanation · Feedback improves model</p>
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
              <p><strong>Date:</strong> {selectedEntry.date}</p>
              <p><strong>Final Score:</strong> {selectedEntry.finalScore} — {selectedEntry.riskLevel}</p>
              <div>
                <p className="font-semibold mb-2">Rule flags:</p>
                <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                  {selectedEntry.ruleFlags.length > 0 ? selectedEntry.ruleFlags.map((f, i) => <li key={i}>{f}</li>) : <li>None</li>}
                </ul>
              </div>
              {selectedEntry.novaExplanation && <p className="text-sm text-gray-600"><strong>Nova:</strong> {selectedEntry.novaExplanation}</p>}
              <div>
                <p className="font-semibold mb-2">Score breakdown (0–100):</p>
                <div className="flex flex-wrap gap-2">
                  <span className="px-2 py-1 bg-gray-100 rounded text-xs">ML: {Math.round(selectedEntry.mlScore * 100)}</span>
                  <span className="px-2 py-1 bg-gray-100 rounded text-xs">Stat: {Math.round(selectedEntry.statScore * 100)}</span>
                  <span className="px-2 py-1 bg-gray-100 rounded text-xs">Rules: {Math.round(selectedEntry.rulesScore * 100)}</span>
                  <span className="px-2 py-1 bg-gray-100 rounded text-xs">Nova: {Math.round(selectedEntry.novaScore * 100)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
