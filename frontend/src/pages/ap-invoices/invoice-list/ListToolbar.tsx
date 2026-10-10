import type React from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PIPELINE_STAGES } from '../dashboard/metrics';
import type { StageFilterState } from '../dashboard/types';
import {
  activeFilters,
  clearFilter,
  EMPTY_FILTERS,
  MATCH_FILTER_LABEL,
  PAYMENT_FILTER_LABEL,
  RISK_FILTER_LABEL,
  type FilterKey,
  type KindFilter,
  type ListFilters,
  type StageFilter,
  type ViewMode,
} from './listModel';

const VIEW_CHIPS: { id: ViewMode; label: string; tone: 'blue' | 'amber' | 'red' }[] = [
  { id: 'all', label: 'All', tone: 'blue' },
  { id: 'approvals', label: 'Approval queue', tone: 'blue' },
  { id: 'duplicates', label: 'Duplicates', tone: 'amber' },
  { id: 'needs_review', label: 'Needs review', tone: 'amber' },
  { id: 'anomalies', label: 'Anomalies', tone: 'red' },
];

const CHIP_ACTIVE: Record<'blue' | 'amber' | 'red', string> = {
  blue: 'border-[#1765F5] bg-[#1765F5] text-white',
  amber: 'border-[#D97706] bg-[#D97706] text-white',
  red: 'border-[#DC2626] bg-[#DC2626] text-white',
};

const STAGE_STATE_LABEL: Record<StageFilterState, string> = {
  open: 'not done',
  pending: 'pending',
  issue: 'needs attention',
  done: 'done',
  na: 'not applicable',
};

const SOURCES: [string, string][] = [
  ['upload', 'Upload'],
  ['email', 'Email'],
  ['email_n8n', 'Email (n8n)'],
  ['whatsapp', 'WhatsApp'],
  ['camera', 'Camera'],
  ['excel', 'Excel'],
  ['excel_vba', 'Excel (VBA)'],
  ['vendor_portal', 'Vendor portal'],
  ['manual', 'Manual'],
];

export type FilterOptions = {
  statuses: string[];
  ifrs: string[];
  gl: { code: string; name: string }[];
  property: string[];
  costCenter: string[];
};

const selectCls =
  'h-8 w-full rounded-md border border-[#E2E8F0] bg-white px-2 text-[13px] text-[#152238] focus:border-[#1765F5] focus:outline-none focus:ring-2 focus:ring-[#1765F5]/20';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[#64748B]">{label}</span>
      {children}
    </label>
  );
}

export function ListToolbar({
  filters,
  onFiltersChange,
  view,
  onViewChange,
  viewCounts,
  stage,
  onStageChange,
  options,
  costCenterLabel,
  statusLabel,
  showAdvanceFilter,
}: {
  filters: ListFilters;
  onFiltersChange: (next: ListFilters) => void;
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  viewCounts: Record<ViewMode, number>;
  stage: StageFilter;
  onStageChange: (next: StageFilter) => void;
  options: FilterOptions;
  costCenterLabel: string;
  statusLabel: (status: string) => string;
  showAdvanceFilter: boolean;
}) {
  const set = <K extends keyof ListFilters>(key: K, value: ListFilters[K]) => onFiltersChange({ ...filters, [key]: value });
  const chips = activeFilters(filters, { costCenter: costCenterLabel, status: statusLabel }).filter((c) => c.key !== 'search');
  const advancedCount = chips.length;
  const anythingActive = chips.length > 0 || !!filters.search.trim() || view !== 'all' || !!stage || filters.kind !== 'all';
  const stageDef = stage ? PIPELINE_STAGES.find((s) => s.key === stage.stage) : null;

  const resetAll = () => {
    onFiltersChange(EMPTY_FILTERS);
    onViewChange('all');
    onStageChange(null);
  };

  return (
    <section className="space-y-2.5 rounded-xl border border-[#E2E8F0] bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" aria-hidden />
        <input
          type="search"
          value={filters.search}
          onChange={(e) => set('search', e.target.value)}
          placeholder="Search by invoice number, vendor, PO number or reference…"
          aria-label="Search invoices"
          className="h-9 w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] pl-9 pr-3 text-[13px] text-[#152238] placeholder:text-[#94A3B8] focus:border-[#1765F5] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1765F5]/20"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {VIEW_CHIPS.map((c) => {
          const active = view === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onViewChange(c.id)}
              aria-pressed={active}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium transition-colors ${
                active ? CHIP_ACTIVE[c.tone] : 'border-[#E2E8F0] bg-white text-[#152238] hover:bg-[#F3F6FB]'
              }`}
            >
              {c.label}
              <span
                className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                  active ? 'bg-white/20' : 'bg-[#F1F5F9] text-[#64748B]'
                }`}
              >
                {viewCounts[c.id].toLocaleString()}
              </span>
            </button>
          );
        })}

        <span className="mx-1 hidden h-5 w-px bg-[#E2E8F0] sm:block" aria-hidden />

        <div className="inline-flex h-8 overflow-hidden rounded-lg border border-[#E2E8F0]" role="group" aria-label="Invoice type">
          {(
            [
              ['all', 'All types', 'Accounts payable and receivable'],
              ['purchase', 'AP', 'Accounts payable (vendor bills)'],
              ['sales', 'AR', 'Accounts receivable (customer bills)'],
            ] as [KindFilter, string, string][]
          ).map(([id, label, title]) => (
            <button
              key={id}
              type="button"
              title={title}
              aria-pressed={filters.kind === id}
              onClick={() => set('kind', id)}
              className={`px-3 text-[12.5px] font-medium ${
                filters.kind === id ? 'bg-[#0B1D33] text-white' : 'bg-white text-[#152238] hover:bg-[#F3F6FB]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 text-[12.5px] font-medium text-[#152238] hover:bg-[#F3F6FB]"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              More filters
              {advancedCount > 0 && (
                <span className="rounded-full bg-[#1765F5] px-1.5 text-[11px] font-semibold text-white">{advancedCount}</span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[min(92vw,520px)] p-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Invoice status">
                <select className={selectCls} value={filters.status} onChange={(e) => set('status', e.target.value)}>
                  <option value="all">All statuses</option>
                  {options.statuses.map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="3-way match">
                <select className={selectCls} value={filters.match} onChange={(e) => set('match', e.target.value)}>
                  <option value="all">All match statuses</option>
                  {Object.entries(MATCH_FILTER_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Risk level">
                <select
                  className={selectCls}
                  value={filters.risk}
                  onChange={(e) => set('risk', e.target.value as ListFilters['risk'])}
                >
                  <option value="all">All risk levels</option>
                  {Object.entries(RISK_FILTER_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Payment status">
                <select
                  className={selectCls}
                  value={filters.payment}
                  onChange={(e) => set('payment', e.target.value as ListFilters['payment'])}
                >
                  <option value="all">All payment statuses</option>
                  {Object.entries(PAYMENT_FILTER_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="IFRS category">
                <select className={selectCls} value={filters.ifrs} onChange={(e) => set('ifrs', e.target.value)}>
                  <option value="all">All categories</option>
                  <option value="not_classified">Not classified</option>
                  {options.ifrs.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="GL account">
                <select className={selectCls} value={filters.gl} onChange={(e) => set('gl', e.target.value)}>
                  <option value="all">All GL accounts</option>
                  <option value="uncoded">Not coded</option>
                  {options.gl.map((g) => (
                    <option key={g.code} value={g.code}>
                      {g.code}
                      {g.name ? ` — ${g.name}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              {options.property.length > 0 && (
                <Field label="Property / project">
                  <select className={selectCls} value={filters.property} onChange={(e) => set('property', e.target.value)}>
                    <option value="all">All properties</option>
                    {options.property.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {options.costCenter.length > 0 && (
                <Field label={costCenterLabel}>
                  <select
                    className={selectCls}
                    value={filters.costCenter}
                    onChange={(e) => set('costCenter', e.target.value)}
                  >
                    <option value="all">All</option>
                    {options.costCenter.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Source">
                <select
                  className={selectCls}
                  value={filters.source}
                  onChange={(e) => onFiltersChange({ ...filters, source: e.target.value, receivedAt: null })}
                >
                  <option value="all">All sources</option>
                  {SOURCES.map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="col-span-2 grid grid-cols-2 gap-3">
                <Field label="Invoice date from">
                  <input
                    type="date"
                    className={selectCls}
                    value={filters.from}
                    max={filters.to || undefined}
                    onChange={(e) => set('from', e.target.value)}
                  />
                </Field>
                <Field label="Invoice date to">
                  <input
                    type="date"
                    className={selectCls}
                    value={filters.to}
                    min={filters.from || undefined}
                    onChange={(e) => set('to', e.target.value)}
                  />
                </Field>
              </div>
              {showAdvanceFilter && (
                <label className="col-span-2 flex items-center gap-2 text-[13px] text-[#152238]">
                  <input
                    type="checkbox"
                    checked={filters.advanceOnly}
                    onChange={(e) => set('advanceOnly', e.target.checked)}
                    className="h-4 w-4 rounded border-[#CBD5E1]"
                  />
                  Advance payments only (VAT due on receipt)
                </label>
              )}
            </div>
            <div className="mt-4 flex justify-end border-t border-[#EEF2F7] pt-3">
              <button
                type="button"
                className="text-[12.5px] font-medium text-[#1765F5] hover:underline disabled:text-[#94A3B8] disabled:no-underline"
                disabled={advancedCount === 0}
                onClick={() => onFiltersChange({ ...EMPTY_FILTERS, search: filters.search, kind: filters.kind })}
              >
                Clear these filters
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {(chips.length > 0 || stage || anythingActive) && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-[#EEF2F7] pt-2.5">
          {stage && stageDef && (
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#1765F5]/30 bg-[#1765F5]/5 pl-2.5 pr-1 text-[12px] text-[#1D4ED8]">
              <span className="font-medium">Step: {stageDef.label}</span>
              <select
                aria-label="Pipeline step state"
                value={stage.state}
                onChange={(e) => onStageChange({ stage: stage.stage, state: e.target.value as StageFilterState })}
                className="h-5 rounded border-0 bg-transparent px-0.5 text-[12px] font-medium text-[#1D4ED8] focus:outline-none focus:ring-1 focus:ring-[#1765F5]/40"
              >
                {(Object.keys(STAGE_STATE_LABEL) as StageFilterState[]).map((k) => (
                  <option key={k} value={k}>
                    {STAGE_STATE_LABEL[k]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onStageChange(null)}
                className="rounded-full p-0.5 hover:bg-[#1765F5]/10"
                aria-label="Clear pipeline step filter"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
          {chips.map((c) => (
            <span
              key={c.key}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-[#E2E8F0] bg-[#F8FAFC] pl-2.5 pr-1 text-[12px] text-[#152238]"
            >
              {c.label}
              <button
                type="button"
                onClick={() => onFiltersChange(clearFilter(filters, c.key as FilterKey))}
                className="rounded-full p-0.5 text-[#64748B] hover:bg-[#E2E8F0]"
                aria-label={`Remove filter ${c.label}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          {anythingActive && (
            <button
              type="button"
              onClick={resetAll}
              className="ml-auto text-[12.5px] font-medium text-[#1765F5] hover:underline"
            >
              Reset filters
            </button>
          )}
        </div>
      )}
    </section>
  );
}
