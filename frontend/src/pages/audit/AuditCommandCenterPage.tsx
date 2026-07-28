import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, ShieldCheck, Copy, Download } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { getStoredWorkspaceId } from '../../services/workspaceService';
import { getStoredAccessToken } from '../../utils/authToken';

const API = import.meta.env.VITE_API_URL || '';

function currentQuarter(): string {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

type ScoreResult = {
  composite_score: number;
  composite_risk: RiskLevel;
  je_score: number;
  je_risk: RiskLevel;
  je_flags: string[];
  ap_score: number;
  ap_risk: RiskLevel;
  ap_flags: string[];
  vat_score: number;
  vat_risk: RiskLevel;
  vat_flags: string[];
  last_run: string;
  period?: string;
  company_name?: string;
  going_concern_warning?: boolean | null;
  going_concern_level?: 'none' | 'low' | 'medium' | 'high' | null;
};

const RISK_COLOR: Record<RiskLevel, string> = {
  low: 'text-green-600 border-green-600/40 bg-green-600/10',
  medium: 'text-amber-500 border-amber-500/40 bg-amber-500/10',
  high: 'text-orange-500 border-orange-500/40 bg-orange-500/10',
  critical: 'text-red-600 border-red-600/40 bg-red-600/10',
};

const RISK_TEXT: Record<RiskLevel, string> = {
  low: 'text-green-600',
  medium: 'text-amber-500',
  high: 'text-orange-500',
  critical: 'text-red-600',
};

function headers(workspaceId: string, companyId: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (workspaceId) h['X-Workspace-Id'] = workspaceId;
  if (companyId) h['X-Company-Id'] = companyId;
  const token = getStoredAccessToken();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function postJson<T>(path: string, body: Record<string, unknown>, workspaceId: string, companyId: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: headers(workspaceId, companyId),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === 'string' ? err.detail : `API error ${res.status}`);
  }
  return res.json();
}

function RiskBadge({ risk }: { risk: RiskLevel }) {
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${RISK_COLOR[risk]}`}>
      {risk}
    </span>
  );
}

function LayerCard({
  title,
  score,
  risk,
  flags,
  detailTo,
}: {
  title: string;
  score: number;
  risk: RiskLevel;
  flags: string[];
  detailTo: string;
}) {
  return (
    <div className={`rounded-xl border p-5 bg-white/[0.02] ${RISK_COLOR[risk].split(' ').filter(c => c.startsWith('border')).join(' ')}`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <RiskBadge risk={risk} />
      </div>
      <div className={`text-4xl font-black ${RISK_TEXT[risk]}`}>{Number(score).toFixed(0)}</div>
      <ul className="mt-4 space-y-1.5 min-h-[4.5rem]">
        {(flags || []).slice(0, 3).map((f, i) => (
          <li key={i} className="text-xs text-gray-400 leading-snug list-disc ml-4">
            {f}
          </li>
        ))}
        {(flags || []).length === 0 && <li className="text-xs text-gray-600 ml-4">No flags</li>}
      </ul>
      <Link to={detailTo} className="inline-block mt-4 text-xs text-teal-400 hover:text-teal-300 underline">
        View Details →
      </Link>
    </div>
  );
}

export default function AuditCommandCenterPage() {
  const { activeCompany, activeCompanyId } = useCompany();
  const { activeWorkspace } = useWorkspace();
  const workspaceId =
    localStorage.getItem('active_workspace_id') ||
    getStoredWorkspaceId() ||
    activeWorkspace?.id ||
    '';

  const [period, setPeriod] = useState(currentQuarter());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [narrative, setNarrative] = useState<string | null>(null);
  const [narrativeAt, setNarrativeAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const runFullAudit = useCallback(async () => {
    if (!activeCompanyId || !workspaceId) {
      setError('Select a company and workspace first');
      return;
    }
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const scoreRes = await postJson<ScoreResult>(
        '/api/audit/command-center/score',
        { period, workspace_id: workspaceId, company_id: activeCompanyId },
        workspaceId,
        activeCompanyId,
      );
      setScore(scoreRes);

      const narr = await postJson<{ narrative: string; generated_at: string }>(
        '/api/audit/narrative',
        {
          period,
          company_name: activeCompany?.name || scoreRes.company_name || undefined,
          composite_score: scoreRes.composite_score,
          je_score: scoreRes.je_score,
          je_flags: scoreRes.je_flags,
          ap_score: scoreRes.ap_score,
          ap_flags: scoreRes.ap_flags,
          vat_score: scoreRes.vat_score,
          vat_flags: scoreRes.vat_flags,
        },
        workspaceId,
        activeCompanyId,
      );
      setNarrative(narr.narrative);
      setNarrativeAt(narr.generated_at);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Audit run failed');
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId, workspaceId, period]);

  const copyNarrative = async () => {
    if (!narrative) return;
    await navigator.clipboard.writeText(narrative);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadPdf = async () => {
    if (!narrative || !activeCompanyId) return;
    try {
      const res = await fetch(`${API}/api/audit/narrative/pdf`, {
        method: 'POST',
        headers: headers(workspaceId, activeCompanyId),
        body: JSON.stringify({
          period,
          company_name: activeCompany?.name || score?.company_name || 'Company',
          narrative,
          generated_at: narrativeAt,
          composite_score: score?.composite_score ?? 0,
          composite_risk: score?.composite_risk ?? 'low',
          je_score: score?.je_score ?? 0,
          je_flags: score?.je_flags ?? [],
          ap_score: score?.ap_score ?? 0,
          ap_flags: score?.ap_flags ?? [],
          vat_score: score?.vat_score ?? 0,
          vat_flags: score?.vat_flags ?? [],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(typeof err.detail === 'string' ? err.detail : `PDF failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit_findings_${period.replace(/\//g, '-')}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF download failed');
    }
  };

  const risk = (score?.composite_risk || 'low') as RiskLevel;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-amber-400" />
            Unified Audit Command Center
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            JE · AP · VAT composite risk — {activeCompany?.name || 'select company'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="bg-gray-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white w-32"
            placeholder="2026-Q2"
          />
          <button
            type="button"
            onClick={() => void runFullAudit()}
            disabled={loading || !activeCompanyId}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-amber-500 text-gray-950 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Run Full Audit
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {score && (
        <>
          {score.going_concern_warning === true && (
            <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              ⚠️ Material Going Concern Uncertainty Detected — ISA 570 modified opinion may be required.{" "}
              <Link to="/audit" className="underline text-red-100">View assessment →</Link>
            </div>
          )}
          <div className={`mb-6 rounded-2xl border-2 p-6 bg-white/[0.02] ${RISK_COLOR[risk]}`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-gray-500 font-mono mb-1">
                  Composite audit risk
                </div>
                <div className={`text-6xl font-black ${RISK_TEXT[risk]}`}>
                  {score.composite_score.toFixed(0)}
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <RiskBadge risk={risk} />
                  <span className="text-xs text-gray-500">JE 40% · AP 30% · VAT 30%</span>
                </div>
              </div>
              <div className="text-xs text-gray-500 text-right">
                Last run
                <div className="text-gray-300 mt-1 font-mono">
                  {score.last_run ? new Date(score.last_run).toLocaleString() : '—'}
                </div>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4 mb-8">
            <LayerCard
              title="Journal Entry Risk"
              score={score.je_score}
              risk={score.je_risk}
              flags={score.je_flags}
              detailTo="/r2r/pattern"
            />
            <LayerCard
              title="AP Anomaly Risk"
              score={score.ap_score}
              risk={score.ap_risk}
              flags={score.ap_flags}
              detailTo="/ap-invoices/anomaly"
            />
            <LayerCard
              title="VAT Compliance"
              score={score.vat_score}
              risk={score.vat_risk}
              flags={score.vat_flags}
              detailTo="/gulftax/tax-compliance"
            />
          </div>
          {score.going_concern_warning === null && (
            <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              Going concern not yet assessed for this period.{" "}
              <Link to="/audit" className="underline text-amber-100">Run assessment →</Link>
            </div>
          )}
        </>
      )}

      {narrative && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-sm font-semibold text-white">
              AI Audit Findings — {period}
            </h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void copyNarrative()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-white/10 text-gray-300 hover:bg-white/5"
              >
                <Copy className="w-3.5 h-3.5" />
                {copied ? 'Copied' : 'Copy to Clipboard'}
              </button>
              <button
                type="button"
                onClick={() => void downloadPdf()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
              >
                <Download className="w-3.5 h-3.5" />
                Download PDF
              </button>
            </div>
          </div>
          <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
            {narrative}
          </div>
          {narrativeAt && (
            <p className="text-[10px] text-gray-600 mt-4 font-mono">
              Generated {new Date(narrativeAt).toLocaleString()}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-xs border-t border-white/10 pt-4">
        <Link to="/gulftax/audit-exports" className="text-amber-400 underline">
          GulfTax Audit Exports →
        </Link>
        <Link to="/ap-invoices/audit-log" className="text-teal-400 underline">
          AP Audit Log →
        </Link>
        <Link to="/audit" className="text-teal-400 underline">
          Audit Intelligence →
        </Link>
        <Link to="/r2r/pattern" className="text-teal-400 underline">
          R2R Pattern Analysis →
        </Link>
      </div>
    </div>
  );
}
