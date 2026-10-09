import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarRange, Clock, FileText, Landmark, Receipt, RefreshCw, Upload } from 'lucide-react';
import type { Invoice } from '../../lib/ap-invoice/supabase';
import { InvoiceDetailModal } from '../../components/ap-invoice/InvoiceDetailModal';
import { fetchInvoiceById } from '../../lib/ap-invoice/invoices';
import { formatCurrency } from '../../utils/currency';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import { useDisplayCurrency } from '../../hooks/useDisplayCurrency';
import { useCompany } from '../../context/CompanyContext';
import { useIndustryConfig } from '../../context/IndustryConfigContext';
import { useMarket } from '../../contexts/MarketContext';
import { useApDashboardData } from './dashboard/useApDashboardData';
import {
  RANGE_PRESETS,
  computeKpis,
  filterByRange,
  localDay,
  monthKeysForRange,
  monthLabel,
  resolveRange,
  type RangePreset,
} from './dashboard/metrics';
import { DASHBOARD_TABS, type DashboardCtx, type TabId } from './dashboard/types';
import { ErrorBanner, EmptyState, type Tone, TONE_HEX } from './dashboard/ui';
import { OverviewTab } from './dashboard/tabs/OverviewTab';
import { ProcessingTab } from './dashboard/tabs/ProcessingTab';
import { ApprovalsTab } from './dashboard/tabs/ApprovalsTab';
import { SpendTab } from './dashboard/tabs/SpendTab';
import { VendorsTab } from './dashboard/tabs/VendorsTab';
import { CostCenterGlTab } from './dashboard/tabs/CostCenterGlTab';
import { ComplianceTab } from './dashboard/tabs/ComplianceTab';
import { PaymentsTab } from './dashboard/tabs/PaymentsTab';
import { RecentInvoicesTab } from './dashboard/tabs/RecentInvoicesTab';

const TAB_IDS = new Set<string>(DASHBOARD_TABS.map((t) => t.id));
const PRESET_IDS = new Set<string>(RANGE_PRESETS.map((p) => p.id));

function KpiCard({
  label,
  value,
  sub,
  extra,
  icon: Icon,
  tone,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  sub: React.ReactNode;
  extra?: React.ReactNode;
  icon: React.ElementType;
  tone: Tone;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-medium text-slate-500">{label}</p>
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ background: `${TONE_HEX[tone]}14`, color: TONE_HEX[tone] }}
          aria-hidden
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-1 truncate text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      <p className="mt-0.5 truncate text-[11.5px] text-slate-500">{sub}</p>
      {extra}
    </>
  );
  const cls = 'min-w-0 rounded-xl border border-[#E3E8EF] bg-white px-4 py-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)]';
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={`${cls} transition-colors hover:border-[#246BFD]/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#246BFD]/40`}
    >
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') ?? '';
  const tab: TabId = TAB_IDS.has(tabParam) ? (tabParam as TabId) : 'overview';
  const presetParam = searchParams.get('range') ?? '';
  const preset: RangePreset = PRESET_IDS.has(presetParam) ? (presetParam as RangePreset) : 'all';
  const customFrom = searchParams.get('from');
  const customTo = searchParams.get('to');

  const { dateFormat } = useCompanySettings();
  const { currency: baseCurrency, fmt, fmtCompact } = useDisplayCurrency();
  const { activeCompanyId, activeCompany } = useCompany();
  const { costCenterLabel } = useIndustryConfig();
  const { isUAE } = useMarket();
  const workspaceId =
    localStorage.getItem('gnanova_workspace_id') ??
    localStorage.getItem('active_workspace_id') ??
    localStorage.getItem('tenantId') ??
    '';

  const data = useApDashboardData(activeCompanyId);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  const now = useMemo(() => (data.loadedAt ? new Date(data.loadedAt) : new Date()), [data.loadedAt]);

  useEffect(() => {
    setSelectedInvoice((prev) => (prev ? data.invoices.find((i) => i.id === prev.id) ?? prev : null));
  }, [data.invoices]);
  const today = localDay(now);
  const range = useMemo(
    () => resolveRange(preset, now, { from: customFrom, to: customTo }),
    [preset, now, customFrom, customTo],
  );
  const period = useMemo(() => filterByRange(data.invoices, range), [data.invoices, range]);
  const monthKeys = useMemo(() => monthKeysForRange(range, period), [range, period]);
  const kpis = useMemo(() => computeKpis(data.invoices, baseCurrency, now), [data.invoices, baseCurrency, now]);

  const updateParams = useCallback(
    (patch: Record<string, string | null>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v == null || v === '') next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const goTab = useCallback((id: TabId) => updateParams({ tab: id === 'overview' ? null : id }), [updateParams]);

  const reload = data.reload;
  const ctx: DashboardCtx = useMemo(
    () => ({
      all: data.invoices,
      period,
      range,
      monthKeys,
      kpis,
      today,
      baseCurrency,
      fmt,
      fmtCompact,
      dateFormat,
      costCenterLabel,
      companyId: data.companyId,
      workspaceId,
      isUAE,
      openInvoice: setSelectedInvoice,
      goTab,
      reload,
    }),
    [data.invoices, period, range, monthKeys, kpis, today, baseCurrency, fmt, fmtCompact, dateFormat, costCenterLabel, data.companyId, workspaceId, isUAE, goTab, reload],
  );

  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onTabKeyDown = (e: React.KeyboardEvent) => {
    const ids = DASHBOARD_TABS.map((t) => t.id);
    const i = ids.indexOf(tab);
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (i + 1) % ids.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + ids.length) % ids.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ids.length - 1;
    if (next == null) return;
    e.preventDefault();
    goTab(ids[next]);
    tabRefs.current[ids[next]]?.focus();
  };

  const companyName = activeCompany?.company_name || activeCompany?.trade_name || null;
  const thisMonth = monthLabel(kpis.monthKey);

  const renderTab = () => {
    switch (tab) {
      case 'processing':
        return <ProcessingTab ctx={ctx} />;
      case 'approvals':
        return <ApprovalsTab ctx={ctx} />;
      case 'spend':
        return <SpendTab ctx={ctx} />;
      case 'vendors':
        return <VendorsTab ctx={ctx} />;
      case 'gl':
        return <CostCenterGlTab ctx={ctx} />;
      case 'compliance':
        return <ComplianceTab ctx={ctx} />;
      case 'payments':
        return <PaymentsTab ctx={ctx} />;
      case 'invoices':
        return <RecentInvoicesTab ctx={ctx} />;
      default:
        return <OverviewTab ctx={ctx} />;
    }
  };

  const inputCls =
    'h-8 rounded-md border border-[#E3E8EF] bg-white px-2 text-[12px] text-slate-700 focus:border-[#246BFD] focus:outline-none focus:ring-2 focus:ring-[#246BFD]/20';

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-[#0B1D33]">Dashboard</h1>
          <p className="mt-0.5 truncate text-[12.5px] text-slate-500">
            AP InvoiceFlow{companyName ? ` · ${companyName}` : ''}
            {data.loadedAt && ` · updated ${data.loadedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-slate-500">
            <CalendarRange className="h-4 w-4" aria-hidden />
            <span className="sr-only">Date range</span>
            <select
              value={preset}
              onChange={(e) => {
                const v = e.target.value as RangePreset;
                updateParams({ range: v === 'all' ? null : v, ...(v === 'custom' ? {} : { from: null, to: null }) });
              }}
              className={inputCls}
            >
              {RANGE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {preset === 'custom' && (
            <>
              <input
                type="date"
                aria-label="From date"
                value={customFrom ?? ''}
                onChange={(e) => updateParams({ from: e.target.value || null })}
                className={inputCls}
              />
              <span className="text-[12px] text-slate-400">to</span>
              <input
                type="date"
                aria-label="To date"
                value={customTo ?? ''}
                onChange={(e) => updateParams({ to: e.target.value || null })}
                className={inputCls}
              />
            </>
          )}
          <button
            type="button"
            onClick={() => void data.reload()}
            disabled={data.loading || data.refreshing}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#E3E8EF] bg-white px-2.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#246BFD]/40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${data.refreshing ? 'animate-spin' : ''}`} aria-hidden /> Refresh
          </button>
          <Link
            to="/ap-invoices/upload"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#246BFD] px-3 text-[12px] font-medium text-white hover:bg-[#1F5FE0] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#246BFD]/40"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden /> Upload
          </Link>
        </div>
      </header>

      {data.error && <ErrorBanner message={data.error} onRetry={() => void data.reload()} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy={data.loading}>
        {data.loading ? (
          [0, 1, 2, 3].map((i) => <div key={i} className="h-[104px] animate-pulse rounded-xl border border-[#E3E8EF] bg-white" />)
        ) : (
          <>
            <KpiCard
              label="Total Invoices"
              value={kpis.totalInvoices.toLocaleString()}
              sub={range.preset === 'all' ? 'All time' : `All time · ${period.length} in ${range.label.toLowerCase()}`}
              icon={FileText}
              tone="primary"
              onClick={() => goTab('invoices')}
            />
            <KpiCard
              label="Pending Approvals"
              value={kpis.pendingApprovals.toLocaleString()}
              sub="Awaiting review"
              icon={Clock}
              tone="amber"
              onClick={() => goTab('approvals')}
            />
            <KpiCard
              label="This Month's Total"
              value={fmt(kpis.monthTotal)}
              sub={`${thisMonth} · ${kpis.monthInvoiceCount} invoice${kpis.monthInvoiceCount === 1 ? '' : 's'} by invoice date`}
              extra={
                kpis.otherCurrencies.length > 0 && (
                  <p className="mt-0.5 truncate text-[11px] text-[#B45309]">
                    Also: {kpis.otherCurrencies.map((c) => formatCurrency(c.total, c.currency)).join(' · ')}
                  </p>
                )
              }
              icon={Landmark}
              tone="gold"
              onClick={() => goTab('spend')}
            />
            <KpiCard
              label="Total Tax This Month"
              value={fmt(kpis.monthTax)}
              sub={`${isUAE ? 'VAT' : 'Tax'} on ${baseCurrency} invoices dated ${thisMonth}`}
              icon={Receipt}
              tone="purple"
              onClick={() => goTab('compliance')}
            />
          </>
        )}
      </div>

      <div className="rounded-xl border border-[#E3E8EF] bg-white px-1">
        <div
          role="tablist"
          aria-label="Dashboard sections"
          onKeyDown={onTabKeyDown}
          className="flex gap-0.5 overflow-x-auto [scrollbar-width:thin]"
        >
          {DASHBOARD_TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[t.id] = el;
                }}
                id={`ap-tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`ap-panel-${t.id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => goTab(t.id)}
                className={`relative shrink-0 whitespace-nowrap px-3 py-2.5 text-[12.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#246BFD]/40 ${
                  active ? 'text-[#246BFD]' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {t.label}
                {t.id === 'approvals' && kpis.pendingApprovals > 0 && (
                  <span className="ml-1.5 rounded-full bg-[#FEF3C7] px-1.5 text-[10px] font-semibold text-[#92400E]">
                    {kpis.pendingApprovals}
                  </span>
                )}
                {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#246BFD]" aria-hidden />}
              </button>
            );
          })}
        </div>
      </div>

      <div role="tabpanel" id={`ap-panel-${tab}`} aria-labelledby={`ap-tab-${tab}`} tabIndex={0} className="focus:outline-none">
        {data.loading ? (
          <div className="grid gap-4 lg:grid-cols-3" aria-busy>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-48 animate-pulse rounded-xl border border-[#E3E8EF] bg-white" />
            ))}
          </div>
        ) : !data.companyId ? (
          <EmptyState>Select an organization in the top bar to see its AP dashboard.</EmptyState>
        ) : (
          renderTab()
        )}
      </div>

      {selectedInvoice && (
        <InvoiceDetailModal
          invoice={selectedInvoice}
          open={!!selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          onUpdate={() => void data.reload()}
          onNavigateInvoice={async (id) => {
            const inv = await fetchInvoiceById(id);
            if (inv) setSelectedInvoice(inv);
          }}
        />
      )}
    </div>
  );
}
