import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAgingSummary,
  getAgingInvoices,
  getDpoMetrics,
  getAgingByVendor,
  exportAgingCsv,
  type AgingBucket,
  type AgingInvoice,
} from '@/lib/ap-invoice/agingService';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
} from 'recharts';
import { formatCurrency } from '@/utils/currency';
import { displayDate } from '@/utils/dateUtils';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { useMarket } from '@/contexts/MarketContext';
import { markOverdueInvoices } from '@/lib/ap-invoice/paymentService';
import { Download, Printer, Loader2, ArrowUpDown } from 'lucide-react';

type SortKey = 'amount' | 'due_date' | 'days_overdue';
type SortDir = 'asc' | 'desc';

const PERIODS = [30, 60, 90, 180] as const;

function bucketFilterKey(cardKey: string): string | undefined {
  if (cardKey === 'all') return undefined;
  return cardKey;
}

export default function ApAging() {
  const navigate = useNavigate();
  const { baseCurrency: settingsCurrency, settings, dateFormat } = useCompanySettings();
  const { config, isUAE, market } = useMarket();
  const baseCurrency = useMemo(() => {
    if (isUAE || market === 'uae') return 'AED';
    const country = (settings?.country ?? '').toUpperCase();
    if (country === 'AE' || country === 'UAE' || settingsCurrency === 'AED') return 'AED';
    return settingsCurrency ?? config.currency;
  }, [isUAE, market, settings?.country, settingsCurrency, config.currency]);
  const [periodDays, setPeriodDays] = useState<number>(90);
  const [buckets, setBuckets] = useState<AgingBucket[]>([]);
  const [invoices, setInvoices] = useState<AgingInvoice[]>([]);
  const [vendorRows, setVendorRows] = useState<
    { vendor: string; outstanding: number; overdue: number; current: number; count: number }[]
  >([]);
  const [dpo, setDpo] = useState<Awaited<ReturnType<typeof getDpoMetrics>> | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [firstLoadDone, setFirstLoadDone] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('due_date');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await markOverdueInvoices().catch((e) => console.warn('markOverdueInvoices:', e));
      const results = await Promise.allSettled([
        getAgingSummary(),
        getAgingInvoices(bucketFilterKey(selectedBucket)),
        getAgingByVendor(),
        getDpoMetrics(periodDays),
      ]);
      const [sumR, invR, vndR, dpoR] = results;
      if (sumR.status === 'fulfilled') setBuckets(sumR.value);
      else console.error('getAgingSummary:', sumR.reason);
      if (invR.status === 'fulfilled') setInvoices(invR.value);
      else console.error('getAgingInvoices:', invR.reason);
      if (vndR.status === 'fulfilled') setVendorRows(vndR.value);
      else console.error('getAgingByVendor:', vndR.reason);
      if (dpoR.status === 'fulfilled') setDpo(dpoR.value);
      else console.error('getDpoMetrics:', dpoR.reason);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setFirstLoadDone(true);
    }
  }, [selectedBucket, periodDays]);

  useEffect(() => {
    void load();
  }, [load]);

  const barData = useMemo(
    () =>
      buckets.map((b) => ({
        name: b.label,
        amount: b.total_amount,
        count: b.invoice_count,
        fill: b.color,
      })),
    [buckets]
  );

  const vendorChartData = useMemo(
    () =>
      vendorRows.map((r) => ({
        name: r.vendor.length > 28 ? `${r.vendor.slice(0, 28)}…` : r.vendor,
        current: r.current,
        overdue: r.overdue,
      })),
    [vendorRows]
  );

  const sortedInvoices = useMemo(() => {
    const arr = [...invoices];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'amount') cmp = a.amount - b.amount;
      else if (sortKey === 'days_overdue') cmp = a.days_overdue - b.days_overdue;
      else {
        const ad = a.due_date ? new Date(a.due_date).getTime() : 0;
        const bd = b.due_date ? new Date(b.due_date).getTime() : 0;
        cmp = ad - bd;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [invoices, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedInvoices.length / pageSize));
  const pageSlice = sortedInvoices.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage(1);
  }, [selectedBucket, sortKey, sortDir, invoices.length]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'amount' ? 'desc' : 'asc');
    }
  }

  const overdueCount = useMemo(
    () => invoices.filter((i) => i.days_overdue > 0).length,
    [invoices]
  );
  const overdueAmt = useMemo(
    () => invoices.filter((i) => i.days_overdue > 0).reduce((s, i) => s + i.amount, 0),
    [invoices]
  );

  if (!firstLoadDone) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div id="ap-aging-report" className="space-y-8 print:space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between print:hidden">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">AP Aging report</h1>
          <p className="mt-1 text-sm text-gray-500">
            Outstanding balances, buckets, and days payable outstanding (DPO)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={String(periodDays)}
            onValueChange={(v) => setPeriodDays(Number(v))}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Period" />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  DPO window: last {d} days
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => exportAgingCsv(sortedInvoices)}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            Print / PDF
          </Button>
        </div>
      </div>

      {/* DPO metrics */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              DPO
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-3xl font-bold ${
                (dpo?.dpo ?? 0) > 60
                  ? 'text-red-600'
                  : (dpo?.dpo ?? 0) > 45
                    ? 'text-amber-600'
                    : 'text-gray-900'
              }`}
            >
              {dpo?.dpo ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Days payable outstanding</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg payment time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-gray-900">{dpo?.avg_payment_days ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Days from invoice date to paid</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              On-time rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-3xl font-bold ${
                (dpo?.on_time_payment_rate ?? 0) >= 80
                  ? 'text-emerald-600'
                  : (dpo?.on_time_payment_rate ?? 0) >= 60
                    ? 'text-amber-600'
                    : 'text-red-600'
              }`}
            >
              {dpo?.on_time_payment_rate ?? 0}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">Paid on or before due date</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total overdue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-3xl font-bold ${
                (dpo?.total_overdue ?? 0) > 0 ? 'text-red-600' : 'text-gray-900'
              }`}
            >
              {formatCurrency(dpo?.total_overdue ?? 0, baseCurrency)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Unpaid invoices past due date</p>
          </CardContent>
        </Card>
      </div>

      {/* Bucket cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {buckets.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={() => setSelectedBucket((prev) => (prev === b.key ? 'all' : b.key))}
            className={`text-left rounded-lg border p-4 transition ring-offset-2 ${
              selectedBucket === b.key ? 'ring-2 ring-[#0A4B8F]' : 'hover:bg-muted/40'
            }`}
          >
            <div className="text-sm font-medium text-muted-foreground">{b.label}</div>
            <div className="mt-2 text-2xl font-bold" style={{ color: b.color }}>
              {formatCurrency(b.total_amount, baseCurrency)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {b.invoice_count} invoice{b.invoice_count !== 1 ? 's' : ''}
            </div>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Aging by amount</CardTitle>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(value: number, _n: string, props: { payload?: { count?: number } }) => [
                  `${formatCurrency(value, baseCurrency)} (${props.payload?.count ?? 0} invoices)`,
                  'Amount',
                ]}
              />
              <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                {barData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Outstanding invoices</CardTitle>
          {selectedBucket !== 'all' && (
            <p className="text-xs text-muted-foreground font-normal mt-1">
              Filter: {buckets.find((b) => b.key === selectedBucket)?.label ?? selectedBucket} —{' '}
              <button
                type="button"
                className="text-[#0A4B8F] underline"
                onClick={() => setSelectedBucket('all')}
              >
                Clear
              </button>
            </p>
          )}
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-medium hover:text-primary"
                    onClick={() => toggleSort('amount')}
                  >
                    Amount
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead>Invoice date</TableHead>
                <TableHead>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-medium hover:text-primary"
                    onClick={() => toggleSort('due_date')}
                  >
                    Due date
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-medium hover:text-primary"
                    onClick={() => toggleSort('days_overdue')}
                  >
                    Days overdue
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageSlice.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No unpaid invoices in this view
                  </TableCell>
                </TableRow>
              ) : (
                pageSlice.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.invoice_number ?? '—'}</TableCell>
                    <TableCell>{row.vendor_name ?? '—'}</TableCell>
                    <TableCell>{formatCurrency(row.amount, baseCurrency)}</TableCell>
                    <TableCell>{displayDate(row.invoice_date ?? '', dateFormat)}</TableCell>
                    <TableCell>{displayDate(row.due_date ?? '', dateFormat)}</TableCell>
                    <TableCell>
                      {row.days_overdue <= 0 ? (
                        <span className="text-emerald-600 font-medium">On time</span>
                      ) : (
                        <span className="text-red-600 font-medium">{row.days_overdue}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {row.payment_status ?? 'unpaid'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => navigate('/calendar')}
                      >
                        Pay now
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
              <span>
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Outstanding by vendor</CardTitle>
          <p className="text-xs text-muted-foreground font-normal">
            Top 10 vendors — stacked: current (green) vs overdue (red)
          </p>
        </CardHeader>
        <CardContent>
          {vendorChartData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No vendor data</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(280, vendorChartData.length * 36)}>
              <BarChart data={vendorChartData} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} />
                <Tooltip
                  formatter={(value: number) => formatCurrency(value, baseCurrency)}
                />
                <Legend />
                <Bar dataKey="current" stackId="v" fill="#1D9E75" name="Current / not past due" />
                <Bar dataKey="overdue" stackId="v" fill="#E24B4A" name="Past due" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="text-sm text-muted-foreground print:block hidden">
        Total outstanding (unpaid): {formatCurrency(dpo?.total_outstanding ?? 0, baseCurrency)}
        {overdueCount > 0 && (
          <span className="text-red-600">
            {' '}
            — {overdueCount} overdue ({formatCurrency(overdueAmt, baseCurrency)})
          </span>
        )}
      </div>
    </div>
  );
}
