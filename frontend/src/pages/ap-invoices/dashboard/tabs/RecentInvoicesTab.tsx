import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Eye, Search, X } from 'lucide-react';
import type { Invoice } from '@/lib/ap-invoice/supabase';
import { formatCurrency } from '@/utils/currency';
import { displayDate } from '@/utils/dateUtils';
import type { DashboardCtx, StageFilterState } from '../types';
import {
  PIPELINE_STAGES,
  PIPELINE_STAGE_KEYS,
  STATUS_ORDER,
  amountOf,
  invoiceDay,
  invoiceSeverity,
  pipelineState,
  type PipelineStageKey,
} from '../metrics';
import { EmptyState, Panel, PanelLink, STATUS_LABEL } from '../ui';
import { ApprovalPill, RiskPill, StatusPill, approvalStatusOf } from './shared';

type SortKey = 'invoice_number' | 'vendor_name' | 'date' | 'due' | 'amount';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 25;

function sortValue(inv: Invoice, key: SortKey): string | number {
  switch (key) {
    case 'amount':
      return amountOf(inv);
    case 'date':
      return invoiceDay(inv);
    case 'due':
      return String(inv.due_date || '');
    case 'vendor_name':
      return (inv.vendor_name || '').toLowerCase();
    default:
      return (inv.invoice_number || '').toLowerCase();
  }
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(rows: Invoice[], filename: string) {
  const header = ['Invoice #', 'Vendor', 'Invoice date', 'Due date', 'Amount', 'Currency', 'Tax', 'Status', 'Approval status', 'Risk', 'IFRS category', 'GL code'];
  const lines = rows.map((i) =>
    [
      i.invoice_number,
      i.vendor_name,
      i.invoice_date ?? '',
      i.due_date ?? '',
      amountOf(i),
      i.currency ?? '',
      i.tax_amount ?? '',
      i.status,
      approvalStatusOf(i),
      invoiceSeverity(i) ?? '',
      i.ifrs_category ?? '',
      i.gl_account_code ?? i.gl_code ?? '',
    ]
      .map(csvCell)
      .join(','),
  );
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const STAGE_STATE_LABEL: Record<StageFilterState, string> = {
  open: 'Not done (pending + attention)',
  pending: 'Pending',
  issue: 'Needs attention',
  done: 'Done',
  na: 'Not applicable',
};
const STAGE_STATES = new Set<string>(Object.keys(STAGE_STATE_LABEL));

function matchesStage(inv: Invoice, stage: PipelineStageKey, state: StageFilterState): boolean {
  const s = pipelineState(inv, stage);
  return state === 'open' ? s === 'pending' || s === 'issue' : s === state;
}

export function RecentInvoicesTab({ ctx }: { ctx: DashboardCtx }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const stageParam = searchParams.get('stage') ?? '';
  const stage = PIPELINE_STAGE_KEYS.has(stageParam) ? (stageParam as PipelineStageKey) : null;
  const stateParam = searchParams.get('state') ?? '';
  const stageState: StageFilterState = STAGE_STATES.has(stateParam) ? (stateParam as StageFilterState) : 'open';
  const setStageFilter = (next: { stage?: string | null; state?: string | null }) =>
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(next)) {
          if (v) p.set(k, v);
          else p.delete(k);
        }
        return p;
      },
      { replace: true },
    );

  const [scope, setScope] = useState<'period' | 'all'>('period');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [approval, setApproval] = useState('all');
  const [risk, setRisk] = useState('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'date', dir: 'desc' });
  const [page, setPage] = useState(0);

  // Pipeline counts are for the selected period, so a stage drill-down starts there too.
  useEffect(() => {
    if (stage) setScope('period');
  }, [stage, stageState]);

  const source = scope === 'period' ? ctx.period : ctx.all;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = source.filter((i) => {
      if (stage && !matchesStage(i, stage, stageState)) return false;
      if (status !== 'all' && i.status !== status) return false;
      if (approval !== 'all' && approvalStatusOf(i) !== approval) return false;
      if (risk !== 'all' && (invoiceSeverity(i) ?? 'none') !== risk) return false;
      if (!q) return true;
      return [i.invoice_number, i.vendor_name, i.po_number, i.vendor_trn]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    });
  }, [source, stage, stageState, query, status, approval, risk, sort]);

  useEffect(() => setPage(0), [stage, stageState, query, status, approval, risk, scope, sort]);
  const stageDef = stage ? PIPELINE_STAGES.find((s) => s.key === stage) : null;

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const statuses = useMemo(() => {
    const present = new Set(source.map((i) => i.status));
    return [...STATUS_ORDER.filter((s) => present.has(s)), ...[...present].filter((s) => !(STATUS_ORDER as readonly string[]).includes(s))];
  }, [source]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'vendor_name' || key === 'invoice_number' ? 'asc' : 'desc' }));

  const SortHeader = ({ k, label, align = 'left' }: { k: SortKey; label: string; align?: 'left' | 'right' }) => {
    const active = sort.key === k;
    return (
      <th
        scope="col"
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={`py-2 pr-3 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}
      >
        <button
          type="button"
          onClick={() => toggleSort(k)}
          className={`inline-flex items-center gap-1 rounded uppercase tracking-wide hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#246BFD]/40 ${active ? 'text-slate-800' : ''}`}
        >
          {label}
          {active && (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
        </button>
      </th>
    );
  };

  const selectCls =
    'h-8 rounded-md border border-[#E3E8EF] bg-white px-2 text-[12px] text-slate-700 focus:border-[#246BFD] focus:outline-none focus:ring-2 focus:ring-[#246BFD]/20';

  return (
    <Panel
      title="Recent Invoices"
      subtitle={`${rows.length} of ${source.length} invoices`}
      scope={scope === 'period' ? 'period' : 'all'}
      action={<PanelLink to="/ap-invoices/list">Open Invoice List</PanelLink>}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[200px] flex-1">
          <span className="sr-only">Search invoices</span>
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search invoice #, vendor, PO or TRN"
            className="h-8 w-full rounded-md border border-[#E3E8EF] bg-white pl-7 pr-2 text-[12px] focus:border-[#246BFD] focus:outline-none focus:ring-2 focus:ring-[#246BFD]/20"
          />
        </label>
        <select
          aria-label="Pipeline step"
          value={stage ?? ''}
          onChange={(e) => setStageFilter({ stage: e.target.value || null, state: e.target.value ? stageState : null })}
          className={selectCls}
        >
          <option value="">All pipeline steps</option>
          {PIPELINE_STAGES.filter((s) => s.key !== 'uploaded').map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        {stage && (
          <select
            aria-label="Pipeline step state"
            value={stageState}
            onChange={(e) => setStageFilter({ state: e.target.value })}
            className={selectCls}
          >
            {(Object.keys(STAGE_STATE_LABEL) as StageFilterState[]).map((s) => (
              <option key={s} value={s}>
                {STAGE_STATE_LABEL[s]}
              </option>
            ))}
          </select>
        )}
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
          <option value="all">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s] ?? s}
            </option>
          ))}
        </select>
        <select aria-label="Approval status" value={approval} onChange={(e) => setApproval(e.target.value)} className={selectCls}>
          <option value="all">All approvals</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="not_required">Not required</option>
        </select>
        <select aria-label="Risk" value={risk} onChange={(e) => setRisk(e.target.value)} className={selectCls}>
          <option value="all">All risk</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="none">Not rated</option>
        </select>
        <select aria-label="Date scope" value={scope} onChange={(e) => setScope(e.target.value as 'period' | 'all')} className={selectCls}>
          <option value="period">{ctx.range.label}</option>
          <option value="all">All invoices</option>
        </select>
        <button
          type="button"
          onClick={() => exportCsv(rows, `ap-invoices-${ctx.today}.csv`)}
          disabled={rows.length === 0}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#E3E8EF] bg-white px-2.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#246BFD]/40"
        >
          <Download className="h-3.5 w-3.5" aria-hidden /> Export CSV
        </button>
      </div>

      {stageDef && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#246BFD]/20 bg-[#246BFD]/[0.04] px-2.5 py-1.5 text-[11.5px] text-slate-700">
          <span>
            <span className="font-medium">{stageDef.label}</span> · {STAGE_STATE_LABEL[stageState].toLowerCase()} — {stageDef.definition}
          </span>
          <button
            type="button"
            onClick={() => setStageFilter({ stage: null, state: null })}
            className="inline-flex items-center gap-1 rounded font-medium text-[#246BFD] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#246BFD]/40"
          >
            <X className="h-3 w-3" aria-hidden /> Clear step filter
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState>{source.length === 0 ? 'No invoices yet. Upload your first invoice to get started.' : 'No invoices match these filters.'}</EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[12px]">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] text-slate-500">
                  <SortHeader k="invoice_number" label="Invoice #" />
                  <SortHeader k="vendor_name" label="Vendor" />
                  <SortHeader k="date" label="Date" />
                  <SortHeader k="due" label="Due" />
                  <SortHeader k="amount" label="Amount" align="right" />
                  <th scope="col" className="py-2 pr-3 text-left font-medium uppercase tracking-wide">Status</th>
                  <th scope="col" className="py-2 pr-3 text-left font-medium uppercase tracking-wide">Approval</th>
                  <th scope="col" className="py-2 pr-3 text-left font-medium uppercase tracking-wide">Risk</th>
                  <th scope="col" className="py-2 text-right font-medium">
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((inv) => (
                  <tr
                    key={inv.id}
                    className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-[#246BFD]/[0.03]"
                    onClick={() => ctx.openInvoice(inv)}
                  >
                    <td className="py-2 pr-3 font-medium text-slate-900">{inv.invoice_number}</td>
                    <td className="max-w-[220px] truncate py-2 pr-3 text-slate-700">{inv.vendor_name}</td>
                    <td className="py-2 pr-3 text-slate-600">{inv.invoice_date ? displayDate(inv.invoice_date, ctx.dateFormat) : '—'}</td>
                    <td className="py-2 pr-3 text-slate-600">{inv.due_date ? displayDate(inv.due_date, ctx.dateFormat) : '—'}</td>
                    <td className="py-2 pr-3 text-right font-medium tabular-nums text-slate-900">
                      {formatCurrency(amountOf(inv), inv.currency || ctx.baseCurrency)}
                    </td>
                    <td className="py-2 pr-3">
                      <StatusPill status={inv.status} />
                    </td>
                    <td className="py-2 pr-3">
                      <ApprovalPill invoice={inv} />
                    </td>
                    <td className="py-2 pr-3">
                      <RiskPill invoice={inv} />
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          ctx.openInvoice(inv);
                        }}
                        className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-[#246BFD] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#246BFD]/40"
                        aria-label={`View invoice ${inv.invoice_number}`}
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="mt-3 flex items-center justify-between text-[12px] text-slate-500" aria-label="Pagination">
            <span>
              {page * PAGE_SIZE + 1}–{Math.min(rows.length, (page + 1) * PAGE_SIZE)} of {rows.length}
            </span>
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-md border border-[#E3E8EF] p-1 hover:bg-slate-50 disabled:opacity-40"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-2">
                Page {page + 1} of {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
                className="rounded-md border border-[#E3E8EF] p-1 hover:bg-slate-50 disabled:opacity-40"
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </span>
          </nav>
        </>
      )}
    </Panel>
  );
}
