import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
// ─── Shared Design Tokens ───────────────────────────────────────────────────
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
// ─── Utility Components ──────────────────────────────────────────────────────
const Badge = ({ label, color = "blue" }) => {
    const map = {
        blue: { bg: C.bluePale, text: C.blue, border: C.blueBorder },
        green: { bg: C.greenBg, text: C.green, border: C.greenBorder },
        red: { bg: C.redBg, text: C.red, border: C.redBorder },
        amber: { bg: C.amberBg, text: C.amber, border: C.amberBorder },
    };
    const s = map[color] || map.blue;
    return (_jsx("span", { style: { fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 5,
            background: s.bg, color: s.text, border: `1px solid ${s.border}`, letterSpacing: "0.06em", textTransform: "uppercase" }, children: label }));
};
const Card = ({ children, style = {} }) => (_jsx("div", { style: { background: C.white, border: `1px solid ${C.border}`, borderRadius: 12,
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)", padding: 24, ...style }, children: children }));
const SectionTitle = ({ children }) => (_jsx("h3", { style: { fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 16, fontFamily: font }, children: children }));
const Label = ({ children }) => (_jsx("label", { style: { fontSize: 12, fontWeight: 500, color: C.blue, display: "block", marginBottom: 6, letterSpacing: "0.01em" }, children: children }));
const Input = ({ value, placeholder }) => (_jsx("div", { style: { border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", fontSize: 14,
        fontFamily: font, fontWeight: 400, color: C.text, background: C.white, lineHeight: 1.4 }, children: value || _jsx("span", { style: { color: C.textMute }, children: placeholder }) }));
const Radio = ({ label, checked }) => (_jsxs("label", { style: { display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: C.textMid, cursor: "pointer" }, children: [_jsx("div", { style: { width: 18, height: 18, borderRadius: "50%", border: `2px solid ${checked ? C.blue : "#D1D5DB"}`,
                background: checked ? C.blue : C.white, display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, boxShadow: checked ? `0 0 0 3px ${C.bluePale}` : "none", transition: "all 0.15s" }, children: checked && _jsx("div", { style: { width: 7, height: 7, borderRadius: "50%", background: C.white } }) }), label] }));
const BtnPrimary = ({ children, onClick }) => (_jsx("button", { onClick: onClick, style: { background: C.blue, color: C.white, border: "none", borderRadius: 8,
        padding: "10px 22px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: font,
        display: "flex", alignItems: "center", gap: 6 }, children: children }));
const BtnOutline = ({ children, active, onClick }) => (_jsx("button", { onClick: onClick, style: { background: active ? C.bluePale : C.white,
        color: active ? C.blue : C.textMid, border: `1.5px solid ${active ? C.blue : C.border}`,
        borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: font, flex: 1 }, children: children }));
const Divider = () => _jsx("div", { style: { borderTop: `1px solid ${C.borderLight}`, margin: "16px 0" } });
const CheckIcon = ({ ok }) => (_jsx("span", { style: { fontSize: 14 }, children: ok === true ? "✅" : ok === false ? "❌" : "⚠️" }));
function buildNovaPrompt(type, inputs = {}) {
    const prompts = {
        investment: `You are a CFO-level financial advisor for an Indian company. Analyse this capital investment and respond ONLY with a JSON object — no markdown, no preamble.

Input data:
- Project: ${inputs.projectName ?? "New ERP System"}
- Total Investment: ₹${inputs.totalInvestment ?? "2,00,00,000"}
- Annual Returns: ₹${inputs.annualReturns ?? "50,00,000"}
- Project Life: ${inputs.projectLife ?? "5"} years
- Discount Rate (WACC): ${inputs.discountRate ?? "12"}%
- Current Cash Position: ₹${inputs.cashPosition ?? "2,50,00,000"}
- Risk Level: ${inputs.riskLevel ?? "Medium"}
- Strategic Value: ${inputs.strategicValue ?? "Medium"}

Respond with this exact JSON structure:
{"decision":"APPROVE|CONDITIONAL APPROVE|REJECT","confidence":0-100,"summary":"2 sentence financial summary","factors":[{"label":"string","detail":"string","ok":true|false|null},{"label":"string","detail":"string","ok":true|false|null},{"label":"string","detail":"string","ok":true|false|null},{"label":"string","detail":"string","ok":true|false|null}],"action":"one sentence recommended action for CFO"}`,
        buildvsbuy: `You are a CFO-level technology investment advisor for an Indian company. Analyse this build vs buy decision and respond ONLY with a JSON object — no markdown, no preamble.

Input data:
- Build 5-year cost: ₹4.5 Crore (Dev team: ₹2.5Cr, Infrastructure: ₹80L, Maintenance: ₹70L, QA: ₹50L)
- Buy 5-year cost: ₹4.8 Crore (License: ₹4.0Cr, Implementation: ₹30L, Customisation: ₹20L, Support: ₹25L)
- Build go-live: 12 months | Buy go-live: 3 months
- Build score: 95/100 | Buy score: 55/100
- Build advantages: Full IP ownership, unlimited customisation, scalable
- Buy advantages: Faster deployment, proven solution, vendor support

Respond with this exact JSON structure:
{"decision":"RECOMMEND: BUILD|RECOMMEND: BUY|RECOMMEND: HYBRID","confidence":0-100,"summary":"2 sentence analysis","factors":[{"label":"string","detail":"string","ok":true|false|null},{"label":"string","detail":"string","ok":true|false|null},{"label":"string","detail":"string","ok":true|false|null},{"label":"string","detail":"string","ok":true|false|null}],"action":"one sentence recommended action for CFO"}`,
        internalexternal: `You are a CFO-level operations advisor for an Indian company. Analyse this internal vs external resourcing decision and respond ONLY with a JSON object — no markdown, no preamble.

Input data:
- Internal cost: ₹42L/year (3 staff × ₹14L avg CTC)
- External cost: ₹48L/year (vendor quote)
- Internal error rate: 2.3% | External SLA: 0.5%
- Internal close cycle: 5 days | External SLA: 3 days
- Internal risk: knowledge retention | External risk: vendor dependency

Respond with this exact JSON structure:
{"decision":"RECOMMEND: INTERNAL|RECOMMEND: EXTERNAL|RECOMMEND: HYBRID","confidence":0-100,"summary":"2 sentence analysis","factors":[{"label":"string","detail":"string","ok":true|false|null},{"label":"string","detail":"string","ok":true|false|null},{"label":"string","detail":"string","ok":true|false|null},{"label":"string","detail":"string","ok":true|false|null}],"action":"one sentence recommended action for CFO"}`,
        hirevsautomate: `You are a CFO-level workforce advisor for an Indian company. Analyse this hire vs automate decision and respond ONLY with a JSON object — no markdown, no preamble.

Input data:
- Process: Invoice processing, 500 invoices/month
- Hire option: 2 people × ₹8L CTC = ₹16L/year, no break-even
- Automate option: ₹12L one-time cost, ₹2.5L/year maintenance, 80% automation coverage
- Break-even if automate: 11 months
- 5-year saving if automate: ₹37L vs hiring
- Residual manual work: 20% complex cases still need human review

Respond with this exact JSON structure:
{"decision":"RECOMMEND: HIRE|RECOMMEND: AUTOMATE|RECOMMEND: HYBRID","confidence":0-100,"summary":"2 sentence analysis","factors":[{"label":"string","detail":"string","ok":true|false|null},{"label":"string","detail":"string","ok":true|false|null},{"label":"string","detail":"string","ok":true|false|null},{"label":"string","detail":"string","ok":true|false|null}],"action":"one sentence recommended action for CFO"}`,
    };
    return prompts[type] ?? prompts.investment;
}
// ─── Call AWS Bedrock Nova via backend ───────────────────────────────────────
async function callNova(type, inputs = {}) {
    const prompt = buildNovaPrompt(type, inputs);
    const API_URL = (typeof window !== "undefined" && window.FINREPORTAI_API_URL) || "http://localhost:8000";
    const res = await fetch(`${API_URL}/api/nova/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model_id: "amazon.nova-lite-v1:0",
            prompt,
            max_tokens: 600,
            temperature: 0.3,
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `HTTP ${res.status}`);
    }
    const data = (await res.json());
    const raw = data.text.replace(/```json|```/g, "").trim();
    return JSON.parse(raw);
}
// ─── AI Recommendation Panel (real Nova calls) ────────────────────────────────
const AIPanel = ({ type = "investment", inputs = {} }) => {
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const handleGenerate = async () => {
        setLoading(true);
        setError(null);
        setResult(null);
        try {
            const data = await callNova(type, inputs);
            setResult(data);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setLoading(false);
        }
    };
    const decisionColor = !result ? C.blue
        : /APPROVE|BUILD|AUTOMATE|INTERNAL/.test(result.decision) ? C.green
            : /CONDITIONAL|HYBRID/.test(result.decision) ? C.amber
                : C.red;
    const decisionIcon = decisionColor === C.green ? "✅" : decisionColor === C.amber ? "⚠️" : "❌";
    return (_jsxs(Card, { style: { borderLeft: `4px solid ${loading ? C.blueLight : error ? C.red : result ? decisionColor : C.blue}` }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }, children: [_jsxs("div", { children: [_jsxs("div", { style: { fontSize: 13, fontWeight: 700, color: C.text, display: "flex", alignItems: "center", gap: 6 }, children: ["\uD83E\uDD16 AI Recommendation", _jsx("span", { style: { fontWeight: 400, color: C.textSub, fontSize: 11 }, children: "Amazon Nova Lite \u00B7 AWS Bedrock" })] }), _jsx("div", { style: { fontSize: 11, color: C.textSub, marginTop: 2 }, children: "Powered by generative AI \u2014 review before acting" })] }), _jsxs("div", { style: { textAlign: "right" }, children: [_jsx("div", { style: { fontSize: 22, fontWeight: 900, fontFamily: mono,
                                    color: result ? (result.confidence >= 75 ? C.green : result.confidence >= 50 ? C.amber : C.red) : C.textMute }, children: result ? `${result.confidence}%` : "—" }), _jsx("div", { style: { fontSize: 10, color: C.textSub, letterSpacing: "0.06em" }, children: "CONFIDENCE" })] })] }), !result && !loading && !error && (_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
                    background: C.bluePale, borderRadius: 8, border: `1px solid ${C.blueBorder}` }, children: [_jsx("span", { style: { fontSize: 22 }, children: "\uD83E\uDD16" }), _jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { style: { fontSize: 13, fontWeight: 600, color: C.blue }, children: "Ready to analyse" }), _jsx("div", { style: { fontSize: 11, color: C.textSub }, children: "Click Generate \u2014 Amazon Nova will analyse your inputs via AWS Bedrock" })] }), _jsx("button", { onClick: handleGenerate, style: { background: C.blue, color: C.white, border: "none",
                            borderRadius: 7, padding: "8px 18px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font }, children: "Generate \u25B6" })] })), loading && (_jsxs("div", { style: { padding: "20px 16px", background: C.bluePale, borderRadius: 8,
                    border: `1px solid ${C.blueBorder}`, display: "flex", alignItems: "center", gap: 12 }, children: [_jsx("div", { style: { display: "flex", gap: 5 }, children: [0, 1, 2].map(i => (_jsx("div", { style: { width: 8, height: 8, borderRadius: "50%", background: C.blue,
                                animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` } }, i))) }), _jsx("span", { style: { fontSize: 13, color: C.blue, fontWeight: 500 }, children: "Amazon Nova is analysing your inputs..." }), _jsx("style", { children: `@keyframes pulse{0%,100%{opacity:0.3;transform:scale(0.8)}50%{opacity:1;transform:scale(1.2)}}` })] })), error && !loading && (_jsxs("div", { style: { background: C.redBg, border: `1px solid ${C.redBorder}`, borderRadius: 8,
                    padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: 12, fontWeight: 700, color: C.red, marginBottom: 3 }, children: "\u26A0\uFE0F Nova API Error" }), _jsx("div", { style: { fontSize: 11, color: C.red }, children: error }), _jsxs("div", { style: { fontSize: 11, color: C.textSub, marginTop: 4 }, children: ["Check ", _jsx("code", { style: { background: "#FEE2E2", padding: "1px 4px", borderRadius: 3 }, children: "AWS_ACCESS_KEY_ID" }), " and", " ", _jsx("code", { style: { background: "#FEE2E2", padding: "1px 4px", borderRadius: 3 }, children: "AWS_SECRET_ACCESS_KEY" }), " in your ", _jsx("code", { style: { background: "#FEE2E2", padding: "1px 4px", borderRadius: 3 }, children: ".env" })] })] }), _jsx("button", { onClick: handleGenerate, style: { background: C.red, color: C.white, border: "none",
                            borderRadius: 7, padding: "8px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: font, whiteSpace: "nowrap" }, children: "Retry \u21BA" })] })), result && !loading && (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 12 }, children: [_jsxs("div", { style: { display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 16px",
                            background: decisionColor === C.green ? C.greenBg : decisionColor === C.amber ? C.amberBg : C.redBg,
                            borderRadius: 8, border: `1px solid ${decisionColor === C.green ? C.greenBorder : decisionColor === C.amber ? C.amberBorder : C.redBorder}` }, children: [_jsx("span", { style: { fontSize: 18, marginTop: 1 }, children: decisionIcon }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 12, fontWeight: 800, color: decisionColor, letterSpacing: "0.06em", marginBottom: 4 }, children: result.decision }), _jsx("div", { style: { fontSize: 12, color: C.textMid, lineHeight: 1.6 }, children: result.summary })] })] }), _jsx("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }, children: (result.factors || []).map((f, i) => (_jsxs("div", { style: { padding: "10px 12px", borderRadius: 7,
                                background: f.ok === true ? C.greenBg : f.ok === false ? C.redBg : C.amberBg,
                                border: `1px solid ${f.ok === true ? C.greenBorder : f.ok === false ? C.redBorder : C.amberBorder}` }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }, children: [_jsx("span", { style: { fontSize: 12 }, children: f.ok === true ? "✅" : f.ok === false ? "❌" : "⚠️" }), _jsx("span", { style: { fontSize: 11, fontWeight: 700, color: C.text }, children: f.label })] }), _jsx("div", { style: { fontSize: 11, color: C.textSub, lineHeight: 1.4 }, children: f.detail })] }, i))) }), _jsxs("div", { style: { padding: "10px 14px", background: C.bg, borderRadius: 7,
                            border: `1px solid ${C.border}`, fontSize: 12 }, children: [_jsx("strong", { style: { color: C.text }, children: "\uD83D\uDCCB Recommended Action: " }), _jsx("span", { style: { color: C.textMid }, children: result.action })] }), _jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [_jsx("span", { style: { fontSize: 10, color: C.textMute }, children: "Generated by Amazon Nova Lite \u00B7 AWS Bedrock \u00B7 Not financial advice" }), _jsx("button", { onClick: handleGenerate, style: { background: "none", border: "none",
                                    fontSize: 11, color: C.textSub, cursor: "pointer", textDecoration: "underline" }, children: "Re-generate \u21BA" })] })] }))] }));
};
// ─── CFO Decision Panel ──────────────────────────────────────────────────────
const CFODecisionPanel = ({ options = ["Approve", "Reject", "Hold"], onSave }) => {
    const [selected, setSelected] = useState(null);
    const [notes, setNotes] = useState("");
    return (_jsxs(Card, { children: [_jsx(SectionTitle, { children: "CFO Decision" }), _jsx("div", { style: { display: "flex", gap: 10, marginBottom: 16 }, children: options.map((o) => (_jsx(BtnOutline, { active: selected === o, onClick: () => setSelected(o), children: o }, o))) }), _jsx(Label, { children: "CFO Notes (optional)" }), _jsx("textarea", { placeholder: "Add notes before saving...", value: notes, onChange: (e) => setNotes(e.target.value), style: { width: "100%", border: `1px solid ${C.border}`, borderRadius: 7, padding: "10px 12px",
                    fontSize: 13, fontFamily: font, color: C.textMid, resize: "vertical", minHeight: 80,
                    boxSizing: "border-box", outline: "none" } }), _jsx("div", { style: { marginTop: 12 }, children: _jsx("button", { onClick: onSave, style: { width: "100%", background: C.blue, color: C.white,
                        border: "none", borderRadius: 8, padding: "12px", fontSize: 13, fontWeight: 700,
                        cursor: "pointer", fontFamily: font, letterSpacing: "0.02em" }, children: "\uD83D\uDCBE Save to Audit Trail" }) })] }));
};
// ─── Scorecard Table ─────────────────────────────────────────────────────────
const ScorecardRow = ({ label, leftVal, leftOk, rightVal, rightOk }) => (_jsxs("tr", { children: [_jsx("td", { style: { padding: "11px 16px", fontSize: 13, color: C.textMid, fontWeight: 500, borderBottom: `1px solid ${C.borderLight}` }, children: label }), _jsx("td", { style: { padding: "11px 16px", borderBottom: `1px solid ${C.borderLight}` }, children: _jsxs("span", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.textMid }, children: [_jsx(CheckIcon, { ok: leftOk }), " ", leftVal] }) }), _jsx("td", { style: { padding: "11px 16px", borderBottom: `1px solid ${C.borderLight}` }, children: _jsxs("span", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.textMid }, children: [_jsx(CheckIcon, { ok: rightOk }), " ", rightVal] }) })] }));
// ─── Tab: Investment Decision ─────────────────────────────────────────────────
const InvestmentTab = () => {
    const projects = [
        { name: "ERP System", inv: "₹2.00Cr", npv: "₹1.8L", npvPos: true, irr: "14.8%", payback: "4y", score: 72, ok: true },
        { name: "Sales Expansion", inv: "₹50.0L", npv: "₹8.2L", npvPos: true, irr: "28.3%", payback: "1.8y", score: 91, ok: true },
        { name: "New Office", inv: "₹1.50Cr", npv: "₹-3,20,000", npvPos: false, irr: "9.1%", payback: "6.5y", score: 38, ok: false },
        { name: "AI Platform", inv: "₹80.0L", npv: "₹5.1L", npvPos: true, irr: "21.4%", payback: "2.4y", score: 85, ok: true },
    ];
    return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 20 }, children: [_jsxs(Card, { children: [_jsx(SectionTitle, { children: "Investment Details" }), _jsxs("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 24px" }, children: [[["Project Name", "New ERP System"], ["Total Investment (₹)", "20000000"],
                                ["Annual Returns (₹)", "5000000"], ["Project Life (years)", "5"],
                                ["Discount Rate (%) — auto from WACC", "12"], ["Current Cash Position (₹)", "25000000"]].map(([l, v]) => (_jsxs("div", { children: [_jsx(Label, { children: l }), _jsx(Input, { value: v })] }, l))), _jsxs("div", { children: [_jsx(Label, { children: "Risk Level" }), _jsxs("div", { style: { display: "flex", gap: 16, paddingTop: 4 }, children: [_jsx(Radio, { label: "Low", checked: false }), _jsx(Radio, { label: "Medium", checked: true }), _jsx(Radio, { label: "High", checked: false })] })] }), _jsxs("div", { children: [_jsx(Label, { children: "Strategic Value" }), _jsxs("div", { style: { display: "flex", gap: 16, paddingTop: 4 }, children: [_jsx(Radio, { label: "Low", checked: false }), _jsx(Radio, { label: "Medium", checked: true }), _jsx(Radio, { label: "High", checked: false })] })] })] }), _jsx("div", { style: { marginTop: 20 }, children: _jsx(BtnPrimary, { children: "Calculate & Decide \u25B6" }) })] }), _jsxs(Card, { children: [_jsx(SectionTitle, { children: "Compare Multiple Projects" }), _jsxs("table", { style: { width: "100%", borderCollapse: "collapse" }, children: [_jsx("thead", { children: _jsx("tr", { style: { background: C.bg }, children: ["Project", "Investment", "NPV", "IRR", "Payback", "Score", "Decision"].map((h) => (_jsx("th", { style: { padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700,
                                            color: C.textSub, letterSpacing: "0.07em", textTransform: "uppercase",
                                            borderBottom: `1.5px solid ${C.border}` }, children: h }, h))) }) }), _jsx("tbody", { children: projects.map((p, i) => (_jsxs("tr", { style: { background: i % 2 === 0 ? C.white : "#FAFBFC" }, children: [_jsx("td", { style: { padding: "12px 16px", fontWeight: 600, fontSize: 13, color: C.text, borderBottom: `1px solid ${C.borderLight}` }, children: p.name }), _jsx("td", { style: { padding: "12px 16px", fontSize: 13, color: C.textMid, borderBottom: `1px solid ${C.borderLight}` }, children: p.inv }), _jsx("td", { style: { padding: "12px 16px", fontSize: 13, fontFamily: mono, fontWeight: 500,
                                                color: p.npvPos ? C.green : C.red, borderBottom: `1px solid ${C.borderLight}` }, children: p.npv }), _jsx("td", { style: { padding: "12px 16px", fontSize: 13, color: C.textMid, borderBottom: `1px solid ${C.borderLight}` }, children: p.irr }), _jsx("td", { style: { padding: "12px 16px", fontSize: 13, color: C.textMid, borderBottom: `1px solid ${C.borderLight}` }, children: p.payback }), _jsx("td", { style: { padding: "12px 16px", borderBottom: `1px solid ${C.borderLight}` }, children: _jsx("span", { style: { fontSize: 14, fontWeight: 800, fontFamily: mono, color: C.text }, children: p.score }) }), _jsx("td", { style: { padding: "12px 16px", borderBottom: `1px solid ${C.borderLight}` }, children: _jsx("span", { style: { fontSize: 16 }, children: p.ok ? "✅" : "❌" }) })] }, p.name))) })] }), _jsx("div", { style: { marginTop: 14, padding: "10px 16px", background: C.bluePale, borderRadius: 7,
                            fontSize: 12, fontWeight: 600, color: C.blue, border: `1px solid ${C.blueBorder}` }, children: "\uD83E\uDD16 AI RANKING: Sales Expansion > AI Platform > ERP System > New Office" })] }), _jsx(AIPanel, { type: "investment" }), _jsx(CFODecisionPanel, { options: ["Approve", "Reject", "Hold"] })] }));
};
// ─── Tab: Build vs Buy ───────────────────────────────────────────────────────
const BuildBuyTab = () => {
    const scorecard = [
        { label: "Cost (5yr)", lv: "₹4.5Cr", lo: true, rv: "₹4.8Cr", ro: false },
        { label: "Time to value", lv: "12 mo", lo: false, rv: "3 Mo", ro: true },
        { label: "Customization", lv: "Full", lo: true, rv: "Partial", ro: false },
        { label: "Vendor risk", lv: "None", lo: true, rv: "High", ro: null },
        { label: "Scalability", lv: "High", lo: true, rv: "Limited", ro: null },
        { label: "IP ownership", lv: "Yes", lo: true, rv: "No", ro: null },
        { label: "Maintenance burden", lv: "High", lo: false, rv: "Vendor", ro: true },
        { label: "Integration", lv: "Custom", lo: true, rv: "Standard API", ro: false },
    ];
    return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 20 }, children: [_jsxs(Card, { children: [_jsx(SectionTitle, { children: "Requirements" }), _jsxs("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }, children: [_jsxs("div", { style: { gridColumn: "1 / -1" }, children: [_jsx(Label, { children: "What we need" }), _jsx(Input, { value: "FP&A Planning Software" })] }), _jsxs("div", { style: { gridColumn: "1 / -1" }, children: [_jsx(Label, { children: "Core requirement" }), _jsx(Input, { value: "Budget, Forecast, Reporting" })] })] }), _jsxs("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 20 }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: 12, fontWeight: 700, color: C.blue, letterSpacing: "0.08em",
                                            marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }, children: "\uD83C\uDFD7\uFE0F BUILD OPTION" }), [["Development cost (₹)", "5000000"], ["Build timeline (months)", "12"],
                                        ["Team needed (developers)", "5"], ["Annual maintenance (₹)", "1500000"]].map(([l, v]) => (_jsxs("div", { style: { marginBottom: 12 }, children: [_jsx(Label, { children: l }), _jsx(Input, { value: v })] }, l)))] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 12, fontWeight: 700, color: C.green, letterSpacing: "0.08em",
                                            marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }, children: "\uD83D\uDCB0 BUY OPTION" }), [["Vendor name", "Anaplan / Workday / Other"], ["License cost (₹/year)", "8000000"],
                                        ["Implementation (₹, one-time)", "3000000"], ["Go-live (months)", "3"]].map(([l, v]) => (_jsxs("div", { style: { marginBottom: 12 }, children: [_jsx(Label, { children: l }), _jsx(Input, { value: v })] }, l)))] })] })] }), _jsxs(Card, { children: [_jsx(SectionTitle, { children: "5-Year Cost Comparison" }), _jsxs("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: 11, fontWeight: 700, color: C.blue, marginBottom: 12, letterSpacing: "0.08em" }, children: "BUILD:" }), [["Development:", "₹50.0L"], ["Maintenance (5yr):", "₹75.0L"], ["Team cost (5yr):", "₹3.0Cr"], ["Opportunity:", "₹30.0L"]].map(([l, v]) => (_jsxs("div", { style: { display: "flex", justifyContent: "space-between", padding: "7px 0",
                                            borderBottom: `1px solid ${C.borderLight}`, fontSize: 13 }, children: [_jsx("span", { style: { color: C.textMid }, children: l }), _jsx("span", { style: { fontFamily: mono, fontWeight: 400, color: C.textMid }, children: v })] }, l))), _jsxs("div", { style: { display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 14, fontWeight: 800 }, children: [_jsx("span", { style: { color: C.text }, children: "TOTAL:" }), _jsx("span", { style: { color: C.blue, fontFamily: mono }, children: "\u20B94.5Cr" })] })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 11, fontWeight: 700, color: C.green, marginBottom: 12, letterSpacing: "0.08em" }, children: "BUY:" }), [["License (5yr):", "₹4.0Cr"], ["Implementation:", "₹30.0L"], ["Customization:", "₹20.0L"], ["Support:", "₹25.0L"]].map(([l, v]) => (_jsxs("div", { style: { display: "flex", justifyContent: "space-between", padding: "7px 0",
                                            borderBottom: `1px solid ${C.borderLight}`, fontSize: 13 }, children: [_jsx("span", { style: { color: C.textMid }, children: l }), _jsx("span", { style: { fontFamily: mono, fontWeight: 400, color: C.textMid }, children: v })] }, l))), _jsxs("div", { style: { display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 14, fontWeight: 800 }, children: [_jsx("span", { style: { color: C.text }, children: "TOTAL:" }), _jsx("span", { style: { color: C.green, fontFamily: mono }, children: "\u20B94.8Cr" })] })] })] }), _jsx("div", { style: { textAlign: "center", marginTop: 12, padding: "10px", background: C.greenBg,
                            borderRadius: 7, border: `1px solid ${C.greenBorder}`, fontSize: 13, fontWeight: 700, color: C.green }, children: "BUILD CHEAPER BY \u20B920.0L over 5 years" })] }), _jsxs(Card, { children: [_jsx(SectionTitle, { children: "Scorecard" }), _jsxs("table", { style: { width: "100%", borderCollapse: "collapse" }, children: [_jsx("thead", { children: _jsxs("tr", { style: { background: C.bg }, children: [_jsx("th", { style: { padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700,
                                                color: C.textSub, letterSpacing: "0.07em", textTransform: "uppercase",
                                                borderBottom: `1.5px solid ${C.border}`, width: "35%" }, children: "Criterion" }), _jsx("th", { style: { padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700,
                                                color: C.blue, letterSpacing: "0.07em", textTransform: "uppercase",
                                                borderBottom: `1.5px solid ${C.border}` }, children: "\uD83C\uDFD7\uFE0F Build" }), _jsx("th", { style: { padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700,
                                                color: C.green, letterSpacing: "0.07em", textTransform: "uppercase",
                                                borderBottom: `1.5px solid ${C.border}` }, children: "\uD83D\uDCB0 Buy" })] }) }), _jsx("tbody", { children: scorecard.map((r) => _jsx(ScorecardRow, { label: r.label, leftVal: r.lv, leftOk: r.lo, rightVal: r.rv, rightOk: r.ro }, r.label)) })] }), _jsxs("div", { style: { display: "flex", justifyContent: "space-between", padding: "14px 16px 4px",
                            borderTop: `2px solid ${C.border}` }, children: [_jsxs("div", { children: [_jsx("span", { style: { fontSize: 12, fontWeight: 600, color: C.textSub }, children: "BUILD SCORE: " }), _jsx("span", { style: { fontSize: 22, fontWeight: 900, color: C.blue, fontFamily: mono }, children: "95/100" })] }), _jsxs("div", { children: [_jsx("span", { style: { fontSize: 12, fontWeight: 600, color: C.textSub }, children: "BUY SCORE: " }), _jsx("span", { style: { fontSize: 22, fontWeight: 900, color: C.amber, fontFamily: mono }, children: "55/100" })] })] })] }), _jsx(AIPanel, { type: "buildvsbuy" }), _jsx(CFODecisionPanel, { options: ["Approve Build", "Approve Buy", "Hybrid Model", "Request POC"] })] }));
};
// ─── Tab: Internal vs External ───────────────────────────────────────────────
const InternalExternalTab = () => {
    const scorecard = [
        { label: "Cost", lv: "₹42.0L", lo: true, rv: "₹48.0L", ro: null },
        { label: "Close cycle", lv: "5 days", lo: false, rv: "3 days", ro: true },
        { label: "Error rate", lv: "2.3%", lo: false, rv: "<0.5%", ro: true },
        { label: "Scalability", lv: "Limited", lo: null, rv: "Flexible", ro: true },
        { label: "Control", lv: "Full", lo: true, rv: "Partial", ro: null },
        { label: "Knowledge retention", lv: "High", lo: true, rv: "Risk of loss", ro: false },
        { label: "Regulatory compliance", lv: "Direct", lo: true, rv: "Vendor managed", ro: null },
        { label: "Team morale impact", lv: "None", lo: true, rv: "Job concerns", ro: false },
    ];
    return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 20 }, children: [_jsxs(Card, { children: [_jsx("div", { style: { display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }, children: ["AP Processing", "Payroll", "IT Support", "Tax Filing", "Internal Audit", "Treasury", "Legal"].map((t) => (_jsx("span", { style: { padding: "5px 12px", borderRadius: 20, border: `1px solid ${C.border}`,
                                fontSize: 12, fontWeight: 600, color: C.textMid, cursor: "pointer", background: C.white }, children: t }, t))) }), _jsxs("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: 12, fontWeight: 700, color: C.blue, marginBottom: 12, letterSpacing: "0.08em" }, children: "\uD83C\uDFE2 INTERNAL OPTION" }), [["Current team (people)", "5"], ["Avg cost/person (₹/year)", "800000"],
                                        ["Current time (days for close cycle)", "5"], ["Error rate (%)", "2.3"]].map(([l, v]) => (_jsxs("div", { style: { marginBottom: 12 }, children: [_jsx(Label, { children: l }), _jsx(Input, { value: v })] }, l)))] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 12, fontWeight: 700, color: C.green, marginBottom: 12, letterSpacing: "0.08em" }, children: "\uD83C\uDF10 EXTERNAL / OUTSOURCE" }), [["Vendor", "EXL / WNS / Genpact"], ["Monthly cost (₹)", "400000"],
                                        ["SLA committed (days)", "3"], ["Error rate SLA (%)", "0.5"]].map(([l, v]) => (_jsxs("div", { style: { marginBottom: 12 }, children: [_jsx(Label, { children: l }), _jsx(Input, { value: v })] }, l)))] })] })] }), _jsxs(Card, { children: [_jsx(SectionTitle, { children: "Cost Analysis" }), _jsxs("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: 11, fontWeight: 700, color: C.blue, marginBottom: 12, letterSpacing: "0.08em" }, children: "INTERNAL:" }), [["Team cost:", "₹40.0L/year"], ["Training:", "₹2.0L/year"], ["Tools:", "₹3L/year"], ["Management:", "₹5L/year"]].map(([l, v]) => (_jsxs("div", { style: { display: "flex", justifyContent: "space-between", padding: "7px 0",
                                            borderBottom: `1px solid ${C.borderLight}`, fontSize: 13 }, children: [_jsx("span", { style: { color: C.textMid }, children: l }), _jsx("span", { style: { fontFamily: mono, color: C.textMid }, children: v })] }, l))), _jsxs("div", { style: { display: "flex", justifyContent: "space-between", padding: "10px 0" }, children: [_jsx("span", { style: { fontWeight: 700, color: C.text }, children: "Total:" }), _jsx("span", { style: { fontFamily: mono, fontWeight: 800, color: C.blue }, children: "\u20B942.0L/year" })] })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 11, fontWeight: 700, color: C.green, marginBottom: 12, letterSpacing: "0.08em" }, children: "EXTERNAL:" }), [["Monthly:", "₹48.0L/year"], ["Setup:", "₹5L one-time"]].map(([l, v]) => (_jsxs("div", { style: { display: "flex", justifyContent: "space-between", padding: "7px 0",
                                            borderBottom: `1px solid ${C.borderLight}`, fontSize: 13 }, children: [_jsx("span", { style: { color: C.textMid }, children: l }), _jsx("span", { style: { fontFamily: mono, color: C.textMid }, children: v })] }, l))), _jsxs("div", { style: { display: "flex", justifyContent: "space-between", padding: "10px 0" }, children: [_jsx("span", { style: { fontWeight: 700, color: C.text }, children: "Total:" }), _jsx("span", { style: { fontFamily: mono, fontWeight: 800, color: C.green }, children: "\u20B948.0L/year" })] }), _jsx("div", { style: { fontSize: 12, color: C.red, fontWeight: 600 }, children: "+14% more expensive" })] })] })] }), _jsxs(Card, { children: [_jsx(SectionTitle, { children: "Quality Scorecard" }), _jsxs("table", { style: { width: "100%", borderCollapse: "collapse" }, children: [_jsx("thead", { children: _jsx("tr", { style: { background: C.bg }, children: ["Criterion", "🏢 Internal", "🌐 External"].map((h, i) => (_jsx("th", { style: { padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700,
                                            color: i === 0 ? C.textSub : i === 1 ? C.blue : C.green, letterSpacing: "0.07em",
                                            textTransform: "uppercase", borderBottom: `1.5px solid ${C.border}` }, children: h }, h))) }) }), _jsx("tbody", { children: scorecard.map((r) => _jsx(ScorecardRow, { label: r.label, leftVal: r.lv, leftOk: r.lo, rightVal: r.rv, rightOk: r.ro }, r.label)) })] })] }), _jsx(AIPanel, { type: "internalexternal" }), _jsx(CFODecisionPanel, { options: ["Go Internal", "Outsource", "Hybrid Model", "Hold"] })] }));
};
// ─── Tab: Hire vs Automate ────────────────────────────────────────────────────
const HireAutomateTab = () => (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 20 }, children: [_jsxs(Card, { children: [_jsx(SectionTitle, { children: "Process Details" }), _jsxs("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 24px" }, children: [_jsxs("div", { style: { gridColumn: "1 / -1" }, children: [_jsx(Label, { children: "Process" }), _jsx(Input, { value: "Invoice Processing" })] }), [["Current team (people)", "3"], ["Monthly volume", "500"],
                            ["Hours per unit", "0.5"], ["Additional needed (people)", "2"],
                            ["Avg salary (₹/year)", "600000"], ["Automation tool/vendor", "FinReportAI AP Module"],
                            ["Setup cost (₹)", "800000"], ["Monthly cost (₹)", "25000"]].map(([l, v]) => (_jsxs("div", { children: [_jsx(Label, { children: l }), _jsx(Input, { value: v })] }, l))), _jsxs("div", { children: [_jsx(Label, { children: "Automation % of volume" }), _jsx(Input, { value: "80" })] })] }), _jsx("div", { style: { marginTop: 20 }, children: _jsx(BtnPrimary, { children: "Analyze \u25B6" }) })] }), _jsxs(Card, { children: [_jsx(SectionTitle, { children: "Financial Analysis" }), _jsxs("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: 11, fontWeight: 700, color: C.blue, marginBottom: 12, letterSpacing: "0.08em" }, children: "HIRE: 2 people" }), _jsxs("div", { style: { fontSize: 28, fontWeight: 900, fontFamily: mono, color: C.text }, children: ["\u20B912.0L", _jsx("span", { style: { fontSize: 14, fontWeight: 600 }, children: "/year" })] }), _jsx("div", { style: { fontSize: 12, color: C.textSub, marginTop: 4 }, children: "Break-even: Never (recurring cost)" })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 11, fontWeight: 700, color: C.green, marginBottom: 12, letterSpacing: "0.08em" }, children: "AUTOMATE" }), [["₹11.0L", "Year 1"], ["₹3.0L", "Year 2+"]].map(([a, l]) => (_jsxs("div", { style: { fontSize: 14, fontFamily: mono, color: C.textMid, marginBottom: 4 }, children: [_jsx("strong", { style: { color: C.text }, children: a }), " ", l] }, l))), _jsx("div", { style: { fontSize: 12, fontWeight: 700, color: C.green, marginTop: 6 }, children: "Break-even: 11 months" })] })] }), _jsx(Divider, {}), _jsx("div", { style: { textAlign: "center", fontSize: 15, fontWeight: 800, color: C.green }, children: "5-year saving from automation: \u20B937.0L" })] }), _jsx(AIPanel, { type: "hirevsautomate" }), _jsx(CFODecisionPanel, { options: ["Hire", "Automate", "Hybrid", "Hold"] })] }));
// ─── Tab: Risk Dashboard ──────────────────────────────────────────────────────
const RiskTab = () => {
    const risks = [
        { icon: "💧", name: "Liquidity", sub: "Draw ₹2Cr credit line by week 2", score: 7.2, level: "HIGH", action: "URGENT", trend: "↗" },
        { icon: "💳", name: "Credit", sub: "Monitor DSO - currently 45 days", score: 4.1, level: "MEDIUM", action: "Watch", trend: "—" },
        { icon: "⚙️", name: "Operational", sub: "None required - on track", score: 3.2, level: "LOW", action: "OK", trend: "↘" },
        { icon: "📈", name: "Market", sub: "Diversify customer base - reduce top-3 dependency", score: 5.8, level: "MEDIUM", action: "Watch", trend: "↗" },
        { icon: "📋", name: "Compliance", sub: "None required - all audits passed", score: 2.1, level: "LOW", action: "OK", trend: "—" },
        { icon: "💱", name: "FX", sub: "Hedge 50% export receivables (₹1.8Cr)", score: 6.4, level: "HIGH", action: "URGENT", trend: "↗" },
        { icon: "🏢", name: "Concentration", sub: "Win 2 new enterprise clients this quarter", score: 5.1, level: "MEDIUM", action: "Watch", trend: "—" },
    ];
    const levelColor = { HIGH: C.red, MEDIUM: C.amber, LOW: C.green };
    const actionBg = { URGENT: C.redBg, Watch: C.amberBg, OK: C.greenBg };
    const actionBorder = { URGENT: C.redBorder, Watch: C.amberBorder, OK: C.greenBorder };
    return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 20 }, children: [_jsx(Card, { style: { borderLeft: `4px solid ${C.red}`, background: C.redBg }, children: _jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: 13, fontWeight: 700, color: C.red }, children: "\u26A0\uFE0F MEDIUM-HIGH \u2014 Deteriorating" }), _jsx("div", { style: { fontSize: 12, color: C.textSub, marginTop: 2 }, children: "Overall Risk Score" })] }), _jsxs("div", { style: { textAlign: "right" }, children: [_jsx("span", { style: { fontSize: 40, fontWeight: 900, fontFamily: mono, color: C.red }, children: "6.1" }), _jsx("span", { style: { fontSize: 18, color: C.textSub }, children: "/10" })] })] }) }), _jsxs(Card, { children: [_jsx(SectionTitle, { children: "Risk Categories" }), _jsxs("table", { style: { width: "100%", borderCollapse: "collapse" }, children: [_jsx("thead", { children: _jsx("tr", { style: { background: C.bg }, children: ["Risk Area", "Action Required", "Score", "Level", "Status"].map((h) => (_jsx("th", { style: { padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700,
                                            color: C.textSub, letterSpacing: "0.07em", textTransform: "uppercase",
                                            borderBottom: `1.5px solid ${C.border}` }, children: h }, h))) }) }), _jsx("tbody", { children: risks.map((r, i) => (_jsxs("tr", { style: { background: i % 2 === 0 ? C.white : "#FAFBFC" }, children: [_jsx("td", { style: { padding: "13px 16px", borderBottom: `1px solid ${C.borderLight}` }, children: _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [_jsx("span", { style: { fontSize: 18 }, children: r.icon }), _jsx("div", { children: _jsx("div", { style: { fontSize: 13, fontWeight: 700, color: C.text }, children: r.name }) })] }) }), _jsx("td", { style: { padding: "13px 16px", fontSize: 12, color: C.textMid, borderBottom: `1px solid ${C.borderLight}`, maxWidth: 280 }, children: r.sub }), _jsxs("td", { style: { padding: "13px 16px", borderBottom: `1px solid ${C.borderLight}` }, children: [_jsxs("span", { style: { fontSize: 16, fontWeight: 800, fontFamily: mono, color: levelColor[r.level] }, children: [r.score, "/10"] }), _jsx("span", { style: { marginLeft: 4, fontSize: 12, color: r.trend === "↗" ? C.red : r.trend === "↘" ? C.green : C.textMute }, children: r.trend })] }), _jsx("td", { style: { padding: "13px 16px", borderBottom: `1px solid ${C.borderLight}` }, children: _jsx("span", { style: { padding: "3px 10px", borderRadius: 5, fontSize: 11, fontWeight: 700,
                                                    color: levelColor[r.level], background: actionBg[r.action], border: `1px solid ${actionBorder[r.action]}` }, children: r.level }) }), _jsx("td", { style: { padding: "13px 16px", borderBottom: `1px solid ${C.borderLight}` }, children: _jsx(Badge, { label: r.action, color: r.action === "URGENT" ? "red" : r.action === "Watch" ? "amber" : "green" }) })] }, r.name))) })] })] }), _jsxs(Card, { style: { borderLeft: `4px solid ${C.blue}` }, children: [_jsx("div", { style: { fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }, children: "\uD83E\uDD16 AI Risk Actions (Amazon Nova)" }), [
                        { color: C.red, label: "Liquidity", action: "Draw ₹2Cr credit line by week 2" },
                        { color: C.red, label: "FX", action: "Hedge 50% export receivables (₹1.8Cr)" },
                        { color: C.amber, label: "Credit", action: "Monitor DSO - currently 45 days" },
                        { color: C.amber, label: "Market", action: "Diversify customer base - reduce top-3 dependency" },
                        { color: C.amber, label: "Concentration", action: "Win 2 new enterprise clients this quarter" },
                    ].map((a) => (_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
                            borderBottom: `1px solid ${C.borderLight}`, fontSize: 13 }, children: [_jsx("span", { style: { color: a.color, fontSize: 14 }, children: "\u26A0" }), _jsxs("strong", { style: { color: a.color, minWidth: 90 }, children: [a.label, ":"] }), _jsx("span", { style: { color: C.textMid }, children: a.action })] }, a.label))), _jsxs("div", { style: { display: "flex", gap: 10, marginTop: 16 }, children: [_jsx(BtnPrimary, { children: "Export Risk Report" }), _jsx(BtnOutline, { children: "Add to Board Pack" }), _jsx(BtnOutline, { children: "Set Alerts" })] })] })] }));
};
// ─── Tab: Decision Audit ──────────────────────────────────────────────────────
const DecisionAuditTab = () => {
    const decisions = [
        { date: "15 Mar", type: "💰 Investment", desc: "ERP System ₹2Cr", ai: "⚠️", cfo: "✅", conf: "76%", out: "pending" },
        { date: "10 Mar", type: "🌐 Outsource", desc: "Outsource AP Processing", ai: "⟳", cfo: "❌", conf: "65%", out: "pending" },
        { date: "5 Mar", type: "👥 Hire vs Auto", desc: "Hire 2 Sales Reps", ai: "📋", cfo: "✅", conf: "89%", out: "pending" },
        { date: "28 Feb", type: "✂️ Cost Cut", desc: "Cut Travel 50%", ai: "✅", cfo: "✅", conf: "84%", out: "correct" },
        { date: "15 Feb", type: "🏗️ Build vs Buy", desc: "Buy Anaplan vs Build", ai: "📋", cfo: "📋", conf: "71%", out: "correct" },
        { date: "1 Feb", type: "💰 Investment", desc: "Market expansion ₹50L", ai: "✅", cfo: "✅", conf: "82%", out: "correct" },
    ];
    return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 20 }, children: [_jsx("div", { style: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }, children: [
                    { label: "Total Decisions", val: "6", color: C.text, bg: C.white, sub: undefined },
                    { label: "AI Accuracy", val: "100%", sub: "3/3 tracked", color: C.green, bg: C.greenBg },
                    { label: "CFO Override Rate", val: "50%", sub: "3 decisions", color: C.blue, bg: C.bluePale },
                    { label: "Decisions Saved", val: "₹67L", sub: "in avoided bad investments", color: "#7C3AED", bg: "#F5F3FF" },
                ].map((s) => (_jsxs("div", { style: { background: s.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18 }, children: [_jsx("div", { style: { fontSize: 12, color: C.textSub, marginBottom: 4 }, children: s.label }), _jsx("div", { style: { fontSize: 26, fontWeight: 900, fontFamily: mono, color: s.color }, children: s.val }), s.sub && _jsx("div", { style: { fontSize: 11, color: C.textSub, marginTop: 2 }, children: s.sub })] }, s.label))) }), _jsxs(Card, { children: [_jsx(SectionTitle, { children: "Decision History" }), _jsxs("table", { style: { width: "100%", borderCollapse: "collapse" }, children: [_jsx("thead", { children: _jsx("tr", { style: { background: C.bg }, children: ["Date", "Type", "Decision", "AI Rec", "CFO", "Confidence", "Outcome"].map((h) => (_jsx("th", { style: { padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700,
                                            color: C.textSub, letterSpacing: "0.07em", textTransform: "uppercase",
                                            borderBottom: `1.5px solid ${C.border}` }, children: h }, h))) }) }), _jsx("tbody", { children: decisions.map((d, i) => (_jsxs("tr", { style: { background: i % 2 === 0 ? C.white : "#FAFBFC" }, children: [_jsx("td", { style: { padding: "12px 16px", fontSize: 12, color: C.textSub, borderBottom: `1px solid ${C.borderLight}` }, children: _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 5 }, children: ["\uD83D\uDCC5 ", d.date] }) }), _jsx("td", { style: { padding: "12px 16px", fontSize: 12, color: C.textMid, borderBottom: `1px solid ${C.borderLight}` }, children: d.type }), _jsx("td", { style: { padding: "12px 16px", fontSize: 13, fontWeight: 600, color: C.text, borderBottom: `1px solid ${C.borderLight}` }, children: d.desc }), _jsx("td", { style: { padding: "12px 16px", fontSize: 16, borderBottom: `1px solid ${C.borderLight}` }, children: d.ai }), _jsx("td", { style: { padding: "12px 16px", fontSize: 16, borderBottom: `1px solid ${C.borderLight}` }, children: d.cfo }), _jsx("td", { style: { padding: "12px 16px", borderBottom: `1px solid ${C.borderLight}` }, children: _jsx("span", { style: { fontSize: 13, fontWeight: 700, fontFamily: mono,
                                                    color: parseInt(d.conf) >= 80 ? C.green : parseInt(d.conf) >= 70 ? C.amber : C.red }, children: d.conf }) }), _jsx("td", { style: { padding: "12px 16px", borderBottom: `1px solid ${C.borderLight}` }, children: d.out === "correct"
                                                ? _jsx(Badge, { label: "AI Correct", color: "green" })
                                                : _jsx(Badge, { label: "Pending", color: "blue" }) })] }, d.date + d.desc))) })] })] }), _jsxs(Card, { children: [_jsx(SectionTitle, { children: "AI Learning Insights" }), _jsxs("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }, children: [_jsxs("div", { style: { background: C.bg, borderRadius: 8, padding: 16, border: `1px solid ${C.border}` }, children: [_jsx("div", { style: { fontSize: 11, color: C.textSub, marginBottom: 4 }, children: "Strongest Decision Type" }), _jsx("div", { style: { fontSize: 15, fontWeight: 800, color: C.green }, children: "Cost Cut vs Invest" }), _jsx("div", { style: { fontSize: 12, color: C.textSub, marginTop: 2 }, children: "95% accuracy on 20 decisions" })] }), _jsxs("div", { style: { background: C.amberBg, borderRadius: 8, padding: 16, border: `1px solid ${C.amberBorder}` }, children: [_jsx("div", { style: { fontSize: 11, color: C.textSub, marginBottom: 4 }, children: "Needs Improvement" }), _jsx("div", { style: { fontSize: 15, fontWeight: 800, color: C.amber }, children: "Build vs Buy" }), _jsx("div", { style: { fontSize: 12, color: C.textSub, marginTop: 2 }, children: "65% accuracy - adding more training data" })] })] }), _jsxs("div", { style: { marginTop: 14, padding: "10px 14px", background: C.bg, borderRadius: 7, fontSize: 12, color: C.textSub }, children: [_jsx("strong", { style: { color: C.textMid }, children: "AI Model Performance:" }), " The recommendation engine improves with every decision. Your feedback helps refine predictions for future strategic choices."] })] })] }));
};
// ─── Morning Brief Panel ──────────────────────────────────────────────────────
const MorningBriefPanel = ({ onClose }) => {
    const alerts = [
        { color: C.red, icon: "⚠️", title: "Cash runway drops to 2.8 months next week", decision: "Draw credit line OR cut costs immediately", impact: "₹85L monthly burn" },
        { color: C.amber, icon: "⚠", title: "ERP Project ROI dropped from 28% to 19%", decision: "Continue or pause implementation?", impact: "₹2Cr at risk" },
        { color: C.blue, icon: "ℹ", title: "Admin costs back on track this month", decision: "No action needed", impact: "Variance resolved" },
    ];
    return (_jsx("div", { style: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15,45,94,0.4)",
            display: "flex", alignItems: "flex-start", justifyContent: "flex-end", zIndex: 1000, padding: 20 }, children: _jsxs("div", { style: { width: 440, background: C.white, borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
                border: `1px solid ${C.border}`, overflow: "hidden" }, children: [_jsxs("div", { style: { background: C.navy, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: 14, fontWeight: 700, color: C.white }, children: "\uD83D\uDCC5 Morning Brief" }), _jsx("div", { style: { fontSize: 11, color: "#93C5FD", marginTop: 2 }, children: "Tuesday, 10 Mar \u00B7 AI-generated alerts" })] }), _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10 }, children: [_jsx("span", { style: { fontSize: 11, padding: "3px 8px", background: C.red, color: C.white, borderRadius: 10, fontWeight: 700 }, children: "2 need attention" }), _jsx("button", { onClick: onClose, style: { background: "none", border: "none", color: "#93C5FD", cursor: "pointer", fontSize: 18 }, children: "\u2715" })] })] }), _jsx("div", { style: { padding: 16, display: "flex", flexDirection: "column", gap: 12 }, children: alerts.map((a, i) => (_jsxs("div", { style: { borderLeft: `3px solid ${a.color}`, padding: "12px 14px",
                            background: i === 0 ? C.redBg : i === 1 ? C.amberBg : C.bluePale, borderRadius: "0 8px 8px 0" }, children: [_jsxs("div", { style: { fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }, children: [a.icon, " ", a.title] }), _jsxs("div", { style: { fontSize: 12, color: C.textMid }, children: [_jsx("strong", { children: "Decision:" }), " ", a.decision] }), _jsxs("div", { style: { fontSize: 12, color: C.textSub, marginTop: 2 }, children: [_jsx("strong", { children: "Impact:" }), " ", a.impact] })] }, i))) })] }) }));
};
// ─── Main App ─────────────────────────────────────────────────────────────────
const tabs = [
    { id: "investment", label: "Investment Decision", icon: "💰" },
    { id: "buildvsbuy", label: "Build vs Buy", icon: "🏗️", isNew: true },
    { id: "internalexternal", label: "Internal vs External", icon: "🌐", isNew: true },
    { id: "hirevsautomate", label: "Hire vs Automate", icon: "👥" },
    { id: "costcut", label: "Cost Cut vs Invest", icon: "✂️" },
    { id: "capital", label: "Capital Allocation", icon: "🏢" },
    { id: "risk", label: "Risk Dashboard", icon: "⚠️" },
    { id: "audit", label: "Decision Audit", icon: "📋" },
];
export default function CFODecisionIntelligencePage() {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState("investment");
    const [showBrief, setShowBrief] = useState(false);
    const renderTab = () => {
        switch (activeTab) {
            case "investment": return _jsx(InvestmentTab, {});
            case "buildvsbuy": return _jsx(BuildBuyTab, {});
            case "internalexternal": return _jsx(InternalExternalTab, {});
            case "hirevsautomate": return _jsx(HireAutomateTab, {});
            case "risk": return _jsx(RiskTab, {});
            case "audit": return _jsx(DecisionAuditTab, {});
            default:
                return (_jsxs(Card, { style: { textAlign: "center", padding: 60 }, children: [_jsx("div", { style: { fontSize: 40, marginBottom: 12 }, children: "\uD83C\uDFD7\uFE0F" }), _jsx("div", { style: { fontSize: 18, fontWeight: 700, color: C.text }, children: tabs.find(t => t.id === activeTab)?.label }), _jsx("div", { style: { fontSize: 13, color: C.textSub, marginTop: 6 }, children: "This module is coming soon." })] }));
        }
    };
    return (_jsxs("div", { style: { fontFamily: font, background: C.bg, minHeight: "100vh" }, children: [_jsx("style", { children: `@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=DM+Mono:wght@400;500;700&display=swap');*{box-sizing:border-box;margin:0;padding:0;}` }), showBrief && _jsx(MorningBriefPanel, { onClose: () => setShowBrief(false) }), _jsxs("div", { style: { background: `linear-gradient(135deg, ${C.navy} 0%, #1E3A8A 50%, #1D4ED8 100%)`,
                    padding: "0 24px", boxShadow: "0 2px 12px rgba(15,45,94,0.3)" }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 16, paddingBottom: 10 }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12 }, children: [_jsx("button", { onClick: () => navigate("/dashboard"), style: { background: "rgba(255,255,255,0.1)", border: "none", color: "#93C5FD",
                                            borderRadius: 6, width: 32, height: 32, cursor: "pointer", fontSize: 14 }, children: "\u2190" }), _jsx("div", { style: { width: 36, height: 36, borderRadius: 9, background: "rgba(255,255,255,0.15)",
                                            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }, children: "\uD83E\uDDE0" }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 18, fontWeight: 800, color: C.white, letterSpacing: "-0.02em" }, children: "CFO Decision Intelligence" }), _jsx("div", { style: { fontSize: 11, color: "#93C5FD" }, children: "Strategic decisions powered by Amazon Nova AI" })] })] }), _jsxs("div", { style: { display: "flex", gap: 10 }, children: [_jsx("button", { style: { background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)",
                                            color: C.white, borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600,
                                            cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }, children: "\u2B06 Upload Data" }), _jsxs("button", { onClick: () => setShowBrief(true), style: { background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)",
                                            color: C.white, borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600,
                                            cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }, children: ["\uD83D\uDCC5 Morning Brief", _jsx("span", { style: { background: C.red, color: C.white, fontSize: 10, fontWeight: 800,
                                                    borderRadius: 10, padding: "1px 6px" }, children: "2" })] })] })] }), _jsx("div", { style: { display: "flex", gap: 20, paddingBottom: 14, paddingTop: 4 }, children: [
                            { icon: "⚠️", text: "2 decisions need attention today", color: "#FCA5A5" },
                            { icon: "✅", text: "1 resolved automatically", color: "#86EFAC" },
                            { icon: "🤖", text: "78% AI accuracy · 6 total decisions", color: "#93C5FD" },
                        ].map((s) => (_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: s.color }, children: [_jsx("span", { children: s.icon }), " ", s.text] }, s.text))) }), _jsx("div", { style: { display: "flex", gap: 0, overflowX: "auto", scrollbarWidth: "none" }, children: tabs.map((tab) => {
                            const active = activeTab === tab.id;
                            return (_jsxs("button", { onClick: () => setActiveTab(tab.id), style: { padding: "10px 16px", whiteSpace: "nowrap", cursor: "pointer", border: "none",
                                    background: "transparent", borderBottom: active ? "2.5px solid #60A5FA" : "2.5px solid transparent",
                                    color: active ? C.white : "#93C5FD", fontSize: 13, fontWeight: active ? 700 : 500,
                                    fontFamily: font, display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s" }, children: [_jsx("span", { children: tab.icon }), tab.label, tab.isNew && (_jsx("span", { style: { fontSize: 9, fontWeight: 800, background: "#22C55E", color: C.white,
                                            padding: "1px 5px", borderRadius: 4, letterSpacing: "0.06em" }, children: "NEW" }))] }, tab.id));
                        }) })] }), _jsx("div", { style: { maxWidth: 1100, margin: "0 auto", padding: "24px 24px" }, children: renderTab() })] }));
}
