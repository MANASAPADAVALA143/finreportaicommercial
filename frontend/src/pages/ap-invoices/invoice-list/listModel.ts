import type { Invoice } from '@/lib/ap-invoice/supabase';
import { getEffectiveExtractionScore, invoiceNeedsExtractionReview } from '@/utils/extractionConfidence';
import { invoiceMatchesAnomalyTab } from '@/lib/ap-invoice/invoiceRiskDisplay';
import { effectivePropertyRef } from '@/lib/ap-invoice/propertyFromGl';
import {
  glCodeOf,
  hasRiskScore,
  parseRiskFlags,
  pipelineState,
  SEVERITY_RANK,
  type PipelineStageKey,
  type Severity,
} from '../dashboard/metrics';
import type { StageFilterState } from '../dashboard/types';

export type ViewMode = 'all' | 'approvals' | 'duplicates' | 'needs_review' | 'anomalies';
export type KindFilter = 'all' | 'purchase' | 'sales';
export type RiskFilter = 'all' | Severity | 'not_scored';
export type PaymentFilter = 'all' | 'paid' | 'unpaid' | 'overdue' | 'scheduled';
export type StageFilter = { stage: PipelineStageKey; state: StageFilterState } | null;

export type ListFilters = {
  search: string;
  status: string;
  match: string;
  risk: RiskFilter;
  payment: PaymentFilter;
  ifrs: string;
  gl: string;
  property: string;
  costCenter: string;
  source: string;
  /** Exact email intake timestamp (deep link from Email Invoices). */
  receivedAt: string | null;
  from: string;
  to: string;
  kind: KindFilter;
  advanceOnly: boolean;
};

export const EMPTY_FILTERS: ListFilters = {
  search: '',
  status: 'all',
  match: 'all',
  risk: 'all',
  payment: 'all',
  ifrs: 'all',
  gl: 'all',
  property: 'all',
  costCenter: 'all',
  source: 'all',
  receivedAt: null,
  from: '',
  to: '',
  kind: 'all',
  advanceOnly: false,
};

// ── Field helpers ────────────────────────────────────────────────────────────

export const invoiceGlCode = (inv: Invoice) => glCodeOf(inv);
export const invoiceProperty = (inv: Invoice) => effectivePropertyRef(inv.property_ref, invoiceGlCode(inv)) || '';

export function isInApprovalQueue(inv: Invoice): boolean {
  return Boolean(inv.approval_level && inv.approval_level !== 'none' && !inv.approved_by && inv.status === 'Processing');
}

export type PaymentState = 'paid' | 'overdue' | 'scheduled' | 'unpaid';

export function paymentState(inv: Invoice, today: Date = new Date()): PaymentState {
  if (inv.status === 'Paid' || inv.payment_status === 'paid') return 'paid';
  if (inv.payment_status === 'overdue') return 'overdue';
  if (inv.payment_status === 'scheduled') return 'scheduled';
  if (inv.due_date) {
    const due = new Date(inv.due_date);
    if (!Number.isNaN(due.getTime())) {
      const t0 = new Date(today);
      t0.setHours(0, 0, 0, 0);
      due.setHours(0, 0, 0, 0);
      if (due < t0) return 'overdue';
    }
  }
  return 'unpaid';
}

export function paymentLabel(inv: Invoice, today: Date = new Date()): { label: string; title?: string; state: PaymentState } {
  const state = paymentState(inv, today);
  if (state === 'paid') {
    const method = inv.payment_method?.trim();
    const ref = (inv.utr_number ?? inv.payment_reference)?.trim();
    return { label: method ? `Paid — ${method}` : 'Paid', title: ref ? `UTR / Ref: ${ref}` : undefined, state };
  }
  return { label: state === 'overdue' ? 'Overdue' : state === 'scheduled' ? 'Scheduled' : 'Unpaid', state };
}

/** Risk as saved on the invoice. A missing score is "not scored", never low risk. */
export type ListRisk = {
  scored: boolean;
  tier: Severity | null;
  score: number | null;
  flags: number;
};

const LEVELS = new Set<string>(['critical', 'high', 'medium', 'low']);

export function listRisk(inv: Invoice): ListRisk {
  const flags = parseRiskFlags(inv);
  const scored = hasRiskScore(inv);
  const score = typeof inv.risk_score === 'number' && Number.isFinite(inv.risk_score) ? Math.round(inv.risk_score) : null;
  let tier: Severity | null = null;
  const level = String(inv.risk_level ?? '').trim().toLowerCase();
  const legacyTier = typeof inv.risk_score === 'string' ? inv.risk_score.trim().toLowerCase() : '';
  if (LEVELS.has(level)) tier = level as Severity;
  else if (score != null) tier = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
  else if (LEVELS.has(legacyTier)) tier = legacyTier as Severity;
  if (scored && flags.some((f) => f?.severity === 'critical')) tier = 'critical';
  return { scored, tier: scored ? tier : null, score: scored ? score : null, flags: flags.length };
}

export function riskFilterKey(inv: Invoice): Exclude<RiskFilter, 'all'> {
  return listRisk(inv).tier ?? 'not_scored';
}

const SEARCH_KEYS = [
  'invoice_number',
  'vendor_name',
  'po_number',
  'property_ref',
  'project_code',
  'vendor_trn',
  'gstin',
  'utr_number',
  'payment_reference',
  'bank_ref',
] as const;

export function matchesSearch(inv: Invoice, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  const row = inv as unknown as Record<string, unknown>;
  return SEARCH_KEYS.some((k) => String(row[k] ?? '').toLowerCase().includes(q));
}

export function matchesView(inv: Invoice, view: ViewMode, anomalyIds: Set<string>): boolean {
  switch (view) {
    case 'approvals':
      return isInApprovalQueue(inv);
    case 'duplicates':
      return inv.duplicate_flag === true;
    case 'needs_review':
      return invoiceNeedsExtractionReview(inv);
    case 'anomalies':
      return anomalyIds.has(inv.id) || invoiceMatchesAnomalyTab(inv);
    default:
      return true;
  }
}

export function matchesStage(inv: Invoice, filter: StageFilter): boolean {
  if (!filter) return true;
  const s = pipelineState(inv, filter.stage);
  return filter.state === 'open' ? s === 'pending' || s === 'issue' : s === filter.state;
}

function dayOf(value: string | null | undefined): string {
  return value ? String(value).slice(0, 10) : '';
}

export function matchesFilters(inv: Invoice, f: ListFilters, today: Date = new Date()): boolean {
  if (!matchesSearch(inv, f.search)) return false;
  if (f.status !== 'all' && inv.status !== f.status) return false;

  if (f.match !== 'all') {
    const m = String(inv.match_status ?? '').toLowerCase();
    if (f.match === 'match_issues') {
      if (m !== 'mismatch' && m !== 'no_po') return false;
    } else if (f.match === 'not_run') {
      if (m) return false;
    } else if (m !== f.match) return false;
  }

  if (f.risk !== 'all' && riskFilterKey(inv) !== f.risk) return false;
  if (f.payment !== 'all' && paymentState(inv, today) !== f.payment) return false;

  if (f.ifrs === 'not_classified') {
    if ((inv.ifrs_category ?? '').trim()) return false;
  } else if (f.ifrs !== 'all' && (inv.ifrs_category ?? '').trim() !== f.ifrs) return false;

  if (f.gl === 'uncoded') {
    if (invoiceGlCode(inv)) return false;
  } else if (f.gl !== 'all' && invoiceGlCode(inv) !== f.gl) return false;

  if (f.property !== 'all' && invoiceProperty(inv) !== f.property) return false;
  if (f.costCenter !== 'all' && (inv.cost_center ?? '').trim() !== f.costCenter) return false;
  if (f.source !== 'all' && (inv.source || 'upload') !== f.source) return false;

  if (f.receivedAt) {
    if (!inv.source_email_received_at) return false;
    if (new Date(inv.source_email_received_at).getTime() !== new Date(f.receivedAt).getTime()) return false;
  }

  const day = dayOf(inv.invoice_date);
  if (f.from && (!day || day < f.from)) return false;
  if (f.to && (!day || day > f.to)) return false;

  if (f.kind === 'purchase' && inv.invoice_type === 'sales') return false;
  if (f.kind === 'sales' && inv.invoice_type !== 'sales') return false;
  if (f.advanceOnly && inv.is_advance_payment !== true) return false;
  return true;
}

// ── Active filter chips ─────────────────────────────────────────────────────

export type FilterKey = Exclude<keyof ListFilters, 'kind'>;

export const RISK_FILTER_LABEL: Record<Exclude<RiskFilter, 'all'>, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  not_scored: 'Not scored',
};

export const PAYMENT_FILTER_LABEL: Record<Exclude<PaymentFilter, 'all'>, string> = {
  paid: 'Paid',
  unpaid: 'Unpaid',
  overdue: 'Overdue',
  scheduled: 'Scheduled',
};

export const MATCH_FILTER_LABEL: Record<string, string> = {
  three_way_matched: '3-Way Matched',
  matched: 'PO Matched',
  partial: 'Partial',
  mismatch: 'Mismatch',
  no_po: 'No PO',
  match_issues: 'Match exceptions',
  not_run: 'Match not run',
};

export type ActiveFilter = { key: FilterKey; label: string };

export function activeFilters(f: ListFilters, labels: { costCenter: string; status: (s: string) => string }): ActiveFilter[] {
  const out: ActiveFilter[] = [];
  if (f.search.trim()) out.push({ key: 'search', label: `Search: “${f.search.trim()}”` });
  if (f.status !== 'all') out.push({ key: 'status', label: `Status: ${labels.status(f.status)}` });
  if (f.match !== 'all') out.push({ key: 'match', label: `3-way: ${MATCH_FILTER_LABEL[f.match] ?? f.match}` });
  if (f.risk !== 'all') out.push({ key: 'risk', label: `Risk: ${RISK_FILTER_LABEL[f.risk]}` });
  if (f.payment !== 'all') out.push({ key: 'payment', label: `Payment: ${PAYMENT_FILTER_LABEL[f.payment]}` });
  if (f.ifrs !== 'all') out.push({ key: 'ifrs', label: `IFRS: ${f.ifrs === 'not_classified' ? 'Not classified' : f.ifrs}` });
  if (f.gl !== 'all') out.push({ key: 'gl', label: `GL: ${f.gl === 'uncoded' ? 'Not coded' : f.gl}` });
  if (f.property !== 'all') out.push({ key: 'property', label: `Property: ${f.property}` });
  if (f.costCenter !== 'all') out.push({ key: 'costCenter', label: `${labels.costCenter}: ${f.costCenter}` });
  if (f.source !== 'all') out.push({ key: 'source', label: `Source: ${f.source}` });
  if (f.receivedAt) out.push({ key: 'receivedAt', label: 'Email intake run' });
  if (f.from || f.to) out.push({ key: 'from', label: `Date: ${f.from || '…'} → ${f.to || '…'}` });
  if (f.advanceOnly) out.push({ key: 'advanceOnly', label: 'Advance payments' });
  return out;
}

export function clearFilter(f: ListFilters, key: FilterKey): ListFilters {
  if (key === 'from' || key === 'to') return { ...f, from: '', to: '' };
  if (key === 'receivedAt') return { ...f, receivedAt: null, source: 'all' };
  return { ...f, [key]: EMPTY_FILTERS[key] };
}

// ── Sorting ─────────────────────────────────────────────────────────────────

export type SortKey =
  | 'created_at'
  | 'invoice_number'
  | 'vendor'
  | 'amount'
  | 'status'
  | 'ifrs'
  | 'match'
  | 'risk'
  | 'invoice_date'
  | 'due_date'
  | 'confidence';
export type SortState = { key: SortKey; dir: 'asc' | 'desc' };
export const DEFAULT_SORT: SortState = { key: 'created_at', dir: 'desc' };

const MATCH_RANK: Record<string, number> = { three_way_matched: 4, matched: 3, partial: 2, mismatch: 1, no_po: 0 };

/** null sorts last regardless of direction. */
function sortValue(inv: Invoice, key: SortKey): string | number | null {
  switch (key) {
    case 'created_at':
      return inv.created_at || null;
    case 'invoice_number':
      return (inv.invoice_number || '').toLowerCase() || null;
    case 'vendor':
      return (inv.vendor_name || '').toLowerCase() || null;
    case 'amount': {
      const raw = inv.total_amount as unknown;
      if (raw == null || raw === '') return null;
      return Number.isFinite(Number(raw)) ? Number(raw) : null;
    }
    case 'status':
      return inv.status || null;
    case 'ifrs':
      return (inv.ifrs_category || '').toLowerCase() || null;
    case 'match':
      return MATCH_RANK[String(inv.match_status ?? '')] ?? null;
    case 'risk': {
      const r = listRisk(inv);
      if (!r.scored) return null;
      return r.score ?? (r.tier ? SEVERITY_RANK[r.tier] * 30 : null);
    }
    case 'invoice_date':
      return dayOf(inv.invoice_date) || null;
    case 'due_date':
      return dayOf(inv.due_date) || null;
    case 'confidence':
      return getEffectiveExtractionScore(inv);
  }
}

export function sortInvoices(invoices: Invoice[], sort: SortState): Invoice[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return invoices
    .map((inv, i) => ({ inv, i, v: sortValue(inv, sort.key) }))
    .sort((a, b) => {
      if (a.v == null && b.v == null) return a.i - b.i;
      if (a.v == null) return 1;
      if (b.v == null) return -1;
      if (a.v < b.v) return -sign;
      if (a.v > b.v) return sign;
      return a.i - b.i;
    })
    .map((x) => x.inv);
}

// ── Columns ─────────────────────────────────────────────────────────────────

export type OptionalColumn =
  | 'invoice_date'
  | 'due_date'
  | 'vat_timing'
  | 'payment'
  | 'confidence'
  | 'gl'
  | 'property'
  | 'department'
  | 'cost_center'
  | 'created_at'
  | 'source';

export const OPTIONAL_COLUMNS: { key: OptionalColumn; label: string; sort?: SortKey; uaeOnly?: boolean }[] = [
  { key: 'invoice_date', label: 'Invoice date', sort: 'invoice_date' },
  { key: 'due_date', label: 'Due date', sort: 'due_date' },
  { key: 'payment', label: 'Payment status' },
  { key: 'vat_timing', label: 'VAT timing', uaeOnly: true },
  { key: 'confidence', label: 'Extraction confidence', sort: 'confidence' },
  { key: 'gl', label: 'GL account' },
  { key: 'property', label: 'Property' },
  { key: 'department', label: 'Department' },
  { key: 'cost_center', label: 'Cost center' },
  { key: 'created_at', label: 'Created date', sort: 'created_at' },
  { key: 'source', label: 'Source' },
];

export const COLUMNS_STORAGE_KEY = 'invoiceflow.list.columns.v1';
export const PAGE_SIZE_STORAGE_KEY = 'invoiceflow.list.pageSize.v1';
export const PAGE_SIZES = [10, 20, 50, 100] as const;
