import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Copy,
  Loader2,
  Upload,
  Check,
  AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { MatchRateGauge } from '../../components/rev-rec/MatchRateGauge';
import { R2RServiceNav } from '../../components/rev-rec/R2RServiceNav';
import {
  REV_REC_BLUE,
  REV_REC_NAVY,
  parseTableFile,
  rowsToBillingRecords,
  rowsToGlRevenueEntries,
  billingToContractSchedules,
} from '../../utils/revRecParse';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

async function callRevRec<T = unknown>(endpoint: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}/api/rev-rec/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

function yyyymm(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1 + delta, 1);
  return yyyymm(dt);
}

function displayPeriod(p: string): string {
  const [year, month] = p.split('-');
  const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
  return date.toLocaleString('default', { month: 'long', year: 'numeric' });
}

type PillState = 'empty' | 'clean' | 'exceptions' | 'high';

function rollForwardPill(r: Record<string, unknown> | null): PillState {
  if (!r) return 'empty';
  if (r.reconciled === true) return 'clean';
  if (String(r.risk_level).toLowerCase() === 'high') return 'high';
  return 'exceptions';
}

function threeWayPill(r: Record<string, unknown> | null): PillState {
  if (!r) return 'empty';
  const hr = Number(r.high_risk_count || 0);
  const un = Number(r.unmatched || 0);
  const rate = Number(r.match_rate_pct || 0);
  if (hr > 0 || rate < 85) return 'high';
  if (un > 0 || rate < 95) return 'exceptions';
  return 'clean';
}

function anomalyPill(r: Record<string, unknown> | null): PillState {
  if (!r) return 'empty';
  const hi = Number(r.high_risk_entries || 0);
  const fg = Number(r.flagged_count || 0);
  if (hi > 0) return 'high';
  if (fg > 0) return 'exceptions';
  return 'clean';
}

function simpleReconPill(r: Record<string, unknown> | null): PillState {
  if (!r) return 'empty';
  return r.reconciled === true ? 'clean' : 'exceptions';
}

function Pill({ label, state, detail }: { label: string; state: PillState; detail?: string }) {
  const base = 'rounded-full px-3 py-1.5 text-xs font-semibold border';
  if (state === 'empty') {
    return <span className={`${base} bg-slate-100 text-slate-500 border-slate-200`}>{label}: —</span>;
  }
  if (state === 'clean') {
    return <span className={`${base} bg-emerald-50 text-emerald-800 border-emerald-200`}>{label}: ✓ Clean</span>;
  }
  if (state === 'high') {
    return (
      <span className={`${base} bg-red-50 text-red-800 border-red-200`}>
        {label}: {detail || 'High Risk'}
      </span>
    );
  }
  return (
    <span className={`${base} bg-amber-50 text-amber-900 border-amber-200`}>
      {label}: {detail || 'Exceptions'}
    </span>
  );
}

function formatVarianceAlert(amount: number): string {
  const a = Math.abs(amount);
  return `▲ $${a.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function threeWayStatusLabel(status: string): string {
  const m: Record<string, string> = {
    matched: 'Matched',
    missing_gl: 'Missing GL',
    billing_gl_diff: 'Billing ≠ GL',
    schedule_gl_diff: 'Schedule ≠ GL',
    missing_billing: 'Missing Billing',
    missing_schedule: 'Missing Schedule',
  };
  return m[status] || status.replace(/_/g, ' ');
}

function dragZoneHandlers(onPick: (f: File) => void) {
  return {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const f = e.dataTransfer.files?.[0];
      if (f) onPick(f);
    },
  };
}

function coerceBillingSystem(s: string): string {
  const v = s.toLowerCase();
  if (v.includes('sales')) return 'salesforce';
  if (v.includes('zuora')) return 'zuora';
  return 'sap';
}

export default function RevRecReconciliationPage() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const [rollForwardInput, setRollForwardInput] = useState({
    opening_balance: 0,
    new_billings: 0,
    modification_increases: 0,
    modification_decreases: 0,
    revenue_recognised: 0,
    cancellations: 0,
    fx_retranslation: 0,
    gl_closing_balance: 0,
  });
  const [rollForwardResult, setRollForwardResult] = useState<Record<string, unknown> | null>(null);
  const [rollForwardLoading, setRollForwardLoading] = useState(false);

  const [threeWayFiles, setThreeWayFiles] = useState<{ billing: File | null; gl: File | null }>({
    billing: null,
    gl: null,
  });
  const [threeWayResult, setThreeWayResult] = useState<Record<string, unknown> | null>(null);
  const [threeWayLoading, setThreeWayLoading] = useState(false);

  const [anomalyFile, setAnomalyFile] = useState<File | null>(null);
  const [anomalyThreshold, setAnomalyThreshold] = useState(10000);
  const [anomalyResult, setAnomalyResult] = useState<Record<string, unknown> | null>(null);
  const [anomalyLoading, setAnomalyLoading] = useState(false);
  const [reviewedEntries, setReviewedEntries] = useState<Set<number>>(new Set());
  const [expandedThreeWay, setExpandedThreeWay] = useState<Set<string>>(new Set());
  const [expandedAnomaly, setExpandedAnomaly] = useState<Set<number>>(new Set());

  const [rpoInput, setRpoInput] = useState({
    opening_rpo: 0,
    new_contracts_value: 0,
    modifications_net: 0,
    revenue_recognised: 0,
    cancellations: 0,
    closing_rpo_per_disclosure: 0,
  });
  const [rpoResult, setRpoResult] = useState<Record<string, unknown> | null>(null);
  const [rpoLoading, setRpoLoading] = useState(false);

  const [commissionInput, setCommissionInput] = useState({
    opening_asset: 0,
    new_commissions_capitalised: 0,
    monthly_amortisation: 0,
    gl_closing_balance: 0,
  });
  const [commissionResult, setCommissionResult] = useState<Record<string, unknown> | null>(null);
  const [commissionLoading, setCommissionLoading] = useState(false);

  const [commentaryType, setCommentaryType] = useState('Deferred Revenue');
  const [commentaryItemsText, setCommentaryItemsText] = useState('');
  const [commentaryPriorText, setCommentaryPriorText] = useState('');
  const [commentaryRisk, setCommentaryRisk] = useState<'low' | 'medium' | 'high'>('medium');
  const [commentaryResult, setCommentaryResult] = useState<Record<string, unknown> | null>(null);
  const [commentaryLoading, setCommentaryLoading] = useState(false);

  const [periodCloseResult, setPeriodCloseResult] = useState<Record<string, unknown> | null>(null);
  const [periodCloseLoading, setPeriodCloseLoading] = useState(false);
  const [periodCloseExcelLoading, setPeriodCloseExcelLoading] = useState(false);

  const resetAllResults = useCallback(() => {
    setRollForwardResult(null);
    setThreeWayResult(null);
    setAnomalyResult(null);
    setRpoResult(null);
    setCommissionResult(null);
    setCommentaryResult(null);
    setPeriodCloseResult(null);
    setReviewedEntries(new Set());
    setExpandedThreeWay(new Set());
    setExpandedAnomaly(new Set());
    setThreeWayFiles({ billing: null, gl: null });
    setAnomalyFile(null);
  }, []);

  const bumpPeriod = (d: number) => {
    setPeriod((p) => {
      const cap = yyyymm();
      const next = shiftMonth(p, d);
      if (d > 0 && next > cap) return p;
      return next;
    });
    resetAllResults();
  };

  const currentMonthYm = yyyymm();
  const atLatestPeriod = period >= currentMonthYm;

  const onPeriodSelect = (ym: string) => {
    setPeriod(ym);
    resetAllResults();
  };

  const modulesCompleteCount = useMemo(() => {
    let n = 0;
    if (rollForwardResult) n += 1;
    if (threeWayResult) n += 1;
    if (anomalyResult) n += 1;
    if (rpoResult) n += 1;
    if (commissionResult) n += 1;
    return n;
  }, [rollForwardResult, threeWayResult, anomalyResult, rpoResult, commissionResult]);

  const hasAutoFillSource = useMemo(() => {
    if (rollForwardResult && rollForwardResult.reconciled === false) return true;
    if (threeWayResult) {
      const items = (threeWayResult.items as Record<string, unknown>[]) || [];
      if (items.some((i) => i.status !== 'matched')) return true;
    }
    if (anomalyResult && Number(anomalyResult.flagged_count || 0) > 0) return true;
    if (rpoResult && rpoResult.reconciled === false) return true;
    if (commissionResult && commissionResult.reconciled === false) return true;
    return false;
  }, [rollForwardResult, threeWayResult, anomalyResult, rpoResult, commissionResult]);

  const rollPillDetail = useMemo(() => {
    if (!rollForwardResult || rollForwardResult.reconciled === true) return undefined;
    return rollForwardPill(rollForwardResult) === 'high' ? undefined : '1 exception';
  }, [rollForwardResult]);

  const twPillDetail = useMemo(() => {
    if (!threeWayResult) return undefined;
    const st = threeWayPill(threeWayResult);
    if (st === 'clean') return undefined;
    const un = Number(threeWayResult.unmatched || 0);
    const hr = Number(threeWayResult.high_risk_count || 0);
    const rate = Number(threeWayResult.match_rate_pct || 0);
    if (st === 'high') {
      if (rate < 85) return 'Match rate < 85%';
      if (hr > 0) return `${hr} exception${hr === 1 ? '' : 's'}`;
      return 'High Risk';
    }
    return `${un} exception${un === 1 ? '' : 's'}`;
  }, [threeWayResult]);

  const anomalyPillDetail = useMemo(() => {
    if (!anomalyResult) return undefined;
    const st = anomalyPill(anomalyResult);
    if (st === 'clean') return undefined;
    const hi = Number(anomalyResult.high_risk_entries || 0);
    const fg = Number(anomalyResult.flagged_count || 0);
    if (st === 'high') return `${hi} high-risk`;
    return `${fg} exception${fg === 1 ? '' : 's'}`;
  }, [anomalyResult]);

  const rpoPillDetail = useMemo(() => {
    if (!rpoResult || rpoResult.reconciled === true) return undefined;
    return '1 exception';
  }, [rpoResult]);

  const commPillDetail = useMemo(() => {
    if (!commissionResult || commissionResult.reconciled === true) return undefined;
    return '1 exception';
  }, [commissionResult]);

  const runRollForward = async () => {
    setRollForwardLoading(true);
    try {
      const body = { period, ...rollForwardInput, contract_schedules: [] };
      const data = await callRevRec<Record<string, unknown>>('roll-forward', body);
      setRollForwardResult(data);
      toast.success('Roll-forward complete');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Roll-forward failed');
    } finally {
      setRollForwardLoading(false);
    }
  };

  const runThreeWay = async () => {
    if (!threeWayFiles.billing || !threeWayFiles.gl) {
      toast.error('Upload both billing and GL extracts');
      return;
    }
    setThreeWayLoading(true);
    try {
      const billingRows = await parseTableFile(threeWayFiles.billing);
      const glRows = await parseTableFile(threeWayFiles.gl);
      const billing_records = rowsToBillingRecords(billingRows).map((b) => ({
        ...b,
        billing_system: coerceBillingSystem(b.billing_system),
      }));
      const gl_revenue_entries = rowsToGlRevenueEntries(glRows, period);
      const contract_schedules = billingToContractSchedules(billing_records);
      const data = await callRevRec<Record<string, unknown>>('three-way-match', {
        period,
        billing_records,
        gl_revenue_entries,
        contract_schedules,
      });
      setThreeWayResult(data);
      toast.success('Three-way match complete');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Three-way match failed');
    } finally {
      setThreeWayLoading(false);
    }
  };

  const runAnomaly = async () => {
    if (!anomalyFile) {
      toast.error('Upload GL revenue journal entries');
      return;
    }
    setAnomalyLoading(true);
    try {
      const rows = await parseTableFile(anomalyFile);
      const revenue_entries = rowsToGlRevenueEntries(rows, period);
      const data = await callRevRec<Record<string, unknown>>('anomaly-detection', {
        period,
        revenue_entries,
        threshold_amount: anomalyThreshold,
      });
      setAnomalyResult(data);
      setReviewedEntries(new Set());
      toast.success('Anomaly detection complete');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Anomaly detection failed');
    } finally {
      setAnomalyLoading(false);
    }
  };

  const runRpo = async () => {
    setRpoLoading(true);
    try {
      const data = await callRevRec<Record<string, unknown>>('rpo-movement', { period, ...rpoInput });
      setRpoResult(data);
      toast.success('RPO reconciliation complete');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'RPO failed');
    } finally {
      setRpoLoading(false);
    }
  };

  const runCommission = async () => {
    setCommissionLoading(true);
    try {
      const data = await callRevRec<Record<string, unknown>>('commission-recon', { period, ...commissionInput });
      setCommissionResult(data);
      toast.success('Commission reconciliation complete');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Commission recon failed');
    } finally {
      setCommissionLoading(false);
    }
  };

  const parseCommentaryItems = (): Record<string, unknown>[] => {
    const raw = commentaryItemsText.trim();
    if (!raw) return [];
    try {
      const j = JSON.parse(raw);
      if (Array.isArray(j)) return j as Record<string, unknown>[];
    } catch {
      /* fall through */
    }
    return raw.split(/\n{2,}/).map((block) => ({ item_description: block.trim(), detail: block.trim() }));
  };

  const runCommentary = async () => {
    const reconciling_items = parseCommentaryItems();
    if (!reconciling_items.length) {
      toast.error('Add at least one reconciling item (text or JSON array)');
      return;
    }
    let prior_period_items: Record<string, unknown>[] = [];
    const pt = commentaryPriorText.trim();
    if (pt) {
      try {
        const j = JSON.parse(pt);
        if (Array.isArray(j)) prior_period_items = j as Record<string, unknown>[];
        else prior_period_items = [{ note: pt }];
      } catch {
        prior_period_items = [{ note: pt }];
      }
    }
    setCommentaryLoading(true);
    try {
      const data = await callRevRec<Record<string, unknown>>('commentary', {
        period,
        reconciliation_type: commentaryType,
        reconciling_items,
        prior_period_items,
        risk_level: commentaryRisk,
      });
      setCommentaryResult(data);
      toast.success('Commentary generated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Commentary failed');
    } finally {
      setCommentaryLoading(false);
    }
  };

  const autoFillFromResults = () => {
    const items: Record<string, unknown>[] = [];
    if (rollForwardResult && rollForwardResult.reconciled === false) {
      items.push({
        item_description: `Deferred revenue roll-forward — period ${period}`,
        amount: rollForwardResult.difference,
        detail: `Expected vs GL difference ${rollForwardResult.difference}; risk ${rollForwardResult.risk_level}`,
      });
    }
    if (threeWayResult) {
      const rows = (threeWayResult.items as Record<string, unknown>[]) || [];
      rows
        .filter((r) => r.status !== 'matched')
        .forEach((r) => {
          items.push({
            item_description: `Contract ${r.contract_id} — ${r.status}`,
            amount: r.difference,
            detail: `Billing ${r.billing_amount}, GL ${r.gl_amount}, schedule ${r.schedule_amount}`,
          });
        });
    }
    if (anomalyResult) {
      const flags = (anomalyResult.flags as Record<string, unknown>[]) || [];
      flags.slice(0, 20).forEach((f, i) => {
        const ent = f.entry as Record<string, unknown>;
        items.push({
          item_description: `Anomaly #${i + 1} — ${(ent?.account_code as string) || ''}`,
          flags: f.flag_types,
          detail: JSON.stringify(ent),
        });
      });
    }
    if (rpoResult && rpoResult.reconciled === false) {
      items.push({
        item_description: `RPO movement — period ${period}`,
        amount: rpoResult.difference,
        detail: `Expected closing ${rpoResult.expected_closing} vs disclosed ${rpoResult.disclosed_closing}`,
      });
    }
    if (commissionResult && commissionResult.reconciled === false) {
      items.push({
        item_description: `Commission asset — period ${period}`,
        amount: commissionResult.difference,
        detail: `Expected ${commissionResult.expected_closing} vs GL ${commissionResult.gl_closing_balance}`,
      });
    }
    setCommentaryItemsText(JSON.stringify(items, null, 2));
    toast.success('Reconciling items filled from module results');
  };

  const runPeriodClose = async () => {
    setPeriodCloseLoading(true);
    try {
      const data = await callRevRec<Record<string, unknown>>('period-close-summary', {
        period,
        roll_forward_result: rollForwardResult,
        three_way_match_result: threeWayResult,
        anomaly_result: anomalyResult,
        rpo_result: rpoResult,
        commission_result: commissionResult,
      });
      setPeriodCloseResult(data);
      toast.success('Period close summary generated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Period close failed');
    } finally {
      setPeriodCloseLoading(false);
    }
  };

  const handleDownloadPeriodCloseExcel = async () => {
    if (!periodCloseResult) {
      toast.error('Generate the period close report first');
      return;
    }
    setPeriodCloseExcelLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/rev-rec/download-excel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period,
          roll_forward_result: rollForwardResult,
          three_way_match_result: threeWayResult,
          anomaly_result: anomalyResult,
          rpo_result: rpoResult,
          commission_result: commissionResult,
          period_close_result: periodCloseResult,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as { file_id: string; filename: string; sheets: number };
      const dlResponse = await fetch(`${API_BASE}/api/rev-rec/download-file/${encodeURIComponent(data.file_id)}`);
      if (!dlResponse.ok) throw new Error(await dlResponse.text());
      const blob = await dlResponse.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = data.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast.success(`Period close pack downloaded (${data.sheets} sheets) ✓`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed — try again');
    } finally {
      setPeriodCloseExcelLoading(false);
    }
  };

  const copyText = async (text: string, msg = 'Copied') => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(msg);
    } catch {
      toast.error('Copy failed');
    }
  };

  const downloadWordCommentary = () => {
    if (!commentaryResult) return;
    const items = (commentaryResult.commentary_per_item as Record<string, unknown>[]) || [];
    const overall = String(commentaryResult.overall_assessment || '');
    const actions = (commentaryResult.recommended_actions as string[]) || [];
    let html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'><head><meta charset='utf-8'><title>Rev Rec Commentary</title></head><body style="font-family:Georgia,serif;font-size:11pt;color:#111">`;
    html += `<h2 style="color:${REV_REC_NAVY}">IFRS 15 — ${String(commentaryResult.reconciliation_type)}</h2><p><b>Period:</b> ${period}</p>`;
    items.forEach((it) => {
      html += `<h3 style="color:${REV_REC_NAVY}">${String(it.item_description || '')}</h3><p>${String(it.commentary || '').replace(/\n/g, '<br/>')}</p>`;
    });
    html += `<h3 style="color:${REV_REC_NAVY}">Overall assessment</h3><p>${overall.replace(/\n/g, '<br/>')}</p>`;
    html += `<h3>Recommended actions</h3><ol>${actions.map((a) => `<li>${a}</li>`).join('')}</ol></body></html>`;
    const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rev-rec-commentary-${period}.doc`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success('Download started');
  };

  const monthOptions = useMemo(() => {
    const out: string[] = [];
    const now = new Date();
    for (let i = 0; i < 24; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push(yyyymm(d));
    }
    return out;
  }, []);

  const rfLines = (rollForwardResult?.roll_forward_lines as Record<string, unknown>[]) || [];
  const flagRate = Number(anomalyResult?.flag_rate_pct ?? 0);
  const flagRateColor = flagRate < 5 ? 'text-emerald-600' : flagRate <= 15 ? 'text-amber-600' : 'text-red-600';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 pb-16">
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="text-sm font-medium">Dashboard</span>
          </button>
          <R2RServiceNav current="rev-rec" />
        </div>

        <header className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6 mb-8">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">Revenue Recognition Reconciliation</h1>
            <p className="text-slate-600 mt-2 text-lg">IFRS 15 month-end close — 5 modules</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => bumpPeriod(-1)}
              className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <select
              value={period}
              onChange={(e) => onPeriodSelect(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-900 font-medium min-w-[11rem]"
            >
              {monthOptions.map((ym) => (
                <option key={ym} value={ym}>
                  {displayPeriod(ym)}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label="Next month"
              disabled={atLatestPeriod}
              onClick={() => bumpPeriod(1)}
              className={`p-2 rounded-lg border border-slate-200 bg-white ${
                atLatestPeriod ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-50'
              }`}
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </header>

        <div className="flex flex-wrap gap-2 mb-8">
          <Pill label="Roll-Forward" state={rollForwardPill(rollForwardResult)} detail={rollPillDetail} />
          <Pill label="3-Way Match" state={threeWayPill(threeWayResult)} detail={twPillDetail} />
          <Pill label="Anomalies" state={anomalyPill(anomalyResult)} detail={anomalyPillDetail} />
          <Pill label="RPO" state={simpleReconPill(rpoResult)} detail={rpoPillDetail} />
          <Pill label="Commission" state={simpleReconPill(commissionResult)} detail={commPillDetail} />
        </div>

        {/* Module 1 */}
        <section className="bg-white rounded-2xl shadow-lg border border-slate-200 mb-8 overflow-hidden">
          <div className="px-6 py-3 text-white font-semibold" style={{ backgroundColor: REV_REC_NAVY }}>
            Deferred Revenue Roll-Forward
          </div>
          <div className="grid lg:grid-cols-2 gap-8 p-6">
            <div className="space-y-3">
              {(
                [
                  ['opening_balance', 'Opening balance ($)'],
                  ['new_billings', 'New billings ($)'],
                  ['modification_increases', 'Modification increases ($)'],
                  ['modification_decreases', 'Modification decreases ($)'],
                  ['revenue_recognised', 'Revenue recognised ($)'],
                  ['cancellations', 'Cancellations / churn ($)'],
                  ['fx_retranslation', 'FX retranslation ($)'],
                  ['gl_closing_balance', 'GL closing balance ($)'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block text-sm">
                  <span className="text-slate-600 font-medium">{label}</span>
                  <input
                    type="number"
                    className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2"
                    value={rollForwardInput[key]}
                    onChange={(e) =>
                      setRollForwardInput((s) => ({ ...s, [key]: parseFloat(e.target.value) || 0 }))
                    }
                  />
                </label>
              ))}
              <p className="text-xs text-slate-500">Enter the closing balance from your GL/SAP</p>
              <button
                type="button"
                disabled={rollForwardLoading}
                onClick={runRollForward}
                className="w-full py-3 rounded-xl text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
                style={{ backgroundColor: REV_REC_NAVY }}
              >
                {rollForwardLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                Run Roll-Forward
              </button>
            </div>
            <div>
              {!rollForwardResult ? (
                <p className="text-slate-500 text-sm">Run the roll-forward to see expected vs GL and AI insight.</p>
              ) : (
                <div className="space-y-4">
                  <div className="overflow-x-auto border border-slate-100 rounded-xl">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-left text-slate-600">
                          <th className="px-3 py-2">Line</th>
                          <th className="px-3 py-2 text-right">Amount ($)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rfLines.map((line, idx) => {
                          const isDiff = String(line.label).toLowerCase().includes('difference');
                          const diffAmt = typeof line.amount === 'number' ? line.amount : 0;
                          const diffCls =
                            isDiff && rollForwardResult.reconciled === true
                              ? 'text-emerald-700 font-medium'
                              : isDiff
                                ? 'text-red-600 font-semibold'
                                : String(line.label).toLowerCase().includes('expected') ||
                                    String(line.label).toLowerCase().includes('gl closing')
                                  ? 'font-bold text-slate-900'
                                  : '';
                          const showParen =
                            typeof line.amount === 'number' &&
                            diffAmt < 0 &&
                            !isDiff &&
                            /decrease|recognised|cancellations/i.test(String(line.label));
                          const amtCell =
                            isDiff && rollForwardResult.reconciled === true
                              ? '—'
                              : isDiff && rollForwardResult.reconciled !== true
                                ? formatVarianceAlert(diffAmt)
                                : typeof line.amount === 'number'
                                  ? showParen
                                    ? `(${Math.abs(diffAmt).toLocaleString()})`
                                    : line.amount.toLocaleString()
                                  : String(line.amount ?? '');
                          return (
                            <tr key={idx} className={`border-t border-slate-100 ${diffCls}`}>
                              <td className="px-3 py-2">{String(line.label)}</td>
                              <td className="px-3 py-2 text-right font-mono">
                                {amtCell}
                                {isDiff && rollForwardResult.reconciled === true ? (
                                  <span className="ml-2 text-xs font-medium text-emerald-700">Reconciled ✓</span>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {rollForwardResult.reconciled === true ? (
                      <span className="inline-flex items-center gap-1 px-4 py-2 rounded-full bg-emerald-100 text-emerald-800 font-bold border border-emerald-200">
                        <Check className="w-4 h-4" /> RECONCILED ✓
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-4 py-2 rounded-full bg-red-100 text-red-800 font-bold border border-red-200">
                        <AlertTriangle className="w-4 h-4" /> DIFFERENCE — REVIEW REQUIRED
                      </span>
                    )}
                    <span
                      className={`text-sm font-semibold px-2 py-1 rounded ${
                        String(rollForwardResult.risk_level).toLowerCase() === 'high'
                          ? 'bg-red-50 text-red-800'
                          : String(rollForwardResult.risk_level).toLowerCase() === 'medium'
                            ? 'bg-amber-50 text-amber-900'
                            : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      Risk: {String(rollForwardResult.risk_level || '').toUpperCase()}
                    </span>
                  </div>
                  <div
                    className="rounded-xl p-4 text-sm italic text-slate-800 border border-blue-100"
                    style={{ backgroundColor: 'rgba(29, 78, 216, 0.08)' }}
                  >
                    <p className="font-semibold not-italic text-slate-700 mb-1" style={{ color: REV_REC_BLUE }}>
                      AI Insight
                    </p>
                    {String(rollForwardResult.nova_commentary || '')}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Module 2 */}
        <section className="bg-white rounded-2xl shadow-lg border border-slate-200 mb-8 overflow-hidden">
          <div className="px-6 py-3 text-white font-semibold" style={{ backgroundColor: REV_REC_NAVY }}>
            Three-Way Match (Billing · GL · Schedule)
          </div>
          <div className="p-6 space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              {(['billing', 'gl'] as const).map((side) => (
                <label
                  key={side}
                  {...dragZoneHandlers((f) => setThreeWayFiles((s) => ({ ...s, [side]: f })))}
                  className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-xl p-8 cursor-pointer hover:border-blue-300 bg-slate-50/50"
                >
                  <Upload className="w-8 h-8 text-slate-400 mb-2" />
                  <span className="font-semibold text-slate-800">
                    {side === 'billing' ? 'Billing system export' : 'GL revenue extract'}
                  </span>
                  <span className="text-xs text-slate-500 text-center mt-1">
                    {side === 'billing'
                      ? 'Drag and drop or click to browse — Salesforce / Zuora / SAP billing'
                      : 'Drag and drop or click to browse — GL/SAP'}
                  </span>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      setThreeWayFiles((s) => ({ ...s, [side]: f }));
                    }}
                  />
                  <span className="text-xs text-blue-700 mt-2">
                    {threeWayFiles[side]?.name || 'Click to browse'}
                  </span>
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              CSV format: contract_id, customer_name, arr, mrr, billing_date, billing_system — GL: period, account_code,
              description, debit, credit, posted_by, posted_date, contract_id
            </p>
            <button
              type="button"
              disabled={threeWayLoading || !threeWayFiles.billing || !threeWayFiles.gl}
              onClick={runThreeWay}
              className="px-6 py-3 rounded-xl text-white font-semibold disabled:opacity-50 flex items-center gap-2"
              style={{ backgroundColor: REV_REC_NAVY }}
            >
              {threeWayLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              Run Three-Way Match
            </button>

            {threeWayResult ? (
              <div className="grid lg:grid-cols-3 gap-6 pt-4 border-t border-slate-100">
                <div className="flex flex-col items-center justify-start scale-[1.12] origin-top min-h-[180px]">
                  <MatchRateGauge pct={Number(threeWayResult.match_rate_pct || 0)} />
                </div>
                <div className="lg:col-span-2 grid sm:grid-cols-3 gap-3">
                  <div className="rounded-xl border border-slate-200 p-4 text-center bg-slate-50">
                    <p className="text-xs text-slate-500 uppercase">Total</p>
                    <p className="text-2xl font-bold text-slate-900">{String(threeWayResult.total_contracts ?? '')}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4 text-center bg-slate-50">
                    <p className="text-xs text-slate-500 uppercase">Matched</p>
                    <p className="text-2xl font-bold text-slate-900 inline-flex items-center justify-center gap-2">
                      {String(threeWayResult.matched ?? '')}
                      <Check className="w-6 h-6 text-emerald-600 shrink-0" aria-hidden />
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4 text-center bg-slate-50">
                    <p className="text-xs text-slate-500 uppercase">Unmatched</p>
                    <p className="text-2xl font-bold text-slate-900 inline-flex items-center justify-center gap-2">
                      {String(threeWayResult.unmatched ?? '')}
                      <span className="text-red-500 text-xl font-bold" aria-hidden>
                        ✗
                      </span>
                    </p>
                  </div>
                </div>
                <div className="lg:col-span-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-600 border-b">
                        <th className="py-2 pr-2">Contract ID</th>
                        <th className="py-2 pr-2">Customer</th>
                        <th className="py-2 pr-2 text-right">Billing $</th>
                        <th className="py-2 pr-2 text-right">GL $</th>
                        <th className="py-2 pr-2 text-right">Difference</th>
                        <th className="py-2 pr-2">Status</th>
                        <th className="py-2">Risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {((threeWayResult.items as Record<string, unknown>[]) || [])
                        .filter((r) => r.status !== 'matched')
                        .map((r) => {
                          const id = String(r.contract_id);
                          const open = expandedThreeWay.has(id);
                          const st = String(r.status);
                          const badge =
                            st === 'missing_gl'
                              ? 'bg-red-100 text-red-800'
                              : st === 'billing_gl_diff'
                                ? 'bg-orange-100 text-orange-800'
                                : st === 'schedule_gl_diff'
                                  ? 'bg-yellow-100 text-yellow-900'
                                  : st === 'missing_billing'
                                    ? 'bg-orange-100 text-orange-800'
                                    : 'bg-slate-100 text-slate-700';
                          return (
                            <React.Fragment key={id}>
                              <tr
                                className="border-t border-slate-100 cursor-pointer hover:bg-slate-50"
                                onClick={() =>
                                  setExpandedThreeWay((prev) => {
                                    const n = new Set(prev);
                                    if (n.has(id)) n.delete(id);
                                    else n.add(id);
                                    return n;
                                  })
                                }
                              >
                                <td className="py-2 pr-2 font-mono text-xs">{id}</td>
                                <td className="py-2 pr-2">{String(r.customer)}</td>
                                <td className="py-2 pr-2 text-right">{r.billing_amount == null ? '—' : Number(r.billing_amount).toLocaleString()}</td>
                                <td className="py-2 pr-2 text-right">{r.gl_amount == null ? '—' : Number(r.gl_amount).toLocaleString()}</td>
                                <td className="py-2 pr-2 text-right">{Number(r.difference || 0).toLocaleString()}</td>
                                <td className="py-2 pr-2">
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge}`}>
                                    {threeWayStatusLabel(st)}
                                  </span>
                                </td>
                                <td className="py-2">
                                  <span className="text-xs font-bold text-slate-700">{String(r.risk || '').toUpperCase()}</span>
                                </td>
                              </tr>
                              {open ? (
                                <tr className="bg-blue-50/50">
                                  <td colSpan={7} className="py-3 px-3 text-sm italic text-slate-800 border-b border-slate-100">
                                    <span className="font-semibold not-italic" style={{ color: REV_REC_BLUE }}>
                                      AI explanation:{' '}
                                    </span>
                                    {String(r.nova_explanation || '')}
                                  </td>
                                </tr>
                              ) : null}
                            </React.Fragment>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                <div
                  className="lg:col-span-3 rounded-xl p-4 text-sm italic border border-blue-100"
                  style={{ backgroundColor: 'rgba(29, 78, 216, 0.08)' }}
                >
                  <p className="font-semibold not-italic mb-1" style={{ color: REV_REC_BLUE }}>
                    Nova Summary
                  </p>
                  {String(threeWayResult.nova_summary || '')}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {/* Module 3 */}
        <section className="bg-white rounded-2xl shadow-lg border border-slate-200 mb-8 overflow-hidden">
          <div className="px-6 py-3 text-white font-semibold" style={{ backgroundColor: REV_REC_NAVY }}>
            Revenue Anomaly Detection
          </div>
          <div className="p-6 space-y-4">
            <label
              {...dragZoneHandlers((f) => setAnomalyFile(f))}
              className="block max-w-md border-2 border-dashed rounded-xl p-6 cursor-pointer hover:border-blue-300 bg-slate-50/50"
            >
              <div className="flex flex-col items-center">
                <Upload className="w-8 h-8 text-slate-400 mb-2" />
                <span className="font-semibold text-slate-800">GL revenue journal entries</span>
                <span className="text-xs text-slate-500 text-center mt-1">Upload CSV or Excel — all revenue JEs for the period</span>
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => setAnomalyFile(e.target.files?.[0] || null)}
                />
                <span className="text-xs text-blue-700 mt-2">{anomalyFile?.name || 'Click to browse'}</span>
              </div>
            </label>
            <label className="block max-w-xs text-sm">
              <span className="text-slate-600 font-medium">Threshold amount ($)</span>
              <input
                type="number"
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2"
                value={anomalyThreshold}
                onChange={(e) => setAnomalyThreshold(parseFloat(e.target.value) || 0)}
              />
              <span className="text-xs text-slate-500">Entries above this amount are flagged for large-amount review</span>
            </label>
            <button
              type="button"
              disabled={anomalyLoading || !anomalyFile}
              onClick={runAnomaly}
              className="px-6 py-3 rounded-xl text-white font-semibold disabled:opacity-50 flex items-center gap-2"
              style={{ backgroundColor: REV_REC_NAVY }}
            >
              {anomalyLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              Run Anomaly Detection
            </button>

            {anomalyResult ? (
              <div className="space-y-4 pt-4 border-t border-slate-100">
                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="rounded-xl border p-4 bg-slate-50">
                    <p className="text-xs text-slate-500">Total entries</p>
                    <p className="text-2xl font-bold">{String(anomalyResult.total_entries)}</p>
                  </div>
                  <div className="rounded-xl border p-4 bg-slate-50">
                    <p className="text-xs text-slate-500">Flagged</p>
                    <p className="text-2xl font-bold">{String(anomalyResult.flagged_count)}</p>
                  </div>
                  <div className="rounded-xl border p-4 bg-slate-50">
                    <p className="text-xs text-slate-500">Flag rate</p>
                    <p className={`text-2xl font-bold ${flagRateColor}`}>{String(anomalyResult.flag_rate_pct)}%</p>
                  </div>
                </div>
                {Number(anomalyResult.benford_deviation || 0) > 0.05 ? (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 text-sm flex gap-2">
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <span>
                      ⚠ Benford&apos;s Law deviation detected ({Number(anomalyResult.benford_deviation).toFixed(3)}).
                      Distribution of first digits is unusual — review population.
                    </span>
                  </div>
                ) : null}
                <p className="text-sm text-slate-600">
                  {reviewedEntries.size} of {String(anomalyResult.flagged_count || 0)} entries reviewed
                </p>
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${anomalyResult.flagged_count ? (reviewedEntries.size / Number(anomalyResult.flagged_count)) * 100 : 0}%`,
                      backgroundColor: REV_REC_BLUE,
                    }}
                  />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-600 border-b">
                        <th className="py-2 pr-2">#</th>
                        <th className="py-2 pr-2">Account</th>
                        <th className="py-2 pr-2 text-right">Amount</th>
                        <th className="py-2 pr-2">Flag types</th>
                        <th className="py-2 pr-2">Risk</th>
                        <th className="py-2 pr-2">Posted by</th>
                        <th className="py-2 pr-2 max-w-[200px]">Assessment</th>
                        <th className="py-2">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {((anomalyResult.flags as Record<string, unknown>[]) || []).map((row, idx) => {
                        const ent = row.entry as Record<string, unknown>;
                        const reviewed = reviewedEntries.has(idx);
                        const types = (row.flag_types as string[]) || [];
                        const open = expandedAnomaly.has(idx);
                        return (
                          <React.Fragment key={idx}>
                            <tr
                              className={`border-t ${reviewed ? 'bg-slate-100 text-slate-500' : ''}`}
                              onClick={() =>
                                setExpandedAnomaly((prev) => {
                                  const n = new Set(prev);
                                  if (n.has(idx)) n.delete(idx);
                                  else n.add(idx);
                                  return n;
                                })
                              }
                            >
                              <td className="py-2 pr-2">{idx + 1}</td>
                              <td className="py-2 pr-2 font-mono">{String(ent?.account_code)}</td>
                              <td className="py-2 pr-2 text-right">{Number(ent?.amount).toLocaleString()}</td>
                              <td className="py-2 pr-2">
                                <div className="flex flex-wrap gap-1">
                                  {types.map((t) => {
                                    let cls = 'bg-slate-200 text-slate-700';
                                    if (t.includes('After')) cls = 'bg-orange-100 text-orange-800';
                                    else if (t.includes('No Contract')) cls = 'bg-red-100 text-red-800';
                                    else if (t.includes('Large')) cls = 'bg-orange-50 text-orange-800';
                                    else if (t.includes('Round')) cls = 'bg-slate-200 text-slate-600';
                                    return (
                                      <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded-full ${cls}`}>
                                        {t}
                                      </span>
                                    );
                                  })}
                                </div>
                              </td>
                              <td className="py-2 pr-2 font-bold">{String(row.risk || '').toUpperCase()}</td>
                              <td className="py-2 pr-2">{String(ent?.posted_by)}</td>
                              <td className="py-2 pr-2 max-w-[220px] text-slate-600 truncate" title={String(row.nova_assessment || '')}>
                                {(() => {
                                  const s = String(row.nova_assessment || '');
                                  return s.length > 100 ? `${s.slice(0, 100)}…` : s;
                                })()}
                              </td>
                              <td className="py-2">
                                <button
                                  type="button"
                                  disabled={reviewed}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setReviewedEntries((prev) => new Set(prev).add(idx));
                                  }}
                                  className={`text-xs px-2 py-1 rounded-lg font-medium ${
                                    reviewed ? 'bg-emerald-100 text-emerald-800 cursor-default' : 'bg-white border border-slate-200 hover:bg-slate-50'
                                  }`}
                                >
                                  {reviewed ? 'Reviewed ✓' : 'Mark as Reviewed'}
                                </button>
                              </td>
                            </tr>
                            {open ? (
                              <tr className={reviewed ? 'bg-slate-100 text-slate-500' : 'bg-blue-50/40'}>
                                <td colSpan={8} className="py-3 px-3 text-sm italic border-b">
                                  <span className="font-semibold not-italic">AI assessment: </span>
                                  {String(row.nova_assessment || '')}
                                  <span className="block mt-2 not-italic text-slate-700 text-xs">
                                    Suggested action: {String(row.action_required || '')}
                                  </span>
                                </td>
                              </tr>
                            ) : null}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div
                  className="rounded-xl p-4 text-sm italic border border-blue-100"
                  style={{ backgroundColor: 'rgba(29, 78, 216, 0.08)' }}
                >
                  <p className="font-semibold not-italic mb-1" style={{ color: REV_REC_BLUE }}>
                    Nova batch summary
                  </p>
                  {String(anomalyResult.nova_batch_summary || '')}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {/* Module 4 */}
        <section className="bg-white rounded-2xl shadow-lg border border-slate-200 mb-8 overflow-hidden">
          <div className="px-6 py-3 text-white font-semibold" style={{ backgroundColor: REV_REC_NAVY }}>
            RPO Movement
          </div>
          <div className="grid lg:grid-cols-2 gap-8 p-6">
            <div className="space-y-3">
              {(
                [
                  ['opening_rpo', 'Opening RPO ($)'],
                  ['new_contracts_value', 'New contracts value ($)'],
                  ['modifications_net', 'Modifications net ($)'],
                  ['revenue_recognised', 'Revenue recognised ($)'],
                  ['cancellations', 'Cancellations ($)'],
                  ['closing_rpo_per_disclosure', 'Disclosed closing RPO ($)'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block text-sm">
                  <span className="text-slate-600 font-medium">{label}</span>
                  <input
                    type="number"
                    className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2"
                    value={rpoInput[key]}
                    onChange={(e) => setRpoInput((s) => ({ ...s, [key]: parseFloat(e.target.value) || 0 }))}
                  />
                </label>
              ))}
              <p className="text-xs text-slate-500">Enter the RPO figure from your IFRS 15 disclosure draft</p>
              <button
                type="button"
                disabled={rpoLoading}
                onClick={runRpo}
                className="w-full py-3 rounded-xl text-white font-semibold flex justify-center gap-2"
                style={{ backgroundColor: REV_REC_NAVY }}
              >
                {rpoLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                Reconcile RPO
              </button>
            </div>
            <div>
              {!rpoResult ? (
                <p className="text-slate-500 text-sm">Results appear here after you run the reconciliation.</p>
              ) : (
                <RpoCommissionResult
                  lines={rpoResult.movement_lines as Record<string, unknown>[]}
                  reconciled={rpoResult.reconciled === true}
                  nova={String(rpoResult.nova_commentary || '')}
                />
              )}
            </div>
          </div>
        </section>

        {/* Module 5 */}
        <section className="bg-white rounded-2xl shadow-lg border border-slate-200 mb-8 overflow-hidden">
          <div className="px-6 py-3 text-white font-semibold" style={{ backgroundColor: REV_REC_NAVY }}>
            Commission Asset
          </div>
          <div className="grid lg:grid-cols-2 gap-8 p-6">
            <div className="space-y-3">
              {(
                [
                  ['opening_asset', 'Opening asset ($)'],
                  ['new_commissions_capitalised', 'New commissions capitalised ($)'],
                  ['monthly_amortisation', 'Monthly amortisation ($)'],
                  ['gl_closing_balance', 'GL closing balance ($)'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block text-sm">
                  <span className="text-slate-600 font-medium">{label}</span>
                  <input
                    type="number"
                    className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2"
                    value={commissionInput[key]}
                    onChange={(e) =>
                      setCommissionInput((s) => ({ ...s, [key]: parseFloat(e.target.value) || 0 }))
                    }
                  />
                </label>
              ))}
              <button
                type="button"
                disabled={commissionLoading}
                onClick={runCommission}
                className="w-full py-3 rounded-xl text-white font-semibold flex justify-center gap-2"
                style={{ backgroundColor: REV_REC_NAVY }}
              >
                {commissionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                Reconcile Commission Asset
              </button>
            </div>
            <div>
              {!commissionResult ? (
                <p className="text-slate-500 text-sm">Results appear here after you run the reconciliation.</p>
              ) : (
                <CommissionTable result={commissionResult} />
              )}
            </div>
          </div>
        </section>

        {/* Module 6 */}
        <section className="bg-white rounded-2xl shadow-lg border border-slate-200 mb-8 overflow-hidden">
          <div className="px-6 py-3 text-white font-semibold" style={{ backgroundColor: REV_REC_NAVY }}>
            AI Commentary Generator
          </div>
          <div className="p-6 space-y-4">
            <label className="block text-sm max-w-md">
              <span className="text-slate-600 font-medium">Reconciliation type</span>
              <select
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2"
                value={commentaryType}
                onChange={(e) => setCommentaryType(e.target.value)}
              >
                {['Deferred Revenue', 'Three-Way Match', 'RPO Movement', 'Commission Asset', 'Custom'].map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-600 font-medium">Reconciling items</span>
              <textarea
                className="mt-1 w-full min-h-[140px] border border-slate-200 rounded-lg px-3 py-2 font-mono text-sm"
                placeholder={`Paste or describe each reconciling item. E.g.:\nItem 1: Contract TR-001 — billing shows $12,000 but GL shows $10,500. Difference $1,500. Contract renewal not yet activated.`}
                value={commentaryItemsText}
                onChange={(e) => setCommentaryItemsText(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600 font-medium">Prior period items (optional)</span>
              <textarea
                className="mt-1 w-full min-h-[80px] border border-slate-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Paste prior period items for trend comparison (optional)"
                value={commentaryPriorText}
                onChange={(e) => setCommentaryPriorText(e.target.value)}
              />
            </label>
            <div>
              <p className="text-sm font-medium text-slate-600 mb-2">Risk level</p>
              <div className="flex gap-2">
                {(['low', 'medium', 'high'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setCommentaryRisk(r)}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold border-2 ${
                      commentaryRisk === r
                        ? r === 'high'
                          ? 'border-red-500 bg-red-50 text-red-800'
                          : r === 'medium'
                            ? 'border-amber-500 bg-amber-50 text-amber-900'
                            : 'border-emerald-500 bg-emerald-50 text-emerald-800'
                        : 'border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    {r.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            {hasAutoFillSource ? (
              <button
                type="button"
                onClick={autoFillFromResults}
                className="text-sm font-semibold underline decoration-blue-600"
                style={{ color: REV_REC_BLUE }}
              >
                Auto-fill from above results →
              </button>
            ) : null}
            <button
              type="button"
              disabled={commentaryLoading}
              onClick={runCommentary}
              className="px-6 py-3 rounded-xl text-white font-semibold flex items-center gap-2"
              style={{ backgroundColor: REV_REC_NAVY }}
            >
              {commentaryLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              Generate Commentary
            </button>

            {commentaryResult ? (
              <div className="space-y-4 pt-4 border-t border-slate-100">
                <div className="flex flex-wrap gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      const items = (commentaryResult.commentary_per_item as Record<string, unknown>[]) || [];
                      const blob = items
                        .map((it) => `${it.item_description}\n${it.commentary}\n`)
                        .join('\n---\n\n');
                      copyText(`${blob}\nOverall:\n${commentaryResult.overall_assessment}`, 'Commentary copied');
                    }}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50"
                  >
                    <Copy className="w-4 h-4" /> Copy All Commentary
                  </button>
                  <button
                    type="button"
                    onClick={downloadWordCommentary}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-white text-sm font-medium"
                    style={{ backgroundColor: REV_REC_BLUE }}
                  >
                    Download as Word Doc
                  </button>
                </div>
                {((commentaryResult.commentary_per_item as Record<string, unknown>[]) || []).map((it, i) => (
                  <div key={i} className="rounded-xl border border-slate-200 overflow-hidden relative">
                    <button
                      type="button"
                      className="absolute top-3 right-3 text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-50"
                      onClick={() => copyText(`${it.item_description}\n${it.commentary}`)}
                    >
                      Copy
                    </button>
                    <div className="px-4 py-3 font-bold" style={{ color: REV_REC_NAVY }}>
                      {String(it.item_description || '')}
                    </div>
                    <div className="px-4 pb-4 text-sm text-slate-700 bg-slate-50 font-serif leading-relaxed whitespace-pre-wrap">
                      {String(it.commentary || '')}
                    </div>
                  </div>
                ))}
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-2 text-white font-semibold" style={{ backgroundColor: REV_REC_NAVY }}>
                    Overall Period Assessment
                  </div>
                  <div className="p-4 text-sm font-serif text-slate-800 bg-slate-50 whitespace-pre-wrap">
                    {String(commentaryResult.overall_assessment || '')}
                  </div>
                  <div className="px-4 pb-4 flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-500">Risk rating</span>
                    <span className="text-xs px-2 py-1 rounded-full bg-slate-200 font-bold">
                      {String(commentaryResult.risk_rating || '').toUpperCase()}
                    </span>
                  </div>
                </div>
                <ol className="list-none pl-0 space-y-2 text-sm text-slate-700">
                  {((commentaryResult.recommended_actions as string[]) || []).map((a, i) => (
                    <li key={i} className="flex gap-2 items-start">
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-xs font-bold text-slate-600"
                        aria-hidden
                      >
                        {i + 1}
                      </span>
                      <span className="pt-0.5">{a}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
        </section>

        {/* Period close */}
        <section
          className={`rounded-2xl shadow-lg border overflow-hidden mb-8 ${
            modulesCompleteCount < 3 ? 'opacity-60 border-slate-200' : 'border-slate-200 bg-white'
          }`}
        >
          <div className="px-6 py-3 text-white font-semibold" style={{ backgroundColor: REV_REC_NAVY }}>
            Period Close Summary
          </div>
          <div className="p-6 space-y-4">
            {modulesCompleteCount < 3 ? (
              <div>
                <p className="text-slate-600 mb-2">Run at least 3 modules above to generate the period close summary.</p>
                <p className="text-sm font-medium text-slate-500">
                  {modulesCompleteCount} / 3 modules complete
                </p>
                <div className="h-2 mt-2 w-full max-w-md bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(modulesCompleteCount / 3) * 100}%`,
                      backgroundColor: REV_REC_BLUE,
                    }}
                  />
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={periodCloseLoading}
                onClick={runPeriodClose}
                className="w-full sm:w-auto px-8 py-3 rounded-xl text-white font-bold disabled:opacity-60 flex items-center justify-center gap-2 bg-gradient-to-r from-[#0F2D5E] to-[#1D4ED8]"
              >
                {periodCloseLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                Generate Period Close Report
              </button>
            )}

            {periodCloseResult ? (
              <div className="space-y-6 pt-4 border-t border-slate-100">
                {(() => {
                  const st = String(periodCloseResult.overall_status || '');
                  const isClean = st === 'Clean';
                  const isHigh = st === 'High Risk';
                  const banner = isClean
                    ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                    : isHigh
                      ? 'bg-red-100 text-red-900 border-red-300'
                      : 'bg-amber-100 text-amber-900 border-amber-300';
                  const msg = isClean ? '✓ CLEAN PERIOD' : isHigh ? '✗ HIGH RISK — ESCALATE' : '⚠ EXCEPTIONS NOTED';
                  return <div className={`w-full text-center py-4 rounded-xl font-bold border-2 ${banner}`}>{msg}</div>;
                })()}
                <div className="flex flex-wrap gap-2">
                  {((periodCloseResult.module_statuses as Record<string, unknown>[]) || []).map((m, i) => (
                    <span key={i} className="text-xs px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-slate-800">
                      {String(m.module)}: {String(m.detail)}
                    </span>
                  ))}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-600 border-b">
                        <th className="py-2 pr-2">Priority</th>
                        <th className="py-2 pr-2">Action</th>
                        <th className="py-2 pr-2">Owner</th>
                        <th className="py-2">Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {((periodCloseResult.action_items as Record<string, unknown>[]) || []).map((a, i) => {
                        const p = String(a.priority || '').toUpperCase();
                        const border =
                          p === 'HIGH' ? 'border-l-4 border-red-500' : p === 'MEDIUM' ? 'border-l-4 border-amber-500' : '';
                        return (
                          <tr key={i} className={`border-t border-slate-100 ${border}`}>
                            <td className="py-2 pr-2 font-bold">{p}</td>
                            <td className="py-2 pr-2">{String(a.description)}</td>
                            <td className="py-2 pr-2">{String(a.owner)}</td>
                            <td className="py-2">{String(a.due_date)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 text-white" style={{ backgroundColor: REV_REC_NAVY }}>
                    <span className="font-semibold">Executive summary</span>
                    <button
                      type="button"
                      onClick={() => copyText(String(periodCloseResult.nova_executive_summary || ''), 'Summary copied')}
                      className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20"
                    >
                      Copy
                    </button>
                  </div>
                  <div className="p-4 text-sm font-serif text-slate-800 bg-slate-50 whitespace-pre-wrap">
                    {String(periodCloseResult.nova_executive_summary || '')}
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
                  <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-600 text-xs font-semibold px-3 py-1 border border-slate-200 w-fit">
                    6 sheets
                  </span>
                  <button
                    type="button"
                    disabled={periodCloseExcelLoading}
                    onClick={handleDownloadPeriodCloseExcel}
                    className="flex-1 min-w-[240px] py-3 rounded-xl text-white font-semibold disabled:opacity-60 flex items-center justify-center gap-2 bg-gradient-to-r from-[#0F2D5E] to-[#1D4ED8] shadow-sm hover:opacity-95"
                  >
                    {periodCloseExcelLoading ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden /> : null}
                    {periodCloseExcelLoading ? 'Generating…' : 'Download Period Close Pack (Excel) ↓'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function RpoCommissionResult({
  lines,
  reconciled,
  nova,
}: {
  lines: Record<string, unknown>[];
  reconciled: boolean;
  nova: string;
}) {
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto border border-slate-100 rounded-xl">
        <table className="w-full text-sm">
          <tbody>
            {(lines || []).map((line, idx) => (
              <tr key={idx} className="border-t border-slate-100">
                <td className="px-3 py-2">{String(line.label)}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {typeof line.amount === 'number' ? line.amount.toLocaleString() : String(line.amount ?? '')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {reconciled ? (
        <span className="inline-flex items-center gap-1 px-4 py-2 rounded-full bg-emerald-100 text-emerald-800 font-bold">
          <Check className="w-4 h-4" /> RECONCILED ✓
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 px-4 py-2 rounded-full bg-red-100 text-red-800 font-bold">
          <AlertTriangle className="w-4 h-4" /> DIFFERENCE — REVIEW REQUIRED
        </span>
      )}
      <div className="rounded-xl p-4 text-sm italic border border-blue-100" style={{ backgroundColor: 'rgba(29, 78, 216, 0.08)' }}>
        <p className="font-semibold not-italic mb-1" style={{ color: REV_REC_BLUE }}>
          AI Insight
        </p>
        {nova}
      </div>
    </div>
  );
}

function CommissionTable({ result }: { result: Record<string, unknown> }) {
  const amort = Number(result.amortisation) || 0;
  const rows: [string, number | string, boolean][] = [
    ['Opening asset', Number(result.opening_asset) || 0, false],
    ['+ New commissions', Number(result.new_commissions) || 0, false],
    ['− Monthly amortisation', amort, true],
    ['Expected closing', Number(result.expected_closing) || 0, false],
    ['GL closing balance', Number(result.gl_closing_balance) || 0, false],
    ['Difference', Number(result.difference) || 0, false],
  ];
  return (
    <div className="space-y-4">
      <table className="w-full text-sm border border-slate-100 rounded-xl overflow-hidden">
        <tbody>
          {rows.map(([label, val, paren], idx) => (
            <tr key={idx} className="border-t border-slate-100 first:border-t-0">
              <td className="px-3 py-2">{label}</td>
              <td className="px-3 py-2 text-right font-mono">
                {typeof val === 'number'
                  ? paren
                    ? `(${Number(val).toLocaleString()})`
                    : Number(val).toLocaleString()
                  : val}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.reconciled === true ? (
        <span className="inline-flex items-center gap-1 px-4 py-2 rounded-full bg-emerald-100 text-emerald-800 font-bold">
          <Check className="w-4 h-4" /> RECONCILED ✓
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 px-4 py-2 rounded-full bg-red-100 text-red-800 font-bold">
          <AlertTriangle className="w-4 h-4" /> DIFFERENCE — REVIEW REQUIRED
        </span>
      )}
      <div className="rounded-xl p-4 text-sm italic border border-blue-100" style={{ backgroundColor: 'rgba(29, 78, 216, 0.08)' }}>
        <p className="font-semibold not-italic mb-1" style={{ color: REV_REC_BLUE }}>
          AI Insight
        </p>
        {String(result.nova_commentary || '')}
      </div>
    </div>
  );
}
