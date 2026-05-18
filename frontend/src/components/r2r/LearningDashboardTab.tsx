import React, { useCallback, useEffect, useRef, useState } from "react";
import { getLearningProgress, getFeedbackHistory, uploadHistory, type HistoryUploadResult } from "../../services/r2rLearning.service";
import { listClients, createClient, type R2RClient } from "../../services/r2rHistoryService";

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

  // ── Baseline upload state ──────────────────────────────────────────────────
  const [histUploading, setHistUploading]   = useState(false);
  const [histErr, setHistErr]               = useState<string | null>(null);
  const [baselineStatus, setBaselineStatus] = useState<HistoryUploadResult | null>(null);
  const [pendingFile, setPendingFile]       = useState<File | null>(null);   // staged, not yet sent
  const histFileRef = useRef<HTMLInputElement | null>(null);

  // ── Own client selector (independent of the analysis upload) ──────────────
  const [clients, setClients]                   = useState<R2RClient[]>([]);
  const [baselineClientId, setBaselineClientId] = useState<string>(clientId ?? "");
  const [newClientName, setNewClientName]       = useState("");
  const [creatingClient, setCreatingClient]     = useState(false);

  useEffect(() => {
    listClients().then(setClients).catch(() => {});
  }, []);

  // Keep selector in sync if parent changes selectedClientId
  useEffect(() => {
    if (clientId && !baselineClientId) setBaselineClientId(clientId);
  }, [clientId, baselineClientId]);

  const handleCreateClient = async () => {
    const name = newClientName.trim();
    if (!name) return;
    setCreatingClient(true);
    try {
      const c = await createClient(name);
      setClients((prev) => [...prev, c]);
      setBaselineClientId(c.id);
      setNewClientName("");
    } catch {
      // ignore
    } finally {
      setCreatingClient(false);
    }
  };

  // Stage file without uploading yet
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setPendingFile(file);
    setBaselineStatus(null);
    setHistErr(null);
  };

  // Explicit "Build Baseline" submit
  const handleBuildBaseline = async () => {
    if (!pendingFile) return;
    if (!baselineClientId) { setHistErr("Select a client first."); return; }
    setHistUploading(true);
    setHistErr(null);
    try {
      const result = await uploadHistory(baselineClientId, pendingFile);
      setBaselineStatus(result);
      setPendingFile(null);
      if (histFileRef.current) histFileRef.current.value = "";
      void load(); // refresh learning progress stats
    } catch (ex: unknown) {
      setHistErr(ex instanceof Error ? ex.message : "Upload failed");
    } finally {
      setHistUploading(false);
    }
  };

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

      {/* CLIENT INTELLIGENCE header — only when parent has selected a client */}
      {clientId && (
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
      )}

      {err && (
        <div style={{ padding: 12, borderRadius: 8, background: "#FEF2F2", color: "#B91C1C", fontSize: 13 }}>{err}</div>
      )}

      {/* ── Step 1: Upload Historical Data (Baseline) ── */}
      <div
        style={{
          background: C.white,
          border: `2px solid ${C.blueBorder}`,
          borderRadius: 12,
          padding: 20,
        }}
      >
        {/* Card header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 18 }}>📁</span>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.navy }}>
            Step 1 — Upload Historical Data (Baseline)
          </div>
        </div>
        <p style={{ fontSize: 13, color: C.textMid, lineHeight: 1.55, margin: "0 0 16px" }}>
          Upload <strong>3–12 months of past journal entries</strong> to build account-level
          baselines. The system stores these for comparison — <strong>it does NOT score or flag
          historical entries</strong>. Once stored, weekend and new-user false positives are
          suppressed for patterns that are normal for this client.
        </p>

        {/* Client selector (own dropdown — independent of analysis upload) */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.textSub, marginBottom: 6 }}>
            Client
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select
              value={baselineClientId}
              onChange={(e) => setBaselineClientId(e.target.value)}
              style={{
                padding: "7px 10px", borderRadius: 8,
                border: `1px solid ${C.border}`, fontSize: 13, minWidth: 180,
                background: C.white, color: C.text,
              }}
            >
              <option value="">— select client —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <span style={{ fontSize: 12, color: C.textSub }}>or create new:</span>
            <input
              type="text"
              placeholder="New client name"
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleCreateClient(); }}
              style={{
                padding: "7px 10px", borderRadius: 8,
                border: `1px solid ${C.border}`, fontSize: 13, width: 160,
              }}
            />
            <button
              onClick={() => void handleCreateClient()}
              disabled={creatingClient || !newClientName.trim()}
              style={{
                padding: "7px 14px", borderRadius: 8,
                background: C.bluePale, border: `1px solid ${C.blueBorder}`,
                fontSize: 13, fontWeight: 600, color: C.blue,
                cursor: creatingClient ? "wait" : "pointer",
                opacity: !newClientName.trim() ? 0.5 : 1,
              }}
            >
              {creatingClient ? "Creating…" : "Create"}
            </button>
          </div>
        </div>

        {/* File picker + Build Baseline button */}
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
          <label
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "7px 14px", borderRadius: 8,
              background: C.bg, border: `1px solid ${C.border}`,
              fontSize: 13, cursor: "pointer", color: C.textMid,
            }}
          >
            📎 {pendingFile ? pendingFile.name : "Choose file…"}
            <input
              ref={histFileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              disabled={histUploading}
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
          </label>

          {pendingFile && (
            <button
              onClick={() => void handleBuildBaseline()}
              disabled={histUploading || !baselineClientId}
              style={{
                padding: "7px 20px", borderRadius: 8,
                background: C.navy, color: C.white,
                fontSize: 13, fontWeight: 700, border: "none",
                cursor: histUploading ? "wait" : "pointer",
                opacity: !baselineClientId ? 0.5 : 1,
              }}
            >
              {histUploading ? "Building…" : "Build Baseline"}
            </button>
          )}

          {histUploading && (
            <span style={{ fontSize: 12, color: C.textSub }}>Processing history…</span>
          )}
        </div>

        {/* Required columns hint */}
        {!baselineStatus && !histUploading && (
          <p style={{ margin: "4px 0 0", fontSize: 12, color: C.amber }}>
            Required columns:{" "}
            <code style={{ fontFamily: C.mono }}>amount, account, posting_date, user_id</code>
          </p>
        )}

        {/* Error */}
        {histErr && (
          <div style={{
            marginTop: 8, fontSize: 12, color: "#B91C1C",
            background: "#FEF2F2", borderRadius: 6, padding: "6px 10px",
          }}>
            {histErr}
          </div>
        )}

        {/* Success result */}
        {baselineStatus && (
          <div style={{
            marginTop: 10, fontSize: 12, color: C.green,
            background: C.greenBg, border: `1px solid ${C.greenBorder}`,
            borderRadius: 8, padding: "10px 14px", lineHeight: 1.7,
          }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
              ✓ Baseline stored successfully
            </div>
            {baselineStatus.accounts_baselined} accounts · {baselineStatus.months_covered} months
            · {baselineStatus.total_rows.toLocaleString()} rows
            <br />
            <span style={{ color: C.textSub }}>
              Accounts: {baselineStatus.accounts.join(", ")}
            </span>
            {Object.keys(baselineStatus.weekend_rates).length > 0 && (
              <div style={{ marginTop: 4 }}>
                Weekend rates:{" "}
                {Object.entries(baselineStatus.weekend_rates)
                  .map(([acct, rate]) => `${acct}: ${(rate * 100).toFixed(0)}%`)
                  .join(" · ")}
              </div>
            )}
          </div>
        )}

        {/* Follow-up instruction */}
        {baselineStatus && (
          <div style={{
            marginTop: 10, fontSize: 12,
            background: C.bluePale, border: `1px solid ${C.blueBorder}`,
            borderRadius: 8, padding: "8px 14px", color: C.navy, lineHeight: 1.6,
          }}>
            <strong>Next:</strong> Go to the <strong>Pattern Analysis</strong> tab, select client{" "}
            <strong>
              {clients.find((c) => c.id === baselineClientId)?.name ?? baselineClientId}
            </strong>{" "}
            in the upload section, then upload this month's journal entries.
            The engine will compare against this baseline and suppress known-normal patterns.
          </div>
        )}
      </div>

      {/* ── Step 2 prompt — shown when no parent client selected yet ── */}
      {!clientId && (
        <div style={{
          padding: "16px 20px",
          borderRadius: 12,
          background: C.bluePale,
          border: `1px dashed ${C.blueBorder}`,
          fontSize: 13,
          color: C.navy,
          lineHeight: 1.6,
        }}>
          <strong>Step 2 — View Learning Dashboard</strong>
          <br />
          Select a client in the <strong>Pattern Analysis</strong> tab upload section, then come back here
          to see learning progress, adaptive thresholds and improvement narrative for that client.
        </div>
      )}

      {/* ── Dashboard stats — only when parent has a client selected ── */}
      {clientId && (
        <>
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
        </>
      )}
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
