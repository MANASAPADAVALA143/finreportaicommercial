/**
 * IndiaCloseStatus.tsx
 * India Month-End Close Progress Dashboard
 * URL: /india/accounting/close-status
 *
 * Fiscal year: April–March | Currency: INR | Tax: GST 18%
 * Pulls from GET /api/india/accounting/close-status/{period}
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Circle,
  AlertCircle,
  RefreshCw,
  ArrowRight,
  Lock,
  ChevronDown,
} from 'lucide-react';

const API_BASE =
  (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || '';

// ── types ──────────────────────────────────────────────────────────────────────

type StepStatus = 'complete' | 'pending' | 'blocked' | 'available';

interface ChecklistStep {
  step: string;
  label: string;
  status: StepStatus;
  count: number;
  path: string;
}

interface CloseStatusData {
  period: string;
  checklist: ChecklistStep[];
  complete_count: number;
  total_steps: number;
  completion_pct: number;
  country?: string;
  currency?: string;
  fiscal_year?: string;
}

// ── design tokens ─────────────────────────────────────────────────────────────

const C = {
  bg:      '#0F172A',
  card:    '#1E293B',
  border:  '#334155',
  text:    '#F8FAFC',
  muted:   '#94A3B8',
  green:   '#22C55E',
  orange:  '#F59E0B',
  red:     '#EF4444',
  blue:    '#3B82F6',
  indigo:  '#6366F1',
};

// ── helpers ───────────────────────────────────────────────────────────────────

function statusIcon(s: StepStatus) {
  if (s === 'complete')  return <CheckCircle2  size={18} color={C.green}  />;
  if (s === 'blocked')   return <AlertCircle   size={18} color={C.red}    />;
  if (s === 'available') return <Circle        size={18} color={C.blue}   />;
  return                        <Circle        size={18} color={C.muted}  />;
}

function statusBadge(s: StepStatus) {
  const map: Record<StepStatus, { label: string; bg: string; color: string }> = {
    complete:  { label: 'Complete',  bg: '#14532d', color: C.green  },
    pending:   { label: 'Pending',   bg: '#451a03', color: C.orange },
    blocked:   { label: 'Blocked',   bg: '#450a0a', color: C.red    },
    available: { label: 'Available', bg: '#1e3a5f', color: C.blue   },
  };
  const m = map[s] || map.pending;
  return (
    <span
      style={{
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 4,
        background: m.bg,
        color: m.color,
        fontWeight: 600,
        letterSpacing: '0.03em',
      }}
    >
      {m.label}
    </span>
  );
}

/** India fiscal year starts April — build last 6 months relative to today. */
function getPeriodOptions(): string[] {
  const result: string[] = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return result;
}

// ── component ─────────────────────────────────────────────────────────────────

export default function IndiaCloseStatus() {
  const navigate = useNavigate();
  const periodOptions = getPeriodOptions();
  const [period, setPeriod]   = useState(periodOptions[0]);
  const [data, setData]       = useState<CloseStatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const load = (p: string) => {
    setLoading(true);
    setError('');
    fetch(`${API_BASE}/api/india/accounting/close-status/${p}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<CloseStatusData>;
      })
      .then(d => setData(d))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(period); }, [period]);

  const pct = data?.completion_pct ?? 0;
  const barColor = pct >= 80 ? C.green : pct >= 40 ? C.orange : C.red;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: 'system-ui, sans-serif', padding: 32 }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Lock size={22} color={C.indigo} />
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>India Accounting — Close Status</h1>
        </div>
        <p style={{ color: C.muted, fontSize: 14, marginBottom: 8 }}>
          Track the monthly close pipeline. Fiscal year: April–March. Currency: INR. Tax: GST 18%.
        </p>

        {/* Controls */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <select
              value={period}
              onChange={e => setPeriod(e.target.value)}
              style={{
                background: C.card, color: C.text, border: `1px solid ${C.border}`,
                borderRadius: 8, padding: '8px 32px 8px 12px', fontSize: 14,
                cursor: 'pointer', appearance: 'none', outline: 'none',
              }}
            >
              {periodOptions.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <ChevronDown size={14} color={C.muted} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          </div>

          <button
            onClick={() => load(period)}
            disabled={loading}
            style={{
              background: C.indigo, color: '#fff', border: 'none', borderRadius: 8,
              padding: '8px 16px', cursor: 'pointer', fontSize: 14, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 6,
              opacity: loading ? 0.6 : 1,
            }}
          >
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            Refresh Status
          </button>
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: '#450a0a', border: `1px solid ${C.red}`, borderRadius: 8, padding: 12, marginBottom: 16, color: C.red, fontSize: 14 }}>
            {error}
          </div>
        )}

        {/* Progress bar */}
        {data && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Overall Progress — {period}</span>
              <span style={{ fontSize: 20, fontWeight: 700, color: barColor }}>{pct}%</span>
            </div>
            <div style={{ height: 10, background: '#0f172a', borderRadius: 5, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 5, transition: 'width 0.5s ease' }} />
            </div>
            <div style={{ marginTop: 8, color: C.muted, fontSize: 13 }}>
              {data.complete_count} of {data.total_steps} steps completed
            </div>
          </div>
        )}

        {/* Checklist */}
        {data && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
            {data.checklist.map((step, i) => (
              <div
                key={step.step}
                onClick={() => navigate(step.path)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px',
                  borderBottom: i < data.checklist.length - 1 ? `1px solid ${C.border}` : 'none',
                  cursor: 'pointer', transition: 'background 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#253348'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
              >
                <div style={{ flexShrink: 0 }}>{statusIcon(step.status)}</div>
                <div style={{ fontSize: 11, color: C.muted, flexShrink: 0, width: 20, textAlign: 'center', fontWeight: 600 }}>
                  {i + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{step.label}</div>
                  {step.count > 0 && (
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                      {step.count} record{step.count !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
                <div style={{ flexShrink: 0 }}>{statusBadge(step.status)}</div>
                <ArrowRight size={14} color={C.muted} style={{ flexShrink: 0 }} />
              </div>
            ))}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !data && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 32, textAlign: 'center', color: C.muted }}>
            Loading India close status…
          </div>
        )}

        {/* Quick actions */}
        {data && data.completion_pct < 100 && (
          <div style={{ marginTop: 16, padding: 16, background: '#1e293b', borderRadius: 12, border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 10, fontWeight: 600 }}>QUICK ACTIONS</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                onClick={() => navigate('/india-full/purchases')}
                style={{ background: '#1e3a5f', color: C.indigo, border: `1px solid ${C.indigo}30`, borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              >
                Post Purchase Invoices
              </button>
              <button
                onClick={() => navigate('/india-full/gst')}
                style={{ background: '#1e3a5f', color: C.indigo, border: `1px solid ${C.indigo}30`, borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              >
                GST Returns (GSTR-1 / 3B)
              </button>
              <button
                onClick={() => navigate('/india-full/tds')}
                style={{ background: '#1e3a5f', color: C.indigo, border: `1px solid ${C.indigo}30`, borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              >
                TDS Filing
              </button>
              <button
                onClick={() => navigate('/india-full/close')}
                style={{ background: '#1e3a5f', color: C.indigo, border: `1px solid ${C.indigo}30`, borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              >
                Period Close
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
