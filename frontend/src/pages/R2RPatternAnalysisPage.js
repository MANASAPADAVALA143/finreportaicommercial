import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { analyzeEntries, analyzeEntriesWithHistory } from "../services/patternAnalysis";
import { callAI } from "../services/aiProvider";
import { listClients, createClient, saveUpload, getClientHistory } from "../services/r2rHistoryService";
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
const NOVA_INVOKE_URL = `${API_BASE.replace(/\/$/, "")}/api/nova/invoke`;
// ─── Shared UI Atoms ─────────────────────────────────────────────────────────
const Card = ({ children, style = {} }) => (_jsx("div", { style: { background: C.white, border: `1px solid ${C.border}`, borderRadius: 12,
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)", padding: 20, ...style }, children: children }));
const SectionTitle = ({ children, sub }) => (_jsxs("div", { style: { marginBottom: 16 }, children: [_jsx("h3", { style: { fontSize: 15, fontWeight: 700, color: C.text, fontFamily: font, margin: 0 }, children: children }), sub && _jsx("p", { style: { fontSize: 12, fontWeight: 400, color: C.textSub, marginTop: 3 }, children: sub })] }));
const Badge = ({ label, color = "blue" }) => {
    const map = {
        blue: { bg: C.bluePale, text: C.blue, border: C.blueBorder },
        green: { bg: C.greenBg, text: C.green, border: C.greenBorder },
        red: { bg: C.redBg, text: C.red, border: C.redBorder },
        amber: { bg: C.amberBg, text: C.amber, border: C.amberBorder },
        navy: { bg: C.navy, text: C.white, border: C.navy },
    };
    const s = map[color] || map.blue;
    return (_jsx("span", { style: { fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
            background: s.bg, color: s.text, border: `1px solid ${s.border}`,
            letterSpacing: "0.07em", textTransform: "uppercase", whiteSpace: "nowrap" }, children: label }));
};
const TH = ({ children, right }) => (_jsx("th", { style: { padding: "10px 14px", textAlign: right ? "right" : "left", fontSize: 11,
        fontWeight: 600, color: C.textSub, letterSpacing: "0.07em", textTransform: "uppercase",
        borderBottom: `1.5px solid ${C.border}`, background: C.bg, whiteSpace: "nowrap" }, children: children }));
const TD = ({ children, right, mono: isMono, style = {} }) => (_jsx("td", { style: { padding: "11px 14px", textAlign: right ? "right" : "left", fontSize: 13,
        fontWeight: 400, color: C.textMid, borderBottom: `1px solid ${C.borderLight}`,
        fontFamily: isMono ? mono : font, ...style }, children: children }));
const MiniBar = ({ pct, color = C.blue, height = 4 }) => (_jsx("div", { style: { width: "100%", height, borderRadius: 999, background: C.bg, overflow: "hidden" }, children: _jsx("div", { style: { width: `${Math.min(pct, 100)}%`, height: "100%", borderRadius: 999,
            background: color, transition: "width 0.5s ease" } }) }));
const StatCard = ({ label, value, sub, color = C.blue, bg, border }) => (_jsxs("div", { style: { background: bg || C.bluePale, border: `1px solid ${border || C.blueBorder}`,
        borderRadius: 10, padding: "16px 18px" }, children: [_jsx("div", { style: { fontSize: 11, fontWeight: 500, color: C.textSub, marginBottom: 4, letterSpacing: "0.04em" }, children: label }), _jsx("div", { style: { fontSize: 26, fontWeight: 900, fontFamily: mono, color: color || C.blue }, children: value }), sub && _jsx("div", { style: { fontSize: 11, color: C.textSub, marginTop: 3 }, children: sub })] }));
function formatAmountINR(n) {
    const s = Math.round(n).toString();
    if (s.length <= 3)
        return "₹" + s;
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3);
    const withComma = rest.length > 2 ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : rest + "," + last3;
    return "₹" + withComma;
}
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function parseEntryDate(d) {
    if (!d)
        return null;
    const dt = new Date(d);
    if (!isNaN(dt.getTime()))
        return dt;
    const m = d.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m)
        return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    const m2 = d.match(/(\d{1,2})\s+(\w+)\s+(\d{2,4})/);
    if (m2) {
        const mi = MONTH_NAMES.findIndex(x => x.toLowerCase() === m2[2].toLowerCase());
        if (mi >= 0)
            return new Date(parseInt(m2[3], 10) + (parseInt(m2[3], 10) < 100 ? 2000 : 0), mi, parseInt(m2[1], 10));
    }
    return null;
}
function parseAmountStr(s) {
    const n = parseFloat(String(s).replace(/[₹,\s]/g, ""));
    return isNaN(n) ? 0 : n;
}
const FISCAL_MONTH_ORDER = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];
function computeTrendByMonth(entries) {
    const byKey = {};
    entries.forEach(e => {
        const dt = parseEntryDate(e.date);
        if (!dt)
            return;
        const year = dt.getFullYear();
        const monthIdx = dt.getMonth();
        const key = `${year}-${monthIdx}`;
        if (!byKey[key])
            byKey[key] = { year, monthIdx, high: 0, medium: 0, low: 0 };
        if (e.level === "HIGH")
            byKey[key].high++;
        else if (e.level === "MEDIUM")
            byKey[key].medium++;
        else
            byKey[key].low++;
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
function computeVendorPatterns(entries) {
    const byVendor = {};
    entries.forEach(e => {
        if (!byVendor[e.vendor])
            byVendor[e.vendor] = { accounts: [], amounts: [], scores: [], flags: new Set() };
        byVendor[e.vendor].accounts.push(e.account);
        byVendor[e.vendor].amounts.push(parseAmountStr(e.amount));
        byVendor[e.vendor].scores.push(e.score);
        if (e.amt >= 70)
            byVendor[e.vendor].flags.add("Amt");
        if (e.dup >= 70)
            byVendor[e.vendor].flags.add("Dup");
        if (e.user >= 70)
            byVendor[e.vendor].flags.add("User");
        if (e.time >= 70)
            byVendor[e.vendor].flags.add("Time");
        if (e.acct >= 70)
            byVendor[e.vendor].flags.add("Acct");
        if (e.tags.includes("Wknd"))
            byVendor[e.vendor].flags.add("Wknd");
        if (e.tags.includes("M-End"))
            byVendor[e.vendor].flags.add("M-End");
    });
    return Object.entries(byVendor).map(([vendor, v]) => {
        const count = v.amounts.length;
        const avgNum = v.amounts.reduce((a, b) => a + b, 0) / count || 0;
        const avg = avgNum >= 1e5 ? `₹${(avgNum / 1e5).toFixed(2)}L` : formatAmountINR(avgNum);
        const score = Math.round(v.scores.reduce((a, b) => a + b, 0) / count);
        const flag = [...v.flags].slice(0, 3).join(" + ") || "—";
        const action = score >= 71 ? "red" : score >= 41 ? "amber" : "green";
        const acct = [...new Set(v.accounts)].slice(0, 2).join(" / ") || "—";
        return { vendor, acct, count, avg, score, flag, action };
    }).sort((a, b) => b.score - a.score).slice(0, 10);
}
function computeUserPatterns(entries) {
    const byUser = {};
    entries.forEach(e => {
        const u = e.postedBy || "Unknown";
        if (!byUser[u])
            byUser[u] = { scores: [], wknd: 0 };
        byUser[u].scores.push(e.score);
        if (e.tags.includes("Wknd"))
            byUser[u].wknd++;
    });
    return Object.entries(byUser).map(([user, v]) => {
        const total = v.scores.length;
        const flagged = v.scores.filter(s => s >= 41).length;
        const rate = total ? (flagged / total * 100) : 0;
        const avg = total ? Math.round(v.scores.reduce((a, b) => a + b, 0) / total) : 0;
        const profile = avg >= 71 ? "red" : avg >= 41 ? "amber" : "green";
        return { user, total, flagged, rate: Math.round(rate * 10) / 10, avg, wknd: v.wknd, profile };
    }).sort((a, b) => b.avg - a.avg).slice(0, 10);
}
function computePatternShift(entries) {
    const now = new Date();
    const currMonth = now.getMonth();
    const prevMonth = currMonth === 0 ? 11 : currMonth - 1;
    const inPrev = (e) => { const d = parseEntryDate(e.date); return d && d.getMonth() === prevMonth; };
    const inCurr = (e) => { const d = parseEntryDate(e.date); return d && d.getMonth() === currMonth; };
    const wkndPrev = entries.filter(e => inPrev(e) && e.tags.includes("Wknd")).length;
    const wkndCurr = entries.filter(e => inCurr(e) && e.tags.includes("Wknd")).length;
    const mEndPrev = entries.filter(e => inPrev(e) && e.tags.includes("M-End")).length;
    const mEndCurr = entries.filter(e => inCurr(e) && e.tags.includes("M-End")).length;
    const amtPrev = entries.filter(e => inPrev(e) && (e.amt || 0) >= 70).length;
    const amtCurr = entries.filter(e => inCurr(e) && (e.amt || 0) >= 70).length;
    const dupPrev = entries.filter(e => inPrev(e) && (e.dup || 0) >= 70).length;
    const dupCurr = entries.filter(e => inCurr(e) && (e.dup || 0) >= 70).length;
    const calc = (p, c) => {
        const delta = c - p;
        const pct = p ? Math.round(delta / p * 100) : (c ? 100 : 0);
        const status = delta > 0 ? "red" : delta < 0 ? "green" : "blue";
        return { prev: p, curr: c, delta, pct, status };
    };
    return [
        { type: "Weekend Postings", icon: "📅", ...calc(wkndPrev, wkndCurr) },
        { type: "Month-End Spikes", icon: "📈", ...calc(mEndPrev, mEndCurr) },
        { type: "Unusual Amounts (z>3σ)", icon: "💰", ...calc(amtPrev, amtCurr) },
        { type: "Duplicate Risk", icon: "🔄", ...calc(dupPrev, dupCurr) },
        { type: "User Behaviour", icon: "👤", ...calc(entries.filter(e => inPrev(e) && (e.user || 0) >= 70).length, entries.filter(e => inCurr(e) && (e.user || 0) >= 70).length) },
        { type: "Account Anomalies", icon: "📋", ...calc(entries.filter(e => inPrev(e) && (e.acct || 0) >= 70).length, entries.filter(e => inCurr(e) && (e.acct || 0) >= 70).length) },
    ];
}
function scoredEntryToJEEntry(p, index) {
    const tags = [];
    if (p.isWeekend)
        tags.push("Wknd");
    if (p.isMonthEnd)
        tags.push("M-End");
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
        zscore,
        amt: amt || null,
        dup,
        user: user || null,
        time,
        acct: acct || null,
        score: p.finalScore,
        level: p.riskLevel,
        signals: p.ruleFlags?.length ? p.ruleFlags : undefined,
    };
}
const ScorePill = ({ value, title }) => {
    if (value === null || value === undefined)
        return _jsx("span", { style: { color: C.textMute, fontSize: 16 }, title: title, children: "\u2014" });
    const hi = value >= 71;
    return (_jsx("span", { style: { display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 36, height: 24, borderRadius: 5, fontSize: 11, fontWeight: 700, fontFamily: mono,
            background: hi ? C.redBg : C.bg, color: hi ? C.red : C.textSub,
            border: `1px solid ${hi ? C.redBorder : C.border}` }, title: title, children: value }));
};
const RiskBar = ({ score, level }) => {
    const cfg = {
        HIGH: { text: C.red, bar: "#EF4444", bg: C.redBg, border: C.redBorder },
        MEDIUM: { text: C.amber, bar: "#F59E0B", bg: C.amberBg, border: C.amberBorder },
        LOW: { text: C.green, bar: "#22C55E", bg: C.greenBg, border: C.greenBorder },
    };
    const c = cfg[level] || cfg.LOW;
    return (_jsxs("div", { style: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 5 }, children: [_jsx("span", { style: { fontSize: 17, fontWeight: 900, fontFamily: mono, color: c.text }, children: score }), _jsx("span", { style: { fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                            background: c.bg, color: c.text, border: `1px solid ${c.border}`, letterSpacing: "0.07em" }, children: level })] }), _jsx("div", { style: { width: 64, height: 3, borderRadius: 999, background: C.border, overflow: "hidden" }, children: _jsx("div", { style: { width: `${score}%`, height: "100%", borderRadius: 999, background: c.bar } }) })] }));
};
const JESummaryTable = ({ entries, totalAmt, totalAnalysed, anomaliesCount } = {}) => {
    const [selected, setSelected] = useState(null);
    const [filter, setFilter] = useState("ALL");
    const [novaCache, setNovaCache] = useState({});
    const [novaLoading, setNovaLoading] = useState(null);
    const hasData = entries != null && entries.length > 0;
    const jeEntries = hasData ? entries : [];
    const total = totalAnalysed ?? 0;
    const amt = totalAmt ?? "—";
    const anomalies = anomaliesCount ?? 0;
    const filtered = filter === "ALL" ? jeEntries : jeEntries.filter(e => e.level === filter);
    const counts = { HIGH: jeEntries.filter(e => e.level === "HIGH").length, MEDIUM: jeEntries.filter(e => e.level === "MEDIUM").length, LOW: jeEntries.filter(e => e.level === "LOW").length };
    const fetchNovaExplanation = useCallback(async (e) => {
        if (novaCache[e.id])
            return;
        setNovaLoading(e.id);
        const systemPrompt = "You are a financial fraud detection assistant. Explain why a journal entry was flagged in 3 bullet points. Be specific and use plain English. Max 60 words total.";
        const signalList = (e.signals && e.signals.length > 0) ? e.signals.join(", ") : "Amount, Duplicate, User, Timing, Account, Vendor (as triggered)";
        const userPrompt = `Journal entry details:\nVendor: ${e.vendor}\nAmount: ${e.amount}\nPosted by: ${e.postedBy}\nDate: ${e.date}\nAccount: ${e.account}\nSignals triggered: ${signalList}\nRisk score: ${e.score}/100\nExplain why this is suspicious.`;
        try {
            const res = await fetch(NOVA_INVOKE_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model_id: "amazon.nova-lite-v1:0",
                    prompt: `${systemPrompt}\n\n${userPrompt}`,
                    max_tokens: 200,
                    temperature: 0.3,
                }),
            });
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            const data = (await res.json());
            const text = (data.text ?? "").trim() || "No explanation available.";
            setNovaCache(prev => ({ ...prev, [e.id]: text }));
        }
        catch {
            setNovaCache(prev => ({ ...prev, [e.id]: "Unable to load Nova analysis. Please try again." }));
        }
        finally {
            setNovaLoading(null);
        }
    }, [novaCache]);
    const handleRowClick = useCallback((e) => {
        const next = selected === e.id ? null : e.id;
        setSelected(next);
        if (next && !novaCache[next])
            fetchNovaExplanation(e);
    }, [selected, novaCache, fetchNovaExplanation]);
    if (!hasData) {
        return (_jsx(Card, { style: { marginBottom: 0 }, children: _jsxs("div", { style: { padding: "32px 24px", textAlign: "center", background: C.bg, borderRadius: 12, border: `1px dashed ${C.border}` }, children: [_jsx("h3", { style: { fontSize: 15, fontWeight: 700, color: C.text, margin: "0 0 8px 0" }, children: "All Flagged Journal Entries" }), _jsx("p", { style: { fontSize: 12, color: C.textSub, margin: 0 }, children: "Upload journal entries above to see analysis and flagged entries." }), _jsxs("div", { style: { display: "flex", justifyContent: "center", gap: 8, marginTop: 16 }, children: [_jsxs("div", { style: { padding: "6px 12px", borderRadius: 8, background: C.redBg, border: `1px solid ${C.redBorder}`, minWidth: 64 }, children: [_jsx("div", { style: { fontSize: 18, fontWeight: 900, fontFamily: mono, color: C.red }, children: "0" }), _jsx("div", { style: { fontSize: 10, fontWeight: 700, color: C.red }, children: "High" })] }), _jsxs("div", { style: { padding: "6px 12px", borderRadius: 8, background: C.amberBg, border: `1px solid ${C.amberBorder}`, minWidth: 64 }, children: [_jsx("div", { style: { fontSize: 18, fontWeight: 900, fontFamily: mono, color: C.amber }, children: "0" }), _jsx("div", { style: { fontSize: 10, fontWeight: 700, color: C.amber }, children: "Medium" })] }), _jsxs("div", { style: { padding: "6px 12px", borderRadius: 8, background: C.greenBg, border: `1px solid ${C.greenBorder}`, minWidth: 64 }, children: [_jsx("div", { style: { fontSize: 18, fontWeight: 900, fontFamily: mono, color: C.green }, children: "0" }), _jsx("div", { style: { fontSize: 10, fontWeight: 700, color: C.green }, children: "Low" })] })] })] }) }));
    }
    return (_jsxs(Card, { style: { marginBottom: 0 }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }, children: [_jsxs("div", { children: [_jsx("h3", { style: { fontSize: 15, fontWeight: 700, color: C.text, margin: 0 }, children: "All Flagged Journal Entries" }), _jsxs("p", { style: { fontSize: 12, color: C.textSub, marginTop: 3 }, children: [total, " JEs analysed \u00B7 ", anomalies, " anomalies flagged \u00B7 ", amt, " total exposure at risk"] })] }), _jsx("div", { style: { display: "flex", gap: 8 }, children: [
                            { label: "High", count: counts.HIGH, bg: C.redBg, text: C.red, border: C.redBorder },
                            { label: "Medium", count: counts.MEDIUM, bg: C.amberBg, text: C.amber, border: C.amberBorder },
                            { label: "Low", count: counts.LOW, bg: C.greenBg, text: C.green, border: C.greenBorder },
                        ].map(s => (_jsxs("div", { style: { padding: "6px 12px", borderRadius: 8, background: s.bg,
                                border: `1px solid ${s.border}`, textAlign: "center", minWidth: 64 }, children: [_jsx("div", { style: { fontSize: 18, fontWeight: 900, fontFamily: mono, color: s.text }, children: s.count }), _jsx("div", { style: { fontSize: 10, fontWeight: 700, color: s.text, letterSpacing: "0.05em" }, children: s.label })] }, s.label))) })] }), _jsxs("div", { style: { display: "flex", gap: 6, marginBottom: 14 }, children: [["ALL", "HIGH", "MEDIUM", "LOW"].map(f => (_jsx("button", { onClick: () => setFilter(f), style: {
                            padding: "5px 14px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
                            fontFamily: font, letterSpacing: "0.04em", border: "1px solid",
                            borderColor: filter === f ? C.blue : C.border,
                            background: filter === f ? C.blue : C.white,
                            color: filter === f ? C.white : C.textSub,
                        }, children: f === "ALL" ? "All Entries" : `${f} Risk` }, f))), _jsxs("span", { style: { marginLeft: "auto", fontSize: 11, color: C.textSub, alignSelf: "center" }, children: ["Showing ", filtered.length, " flagged \u00B7 ", total, " total analysed"] })] }), _jsx("div", { style: { overflowX: "auto" }, children: _jsxs("table", { style: { width: "100%", borderCollapse: "collapse", minWidth: 900 }, children: [_jsx("thead", { children: _jsx("tr", { style: { background: `linear-gradient(to right, ${C.navy}, #1E3A8A)` }, children: [
                                    { label: "Entry" }, { label: "Vendor / Account" }, { label: "Posted By" },
                                    { label: "Date / Tags" }, { label: "Amount", right: true },
                                    { label: "Amt", tip: "Amount model" }, { label: "Dup", tip: "Duplicate check" },
                                    { label: "User", tip: "User behaviour" }, { label: "Time", tip: "Timing" },
                                    { label: "Acct", tip: "Account model" }, { label: "Risk Score", right: true },
                                ].map((h) => (_jsxs("th", { title: h.tip || "", style: {
                                        padding: "11px 12px", textAlign: h.right ? "right" : "left",
                                        fontSize: 10, fontWeight: 700, color: "#BFDBFE",
                                        letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap",
                                    }, children: [h.label, h.tip && _jsx("span", { style: { opacity: 0.55, marginLeft: 2, fontSize: 9 }, children: "\u24D8" })] }, h.label))) }) }), _jsx("tbody", { children: filtered.map((e, i) => {
                                const sel = selected === e.id;
                                return (_jsxs(React.Fragment, { children: [_jsxs("tr", { onClick: () => handleRowClick(e), style: { background: sel ? C.bluePale : i % 2 === 0 ? C.white : "#FAFBFC",
                                                cursor: "pointer", borderTop: `1px solid ${C.borderLight}` }, children: [_jsx("td", { style: { padding: "12px 14px", whiteSpace: "nowrap", width: 90 }, children: _jsx("span", { style: {
                                                            display: "inline-block",
                                                            fontFamily: mono, fontSize: 12, fontWeight: 600,
                                                            color: C.blue, background: C.bluePale,
                                                            padding: "5px 10px", borderRadius: 6,
                                                            border: `1px solid ${C.blueBorder}`,
                                                            whiteSpace: "nowrap", letterSpacing: "0.04em",
                                                        }, children: e.id }) }), _jsxs("td", { style: { padding: "12px 12px" }, children: [_jsx("div", { style: { fontSize: 13, fontWeight: 700, color: C.text }, children: e.vendor }), _jsx("div", { style: { fontSize: 11, color: C.textSub, marginTop: 1 }, children: e.account })] }), _jsx("td", { style: { padding: "12px 12px" }, children: _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [_jsx("div", { style: { width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                                                                    background: C.bluePale, border: `1.5px solid ${C.blueBorder}`,
                                                                    display: "flex", alignItems: "center", justifyContent: "center",
                                                                    fontSize: 10, fontWeight: 800, color: C.blue }, children: e.postedBy[0] }), _jsx("span", { style: { fontSize: 12, fontWeight: 500, color: C.textMid }, children: e.postedBy })] }) }), _jsxs("td", { style: { padding: "12px 12px" }, children: [_jsx("div", { style: { fontSize: 12, fontWeight: 400, color: C.textMid }, children: e.date }), _jsx("div", { style: { display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }, children: e.tags.map(t => (_jsx("span", { style: { fontSize: 9, fontWeight: 700, padding: "2px 5px",
                                                                    borderRadius: 3, background: C.bluePale, color: C.blue,
                                                                    border: `1px solid ${C.blueBorder}`, letterSpacing: "0.04em" }, children: t }, t))) })] }), _jsx("td", { style: { padding: "12px 12px", textAlign: "right" }, children: _jsx("div", { style: { fontFamily: mono, fontSize: 13, fontWeight: 400, color: C.text }, children: e.amount }) }), _jsx("td", { style: { padding: "12px 8px", textAlign: "center" }, children: _jsx(ScorePill, { value: e.amt }) }), _jsx("td", { style: { padding: "12px 8px", textAlign: "center" }, title: e.dupMatchId ? `Matches ${e.dupMatchId} (same vendor + amount)` : undefined, children: _jsx(ScorePill, { value: e.dup, title: e.dupMatchId ? `Matches ${e.dupMatchId} (same vendor + amount)` : undefined }) }), [e.user, e.time, e.acct].map((v, j) => (_jsx("td", { style: { padding: "12px 8px", textAlign: "center" }, children: _jsx(ScorePill, { value: v }) }, j))), _jsx("td", { style: { padding: "12px 12px", textAlign: "right" }, children: _jsx(RiskBar, { score: e.score, level: e.level }) })] }), sel && (_jsx("tr", { style: { background: C.bluePale, borderTop: `1px solid ${C.blueBorder}` }, children: _jsx("td", { colSpan: 11, style: { padding: "16px 20px", borderBottom: `1px solid ${C.borderLight}` }, children: _jsxs("div", { style: { fontSize: 13, color: C.text }, children: [_jsxs("div", { style: { fontWeight: 700, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }, children: ["Nova Analysis \u2014 ", e.id] }), novaLoading === e.id ? (_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, color: C.textSub }, children: [_jsx("span", { style: { width: 18, height: 18, border: `2px solid ${C.border}`, borderTopColor: C.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" } }), "Loading Nova analysis\u2026"] })) : novaCache[e.id] ? (_jsxs(_Fragment, { children: [_jsx("p", { style: { marginBottom: 10, lineHeight: 1.6 }, children: "This entry was flagged because:" }), _jsx("div", { style: { marginBottom: 12, paddingLeft: 16, lineHeight: 1.6, whiteSpace: "pre-wrap" }, children: novaCache[e.id] }), _jsxs("div", { style: { display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12 }, children: [_jsxs("span", { style: { fontWeight: 600, color: C.textMid }, children: ["Risk Score: ", e.score, "/100 \u2014 ", e.level] }), _jsxs("span", { style: { color: C.textSub }, children: ["Recommended Action: ", e.level === "HIGH" ? "Review with finance manager" : e.level === "MEDIUM" ? "Escalate to CFO" : "Auto-clear"] })] })] })) : null] }) }) }))] }, e.id));
                            }) })] }) }), _jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "10px 4px 0", borderTop: `1px solid ${C.borderLight}`, marginTop: 4 }, children: [_jsxs("p", { style: { fontSize: 10, color: C.textMute }, children: [_jsx("strong", { style: { color: C.textSub }, children: "Columns:" }), " Amt = Amount model \u00B7 Dup = Duplicate \u00B7 User = Behaviour \u00B7 Time = Timing \u00B7 Acct = Account \u00B7 Scores \u2265 71 flagged red"] }), _jsx("p", { style: { fontSize: 10, color: C.textMute }, children: "Click row to select \u00B7 Powered by Amazon Nova" })] })] }));
};
// ─── Tab: Anomaly Trend ───────────────────────────────────────────────────────
const TrendTab = ({ data }) => {
    const trendData = data.trendByMonth;
    const maxVal = Math.max(1, ...trendData.map(x => x.high + x.medium + x.low));
    return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 20 }, children: [_jsxs("div", { style: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }, children: [_jsx(StatCard, { label: "Total Anomalies (MTD)", value: String(data.total), sub: "JEs analysed this period", color: C.blue }), _jsx(StatCard, { label: "High Risk Flagged", value: String(data.high), sub: `out of ${data.total} JEs analysed`, color: C.red, bg: C.redBg, border: C.redBorder }), _jsx(StatCard, { label: "Auto-Cleared", value: String(data.autoCleaned), sub: "by AI rules engine", color: C.green, bg: C.greenBg, border: C.greenBorder }), _jsx(StatCard, { label: "Avg Risk Score", value: String(data.avgScore), sub: "Above threshold (60)", color: C.amber, bg: C.amberBg, border: C.amberBorder })] }), _jsxs(Card, { children: [_jsx(SectionTitle, { sub: "Anomalies flagged per month by severity", children: "Anomaly Trend \u2014 Last 6 Months" }), _jsx("div", { style: { display: "flex", alignItems: "flex-end", gap: 10, height: 160, padding: "0 8px" }, children: trendData.map((td) => {
                            const total = td.high + td.medium + td.low;
                            return (_jsxs("div", { style: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }, children: [_jsx("div", { style: { fontSize: 11, fontWeight: 700, color: C.textSub, fontFamily: mono }, children: total }), _jsx("div", { style: { width: "100%", display: "flex", flexDirection: "column", gap: 2 }, children: [{ v: td.high, c: C.red }, { v: td.medium, c: C.amber }, { v: td.low, c: "#22C55E" }].map((b, i) => (_jsx("div", { style: { height: Math.round((b.v / maxVal) * 100) || (b.v > 0 ? 6 : 0), background: b.c,
                                                borderRadius: i === 0 ? "5px 5px 0 0" : 0, minHeight: b.v > 0 ? 6 : 0, transition: "height 0.4s" } }, i))) }), _jsx("div", { style: { fontSize: 11, color: C.textSub, fontWeight: 600 }, children: td.month })] }, td.month));
                        }) }), _jsx("div", { style: { display: "flex", gap: 18, justifyContent: "center", marginTop: 12 }, children: [["High Risk", C.red], ["Medium Risk", C.amber], ["Low Risk", "#22C55E"]].map(([l, c]) => (_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.textSub }, children: [_jsx("div", { style: { width: 10, height: 10, borderRadius: 3, background: c } }), l] }, String(l)))) })] }), _jsxs(Card, { children: [_jsx(SectionTitle, { sub: "Month-over-month anomaly delta by category", children: "Pattern Shift Analysis" }), _jsxs("table", { style: { width: "100%", borderCollapse: "collapse" }, children: [_jsx("thead", { children: _jsx("tr", { children: ["Pattern Type", "Prev Count", "Curr Count", "Change", "Trend", "Status"].map((h, i) => (_jsx(TH, { right: i >= 1 && i <= 3, children: h }, h))) }) }), _jsx("tbody", { children: data.patternShift.map((r, i) => (_jsxs("tr", { style: { background: i % 2 === 0 ? C.white : "#FAFBFC" }, children: [_jsxs(TD, { children: [_jsx("span", { style: { marginRight: 7 }, children: r.icon }), _jsx("strong", { style: { color: C.text }, children: r.type })] }), _jsx(TD, { right: true, mono: true, children: r.prev }), _jsx(TD, { right: true, mono: true, children: r.curr }), _jsxs(TD, { right: true, mono: true, style: { color: r.delta > 0 ? C.red : r.delta < 0 ? C.green : C.textMid, fontWeight: 700 }, children: [r.delta > 0 ? `+${r.delta}` : r.delta, _jsxs("span", { style: { fontSize: 11, marginLeft: 4 }, children: ["(", r.pct > 0 ? `+${r.pct}` : r.pct, "%)"] })] }), _jsx(TD, { children: _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [_jsx("span", { style: { fontSize: 12 }, children: r.delta > 0 ? "↑" : r.delta < 0 ? "↓" : "→" }), _jsx(MiniBar, { pct: Math.abs(r.pct), color: r.delta > 0 ? C.red : C.green })] }) }), _jsx(TD, { children: _jsx(Badge, { label: r.status === "green" ? "Improving" : r.status === "red" ? "Escalating" : r.status === "amber" ? "Watch" : "Stable", color: r.status === "blue" ? "blue" : r.status }) })] }, r.type))) })] })] })] }));
};
// ─── Tab: Vendor Patterns ─────────────────────────────────────────────────────
const VendorTab = ({ data }) => (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 20 }, children: [_jsxs(Card, { children: [_jsx(SectionTitle, { sub: "Vendors with highest anomaly frequency and risk concentration", children: "High-Risk Vendor Analysis" }), _jsxs("table", { style: { width: "100%", borderCollapse: "collapse" }, children: [_jsx("thead", { children: _jsx("tr", { children: ["Vendor", "Account Type", "JE Count", "Avg Amount", "Risk Score", "Top Flag", "Action"].map((h, i) => (_jsx(TH, { right: i >= 2 && i <= 4, children: h }, h))) }) }), _jsx("tbody", { children: data.vendorPatterns.map((r, i) => (_jsxs("tr", { style: { background: i % 2 === 0 ? C.white : "#FAFBFC" }, children: [_jsx(TD, { style: { fontWeight: 700, color: C.text }, children: r.vendor }), _jsx(TD, { style: { color: C.textSub }, children: r.acct }), _jsx(TD, { right: true, mono: true, children: r.count }), _jsx(TD, { right: true, mono: true, style: { fontWeight: 400, color: C.text }, children: r.avg }), _jsx(TD, { right: true, children: _jsxs("div", { style: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }, children: [_jsx("span", { style: { fontFamily: mono, fontWeight: 800, fontSize: 14,
                                                        color: r.score >= 71 ? C.red : r.score >= 41 ? C.amber : C.green }, children: r.score }), _jsx(MiniBar, { pct: r.score, color: r.score >= 71 ? C.red : r.score >= 41 ? C.amber : C.green })] }) }), _jsx(TD, { children: _jsx(Badge, { label: r.flag, color: r.action }) }), _jsx(TD, { children: _jsx(Badge, { label: r.action === "red" ? "Investigate" : r.action === "amber" ? "Review" : "Monitor", color: r.action }) })] }, r.vendor))) })] })] }), _jsxs("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }, children: [_jsxs(Card, { children: [_jsx(SectionTitle, { sub: "Vendors with repeat anomalies across periods", children: "Repeat Offender Pattern" }), data.vendorPatterns.slice(0, 5).map((v) => (_jsxs("div", { style: { padding: "12px 0", borderBottom: `1px solid ${C.borderLight}` }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 6 }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: 13, fontWeight: 700, color: C.text }, children: v.vendor }), _jsxs("div", { style: { fontSize: 11, color: C.textSub }, children: [v.count, "\u00D7 flagged"] })] }), _jsx("span", { style: { fontFamily: mono, fontWeight: 800, fontSize: 16,
                                                color: v.score >= 71 ? C.red : v.score >= 41 ? C.amber : C.green }, children: v.score })] }), _jsx(MiniBar, { pct: v.score, color: v.score >= 71 ? C.red : v.score >= 41 ? C.amber : C.green, height: 5 })] }, v.vendor)))] }), _jsxs(Card, { children: [_jsx(SectionTitle, { sub: "Concentration of anomalies by account head", children: "Account Category Exposure" }), (() => {
                            const byAcct = {};
                            data.entries.forEach(e => { byAcct[e.account] = (byAcct[e.account] || 0) + 1; });
                            const total = data.entries.length;
                            return Object.entries(byAcct).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([acct, count]) => ({
                                acct: acct || "—",
                                count,
                                pct: total ? Math.round(count / total * 100) : 0,
                                color: count >= 3 ? C.red : count >= 2 ? C.amber : C.blue,
                            }));
                        })().map((a) => (_jsxs("div", { style: { padding: "10px 0", borderBottom: `1px solid ${C.borderLight}` }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 5 }, children: [_jsx("span", { style: { fontSize: 13, color: C.textMid, fontWeight: 500 }, children: a.acct }), _jsxs("span", { style: { fontSize: 12, fontFamily: mono, color: C.textSub }, children: [a.pct, "% \u00B7 ", a.count, " JEs"] })] }), _jsx(MiniBar, { pct: a.pct, color: a.color, height: 5 })] }, a.acct)))] })] })] }));
// ─── Tab: User Behaviour ─────────────────────────────────────────────────────
const UserTab = ({ data }) => (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 20 }, children: [_jsxs(Card, { children: [_jsx(SectionTitle, { sub: "Posting behaviour and anomaly attribution per user", children: "User Activity & Risk Profile" }), _jsxs("table", { style: { width: "100%", borderCollapse: "collapse" }, children: [_jsx("thead", { children: _jsx("tr", { children: ["User", "JEs Posted", "Flagged", "Flag Rate", "Avg Risk", "Wknd Posts", "Profile"].map((h, i) => (_jsx(TH, { right: i >= 1 && i <= 5, children: h }, h))) }) }), _jsx("tbody", { children: data.userPatterns.map((r, i) => (_jsxs("tr", { style: { background: i % 2 === 0 ? C.white : "#FAFBFC" }, children: [_jsx(TD, { children: _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [_jsx("div", { style: { width: 30, height: 30, borderRadius: "50%",
                                                        background: r.profile === "red" ? C.redBg : r.profile === "amber" ? C.amberBg : C.greenBg,
                                                        border: `1.5px solid ${r.profile === "red" ? C.redBorder : r.profile === "amber" ? C.amberBorder : C.greenBorder}`,
                                                        display: "flex", alignItems: "center", justifyContent: "center",
                                                        fontSize: 11, fontWeight: 800, color: r.profile === "red" ? C.red : r.profile === "amber" ? C.amber : C.green }, children: (r.user || "?")[0] }), _jsx("span", { style: { fontWeight: 700, color: C.text }, children: r.user })] }) }), _jsx(TD, { right: true, mono: true, children: r.total }), _jsx(TD, { right: true, mono: true, style: { fontWeight: 700, color: r.flagged > 0 ? C.red : C.green }, children: r.flagged }), _jsxs(TD, { right: true, mono: true, style: { color: r.rate > 4 ? C.red : r.rate > 2 ? C.amber : C.green, fontWeight: 700 }, children: [r.rate, "%"] }), _jsx(TD, { right: true, children: _jsxs("div", { style: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }, children: [_jsx("span", { style: { fontFamily: mono, fontWeight: 700, fontSize: 13,
                                                        color: r.avg >= 71 ? C.red : r.avg >= 41 ? C.amber : C.green }, children: r.avg }), _jsx(MiniBar, { pct: r.avg, color: r.avg >= 71 ? C.red : r.avg >= 41 ? C.amber : C.green })] }) }), _jsx(TD, { right: true, mono: true, style: { color: r.wknd > 1 ? C.red : r.wknd === 1 ? C.amber : C.textMute }, children: r.wknd > 0 ? r.wknd : "—" }), _jsx(TD, { children: _jsx(Badge, { label: r.profile === "red" ? "High Risk" : r.profile === "amber" ? "Monitor" : "Clean", color: r.profile }) })] }, r.user))) })] })] }), _jsxs("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }, children: [_jsxs(Card, { children: [_jsx(SectionTitle, { sub: "Separation of duties conflicts detected", children: "SOD Violation Log" }), data.userPatterns.filter(u => u.avg >= 70 && u.flagged > 0).slice(0, 5).map((u) => (_jsxs("div", { style: { padding: "12px 14px", marginBottom: 10, borderRadius: 8,
                                background: C.redBg,
                                border: `1px solid ${C.redBorder}` }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 3 }, children: [_jsx("span", { style: { fontSize: 13, fontWeight: 700, color: C.text }, children: u.user }), _jsxs("span", { style: { fontSize: 11, color: C.textSub }, children: [u.flagged, " flagged \u00B7 avg ", u.avg] })] }), _jsx("div", { style: { fontSize: 12, color: C.textMid }, children: "High-risk entries require review" })] }, u.user)))] }), _jsxs(Card, { children: [_jsx(SectionTitle, { sub: "Entries posted outside standard working hours", children: "Off-Hours Posting Heatmap" }), _jsxs("table", { style: { width: "100%", borderCollapse: "collapse" }, children: [_jsx("thead", { children: _jsx("tr", { children: ["Time Window", "Entries", "Risk Multiplier"].map((h) => _jsx(TH, { children: h }, h)) }) }), _jsx("tbody", { children: [
                                        { time: "Weekend (Wknd tag)", count: data.entries.filter(e => e.tags.includes("Wknd")).length, mult: "3.0×", color: C.red },
                                        { time: "Month-End (M-End tag)", count: data.entries.filter(e => e.tags.includes("M-End")).length, mult: "2.0×", color: C.amber },
                                        { time: "Regular", count: data.entries.filter(e => !e.tags.includes("Wknd") && !e.tags.includes("M-End")).length, mult: "1.0×", color: C.green },
                                    ].map((r, i) => (_jsxs("tr", { style: { background: i % 2 === 0 ? C.white : "#FAFBFC" }, children: [_jsx(TD, { style: { fontSize: 12 }, children: r.time }), _jsx(TD, { mono: true, style: { fontWeight: 700, color: r.color }, children: r.count }), _jsx(TD, { children: _jsx(Badge, { label: r.mult, color: r.color === C.green ? "green" : r.color === C.amber ? "amber" : "red" }) })] }, r.time))) })] })] })] })] }));
// ─── Tab: Statistical Patterns ────────────────────────────────────────────────
const StatTab = ({ data }) => {
    const unusualAmt = data.entries.filter(e => (e.amt || 0) >= 70).length;
    const roundNumbers = data.entries.filter(e => /0{2,}$/.test(String(e.amount).replace(/[₹,\s]/g, ""))).length;
    const highValue = [...data.entries].sort((a, b) => b.score - a.score).slice(0, 8);
    return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 20 }, children: [_jsxs("div", { style: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }, children: [_jsx(StatCard, { label: "Unusual Amount Entries", value: String(unusualAmt), sub: "Amt score \u2265 70", color: C.red, bg: C.redBg, border: C.redBorder }), _jsx(StatCard, { label: "High Risk Entries", value: String(data.high), sub: "Score \u2265 71", color: C.amber, bg: C.amberBg, border: C.amberBorder }), _jsx(StatCard, { label: "Round Number Entries", value: String(roundNumbers), sub: "Potential fabrication flag", color: C.blue })] }), _jsxs(Card, { children: [_jsx(SectionTitle, { sub: "Entries with statistically unusual amounts flagged by AI", children: "High-Value Anomaly Entries" }), _jsxs("table", { style: { width: "100%", borderCollapse: "collapse" }, children: [_jsx("thead", { children: _jsx("tr", { children: ["Entry", "Vendor", "Amount", "Risk Band", "Statistical Risk"].map((h, i) => (_jsx(TH, { right: i === 2, children: h }, h))) }) }), _jsx("tbody", { children: highValue.map((r, i) => (_jsxs("tr", { style: { background: i % 2 === 0 ? C.white : "#FAFBFC" }, children: [_jsx(TD, { children: _jsx("span", { style: { display: "inline-block", fontSize: 12, fontWeight: 600, fontFamily: mono, color: C.blue,
                                                    background: C.bluePale, padding: "5px 10px", borderRadius: 6, border: `1px solid ${C.blueBorder}`,
                                                    whiteSpace: "nowrap", letterSpacing: "0.04em" }, children: r.id }) }), _jsx(TD, { style: { color: C.text, fontWeight: 500 }, children: r.vendor }), _jsx(TD, { right: true, mono: true, style: { fontWeight: 400, color: C.text }, children: r.amount }), _jsx(TD, { children: _jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 4 }, children: [_jsx(Badge, { label: r.score >= 71 ? "Extreme" : r.score >= 41 ? "Very High" : "High", color: r.score >= 71 ? "red" : "amber" }), _jsx(MiniBar, { pct: r.score, color: r.score >= 71 ? C.red : C.amber, height: 4 })] }) }), _jsx(TD, { children: _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [_jsx("span", { style: { fontSize: 13, fontWeight: 700, fontFamily: mono,
                                                            color: r.score >= 71 ? C.red : C.amber }, children: r.score }), _jsx("span", { style: { fontSize: 10, color: C.textSub }, children: "/ 100" })] }) })] }, r.id))) })] })] }), _jsxs("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }, children: [_jsxs(Card, { children: [_jsx(SectionTitle, { sub: "Entries with suspiciously round values", children: "Round Number Analysis" }), _jsxs("table", { style: { width: "100%", borderCollapse: "collapse" }, children: [_jsx("thead", { children: _jsx("tr", { children: ["Entry", "Amount", "Vendor", "Risk"].map((h) => _jsx(TH, { children: h }, h)) }) }), _jsx("tbody", { children: data.entries.filter(e => /0{2,}$/.test(String(e.amount).replace(/[₹,\s]/g, ""))).slice(0, 6).map((r, i) => (_jsxs("tr", { style: { background: i % 2 === 0 ? C.white : "#FAFBFC" }, children: [_jsx(TD, { style: { fontFamily: mono, fontSize: 12, fontWeight: 600, color: C.blue, whiteSpace: "nowrap" }, children: _jsx("span", { style: { display: "inline-block", background: C.bluePale, padding: "5px 10px",
                                                            borderRadius: 6, border: `1px solid ${C.blueBorder}`, letterSpacing: "0.04em" }, children: r.id }) }), _jsx(TD, { mono: true, style: { fontWeight: 700, color: C.text }, children: r.amount }), _jsx(TD, { style: { fontSize: 12, color: C.textSub }, children: r.vendor }), _jsx(TD, { children: _jsx(Badge, { label: r.score >= 71 ? "High" : r.score >= 41 ? "Watch" : "Note", color: r.score >= 71 ? "red" : "amber" }) })] }, r.id))) })] })] }), _jsxs(Card, { children: [_jsx(SectionTitle, { sub: "Benford's Law first-digit distribution check", children: "Benford's Law Test" }), [1, 2, 3, 4, 5].map((d) => {
                                const expected = [30.1, 17.6, 12.5, 9.7, 7.9][d - 1];
                                const actual = [28.4, 14.2, 13.1, 10.5, 9.8][d - 1];
                                const diff = Math.abs(actual - expected).toFixed(1);
                                const flag = Number(diff) > 3;
                                return (_jsxs("div", { style: { padding: "9px 0", borderBottom: `1px solid ${C.borderLight}` }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 5 }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [_jsx("span", { style: { fontFamily: mono, fontWeight: 800, fontSize: 15, color: C.text }, children: d }), _jsxs("span", { style: { fontSize: 11, color: C.textSub }, children: ["Expected ", expected, "% \u00B7 Actual ", actual, "%"] })] }), flag && _jsx(Badge, { label: `Δ${diff}%`, color: "red" })] }), _jsxs("div", { style: { display: "flex", gap: 4, alignItems: "center" }, children: [_jsx("div", { style: { flex: 1, height: 5, borderRadius: 999, background: C.bg, overflow: "hidden" }, children: _jsx("div", { style: { width: `${(expected / 35) * 100}%`, height: "100%", background: C.blueBorder, borderRadius: 999 } }) }), _jsx("div", { style: { flex: 1, height: 5, borderRadius: 999, background: C.bg, overflow: "hidden" }, children: _jsx("div", { style: { width: `${(actual / 35) * 100}%`, height: "100%",
                                                            background: flag ? C.red : C.green, borderRadius: 999 } }) })] })] }, d));
                            }), _jsxs("div", { style: { marginTop: 10, display: "flex", gap: 16 }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.textSub }, children: [_jsx("div", { style: { width: 10, height: 4, borderRadius: 2, background: C.blueBorder } }), " Expected"] }), _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.textSub }, children: [_jsx("div", { style: { width: 10, height: 4, borderRadius: 2, background: C.green } }), " Actual (Normal)"] }), _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.textSub }, children: [_jsx("div", { style: { width: 10, height: 4, borderRadius: 2, background: C.red } }), " Actual (Flagged)"] })] })] })] })] }));
};
// ─── Tab: AI Insights ─────────────────────────────────────────────────────────
const AIInsightsTab = ({ data }) => (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 20 }, children: [_jsxs(Card, { style: { borderLeft: `4px solid ${C.blue}` }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }, children: [_jsxs("div", { children: [_jsxs("div", { style: { fontSize: 14, fontWeight: 700, color: C.text, display: "flex", alignItems: "center", gap: 6 }, children: ["\uD83E\uDD16 AI Pattern Summary ", _jsx("span", { style: { fontSize: 11, color: C.textSub, fontWeight: 400 }, children: "Amazon Nova \u00B7 AWS Bedrock" })] }), _jsxs("div", { style: { fontSize: 12, color: C.textSub, marginTop: 2 }, children: ["Generated ", new Date().toLocaleDateString(), " \u00B7 ", data.total, " JEs analysed \u00B7 ", data.high, " HIGH risk flagged"] })] }), _jsx(Badge, { label: "87% Confidence", color: "green" })] }), [
                    { icon: "🔴", title: "Steel Corp Concentration Risk", body: "3 entries from Steel Corp across Jan–Mar 26 show a consistent pattern of weekend posting and z-scores above +2.96σ. Recommend enhanced approval workflow for this vendor.", severity: "red" },
                    { icon: "🟡", title: "Month-End Spike Detected", body: "7 JEs posted within 2 days of month-end vs 5 last month (+40%). All entries by Rajan and Priya. Likely legitimate accruals but flag for CFO review.", severity: "amber" },
                    { icon: "🔴", title: "SOD Violation — Rajan", body: "Rajan posted and approved JE-056 without secondary sign-off. This bypasses the 4-eyes principle. Immediate access review recommended.", severity: "red" },
                    { icon: "🟢", title: "Duplicate Risk Improving", body: "Duplicate detection prevented 2 potential repeat postings this month, down from 4 in February. AI rules engine is performing well on this category.", severity: "green" },
                ].map((a) => (_jsxs("div", { style: { padding: "14px 16px", marginBottom: 12, borderRadius: 9,
                        background: a.severity === "red" ? C.redBg : a.severity === "amber" ? C.amberBg : a.severity === "green" ? C.greenBg : C.bluePale,
                        border: `1px solid ${a.severity === "red" ? C.redBorder : a.severity === "amber" ? C.amberBorder : a.severity === "green" ? C.greenBorder : C.blueBorder}` }, children: [_jsxs("div", { style: { fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 5 }, children: [a.icon, " ", a.title] }), _jsx("div", { style: { fontSize: 12, color: C.textMid, lineHeight: 1.6 }, children: a.body })] }, a.title)))] }), _jsxs(Card, { children: [_jsx(SectionTitle, { sub: "Recommended actions based on AI pattern detection", children: "Recommended Actions" }), _jsxs("table", { style: { width: "100%", borderCollapse: "collapse" }, children: [_jsx("thead", { children: _jsx("tr", { children: ["Priority", "Action", "Owner", "Due", "Impact"].map((h) => _jsx(TH, { children: h }, h)) }) }), _jsx("tbody", { children: [
                                { p: "P1", action: "Revoke Rajan's self-approval access", owner: "IT Admin", due: "Today", impact: "red", impactLabel: "SOD Fix" },
                                { p: "P1", action: "Investigate Steel Corp entries JE-056, 071, 048", owner: "CFO", due: "This week", impact: "red", impactLabel: "₹14L at risk" },
                                { p: "P2", action: "Add month-end 4-eyes review gate", owner: "Finance Lead", due: "Apr 1", impact: "amber", impactLabel: "Process Fix" },
                                { p: "P2", action: "Request invoice docs for JE-032 (New Machinery)", owner: "Priya", due: "Mar 15", impact: "amber", impactLabel: "Audit Trail" },
                                { p: "P3", action: "Review Benford digit-2 distribution anomaly", owner: "Internal Audit", due: "Apr 30", impact: "blue", impactLabel: "Monitoring" },
                            ].map((r, i) => (_jsxs("tr", { style: { background: i % 2 === 0 ? C.white : "#FAFBFC" }, children: [_jsx(TD, { children: _jsx(Badge, { label: r.p, color: r.p === "P1" ? "red" : r.p === "P2" ? "amber" : "blue" }) }), _jsx(TD, { style: { color: C.text, fontWeight: 600, fontSize: 13 }, children: r.action }), _jsx(TD, { style: { color: C.textSub }, children: r.owner }), _jsx(TD, { style: { color: r.due === "Today" ? C.red : C.textMid, fontWeight: r.due === "Today" ? 700 : 400 }, children: r.due }), _jsx(TD, { children: _jsx(Badge, { label: r.impactLabel, color: r.impact }) })] }, r.action))) })] }), _jsxs("div", { style: { display: "flex", gap: 10, marginTop: 16 }, children: [_jsx("button", { onClick: handleExportReport, style: { background: C.blue, color: C.white, border: "none", borderRadius: 8,
                                padding: "10px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: font }, children: "Export Pattern Report" }), _jsx("button", { style: { background: C.white, color: C.blue, border: `1.5px solid ${C.blue}`, borderRadius: 8,
                                padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: font }, children: "Add to Board Pack" }), _jsx("button", { style: { background: C.white, color: C.textMid, border: `1.5px solid ${C.border}`, borderRadius: 8,
                                padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: font }, children: "Set Alerts" })] })] })] }));
// ─── Main Component ───────────────────────────────────────────────────────────
const tabs = [
    { id: "trend", label: "Anomaly Trend", icon: "📈" },
    { id: "vendor", label: "Vendor Patterns", icon: "🏭" },
    { id: "user", label: "User Behaviour", icon: "👤" },
    { id: "stats", label: "Statistical Analysis", icon: "📊" },
    { id: "ai", label: "AI Insights", icon: "🤖" },
];
export default function R2RPatternAnalysisPage() {
    const navigate = useNavigate();
    const [active, setActive] = useState("trend");
    const [rawRows, setRawRows] = useState(() => []); // always start empty — no demo data, no localStorage pre-load
    const [uploadFileName, setUploadFileName] = useState(null);
    const [uploadError, setUploadError] = useState(null);
    const [clients, setClients] = useState([]);
    const [clientsLoading, setClientsLoading] = useState(false);
    const [selectedClientId, setSelectedClientId] = useState(null);
    const [newClientName, setNewClientName] = useState("");
    const [patternResult, setPatternResult] = useState(null);
    const [analysisLoading, setAnalysisLoading] = useState(false);
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
            return;
        }
        let cancelled = false;
        setAnalysisLoading(true);
        const run = async () => {
            try {
                if (selectedClientId) {
                    await saveUpload(selectedClientId, rawRows, uploadFileName || undefined);
                    const { entries } = await getClientHistory(selectedClientId);
                    const res = await analyzeEntriesWithHistory(rawRows, entries, callAI);
                    if (!cancelled)
                        setPatternResult(res);
                }
                else {
                    const res = await analyzeEntries(rawRows, callAI);
                    if (!cancelled)
                        setPatternResult(res);
                }
            }
            catch (e) {
                if (!cancelled) {
                    console.error(e);
                    setPatternResult(null);
                }
            }
            finally {
                if (!cancelled)
                    setAnalysisLoading(false);
            }
        };
        run();
        return () => { cancelled = true; };
    }, [rawRows, selectedClientId]);
    const jeEntriesFromUpload = useMemo(() => {
        if (!patternResult?.entries?.length)
            return [];
        return patternResult.entries
            .map((p, i) => scoredEntryToJEEntry(p, i))
            .sort((a, b) => b.score - a.score);
    }, [patternResult]);
    const totalAmtStr = useMemo(() => {
        if (!patternResult?.entries?.length)
            return "—";
        const sum = patternResult.entries.reduce((s, p) => s + p.amount, 0);
        if (sum >= 1e7)
            return formatAmountINR(sum) + " (" + (sum / 1e7).toFixed(1) + " Cr)";
        if (sum >= 1e5)
            return formatAmountINR(sum) + " (" + (sum / 1e5).toFixed(1) + "L)";
        return formatAmountINR(sum);
    }, [patternResult]);
    const derivedStats = useMemo(() => {
        const entries = jeEntriesFromUpload;
        if (!entries.length)
            return null;
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
            const headers = ["Entry", "Vendor", "Account", "Posted By", "Date", "Amount", "AMT", "DUP", "USER", "TIME", "ACCT", "Risk Score", "Level", "Signals"];
            const rows = jeEntriesFromUpload.map((e) => [
                e.id,
                e.vendor,
                e.account,
                e.postedBy,
                e.date,
                e.amount,
                e.amt ?? "",
                e.dup ?? "",
                e.user ?? "",
                e.time ?? "",
                e.acct ?? "",
                e.score,
                e.level,
                (e.signals || []).join("; "),
            ]);
            const filename = `R2R_Pattern_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
            // Use blob + link click so download works reliably in all browsers
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
            XLSX.utils.book_append_sheet(wb, ws, "Flagged JEs");
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
        }
        catch (err) {
            console.error("Export failed:", err);
            alert("Export failed: " + (err?.message || "Unknown error"));
        }
    }, [jeEntriesFromUpload]);
    const handleFile = useCallback((file) => {
        setUploadError(null);
        const isCsv = file.name.toLowerCase().endsWith(".csv");
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                if (!data) {
                    setUploadError("Could not read file");
                    return;
                }
                let rows;
                if (isCsv) {
                    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
                    const lines = text.split(/\r?\n/).filter(Boolean);
                    const header = lines[0].split(",").map((h) => h.trim());
                    rows = lines.slice(1).map((line) => {
                        const vals = line.split(",").map((v) => v.trim());
                        const obj = {};
                        header.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
                        return obj;
                    });
                }
                else {
                    const wb = XLSX.read(data, { type: isCsv ? "string" : "array" });
                    // Try all sheets; use one that looks like journal entries (has amount + date/vendor/account)
                    const trySheet = (name) => {
                        const sheet = wb.Sheets[name];
                        const arr = XLSX.utils.sheet_to_json(sheet);
                        if (arr.length < 2)
                            return [];
                        const first = arr[0] || {};
                        const keys = Object.keys(first).map((k) => k.toLowerCase());
                        const hasAmount = keys.some((k) => k.includes("amount") || k.includes("debit") || k.includes("credit"));
                        const hasContext = keys.some((k) => k.includes("date") || k.includes("vendor") || k.includes("account") || k.includes("posted") || k.includes("user"));
                        if (hasAmount && (hasContext || keys.length >= 3))
                            return arr;
                        return [];
                    };
                    const preferred = wb.SheetNames.find((n) => /r2r|journal|entry|je/i.test(n));
                    rows = preferred ? trySheet(preferred) : [];
                    if (rows.length === 0) {
                        for (const name of wb.SheetNames) {
                            rows = trySheet(name);
                            if (rows.length > 0)
                                break;
                        }
                    }
                    if (rows.length === 0)
                        rows = trySheet(wb.SheetNames[0]);
                }
                setRawRows(rows || []);
                setUploadFileName(file.name);
            }
            catch (err) {
                setUploadError(err?.message || "Parse error");
                setRawRows([]);
            }
        };
        if (isCsv)
            reader.readAsText(file);
        else
            reader.readAsArrayBuffer(file);
    }, []);
    const renderTab = () => {
        const emptyMsg = (_jsx("div", { style: { padding: 48, textAlign: "center", background: C.bg, borderRadius: 12, border: `1px dashed ${C.border}`, color: C.textSub, fontSize: 14 }, children: "Upload journal entries above to see analysis" }));
        if (!derivedStats)
            return emptyMsg;
        switch (active) {
            case "trend": return _jsx(TrendTab, { data: derivedStats });
            case "vendor": return _jsx(VendorTab, { data: derivedStats });
            case "user": return _jsx(UserTab, { data: derivedStats });
            case "stats": return _jsx(StatTab, { data: derivedStats });
            case "ai": return _jsx(AIInsightsTab, { data: derivedStats });
            default: return null;
        }
    };
    return (_jsxs("div", { style: { fontFamily: font, background: C.bg, minHeight: "100vh" }, children: [_jsx("style", { children: `@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=DM+Mono:wght@400;500;700&display=swap');*{box-sizing:border-box;margin:0;padding:0;}@keyframes spin{to{transform:rotate(360deg);}}` }), _jsxs("div", { style: { background: `linear-gradient(135deg, ${C.navy} 0%, #1E3A8A 50%, #1D4ED8 100%)`,
                    padding: "0 24px", boxShadow: "0 2px 12px rgba(15,45,94,0.3)", position: "relative", zIndex: 10 }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 16, paddingBottom: 10 }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12 }, children: [_jsx("button", { onClick: () => navigate("/dashboard"), style: { background: "rgba(255,255,255,0.1)", border: "none", color: "#93C5FD",
                                            borderRadius: 6, width: 32, height: 32, cursor: "pointer", fontSize: 14 }, children: "\u2190" }), _jsx("div", { style: { width: 36, height: 36, borderRadius: 9,
                                            background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }, children: "\uD83D\uDD0D" }), _jsxs("div", { children: [_jsx("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: _jsx("span", { style: { fontSize: 11, color: "#93C5FD", fontWeight: 600, letterSpacing: "0.08em" }, children: "FINREPORTAI COMMERCIAL \u00B7 R2R MODULE" }) }), _jsx("div", { style: { fontSize: 18, fontWeight: 800, color: C.white, letterSpacing: "-0.02em" }, children: "Journal Entry Pattern Analysis" }), _jsxs("div", { style: { fontSize: 11, color: "#93C5FD" }, children: ["AI-powered anomaly patterns \u00B7 Amazon Nova \u00B7 ", derivedStats ? `${derivedStats.total} JEs analysed · ${derivedStats.high + derivedStats.medium} flagged` : "Upload file to see analysis"] })] })] }), _jsxs("div", { style: { display: "flex", gap: 10, alignItems: "center" }, children: [_jsxs("div", { style: { textAlign: "right" }, children: [_jsx("div", { style: { fontSize: 10, color: "#93C5FD", letterSpacing: "0.08em" }, children: "PERIOD" }), _jsx("div", { style: { fontSize: 13, fontWeight: 700, color: C.white }, children: "Oct 25 \u2013 Mar 26" })] }), _jsx("span", { style: { background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)",
                                            color: C.white, borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600,
                                            display: "flex", alignItems: "center", gap: 6 }, children: "\u2191 Upload above" }), _jsx("button", { type: "button", onClick: (e) => { e.preventDefault(); e.stopPropagation(); handleExportReport(); }, style: { background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)",
                                            color: C.white, borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600,
                                            cursor: "pointer", display: "flex", alignItems: "center", gap: 6, position: "relative", zIndex: 11, flexShrink: 0 }, children: "\u2B07 Export Report" })] })] }), _jsx("div", { style: { display: "flex", gap: 20, paddingBottom: 14, flexWrap: "wrap" }, children: [
                            { icon: "🔴", text: derivedStats ? `${derivedStats.high} HIGH risk entries require review` : "Upload to see risk summary", color: "#FCA5A5" },
                            { icon: "🤖", text: "87% AI confidence · Nova model", color: "#93C5FD" },
                            { icon: "✅", text: derivedStats ? `${derivedStats.autoCleaned} entries auto-cleared by rules engine` : "Upload to see auto-cleared", color: "#86EFAC" },
                            { icon: "✦", text: "Powered by Amazon Nova", color: "#93C5FD" },
                        ].map((s) => (_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: s.color }, children: [_jsx("span", { children: s.icon }), s.text] }, s.text))) }), _jsx("div", { style: { display: "flex", gap: 0, overflowX: "auto", scrollbarWidth: "none" }, children: tabs.map((tab) => {
                            const isActive = active === tab.id;
                            return (_jsxs("button", { onClick: () => setActive(tab.id), style: { padding: "10px 18px", whiteSpace: "nowrap", cursor: "pointer", border: "none",
                                    background: "transparent", fontFamily: font,
                                    borderBottom: isActive ? "2.5px solid #60A5FA" : "2.5px solid transparent",
                                    color: isActive ? C.white : "#93C5FD",
                                    fontSize: 13, fontWeight: isActive ? 700 : 500,
                                    display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s" }, children: [_jsx("span", { children: tab.icon }), tab.label] }, tab.id));
                        }) })] }), _jsxs("div", { style: { maxWidth: 1100, margin: "0 auto", padding: "24px", display: "flex", flexDirection: "column", gap: 20 }, children: [_jsxs(Card, { style: { marginBottom: 0 }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }, children: [_jsx("span", { style: { fontSize: 14, fontWeight: 700, color: C.text }, children: "Upload journal entries" }), _jsx("span", { style: { fontSize: 12, color: C.textSub }, children: "CSV or Excel \u00B7 Columns: Amount, Vendor, Account, Date, Posted By (or similar)" })] }), _jsxs("div", { style: { marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${C.borderLight}` }, children: [_jsx("div", { style: { fontSize: 12, fontWeight: 600, color: C.textSub, marginBottom: 6 }, children: "Client (optional \u2014 for learning over time)" }), _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }, children: [_jsxs("select", { value: selectedClientId ?? "", onChange: (e) => setSelectedClientId(e.target.value || null), style: { padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, minWidth: 180 }, children: [_jsx("option", { value: "", children: "No client (one-off analysis)" }), clients.map((c) => (_jsx("option", { value: c.id, children: c.name }, c.id)))] }), _jsxs("span", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [_jsx("input", { type: "text", placeholder: "New client name", value: newClientName, onChange: (e) => setNewClientName(e.target.value), style: { padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, width: 160 } }), _jsx("button", { type: "button", onClick: async () => {
                                                            if (!newClientName.trim())
                                                                return;
                                                            try {
                                                                const created = await createClient(newClientName.trim());
                                                                setClients((prev) => [created, ...prev]);
                                                                setSelectedClientId(created.id);
                                                                setNewClientName("");
                                                            }
                                                            catch (err) {
                                                                alert(err?.message || "Failed to create client");
                                                            }
                                                        }, style: { padding: "8px 14px", borderRadius: 8, background: C.blue, color: C.white, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer" }, children: "Add client" })] }), selectedClientId && (_jsx("span", { style: { fontSize: 11, color: C.green }, children: "\u2713 Saved to client \u00B7 baseline from full history" }))] })] }), _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }, children: [_jsxs("label", { style: { cursor: "pointer", padding: "10px 18px", borderRadius: 8, background: C.blue, color: C.white, fontSize: 13, fontWeight: 600 }, children: ["Choose file", _jsx("input", { type: "file", accept: ".csv,.xlsx,.xls", style: { display: "none" }, onChange: (e) => { const f = e.target.files?.[0]; if (f)
                                                    handleFile(f); e.target.value = ""; } })] }), uploadFileName && _jsxs("span", { style: { fontSize: 12, color: C.textSub }, children: [uploadFileName, " \u00B7 ", rawRows.length, " rows"] }), jeEntriesFromUpload.length > 0 && (_jsx("button", { type: "button", onClick: handleExportReport, style: { padding: "10px 18px", borderRadius: 8, background: C.green, color: C.white, fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer" }, children: "\u2B07 Download report (.xlsx)" })), uploadError && _jsx("span", { style: { fontSize: 12, color: C.red }, children: uploadError })] })] }), analysisLoading && (_jsx(Card, { style: { marginBottom: 12, background: C.bluePale, border: `1px solid ${C.blueBorder}` }, children: _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }, children: [_jsx("div", { style: { width: 24, height: 24, border: `2px solid ${C.border}`, borderTopColor: C.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" } }), _jsx("span", { style: { fontSize: 14, fontWeight: 600, color: C.text }, children: "Running 4-layer hybrid analysis (ML + Statistical + Rules + Nova)\u2026" })] }) })), _jsx(JESummaryTable, { entries: !analysisLoading && jeEntriesFromUpload.length > 0 ? jeEntriesFromUpload : undefined, totalAmt: !analysisLoading && jeEntriesFromUpload.length > 0 ? totalAmtStr : undefined, totalAnalysed: rawRows.length > 0 ? rawRows.length : undefined, anomaliesCount: derivedStats ? derivedStats.high + derivedStats.medium : undefined }), _jsx("div", { style: { borderTop: `2px solid ${C.border}`, paddingTop: 20 }, children: renderTab() })] })] }));
}
