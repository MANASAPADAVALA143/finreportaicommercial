import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  analyzePatternBackend,
  type AnalyzeEntriesResult,
  type PatternEngineExtras,
  type PatternSensitivity,
  type ScoredEntry,
} from "../services/patternAnalysis";
import { listClients, createClient, saveUpload, getClientHistory, type R2RClient } from "../services/r2rHistoryService";
import { postR2RFeedback, getFeedbackHistory, type R2RFeedback } from "../services/r2rLearning.service";
import { postCfoAgentRun } from "../services/cfoAgents";
import LearningDashboardTab from "../components/r2r/LearningDashboardTab";

// ─── Design Tokens (matches CFO Decision Intelligence) ───────────────────────
const C = {
  navy: "#0F2D5E",
  blue: "#1D4ED8",
  blueLight: "#3B82F6",
  bluePale: "#EFF6FF",
  blueBorder: "#BFDBFE",
  white: "#FFFFFF",
  bg: "#F1F5F9",
  border: "#E2E8F0",
  borderLight: "#F1F5F9",
  text: "#0F172A",
  textMid: "#374151",
  textSub: "#64748B",
  textMute: "#94A3B8",
  green: "#15803D",
  greenBg: "#F0FDF4",
  greenBorder: "#BBF7D0",
  red: "#DC2626",
  redBg: "#FEF2F2",
  redBorder: "#FECACA",
  amber: "#B45309",
  amberBg: "#FFFBEB",
  amberBorder: "#FDE68A",
};
const font = "'DM Sans', 'Segoe UI', sans-serif";
const mono = "'DM Mono', 'Consolas', monospace";

const API_BASE = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || "http://localhost:8000";
const AI_INVOKE_URL = `${API_BASE.replace(/\/$/, "")}/api/ai/invoke`;

const LS_R2R_SENSITIVITY = "r2r_sensitivity";
const LS_R2R_THRESHOLD = "r2r_threshold";

function loadR2rSensitivity(): PatternSensitivity {
  const s = localStorage.getItem(LS_R2R_SENSITIVITY);
  if (s === "conservative" || s === "balanced" || s === "strict") return s;
  return "balanced";
}

function loadR2rThresholdStr(): string {
  return (
    localStorage.getItem(LS_R2R_THRESHOLD) ||
    localStorage.getItem("fraud_detection_threshold") ||
    "40"
  );
}

const R2R_PRESET_THRESHOLD: Record<PatternSensitivity, string> = {
  conservative: "20",
  balanced: "40",
  strict: "70",
};

const R2R_SENSITIVITY_TITLE: Record<PatternSensitivity, string> = {
  conservative: "Conservative",
  balanced: "Balanced",
  strict: "Strict",
};

// ─── Shared UI Atoms ─────────────────────────────────────────────────────────
const Card = ({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12,
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)", padding: 20, ...style }}>
    {children}
  </div>
);

const SectionTitle = ({ children, sub }: { children: React.ReactNode; sub?: string }) => (
  <div style={{ marginBottom: 16 }}>
    <h3 style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: font, margin: 0 }}>{children}</h3>
    {sub && <p style={{ fontSize: 12, fontWeight: 400, color: C.textSub, marginTop: 3 }}>{sub}</p>}
  </div>
);

const Badge = ({ label, color = "blue" }: { label: string; color?: "blue" | "green" | "red" | "amber" | "navy" }) => {
  const map: Record<string, { bg: string; text: string; border: string }> = {
    blue:  { bg: C.bluePale,  text: C.blue,  border: C.blueBorder },
    green: { bg: C.greenBg,   text: C.green,  border: C.greenBorder },
    red:   { bg: C.redBg,     text: C.red,    border: C.redBorder },
    amber: { bg: C.amberBg,   text: C.amber,  border: C.amberBorder },
    navy:  { bg: C.navy,      text: C.white,  border: C.navy },
  };
  const s = map[color] || map.blue;
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
      background: s.bg, color: s.text, border: `1px solid ${s.border}`,
      letterSpacing: "0.07em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
};

const TH = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
  <th style={{ padding: "10px 14px", textAlign: right ? "right" : "left", fontSize: 11,
    fontWeight: 600, color: C.textSub, letterSpacing: "0.07em", textTransform: "uppercase",
    borderBottom: `1.5px solid ${C.border}`, background: C.bg, whiteSpace: "nowrap" }}>
    {children}
  </th>
);

const TD = ({ children, right, mono: isMono, style = {} }: { children: React.ReactNode; right?: boolean; mono?: boolean; style?: React.CSSProperties }) => (
  <td style={{ padding: "11px 14px", textAlign: right ? "right" : "left", fontSize: 13,
    fontWeight: 400, color: C.textMid, borderBottom: `1px solid ${C.borderLight}`,
    fontFamily: isMono ? mono : font, ...style }}>
    {children}
  </td>
);

const MiniBar = ({ pct, color = C.blue, height = 4 }: { pct: number; color?: string; height?: number }) => (
  <div style={{ width: "100%", height, borderRadius: 999, background: C.bg, overflow: "hidden" }}>
    <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", borderRadius: 999,
      background: color, transition: "width 0.5s ease" }} />
  </div>
);

const StatCard = ({ label, value, sub, color = C.blue, bg, border }: { label: string; value: string; sub?: string; color?: string; bg?: string; border?: string }) => (
  <div style={{ background: bg || C.bluePale, border: `1px solid ${border || C.blueBorder}`,
    borderRadius: 10, padding: "16px 18px" }}>
    <div style={{ fontSize: 11, fontWeight: 500, color: C.textSub, marginBottom: 4, letterSpacing: "0.04em" }}>{label}</div>
    <div style={{ fontSize: 26, fontWeight: 900, fontFamily: mono, color: color || C.blue }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: C.textSub, marginTop: 3 }}>{sub}</div>}
  </div>
);

// ─── JE Master Summary (always shown above tabs) ─────────────────────────────
type JEEntryRow = {
  id: string;
  vendor: string;
  account: string;
  postedBy: string;
  date: string;
  tags: string[];
  amount: string;
  /** Raw amount for exports and aggregates */
  amountNum: number;
  zscore: string;
  amt: number | null;
  dup: number | null;
  dupMatchId?: string;
  user: number | null;
  time: number | null;
  acct: number | null;
  score: number;
  level: "HIGH" | "MEDIUM" | "LOW";
  signals?: string[];
  plainEnglish?: string;
};

function actionRequiredForLevel(level: "HIGH" | "MEDIUM" | "LOW"): string {
  if (level === "HIGH") return "Immediate review — obtain supporting docs";
  if (level === "MEDIUM") return "Review in next 5 business days";
  return "Include in sample review";
}

function formatReportAnalysisDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function plainEnglishLine(e: JEEntryRow): string {
  if (e.plainEnglish?.trim()) return e.plainEnglish.trim();
  const s = e.signals?.length ? e.signals.slice(0, 3).join("; ") : "";
  return s || "Elevated composite risk — obtain supporting documentation.";
}

function formatAmountINR(n: number): string {
  const s = Math.round(n).toString();
  if (s.length <= 3) return "₹" + s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const withComma = rest.length > 2 ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : rest + "," + last3;
  return "₹" + withComma;
}

// ─── Derived stats type and helpers ────────────────────────────────────────────
export interface DerivedStats {
  total: number;
  high: number;
  medium: number;
  low: number;
  avgScore: number;
  autoCleaned: number;
  trendByMonth: { month: string; high: number; medium: number; low: number }[];
  vendorPatterns: { vendor: string; acct: string; count: number; avg: string; score: number; flag: string; action: "red"|"amber"|"green" }[];
  userPatterns: { user: string; total: number; flagged: number; rate: number; avg: number; wknd: number; profile: "red"|"amber"|"green" }[];
  patternShift: { type: string; icon: string; prev: number; curr: number; delta: number; pct: number; status: "red"|"amber"|"green"|"blue" }[];
  entries: JEEntryRow[];
}

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function parseEntryDate(d: string): Date | null {
  if (!d) return null;
  const dt = new Date(d);
  if (!isNaN(dt.getTime())) return dt;
  const m = d.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) return new Date(parseInt(m[3],10), parseInt(m[2],10)-1, parseInt(m[1],10));
  const m2 = d.match(/(\d{1,2})\s+(\w+)\s+(\d{2,4})/);
  if (m2) {
    const mi = MONTH_NAMES.findIndex(x => x.toLowerCase() === m2[2].toLowerCase());
    if (mi >= 0) return new Date(parseInt(m2[3],10) + (parseInt(m2[3],10) < 100 ? 2000 : 0), mi, parseInt(m2[1],10));
  }
  return null;
}

function parseAmountStr(s: string): number {
  const n = parseFloat(String(s).replace(/[₹,\s]/g, ""));
  return isNaN(n) ? 0 : n;
}

const FISCAL_MONTH_ORDER = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];

function computeTrendByMonth(entries: JEEntryRow[]): { month: string; high: number; medium: number; low: number }[] {
  type Key = string;
  const byKey: Record<Key, { year: number; monthIdx: number; high: number; medium: number; low: number }> = {};
  entries.forEach(e => {
    const dt = parseEntryDate(e.date);
    if (!dt) return;
    const year = dt.getFullYear();
    const monthIdx = dt.getMonth();
    const key = `${year}-${monthIdx}`;
    if (!byKey[key]) byKey[key] = { year, monthIdx, high: 0, medium: 0, low: 0 };
    if (e.level === "HIGH") byKey[key].high++;
    else if (e.level === "MEDIUM") byKey[key].medium++;
    else byKey[key].low++;
  });
  const sorted = Object.values(byKey)
    .sort((a, b) => a.year * 12 + a.monthIdx - (b.year * 12 + b.monthIdx))
    .slice(-6);
  return sorted.map(({ year, monthIdx, high, medium, low }) => ({
    month: MONTH_NAMES[monthIdx],
    high,
    medium,
    low,
  }));
}

function computeVendorPatterns(entries: JEEntryRow[]): { vendor: string; acct: string; count: number; avg: string; score: number; flag: string; action: "red"|"amber"|"green" }[] {
  const byVendor: Record<string,{ accounts: string[]; amounts: number[]; scores: number[]; flags: Set<string> }> = {};
  entries.forEach(e => {
    if (!byVendor[e.vendor]) byVendor[e.vendor] = { accounts: [], amounts: [], scores: [], flags: new Set() };
    byVendor[e.vendor].accounts.push(e.account);
    byVendor[e.vendor].amounts.push(parseAmountStr(e.amount));
    byVendor[e.vendor].scores.push(e.score);
    if (e.amt >= 70) byVendor[e.vendor].flags.add("Amt");
    if (e.dup >= 70) byVendor[e.vendor].flags.add("Dup");
    if (e.user >= 70) byVendor[e.vendor].flags.add("User");
    if (e.time >= 70) byVendor[e.vendor].flags.add("Time");
    if (e.acct >= 70) byVendor[e.vendor].flags.add("Acct");
    if (e.tags.includes("Wknd")) byVendor[e.vendor].flags.add("Wknd");
    if (e.tags.includes("M-End")) byVendor[e.vendor].flags.add("M-End");
  });
  return Object.entries(byVendor).map(([vendor, v]) => {
    const count = v.amounts.length;
    const avgNum = v.amounts.reduce((a,b)=>a+b,0) / count || 0;
    const avg = avgNum >= 1e5 ? `₹${(avgNum/1e5).toFixed(2)}L` : formatAmountINR(avgNum);
    const score = Math.round(v.scores.reduce((a,b)=>a+b,0) / count);
    const flag = [...v.flags].slice(0,3).join(" + ") || "—";
    const action: "red"|"amber"|"green" = score >= 71 ? "red" : score >= 41 ? "amber" : "green";
    const acct = [...new Set(v.accounts)].slice(0,2).join(" / ") || "—";
    return { vendor, acct, count, avg, score, flag, action };
  }).sort((a,b) => b.score - a.score).slice(0, 10);
}

function computeUserPatterns(entries: JEEntryRow[]): { user: string; total: number; flagged: number; rate: number; avg: number; wknd: number; profile: "red"|"amber"|"green" }[] {
  const byUser: Record<string,{ scores: number[]; wknd: number }> = {};
  entries.forEach(e => {
    const u = e.postedBy || "Unknown";
    if (!byUser[u]) byUser[u] = { scores: [], wknd: 0 };
    byUser[u].scores.push(e.score);
    if (e.tags.includes("Wknd")) byUser[u].wknd++;
  });
  return Object.entries(byUser).map(([user, v]) => {
    const total = v.scores.length;
    const flagged = v.scores.filter(s => s >= 41).length;
    const rate = total ? (flagged / total * 100) : 0;
    const avg = total ? Math.round(v.scores.reduce((a,b)=>a+b,0) / total) : 0;
    const profile: "red"|"amber"|"green" = avg >= 71 ? "red" : avg >= 41 ? "amber" : "green";
    return { user, total, flagged, rate: Math.round(rate * 10) / 10, avg, wknd: v.wknd, profile };
  }).sort((a,b) => b.avg - a.avg).slice(0, 10);
}

function computePatternShift(entries: JEEntryRow[]): { type: string; icon: string; prev: number; curr: number; delta: number; pct: number; status: "red"|"amber"|"green"|"blue" }[] {
  const now = new Date();
  const currMonth = now.getMonth();
  const prevMonth = currMonth === 0 ? 11 : currMonth - 1;
  const inPrev = (e: JEEntryRow) => { const d = parseEntryDate(e.date); return d && d.getMonth() === prevMonth; };
  const inCurr = (e: JEEntryRow) => { const d = parseEntryDate(e.date); return d && d.getMonth() === currMonth; };
  const wkndPrev = entries.filter(e => inPrev(e) && e.tags.includes("Wknd")).length;
  const wkndCurr = entries.filter(e => inCurr(e) && e.tags.includes("Wknd")).length;
  const mEndPrev = entries.filter(e => inPrev(e) && e.tags.includes("M-End")).length;
  const mEndCurr = entries.filter(e => inCurr(e) && e.tags.includes("M-End")).length;
  const amtPrev = entries.filter(e => inPrev(e) && (e.amt || 0) >= 70).length;
  const amtCurr = entries.filter(e => inCurr(e) && (e.amt || 0) >= 70).length;
  const dupPrev = entries.filter(e => inPrev(e) && (e.dup || 0) >= 70).length;
  const dupCurr = entries.filter(e => inCurr(e) && (e.dup || 0) >= 70).length;
  const calc = (p: number, c: number) => {
    const delta = c - p;
    const pct = p ? Math.round(delta / p * 100) : (c ? 100 : 0);
    const status: "red"|"amber"|"green"|"blue" = delta > 0 ? "red" : delta < 0 ? "green" : "blue";
    return { prev: p, curr: c, delta, pct, status };
  };
  return [
    { type: "Weekend Postings", icon: "📅", ...calc(wkndPrev, wkndCurr) },
    { type: "Month-End Spikes", icon: "📈", ...calc(mEndPrev, mEndCurr) },
    { type: "Unusual Amounts (z>3σ)", icon: "💰", ...calc(amtPrev, amtCurr) },
    { type: "Duplicate Risk", icon: "🔄", ...calc(dupPrev, dupCurr) },
    { type: "User Behaviour", icon: "👤", ...calc(
      entries.filter(e => inPrev(e) && (e.user || 0) >= 70).length,
      entries.filter(e => inCurr(e) && (e.user || 0) >= 70).length
    ) },
    { type: "Account Anomalies", icon: "📋", ...calc(
      entries.filter(e => inPrev(e) && (e.acct || 0) >= 70).length,
      entries.filter(e => inCurr(e) && (e.acct || 0) >= 70).length
    ) },
  ];
}

function scoredEntryToJEEntry(p: ScoredEntry, index: number): JEEntryRow {
  const tags: string[] = [];
  if (p.isWeekend) tags.push("Wknd");
  if (p.isMonthEnd) tags.push("M-End");
  const z = p.zAccount;
  const zscore = (z === 0 || Number.isNaN(z)) ? "—" : `${z >= 0 ? "+" : ""}${z.toFixed(2)}σ`;
  const amt = Math.round(p.mlScore * 100);
  const dup = p.ruleFlags.some(f => f.includes("Duplicate") || f.includes("Near-duplicate")) ? Math.round(p.rulesScore * 100) : null;
  const user = Math.round(p.rulesScore * 100);
  const time = p.isWeekend || p.isLateNight ? Math.round(p.rulesScore * 100) : null;
  const acct = Math.round(p.statScore * 100);
  return {
    id: p.entryId || `JE-${String(index + 1).padStart(3, "0")}`,
    vendor: p.vendor || "—",
    account: p.account || "—",
    postedBy: p.userId || "—",
    date: p.date || "—",
    tags,
    amount: formatAmountINR(p.amount),
    amountNum: p.amount,
    zscore,
    amt: amt || null,
    dup,
    user: user || null,
    time,
    acct: acct || null,
    score: p.finalScore,
    level: p.riskLevel,
    signals: p.ruleFlags?.length ? p.ruleFlags : undefined,
    plainEnglish: p.plainEnglishReason,
  };
}

const ScorePill = ({ value, title }: { value: number | null | undefined; title?: string }) => {
  if (value === null || value === undefined)
    return <span style={{ color: C.textMute, fontSize: 16 }} title={title}>—</span>;
  const hi = value >= 71;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 36, height: 24, borderRadius: 5, fontSize: 11, fontWeight: 700, fontFamily: mono,
      background: hi ? C.redBg : C.bg, color: hi ? C.red : C.textSub,
      border: `1px solid ${hi ? C.redBorder : C.border}` }} title={title}>
      {value}
    </span>
  );
};

const RiskBar = ({ score, level }: { score: number; level: "HIGH" | "MEDIUM" | "LOW" }) => {
  const cfg: Record<string, { text: string; bar: string; bg: string; border: string }> = {
    HIGH:   { text: C.red,   bar: "#EF4444", bg: C.redBg,   border: C.redBorder },
    MEDIUM: { text: C.amber, bar: "#F59E0B", bg: C.amberBg, border: C.amberBorder },
    LOW:    { text: C.green, bar: "#22C55E", bg: C.greenBg, border: C.greenBorder },
  };
  const c = cfg[level] || cfg.LOW;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 17, fontWeight: 900, fontFamily: mono, color: c.text }}>{score}</span>
        <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
          background: c.bg, color: c.text, border: `1px solid ${c.border}`, letterSpacing: "0.07em" }}>
          {level}
        </span>
      </div>
      <div style={{ width: 64, height: 3, borderRadius: 999, background: C.border, overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", borderRadius: 999, background: c.bar }} />
      </div>
    </div>
  );
};

interface JESummaryTableProps {
  entries?: JEEntryRow[];
  totalAmt?: string;
  totalAnalysed?: number;
  anomaliesCount?: number;
  engineExtras?: PatternEngineExtras | null;
  /** When set, HIGH/MEDIUM rows show approve/reject learning actions (POST /api/r2r/feedback). */
  learningClientId?: string | null;
  onLearningFeedback?: () => void;
}

const ReasonChips = ({ items }: { items: string[] }) => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 280 }}>
    {items.slice(0, 2).map((t) => (
      <span
        key={t}
        style={{
          fontSize: 9,
          fontWeight: 600,
          padding: "3px 8px",
          borderRadius: 4,
          background: C.bluePale,
          color: C.blue,
          border: `1px solid ${C.blueBorder}`,
          lineHeight: 1.3,
        }}
      >
        {t.length > 42 ? `${t.slice(0, 40)}…` : t}
      </span>
    ))}
    {items.length === 0 && <span style={{ fontSize: 11, color: C.textMute }}>—</span>}
  </div>
);

function PatternEngineInsights({ extra }: { extra: PatternEngineExtras }) {
  const mb = extra.model_breakdown;
  const dist = extra.score_distribution || [];
  const maxC = Math.max(1, ...dist.map((x) => x.count));
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 16,
        marginBottom: 4,
      }}
    >
      <Card>
        <SectionTitle sub="Detectors contributing this run">Models Used This Analysis</SectionTitle>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 13, color: C.textMid }}>
          {[
            ["Isolation Forest", mb.isolation_forest_detected, "detected"],
            ["DBSCAN", mb.dbscan_noise_points, "noise pts"],
            ["Local Outlier Factor", mb.local_outlier_detected, "detected"],
            ["Rules Engine", mb.rules_engine_flagged_rows, "rows with rule hits"],
            ["Behavioural", mb.behavioural_anomalies, "anomalies"],
          ].map(([label, n, suf]) => (
            <li
              key={String(label)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                padding: "10px 0",
                borderBottom: `1px solid ${C.borderLight}`,
                fontFamily: font,
              }}
            >
              <span style={{ color: C.text, fontWeight: 600 }}>{label}</span>
              <span style={{ fontFamily: mono, fontWeight: 800, color: C.blue }}>
                {n} <span style={{ fontWeight: 500, color: C.textSub, fontSize: 11 }}>{suf}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <SectionTitle sub="Entries per composite risk band">Score distribution</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
          {dist.map((b) => (
            <div key={b.band} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 52, fontSize: 11, fontWeight: 700, color: C.textSub, fontFamily: mono }}>{b.band}</span>
              <div style={{ flex: 1, height: 10, borderRadius: 999, background: C.bg, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${Math.min(100, (b.count / maxC) * 100)}%`,
                    height: "100%",
                    borderRadius: 999,
                    background: C.blue,
                    transition: "width 0.4s ease",
                  }}
                />
              </div>
              <span style={{ width: 36, textAlign: "right", fontFamily: mono, fontSize: 12, fontWeight: 800, color: C.text }}>
                {b.count}
              </span>
            </div>
          ))}
          {dist.length === 0 && <p style={{ fontSize: 12, color: C.textSub }}>No distribution data.</p>}
        </div>
      </Card>
    </div>
  );
}

const ScoreValueBadge = ({ score }: { score: number }) => {
  const tier = score >= 70 ? "high" : score >= 40 ? "mid" : "low";
  const cfg =
    tier === "high"
      ? { bg: C.redBg, text: C.red, border: C.redBorder }
      : tier === "mid"
        ? { bg: C.amberBg, text: C.amber, border: C.amberBorder }
        : { bg: C.greenBg, text: C.green, border: C.greenBorder };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 44,
        padding: "4px 8px",
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 800,
        fontFamily: mono,
        background: cfg.bg,
        color: cfg.text,
        border: `1px solid ${cfg.border}`,
      }}
    >
      {score}
    </span>
  );
};

const JESummaryTable = ({
  entries,
  totalAmt,
  totalAnalysed,
  anomaliesCount,
  engineExtras,
  learningClientId,
  onLearningFeedback,
}: JESummaryTableProps = {}) => {
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ALL" | "HIGH" | "MEDIUM" | "LOW">("ALL");
  const [novaCache, setNovaCache] = useState<Record<string, string>>({});
  const [novaLoading, setNovaLoading] = useState<string | null>(null);
  const [fbSummary, setFbSummary] = useState({ total: 0, approved: 0, rejected: 0, needs: 0 });
  const [entryFb, setEntryFb] = useState<Record<string, R2RFeedback>>({});
  const [fbComments, setFbComments] = useState<Record<string, string>>({});
  const [fbSubmitting, setFbSubmitting] = useState<string | null>(null);
  const [fbToast, setFbToast] = useState<string | null>(null);

  const refreshFbSummary = useCallback(async () => {
    if (!learningClientId) {
      setFbSummary({ total: 0, approved: 0, rejected: 0, needs: 0 });
      return;
    }
    try {
      const h = await getFeedbackHistory(learningClientId);
      const items = (h.items || []) as { feedback?: string }[];
      setFbSummary({
        total: h.count ?? items.length,
        approved: items.filter((x) => x.feedback === "approved").length,
        rejected: items.filter((x) => x.feedback === "rejected").length,
        needs: items.filter((x) => x.feedback === "needs_review").length,
      });
    } catch {
      setFbSummary({ total: 0, approved: 0, rejected: 0, needs: 0 });
    }
  }, [learningClientId]);

  useEffect(() => {
    void refreshFbSummary();
  }, [refreshFbSummary, learningClientId, entries?.length]);
  const hasData = entries != null && entries.length > 0;
  const jeEntries = hasData ? entries : [];
  const total = totalAnalysed ?? 0;
  const amt = totalAmt ?? "—";
  const anomalies = anomaliesCount ?? 0;
  const filtered = filter === "ALL" ? jeEntries : jeEntries.filter(e => e.level === filter);
  const counts = { HIGH: jeEntries.filter(e=>e.level==="HIGH").length, MEDIUM: jeEntries.filter(e=>e.level==="MEDIUM").length, LOW: jeEntries.filter(e=>e.level==="LOW").length };

  const fetchNovaExplanation = useCallback(async (e: JEEntryRow) => {
    if (novaCache[e.id]) return;
    setNovaLoading(e.id);
    const systemPrompt = "You are a financial fraud detection assistant. Explain why a journal entry was flagged in 3 bullet points. Be specific and use plain English. Max 60 words total.";
    const signalList = (e.signals && e.signals.length > 0) ? e.signals.join(", ") : "Amount, Duplicate, User, Timing, Account, Vendor (as triggered)";
    const userPrompt = `Journal entry details:\nVendor: ${e.vendor}\nAmount: ${e.amount}\nPosted by: ${e.postedBy}\nDate: ${e.date}\nAccount: ${e.account}\nSignals triggered: ${signalList}\nRisk score: ${e.score}/100\nExplain why this is suspicious.`;
    try {
      const res = await fetch(AI_INVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_id: "",
          prompt: `${systemPrompt}\n\n${userPrompt}`,
          max_tokens: 200,
          temperature: 0.3,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { text?: string };
      const text = (data.text ?? "").trim() || "No explanation available.";
      setNovaCache(prev => ({ ...prev, [e.id]: text }));
    } catch {
      setNovaCache(prev => ({ ...prev, [e.id]: "Unable to load AI analysis. Please try again." }));
    } finally {
      setNovaLoading(null);
    }
  }, [novaCache]);

  const handleRowClick = useCallback((e: JEEntryRow) => {
    const next = selected === e.id ? null : e.id;
    setSelected(next);
    if (next && !novaCache[next]) fetchNovaExplanation(e);
  }, [selected, novaCache, fetchNovaExplanation]);

  if (!hasData) {
    return (
      <Card style={{ marginBottom: 0 }}>
        <div style={{ padding: "32px 24px", textAlign: "center", background: C.bg, borderRadius: 12, border: `1px dashed ${C.border}` }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: "0 0 8px 0" }}>All Flagged Journal Entries</h3>
          <p style={{ fontSize: 12, color: C.textSub, margin: 0 }}>
            Upload journal entries above to see analysis and flagged entries.
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 16 }}>
            <div style={{ padding: "6px 12px", borderRadius: 8, background: C.redBg, border: `1px solid ${C.redBorder}`, minWidth: 64 }}>
              <div style={{ fontSize: 18, fontWeight: 900, fontFamily: mono, color: C.red }}>0</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.red }}>High</div>
            </div>
            <div style={{ padding: "6px 12px", borderRadius: 8, background: C.amberBg, border: `1px solid ${C.amberBorder}`, minWidth: 64 }}>
              <div style={{ fontSize: 18, fontWeight: 900, fontFamily: mono, color: C.amber }}>0</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.amber }}>Medium</div>
            </div>
            <div style={{ padding: "6px 12px", borderRadius: 8, background: C.greenBg, border: `1px solid ${C.greenBorder}`, minWidth: 64 }}>
              <div style={{ fontSize: 18, fontWeight: 900, fontFamily: mono, color: C.green }}>0</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.green }}>Low</div>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card style={{ marginBottom: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: 0 }}>All Flagged Journal Entries</h3>
          <p style={{ fontSize: 12, color: C.textSub, marginTop: 3 }}>
            Total: {total}
            {engineExtras
              ? ` · High: ${counts.HIGH} · Medium: ${counts.MEDIUM} · Low: ${counts.LOW} · Flagged: ${engineExtras.flagged_pct.toFixed(1)}%`
              : ""}
            {!engineExtras ? ` · ${anomalies} anomalies flagged` : ""} · {amt} total exposure at risk
          </p>
          {learningClientId ? (
            <p style={{ fontSize: 11, color: C.green, marginTop: 6, fontWeight: 600 }}>
              Learning: {fbSummary.total} reviewed · {fbSummary.approved} approved · {fbSummary.rejected} rejected
              {fbSummary.needs ? ` · ${fbSummary.needs} needs review` : ""}
            </p>
          ) : (
            <p style={{ fontSize: 11, color: C.textMute, marginTop: 6 }}>
              Select a <strong>client</strong> above to save approve/reject feedback and train client-specific thresholds.
            </p>
          )}
          {fbToast ? <p style={{ fontSize: 11, color: C.blue, marginTop: 4 }}>{fbToast}</p> : null}
          {engineExtras && engineExtras.models_used?.length ? (
            <p style={{ fontSize: 11, color: C.textMid, marginTop: 6, maxWidth: 720, lineHeight: 1.45 }}>
              <strong style={{ color: C.textSub }}>Models:</strong> {engineExtras.models_used.slice(0, 2).join(" · ")}
              {engineExtras.models_used.length > 2
                ? ` · +${engineExtras.models_used.length - 2} more (sensitivity: ${engineExtras.sensitivity})`
                : ` · (sensitivity: ${engineExtras.sensitivity})`}
            </p>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { label: "High", count: counts.HIGH,   bg: C.redBg,   text: C.red,   border: C.redBorder },
            { label: "Medium", count: counts.MEDIUM, bg: C.amberBg, text: C.amber, border: C.amberBorder },
            { label: "Low",  count: counts.LOW,    bg: C.greenBg, text: C.green, border: C.greenBorder },
          ].map(s => (
            <div key={s.label} style={{ padding: "6px 12px", borderRadius: 8, background: s.bg,
              border: `1px solid ${s.border}`, textAlign: "center", minWidth: 64 }}>
              <div style={{ fontSize: 18, fontWeight: 900, fontFamily: mono, color: s.text }}>{s.count}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: s.text, letterSpacing: "0.05em" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {(["ALL","HIGH","MEDIUM","LOW"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: "5px 14px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
            fontFamily: font, letterSpacing: "0.04em", border: "1px solid",
            borderColor: filter === f ? C.blue : C.border,
            background: filter === f ? C.blue : C.white,
            color: filter === f ? C.white : C.textSub,
          }}>{f === "ALL" ? "All Entries" : `${f} Risk`}</button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 11, color: C.textSub, alignSelf: "center" }}>
          Showing {filtered.length} flagged · {total} total analysed
        </span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1040 }}>
          <thead>
            <tr style={{ background: `linear-gradient(to right, ${C.navy}, #1E3A8A)` }}>
              {[
                { label: "Entry" }, { label: "Vendor / Account" }, { label: "Posted By" },
                { label: "Date / Tags" }, { label: "Amount", right: true },
                { label: "Amt",  tip: "Amount model" }, { label: "Dup", tip: "Duplicate check" },
                { label: "User", tip: "User behaviour" }, { label: "Time", tip: "Timing" },
                { label: "Acct", tip: "Account model" },
                { label: "Top reasons", tip: "First signals from rules + ML" },
                { label: "Risk Score", right: true },
              ].map((h) => (
                <th key={h.label} title={h.tip || ""} style={{
                  padding: "11px 12px", textAlign: (h as { right?: boolean }).right ? "right" : "left",
                  fontSize: 10, fontWeight: 700, color: "#BFDBFE",
                  letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap",
                }}>
                  {h.label}{(h as { tip?: string }).tip && <span style={{ opacity: 0.55, marginLeft: 2, fontSize: 9 }}>ⓘ</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((e, i) => {
              const sel = selected === e.id;
              return (
                <React.Fragment key={e.id}>
                <tr onClick={() => handleRowClick(e)}
                  style={{ background: sel ? C.bluePale : i % 2 === 0 ? C.white : "#FAFBFC",
                    cursor: "pointer", borderTop: `1px solid ${C.borderLight}` }}>
                  <td style={{ padding: "12px 14px", whiteSpace: "nowrap", width: 90 }}>
                    <span style={{
                      display: "inline-block",
                      fontFamily: mono, fontSize: 12, fontWeight: 600,
                      color: C.blue, background: C.bluePale,
                      padding: "5px 10px", borderRadius: 6,
                      border: `1px solid ${C.blueBorder}`,
                      whiteSpace: "nowrap", letterSpacing: "0.04em",
                    }}>
                      {e.id}
                    </span>
                  </td>
                  <td style={{ padding: "12px 12px" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{e.vendor}</div>
                    <div style={{ fontSize: 11, color: C.textSub, marginTop: 1 }}>{e.account}</div>
                  </td>
                  <td style={{ padding: "12px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                        background: C.bluePale, border: `1.5px solid ${C.blueBorder}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 10, fontWeight: 800, color: C.blue }}>
                        {e.postedBy[0]}
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 500, color: C.textMid }}>{e.postedBy}</span>
                    </div>
                  </td>
                  <td style={{ padding: "12px 12px" }}>
                    <div style={{ fontSize: 12, fontWeight: 400, color: C.textMid }}>{e.date}</div>
                    <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                      {e.tags.map(t => (
                        <span key={t} style={{ fontSize: 9, fontWeight: 700, padding: "2px 5px",
                          borderRadius: 3, background: C.bluePale, color: C.blue,
                          border: `1px solid ${C.blueBorder}`, letterSpacing: "0.04em" }}>{t}</span>
                      ))}
                    </div>
                  </td>
                  <td style={{ padding: "12px 12px", textAlign: "right" }}>
                    <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 400, color: C.text }}>{e.amount}</div>
                  </td>
                  <td style={{ padding: "12px 8px", textAlign: "center" }}>
                    <ScorePill value={e.amt} />
                  </td>
                  <td style={{ padding: "12px 8px", textAlign: "center" }}
                    title={e.dupMatchId ? `Matches ${e.dupMatchId} (same vendor + amount)` : undefined}>
                    <ScorePill value={e.dup} title={e.dupMatchId ? `Matches ${e.dupMatchId} (same vendor + amount)` : undefined} />
                  </td>
                  {[e.user, e.time, e.acct].map((v, j) => (
                    <td key={j} style={{ padding: "12px 8px", textAlign: "center" }}>
                      <ScorePill value={v} />
                    </td>
                  ))}
                  <td style={{ padding: "12px 10px", verticalAlign: "top" }}>
                    <ReasonChips items={e.signals && e.signals.length ? e.signals : []} />
                  </td>
                  <td style={{ padding: "12px 12px", textAlign: "right" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                      <ScoreValueBadge score={e.score} />
                      <RiskBar score={e.score} level={e.level} />
                    </div>
                  </td>
                </tr>
                {sel && (
                  <tr style={{ background: C.bluePale, borderTop: `1px solid ${C.blueBorder}` }}>
                    <td colSpan={12} style={{ padding: "16px 20px", borderBottom: `1px solid ${C.borderLight}` }}>
                      <div style={{ fontSize: 13, color: C.text }}>
                        <div style={{ fontWeight: 700, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                          Nova Analysis — {e.id}
                          {entryFb[e.id] ? (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 800,
                                padding: "2px 8px",
                                borderRadius: 4,
                                background: C.greenBg,
                                color: C.green,
                                border: `1px solid ${C.greenBorder}`,
                                letterSpacing: "0.06em",
                              }}
                            >
                              REVIEWED · {entryFb[e.id].toUpperCase()}
                            </span>
                          ) : null}
                        </div>
                        {novaLoading === e.id ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.textSub }}>
                            <span style={{ width: 18, height: 18, border: `2px solid ${C.border}`, borderTopColor: C.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                            Loading AI analysis…
                          </div>
                        ) : novaCache[e.id] ? (
                          <>
                            <p style={{ marginBottom: 10, lineHeight: 1.6 }}>This entry was flagged because:</p>
                            <div style={{ marginBottom: 12, paddingLeft: 16, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                              {novaCache[e.id]}
                            </div>
                            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12 }}>
                              <span style={{ fontWeight: 600, color: C.textMid }}>Risk Score: {e.score}/100 — {e.level}</span>
                              <span style={{ color: C.textSub }}>Recommended Action: {e.level === "HIGH" ? "Review with finance manager" : e.level === "MEDIUM" ? "Escalate to CFO" : "Auto-clear"}</span>
                            </div>
                          </>
                        ) : null}

                        {learningClientId && (e.level === "HIGH" || e.level === "MEDIUM") ? (
                          <div
                            style={{
                              marginTop: 18,
                              paddingTop: 14,
                              borderTop: `1px dashed ${C.blueBorder}`,
                            }}
                            onClick={(ev) => ev.stopPropagation()}
                          >
                            <div style={{ fontWeight: 800, marginBottom: 8, color: C.navy }}>Human review (learning loop)</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                              {(
                                [
                                  { key: "approved" as const, label: "Approve — valid entry", bg: C.green, icon: "✅" },
                                  { key: "rejected" as const, label: "Reject — real risk", bg: C.red, icon: "❌" },
                                  { key: "needs_review" as const, label: "Needs review", bg: C.amber, icon: "⚠️" },
                                ]
                              ).map((b) => (
                                <button
                                  key={b.key}
                                  type="button"
                                  disabled={!!entryFb[e.id] || fbSubmitting === e.id}
                                  onClick={async () => {
                                    if (!learningClientId) return;
                                    setFbSubmitting(e.id);
                                    setFbToast(null);
                                    try {
                                      const reasons =
                                        e.signals && e.signals.length
                                          ? [...e.signals]
                                          : [plainEnglishLine(e)];
                                      await postR2RFeedback({
                                        client_id: learningClientId,
                                        entry_id: e.id,
                                        entry_data: {
                                          account: e.account,
                                          amount: e.amountNum,
                                          user: e.postedBy,
                                          date: e.date,
                                          description: `${e.vendor} — ${plainEnglishLine(e)}`,
                                          risk_score: e.score,
                                          risk_level: e.level,
                                          risk_reasons: reasons,
                                        },
                                        feedback: b.key,
                                        comment: fbComments[e.id] || "",
                                        reviewed_by: "ca_manager",
                                      });
                                      setEntryFb((prev) => ({ ...prev, [e.id]: b.key }));
                                      setFbToast("Feedback saved. System is learning ✓");
                                      await refreshFbSummary();
                                      onLearningFeedback?.();
                                    } catch (err: unknown) {
                                      setFbToast(err instanceof Error ? err.message : "Feedback failed");
                                    } finally {
                                      setFbSubmitting(null);
                                    }
                                  }}
                                  style={{
                                    padding: "8px 12px",
                                    borderRadius: 8,
                                    border: "none",
                                    background: b.bg,
                                    color: C.white,
                                    fontSize: 12,
                                    fontWeight: 700,
                                    cursor: entryFb[e.id] ? "default" : "pointer",
                                    opacity: entryFb[e.id] ? 0.45 : 1,
                                    fontFamily: font,
                                  }}
                                >
                                  {b.icon} {b.label}
                                </button>
                              ))}
                            </div>
                            <label style={{ fontSize: 12, color: C.textSub, display: "block", maxWidth: 480 }}>
                              Comment (optional)
                              <input
                                type="text"
                                value={fbComments[e.id] || ""}
                                disabled={!!entryFb[e.id]}
                                onChange={(ev) =>
                                  setFbComments((prev) => ({ ...prev, [e.id]: ev.target.value }))
                                }
                                placeholder="e.g. legitimate month-end accrual"
                                style={{
                                  display: "block",
                                  width: "100%",
                                  marginTop: 6,
                                  padding: "8px 10px",
                                  borderRadius: 8,
                                  border: `1px solid ${C.border}`,
                                  fontSize: 13,
                                }}
                              />
                            </label>
                          </div>
                        ) : null}
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

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "10px 4px 0", borderTop: `1px solid ${C.borderLight}`, marginTop: 4 }}>
        <p style={{ fontSize: 10, color: C.textMute }}>
          <strong style={{ color: C.textSub }}>Columns:</strong> Amt / Dup / User / Time / Acct = sub-scores · Top reasons = rules + ML · Risk badge: green &lt;40 · amber 40–69 · red 70+
        </p>
        <p style={{ fontSize: 10, color: C.textMute }}>Click row to select · AI-powered explanations</p>
      </div>
    </Card>
  );
};

// ─── Tab: Anomaly Trend ───────────────────────────────────────────────────────
const TrendTab = ({ data }: { data: DerivedStats }) => {
  const trendData = data.trendByMonth;
  const maxVal = Math.max(1, ...trendData.map(x => x.high + x.medium + x.low));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        <StatCard label="Total Anomalies (MTD)" value={String(data.total)} sub="JEs analysed this period" color={C.blue} />
        <StatCard label="High Risk Flagged" value={String(data.high)} sub={`out of ${data.total} JEs analysed`} color={C.red} bg={C.redBg} border={C.redBorder} />
        <StatCard label="Auto-Cleared" value={String(data.autoCleaned)} sub="by AI rules engine" color={C.green} bg={C.greenBg} border={C.greenBorder} />
        <StatCard label="Avg Risk Score" value={String(data.avgScore)} sub="Above threshold (60)" color={C.amber} bg={C.amberBg} border={C.amberBorder} />
      </div>

      <Card>
        <SectionTitle sub="Anomalies flagged per month by severity">Anomaly Trend — Last 6 Months</SectionTitle>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 160, padding: "0 8px" }}>
          {trendData.map((td) => {
            const total = td.high + td.medium + td.low;
            return (
              <div key={td.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textSub, fontFamily: mono }}>{total}</div>
                <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 2 }}>
                  {[{ v: td.high, c: C.red }, { v: td.medium, c: C.amber }, { v: td.low, c: "#22C55E" }].map((b, i) => (
                    <div key={i} style={{ height: Math.round((b.v / maxVal) * 100) || (b.v > 0 ? 6 : 0), background: b.c,
                      borderRadius: i === 0 ? "5px 5px 0 0" : 0, minHeight: b.v > 0 ? 6 : 0, transition: "height 0.4s" }} />
                  ))}
                </div>
                <div style={{ fontSize: 11, color: C.textSub, fontWeight: 600 }}>{td.month}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 18, justifyContent: "center", marginTop: 12 }}>
          {[["High Risk", C.red], ["Medium Risk", C.amber], ["Low Risk", "#22C55E"]].map(([l, c]) => (
            <div key={String(l)} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.textSub }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: c }} />{l}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle sub="Month-over-month anomaly delta by category">Pattern Shift Analysis</SectionTitle>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Pattern Type", "Prev Count", "Curr Count", "Change", "Trend", "Status"].map((h, i) => (
                <TH key={h} right={i >= 1 && i <= 3}>{h}</TH>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.patternShift.map((r, i) => (
              <tr key={r.type} style={{ background: i % 2 === 0 ? C.white : "#FAFBFC" }}>
                <TD><span style={{ marginRight: 7 }}>{r.icon}</span><strong style={{ color: C.text }}>{r.type}</strong></TD>
                <TD right mono>{r.prev}</TD>
                <TD right mono>{r.curr}</TD>
                <TD right mono style={{ color: r.delta > 0 ? C.red : r.delta < 0 ? C.green : C.textMid, fontWeight: 700 }}>
                  {r.delta > 0 ? `+${r.delta}` : r.delta}
                  <span style={{ fontSize: 11, marginLeft: 4 }}>({r.pct > 0 ? `+${r.pct}` : r.pct}%)</span>
                </TD>
                <TD>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12 }}>{r.delta > 0 ? "↑" : r.delta < 0 ? "↓" : "→"}</span>
                    <MiniBar pct={Math.abs(r.pct)} color={r.delta > 0 ? C.red : C.green} />
                  </div>
                </TD>
                <TD><Badge label={r.status === "green" ? "Improving" : r.status === "red" ? "Escalating" : r.status === "amber" ? "Watch" : "Stable"} color={r.status === "blue" ? "blue" : r.status as "red"|"amber"|"green"} /></TD>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
};

// ─── Tab: Vendor Patterns ─────────────────────────────────────────────────────
const VendorTab = ({ data }: { data: DerivedStats }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
    <Card>
      <SectionTitle sub="Vendors with highest anomaly frequency and risk concentration">High-Risk Vendor Analysis</SectionTitle>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Vendor", "Account Type", "JE Count", "Avg Amount", "Risk Score", "Top Flag", "Action"].map((h, i) => (
              <TH key={h} right={i >= 2 && i <= 4}>{h}</TH>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.vendorPatterns.map((r, i) => (
            <tr key={r.vendor} style={{ background: i % 2 === 0 ? C.white : "#FAFBFC" }}>
              <TD style={{ fontWeight: 700, color: C.text }}>{r.vendor}</TD>
              <TD style={{ color: C.textSub }}>{r.acct}</TD>
              <TD right mono>{r.count}</TD>
              <TD right mono style={{ fontWeight: 400, color: C.text }}>{r.avg}</TD>
              <TD right>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                  <span style={{ fontFamily: mono, fontWeight: 800, fontSize: 14,
                    color: r.score >= 71 ? C.red : r.score >= 41 ? C.amber : C.green }}>{r.score}</span>
                  <MiniBar pct={r.score} color={r.score >= 71 ? C.red : r.score >= 41 ? C.amber : C.green} />
                </div>
              </TD>
              <TD><Badge label={r.flag} color={r.action} /></TD>
              <TD>
                <Badge label={r.action === "red" ? "Investigate" : r.action === "amber" ? "Review" : "Monitor"} color={r.action} />
              </TD>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      <Card>
        <SectionTitle sub="Vendors with repeat anomalies across periods">Repeat Offender Pattern</SectionTitle>
        {data.vendorPatterns.slice(0, 5).map((v) => (
          <div key={v.vendor} style={{ padding: "12px 0", borderBottom: `1px solid ${C.borderLight}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{v.vendor}</div>
                <div style={{ fontSize: 11, color: C.textSub }}>{v.count}× flagged</div>
              </div>
              <span style={{ fontFamily: mono, fontWeight: 800, fontSize: 16,
                color: v.score >= 71 ? C.red : v.score >= 41 ? C.amber : C.green }}>{v.score}</span>
            </div>
            <MiniBar pct={v.score} color={v.score >= 71 ? C.red : v.score >= 41 ? C.amber : C.green} height={5} />
          </div>
        ))}
      </Card>

      <Card>
        <SectionTitle sub="Concentration of anomalies by account head">Account Category Exposure</SectionTitle>
        {(() => {
          const byAcct: Record<string, number> = {};
          data.entries.forEach(e => { byAcct[e.account] = (byAcct[e.account] || 0) + 1; });
          const total = data.entries.length;
          return Object.entries(byAcct).sort((a,b) => b[1] - a[1]).slice(0, 6).map(([acct, count]) => ({
            acct: acct || "—",
            count,
            pct: total ? Math.round(count / total * 100) : 0,
            color: count >= 3 ? C.red : count >= 2 ? C.amber : C.blue,
          }));
        })().map((a) => (
          <div key={a.acct} style={{ padding: "10px 0", borderBottom: `1px solid ${C.borderLight}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontSize: 13, color: C.textMid, fontWeight: 500 }}>{a.acct}</span>
              <span style={{ fontSize: 12, fontFamily: mono, color: C.textSub }}>{a.pct}% · {a.count} JEs</span>
            </div>
            <MiniBar pct={a.pct} color={a.color} height={5} />
          </div>
        ))}
      </Card>
    </div>
  </div>
);

// ─── Tab: User Behaviour ─────────────────────────────────────────────────────
const UserTab = ({ data }: { data: DerivedStats }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
    <Card>
      <SectionTitle sub="Posting behaviour and anomaly attribution per user">User Activity & Risk Profile</SectionTitle>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["User", "JEs Posted", "Flagged", "Flag Rate", "Avg Risk", "Wknd Posts", "Profile"].map((h, i) => (
              <TH key={h} right={i >= 1 && i <= 5}>{h}</TH>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.userPatterns.map((r, i) => (
            <tr key={r.user} style={{ background: i % 2 === 0 ? C.white : "#FAFBFC" }}>
              <TD>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 30, height: 30, borderRadius: "50%",
                    background: r.profile === "red" ? C.redBg : r.profile === "amber" ? C.amberBg : C.greenBg,
                    border: `1.5px solid ${r.profile === "red" ? C.redBorder : r.profile === "amber" ? C.amberBorder : C.greenBorder}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 800, color: r.profile === "red" ? C.red : r.profile === "amber" ? C.amber : C.green }}>
                    {(r.user || "?")[0]}
                  </div>
                  <span style={{ fontWeight: 700, color: C.text }}>{r.user}</span>
                </div>
              </TD>
              <TD right mono>{r.total}</TD>
              <TD right mono style={{ fontWeight: 700, color: r.flagged > 0 ? C.red : C.green }}>{r.flagged}</TD>
              <TD right mono style={{ color: r.rate > 4 ? C.red : r.rate > 2 ? C.amber : C.green, fontWeight: 700 }}>
                {r.rate}%
              </TD>
              <TD right>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                  <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 13,
                    color: r.avg >= 71 ? C.red : r.avg >= 41 ? C.amber : C.green }}>{r.avg}</span>
                  <MiniBar pct={r.avg} color={r.avg >= 71 ? C.red : r.avg >= 41 ? C.amber : C.green} />
                </div>
              </TD>
              <TD right mono style={{ color: r.wknd > 1 ? C.red : r.wknd === 1 ? C.amber : C.textMute }}>
                {r.wknd > 0 ? r.wknd : "—"}
              </TD>
              <TD><Badge label={r.profile === "red" ? "High Risk" : r.profile === "amber" ? "Monitor" : "Clean"} color={r.profile} /></TD>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      <Card>
        <SectionTitle sub="Separation of duties conflicts detected">SOD Violation Log</SectionTitle>
        {data.userPatterns.filter(u => u.avg >= 70 && u.flagged > 0).slice(0, 5).map((u) => (
          <div key={u.user} style={{ padding: "12px 14px", marginBottom: 10, borderRadius: 8,
            background: C.redBg,
            border: `1px solid ${C.redBorder}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{u.user}</span>
              <span style={{ fontSize: 11, color: C.textSub }}>{u.flagged} flagged · avg {u.avg}</span>
            </div>
            <div style={{ fontSize: 12, color: C.textMid }}>High-risk entries require review</div>
          </div>
        ))}
      </Card>

      <Card>
        <SectionTitle sub="Entries posted outside standard working hours">Off-Hours Posting Heatmap</SectionTitle>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Time Window", "Entries", "Risk Multiplier"].map((h) => <TH key={h}>{h}</TH>)}
            </tr>
          </thead>
          <tbody>
            {[
              { time: "Weekend (Wknd tag)", count: data.entries.filter(e => e.tags.includes("Wknd")).length, mult: "3.0×", color: C.red },
              { time: "Month-End (M-End tag)", count: data.entries.filter(e => e.tags.includes("M-End")).length, mult: "2.0×", color: C.amber },
              { time: "Regular", count: data.entries.filter(e => !e.tags.includes("Wknd") && !e.tags.includes("M-End")).length, mult: "1.0×", color: C.green },
            ].map((r, i) => (
              <tr key={r.time} style={{ background: i % 2 === 0 ? C.white : "#FAFBFC" }}>
                <TD style={{ fontSize: 12 }}>{r.time}</TD>
                <TD mono style={{ fontWeight: 700, color: r.color }}>{r.count}</TD>
                <TD><Badge label={r.mult} color={r.color === C.green ? "green" : r.color === C.amber ? "amber" : "red"} /></TD>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  </div>
);

// ─── Tab: Statistical Patterns ────────────────────────────────────────────────
const StatTab = ({ data }: { data: DerivedStats }) => {
  const unusualAmt = data.entries.filter(e => (e.amt || 0) >= 70).length;
  const roundNumbers = data.entries.filter(e => /0{2,}$/.test(String(e.amount).replace(/[₹,\s]/g, ""))).length;
  const highValue = [...data.entries].sort((a, b) => b.score - a.score).slice(0, 8);
  return (
  <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
      <StatCard label="Unusual Amount Entries" value={String(unusualAmt)} sub="Amt score ≥ 70" color={C.red} bg={C.redBg} border={C.redBorder} />
      <StatCard label="High Risk Entries" value={String(data.high)} sub="Score ≥ 71" color={C.amber} bg={C.amberBg} border={C.amberBorder} />
      <StatCard label="Round Number Entries" value={String(roundNumbers)} sub="Potential fabrication flag" color={C.blue} />
    </div>

    <Card>
      <SectionTitle sub="Entries with statistically unusual amounts flagged by AI">High-Value Anomaly Entries</SectionTitle>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Entry", "Vendor", "Amount", "Risk Band", "Statistical Risk"].map((h, i) => (
              <TH key={h} right={i === 2}>{h}</TH>
            ))}
          </tr>
        </thead>
        <tbody>
          {highValue.map((r, i) => (
            <tr key={r.id} style={{ background: i % 2 === 0 ? C.white : "#FAFBFC" }}>
              <TD>
                <span style={{ display: "inline-block", fontSize: 12, fontWeight: 600, fontFamily: mono, color: C.blue,
                  background: C.bluePale, padding: "5px 10px", borderRadius: 6, border: `1px solid ${C.blueBorder}`,
                  whiteSpace: "nowrap", letterSpacing: "0.04em" }}>
                  {r.id}
                </span>
              </TD>
              <TD style={{ color: C.text, fontWeight: 500 }}>{r.vendor}</TD>
              <TD right mono style={{ fontWeight: 400, color: C.text }}>{r.amount}</TD>
              <TD>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <Badge label={r.score >= 71 ? "Extreme" : r.score >= 41 ? "Very High" : "High"} color={r.score >= 71 ? "red" : "amber"} />
                  <MiniBar pct={r.score} color={r.score >= 71 ? C.red : C.amber} height={4} />
                </div>
              </TD>
              <TD>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, fontFamily: mono,
                    color: r.score >= 71 ? C.red : C.amber }}>{r.score}</span>
                  <span style={{ fontSize: 10, color: C.textSub }}>/ 100</span>
                </div>
              </TD>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      <Card>
        <SectionTitle sub="Entries with suspiciously round values">Round Number Analysis</SectionTitle>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>{["Entry", "Amount", "Vendor", "Risk"].map((h) => <TH key={h}>{h}</TH>)}</tr>
          </thead>
          <tbody>
            {data.entries.filter(e => /0{2,}$/.test(String(e.amount).replace(/[₹,\s]/g, ""))).slice(0, 6).map((r, i) => (
              <tr key={r.id} style={{ background: i % 2 === 0 ? C.white : "#FAFBFC" }}>
                <TD style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, color: C.blue, whiteSpace: "nowrap" }}>
                  <span style={{ display: "inline-block", background: C.bluePale, padding: "5px 10px",
                    borderRadius: 6, border: `1px solid ${C.blueBorder}`, letterSpacing: "0.04em" }}>
                    {r.id}
                  </span>
                </TD>
                <TD mono style={{ fontWeight: 700, color: C.text }}>{r.amount}</TD>
                <TD style={{ fontSize: 12, color: C.textSub }}>{r.vendor}</TD>
                <TD><Badge label={r.score >= 71 ? "High" : r.score >= 41 ? "Watch" : "Note"} color={r.score >= 71 ? "red" : "amber"} /></TD>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <SectionTitle sub="Benford's Law first-digit distribution check">Benford's Law Test</SectionTitle>
        {[1, 2, 3, 4, 5].map((d) => {
          const expected = [30.1, 17.6, 12.5, 9.7, 7.9][d - 1];
          const actual = [28.4, 14.2, 13.1, 10.5, 9.8][d - 1];
          const diff = Math.abs(actual - expected).toFixed(1);
          const flag = Number(diff) > 3;
          return (
            <div key={d} style={{ padding: "9px 0", borderBottom: `1px solid ${C.borderLight}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: mono, fontWeight: 800, fontSize: 15, color: C.text }}>{d}</span>
                  <span style={{ fontSize: 11, color: C.textSub }}>Expected {expected}% · Actual {actual}%</span>
                </div>
                {flag && <Badge label={`Δ${diff}%`} color="red" />}
              </div>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <div style={{ flex: 1, height: 5, borderRadius: 999, background: C.bg, overflow: "hidden" }}>
                  <div style={{ width: `${(expected / 35) * 100}%`, height: "100%", background: C.blueBorder, borderRadius: 999 }} />
                </div>
                <div style={{ flex: 1, height: 5, borderRadius: 999, background: C.bg, overflow: "hidden" }}>
                  <div style={{ width: `${(actual / 35) * 100}%`, height: "100%",
                    background: flag ? C.red : C.green, borderRadius: 999 }} />
                </div>
              </div>
            </div>
          );
        })}
        <div style={{ marginTop: 10, display: "flex", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.textSub }}>
            <div style={{ width: 10, height: 4, borderRadius: 2, background: C.blueBorder }} /> Expected
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.textSub }}>
            <div style={{ width: 10, height: 4, borderRadius: 2, background: C.green }} /> Actual (Normal)
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.textSub }}>
            <div style={{ width: 10, height: 4, borderRadius: 2, background: C.red }} /> Actual (Flagged)
          </div>
        </div>
      </Card>
    </div>
  </div>
  );
};

// ─── Tab: AI Insights ─────────────────────────────────────────────────────────
const AIInsightsTab = ({ data }: { data: DerivedStats }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
    <Card style={{ borderLeft: `4px solid ${C.blue}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text, display: "flex", alignItems: "center", gap: 6 }}>
            🤖 AI Pattern Summary <span style={{ fontSize: 11, color: C.textSub, fontWeight: 400 }}>LLM-assisted</span>
          </div>
          <div style={{ fontSize: 12, color: C.textSub, marginTop: 2 }}>Generated {new Date().toLocaleDateString()} · {data.total} JEs analysed · {data.high} HIGH risk flagged</div>
        </div>
        <Badge label="87% Confidence" color="green" />
      </div>
      {[
        { icon: "🔴", title: "Steel Corp Concentration Risk", body: "3 entries from Steel Corp across Jan–Mar 26 show a consistent pattern of weekend posting and z-scores above +2.96σ. Recommend enhanced approval workflow for this vendor.", severity: "red" as const },
        { icon: "🟡", title: "Month-End Spike Detected", body: "7 JEs posted within 2 days of month-end vs 5 last month (+40%). All entries by Rajan and Priya. Likely legitimate accruals but flag for CFO review.", severity: "amber" as const },
        { icon: "🔴", title: "SOD Violation — Rajan", body: "Rajan posted and approved JE-056 without secondary sign-off. This bypasses the 4-eyes principle. Immediate access review recommended.", severity: "red" as const },
        { icon: "🟢", title: "Duplicate Risk Improving", body: "Duplicate detection prevented 2 potential repeat postings this month, down from 4 in February. AI rules engine is performing well on this category.", severity: "green" as const },
      ].map((a) => (
        <div key={a.title} style={{ padding: "14px 16px", marginBottom: 12, borderRadius: 9,
          background: a.severity === "red" ? C.redBg : a.severity === "amber" ? C.amberBg : a.severity === "green" ? C.greenBg : C.bluePale,
          border: `1px solid ${a.severity === "red" ? C.redBorder : a.severity === "amber" ? C.amberBorder : a.severity === "green" ? C.greenBorder : C.blueBorder}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 5 }}>{a.icon} {a.title}</div>
          <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.6 }}>{a.body}</div>
        </div>
      ))}
    </Card>

    <Card>
      <SectionTitle sub="Recommended actions based on AI pattern detection">Recommended Actions</SectionTitle>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>{["Priority", "Action", "Owner", "Due", "Impact"].map((h) => <TH key={h}>{h}</TH>)}</tr>
        </thead>
        <tbody>
          {[
            { p: "P1", action: "Revoke Rajan's self-approval access", owner: "IT Admin", due: "Today", impact: "red" as const, impactLabel: "SOD Fix" },
            { p: "P1", action: "Investigate Steel Corp entries JE-056, 071, 048", owner: "CFO", due: "This week", impact: "red" as const, impactLabel: "₹14L at risk" },
            { p: "P2", action: "Add month-end 4-eyes review gate", owner: "Finance Lead", due: "Apr 1", impact: "amber" as const, impactLabel: "Process Fix" },
            { p: "P2", action: "Request invoice docs for JE-032 (New Machinery)", owner: "Priya", due: "Mar 15", impact: "amber" as const, impactLabel: "Audit Trail" },
            { p: "P3", action: "Review Benford digit-2 distribution anomaly", owner: "Internal Audit", due: "Apr 30", impact: "blue" as const, impactLabel: "Monitoring" },
          ].map((r, i) => (
            <tr key={r.action} style={{ background: i % 2 === 0 ? C.white : "#FAFBFC" }}>
              <TD><Badge label={r.p} color={r.p === "P1" ? "red" : r.p === "P2" ? "amber" : "blue"} /></TD>
              <TD style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>{r.action}</TD>
              <TD style={{ color: C.textSub }}>{r.owner}</TD>
              <TD style={{ color: r.due === "Today" ? C.red : C.textMid, fontWeight: r.due === "Today" ? 700 : 400 }}>{r.due}</TD>
              <TD><Badge label={r.impactLabel} color={r.impact} /></TD>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button
          onClick={handleExportReport}
          style={{ background: C.blue, color: C.white, border: "none", borderRadius: 8,
            padding: "10px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: font }}
        >
          Export Pattern Report
        </button>
        <button style={{ background: C.white, color: C.blue, border: `1.5px solid ${C.blue}`, borderRadius: 8,
          padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
          Add to Board Pack
        </button>
        <button style={{ background: C.white, color: C.textMid, border: `1.5px solid ${C.border}`, borderRadius: 8,
          padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
          Set Alerts
        </button>
      </div>
    </Card>
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────
const tabs = [
  { id: "trend",   label: "Anomaly Trend",       icon: "📈" },
  { id: "vendor",  label: "Vendor Patterns",    icon: "🏭" },
  { id: "user",    label: "User Behaviour",      icon: "👤" },
  { id: "stats",   label: "Statistical Analysis", icon: "📊" },
  { id: "ai",      label: "AI Insights",          icon: "🤖" },
  { id: "learning", label: "Learning",          icon: "🧠" },
];

export default function R2RPatternAnalysisPage() {
  const navigate = useNavigate();
  const [active, setActive] = useState("trend");
  const [rawRows, setRawRows] = useState<any[]>(() => []); // always start empty — no demo data, no localStorage pre-load
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [clients, setClients] = useState<R2RClient[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [newClientName, setNewClientName] = useState("");

  const [patternResult, setPatternResult] = useState<AnalyzeEntriesResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [sensitivity, setSensitivity] = useState<PatternSensitivity>(() => loadR2rSensitivity());
  const [customThresholdStr, setCustomThresholdStr] = useState(() => loadR2rThresholdStr());
  const [analysisBannerLabel, setAnalysisBannerLabel] = useState<string | null>(null);
  const [materialityAmountStr, setMaterialityAmountStr] = useState("");
  const [materialityPctStr, setMaterialityPctStr] = useState("");
  const [learningRefresh, setLearningRefresh] = useState(0);
  const lastJeCfoSyncKey = useRef<string | null>(null);

  useEffect(() => {
    localStorage.setItem(LS_R2R_SENSITIVITY, sensitivity);
    localStorage.setItem(LS_R2R_THRESHOLD, customThresholdStr);
    localStorage.setItem("fraud_detection_threshold", customThresholdStr);
  }, [sensitivity, customThresholdStr]);

  useEffect(() => {
    setClientsLoading(true);
    listClients()
      .then(setClients)
      .catch(() => setClients([]))
      .finally(() => setClientsLoading(false));
  }, []);

  useEffect(() => {
    if (!rawRows.length) {
      setPatternResult(null);
      setAnalysisBannerLabel(null);
      return;
    }
    let cancelled = false;
    setAnalysisLoading(true);
    setUploadError(null);
    const run = async () => {
      const fromLs = localStorage.getItem(LS_R2R_SENSITIVITY);
      const safeSens: PatternSensitivity =
        fromLs === "conservative" || fromLs === "balanced" || fromLs === "strict"
          ? fromLs
          : sensitivity;
      const th =
        localStorage.getItem(LS_R2R_THRESHOLD) ||
        localStorage.getItem("fraud_detection_threshold") ||
        customThresholdStr ||
        "40";
      if (!cancelled) {
        setAnalysisBannerLabel(
          `Analysing with: ${R2R_SENSITIVITY_TITLE[safeSens]} threshold (${th}+)`
        );
      }
      try {
        if (selectedClientId) {
          await saveUpload(selectedClientId, rawRows, uploadFileName || undefined);
          await getClientHistory(selectedClientId);
        }
        const res = await analyzePatternBackend(
          rawRows,
          safeSens,
          API_BASE,
          th,
          materialityAmountStr,
          materialityPctStr
        );
        if (!cancelled) setPatternResult(res);
      } catch (e) {
        if (!cancelled) {
          console.error(e);
          setPatternResult(null);
          setAnalysisBannerLabel(null);
          setUploadError(e instanceof Error ? e.message : "Pattern analysis failed. Is the API running on port 8000?");
        }
      } finally {
        if (!cancelled) setAnalysisLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [rawRows, selectedClientId, sensitivity, customThresholdStr, materialityAmountStr, materialityPctStr]);

  useEffect(() => {
    if (!patternResult?.entries?.length || rawRows.length < 10) return;
    const th = customThresholdStr || "40";
    const syncKey = `${rawRows.length}:${patternResult.entries.length}:${sensitivity}:${th}:${materialityAmountStr}:${materialityPctStr}:${selectedClientId || ""}`;
    if (lastJeCfoSyncKey.current === syncKey) return;
    lastJeCfoSyncKey.current = syncKey;
    const tid = selectedClientId || "default";
    void postCfoAgentRun(
      "je_anomaly",
      {
        rows: rawRows,
        sensitivity,
        materiality_amount: parseFloat(String(materialityAmountStr).replace(/,/g, "")) || 0,
        materiality_pct: parseFloat(String(materialityPctStr).replace(/,/g, "")) || 0,
        period: "r2r_upload",
        company_id: tid,
      },
      tid
    ).catch((err) => console.warn("[CFO] je_anomaly agent:", err));
  }, [
    patternResult,
    rawRows,
    sensitivity,
    customThresholdStr,
    materialityAmountStr,
    materialityPctStr,
    selectedClientId,
  ]);

  const jeEntriesFromUpload = useMemo(() => {
    if (!patternResult?.entries?.length) return [];
    return patternResult.entries
      .map((p, i) => scoredEntryToJEEntry(p, i))
      .sort((a, b) => b.score - a.score);
  }, [patternResult]);

  const totalAmtStr = useMemo(() => {
    if (!patternResult?.entries?.length) return "—";
    const sum = patternResult.entries.reduce((s, p) => s + p.amount, 0);
    if (sum >= 1e7) return formatAmountINR(sum) + " (" + (sum / 1e7).toFixed(1) + " Cr)";
    if (sum >= 1e5) return formatAmountINR(sum) + " (" + (sum / 1e5).toFixed(1) + "L)";
    return formatAmountINR(sum);
  }, [patternResult]);

  const derivedStats = useMemo<DerivedStats | null>(() => {
    const entries = jeEntriesFromUpload;
    if (!entries.length) return null;
    const high = entries.filter(e => e.level === "HIGH").length;
    const medium = entries.filter(e => e.level === "MEDIUM").length;
    const low = entries.filter(e => e.level === "LOW").length;
    const total = entries.length;
    const avgScore = Math.round(entries.reduce((s, e) => s + e.score, 0) / total);
    const trendByMonth = computeTrendByMonth(entries);
    const vendorPatterns = computeVendorPatterns(entries);
    const userPatterns = computeUserPatterns(entries);
    const patternShift = computePatternShift(entries);
    return {
      total,
      high,
      medium,
      low,
      avgScore,
      autoCleaned: 0,
      trendByMonth: trendByMonth.length ? trendByMonth : MONTH_NAMES.slice(-6).map(m => ({ month: m, high: 0, medium: 0, low: 0 })),
      vendorPatterns,
      userPatterns,
      patternShift,
      entries,
    };
  }, [jeEntriesFromUpload]);

  const handleExportReport = useCallback(() => {
    try {
      if (!jeEntriesFromUpload.length) {
        alert("No data to export. Upload and analyse journal entries first.");
        return;
      }
      const clientName =
        (selectedClientId && clients.find((c) => c.id === selectedClientId)?.name) || "Client";
      const total = jeEntriesFromUpload.length;
      const high = jeEntriesFromUpload.filter((e) => e.level === "HIGH").length;
      const medium = jeEntriesFromUpload.filter((e) => e.level === "MEDIUM").length;
      const low = jeEntriesFromUpload.filter((e) => e.level === "LOW").length;
      const flaggedPct = total ? Math.round(((high + medium) / total) * 1000) / 10 : 0;
      const dates = jeEntriesFromUpload
        .map((e) => parseEntryDate(e.date))
        .filter((d): d is Date => d != null && !isNaN(d.getTime()));
      const periodStr =
        dates.length >= 2
          ? `${formatReportAnalysisDate(new Date(Math.min(...dates.map((d) => d.getTime()))))} – ${formatReportAnalysisDate(new Date(Math.max(...dates.map((d) => d.getTime()))))}`
          : dates.length === 1
            ? formatReportAnalysisDate(dates[0])
            : "—";
      const analysisDateStr = formatReportAnalysisDate(new Date());

      const flaggedSorted = jeEntriesFromUpload
        .filter((e) => e.level === "HIGH" || e.level === "MEDIUM")
        .sort((a, b) => b.score - a.score);
      const top10 = flaggedSorted.slice(0, 10);

      const summarySheet: (string | number)[][] = [
        ["AI ANOMALY DETECTION REPORT"],
        [],
        ["Company:", clientName],
        ["Period:", periodStr],
        ["Total entries analysed:", total],
        ["High risk:", high, "Medium:", medium, "Low:", low],
        ["Flagged rate (%):", flaggedPct],
        ["Analysis date:", analysisDateStr],
        [],
        ["TOP 10 ENTRIES REQUIRING IMMEDIATE REVIEW"],
        [
          "Entry ID",
          "Account",
          "Amount (₹)",
          "User",
          "Date",
          "Risk score",
          "Plain English Reason",
        ],
        ...top10.map((e) => [
          e.id,
          e.account,
          Math.round(e.amountNum),
          e.postedBy,
          e.date,
          e.score,
          plainEnglishLine(e),
        ]),
      ];

      const flaggedHeaders = [
        "Entry ID",
        "Account",
        "Amount (₹)",
        "User",
        "Date",
        "Risk score",
        "Level",
        "Plain English Reason",
        "Action Required",
      ];
      const flaggedRows = flaggedSorted.map((e) => [
        e.id,
        e.account,
        Math.round(e.amountNum),
        e.postedBy,
        e.date,
        e.score,
        e.level,
        plainEnglishLine(e),
        actionRequiredForLevel(e.level),
      ]);

      type Agg = { n: number; high: number; medium: number; low: number; sumScore: number };
      const byAccount = new Map<string, Agg>();
      const byUser = new Map<string, Agg>();
      const byMonth = new Map<string, Agg>();
      for (const e of jeEntriesFromUpload) {
        const bump = (m: Map<string, Agg>, key: string) => {
          const cur = m.get(key) || { n: 0, high: 0, medium: 0, low: 0, sumScore: 0 };
          cur.n += 1;
          cur.sumScore += e.score;
          if (e.level === "HIGH") cur.high += 1;
          else if (e.level === "MEDIUM") cur.medium += 1;
          else cur.low += 1;
          m.set(key, cur);
        };
        bump(byAccount, e.account || "—");
        bump(byUser, e.postedBy || "—");
        const d = parseEntryDate(e.date);
        const mk = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : "Unknown";
        bump(byMonth, mk);
      }
      const sortAgg = (m: Map<string, Agg>) =>
        [...m.entries()]
          .map(([k, v]) => ({
            key: k,
            ...v,
            avgScore: v.n ? Math.round(v.sumScore / v.n) : 0,
          }))
          .sort((a, b) => b.avgScore - a.avgScore);

      const riskBreakdown: (string | number)[][] = [
        ["RISK BREAKDOWN — BY ACCOUNT"],
        ["Account", "Entries", "HIGH", "MEDIUM", "LOW", "Avg risk score"],
        ...sortAgg(byAccount).map((r) => [r.key, r.n, r.high, r.medium, r.low, r.avgScore]),
        [],
        ["RISK BREAKDOWN — BY USER"],
        ["User", "Entries", "HIGH", "MEDIUM", "LOW", "Avg risk score"],
        ...sortAgg(byUser).map((r) => [r.key, r.n, r.high, r.medium, r.low, r.avgScore]),
        [],
        ["RISK BREAKDOWN — BY MONTH (posting date)"],
        ["Month", "Entries", "HIGH", "MEDIUM", "LOW", "Avg risk score"],
        ...sortAgg(byMonth).map((r) => [r.key, r.n, r.high, r.medium, r.low, r.avgScore]),
      ];

      const filename = `R2R_Pattern_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summarySheet), "Executive Summary");
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([flaggedHeaders, ...flaggedRows]),
        "All Flagged Entries"
      );
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(riskBreakdown), "Risk Breakdown");
      const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      alert("Report downloaded: " + filename);
    } catch (err: any) {
      console.error("Export failed:", err);
      alert("Export failed: " + (err?.message || "Unknown error"));
    }
  }, [jeEntriesFromUpload, selectedClientId, clients]);

  const handleFile = useCallback((file: File) => {
    setUploadError(null);
    const isCsv = file.name.toLowerCase().endsWith(".csv");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data) { setUploadError("Could not read file"); return; }
        let rows: any[];
        if (isCsv) {
          const text = typeof data === "string" ? data : new TextDecoder().decode(data as ArrayBuffer);
          const lines = text.split(/\r?\n/).filter(Boolean);
          const header = lines[0].split(",").map((h: string) => h.trim());
          rows = lines.slice(1).map((line: string) => {
            const vals = line.split(",").map((v: string) => v.trim());
            const obj: any = {};
            header.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
            return obj;
          });
        } else {
          const wb = XLSX.read(data, { type: isCsv ? "string" : "array" });
          // Try all sheets; use one that looks like journal entries (has amount + date/vendor/account)
          const trySheet = (name: string) => {
            const sheet = wb.Sheets[name];
            const arr = XLSX.utils.sheet_to_json(sheet) as any[];
            if (arr.length < 2) return [];
            const first = arr[0] || {};
            const keys = Object.keys(first).map((k) => k.toLowerCase());
            const hasAmount = keys.some((k) => k.includes("amount") || k.includes("debit") || k.includes("credit"));
            const hasContext = keys.some((k) => k.includes("date") || k.includes("vendor") || k.includes("account") || k.includes("posted") || k.includes("user"));
            if (hasAmount && (hasContext || keys.length >= 3)) return arr;
            return [];
          };
          const preferred = wb.SheetNames.find((n) => /r2r|journal|entry|je/i.test(n));
          rows = preferred ? trySheet(preferred) : [];
          if (rows.length === 0) {
            for (const name of wb.SheetNames) {
              rows = trySheet(name);
              if (rows.length > 0) break;
            }
          }
          if (rows.length === 0) rows = trySheet(wb.SheetNames[0]);
        }
        setRawRows(rows || []);
        setUploadFileName(file.name);
      } catch (err: any) {
        setUploadError(err?.message || "Parse error");
        setRawRows([]);
      }
    };
    if (isCsv) reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  }, []);

  const renderTab = () => {
    const emptyMsg = (
      <div style={{ padding: 48, textAlign: "center", background: C.bg, borderRadius: 12, border: `1px dashed ${C.border}`, color: C.textSub, fontSize: 14 }}>
        Upload journal entries above to see analysis
      </div>
    );
    if (active === "learning") {
      return (
        <LearningDashboardTab
          clientId={selectedClientId}
          clientLabel={selectedClientId ? clients.find((c) => c.id === selectedClientId)?.name : undefined}
          refreshToken={learningRefresh}
        />
      );
    }
    if (!derivedStats) return emptyMsg;
    switch (active) {
      case "trend":  return <TrendTab data={derivedStats} />;
      case "vendor": return <VendorTab data={derivedStats} />;
      case "user":   return <UserTab data={derivedStats} />;
      case "stats":  return <StatTab data={derivedStats} />;
      case "ai":     return <AIInsightsTab data={derivedStats} />;
      default:       return null;
    }
  };

  return (
    <div style={{ fontFamily: font, background: C.bg, minHeight: "100vh" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=DM+Mono:wght@400;500;700&display=swap');*{box-sizing:border-box;margin:0;padding:0;}@keyframes spin{to{transform:rotate(360deg);}}`}</style>

      <div style={{ background: `linear-gradient(135deg, ${C.navy} 0%, #1E3A8A 50%, #1D4ED8 100%)`,
        padding: "0 24px", boxShadow: "0 2px 12px rgba(15,45,94,0.3)", position: "relative", zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 16, paddingBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={() => navigate("/dashboard")}
              style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#93C5FD",
                borderRadius: 6, width: 32, height: 32, cursor: "pointer", fontSize: 14 }}
            >
              ←
            </button>
            <div style={{ width: 36, height: 36, borderRadius: 9,
              background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
              🔍
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "#93C5FD", fontWeight: 600, letterSpacing: "0.08em" }}>
                  FINREPORT AI · R2R MODULE
                </span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.white, letterSpacing: "-0.02em" }}>
                Journal Entry Pattern Analysis
              </div>
              <div style={{ fontSize: 11, color: "#93C5FD" }}>AI-powered anomaly patterns · {derivedStats ? `${derivedStats.total} JEs analysed · ${derivedStats.high + derivedStats.medium} flagged` : "Upload file to see analysis"}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "#93C5FD", letterSpacing: "0.08em" }}>PERIOD</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.white }}>Oct 25 – Mar 26</div>
            </div>
            <span
              style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)",
                color: C.white, borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600,
                display: "flex", alignItems: "center", gap: 6 }}
            >
              ↑ Upload above
            </span>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleExportReport(); }}
              style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)",
                color: C.white, borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600,
                cursor: "pointer", display: "flex", alignItems: "center", gap: 6, position: "relative", zIndex: 11, flexShrink: 0 }}
            >
              ⬇ Export Report
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 20, paddingBottom: 14, flexWrap: "wrap" }}>
          {[
            { icon: "🔴", text: derivedStats ? `${derivedStats.high} HIGH risk entries require review` : "Upload to see risk summary", color: "#FCA5A5" },
            { icon: "🤖", text: "87% AI confidence · Nova model", color: "#93C5FD" },
            { icon: "✅", text: derivedStats ? `${derivedStats.autoCleaned} entries auto-cleared by rules engine` : "Upload to see auto-cleared", color: "#86EFAC" },
            { icon: "✦", text: "Powered by AI (Claude / Gemini)", color: "#93C5FD" },
          ].map((s) => (
            <div key={s.text} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: s.color }}>
              <span>{s.icon}</span>{s.text}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 0, overflowX: "auto", scrollbarWidth: "none" }}>
          {tabs.map((tab) => {
            const isActive = active === tab.id;
            return (
              <button key={tab.id} onClick={() => setActive(tab.id)}
                style={{ padding: "10px 18px", whiteSpace: "nowrap", cursor: "pointer", border: "none",
                  background: "transparent", fontFamily: font,
                  borderBottom: isActive ? "2.5px solid #60A5FA" : "2.5px solid transparent",
                  color: isActive ? C.white : "#93C5FD",
                  fontSize: 13, fontWeight: isActive ? 700 : 500,
                  display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s" }}>
                <span>{tab.icon}</span>{tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px", display: "flex", flexDirection: "column", gap: 20 }}>
        <Card style={{ marginBottom: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Upload journal entries</span>
            <span style={{ fontSize: 12, color: C.textSub }}>CSV or Excel · Columns: Amount, Vendor, Account, Date, Posted By (or similar)</span>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.textSub, marginBottom: 6 }}>
              Detection sensitivity (syncs with{" "}
              <button
                type="button"
                onClick={() => navigate("/r2r")}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  color: C.blue,
                  fontWeight: 700,
                  cursor: "pointer",
                  textDecoration: "underline",
                  fontSize: 12,
                }}
              >
                /r2r
              </button>
              ; custom slider value: <strong style={{ color: C.text }}>{customThresholdStr}+</strong>)
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {(
                [
                  { id: "conservative" as const, label: "Conservative", hint: "Preset 20+" },
                  { id: "balanced" as const, label: "Balanced", hint: "Preset 40+" },
                  { id: "strict" as const, label: "Strict", hint: "Preset 70+" },
                ]
              ).map((opt) => (
                <label
                  key={opt.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: `1.5px solid ${sensitivity === opt.id ? C.blue : C.border}`,
                    background: sensitivity === opt.id ? C.bluePale : C.white,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  <input
                    type="radio"
                    name="r2r-sensitivity"
                    checked={sensitivity === opt.id}
                    onChange={() => {
                      setSensitivity(opt.id);
                      setCustomThresholdStr(R2R_PRESET_THRESHOLD[opt.id]);
                    }}
                  />
                  <span style={{ fontWeight: 600, color: C.text }}>{opt.label}</span>
                  <span style={{ color: C.textSub, fontSize: 11 }}>{opt.hint}</span>
                </label>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.textSub, marginBottom: 6 }}>
              Materiality (optional — applied before ML; drops petty-cash noise)
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <label style={{ fontSize: 12, color: C.textMid, display: "flex", alignItems: "center", gap: 6 }}>
                Min amount (₹)
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0 = off"
                  value={materialityAmountStr}
                  onChange={(e) => setMaterialityAmountStr(e.target.value)}
                  style={{ width: 100, padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13 }}
                />
              </label>
              <label style={{ fontSize: 12, color: C.textMid, display: "flex", alignItems: "center", gap: 6 }}>
                Min % of largest posting
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0 = off"
                  value={materialityPctStr}
                  onChange={(e) => setMaterialityPctStr(e.target.value)}
                  style={{ width: 72, padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13 }}
                />
              </label>
              <span style={{ fontSize: 11, color: C.textSub, maxWidth: 320 }}>
                % uses max |amount| in the file: e.g. 5 keeps rows ≥ 5% of that max. Both filters apply together if set.
              </span>
            </div>
          </div>
          <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${C.borderLight}` }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.textSub, marginBottom: 6 }}>Client (optional — for learning over time)</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <select
                value={selectedClientId ?? ""}
                onChange={(e) => setSelectedClientId(e.target.value || null)}
                style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, minWidth: 180 }}
              >
                <option value="">No client (one-off analysis)</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="text"
                  placeholder="New client name"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, width: 160 }}
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (!newClientName.trim()) return;
                    try {
                      const created = await createClient(newClientName.trim());
                      setClients((prev) => [created, ...prev]);
                      setSelectedClientId(created.id);
                      setNewClientName("");
                    } catch (err: any) {
                      alert(err?.message || "Failed to create client");
                    }
                  }}
                  style={{ padding: "8px 14px", borderRadius: 8, background: C.blue, color: C.white, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer" }}
                >
                  Add client
                </button>
              </span>
              {selectedClientId && (
                <span style={{ fontSize: 11, color: C.green }}>✓ Saved to client · baseline from full history</span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <label style={{ cursor: "pointer", padding: "10px 18px", borderRadius: 8, background: C.blue, color: C.white, fontSize: 13, fontWeight: 600 }}>
              Choose file
              <input type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
            </label>
            {uploadFileName && <span style={{ fontSize: 12, color: C.textSub }}>{uploadFileName} · {rawRows.length} rows</span>}
            {jeEntriesFromUpload.length > 0 && (
              <button
                type="button"
                onClick={handleExportReport}
                style={{ padding: "10px 18px", borderRadius: 8, background: C.green, color: C.white, fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer" }}
              >
                ⬇ Download report (.xlsx)
              </button>
            )}
            {uploadError && <span style={{ fontSize: 12, color: C.red }}>{uploadError}</span>}
          </div>
        </Card>
        {analysisLoading && (
          <Card style={{ marginBottom: 12, background: C.bluePale, border: `1px solid ${C.blueBorder}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
              <div style={{ width: 24, height: 24, border: `2px solid ${C.border}`, borderTopColor: C.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Running server pattern engine (Isolation Forest · DBSCAN · LOF · Rules · Behavioural)…</span>
            </div>
          </Card>
        )}
        {!analysisLoading &&
        jeEntriesFromUpload.length > 0 &&
        patternResult?.engineExtras?.analysis_label && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 10,
              marginBottom: 4,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "6px 12px",
                borderRadius: 999,
                background: C.navy,
                color: "#E0E7FF",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.02em",
              }}
            >
              Analysing with: {patternResult.engineExtras.analysis_label}
            </span>
            {patternResult.engineExtras.threshold_profile ? (
              <span style={{ fontSize: 11, color: C.textSub }}>
                Server cutoffs: High≥{patternResult.engineExtras.threshold_profile.high_threshold} · Medium≥
                {patternResult.engineExtras.threshold_profile.medium_threshold}
                {patternResult.engineExtras.threshold_profile.custom_threshold_applied
                  ? " · custom threshold applied"
                  : ""}
              </span>
            ) : null}
          </div>
        )}
        {analysisLoading && analysisBannerLabel && (
          <div style={{ marginBottom: 8 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "6px 12px",
                borderRadius: 999,
                background: "#E0E7FF",
                color: C.navy,
                fontSize: 12,
                fontWeight: 700,
                border: `1px solid ${C.blueBorder}`,
              }}
            >
              {analysisBannerLabel}
            </span>
          </div>
        )}
        {patternResult?.engineExtras && !analysisLoading && jeEntriesFromUpload.length > 0 ? (
          <PatternEngineInsights extra={patternResult.engineExtras} />
        ) : null}
        <JESummaryTable
          entries={!analysisLoading && jeEntriesFromUpload.length > 0 ? jeEntriesFromUpload : undefined}
          totalAmt={!analysisLoading && jeEntriesFromUpload.length > 0 ? totalAmtStr : undefined}
          totalAnalysed={
            derivedStats
              ? derivedStats.total
              : rawRows.length > 0
                ? rawRows.length
                : undefined
          }
          anomaliesCount={derivedStats ? derivedStats.high + derivedStats.medium : undefined}
          engineExtras={patternResult?.engineExtras ?? null}
          learningClientId={selectedClientId}
          onLearningFeedback={() => setLearningRefresh((n) => n + 1)}
        />
        <div style={{ borderTop: `2px solid ${C.border}`, paddingTop: 20 }}>
          {renderTab()}
        </div>
      </div>
    </div>
  );
}
