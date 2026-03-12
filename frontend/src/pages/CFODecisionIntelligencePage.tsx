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
const Badge = ({ label, color = "blue" }: { label: string; color?: "blue" | "green" | "red" | "amber" }) => {
  const map: Record<string, { bg: string; text: string; border: string }> = {
    blue: { bg: C.bluePale, text: C.blue, border: C.blueBorder },
    green: { bg: C.greenBg, text: C.green, border: C.greenBorder },
    red: { bg: C.redBg, text: C.red, border: C.redBorder },
    amber: { bg: C.amberBg, text: C.amber, border: C.amberBorder },
  };
  const s = map[color] || map.blue;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 5,
      background: s.bg, color: s.text, border: `1px solid ${s.border}`, letterSpacing: "0.06em", textTransform: "uppercase" }}>
      {label}
    </span>
  );
};

const Card = ({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12,
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)", padding: 24, ...style }}>
    {children}
  </div>
);

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 16, fontFamily: font }}>
    {children}
  </h3>
);

const Label = ({ children }: { children: React.ReactNode }) => (
  <label style={{ fontSize: 12, fontWeight: 500, color: C.blue, display: "block", marginBottom: 6, letterSpacing: "0.01em" }}>
    {children}
  </label>
);

const Input = ({ value, placeholder }: { value?: string; placeholder?: string }) => (
  <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", fontSize: 14,
    fontFamily: font, fontWeight: 400, color: C.text, background: C.white, lineHeight: 1.4 }}>
    {value || <span style={{ color: C.textMute }}>{placeholder}</span>}
  </div>
);

const Radio = ({ label, checked }: { label: string; checked: boolean }) => (
  <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: C.textMid, cursor: "pointer" }}>
    <div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${checked ? C.blue : "#D1D5DB"}`,
      background: checked ? C.blue : C.white, display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0, boxShadow: checked ? `0 0 0 3px ${C.bluePale}` : "none", transition: "all 0.15s" }}>
      {checked && <div style={{ width: 7, height: 7, borderRadius: "50%", background: C.white }} />}
    </div>
    {label}
  </label>
);

const BtnPrimary = ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
  <button onClick={onClick} style={{ background: C.blue, color: C.white, border: "none", borderRadius: 8,
    padding: "10px 22px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: font,
    display: "flex", alignItems: "center", gap: 6 }}>
    {children}
  </button>
);

const BtnOutline = ({ children, active, onClick }: { children: React.ReactNode; active?: boolean; onClick?: () => void }) => (
  <button onClick={onClick} style={{ background: active ? C.bluePale : C.white,
    color: active ? C.blue : C.textMid, border: `1.5px solid ${active ? C.blue : C.border}`,
    borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: font, flex: 1 }}>
    {children}
  </button>
);

const Divider = () => <div style={{ borderTop: `1px solid ${C.borderLight}`, margin: "16px 0" }} />;

const CheckIcon = ({ ok }: { ok: boolean | null }) => (
  <span style={{ fontSize: 14 }}>{ok === true ? "✅" : ok === false ? "❌" : "⚠️"}</span>
);

// ─── Nova prompt builder per decision type ───────────────────────────────────
type NovaDecisionType = "investment" | "buildvsbuy" | "internalexternal" | "hirevsautomate";
type NovaInputs = Record<string, string | number | undefined>;

function buildNovaPrompt(type: NovaDecisionType, inputs: NovaInputs = {}): string {
  const prompts: Record<NovaDecisionType, string> = {
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
async function callNova(type: NovaDecisionType, inputs: NovaInputs = {}): Promise<{
  decision: string;
  confidence: number;
  summary: string;
  factors: { label: string; detail: string; ok: boolean | null }[];
  action: string;
}> {
  const prompt = buildNovaPrompt(type, inputs);
  const API_URL = (typeof window !== "undefined" && (window as unknown as { FINREPORTAI_API_URL?: string }).FINREPORTAI_API_URL) || "http://localhost:8000";
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
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? `HTTP ${res.status}`);
  }

  const data = (await res.json()) as { text: string };
  const raw = data.text.replace(/```json|```/g, "").trim();
  return JSON.parse(raw) as { decision: string; confidence: number; summary: string; factors: { label: string; detail: string; ok: boolean | null }[]; action: string };
}

// ─── AI Recommendation Panel (real Nova calls) ────────────────────────────────
const AIPanel = ({ type = "investment", inputs = {} }: { type?: NovaDecisionType; inputs?: NovaInputs }) => {
  const [result, setResult] = useState<Awaited<ReturnType<typeof callNova>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await callNova(type as NovaDecisionType, inputs);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const decisionColor = !result ? C.blue
    : /APPROVE|BUILD|AUTOMATE|INTERNAL/.test(result.decision) ? C.green
    : /CONDITIONAL|HYBRID/.test(result.decision) ? C.amber
    : C.red;

  const decisionIcon = decisionColor === C.green ? "✅" : decisionColor === C.amber ? "⚠️" : "❌";

  return (
    <Card style={{ borderLeft: `4px solid ${loading ? C.blueLight : error ? C.red : result ? decisionColor : C.blue}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, display: "flex", alignItems: "center", gap: 6 }}>
            🤖 AI Recommendation
            <span style={{ fontWeight: 400, color: C.textSub, fontSize: 11 }}>Amazon Nova Lite · AWS Bedrock</span>
          </div>
          <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>Powered by generative AI — review before acting</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 22, fontWeight: 900, fontFamily: mono,
            color: result ? (result.confidence >= 75 ? C.green : result.confidence >= 50 ? C.amber : C.red) : C.textMute }}>
            {result ? `${result.confidence}%` : "—"}
          </div>
          <div style={{ fontSize: 10, color: C.textSub, letterSpacing: "0.06em" }}>CONFIDENCE</div>
        </div>
      </div>

      {!result && !loading && !error && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
          background: C.bluePale, borderRadius: 8, border: `1px solid ${C.blueBorder}` }}>
          <span style={{ fontSize: 22 }}>🤖</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.blue }}>Ready to analyse</div>
            <div style={{ fontSize: 11, color: C.textSub }}>Click Generate — Amazon Nova will analyse your inputs via AWS Bedrock</div>
          </div>
          <button onClick={handleGenerate} style={{ background: C.blue, color: C.white, border: "none",
            borderRadius: 7, padding: "8px 18px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font }}>
            Generate ▶
          </button>
        </div>
      )}

      {loading && (
        <div style={{ padding: "20px 16px", background: C.bluePale, borderRadius: 8,
          border: `1px solid ${C.blueBorder}`, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", gap: 5 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: C.blue,
                animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
            ))}
          </div>
          <span style={{ fontSize: 13, color: C.blue, fontWeight: 500 }}>Amazon Nova is analysing your inputs...</span>
          <style>{`@keyframes pulse{0%,100%{opacity:0.3;transform:scale(0.8)}50%{opacity:1;transform:scale(1.2)}}`}</style>
        </div>
      )}

      {error && !loading && (
        <div style={{ background: C.redBg, border: `1px solid ${C.redBorder}`, borderRadius: 8,
          padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.red, marginBottom: 3 }}>⚠️ Nova API Error</div>
            <div style={{ fontSize: 11, color: C.red }}>{error}</div>
            <div style={{ fontSize: 11, color: C.textSub, marginTop: 4 }}>
              Check <code style={{ background: "#FEE2E2", padding: "1px 4px", borderRadius: 3 }}>AWS_ACCESS_KEY_ID</code> and{" "}
              <code style={{ background: "#FEE2E2", padding: "1px 4px", borderRadius: 3 }}>AWS_SECRET_ACCESS_KEY</code> in your <code style={{ background: "#FEE2E2", padding: "1px 4px", borderRadius: 3 }}>.env</code>
            </div>
          </div>
          <button onClick={handleGenerate} style={{ background: C.red, color: C.white, border: "none",
            borderRadius: 7, padding: "8px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: font, whiteSpace: "nowrap" }}>
            Retry ↺
          </button>
        </div>
      )}

      {result && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 16px",
            background: decisionColor === C.green ? C.greenBg : decisionColor === C.amber ? C.amberBg : C.redBg,
            borderRadius: 8, border: `1px solid ${decisionColor === C.green ? C.greenBorder : decisionColor === C.amber ? C.amberBorder : C.redBorder}` }}>
            <span style={{ fontSize: 18, marginTop: 1 }}>{decisionIcon}</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: decisionColor, letterSpacing: "0.06em", marginBottom: 4 }}>
                {result.decision}
              </div>
              <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.6 }}>{result.summary}</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {(result.factors || []).map((f, i) => (
              <div key={i} style={{ padding: "10px 12px", borderRadius: 7,
                background: f.ok === true ? C.greenBg : f.ok === false ? C.redBg : C.amberBg,
                border: `1px solid ${f.ok === true ? C.greenBorder : f.ok === false ? C.redBorder : C.amberBorder}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                  <span style={{ fontSize: 12 }}>{f.ok === true ? "✅" : f.ok === false ? "❌" : "⚠️"}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.text }}>{f.label}</span>
                </div>
                <div style={{ fontSize: 11, color: C.textSub, lineHeight: 1.4 }}>{f.detail}</div>
              </div>
            ))}
          </div>

          <div style={{ padding: "10px 14px", background: C.bg, borderRadius: 7,
            border: `1px solid ${C.border}`, fontSize: 12 }}>
            <strong style={{ color: C.text }}>📋 Recommended Action: </strong>
            <span style={{ color: C.textMid }}>{result.action}</span>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: C.textMute }}>Generated by Amazon Nova Lite · AWS Bedrock · Not financial advice</span>
            <button onClick={handleGenerate} style={{ background: "none", border: "none",
              fontSize: 11, color: C.textSub, cursor: "pointer", textDecoration: "underline" }}>
              Re-generate ↺
            </button>
          </div>
        </div>
      )}
    </Card>
  );
};

// ─── CFO Decision Panel ──────────────────────────────────────────────────────
const CFODecisionPanel = ({ options = ["Approve", "Reject", "Hold"], onSave }: { options?: string[]; onSave?: () => void }) => {
  const [selected, setSelected] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  return (
    <Card>
      <SectionTitle>CFO Decision</SectionTitle>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        {options.map((o) => (
          <BtnOutline key={o} active={selected === o} onClick={() => setSelected(o)}>{o}</BtnOutline>
        ))}
      </div>
      <Label>CFO Notes (optional)</Label>
      <textarea
        placeholder="Add notes before saving..."
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 7, padding: "10px 12px",
          fontSize: 13, fontFamily: font, color: C.textMid, resize: "vertical", minHeight: 80,
          boxSizing: "border-box", outline: "none" }}
      />
      <div style={{ marginTop: 12 }}>
        <button onClick={onSave} style={{ width: "100%", background: C.blue, color: C.white,
          border: "none", borderRadius: 8, padding: "12px", fontSize: 13, fontWeight: 700,
          cursor: "pointer", fontFamily: font, letterSpacing: "0.02em" }}>
          💾 Save to Audit Trail
        </button>
      </div>
    </Card>
  );
};

// ─── Scorecard Table ─────────────────────────────────────────────────────────
const ScorecardRow = ({ label, leftVal, leftOk, rightVal, rightOk }: { label: string; leftVal: string; leftOk: boolean | null; rightVal: string; rightOk: boolean | null }) => (
  <tr>
    <td style={{ padding: "11px 16px", fontSize: 13, color: C.textMid, fontWeight: 500, borderBottom: `1px solid ${C.borderLight}` }}>{label}</td>
    <td style={{ padding: "11px 16px", borderBottom: `1px solid ${C.borderLight}` }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.textMid }}>
        <CheckIcon ok={leftOk} /> {leftVal}
      </span>
    </td>
    <td style={{ padding: "11px 16px", borderBottom: `1px solid ${C.borderLight}` }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.textMid }}>
        <CheckIcon ok={rightOk} /> {rightVal}
      </span>
    </td>
  </tr>
);

// ─── Tab: Investment Decision ─────────────────────────────────────────────────
const InvestmentTab = () => {
  const projects = [
    { name: "ERP System", inv: "₹2.00Cr", npv: "₹1.8L", npvPos: true, irr: "14.8%", payback: "4y", score: 72, ok: true },
    { name: "Sales Expansion", inv: "₹50.0L", npv: "₹8.2L", npvPos: true, irr: "28.3%", payback: "1.8y", score: 91, ok: true },
    { name: "New Office", inv: "₹1.50Cr", npv: "₹-3,20,000", npvPos: false, irr: "9.1%", payback: "6.5y", score: 38, ok: false },
    { name: "AI Platform", inv: "₹80.0L", npv: "₹5.1L", npvPos: true, irr: "21.4%", payback: "2.4y", score: 85, ok: true },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card>
        <SectionTitle>Investment Details</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 24px" }}>
          {[["Project Name", "New ERP System"], ["Total Investment (₹)", "20000000"],
            ["Annual Returns (₹)", "5000000"], ["Project Life (years)", "5"],
            ["Discount Rate (%) — auto from WACC", "12"], ["Current Cash Position (₹)", "25000000"]].map(([l, v]) => (
            <div key={l}>
              <Label>{l}</Label>
              <Input value={v} />
            </div>
          ))}
          <div>
            <Label>Risk Level</Label>
            <div style={{ display: "flex", gap: 16, paddingTop: 4 }}>
              <Radio label="Low" checked={false} /><Radio label="Medium" checked={true} /><Radio label="High" checked={false} />
            </div>
          </div>
          <div>
            <Label>Strategic Value</Label>
            <div style={{ display: "flex", gap: 16, paddingTop: 4 }}>
              <Radio label="Low" checked={false} /><Radio label="Medium" checked={true} /><Radio label="High" checked={false} />
            </div>
          </div>
        </div>
        <div style={{ marginTop: 20 }}>
          <BtnPrimary>Calculate &amp; Decide ▶</BtnPrimary>
        </div>
      </Card>

      <Card>
        <SectionTitle>Compare Multiple Projects</SectionTitle>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: C.bg }}>
              {["Project", "Investment", "NPV", "IRR", "Payback", "Score", "Decision"].map((h) => (
                <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700,
                  color: C.textSub, letterSpacing: "0.07em", textTransform: "uppercase",
                  borderBottom: `1.5px solid ${C.border}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {projects.map((p, i) => (
              <tr key={p.name} style={{ background: i % 2 === 0 ? C.white : "#FAFBFC" }}>
                <td style={{ padding: "12px 16px", fontWeight: 600, fontSize: 13, color: C.text, borderBottom: `1px solid ${C.borderLight}` }}>{p.name}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: C.textMid, borderBottom: `1px solid ${C.borderLight}` }}>{p.inv}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, fontFamily: mono, fontWeight: 500,
                  color: p.npvPos ? C.green : C.red, borderBottom: `1px solid ${C.borderLight}` }}>{p.npv}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: C.textMid, borderBottom: `1px solid ${C.borderLight}` }}>{p.irr}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: C.textMid, borderBottom: `1px solid ${C.borderLight}` }}>{p.payback}</td>
                <td style={{ padding: "12px 16px", borderBottom: `1px solid ${C.borderLight}` }}>
                  <span style={{ fontSize: 14, fontWeight: 800, fontFamily: mono, color: C.text }}>{p.score}</span>
                </td>
                <td style={{ padding: "12px 16px", borderBottom: `1px solid ${C.borderLight}` }}>
                  <span style={{ fontSize: 16 }}>{p.ok ? "✅" : "❌"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 14, padding: "10px 16px", background: C.bluePale, borderRadius: 7,
          fontSize: 12, fontWeight: 600, color: C.blue, border: `1px solid ${C.blueBorder}` }}>
          🤖 AI RANKING: Sales Expansion &gt; AI Platform &gt; ERP System &gt; New Office
        </div>
      </Card>

      <AIPanel type="investment" />
      <CFODecisionPanel options={["Approve", "Reject", "Hold"]} />
    </div>
  );
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
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card>
        <SectionTitle>Requirements</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <Label>What we need</Label><Input value="FP&A Planning Software" />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <Label>Core requirement</Label><Input value="Budget, Forecast, Reporting" />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 20 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, letterSpacing: "0.08em",
              marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
              🏗️ BUILD OPTION
            </div>
            {[["Development cost (₹)", "5000000"], ["Build timeline (months)", "12"],
              ["Team needed (developers)", "5"], ["Annual maintenance (₹)", "1500000"]].map(([l, v]) => (
              <div key={l} style={{ marginBottom: 12 }}><Label>{l}</Label><Input value={v} /></div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.green, letterSpacing: "0.08em",
              marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
              💰 BUY OPTION
            </div>
            {[["Vendor name", "Anaplan / Workday / Other"], ["License cost (₹/year)", "8000000"],
              ["Implementation (₹, one-time)", "3000000"], ["Go-live (months)", "3"]].map(([l, v]) => (
              <div key={l} style={{ marginBottom: 12 }}><Label>{l}</Label><Input value={v} /></div>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle>5-Year Cost Comparison</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, marginBottom: 12, letterSpacing: "0.08em" }}>BUILD:</div>
            {[["Development:", "₹50.0L"], ["Maintenance (5yr):", "₹75.0L"], ["Team cost (5yr):", "₹3.0Cr"], ["Opportunity:", "₹30.0L"]].map(([l, v]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0",
                borderBottom: `1px solid ${C.borderLight}`, fontSize: 13 }}>
                <span style={{ color: C.textMid }}>{l}</span>
                <span style={{ fontFamily: mono, fontWeight: 400, color: C.textMid }}>{v}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 14, fontWeight: 800 }}>
              <span style={{ color: C.text }}>TOTAL:</span>
              <span style={{ color: C.blue, fontFamily: mono }}>₹4.5Cr</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.green, marginBottom: 12, letterSpacing: "0.08em" }}>BUY:</div>
            {[["License (5yr):", "₹4.0Cr"], ["Implementation:", "₹30.0L"], ["Customization:", "₹20.0L"], ["Support:", "₹25.0L"]].map(([l, v]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0",
                borderBottom: `1px solid ${C.borderLight}`, fontSize: 13 }}>
                <span style={{ color: C.textMid }}>{l}</span>
                <span style={{ fontFamily: mono, fontWeight: 400, color: C.textMid }}>{v}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 14, fontWeight: 800 }}>
              <span style={{ color: C.text }}>TOTAL:</span>
              <span style={{ color: C.green, fontFamily: mono }}>₹4.8Cr</span>
            </div>
          </div>
        </div>
        <div style={{ textAlign: "center", marginTop: 12, padding: "10px", background: C.greenBg,
          borderRadius: 7, border: `1px solid ${C.greenBorder}`, fontSize: 13, fontWeight: 700, color: C.green }}>
          BUILD CHEAPER BY ₹20.0L over 5 years
        </div>
      </Card>

      <Card>
        <SectionTitle>Scorecard</SectionTitle>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: C.bg }}>
              <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700,
                color: C.textSub, letterSpacing: "0.07em", textTransform: "uppercase",
                borderBottom: `1.5px solid ${C.border}`, width: "35%" }}>Criterion</th>
              <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700,
                color: C.blue, letterSpacing: "0.07em", textTransform: "uppercase",
                borderBottom: `1.5px solid ${C.border}` }}>🏗️ Build</th>
              <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700,
                color: C.green, letterSpacing: "0.07em", textTransform: "uppercase",
                borderBottom: `1.5px solid ${C.border}` }}>💰 Buy</th>
            </tr>
          </thead>
          <tbody>
            {scorecard.map((r) => <ScorecardRow key={r.label} label={r.label} leftVal={r.lv} leftOk={r.lo} rightVal={r.rv} rightOk={r.ro} />)}
          </tbody>
        </table>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 16px 4px",
          borderTop: `2px solid ${C.border}` }}>
          <div><span style={{ fontSize: 12, fontWeight: 600, color: C.textSub }}>BUILD SCORE: </span>
            <span style={{ fontSize: 22, fontWeight: 900, color: C.blue, fontFamily: mono }}>95/100</span></div>
          <div><span style={{ fontSize: 12, fontWeight: 600, color: C.textSub }}>BUY SCORE: </span>
            <span style={{ fontSize: 22, fontWeight: 900, color: C.amber, fontFamily: mono }}>55/100</span></div>
        </div>
      </Card>

      <AIPanel type="buildvsbuy" />
      <CFODecisionPanel options={["Approve Build", "Approve Buy", "Hybrid Model", "Request POC"]} />
    </div>
  );
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
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card>
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {["AP Processing", "Payroll", "IT Support", "Tax Filing", "Internal Audit", "Treasury", "Legal"].map((t) => (
            <span key={t} style={{ padding: "5px 12px", borderRadius: 20, border: `1px solid ${C.border}`,
              fontSize: 12, fontWeight: 600, color: C.textMid, cursor: "pointer", background: C.white }}>{t}</span>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, marginBottom: 12, letterSpacing: "0.08em" }}>🏢 INTERNAL OPTION</div>
            {[["Current team (people)", "5"], ["Avg cost/person (₹/year)", "800000"],
              ["Current time (days for close cycle)", "5"], ["Error rate (%)", "2.3"]].map(([l, v]) => (
              <div key={l} style={{ marginBottom: 12 }}><Label>{l}</Label><Input value={v} /></div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.green, marginBottom: 12, letterSpacing: "0.08em" }}>🌐 EXTERNAL / OUTSOURCE</div>
            {[["Vendor", "EXL / WNS / Genpact"], ["Monthly cost (₹)", "400000"],
              ["SLA committed (days)", "3"], ["Error rate SLA (%)", "0.5"]].map(([l, v]) => (
              <div key={l} style={{ marginBottom: 12 }}><Label>{l}</Label><Input value={v} /></div>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle>Cost Analysis</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, marginBottom: 12, letterSpacing: "0.08em" }}>INTERNAL:</div>
            {[["Team cost:", "₹40.0L/year"], ["Training:", "₹2.0L/year"], ["Tools:", "₹3L/year"], ["Management:", "₹5L/year"]].map(([l, v]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0",
                borderBottom: `1px solid ${C.borderLight}`, fontSize: 13 }}>
                <span style={{ color: C.textMid }}>{l}</span>
                <span style={{ fontFamily: mono, color: C.textMid }}>{v}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0" }}>
              <span style={{ fontWeight: 700, color: C.text }}>Total:</span>
              <span style={{ fontFamily: mono, fontWeight: 800, color: C.blue }}>₹42.0L/year</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.green, marginBottom: 12, letterSpacing: "0.08em" }}>EXTERNAL:</div>
            {[["Monthly:", "₹48.0L/year"], ["Setup:", "₹5L one-time"]].map(([l, v]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0",
                borderBottom: `1px solid ${C.borderLight}`, fontSize: 13 }}>
                <span style={{ color: C.textMid }}>{l}</span>
                <span style={{ fontFamily: mono, color: C.textMid }}>{v}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0" }}>
              <span style={{ fontWeight: 700, color: C.text }}>Total:</span>
              <span style={{ fontFamily: mono, fontWeight: 800, color: C.green }}>₹48.0L/year</span>
            </div>
            <div style={{ fontSize: 12, color: C.red, fontWeight: 600 }}>+14% more expensive</div>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle>Quality Scorecard</SectionTitle>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: C.bg }}>
              {["Criterion", "🏢 Internal", "🌐 External"].map((h, i) => (
                <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700,
                  color: i === 0 ? C.textSub : i === 1 ? C.blue : C.green, letterSpacing: "0.07em",
                  textTransform: "uppercase", borderBottom: `1.5px solid ${C.border}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scorecard.map((r) => <ScorecardRow key={r.label} label={r.label} leftVal={r.lv} leftOk={r.lo} rightVal={r.rv} rightOk={r.ro} />)}
          </tbody>
        </table>
      </Card>

      <AIPanel type="internalexternal" />
      <CFODecisionPanel options={["Go Internal", "Outsource", "Hybrid Model", "Hold"]} />
    </div>
  );
};

// ─── Tab: Hire vs Automate ────────────────────────────────────────────────────
const HireAutomateTab = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
    <Card>
      <SectionTitle>Process Details</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 24px" }}>
        <div style={{ gridColumn: "1 / -1" }}><Label>Process</Label><Input value="Invoice Processing" /></div>
        {[["Current team (people)", "3"], ["Monthly volume", "500"],
          ["Hours per unit", "0.5"], ["Additional needed (people)", "2"],
          ["Avg salary (₹/year)", "600000"], ["Automation tool/vendor", "FinReportAI AP Module"],
          ["Setup cost (₹)", "800000"], ["Monthly cost (₹)", "25000"]].map(([l, v]) => (
          <div key={l}><Label>{l}</Label><Input value={v} /></div>
        ))}
        <div>
          <Label>Automation % of volume</Label>
          <Input value="80" />
        </div>
      </div>
      <div style={{ marginTop: 20 }}><BtnPrimary>Analyze ▶</BtnPrimary></div>
    </Card>

    <Card>
      <SectionTitle>Financial Analysis</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, marginBottom: 12, letterSpacing: "0.08em" }}>HIRE: 2 people</div>
          <div style={{ fontSize: 28, fontWeight: 900, fontFamily: mono, color: C.text }}>₹12.0L<span style={{ fontSize: 14, fontWeight: 600 }}>/year</span></div>
          <div style={{ fontSize: 12, color: C.textSub, marginTop: 4 }}>Break-even: Never (recurring cost)</div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.green, marginBottom: 12, letterSpacing: "0.08em" }}>AUTOMATE</div>
          {[["₹11.0L", "Year 1"], ["₹3.0L", "Year 2+"]].map(([a, l]) => (
            <div key={l} style={{ fontSize: 14, fontFamily: mono, color: C.textMid, marginBottom: 4 }}>
              <strong style={{ color: C.text }}>{a}</strong> {l}
            </div>
          ))}
          <div style={{ fontSize: 12, fontWeight: 700, color: C.green, marginTop: 6 }}>Break-even: 11 months</div>
        </div>
      </div>
      <Divider />
      <div style={{ textAlign: "center", fontSize: 15, fontWeight: 800, color: C.green }}>
        5-year saving from automation: ₹37.0L
      </div>
    </Card>

    <AIPanel type="hirevsautomate" />
    <CFODecisionPanel options={["Hire", "Automate", "Hybrid", "Hold"]} />
  </div>
);

// ─── Tab: Risk Dashboard ──────────────────────────────────────────────────────
const RiskTab = () => {
  const risks = [
    { icon: "💧", name: "Liquidity", sub: "Draw ₹2Cr credit line by week 2", score: 7.2, level: "HIGH" as const, action: "URGENT" as const, trend: "↗" },
    { icon: "💳", name: "Credit", sub: "Monitor DSO - currently 45 days", score: 4.1, level: "MEDIUM" as const, action: "Watch" as const, trend: "—" },
    { icon: "⚙️", name: "Operational", sub: "None required - on track", score: 3.2, level: "LOW" as const, action: "OK" as const, trend: "↘" },
    { icon: "📈", name: "Market", sub: "Diversify customer base - reduce top-3 dependency", score: 5.8, level: "MEDIUM" as const, action: "Watch" as const, trend: "↗" },
    { icon: "📋", name: "Compliance", sub: "None required - all audits passed", score: 2.1, level: "LOW" as const, action: "OK" as const, trend: "—" },
    { icon: "💱", name: "FX", sub: "Hedge 50% export receivables (₹1.8Cr)", score: 6.4, level: "HIGH" as const, action: "URGENT" as const, trend: "↗" },
    { icon: "🏢", name: "Concentration", sub: "Win 2 new enterprise clients this quarter", score: 5.1, level: "MEDIUM" as const, action: "Watch" as const, trend: "—" },
  ];
  const levelColor: Record<string, string> = { HIGH: C.red, MEDIUM: C.amber, LOW: C.green };
  const actionBg: Record<string, string> = { URGENT: C.redBg, Watch: C.amberBg, OK: C.greenBg };
  const actionBorder: Record<string, string> = { URGENT: C.redBorder, Watch: C.amberBorder, OK: C.greenBorder };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card style={{ borderLeft: `4px solid ${C.red}`, background: C.redBg }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.red }}>⚠️ MEDIUM-HIGH — Deteriorating</div>
            <div style={{ fontSize: 12, color: C.textSub, marginTop: 2 }}>Overall Risk Score</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <span style={{ fontSize: 40, fontWeight: 900, fontFamily: mono, color: C.red }}>6.1</span>
            <span style={{ fontSize: 18, color: C.textSub }}>/10</span>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle>Risk Categories</SectionTitle>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: C.bg }}>
              {["Risk Area", "Action Required", "Score", "Level", "Status"].map((h) => (
                <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700,
                  color: C.textSub, letterSpacing: "0.07em", textTransform: "uppercase",
                  borderBottom: `1.5px solid ${C.border}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {risks.map((r, i) => (
              <tr key={r.name} style={{ background: i % 2 === 0 ? C.white : "#FAFBFC" }}>
                <td style={{ padding: "13px 16px", borderBottom: `1px solid ${C.borderLight}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 18 }}>{r.icon}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{r.name}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: "13px 16px", fontSize: 12, color: C.textMid, borderBottom: `1px solid ${C.borderLight}`, maxWidth: 280 }}>{r.sub}</td>
                <td style={{ padding: "13px 16px", borderBottom: `1px solid ${C.borderLight}` }}>
                  <span style={{ fontSize: 16, fontWeight: 800, fontFamily: mono, color: levelColor[r.level] }}>{r.score}/10</span>
                  <span style={{ marginLeft: 4, fontSize: 12, color: r.trend === "↗" ? C.red : r.trend === "↘" ? C.green : C.textMute }}>{r.trend}</span>
                </td>
                <td style={{ padding: "13px 16px", borderBottom: `1px solid ${C.borderLight}` }}>
                  <span style={{ padding: "3px 10px", borderRadius: 5, fontSize: 11, fontWeight: 700,
                    color: levelColor[r.level], background: actionBg[r.action], border: `1px solid ${actionBorder[r.action]}` }}>
                    {r.level}
                  </span>
                </td>
                <td style={{ padding: "13px 16px", borderBottom: `1px solid ${C.borderLight}` }}>
                  <Badge label={r.action} color={r.action === "URGENT" ? "red" : r.action === "Watch" ? "amber" : "green"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card style={{ borderLeft: `4px solid ${C.blue}` }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>🤖 AI Risk Actions (Amazon Nova)</div>
        {[
          { color: C.red, label: "Liquidity", action: "Draw ₹2Cr credit line by week 2" },
          { color: C.red, label: "FX", action: "Hedge 50% export receivables (₹1.8Cr)" },
          { color: C.amber, label: "Credit", action: "Monitor DSO - currently 45 days" },
          { color: C.amber, label: "Market", action: "Diversify customer base - reduce top-3 dependency" },
          { color: C.amber, label: "Concentration", action: "Win 2 new enterprise clients this quarter" },
        ].map((a) => (
          <div key={a.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
            borderBottom: `1px solid ${C.borderLight}`, fontSize: 13 }}>
            <span style={{ color: a.color, fontSize: 14 }}>⚠</span>
            <strong style={{ color: a.color, minWidth: 90 }}>{a.label}:</strong>
            <span style={{ color: C.textMid }}>{a.action}</span>
          </div>
        ))}
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <BtnPrimary>Export Risk Report</BtnPrimary>
          <BtnOutline>Add to Board Pack</BtnOutline>
          <BtnOutline>Set Alerts</BtnOutline>
        </div>
      </Card>
    </div>
  );
};

// ─── Tab: Decision Audit ──────────────────────────────────────────────────────
const DecisionAuditTab = () => {
  const decisions = [
    { date: "15 Mar", type: "💰 Investment", desc: "ERP System ₹2Cr", ai: "⚠️", cfo: "✅", conf: "76%", out: "pending" as const },
    { date: "10 Mar", type: "🌐 Outsource", desc: "Outsource AP Processing", ai: "⟳", cfo: "❌", conf: "65%", out: "pending" as const },
    { date: "5 Mar", type: "👥 Hire vs Auto", desc: "Hire 2 Sales Reps", ai: "📋", cfo: "✅", conf: "89%", out: "pending" as const },
    { date: "28 Feb", type: "✂️ Cost Cut", desc: "Cut Travel 50%", ai: "✅", cfo: "✅", conf: "84%", out: "correct" as const },
    { date: "15 Feb", type: "🏗️ Build vs Buy", desc: "Buy Anaplan vs Build", ai: "📋", cfo: "📋", conf: "71%", out: "correct" as const },
    { date: "1 Feb", type: "💰 Investment", desc: "Market expansion ₹50L", ai: "✅", cfo: "✅", conf: "82%", out: "correct" as const },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {[
          { label: "Total Decisions", val: "6", color: C.text, bg: C.white, sub: undefined },
          { label: "AI Accuracy", val: "100%", sub: "3/3 tracked", color: C.green, bg: C.greenBg },
          { label: "CFO Override Rate", val: "50%", sub: "3 decisions", color: C.blue, bg: C.bluePale },
          { label: "Decisions Saved", val: "₹67L", sub: "in avoided bad investments", color: "#7C3AED", bg: "#F5F3FF" },
        ].map((s) => (
          <div key={s.label} style={{ background: s.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18 }}>
            <div style={{ fontSize: 12, color: C.textSub, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 26, fontWeight: 900, fontFamily: mono, color: s.color }}>{s.val}</div>
            {s.sub && <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>{s.sub}</div>}
          </div>
        ))}
      </div>

      <Card>
        <SectionTitle>Decision History</SectionTitle>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: C.bg }}>
              {["Date", "Type", "Decision", "AI Rec", "CFO", "Confidence", "Outcome"].map((h) => (
                <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700,
                  color: C.textSub, letterSpacing: "0.07em", textTransform: "uppercase",
                  borderBottom: `1.5px solid ${C.border}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {decisions.map((d, i) => (
              <tr key={d.date + d.desc} style={{ background: i % 2 === 0 ? C.white : "#FAFBFC" }}>
                <td style={{ padding: "12px 16px", fontSize: 12, color: C.textSub, borderBottom: `1px solid ${C.borderLight}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>📅 {d.date}</div>
                </td>
                <td style={{ padding: "12px 16px", fontSize: 12, color: C.textMid, borderBottom: `1px solid ${C.borderLight}` }}>{d.type}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 600, color: C.text, borderBottom: `1px solid ${C.borderLight}` }}>{d.desc}</td>
                <td style={{ padding: "12px 16px", fontSize: 16, borderBottom: `1px solid ${C.borderLight}` }}>{d.ai}</td>
                <td style={{ padding: "12px 16px", fontSize: 16, borderBottom: `1px solid ${C.borderLight}` }}>{d.cfo}</td>
                <td style={{ padding: "12px 16px", borderBottom: `1px solid ${C.borderLight}` }}>
                  <span style={{ fontSize: 13, fontWeight: 700, fontFamily: mono,
                    color: parseInt(d.conf) >= 80 ? C.green : parseInt(d.conf) >= 70 ? C.amber : C.red }}>{d.conf}</span>
                </td>
                <td style={{ padding: "12px 16px", borderBottom: `1px solid ${C.borderLight}` }}>
                  {d.out === "correct"
                    ? <Badge label="AI Correct" color="green" />
                    : <Badge label="Pending" color="blue" />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <SectionTitle>AI Learning Insights</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ background: C.bg, borderRadius: 8, padding: 16, border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 11, color: C.textSub, marginBottom: 4 }}>Strongest Decision Type</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.green }}>Cost Cut vs Invest</div>
            <div style={{ fontSize: 12, color: C.textSub, marginTop: 2 }}>95% accuracy on 20 decisions</div>
          </div>
          <div style={{ background: C.amberBg, borderRadius: 8, padding: 16, border: `1px solid ${C.amberBorder}` }}>
            <div style={{ fontSize: 11, color: C.textSub, marginBottom: 4 }}>Needs Improvement</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.amber }}>Build vs Buy</div>
            <div style={{ fontSize: 12, color: C.textSub, marginTop: 2 }}>65% accuracy - adding more training data</div>
          </div>
        </div>
        <div style={{ marginTop: 14, padding: "10px 14px", background: C.bg, borderRadius: 7, fontSize: 12, color: C.textSub }}>
          <strong style={{ color: C.textMid }}>AI Model Performance:</strong> The recommendation engine improves with every decision. Your feedback helps refine predictions for future strategic choices.
        </div>
      </Card>
    </div>
  );
};

// ─── Morning Brief Panel ──────────────────────────────────────────────────────
const MorningBriefPanel = ({ onClose }: { onClose: () => void }) => {
  const alerts = [
    { color: C.red, icon: "⚠️", title: "Cash runway drops to 2.8 months next week", decision: "Draw credit line OR cut costs immediately", impact: "₹85L monthly burn" },
    { color: C.amber, icon: "⚠", title: "ERP Project ROI dropped from 28% to 19%", decision: "Continue or pause implementation?", impact: "₹2Cr at risk" },
    { color: C.blue, icon: "ℹ", title: "Admin costs back on track this month", decision: "No action needed", impact: "Variance resolved" },
  ];
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15,45,94,0.4)",
      display: "flex", alignItems: "flex-start", justifyContent: "flex-end", zIndex: 1000, padding: 20 }}>
      <div style={{ width: 440, background: C.white, borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        border: `1px solid ${C.border}`, overflow: "hidden" }}>
        <div style={{ background: C.navy, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.white }}>📅 Morning Brief</div>
            <div style={{ fontSize: 11, color: "#93C5FD", marginTop: 2 }}>Tuesday, 10 Mar · AI-generated alerts</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, padding: "3px 8px", background: C.red, color: C.white, borderRadius: 10, fontWeight: 700 }}>2 need attention</span>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "#93C5FD", cursor: "pointer", fontSize: 18 }}>✕</button>
          </div>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {alerts.map((a, i) => (
            <div key={i} style={{ borderLeft: `3px solid ${a.color}`, padding: "12px 14px",
              background: i === 0 ? C.redBg : i === 1 ? C.amberBg : C.bluePale, borderRadius: "0 8px 8px 0" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>{a.icon} {a.title}</div>
              <div style={{ fontSize: 12, color: C.textMid }}><strong>Decision:</strong> {a.decision}</div>
              <div style={{ fontSize: 12, color: C.textSub, marginTop: 2 }}><strong>Impact:</strong> {a.impact}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
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
      case "investment": return <InvestmentTab />;
      case "buildvsbuy": return <BuildBuyTab />;
      case "internalexternal": return <InternalExternalTab />;
      case "hirevsautomate": return <HireAutomateTab />;
      case "risk": return <RiskTab />;
      case "audit": return <DecisionAuditTab />;
      default:
        return (
          <Card style={{ textAlign: "center", padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🏗️</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{tabs.find(t => t.id === activeTab)?.label}</div>
            <div style={{ fontSize: 13, color: C.textSub, marginTop: 6 }}>This module is coming soon.</div>
          </Card>
        );
    }
  };

  return (
    <div style={{ fontFamily: font, background: C.bg, minHeight: "100vh" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=DM+Mono:wght@400;500;700&display=swap');*{box-sizing:border-box;margin:0;padding:0;}`}</style>

      {showBrief && <MorningBriefPanel onClose={() => setShowBrief(false)} />}

      {/* Header */}
      <div style={{ background: `linear-gradient(135deg, ${C.navy} 0%, #1E3A8A 50%, #1D4ED8 100%)`,
        padding: "0 24px", boxShadow: "0 2px 12px rgba(15,45,94,0.3)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 16, paddingBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={() => navigate("/dashboard")}
              style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#93C5FD",
                borderRadius: 6, width: 32, height: 32, cursor: "pointer", fontSize: 14 }}
            >
              ←
            </button>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: "rgba(255,255,255,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🧠</div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.white, letterSpacing: "-0.02em" }}>
                CFO Decision Intelligence
              </div>
              <div style={{ fontSize: 11, color: "#93C5FD" }}>Strategic decisions powered by Amazon Nova AI</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)",
              color: C.white, borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600,
              cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              ⬆ Upload Data
            </button>
            <button onClick={() => setShowBrief(true)}
              style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)",
                color: C.white, borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600,
                cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              📅 Morning Brief
              <span style={{ background: C.red, color: C.white, fontSize: 10, fontWeight: 800,
                borderRadius: 10, padding: "1px 6px" }}>2</span>
            </button>
          </div>
        </div>

        {/* Status Bar */}
        <div style={{ display: "flex", gap: 20, paddingBottom: 14, paddingTop: 4 }}>
          {[
            { icon: "⚠️", text: "2 decisions need attention today", color: "#FCA5A5" },
            { icon: "✅", text: "1 resolved automatically", color: "#86EFAC" },
            { icon: "🤖", text: "78% AI accuracy · 6 total decisions", color: "#93C5FD" },
          ].map((s) => (
            <div key={s.text} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: s.color }}>
              <span>{s.icon}</span> {s.text}
            </div>
          ))}
        </div>

        {/* Tab Nav */}
        <div style={{ display: "flex", gap: 0, overflowX: "auto", scrollbarWidth: "none" }}>
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                style={{ padding: "10px 16px", whiteSpace: "nowrap", cursor: "pointer", border: "none",
                  background: "transparent", borderBottom: active ? "2.5px solid #60A5FA" : "2.5px solid transparent",
                  color: active ? C.white : "#93C5FD", fontSize: 13, fontWeight: active ? 700 : 500,
                  fontFamily: font, display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s" }}>
                <span>{tab.icon}</span>
                {tab.label}
                {tab.isNew && (
                  <span style={{ fontSize: 9, fontWeight: 800, background: "#22C55E", color: C.white,
                    padding: "1px 5px", borderRadius: 4, letterSpacing: "0.06em" }}>NEW</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 24px" }}>
        {renderTab()}
      </div>
    </div>
  );
}
