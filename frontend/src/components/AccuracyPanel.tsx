/**
 * AccuracyPanel.tsx
 *
 * Displays precision/recall metrics from auditor feedback and the current
 * per-client ensemble layer weights calibrated by the FeedbackLearner.
 *
 * Usage
 * -----
 * <AccuracyPanel
 *   companyId="ACME001"
 *   feedbackBatch={[...]}          // from current session's auditor decisions
 *   layerWeights={{ statistical: 25, ml: 35, pattern: 20, behavioral: 20 }}
 *   onSubmitFeedback={handleSubmit} // callback to POST /api/v2/analyse/feedback
 * />
 */

import React, { useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AuditorLabel =
  | "TRUE_POSITIVE"
  | "FALSE_POSITIVE"
  | "MISSED_ANOMALY"
  | "IGNORE";

export interface FeedbackItem {
  journal_id: string;
  auditor_label: AuditorLabel;
  layer_scores: Record<string, number>;
  risk_level?: string;
  notes?: string;
}

export interface PrecisionRecallMetrics {
  true_positives: number;
  false_positives: number;
  missed_anomalies: number;
  total_reviewed: number;
  precision: number | null;
  recall: number | null;
  f1_score: number | null;
  precision_pct: number | null;
  recall_pct: number | null;
}

export interface LayerWeights {
  statistical: number;
  ml: number;
  pattern: number;
  behavioral: number;
}

interface AccuracyPanelProps {
  companyId: string;
  feedbackBatch?: FeedbackItem[];
  layerWeights?: LayerWeights;
  onSubmitFeedback?: (batch: FeedbackItem[]) => Promise<void>;
  isLoading?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeLocalPR(batch: FeedbackItem[]): PrecisionRecallMetrics {
  let tp = 0, fp = 0, fn = 0;
  for (const item of batch) {
    if (item.auditor_label === "TRUE_POSITIVE")  tp++;
    if (item.auditor_label === "FALSE_POSITIVE") fp++;
    if (item.auditor_label === "MISSED_ANOMALY") fn++;
  }
  const total = tp + fp + fn;
  const precision = (tp + fp) > 0 ? tp / (tp + fp) : null;
  const recall    = (tp + fn) > 0 ? tp / (tp + fn) : null;
  const f1 =
    precision !== null && recall !== null && (precision + recall) > 0
      ? (2 * precision * recall) / (precision + recall)
      : null;
  return {
    true_positives:  tp,
    false_positives: fp,
    missed_anomalies: fn,
    total_reviewed:  total,
    precision,
    recall,
    f1_score: f1,
    precision_pct: precision !== null ? Math.round(precision * 1000) / 10 : null,
    recall_pct:    recall    !== null ? Math.round(recall    * 1000) / 10 : null,
  };
}

function pct(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(1)}%`;
}

function f1Fmt(v: number | null): string {
  return v === null ? "—" : v.toFixed(2);
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface MetricCardProps {
  label: string;
  value: string;
  subLabel?: string;
  color: "green" | "red" | "blue" | "amber" | "gray";
  large?: boolean;
}

function MetricCard({ label, value, subLabel, color, large }: MetricCardProps) {
  const colorMap: Record<string, string> = {
    green: "bg-emerald-50 border-emerald-200 text-emerald-700",
    red:   "bg-red-50   border-red-200   text-red-700",
    blue:  "bg-blue-50  border-blue-200  text-blue-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    gray:  "bg-gray-50  border-gray-200  text-gray-600",
  };
  const valSize = large ? "text-3xl font-bold" : "text-2xl font-bold";
  return (
    <div className={`rounded-xl border p-4 ${colorMap[color]}`}>
      <div className="text-xs font-semibold uppercase tracking-wider opacity-70 mb-1">{label}</div>
      <div className={valSize}>{value}</div>
      {subLabel && <div className="text-xs mt-1 opacity-60">{subLabel}</div>}
    </div>
  );
}

interface GaugeBarProps {
  label: string;
  value: number;         // 0–100
  color: string;         // Tailwind bg class
}

function GaugeBar({ label, value, color }: GaugeBarProps) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs font-medium text-gray-600">
        <span>{label}</span>
        <span>{value.toFixed(1)}%</span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-500`}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AccuracyPanel({
  companyId,
  feedbackBatch = [],
  layerWeights,
  onSubmitFeedback,
  isLoading = false,
}: AccuracyPanelProps) {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const metrics = computeLocalPR(feedbackBatch);
  const hasFeedback = feedbackBatch.length > 0;
  const hasReviewed = metrics.total_reviewed > 0;

  const defaultWeights: LayerWeights = {
    statistical: 25, ml: 35, pattern: 20, behavioral: 20,
  };
  const weights = layerWeights ?? defaultWeights;
  const weightTotal = Object.values(weights).reduce((a, b) => a + b, 0);

  const layerConfig: Array<{ key: keyof LayerWeights; label: string; color: string }> = [
    { key: "statistical", label: "Statistical",  color: "bg-purple-500" },
    { key: "ml",          label: "ML (XGBoost)", color: "bg-blue-500"   },
    { key: "pattern",     label: "Pattern",      color: "bg-amber-500"  },
    { key: "behavioral",  label: "Behavioral",   color: "bg-emerald-500"},
  ];

  async function handleSubmit() {
    if (!onSubmitFeedback || !hasFeedback) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmitFeedback(feedbackBatch);
      setSubmitted(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  // Quality rating
  let qualityLabel = "Insufficient data";
  let qualityColor: MetricCardProps["color"] = "gray";
  if (hasReviewed) {
    const p = metrics.precision_pct ?? 0;
    const r = metrics.recall_pct ?? 0;
    if (p >= 85 && r >= 80) { qualityLabel = "Excellent"; qualityColor = "green"; }
    else if (p >= 70 && r >= 65) { qualityLabel = "Good";      qualityColor = "blue";  }
    else if (p >= 55 || r >= 55) { qualityLabel = "Fair";      qualityColor = "amber"; }
    else                          { qualityLabel = "Needs tuning"; qualityColor = "red"; }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">

      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
            <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Engine Accuracy</h3>
            <p className="text-xs text-gray-500">Auditor feedback · {companyId}</p>
          </div>
        </div>
        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <div className="w-3 h-3 rounded-full border-2 border-gray-300 border-t-indigo-500 animate-spin" />
            Loading…
          </div>
        )}
      </div>

      <div className="p-6 space-y-6">

        {/* Precision / Recall / F1 cards */}
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Detection Quality
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricCard
              label="Precision"
              value={pct(metrics.precision_pct)}
              subLabel={hasReviewed ? `${metrics.true_positives} TP / ${metrics.true_positives + metrics.false_positives} flagged` : "No data"}
              color={
                metrics.precision_pct === null ? "gray" :
                metrics.precision_pct >= 80 ? "green" :
                metrics.precision_pct >= 60 ? "amber" : "red"
              }
            />
            <MetricCard
              label="Recall"
              value={pct(metrics.recall_pct)}
              subLabel={hasReviewed ? `${metrics.true_positives} TP / ${metrics.true_positives + metrics.missed_anomalies} actual` : "No data"}
              color={
                metrics.recall_pct === null ? "gray" :
                metrics.recall_pct >= 80 ? "green" :
                metrics.recall_pct >= 60 ? "amber" : "red"
              }
            />
            <MetricCard
              label="F1 Score"
              value={f1Fmt(metrics.f1_score)}
              subLabel="Harmonic mean"
              color={
                metrics.f1_score === null ? "gray" :
                metrics.f1_score >= 0.8 ? "green" :
                metrics.f1_score >= 0.6 ? "amber" : "red"
              }
            />
            <MetricCard
              label="Quality"
              value={qualityLabel}
              subLabel={hasReviewed ? `${metrics.total_reviewed} decisions` : "Review entries to enable"}
              color={qualityColor}
            />
          </div>
        </div>

        {/* Decision breakdown */}
        {hasReviewed && (
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Auditor Decisions ({metrics.total_reviewed})
            </h4>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-center">
                <div className="text-2xl font-bold text-emerald-700">{metrics.true_positives}</div>
                <div className="text-xs text-emerald-600 mt-0.5">True Positives</div>
                <div className="text-xs text-emerald-400">Correctly flagged</div>
              </div>
              <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-center">
                <div className="text-2xl font-bold text-red-600">{metrics.false_positives}</div>
                <div className="text-xs text-red-500 mt-0.5">False Positives</div>
                <div className="text-xs text-red-300">Wrongly flagged</div>
              </div>
              <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-center">
                <div className="text-2xl font-bold text-amber-600">{metrics.missed_anomalies}</div>
                <div className="text-xs text-amber-600 mt-0.5">Missed</div>
                <div className="text-xs text-amber-300">Not caught</div>
              </div>
            </div>
          </div>
        )}

        {/* Layer weights */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Active Layer Weights
            </h4>
            <span className="text-xs text-gray-400">Total: {weightTotal.toFixed(0)}%</span>
          </div>
          <div className="space-y-3">
            {layerConfig.map(({ key, label, color }) => (
              <GaugeBar
                key={key}
                label={label}
                value={(weights[key] / weightTotal) * 100}
                color={color}
              />
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Weights auto-adjust as auditor decisions accumulate. False positives reduce
            the dominant layer's influence; true positives reinforce it.
          </p>
        </div>

        {/* Submit feedback */}
        {onSubmitFeedback && (
          <div className="border-t border-gray-50 pt-4">
            {submitted ? (
              <div className="flex items-center gap-2 text-sm text-emerald-600 font-medium">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Feedback submitted — weights updated for {companyId}
              </div>
            ) : (
              <div className="space-y-2">
                {error && (
                  <p className="text-xs text-red-500">{error}</p>
                )}
                <button
                  onClick={handleSubmit}
                  disabled={!hasFeedback || submitting}
                  className={`w-full py-2.5 px-4 rounded-xl text-sm font-semibold transition-all ${
                    hasFeedback && !submitting
                      ? "bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
                      : "bg-gray-100 text-gray-400 cursor-not-allowed"
                  }`}
                >
                  {submitting
                    ? "Submitting…"
                    : hasFeedback
                      ? `Submit ${feedbackBatch.length} Decision${feedbackBatch.length !== 1 ? "s" : ""} & Retune Weights`
                      : "No feedback to submit"}
                </button>
                <p className="text-xs text-center text-gray-400">
                  Retuning is per-client — only affects {companyId}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!hasFeedback && !isLoading && (
          <div className="rounded-xl bg-gray-50 border border-dashed border-gray-200 p-6 text-center">
            <div className="text-2xl mb-2">🎯</div>
            <p className="text-sm font-medium text-gray-600">No feedback yet</p>
            <p className="text-xs text-gray-400 mt-1">
              Mark anomaly entries as True Positive, False Positive, or Missed
              from the Journal Entry table to improve detection accuracy.
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
