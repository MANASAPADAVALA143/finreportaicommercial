/**
 * AP dashboard calculations. Every tab derives its figures from these functions
 * over the same company-scoped invoice list, so a number shown on two tabs is
 * always computed once, the same way.
 */
import type { Invoice } from '@/lib/ap-invoice/supabase';
import {
  getEffectiveExtractionScore,
  getParsedFieldConfidences,
  invoiceNeedsExtractionReview,
} from '@/utils/extractionConfidence';
import {
  effectivePaymentDate,
  isInvoiceOpenForPayment,
  isInvoiceOverdueByDate,
  normalizedOpenPaymentStatus,
} from '@/lib/ap-invoice/paymentStatus';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function amountOf(inv: Pick<Invoice, 'total_amount'>): number {
  const n = Number(inv.total_amount);
  return Number.isFinite(n) ? n : 0;
}

export function taxOf(inv: Pick<Invoice, 'tax_amount'>): number {
  const n = Number(inv.tax_amount ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Business date of an invoice (YYYY-MM-DD): invoice_date, falling back to created_at. */
export function invoiceDay(inv: Pick<Invoice, 'invoice_date' | 'created_at'>): string {
  return String(inv.invoice_date || inv.created_at || '').slice(0, 10);
}

export function monthKeyOf(inv: Pick<Invoice, 'invoice_date' | 'created_at'>): string {
  return invoiceDay(inv).slice(0, 7);
}

export function localDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  const idx = Number(m) - 1;
  return `${MONTH_SHORT[idx] ?? m} ${String(y).slice(2)}`;
}

function addMonths(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

function lastDayOfMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m, 0).getDate();
  return `${key}-${String(d).padStart(2, '0')}`;
}

export function daysBetween(fromDay: string, toDay: string): number {
  const a = Date.UTC(+fromDay.slice(0, 4), +fromDay.slice(5, 7) - 1, +fromDay.slice(8, 10));
  const b = Date.UTC(+toDay.slice(0, 4), +toDay.slice(5, 7) - 1, +toDay.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

// ── Date range ───────────────────────────────────────────────────────────────

export type RangePreset =
  | 'all'
  | 'this_month'
  | 'last_month'
  | 'last_3m'
  | 'last_6m'
  | 'ytd'
  | 'last_12m'
  | 'custom';

export const RANGE_PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'last_3m', label: 'Last 3 months' },
  { id: 'last_6m', label: 'Last 6 months' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'last_12m', label: 'Last 12 months' },
  { id: 'custom', label: 'Custom range' },
];

export type ResolvedRange = { preset: RangePreset; from: string | null; to: string | null; label: string };

export function resolveRange(
  preset: RangePreset,
  now: Date,
  custom?: { from?: string | null; to?: string | null },
): ResolvedRange {
  const thisMonth = localDay(now).slice(0, 7);
  const label = RANGE_PRESETS.find((p) => p.id === preset)?.label ?? 'All time';
  switch (preset) {
    case 'this_month':
      return { preset, from: `${thisMonth}-01`, to: lastDayOfMonth(thisMonth), label };
    case 'last_month': {
      const k = addMonths(thisMonth, -1);
      return { preset, from: `${k}-01`, to: lastDayOfMonth(k), label };
    }
    case 'last_3m':
      return { preset, from: `${addMonths(thisMonth, -2)}-01`, to: lastDayOfMonth(thisMonth), label };
    case 'last_6m':
      return { preset, from: `${addMonths(thisMonth, -5)}-01`, to: lastDayOfMonth(thisMonth), label };
    case 'last_12m':
      return { preset, from: `${addMonths(thisMonth, -11)}-01`, to: lastDayOfMonth(thisMonth), label };
    case 'ytd':
      return { preset, from: `${thisMonth.slice(0, 4)}-01-01`, to: localDay(now), label };
    case 'custom': {
      const from = custom?.from || null;
      const to = custom?.to || null;
      if (from && to && from > to) return { preset, from: to, to: from, label };
      return { preset, from, to, label };
    }
    default:
      return { preset: 'all', from: null, to: null, label: 'All time' };
  }
}

export function isInRange(inv: Invoice, range: ResolvedRange): boolean {
  if (!range.from && !range.to) return true;
  const day = invoiceDay(inv);
  if (!day) return false;
  if (range.from && day < range.from) return false;
  if (range.to && day > range.to) return false;
  return true;
}

export function filterByRange(invoices: Invoice[], range: ResolvedRange): Invoice[] {
  if (!range.from && !range.to) return invoices;
  return invoices.filter((inv) => isInRange(inv, range));
}

// ── KPI cards (fixed definitions, independent of the selected range) ─────────

export const isPendingApproval = (inv: Pick<Invoice, 'status'>) => inv.status === 'Processing';

export type KpiSummary = {
  totalInvoices: number;
  pendingApprovals: number;
  monthKey: string;
  monthInvoiceCount: number;
  monthTotal: number;
  monthTax: number;
  otherCurrencies: { currency: string; total: number; tax: number; count: number }[];
};

export function computeKpis(invoices: Invoice[], baseCurrency: string, now: Date): KpiSummary {
  const monthKey = localDay(now).slice(0, 7);
  const base = baseCurrency.toUpperCase();
  const byCurrency: Record<string, { total: number; tax: number; count: number }> = {};
  let monthInvoiceCount = 0;
  for (const inv of invoices) {
    if (monthKeyOf(inv) !== monthKey) continue;
    monthInvoiceCount += 1;
    const c = (inv.currency || base).toUpperCase();
    byCurrency[c] ??= { total: 0, tax: 0, count: 0 };
    byCurrency[c].total += amountOf(inv);
    byCurrency[c].tax += taxOf(inv);
    byCurrency[c].count += 1;
  }
  return {
    totalInvoices: invoices.length,
    pendingApprovals: invoices.filter(isPendingApproval).length,
    monthKey,
    monthInvoiceCount,
    monthTotal: byCurrency[base]?.total ?? 0,
    monthTax: byCurrency[base]?.tax ?? 0,
    otherCurrencies: Object.entries(byCurrency)
      .filter(([c]) => c !== base)
      .map(([currency, v]) => ({ currency, ...v })),
  };
}

// ── Currency / data-quality notes ────────────────────────────────────────────

export function currencyMix(invoices: Invoice[], baseCurrency: string) {
  const base = baseCurrency.toUpperCase();
  const foreign: Record<string, number> = {};
  for (const inv of invoices) {
    const c = (inv.currency || base).toUpperCase();
    if (c !== base) foreign[c] = (foreign[c] ?? 0) + 1;
  }
  const entries = Object.entries(foreign).map(([currency, count]) => ({ currency, count }));
  return { mixed: entries.length > 0, foreign: entries, foreignCount: entries.reduce((s, e) => s + e.count, 0) };
}

export function sumAmount(invoices: Invoice[]): number {
  return invoices.reduce((s, inv) => s + amountOf(inv), 0);
}

export function sumTax(invoices: Invoice[]): number {
  return invoices.reduce((s, inv) => s + taxOf(inv), 0);
}

// ── Status distribution ──────────────────────────────────────────────────────

export const STATUS_ORDER = ['Processing', 'Approved', 'Paid', 'On Hold', 'Queried', 'Rejected'] as const;

export function statusDistribution(invoices: Invoice[]) {
  const counts: Record<string, { count: number; amount: number }> = {};
  for (const inv of invoices) {
    const s = inv.status || 'Unknown';
    counts[s] ??= { count: 0, amount: 0 };
    counts[s].count += 1;
    counts[s].amount += amountOf(inv);
  }
  const known = STATUS_ORDER.filter((s) => counts[s]).map((s) => ({ status: s as string, ...counts[s] }));
  const extra = Object.keys(counts)
    .filter((s) => !(STATUS_ORDER as readonly string[]).includes(s))
    .map((s) => ({ status: s, ...counts[s] }));
  return [...known, ...extra];
}

// ── Monthly series ───────────────────────────────────────────────────────────

export function monthKeysForRange(
  range: ResolvedRange,
  invoices: Invoice[],
  maxMonths = 12,
): { keys: string[]; truncated: boolean } {
  let start: string | null = range.from ? range.from.slice(0, 7) : null;
  let end: string | null = range.to ? range.to.slice(0, 7) : null;
  if (!start || !end) {
    const months = invoices.map(monthKeyOf).filter(Boolean).sort();
    if (!start) start = months[0] ?? null;
    if (!end) end = months[months.length - 1] ?? null;
  }
  if (!start || !end) return { keys: [], truncated: false };
  const keys: string[] = [];
  for (let k = start; k <= end && keys.length < 600; k = addMonths(k, 1)) keys.push(k);
  if (keys.length > maxMonths) return { keys: keys.slice(-maxMonths), truncated: true };
  return { keys, truncated: false };
}

export type MonthPoint = { key: string; label: string; amount: number; tax: number; count: number };

export function monthlySeries(invoices: Invoice[], keys: string[]): MonthPoint[] {
  const map = new Map<string, MonthPoint>(
    keys.map((k) => [k, { key: k, label: monthLabel(k), amount: 0, tax: 0, count: 0 }]),
  );
  for (const inv of invoices) {
    const p = map.get(monthKeyOf(inv));
    if (!p) continue;
    p.amount += amountOf(inv);
    p.tax += taxOf(inv);
    p.count += 1;
  }
  return keys.map((k) => map.get(k)!);
}

// ── Grouping (vendors, GL, cost centres, categories) ─────────────────────────

export type SpendRow = { key: string; name: string; amount: number; count: number };

export function groupSpend(
  invoices: Invoice[],
  keyOf: (inv: Invoice) => string | null | undefined,
  nameOf?: (inv: Invoice) => string | null | undefined,
): { rows: SpendRow[]; unassigned: { amount: number; count: number } } {
  const map = new Map<string, SpendRow>();
  const unassigned = { amount: 0, count: 0 };
  for (const inv of invoices) {
    const raw = keyOf(inv);
    const key = raw == null ? '' : String(raw).trim();
    if (!key) {
      unassigned.amount += amountOf(inv);
      unassigned.count += 1;
      continue;
    }
    const row = map.get(key) ?? { key, name: String(nameOf?.(inv) || key).trim() || key, amount: 0, count: 0 };
    row.amount += amountOf(inv);
    row.count += 1;
    map.set(key, row);
  }
  return { rows: [...map.values()].sort((a, b) => b.amount - a.amount), unassigned };
}

export const vendorKey = (inv: Invoice) => (inv.vendor_name || '').trim();
export const glCodeOf = (inv: Invoice) => (inv.gl_account_code ?? inv.gl_code ?? '').trim();
export const glNameOf = (inv: Invoice) => (inv.gl_account_name ?? inv.gl_name ?? '').trim();
export const costCenterOf = (inv: Invoice) => (inv.cost_center ?? '').trim();
export const categoryOf = (inv: Invoice) =>
  (inv.expense_category || inv.ifrs_category || '').trim();

/** Monthly amount per group for the top N groups (line charts). */
export function groupTrend(
  invoices: Invoice[],
  keys: string[],
  groups: string[],
  keyOf: (inv: Invoice) => string,
): Record<string, number | string>[] {
  const index = new Map(keys.map((k, i) => [k, i]));
  const rows = keys.map((k) => {
    const row: Record<string, number | string> = { key: k, label: monthLabel(k) };
    for (const g of groups) row[g] = 0;
    return row;
  });
  const wanted = new Set(groups);
  for (const inv of invoices) {
    const g = keyOf(inv);
    if (!wanted.has(g)) continue;
    const i = index.get(monthKeyOf(inv));
    if (i == null) continue;
    rows[i][g] = Number(rows[i][g]) + amountOf(inv);
  }
  return rows;
}

export type VendorRow = SpendRow & {
  pending: number;
  approved: number;
  paid: number;
  other: number;
  lastInvoiceDay: string;
};

export function vendorBreakdown(invoices: Invoice[]): VendorRow[] {
  const map = new Map<string, VendorRow>();
  for (const inv of invoices) {
    const key = vendorKey(inv) || 'Unknown vendor';
    const row =
      map.get(key) ??
      { key, name: key, amount: 0, count: 0, pending: 0, approved: 0, paid: 0, other: 0, lastInvoiceDay: '' };
    row.amount += amountOf(inv);
    row.count += 1;
    if (inv.status === 'Processing') row.pending += 1;
    else if (inv.status === 'Approved') row.approved += 1;
    else if (inv.status === 'Paid') row.paid += 1;
    else row.other += 1;
    const d = invoiceDay(inv);
    if (d > row.lastInvoiceDay) row.lastInvoiceDay = d;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

// ── AP aging (same rule as backend ap_aging_service / AP Aging report) ───────

export const AGING_BUCKETS = [
  { key: 'current', label: 'Current' },
  { key: '1_30', label: '1–30 days' },
  { key: '31_60', label: '31–60 days' },
  { key: '61_90', label: '61–90 days' },
  { key: '90_plus', label: '90+ days' },
] as const;

export type AgingBucketKey = (typeof AGING_BUCKETS)[number]['key'];

export function agingBucketKey(daysOverdue: number): AgingBucketKey {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '1_30';
  if (daysOverdue <= 60) return '31_60';
  if (daysOverdue <= 90) return '61_90';
  return '90_plus';
}

export function isOpenForAging(inv: Invoice): boolean {
  return isInvoiceOpenForPayment(inv) && Boolean(inv.due_date?.slice(0, 10)) && amountOf(inv) > 0;
}

export function computeAging(invoices: Invoice[], today: string) {
  const buckets = AGING_BUCKETS.map((b) => ({ ...b, amount: 0, count: 0 }));
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  let totalOutstanding = 0;
  let openCount = 0;
  for (const inv of invoices) {
    if (!isOpenForAging(inv)) continue;
    const days = daysBetween(inv.due_date.slice(0, 10), today);
    const b = byKey.get(agingBucketKey(days))!;
    b.amount += amountOf(inv);
    b.count += 1;
    totalOutstanding += amountOf(inv);
    openCount += 1;
  }
  const current = byKey.get('current')!;
  return {
    buckets,
    totalOutstanding,
    openCount,
    totalOverdue: totalOutstanding - current.amount,
    overdueCount: openCount - current.count,
    maxAmount: Math.max(1, ...buckets.map((b) => b.amount)),
  };
}

// ── Processing pipeline ──────────────────────────────────────────────────────

export const isFullyMatched = (inv: Invoice) =>
  inv.match_status === 'three_way_matched' || inv.match_status === 'matched';
export const isGlCoded = (inv: Invoice) => Boolean(glCodeOf(inv));
export const isIfrsClassified = (inv: Invoice) => Boolean(inv.ifrs_category?.trim());
export const isPaid = (inv: Invoice) => normalizedOpenPaymentStatus(inv) === 'paid';

/** A saved risk assessment: a numeric/tiered risk_score or a risk_level. A missing score is not "low risk". */
export const hasRiskScore = (inv: Invoice) =>
  (inv.risk_score != null && String(inv.risk_score).trim() !== '') || Boolean(String(inv.risk_level ?? '').trim());

const NON_AI_SOURCES = new Set(['excel', 'excel_vba', 'manual']);

/**
 * Pipeline stages are independent checks, not a strict sequence (an invoice can be GL-coded
 * before it is approved), so each stage's rate is done ÷ invoices the stage applies to.
 *  - done: completed successfully
 *  - pending: not started / waiting
 *  - issue: ran but needs attention (low confidence, match exception, rejected/on hold, flags without a saved score)
 *  - na: the stage does not apply (e.g. Excel imports are not AI-extracted; unapproved invoices are not due for payment)
 */
export type StageState = 'done' | 'pending' | 'issue' | 'na';

export const PIPELINE_STAGES = [
  {
    key: 'uploaded',
    label: 'Uploaded',
    definition: 'Invoice record exists for this organization.',
    pendingLabel: '',
    issueLabel: '',
    naLabel: '',
  },
  {
    key: 'extracted',
    label: 'AI Extracted',
    definition:
      'Extraction confidence of 70% or more. Excel and manual entries are not AI-extracted, but are still flagged when key fields are incomplete.',
    pendingLabel: '',
    issueLabel: 'need manual review',
    naLabel: 'Excel / manual, complete',
  },
  {
    key: 'classified',
    label: 'IFRS Classified',
    definition: 'An IFRS category is assigned.',
    pendingLabel: 'not classified',
    issueLabel: '',
    naLabel: '',
  },
  {
    key: 'matched',
    label: '3-Way Matched',
    definition: 'Invoice, PO and GRN agree (match status matched).',
    pendingLabel: 'match not run',
    issueLabel: 'partial / mismatch / no PO',
    naLabel: '',
  },
  {
    key: 'risk',
    label: 'Risk Scored',
    definition: 'A risk score or level is saved on the invoice. Missing scores are not treated as low risk.',
    pendingLabel: 'not scored',
    issueLabel: 'flags saved, score missing',
    naLabel: '',
  },
  {
    key: 'approved',
    label: 'Approved',
    definition: 'Status is Approved or Paid.',
    pendingLabel: 'awaiting approval',
    issueLabel: 'rejected / on hold / queried',
    naLabel: '',
  },
  {
    key: 'gl',
    label: 'GL Coded',
    definition: 'A GL account code is assigned.',
    pendingLabel: 'no GL code',
    issueLabel: '',
    naLabel: '',
  },
  {
    key: 'paid',
    label: 'Paid',
    definition: 'Payment recorded. Only approved invoices are expected to be paid.',
    pendingLabel: 'approved, unpaid',
    issueLabel: '',
    naLabel: 'not yet approved',
  },
] as const;

export type PipelineStageKey = (typeof PIPELINE_STAGES)[number]['key'];
export const PIPELINE_STAGE_KEYS = new Set<string>(PIPELINE_STAGES.map((s) => s.key));

export function pipelineState(inv: Invoice, key: PipelineStageKey): StageState {
  switch (key) {
    case 'uploaded':
      return 'done';
    case 'extracted':
      if (invoiceNeedsExtractionReview(inv)) return 'issue';
      return NON_AI_SOURCES.has(String(inv.source || '').toLowerCase()) ? 'na' : 'done';
    case 'classified':
      return isIfrsClassified(inv) ? 'done' : 'pending';
    case 'matched': {
      const s = String(inv.match_status || '').toLowerCase();
      if (s === 'three_way_matched' || s === 'matched') return 'done';
      if (s === 'partial' || s === 'mismatch' || s === 'no_po') return 'issue';
      return 'pending';
    }
    case 'risk':
      if (hasRiskScore(inv)) return 'done';
      return parseRiskFlags(inv).length ? 'issue' : 'pending';
    case 'approved':
      if (inv.status === 'Approved' || inv.status === 'Paid') return 'done';
      if (inv.status === 'Processing') return 'pending';
      return 'issue';
    case 'gl':
      return isGlCoded(inv) ? 'done' : 'pending';
    case 'paid':
      if (isPaid(inv)) return 'done';
      return inv.status === 'Approved' ? 'pending' : 'na';
  }
}

export type PipelineStage = (typeof PIPELINE_STAGES)[number] & {
  done: number;
  pending: number;
  issue: number;
  na: number;
  /** done + pending + issue */
  applicable: number;
  /** done ÷ applicable, or null when the stage applies to no invoice */
  rate: number | null;
};

export function pipelineStages(invoices: Invoice[]): PipelineStage[] {
  return PIPELINE_STAGES.map((def) => {
    const c = { done: 0, pending: 0, issue: 0, na: 0 };
    for (const inv of invoices) c[pipelineState(inv, def.key)] += 1;
    const applicable = c.done + c.pending + c.issue;
    return { ...def, ...c, applicable, rate: applicable ? c.done / applicable : null };
  });
}

/** Stage holding the most invoices back (pending + needing attention); ties go to the lower completion rate. */
export function pipelineBottleneck(stages: PipelineStage[]): PipelineStage | null {
  const open = stages.filter((s) => s.key !== 'uploaded' && s.pending + s.issue > 0);
  if (!open.length) return null;
  return open.reduce((a, b) => {
    const wa = a.pending + a.issue;
    const wb = b.pending + b.issue;
    if (wb !== wa) return wb > wa ? b : a;
    return (b.rate ?? 1) < (a.rate ?? 1) ? b : a;
  });
}

// ── Extraction quality ───────────────────────────────────────────────────────

export function extractionQuality(invoices: Invoice[]) {
  const fieldTotals: Record<string, { sum: number; n: number }> = {};
  let scoreSum = 0;
  let withFieldScores = 0;
  for (const inv of invoices) {
    scoreSum += getEffectiveExtractionScore(inv);
    const fields = getParsedFieldConfidences(inv);
    const entries = Object.entries(fields);
    if (entries.length) withFieldScores += 1;
    for (const [f, v] of entries) {
      fieldTotals[f] ??= { sum: 0, n: 0 };
      fieldTotals[f].sum += v;
      fieldTotals[f].n += 1;
    }
  }
  const needsReview = invoices.filter(invoiceNeedsExtractionReview);
  return {
    avgScore: invoices.length ? scoreSum / invoices.length : 0,
    needsReview,
    withFieldScores,
    fields: Object.entries(fieldTotals)
      .map(([field, v]) => ({ field, avg: v.sum / v.n, samples: v.n }))
      .sort((a, b) => a.avg - b.avg),
  };
}

export function avgProcessingSeconds(invoices: Invoice[]): { avg: number; samples: number } {
  const timed = invoices.filter((inv) => inv.processing_time_seconds);
  if (!timed.length) return { avg: 0, samples: 0 };
  const sum = timed.reduce((s, inv) => s + (inv.processing_time_seconds || 0), 0);
  return { avg: Math.round(sum / timed.length), samples: timed.length };
}

export function sourceBreakdown(invoices: Invoice[]) {
  const map: Record<string, number> = {};
  for (const inv of invoices) {
    const s = inv.source || 'upload';
    map[s] = (map[s] ?? 0) + 1;
  }
  return Object.entries(map)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
}

// ── Three-way match (aggregated off invoices.match_status, as the list shows it) ──

export function matchSummary(invoices: Invoice[]) {
  const acc = { full: 0, partial: 0, variance: 0, noPo: 0, notRun: 0, total: 0 };
  for (const inv of invoices) {
    const s = String(inv.match_status || '').toLowerCase();
    if (!s) {
      acc.notRun += 1;
      continue;
    }
    acc.total += 1;
    if (s === 'three_way_matched' || s === 'matched') acc.full += 1;
    else if (s === 'partial') acc.partial += 1;
    else if (s === 'no_po') acc.noPo += 1;
    else if (s === 'mismatch') acc.variance += 1;
  }
  return acc;
}

export const isMatchException = (inv: Invoice) => inv.match_status === 'mismatch' || inv.match_status === 'no_po';

// ── Approvals ────────────────────────────────────────────────────────────────

export type QueueItem = { invoice: Invoice; daysPending: number; level: string };

export function approvalQueue(invoices: Invoice[], today: string): QueueItem[] {
  return invoices
    .filter(isPendingApproval)
    .map((invoice) => {
      const since = String(invoice.submitted_for_approval_at || invoice.created_at || '').slice(0, 10);
      return {
        invoice,
        daysPending: since ? Math.max(0, daysBetween(since, today)) : 0,
        level: invoice.approval_level && invoice.approval_level !== 'none' ? invoice.approval_level : 'unassigned',
      };
    })
    .sort((a, b) => b.daysPending - a.daysPending);
}

export function approvalLevels(queue: QueueItem[]) {
  const map: Record<string, { level: string; count: number; amount: number; daysSum: number; oldest: number }> = {};
  for (const q of queue) {
    map[q.level] ??= { level: q.level, count: 0, amount: 0, daysSum: 0, oldest: 0 };
    const r = map[q.level];
    r.count += 1;
    r.amount += amountOf(q.invoice);
    r.daysSum += q.daysPending;
    r.oldest = Math.max(r.oldest, q.daysPending);
  }
  const rows = Object.values(map).map((r) => ({ ...r, avgDays: r.count ? r.daysSum / r.count : 0 }));
  const bottleneck = rows.length
    ? rows.reduce((a, b) => (b.count > a.count || (b.count === a.count && b.avgDays > a.avgDays) ? b : a))
    : null;
  return { rows: rows.sort((a, b) => b.count - a.count), bottleneck };
}

// ── Risk flags ───────────────────────────────────────────────────────────────

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export const SEVERITY_RANK: Record<Severity, number> = { critical: 3, high: 2, medium: 1, low: 0 };

type ParsedFlag = { message?: string; severity?: Severity };

export function parseRiskFlags(inv: Invoice): ParsedFlag[] {
  try {
    const f = inv.risk_flags;
    if (!f || f === '[]') return [];
    const parsed = Array.isArray(f) ? f : JSON.parse(typeof f === 'string' ? f : '[]');
    return Array.isArray(parsed) ? (parsed as ParsedFlag[]) : [];
  } catch {
    return [];
  }
}

/** Worst flag severity on the invoice, falling back to its own risk_level. */
export function invoiceSeverity(inv: Invoice): Severity | null {
  let worst: Severity | null = null;
  for (const f of parseRiskFlags(inv)) {
    const sev = f?.severity;
    if (sev && sev in SEVERITY_RANK && (!worst || SEVERITY_RANK[sev] > SEVERITY_RANK[worst])) worst = sev;
  }
  if (!worst) {
    // risk_level is saved capitalised ("High"); legacy rows keep a tier in risk_score ("high").
    const lvl = String(inv.risk_level ?? '').trim().toLowerCase();
    const tier = typeof inv.risk_score === 'string' ? inv.risk_score.trim().toLowerCase() : '';
    worst = lvl in SEVERITY_RANK ? (lvl as Severity) : tier in SEVERITY_RANK ? (tier as Severity) : null;
  }
  return worst;
}

export function riskSummary(invoices: Invoice[]) {
  const severityCounts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const flagCounts: Record<string, { count: number; severity: Severity }> = {};
  for (const inv of invoices) {
    const sev = invoiceSeverity(inv);
    if (sev) severityCounts[sev] += 1;
    for (const flag of parseRiskFlags(inv)) {
      const msg = flag?.message ?? 'Unknown';
      const s: Severity = flag?.severity && flag.severity in SEVERITY_RANK ? flag.severity : 'low';
      flagCounts[msg] ??= { count: 0, severity: s };
      flagCounts[msg].count += 1;
      if (SEVERITY_RANK[s] > SEVERITY_RANK[flagCounts[msg].severity]) flagCounts[msg].severity = s;
    }
  }
  const topFlags = Object.entries(flagCounts)
    .map(([message, v]) => ({ message, ...v }))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.count - a.count);
  return {
    severityCounts,
    totalFlagged: Object.values(severityCounts).reduce((a, b) => a + b, 0),
    topFlags,
  };
}

// ── IFRS ─────────────────────────────────────────────────────────────────────

export function ifrsSummary(invoices: Invoice[]) {
  const classifiedRows = groupSpend(invoices, (i) => i.ifrs_category);
  const classified = invoices.length - classifiedRows.unassigned.count;
  return {
    total: invoices.length,
    classified,
    needsReview: classifiedRows.unassigned.count,
    rate: invoices.length ? classified / invoices.length : 0,
    manualOverrides: invoices.filter((i) => i.ifrs_manual_override).length,
    categories: classifiedRows.rows.map((r) => ({
      ...r,
      share: classified ? r.count / classified : 0,
    })),
  };
}

// ── VAT / GST reconciliation status on invoices ─────────────────────────────

export function vatReconStatus(invoices: Invoice[]) {
  const acc = { matched: 0, mismatch: 0, unmatched: 0, ignored: 0, notRun: 0 };
  for (const inv of invoices) {
    const s = inv.gst_recon_status;
    if (s === 'matched') acc.matched += 1;
    else if (s === 'mismatch') acc.mismatch += 1;
    else if (s === 'unmatched') acc.unmatched += 1;
    else if (s === 'ignored') acc.ignored += 1;
    else acc.notRun += 1;
  }
  return acc;
}

// ── Compliance checks (each one an existing definition used elsewhere) ──────

export type ExceptionReason =
  | 'unclassified'
  | 'extraction_review'
  | 'duplicate'
  | 'match_exception'
  | 'vat_mismatch'
  | 'missing_gl'
  | 'high_risk';

export const EXCEPTION_LABEL: Record<ExceptionReason, string> = {
  unclassified: 'IFRS not classified',
  extraction_review: 'Low extraction confidence',
  duplicate: 'Possible duplicate',
  match_exception: '3-way match exception',
  vat_mismatch: 'VAT recon mismatch',
  missing_gl: 'Missing GL code',
  high_risk: 'High / critical risk',
};

export const EXCEPTION_ROUTE: Record<ExceptionReason, string> = {
  unclassified: '/ap-invoices/list?filter=unclassified',
  extraction_review: '/ap-invoices/list?tab=needs-review',
  duplicate: '/ap-invoices/list?filter=duplicates',
  match_exception: '/ap-invoices/list?filter=match_issues',
  vat_mismatch: '/ap-invoices/gst-recon',
  missing_gl: '/ap-invoices/gl-accounts',
  high_risk: '/ap-invoices/list?tab=anomalies',
};

export function exceptionReasons(inv: Invoice): ExceptionReason[] {
  const out: ExceptionReason[] = [];
  if (!isIfrsClassified(inv)) out.push('unclassified');
  if (invoiceNeedsExtractionReview(inv)) out.push('extraction_review');
  if (inv.duplicate_flag === true) out.push('duplicate');
  if (isMatchException(inv)) out.push('match_exception');
  if (inv.gst_recon_status === 'mismatch') out.push('vat_mismatch');
  if (!isGlCoded(inv)) out.push('missing_gl');
  const sev = invoiceSeverity(inv);
  if (sev === 'high' || sev === 'critical') out.push('high_risk');
  return out;
}

export function complianceChecks(invoices: Invoice[]) {
  const counts = Object.fromEntries(
    (Object.keys(EXCEPTION_LABEL) as ExceptionReason[]).map((k) => [k, 0]),
  ) as Record<ExceptionReason, number>;
  let withAny = 0;
  for (const inv of invoices) {
    const reasons = exceptionReasons(inv);
    if (reasons.length) withAny += 1;
    for (const r of reasons) counts[r] += 1;
  }
  return {
    checks: (Object.keys(EXCEPTION_LABEL) as ExceptionReason[]).map((key) => ({
      key,
      label: EXCEPTION_LABEL[key],
      count: counts[key],
      route: EXCEPTION_ROUTE[key],
    })),
    withAny,
    cleanRate: invoices.length ? (invoices.length - withAny) / invoices.length : 0,
  };
}

export function complianceTrend(invoices: Invoice[], keys: string[]) {
  const index = new Map(keys.map((k, i) => [k, i]));
  const rows = keys.map((k) => ({ key: k, label: monthLabel(k), total: 0, exceptions: 0, cleanPct: 0 }));
  for (const inv of invoices) {
    const i = index.get(monthKeyOf(inv));
    if (i == null) continue;
    rows[i].total += 1;
    if (exceptionReasons(inv).length) rows[i].exceptions += 1;
  }
  for (const r of rows) r.cleanPct = r.total ? Math.round(((r.total - r.exceptions) / r.total) * 100) : 0;
  return rows;
}

// ── Payments ─────────────────────────────────────────────────────────────────

export function paymentDayOf(inv: Invoice): string {
  return String(inv.payment_date || inv.paid_at || '').slice(0, 10);
}

export function paymentPosition(invoices: Invoice[], today: string, horizonDays = 30) {
  const horizon = new Date(`${today}T00:00:00`);
  horizon.setDate(horizon.getDate() + horizonDays);
  const horizonDay = localDay(horizon);

  const open = invoices.filter(isInvoiceOpenForPayment);
  const overdue = open.filter((i) => isInvoiceOverdueByDate(i, today));
  const scheduled = invoices.filter((i) => normalizedOpenPaymentStatus(i) === 'scheduled');
  const awaitingApproval = open.filter(isPendingApproval);
  const upcoming = open
    .map((invoice) => ({ invoice, payDay: effectivePaymentDate(invoice) }))
    .filter((r): r is { invoice: Invoice; payDay: string } => !!r.payDay && r.payDay >= today && r.payDay <= horizonDay)
    .sort((a, b) => a.payDay.localeCompare(b.payDay));

  return {
    open: { count: open.length, amount: sumAmount(open) },
    overdue: { count: overdue.length, amount: sumAmount(overdue), items: overdue },
    scheduled: { count: scheduled.length, amount: sumAmount(scheduled), items: scheduled },
    awaitingApproval: { count: awaitingApproval.length, amount: sumAmount(awaitingApproval) },
    upcoming,
  };
}

/** Paid invoices whose payment date (or invoice date when none recorded) falls in the range. */
export function paidInRange(invoices: Invoice[], range: ResolvedRange) {
  const items = invoices
    .filter(isPaid)
    .filter((inv) => {
      if (!range.from && !range.to) return true;
      const d = paymentDayOf(inv) || invoiceDay(inv);
      return (!range.from || d >= range.from) && (!range.to || d <= range.to);
    })
    .sort((a, b) => (paymentDayOf(b) || invoiceDay(b)).localeCompare(paymentDayOf(a) || invoiceDay(a)));
  return { items, count: items.length, amount: sumAmount(items) };
}

// ── Consistency checks shown on the dashboard ────────────────────────────────

export type ConsistencyCheck = { id: string; label: string; ok: boolean; detail: string };

const near = (a: number, b: number) => Math.abs(a - b) < 0.005 * Math.max(1, Math.abs(a), Math.abs(b));

export function consistencyChecks(params: {
  all: Invoice[];
  period: Invoice[];
  kpis: KpiSummary;
  monthKeys: { keys: string[]; truncated: boolean };
  today: string;
  baseCurrency: string;
}): ConsistencyCheck[] {
  const { all, period, kpis, monthKeys, today, baseCurrency } = params;
  const checks: ConsistencyCheck[] = [];
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

  const statusSum = statusDistribution(all).reduce((s, r) => s + r.count, 0);
  checks.push({
    id: 'status_total',
    label: 'Status distribution adds up to Total Invoices',
    ok: statusSum === kpis.totalInvoices,
    detail: `${statusSum} across statuses vs ${kpis.totalInvoices} invoices`,
  });

  const queue = approvalQueue(all, today);
  checks.push({
    id: 'pending_queue',
    label: 'Pending Approvals matches the approval queue',
    ok: queue.length === kpis.pendingApprovals,
    detail: `${kpis.pendingApprovals} pending vs ${queue.length} in queue`,
  });

  const thisMonth = all.filter(
    (i) => monthKeyOf(i) === kpis.monthKey && (i.currency || baseCurrency).toUpperCase() === baseCurrency.toUpperCase(),
  );
  checks.push({
    id: 'month_records',
    label: "This Month's Total and Tax match the invoice records",
    ok: near(sumAmount(thisMonth), kpis.monthTotal) && near(sumTax(thisMonth), kpis.monthTax),
    detail: `${thisMonth.length} ${baseCurrency} invoices dated ${monthLabel(kpis.monthKey)}`,
  });

  const monthsTotal = monthlySeries(period, monthKeys.keys).reduce((s, m) => s + m.amount, 0);
  const periodTotal = sumAmount(period);
  checks.push({
    id: 'monthly_period',
    label: 'Monthly totals add up to the selected period',
    ok: monthKeys.truncated || near(monthsTotal, periodTotal),
    detail: monthKeys.truncated
      ? `Chart shows the latest ${monthKeys.keys.length} months only`
      : `${fmt(monthsTotal)} by month vs ${fmt(periodTotal)} in period`,
  });

  const aging = computeAging(all, today);
  const bucketSum = aging.buckets.reduce((s, b) => s + b.amount, 0);
  checks.push({
    id: 'aging_outstanding',
    label: 'Aging buckets add up to total outstanding',
    ok: near(bucketSum, aging.totalOutstanding),
    detail: `${fmt(bucketSum)} in buckets vs ${fmt(aging.totalOutstanding)} outstanding`,
  });

  const vendors = groupSpend(period, vendorKey);
  const gl = groupSpend(period, glCodeOf);
  const cc = groupSpend(period, costCenterOf);
  const vendorTotal = vendors.rows.reduce((s, r) => s + r.amount, 0) + vendors.unassigned.amount;
  const glTotal = gl.rows.reduce((s, r) => s + r.amount, 0) + gl.unassigned.amount;
  const ccTotal = cc.rows.reduce((s, r) => s + r.amount, 0) + cc.unassigned.amount;
  checks.push({
    id: 'vendor_gl_cc',
    label: 'Vendor, GL and cost-centre totals reconcile',
    ok: near(vendorTotal, periodTotal) && near(glTotal, periodTotal) && near(ccTotal, periodTotal),
    detail: `GL uncoded ${fmt(gl.unassigned.amount)} · cost centre unassigned ${fmt(cc.unassigned.amount)}`,
  });

  const ifrs = ifrsSummary(period);
  checks.push({
    id: 'ifrs_counts',
    label: 'IFRS classified + needs review = invoices in period',
    ok: ifrs.classified + ifrs.needsReview === period.length,
    detail: `${ifrs.classified} + ${ifrs.needsReview} vs ${period.length}`,
  });

  const stages = pipelineStages(period);
  const unbalanced = stages.filter((s) => s.applicable + s.na !== period.length);
  checks.push({
    id: 'pipeline_totals',
    label: 'Every pipeline stage accounts for every invoice in the period',
    ok: unbalanced.length === 0,
    detail: unbalanced.length
      ? `${unbalanced.map((s) => s.label).join(', ')} do not add up`
      : `done + pending + attention + not applicable = ${period.length}`,
  });

  const extracted = stages.find((s) => s.key === 'extracted')!;
  const reviewCount = period.filter(invoiceNeedsExtractionReview).length;
  checks.push({
    id: 'extraction_review',
    label: 'AI Extracted stage and manual-review count agree',
    ok: extracted.issue === reviewCount,
    detail: `${extracted.issue} vs ${reviewCount}`,
  });

  const risk = stages.find((s) => s.key === 'risk')!;
  checks.push({
    id: 'risk_saved',
    label: 'Every invoice in the period has a saved risk score',
    ok: risk.pending + risk.issue === 0,
    detail:
      risk.pending + risk.issue === 0
        ? `${risk.done} scored`
        : `${risk.pending + risk.issue} of ${period.length} without a saved score`,
  });

  const undated = all.filter((i) => !i.invoice_date).length;
  checks.push({
    id: 'invoice_dates',
    label: 'Every invoice has an invoice date',
    ok: undated === 0,
    detail: undated ? `${undated} invoice(s) use the upload date instead` : 'All invoices dated',
  });

  return checks;
}
