import React, { useCallback, useEffect, useState } from "react";
import { getLearningProgress, getFeedbackHistory } from "../../services/r2rLearning.service";

const C = {
  navy: "#0F2D5E",
  blue: "#1D4ED8",
  bluePale: "#EFF6FF",
  blueBorder: "#BFDBFE",
  white: "#FFFFFF",
  bg: "#F1F5F9",
  border: "#E2E8F0",
  text: "#0F172A",
  textSub: "#64748B",
  textMid: "#374151",
  green: "#15803D",
  greenBg: "#F0FDF4",
  greenBorder: "#BBF7D0",
  amber: "#B45309",
  font: "'DM Sans', 'Segoe UI', sans-serif",
  mono: "'DM Mono', 'Consolas', monospace",
};

type Props = {
  clientId: string | null;
  clientLabel?: string;
  refreshToken?: number;
};

const STATUS_LABEL: Record<string, string> = {
  initialising: "INITIALISING",
  learning: "LEARNING",
  calibrated: "CALIBRATED",
  optimised: "OPTIMISED",
  no_profile: "NO PROFILE YET",
};

export default function LearningDashboardTab({ clientId, clientLabel, refreshToken = 0 }: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, unknown> | null>(null);
  const [history, setHistory] = useState<{ approved: number; rejected: number; needs: number; total: number } | null>(
    null
  );

  const load = useCallback(async () => {
    if (!clientId) {
      setProgress(null);
      setHistory(null);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const [p, h] = await Promise.all([getLearningProgress(clientId), getFeedbackHistory(clientId)]);
      setProgress(p);
      const items = (h.items || []) as { feedback?: string }[];
      const approved = items.filter((x) => x.feedback === "approved").length;
      const rejected = items.filter((x) => x.feedback === "rejected").length;
      const needs = items.filter((x) => x.feedback === "needs_review").length;
      setHistory({ approved, rejected, needs, total: h.count ?? items.length });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load learning data");
      setProgress(null);
      setHistory(null);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  if (!clientId) {
    return (
      <div
        style={{
          padding: 40,
          textAlign: "center",
          background: C.bg,
          borderRadius: 12,
          border: `1px dashed ${C.border}`,
          color: C.textSub,
          fontFamily: C.font,
        }}
      >
        Select a <strong>client</strong> above to enable the learning loop and this dashboard.
      </div>
    );
  }

  const status = String(progress?.learning_status || progress?.status || "no_profile");
  const story = (progress?.improvement_story || {}) as {
    before_alerts?: number;
    after_alerts?: number;
    reduction_pct?: number;
    message?: string;
  };
  const recent = (progress?.recent_adjustments || []) as { description?: string; date?: string }[];
  const thresholds = (progress?.thresholds || {}) as Record<string, number>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, fontFamily: C.font }}>
      <div
        style={{
          background: `linear-gradient(135deg, ${C.navy} 0%, #1E3A8A 100%)`,
          color: C.white,
          borderRadius: 12,
          padding: "20px 22px",
          border: `1px solid ${C.blueBorder}`,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", opacity: 0.85 }}>CLIENT INTELLIGENCE</div>
        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{clientLabel || clientId}</div>
        <div style={{ fontSize: 12, opacity: 0.9, marginTop: 6 }}>
          Learning status: <strong>{STATUS_LABEL[status] || status.toUpperCase()}</strong>
          {loading ? " · Loading…" : ""}
        </div>
      </div>

      {err && (
        <div style={{ padding: 12, borderRadius: 8, background: "#FEF2F2", color: "#B91C1C", fontSize: 13 }}>{err}</div>
      )}

      <div
        style={{
          background: C.white,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: 20,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 14,
        }}
      >
        <Stat label="Months of data" value={String(progress?.months_of_data ?? "—")} />
        <Stat label="JEs analysed (baseline)" value={String(progress?.total_analysed ?? "—")} />
        <Stat label="Human reviews" value={String(history?.total ?? progress?.total_feedback ?? "—")} />
        <Stat
          label="Approved / Rejected"
          value={history ? `${history.approved} / ${history.rejected}` : "—"}
          sub={history?.needs ? `${history.needs} needs review` : undefined}
        />
        <Stat
          label="FP rate (approved ÷ AR)"
          value={progress?.false_positive_rate_pct != null ? `${progress.false_positive_rate_pct}%` : "—"}
        />
        <Stat label="Learning events" value={String(progress?.adjustments_made ?? "0")} />
      </div>

      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.text, marginBottom: 10 }}>Improvement narrative</div>
        <p style={{ fontSize: 13, color: C.textMid, lineHeight: 1.55, margin: 0 }}>
          {story.message ||
            "Submit feedback on flagged rows to calibrate thresholds. After several consistent approvals on similar signals (e.g. weekend postings), the engine relaxes penalties for your firm."}
        </p>
        {story.before_alerts != null && story.after_alerts != null ? (
          <div style={{ marginTop: 14, fontFamily: C.mono, fontSize: 12, color: C.textSub }}>
            Illustrative alert load: {story.before_alerts} → {story.after_alerts}
            {story.reduction_pct != null ? ` (${story.reduction_pct}% reduction)` : ""}
          </div>
        ) : null}
      </div>

      <div style={{ background: C.greenBg, border: `1px solid ${C.greenBorder}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.green, marginBottom: 8 }}>Adaptive thresholds (this client)</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: C.textMid, lineHeight: 1.7 }}>
          <li>Amount multiplier: {thresholds.amount_threshold_multiplier ?? "—"}×</li>
          <li>Weekend penalty score: {thresholds.weekend_penalty_score ?? "—"}</li>
          <li>Round-number penalty: {thresholds.round_number_penalty ?? "—"}</li>
          <li>New-vendor penalty: {thresholds.new_vendor_penalty ?? "—"}</li>
        </ul>
      </div>

      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.text, marginBottom: 12 }}>Recent adjustments</div>
        {recent.length === 0 ? (
          <p style={{ fontSize: 13, color: C.textSub, margin: 0 }}>No threshold adjustments yet. Need at least 5 feedback items before auto-tuning.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: C.textMid, lineHeight: 1.65 }}>
            {recent.map((r, i) => (
              <li key={i}>
                <span style={{ color: C.textSub, fontFamily: C.mono }}>{r.date}</span> — {r.description}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ background: C.bluePale, border: `1px solid ${C.blueBorder}`, borderRadius: 12, padding: 16, fontSize: 12, color: C.textMid }}>
        <strong>Baselines:</strong> {String(progress?.baseline_accounts ?? 0)} GL accounts · {String(progress?.baseline_users ?? 0)} users profiled
        {" — "}
        Run <code style={{ fontFamily: C.mono }}>POST /api/r2r/build-baseline</code> with 6–12 months of history to seed profiles.
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: C.textSub, letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 900, fontFamily: C.mono, color: C.navy, marginTop: 4 }}>{value}</div>
      {sub ? <div style={{ fontSize: 11, color: C.amber, marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}
