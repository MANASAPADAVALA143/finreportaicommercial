import type React from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Eye,
  FileDown,
  MoreHorizontal,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type { Invoice } from '@/lib/ap-invoice/supabase';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfidenceBadge } from '@/components/invoices/ConfidenceBadge';
import { getEffectiveExtractionScore } from '@/utils/extractionConfidence';
import { resolveDisplayMatchStatus } from '@/utils/threeWayMatch';
import { displayDate } from '@/utils/dateUtils';
import { INVOICE_SOURCE_LABEL } from '@/lib/ap-invoice/invoiceLabels';
import {
  invoiceProperty,
  listRisk,
  OPTIONAL_COLUMNS,
  PAGE_SIZES,
  paymentLabel,
  type OptionalColumn,
  type SortKey,
  type SortState,
} from './listModel';

export type DetailTab = 'details' | 'matching' | 'risk' | 'approval' | 'activity';
export type GlDisplay = { code: string; name: string; suggested: boolean } | null;

type Tone = 'teal' | 'blue' | 'amber' | 'red' | 'slate' | 'purple' | 'gold';
const BADGE: Record<Tone, string> = {
  teal: 'bg-[#00A884]/10 text-[#047857] ring-[#00A884]/25',
  blue: 'bg-[#1765F5]/10 text-[#1D4ED8] ring-[#1765F5]/20',
  amber: 'bg-[#F59E0B]/12 text-[#B45309] ring-[#F59E0B]/30',
  red: 'bg-[#DC2626]/10 text-[#B91C1C] ring-[#DC2626]/25',
  slate: 'bg-[#64748B]/10 text-[#475569] ring-[#64748B]/20',
  purple: 'bg-[#7C3AED]/10 text-[#6D28D9] ring-[#7C3AED]/20',
  gold: 'bg-[#C9A227]/12 text-[#8A6D0B] ring-[#C9A227]/30',
};

export function Badge({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${BADGE[tone]}`}
    >
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  Paid: 'teal',
  Approved: 'blue',
  Processing: 'amber',
  'On Hold': 'gold',
  Queried: 'purple',
  Rejected: 'red',
};

export function statusLabel(status: string | null | undefined): string {
  const s = String(status ?? '').trim();
  if (!s) return 'Unknown';
  if (s === 'Processing') return 'Pending approval';
  if (s === 'review_required') return 'Needs review';
  if (s === 'auto_approve') return 'Approved';
  if (/[A-Z\s]/.test(s) && !s.includes('_')) return s;
  return s
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const MATCH_BADGE: Record<string, { label: string; tone: Tone }> = {
  three_way_matched: { label: 'Matched', tone: 'teal' },
  matched: { label: 'PO matched', tone: 'teal' },
  partial: { label: 'Partial', tone: 'amber' },
  mismatch: { label: 'Mismatch', tone: 'red' },
  no_po: { label: 'No PO', tone: 'slate' },
};

const RISK_TONE: Record<string, Tone> = { critical: 'red', high: 'red', medium: 'amber', low: 'teal' };
const RISK_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

function amountParts(amount: unknown, currency: string): { code: string; value: string } | null {
  const n = Number(amount);
  if (amount == null || amount === '' || !Number.isFinite(n)) return null;
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  return { code: currency, value: n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) };
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey?: SortKey;
  sort: SortState;
  onSort: (next: SortState) => void;
  align?: 'left' | 'right';
}) {
  if (!sortKey) return <span>{label}</span>;
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort({ key: sortKey, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}
      className={`inline-flex items-center gap-1 hover:text-[#152238] ${align === 'right' ? 'flex-row-reverse' : ''} ${
        active ? 'text-[#152238]' : ''
      }`}
      aria-label={`Sort by ${label}`}
    >
      {label}
      <Icon className={`h-3 w-3 ${active ? 'opacity-100' : 'opacity-40'}`} aria-hidden />
    </button>
  );
}

const OPTIONAL_WIDTH: Record<OptionalColumn, number> = {
  invoice_date: 100,
  due_date: 100,
  vat_timing: 120,
  payment: 110,
  confidence: 100,
  gl: 150,
  property: 120,
  department: 120,
  cost_center: 120,
  created_at: 100,
  source: 100,
};

export function InvoiceTable({
  rows,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  sort,
  onSortChange,
  columns,
  onColumnsChange,
  selectedIds,
  onToggleRow,
  onTogglePage,
  activeId,
  onOpen,
  currencyOf,
  glDisplay,
  dateFormat,
  isUAE,
  costCenterLabel,
  onDownloadPdf,
  onValidatePint,
  headerActions,
  empty,
}: {
  rows: Invoice[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  sort: SortState;
  onSortChange: (sort: SortState) => void;
  columns: Set<OptionalColumn>;
  onColumnsChange: (next: Set<OptionalColumn>) => void;
  selectedIds: string[];
  onToggleRow: (id: string) => void;
  onTogglePage: () => void;
  activeId: string | null;
  onOpen: (invoice: Invoice, tab?: DetailTab) => void;
  currencyOf: (invoice: Invoice) => string;
  glDisplay: (invoice: Invoice) => GlDisplay;
  dateFormat: string;
  isUAE: boolean;
  costCenterLabel: string;
  onDownloadPdf: (invoice: Invoice) => void;
  onValidatePint: (invoice: Invoice) => void;
  headerActions?: React.ReactNode;
  empty: React.ReactNode;
}) {
  const optional = OPTIONAL_COLUMNS.filter((c) => columns.has(c.key) && (!c.uaeOnly || isUAE));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const pageIds = rows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
  const someOnPage = pageIds.some((id) => selectedIds.includes(id));
  const minWidth = 700 + optional.reduce((s, c) => s + OPTIONAL_WIDTH[c.key], 0);
  const today = new Date();

  const th = 'sticky top-0 z-10 bg-[#F8FAFC] px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[#64748B]';
  const td = 'px-2.5 py-2 align-middle';

  const optionalCell = (inv: Invoice, key: OptionalColumn): React.ReactNode => {
    switch (key) {
      case 'invoice_date':
        return inv.invoice_date ? displayDate(inv.invoice_date, dateFormat) : '—';
      case 'due_date':
        return inv.due_date ? displayDate(inv.due_date, dateFormat) : '—';
      case 'created_at':
        return inv.created_at ? displayDate(inv.created_at.slice(0, 10), dateFormat) : '—';
      case 'payment': {
        const p = paymentLabel(inv, today);
        const tone: Tone = p.state === 'paid' ? 'teal' : p.state === 'overdue' ? 'red' : p.state === 'scheduled' ? 'blue' : 'slate';
        return (
          <div className="min-w-0">
            <Badge tone={tone} title={p.title}>
              {p.label}
            </Badge>
            {p.state === 'paid' && !inv.bank_reconciled && (
              <p className="mt-0.5 truncate text-[11px] text-[#B45309]" title="Paid, but not yet matched to a bank statement line">
                Recon pending
              </p>
            )}
          </div>
        );
      }
      case 'vat_timing':
        return inv.is_advance_payment ? <Badge tone="red">VAT due on receipt</Badge> : <Badge tone="slate">Standard</Badge>;
      case 'confidence':
        return <ConfidenceBadge score={getEffectiveExtractionScore(inv)} size="sm" />;
      case 'gl': {
        const gl = glDisplay(inv);
        if (!gl) return <span className="text-[#94A3B8]">Not coded</span>;
        return (
          <div className="min-w-0" title={gl.suggested ? 'Suggested from COA mapping — not saved on the invoice' : undefined}>
            <span className={`font-mono text-[12px] font-semibold ${gl.suggested ? 'text-[#94A3B8]' : 'text-[#1765F5]'}`}>
              {gl.code}
            </span>
            {gl.suggested && <span className="ml-1 text-[10px] text-[#94A3B8]">suggested</span>}
            <p className="truncate text-[11px] text-[#64748B]" title={gl.name}>
              {gl.name}
            </p>
          </div>
        );
      }
      case 'property': {
        const v = invoiceProperty(inv);
        return v ? <span className="block truncate" title={v}>{v}</span> : '—';
      }
      case 'department': {
        const v = inv.department?.trim();
        return v ? <span className="block truncate" title={v}>{v}</span> : '—';
      }
      case 'cost_center': {
        const v = inv.cost_center?.trim();
        return v ? <span className="block truncate" title={v}>{v}</span> : '—';
      }
      case 'source':
        return inv.source ? INVOICE_SOURCE_LABEL[inv.source] ?? inv.source : '—';
    }
  };

  const pageButtons = (): (number | '…')[] => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const out: (number | '…')[] = [1];
    const lo = Math.max(2, page - 1);
    const hi = Math.min(totalPages - 1, page + 1);
    if (lo > 2) out.push('…');
    for (let p = lo; p <= hi; p++) out.push(p);
    if (hi < totalPages - 1) out.push('…');
    out.push(totalPages);
    return out;
  };

  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EEF2F7] px-3 py-2.5">
        <h2 className="text-[15px] font-semibold text-[#152238]">
          {total.toLocaleString()} invoice{total === 1 ? '' : 's'}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {headerActions}
          <label className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-2 text-[12.5px] text-[#64748B]">
            Sort
            <select
              aria-label="Sort invoices"
              value={`${sort.key}:${sort.dir}`}
              onChange={(e) => {
                const [key, dir] = e.target.value.split(':') as [SortKey, 'asc' | 'desc'];
                onSortChange({ key, dir });
              }}
              className="bg-transparent text-[12.5px] font-medium text-[#152238] focus:outline-none"
            >
              <option value="created_at:desc">Newest first</option>
              <option value="created_at:asc">Oldest first</option>
              <option value="invoice_date:desc">Invoice date (newest)</option>
              <option value="due_date:asc">Due date (soonest)</option>
              <option value="amount:desc">Amount (high → low)</option>
              <option value="amount:asc">Amount (low → high)</option>
              <option value="risk:desc">Risk score (high → low)</option>
              <option value="vendor:asc">Vendor (A → Z)</option>
              <option value="invoice_number:asc">Invoice # (A → Z)</option>
              {![
                'created_at:desc',
                'created_at:asc',
                'invoice_date:desc',
                'due_date:asc',
                'amount:desc',
                'amount:asc',
                'risk:desc',
                'vendor:asc',
                'invoice_number:asc',
              ].includes(`${sort.key}:${sort.dir}`) && (
                <option value={`${sort.key}:${sort.dir}`}>Custom (column)</option>
              )}
            </select>
          </label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-2.5 text-[12.5px] font-medium text-[#152238] hover:bg-[#F3F6FB]"
              >
                <Columns3 className="h-3.5 w-3.5" />
                Columns
                {optional.length > 0 && (
                  <span className="rounded-full bg-[#F1F5F9] px-1.5 text-[11px] text-[#64748B]">+{optional.length}</span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-[#64748B]">
                Additional columns
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {OPTIONAL_COLUMNS.filter((c) => !c.uaeOnly || isUAE).map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.key}
                  checked={columns.has(c.key)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(on) => {
                    const next = new Set(columns);
                    if (on) next.add(c.key);
                    else next.delete(c.key);
                    onColumnsChange(next);
                  }}
                >
                  {c.key === 'cost_center' ? costCenterLabel : c.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="max-h-[calc(100vh-260px)] min-h-[200px] overflow-auto">
        <table className="w-full table-fixed border-separate border-spacing-0 text-[13px] text-[#152238]" style={{ minWidth }}>
          <colgroup>
            <col style={{ width: 36 }} />
            <col style={{ width: '19%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '12%' }} />
            {optional.map((c) => (
              <col key={c.key} style={{ width: OPTIONAL_WIDTH[c.key] }} />
            ))}
            <col style={{ width: 44 }} />
          </colgroup>
          <thead>
            <tr>
              <th className={`${th} border-b border-[#E2E8F0]`}>
                <Checkbox
                  checked={allOnPage ? true : someOnPage ? 'indeterminate' : false}
                  onCheckedChange={onTogglePage}
                  aria-label="Select all invoices on this page"
                />
              </th>
              <th className={`${th} border-b border-[#E2E8F0]`}>
                <SortHeader label="Invoice #" sortKey="invoice_number" sort={sort} onSort={onSortChange} />
              </th>
              <th className={`${th} border-b border-[#E2E8F0]`}>
                <SortHeader label="Vendor" sortKey="vendor" sort={sort} onSort={onSortChange} />
              </th>
              <th className={`${th} border-b border-[#E2E8F0] text-right`}>
                <SortHeader label="Amount" sortKey="amount" sort={sort} onSort={onSortChange} align="right" />
              </th>
              <th className={`${th} border-b border-[#E2E8F0]`}>
                <SortHeader label="Status" sortKey="status" sort={sort} onSort={onSortChange} />
              </th>
              <th className={`${th} border-b border-[#E2E8F0]`}>
                <SortHeader label="IFRS category" sortKey="ifrs" sort={sort} onSort={onSortChange} />
              </th>
              <th className={`${th} border-b border-[#E2E8F0]`}>
                <SortHeader label="3-Way match" sortKey="match" sort={sort} onSort={onSortChange} />
              </th>
              <th className={`${th} border-b border-[#E2E8F0]`}>
                <SortHeader label="Risk" sortKey="risk" sort={sort} onSort={onSortChange} />
              </th>
              {optional.map((c) => (
                <th key={c.key} className={`${th} border-b border-[#E2E8F0]`}>
                  <SortHeader
                    label={c.key === 'cost_center' ? costCenterLabel : c.label}
                    sortKey={c.sort}
                    sort={sort}
                    onSort={onSortChange}
                  />
                </th>
              ))}
              <th className={`${th} border-b border-[#E2E8F0]`}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((inv) => {
              const active = inv.id === activeId;
              const checked = selectedIds.includes(inv.id);
              const currency = currencyOf(inv);
              const amount = amountParts(inv.total_amount, currency);
              const match = resolveDisplayMatchStatus(inv);
              const matchBadge = match ? MATCH_BADGE[match] : null;
              const risk = listRisk(inv);
              const category = (inv.ifrs_category ?? '').trim();
              const business = (inv.expense_category ?? '').trim();
              const fromSource = String(inv.ifrs_explanation ?? '').startsWith('Source category');
              const rawConf = Number(inv.ifrs_confidence ?? 0);
              const conf = rawConf > 0 && rawConf <= 1 ? Math.round(rawConf * 100) : Math.round(rawConf);
              const rowBg = active ? 'bg-[#EEF4FF]' : checked ? 'bg-[#F8FAFF]' : 'bg-white group-hover:bg-[#F8FAFC]';
              const cell = `${td} border-b border-[#EEF2F7] ${rowBg}`;
              return (
                <tr
                  key={inv.id}
                  className="group cursor-pointer"
                  onClick={() => onOpen(inv)}
                  aria-selected={active}
                >
                  <td
                    className={`${cell} ${active ? 'shadow-[inset_3px_0_0_#1765F5]' : ''}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => onToggleRow(inv.id)}
                      aria-label={`Select invoice ${inv.invoice_number}`}
                    />
                  </td>
                  <td className={cell}>
                    <p className="truncate font-semibold" title={inv.invoice_number}>
                      {inv.invoice_number}
                    </p>
                    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1">
                      {business && (
                        <span className="max-w-full truncate rounded-md bg-[#FFF7E6] px-1.5 py-px text-[10.5px] font-medium text-[#9A6B00]" title={business}>
                          {business}
                        </span>
                      )}
                      {inv.invoice_type === 'sales' && <Badge tone="teal">AR</Badge>}
                      {inv.duplicate_flag === true && <Badge tone="amber">Possible duplicate</Badge>}
                    </div>
                  </td>
                  <td className={cell}>
                    <p className="line-clamp-2 break-words" title={inv.vendor_name}>
                      {inv.vendor_name || '—'}
                    </p>
                  </td>
                  <td className={`${cell} text-right`}>
                    {amount ? (
                      <>
                        <p className="text-[10.5px] font-medium text-[#64748B]">{amount.code}</p>
                        <p className="font-semibold tabular-nums">{amount.value}</p>
                      </>
                    ) : (
                      <span className="text-[#94A3B8]" title="No amount recorded">—</span>
                    )}
                  </td>
                  <td className={cell}>
                    <Badge tone={STATUS_TONE[inv.status] ?? 'slate'}>{statusLabel(inv.status)}</Badge>
                    {inv.tally_synced === true && <p className="mt-0.5 text-[10.5px] text-[#047857]">Tally synced</p>}
                  </td>
                  <td className={cell}>
                    {category ? (
                      <>
                        <p className="line-clamp-2 break-words text-[12.5px] font-medium text-[#1D4ED8]" title={category}>
                          {category}
                        </p>
                        {fromSource ? (
                          <p className="text-[10.5px] text-[#047857]">From source data</p>
                        ) : conf > 0 ? (
                          <p className="text-[10.5px] tabular-nums text-[#64748B]">{conf}% confidence</p>
                        ) : null}
                      </>
                    ) : (
                      <Badge tone="amber">Not classified</Badge>
                    )}
                  </td>
                  <td className={cell}>
                    {matchBadge ? (
                      <>
                        <Badge tone={matchBadge.tone}>
                          {matchBadge.tone === 'teal' ? <ShieldCheck className="h-3 w-3" aria-hidden /> : null}
                          {matchBadge.label}
                        </Badge>
                        {match === 'partial' && inv.match_difference != null && Number(inv.match_difference) !== 0 && (
                          <p className="mt-0.5 text-[10.5px] tabular-nums text-[#64748B]">
                            {amountParts(inv.match_difference, currency)?.value} diff
                          </p>
                        )}
                      </>
                    ) : (
                      <Badge tone="slate">Not run</Badge>
                    )}
                  </td>
                  <td className={cell} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => onOpen(inv, 'risk')}
                      className="rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1765F5]/40"
                      title={
                        risk.scored
                          ? `Risk ${risk.tier ? RISK_LABEL[risk.tier] : ''}${risk.score != null ? ` · score ${risk.score}/100` : ''}${
                              risk.flags ? ` · ${risk.flags} flag${risk.flags === 1 ? '' : 's'}` : ''
                            } — open Risk & Compliance`
                          : `No saved risk score${risk.flags ? ` (${risk.flags} flag${risk.flags === 1 ? '' : 's'} recorded)` : ''} — open Risk & Compliance`
                      }
                    >
                      {risk.scored && risk.tier ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Badge tone={RISK_TONE[risk.tier]}>{RISK_LABEL[risk.tier]}</Badge>
                          {risk.score != null && <span className="text-[12px] font-semibold tabular-nums">{risk.score}</span>}
                        </span>
                      ) : (
                        <span className="inline-flex flex-col items-start">
                          <Badge tone="slate">
                            <ShieldAlert className="h-3 w-3" aria-hidden />
                            Not scored
                          </Badge>
                          {risk.flags > 0 && (
                            <span className="mt-0.5 text-[10.5px] text-[#B45309]">
                              {risk.flags} flag{risk.flags === 1 ? '' : 's'}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  </td>
                  {optional.map((c) => (
                    <td key={c.key} className={`${cell} text-[12.5px]`}>
                      {optionalCell(inv, c.key)}
                    </td>
                  ))}
                  <td className={`${cell} text-right`} onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#E2E8F0] bg-white text-[#64748B] hover:bg-[#F3F6FB] hover:text-[#152238]"
                          aria-label={`Actions for ${inv.invoice_number}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem onSelect={() => onOpen(inv)}>
                          <Eye className="mr-2 h-4 w-4" />
                          View details
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onOpen(inv, 'matching')}>
                          <ShieldCheck className="mr-2 h-4 w-4" />
                          Matching &amp; accounting
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onOpen(inv, 'risk')}>
                          <ShieldAlert className="mr-2 h-4 w-4" />
                          Risk &amp; compliance
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onDownloadPdf(inv)}>
                          <FileDown className="mr-2 h-4 w-4" />
                          Download invoice PDF
                        </DropdownMenuItem>
                        {isUAE && inv.status === 'Approved' && (
                          <DropdownMenuItem onSelect={() => onValidatePint(inv)}>
                            <ShieldCheck className="mr-2 h-4 w-4" />
                            Validate PINT AE
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && empty}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#EEF2F7] px-3 py-2 text-[12.5px] text-[#64748B]">
        <span className="tabular-nums">
          {total === 0 ? 'No invoices' : `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()} invoices`}
        </span>
        <nav className="flex items-center gap-1" aria-label="Pagination">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#E2E8F0] bg-white disabled:opacity-40"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {pageButtons().map((p, i) =>
            p === '…' ? (
              <span key={`gap-${i}`} className="px-1">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                aria-current={p === page ? 'page' : undefined}
                className={`h-7 min-w-[1.75rem] rounded-md px-1.5 tabular-nums ${
                  p === page ? 'bg-[#1765F5] font-semibold text-white' : 'border border-[#E2E8F0] bg-white text-[#152238] hover:bg-[#F3F6FB]'
                }`}
              >
                {p}
              </button>
            ),
          )}
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#E2E8F0] bg-white disabled:opacity-40"
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </nav>
        <label className="inline-flex items-center gap-1.5">
          Rows per page
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="h-7 rounded-md border border-[#E2E8F0] bg-white px-1.5 text-[12.5px] text-[#152238]"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </footer>
    </section>
  );
}
