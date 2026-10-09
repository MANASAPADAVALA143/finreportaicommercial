import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Search } from 'lucide-react';
import { displayDate } from '@/utils/dateUtils';
import type { DashboardCtx } from '../types';
import { vendorBreakdown } from '../metrics';
import { CurrencyNote, TopVendorsPanel, VendorTrendPanel, listLink } from '../widgets';
import { COLORS, EmptyState, Panel, PanelLink, Pill, SERIES, Stat, chartTooltipStyle, pct } from '../ui';

type SortKey = 'amount' | 'count' | 'pending' | 'name';

export function VendorsTab({ ctx }: { ctx: DashboardCtx }) {
  const navigate = useNavigate();
  const vendors = useMemo(() => vendorBreakdown(ctx.period), [ctx.period]);
  const total = vendors.reduce((s, v) => s + v.amount, 0);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('amount');

  const distribution = useMemo(() => {
    const top = vendors.slice(0, 5).map((v) => ({ name: v.name, value: v.amount }));
    const rest = vendors.slice(5).reduce((s, v) => s + v.amount, 0);
    return rest > 0 ? [...top, { name: `Other (${vendors.length - 5})`, value: rest }] : top;
  }, [vendors]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? vendors.filter((v) => v.name.toLowerCase().includes(q)) : vendors;
    return [...filtered].sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : (b[sort] as number) - (a[sort] as number),
    );
  }, [vendors, query, sort]);

  const top5Share = total ? vendors.slice(0, 5).reduce((s, v) => s + v.amount, 0) / total : 0;
  const openVendor = (name: string) => navigate(listLink({ vendor: name }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Active vendors" value={vendors.length} sub={ctx.range.label} />
        <Stat label="Vendor spend" value={ctx.fmt(total)} tone="primary" />
        <Stat label="Top 5 concentration" value={pct(top5Share)} tone={top5Share > 0.8 ? 'amber' : 'slate'} />
        <Stat label="Vendors with pending invoices" value={vendors.filter((v) => v.pending > 0).length} tone="amber" />
      </div>
      <CurrencyNote ctx={ctx} invoices={ctx.period} />

      <div className="grid gap-4 xl:grid-cols-3">
        <TopVendorsPanel ctx={ctx} limit={8} onSelect={openVendor} />
        <VendorTrendPanel ctx={ctx} top={4} className="xl:col-span-2" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Vendor Spend Distribution" scope="period">
          {distribution.length === 0 ? (
            <EmptyState>No vendor spend in the selected period.</EmptyState>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="h-44 w-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={distribution} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="95%" stroke="none" paddingAngle={1}>
                      {distribution.map((d, i) => (
                        <Cell key={d.name} fill={d.name.startsWith('Other') ? '#CBD5E1' : SERIES[i % SERIES.length]} />
                      ))}
                    </Pie>
                    <Tooltip {...chartTooltipStyle} formatter={(v: number) => ctx.fmt(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="w-full space-y-1 text-[12px]">
                {distribution.map((d, i) => (
                  <li key={d.name} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-slate-700">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: d.name.startsWith('Other') ? '#CBD5E1' : SERIES[i % SERIES.length] }}
                        aria-hidden
                      />
                      <span className="truncate">{d.name}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-500">{pct(total ? d.value / total : 0)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <Panel
          title="Vendor Activity"
          subtitle="Invoice count and workflow status by vendor"
          scope="period"
          className="xl:col-span-2"
          action={<PanelLink to="/ap-invoices/vendors">Vendor master</PanelLink>}
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <label className="relative flex-1 min-w-[180px]">
              <span className="sr-only">Search vendors</span>
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search vendors"
                className="h-8 w-full rounded-md border border-[#E3E8EF] bg-white pl-7 pr-2 text-[12px] focus:border-[#246BFD] focus:outline-none focus:ring-2 focus:ring-[#246BFD]/20"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
              Sort
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="h-8 rounded-md border border-[#E3E8EF] bg-white px-2 text-[12px] text-slate-700 focus:border-[#246BFD] focus:outline-none"
              >
                <option value="amount">Spend</option>
                <option value="count">Invoice count</option>
                <option value="pending">Pending</option>
                <option value="name">Name</option>
              </select>
            </label>
          </div>
          {rows.length === 0 ? (
            <EmptyState>No vendors match.</EmptyState>
          ) : (
            <div className="max-h-[380px] overflow-auto">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="py-1.5 pr-3 font-medium">Vendor</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Spend</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Invoices</th>
                    <th className="py-1.5 pr-3 font-medium">Pending / Approved / Paid</th>
                    <th className="py-1.5 pr-3 font-medium">Last invoice</th>
                    <th className="py-1.5 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((v) => (
                    <tr key={v.key} className="border-b border-slate-50 last:border-0">
                      <td className="max-w-[220px] truncate py-1.5 pr-3 font-medium text-slate-900">{v.name}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{ctx.fmt(v.amount)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{v.count}</td>
                      <td className="py-1.5 pr-3">
                        <span className="flex flex-wrap gap-1">
                          <Pill tone={v.pending ? 'amber' : 'slate'}>{v.pending}</Pill>
                          <Pill tone="teal">{v.approved}</Pill>
                          <Pill tone="primary">{v.paid}</Pill>
                          {v.other > 0 && <Pill>{v.other} other</Pill>}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-slate-600">{v.lastInvoiceDay ? displayDate(v.lastInvoiceDay, ctx.dateFormat) : '—'}</td>
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => openVendor(v.name)}
                          className="text-[11px] font-medium text-[#246BFD] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#246BFD]/40 rounded"
                          aria-label={`View invoices for ${v.name}`}
                        >
                          Invoices
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[11px]" style={{ color: COLORS.slate }}>
            Pending = awaiting approval · Approved · Paid. “Invoices” opens the Invoice List filtered to the vendor.
          </p>
        </Panel>
      </div>
    </div>
  );
}
