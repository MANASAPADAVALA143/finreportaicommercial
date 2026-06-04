import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, type Invoice, type PaymentBatch } from '../../lib/ap-invoice/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Calendar } from '../../components/ui/calendar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Checkbox } from '../../components/ui/checkbox';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../components/ui/popover';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { ChevronLeftIcon, ChevronRightIcon } from '@radix-ui/react-icons';
import { AlertCircle, DollarSign, TrendingUp } from 'lucide-react';
import { format, isSameDay, isSameMonth, addWeeks, startOfWeek, endOfWeek } from 'date-fns';
import { cn } from '../../lib/ap-invoice/utils';
import {
  BarChart as RechartsBarChart,
  Bar as RechartsBar,
  XAxis as RechartsXAxis,
  YAxis as RechartsYAxis,
  CartesianGrid as RechartsCartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer as RechartsResponsiveContainer,
  Legend as RechartsLegend,
} from 'recharts';
import { formatCurrency } from '../../utils/currency';
import { displayDate } from '../../utils/dateUtils';
import { useToast } from '../../hooks/use-toast';
import { useWorkEmail } from '../../hooks/useWorkEmail';
import {
  schedulePayments,
  markAsPaid,
  getPaymentQueue,
  markOverdueInvoices,
  createPaymentBatch,
  listPaymentBatches,
  fetchInvoicesByIds,
  updatePaymentBatchStatus,
  effectivePaymentDate,
  normalizedOpenPaymentStatus,
} from '../../lib/ap-invoice/paymentService';
import { exportPaymentBatchCsv } from '../../lib/ap-invoice/exportPaymentCsv';

type PayDot = 'overdue' | 'dueSoon' | 'scheduled' | 'future' | 'paid';

const PAY_RANK: Record<PayDot, number> = {
  overdue: 0,
  dueSoon: 1,
  scheduled: 2,
  future: 3,
  paid: 4,
};

function invoicePayBucket(inv: Invoice): PayDot {
  const ps = normalizedOpenPaymentStatus(inv);
  if (ps === 'paid') return 'paid';
  if (ps === 'overdue') return 'overdue';
  if (ps === 'scheduled') return 'scheduled';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (!inv.due_date) return 'future';
  const dueDate = new Date(inv.due_date);
  dueDate.setHours(0, 0, 0, 0);
  if (dueDate < today) return 'overdue';
  const daysUntilDue = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (daysUntilDue <= 7) return 'dueSoon';
  return 'future';
}

function worstPayDot(dayInvoices: Invoice[]): PayDot {
  let w: PayDot = 'paid';
  for (const inv of dayInvoices) {
    const b = invoicePayBucket(inv);
    if (PAY_RANK[b] < PAY_RANK[w]) w = b;
  }
  return w;
}

function dotClass(dot: PayDot): string {
  switch (dot) {
    case 'overdue':
      return 'bg-red-500';
    case 'dueSoon':
      return 'bg-amber-500';
    case 'scheduled':
      return 'bg-blue-500';
    case 'paid':
      return 'bg-green-500';
    default:
      return 'bg-gray-400';
  }
}

function addInvoiceByDay(map: Map<string, Invoice[]>, d: Date, inv: Invoice) {
  const key = format(d, 'yyyy-MM-dd');
  const arr = map.get(key) ?? [];
  if (!arr.some((i) => i.id === inv.id)) arr.push(inv);
  map.set(key, arr);
}

function buildPayModifierDates(invoices: Invoice[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const map = new Map<string, Invoice[]>();

  const isPaid = (inv: Invoice) =>
    inv.status === 'Paid' || normalizedOpenPaymentStatus(inv) === 'paid';

  for (const inv of invoices) {
    if (isPaid(inv)) continue;

    if (inv.due_date) addInvoiceByDay(map, new Date(inv.due_date), inv);
    if (inv.scheduled_payment_date) {
      addInvoiceByDay(map, new Date(inv.scheduled_payment_date), inv);
    }

    const ps = normalizedOpenPaymentStatus(inv);
    if (ps === 'scheduled') continue;
    if (!inv.due_date) continue;
    const dueDate = new Date(inv.due_date);
    dueDate.setHours(0, 0, 0, 0);
    if (dueDate < today) {
      addInvoiceByDay(map, new Date(today), inv);
    }
  }
  const overdue: Date[] = [];
  const dueSoon: Date[] = [];
  const scheduled: Date[] = [];
  const future: Date[] = [];
  const paid: Date[] = [];
  for (const [key, list] of map) {
    const dot = worstPayDot(list);
    const d = new Date(key + 'T12:00:00');
    switch (dot) {
      case 'overdue':
        overdue.push(d);
        break;
      case 'dueSoon':
        dueSoon.push(d);
        break;
      case 'scheduled':
        scheduled.push(d);
        break;
      case 'future':
        future.push(d);
        break;
      default:
        paid.push(d);
    }
  }
  return { overdue, dueSoon, scheduled, future, paid };
}

function queueGroupLabel(inv: Invoice, today: Date): string {
  const eff = effectivePaymentDate(inv);
  if (!eff) return 'Later';
  const d = new Date(eff + 'T12:00:00');
  if (isSameDay(d, today)) return 'Today';
  const ws = startOfWeek(today);
  const we = endOfWeek(today);
  if (d >= ws && d <= we) return 'This week';
  const nws = startOfWeek(addWeeks(today, 1));
  const nwe = endOfWeek(addWeeks(today, 1));
  if (d >= nws && d <= nwe) return 'Next week';
  return 'Later';
}

export function PaymentCalendar() {
  const { toast } = useToast();
  const { email: workEmail } = useWorkEmail();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [queue, setQueue] = useState<Invoice[]>([]);
  const [batches, setBatches] = useState<PaymentBatch[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [scheduleDate, setScheduleDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [payReference, setPayReference] = useState('');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [paidOpen, setPaidOpen] = useState(false);

  const refreshQueue = useCallback(async () => {
    try {
      const q = await getPaymentQueue(30);
      setQueue(q);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const fetchInvoices = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .order('due_date', { ascending: true });

      if (error) throw error;
      setInvoices(data || []);
    } catch (error) {
      console.error('Error fetching invoices:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void markOverdueInvoices();
    void fetchInvoices();
    void refreshQueue();
  }, [fetchInvoices, refreshQueue]);

  const loadBatches = useCallback(async () => {
    setBatchesLoading(true);
    try {
      const list = await listPaymentBatches();
      setBatches(list);
    } catch (e) {
      console.error(e);
      toast({ title: 'Could not load batches', variant: 'destructive' });
    } finally {
      setBatchesLoading(false);
    }
  }, [toast]);

  function getInvoicesForDate(date: Date): Invoice[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);

    return invoices.filter((inv) => {
      if (inv.status === 'Paid' || normalizedOpenPaymentStatus(inv) === 'paid') return false;

      const due = inv.due_date ? isSameDay(new Date(inv.due_date), date) : false;
      const sched = inv.scheduled_payment_date
        ? isSameDay(new Date(inv.scheduled_payment_date), date)
        : false;
      if (due || sched) return true;

      if (isSameDay(target, today)) {
        const ps = normalizedOpenPaymentStatus(inv);
        if (ps === 'scheduled') return false;
        if (!inv.due_date) return false;
        const dueDate = new Date(inv.due_date);
        dueDate.setHours(0, 0, 0, 0);
        return dueDate < today;
      }
      return false;
    });
  }

  const payModifiers = useMemo(() => buildPayModifierDates(invoices), [invoices]);

  function calculateCashFlow() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weeks: Array<{ week: string; amount: number }> = [];

    for (let i = 0; i < 8; i++) {
      const weekStart = startOfWeek(addWeeks(today, i));
      const weekEnd = endOfWeek(addWeeks(today, i));
      const weekLabel = `Week ${i + 1} (${format(weekStart, 'MMM dd')} - ${format(weekEnd, 'MMM dd')})`;

      const weekAmount = invoices
        .filter((inv) => {
          if (inv.status === 'Paid' || normalizedOpenPaymentStatus(inv) === 'paid') return false;
          const ps = normalizedOpenPaymentStatus(inv);
          if (ps === 'scheduled' && inv.scheduled_payment_date) {
            const s = new Date(inv.scheduled_payment_date);
            s.setHours(0, 0, 0, 0);
            return s >= weekStart && s <= weekEnd;
          }
          if (!inv.due_date) return false;
          const dueDate = new Date(inv.due_date);
          dueDate.setHours(0, 0, 0, 0);
          if (dueDate >= weekStart && dueDate <= weekEnd) return true;
          if (i === 0 && ps !== 'scheduled' && dueDate < weekStart) return true;
          return false;
        })
        .reduce((sum, inv) => sum + Number(inv.total_amount), 0);

      weeks.push({ week: weekLabel, amount: weekAmount });
    }

    return weeks;
  }

  const overdueInvoices = invoices.filter((inv) => {
    if (inv.status === 'Paid') return false;
    const ps = normalizedOpenPaymentStatus(inv);
    if (ps === 'paid') return false;
    if (ps === 'overdue') return true;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!inv.due_date) return false;
    const dueDate = new Date(inv.due_date);
    dueDate.setHours(0, 0, 0, 0);
    return ps !== 'scheduled' && dueDate < today;
  });

  const overdueInvoiceTotal = overdueInvoices.reduce(
    (sum, inv) => sum + Number(inv.total_amount ?? 0),
    0
  );

  const thisWeekTotal = invoices
    .filter((inv) => {
      if (inv.status === 'Paid' || normalizedOpenPaymentStatus(inv) === 'paid') return false;
      const ps = normalizedOpenPaymentStatus(inv);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const weekStart = startOfWeek(today);
      const weekEnd = endOfWeek(today);
      if (ps === 'scheduled' && inv.scheduled_payment_date) {
        const s = new Date(inv.scheduled_payment_date);
        s.setHours(0, 0, 0, 0);
        return s >= weekStart && s <= weekEnd;
      }
      if (!inv.due_date) return false;
      const dueDate = new Date(inv.due_date);
      dueDate.setHours(0, 0, 0, 0);
      if (dueDate >= weekStart && dueDate <= weekEnd) return true;
      if (ps !== 'scheduled' && dueDate < weekStart) return true;
      return false;
    })
    .reduce((sum, inv) => sum + Number(inv.total_amount), 0);

  const thisMonthTotal = invoices
    .filter((inv) => {
      if (inv.status === 'Paid' || normalizedOpenPaymentStatus(inv) === 'paid') return false;
      if (!inv.due_date) return false;
      const dueDate = new Date(inv.due_date);
      return isSameMonth(dueDate, currentMonth);
    })
    .reduce((sum, inv) => sum + Number(inv.total_amount), 0);

  const nextMonth = new Date(currentMonth);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const nextMonthTotal = invoices
    .filter((inv) => {
      if (inv.status === 'Paid' || normalizedOpenPaymentStatus(inv) === 'paid') return false;
      if (!inv.due_date) return false;
      const dueDate = new Date(inv.due_date);
      return isSameMonth(dueDate, nextMonth);
    })
    .reduce((sum, inv) => sum + Number(inv.total_amount), 0);

  const selectedDateInvoices = selectedDate ? getInvoicesForDate(selectedDate) : [];
  const cashFlowData = calculateCashFlow();

  const queueUnpaidTotal = useMemo(
    () =>
      queue
        .filter((inv) => (inv.payment_status ?? 'unpaid') !== 'scheduled')
        .reduce((s, inv) => s + Number(inv.total_amount ?? 0), 0),
    [queue]
  );

  const groupedQueue = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const order = ['Today', 'This week', 'Next week', 'Later'] as const;
    const buckets: Record<(typeof order)[number], Invoice[]> = {
      Today: [],
      'This week': [],
      'Next week': [],
      Later: [],
    };
    for (const inv of queue) {
      const g = queueGroupLabel(inv, today) as (typeof order)[number];
      buckets[g].push(inv);
    }
    return order.map((label) => ({ label, items: buckets[label] }));
  }, [queue]);

  const selectedList = useMemo(
    () => queue.filter((i) => selectedIds.has(i.id)),
    [queue, selectedIds]
  );

  function toggleId(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onScheduleConfirm() {
    const ids = [...selectedIds];
    if (!ids.length || !scheduleDate) return;
    try {
      await schedulePayments(ids, scheduleDate);
      toast({ title: 'Payments scheduled' });
      setScheduleOpen(false);
      setSelectedIds(new Set());
      await fetchInvoices();
      await refreshQueue();
    } catch (e: unknown) {
      toast({
        title: 'Schedule failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    }
  }

  async function onMarkPaidConfirm() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    try {
      await markAsPaid(ids, payReference.trim() || 'â€”');
      toast({ title: 'Marked as paid' });
      setPaidOpen(false);
      setPayReference('');
      setSelectedIds(new Set());
      await fetchInvoices();
      await refreshQueue();
    } catch (e: unknown) {
      toast({
        title: 'Update failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    }
  }

  async function onExportBatch() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const today = format(new Date(), 'yyyy-MM-dd');
    try {
      const batch = await createPaymentBatch(ids, today, workEmail.trim() || 'unknown');
      exportPaymentBatchCsv(selectedList.length ? selectedList : queue.filter((i) => ids.includes(i.id)), today);
      await updatePaymentBatchStatus(batch.id, 'exported');
      toast({ title: 'Batch exported', description: 'CSV downloaded and batch logged.' });
      setSelectedIds(new Set());
      await loadBatches();
    } catch (e: unknown) {
      toast({
        title: 'Export failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    }
  }

  async function onExportBatchRow(batch: PaymentBatch) {
    try {
      const invs = await fetchInvoicesByIds(batch.invoice_ids || []);
      exportPaymentBatchCsv(invs, batch.batch_date.slice(0, 10));
      await updatePaymentBatchStatus(batch.id, 'exported');
      toast({ title: 'CSV exported' });
      await loadBatches();
    } catch (e: unknown) {
      toast({
        title: 'Export failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    }
  }

  function paymentStatusBadge(inv: Invoice) {
    const ps = inv.payment_status ?? 'unpaid';
    const map: Record<string, string> = {
      overdue: 'bg-red-100 text-red-800 border-red-200',
      unpaid: 'bg-gray-100 text-gray-800 border-gray-200',
      scheduled: 'bg-blue-100 text-blue-800 border-blue-200',
      paid: 'bg-green-100 text-green-800 border-green-200',
    };
    return (
      <Badge variant="outline" className={map[ps] ?? map.unpaid}>
        {ps}
      </Badge>
    );
  }

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-12rem)] items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading calendar...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Payment Calendar</h1>
        <p className="mt-1 text-sm text-gray-500">
          Track invoice due dates, schedule payments, and export batches
        </p>
      </div>

      {overdueInvoices.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Overdue Invoices</AlertTitle>
          <AlertDescription>
            You have <strong>{overdueInvoices.length}</strong> overdue invoice(s) totaling{' '}
            <strong>
              {formatCurrency(
                overdueInvoices.reduce((sum, inv) => sum + Number(inv.total_amount), 0),
                overdueInvoices[0]?.currency ?? 'INR'
              )}
            </strong>
            . Please review and process them immediately.
          </AlertDescription>
        </Alert>
      )}

      <Tabs
        defaultValue="calendar"
        onValueChange={(v) => {
          if (v === 'batches') void loadBatches();
        }}
      >
        <TabsList>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="batches">Batches</TabsTrigger>
        </TabsList>

        <TabsContent value="calendar" className="mt-6 space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Calendar View</CardTitle>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const prevMonth = new Date(currentMonth);
                          prevMonth.setMonth(prevMonth.getMonth() - 1);
                          setCurrentMonth(prevMonth);
                        }}
                      >
                        Previous
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setCurrentMonth(new Date())}>
                        Today
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const nextMonth = new Date(currentMonth);
                          nextMonth.setMonth(nextMonth.getMonth() + 1);
                          setCurrentMonth(nextMonth);
                        }}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={setSelectedDate}
                    month={currentMonth}
                    onMonthChange={setCurrentMonth}
                    className="rounded-md border"
                    modifiers={{
                      payOverdue: payModifiers.overdue,
                      payDueSoon: payModifiers.dueSoon,
                      payScheduled: payModifiers.scheduled,
                      payFuture: payModifiers.future,
                      payPaid: payModifiers.paid,
                    }}
                    modifiersClassNames={{
                      payOverdue: 'bg-red-50',
                      payDueSoon: 'bg-amber-50',
                      payScheduled: 'bg-blue-50',
                      payFuture: 'bg-gray-50',
                      payPaid: 'bg-green-50',
                    }}
                    components={{
                      IconLeft: () => <ChevronLeftIcon className="h-4 w-4" />,
                      IconRight: () => <ChevronRightIcon className="h-4 w-4" />,
                      DayContent: (props) => {
                        const dayInvoices = getInvoicesForDate(props.date);
                        const dot =
                          dayInvoices.length > 0 ? dotClass(worstPayDot(dayInvoices)) : '';
                        return (
                          <div className="relative flex h-full w-full flex-col items-center justify-center">
                            <span>{format(props.date, 'd')}</span>
                            {dot ? (
                              <span
                                className={cn('mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full', dot)}
                              />
                            ) : null}
                          </div>
                        );
                      },
                    }}
                  />

                  <div className="mt-4 flex flex-wrap gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full bg-green-500" />
                      <span>Paid</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full bg-blue-500" />
                      <span>Scheduled</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full bg-amber-500" />
                      <span>Unpaid (due â‰¤7 days)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full bg-red-500" />
                      <span>Overdue</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full bg-gray-400" />
                      <span>Unpaid (later)</span>
                    </div>
                  </div>

                  {selectedDate && selectedDateInvoices.length > 0 && (
                    <div className="mt-6 space-y-2">
                      <h3 className="font-semibold text-sm">
                        Payments on {format(selectedDate, 'MMMM dd, yyyy')}
                      </h3>
                      <div className="space-y-2">
                        {selectedDateInvoices.map((invoice) => (
                          <div
                            key={invoice.id}
                            className="flex items-center justify-between rounded-lg border p-3"
                          >
                            <div>
                              <p className="font-medium">{invoice.invoice_number}</p>
                              <p className="text-sm text-gray-600">{invoice.vendor_name}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              {paymentStatusBadge(invoice)}
                              <Badge
                                variant="outline"
                                className={
                                  invoice.status === 'Paid'
                                    ? 'bg-green-100 text-green-800 border-green-200'
                                    : invoice.status === 'Approved'
                                      ? 'bg-blue-100 text-blue-800 border-blue-200'
                                      : 'bg-yellow-100 text-yellow-800 border-yellow-200'
                                }
                              >
                                {invoice.status}
                              </Badge>
                              <span className="font-semibold">
                                {formatCurrency(Number(invoice.total_amount), invoice.currency)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Payment queue</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Unpaid &amp; overdue total:{' '}
                    <span className="font-semibold text-foreground">
                      {formatCurrency(queueUnpaidTotal, 'INR')}
                    </span>{' '}
                    (mixed currencies summed as numbers)
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="max-h-[320px] space-y-4 overflow-y-auto pr-1">
                    {groupedQueue.every((g) => g.items.length === 0) ? (
                      <p className="text-sm text-muted-foreground">No items in queue.</p>
                    ) : (
                      groupedQueue.map(
                        (g) =>
                          g.items.length > 0 && (
                            <div key={g.label}>
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                {g.label}
                              </p>
                              <div className="space-y-2">
                                {g.items.map((inv) => (
                                  <div
                                    key={inv.id}
                                    className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-2 text-sm"
                                  >
                                    <Checkbox
                                      checked={selectedIds.has(inv.id)}
                                      onCheckedChange={() => toggleId(inv.id)}
                                      aria-label={`Select ${inv.invoice_number}`}
                                    />
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate font-medium">{inv.vendor_name}</p>
                                      <p className="text-xs text-muted-foreground">
                                        Due {displayDate(inv.due_date)}
                                        {inv.scheduled_payment_date
                                          ? ` Â· Sched ${displayDate(inv.scheduled_payment_date)}`
                                          : ''}
                                      </p>
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end gap-1">
                                      {paymentStatusBadge(inv)}
                                      <span className="font-semibold">
                                        {formatCurrency(Number(inv.total_amount), inv.currency)}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )
                      )
                    )}
                  </div>

                  {selectedIds.size > 0 && (
                    <div className="flex flex-wrap gap-2 border-t pt-3">
                      <Popover open={scheduleOpen} onOpenChange={setScheduleOpen}>
                        <PopoverTrigger asChild>
                          <Button size="sm" variant="secondary">
                            Schedule payment
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72 space-y-3" align="start">
                          <Label htmlFor="sched-date">Schedule for date</Label>
                          <Input
                            id="sched-date"
                            type="date"
                            value={scheduleDate}
                            onChange={(e) => setScheduleDate(e.target.value)}
                          />
                          <Button size="sm" className="w-full" onClick={() => void onScheduleConfirm()}>
                            Confirm
                          </Button>
                        </PopoverContent>
                      </Popover>

                      <Popover open={paidOpen} onOpenChange={setPaidOpen}>
                        <PopoverTrigger asChild>
                          <Button size="sm" variant="secondary">
                            Mark as paid
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72 space-y-3" align="start">
                          <Label htmlFor="pay-ref">Payment reference</Label>
                          <Input
                            id="pay-ref"
                            value={payReference}
                            onChange={(e) => setPayReference(e.target.value)}
                            placeholder="UTR / cheque #"
                          />
                          <Button size="sm" className="w-full" onClick={() => void onMarkPaidConfirm()}>
                            Confirm
                          </Button>
                        </PopoverContent>
                      </Popover>

                      <Button size="sm" onClick={() => void onExportBatch()}>
                        Export batch CSV
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <DollarSign className="h-5 w-5" />
                    Cash Flow Forecast
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">This Week</span>
                      <span className="font-semibold">{formatCurrency(thisWeekTotal, 'INR')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">This Month</span>
                      <span className="font-semibold">{formatCurrency(thisMonthTotal, 'INR')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Next Month</span>
                      <span className="font-semibold">{formatCurrency(nextMonthTotal, 'INR')}</span>
                    </div>
                    {overdueInvoiceTotal > 0 && (
                      <div className="flex justify-between border-t pt-2 text-red-700">
                        <span className="text-sm">Total past due (any due date)</span>
                        <span className="font-semibold">
                          {formatCurrency(overdueInvoiceTotal, 'INR')}
                        </span>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    This week includes all open invoices still due before the start of the week so
                    old due dates are not hidden from the summary.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    8-Week Forecast
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <RechartsResponsiveContainer width="100%" height={300}>
                    <RechartsBarChart data={cashFlowData}>
                      <RechartsCartesianGrid strokeDasharray="3 3" />
                      <RechartsXAxis
                        dataKey="week"
                        angle={-45}
                        textAnchor="end"
                        height={100}
                        fontSize={10}
                      />
                      <RechartsYAxis />
                      <RechartsTooltip
                        formatter={(value: number) => formatCurrency(value, 'INR')}
                      />
                      <RechartsLegend />
                      <RechartsBar dataKey="amount" fill="#0A4B8F" name="Payment Amount" />
                    </RechartsBarChart>
                  </RechartsResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="batches" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Payment batches</CardTitle>
            </CardHeader>
            <CardContent>
              {batchesLoading ? (
                <p className="text-sm text-muted-foreground">Loadingâ€¦</p>
              ) : batches.length === 0 ? (
                <p className="text-sm text-muted-foreground">No batches yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Invoices</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead>Created by</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batches.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell>{displayDate(b.batch_date)}</TableCell>
                        <TableCell>{formatCurrency(Number(b.total_amount), 'INR')}</TableCell>
                        <TableCell>{(b.invoice_ids || []).length}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              b.status === 'exported'
                                ? 'bg-green-100 text-green-800 border-green-200'
                                : b.status === 'confirmed'
                                  ? 'bg-blue-100 text-blue-800 border-blue-200'
                                  : 'bg-gray-100 text-gray-800 border-gray-200'
                            }
                          >
                            {b.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[180px] truncate text-muted-foreground">
                          {b.notes ?? 'â€”'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{b.created_by ?? 'â€”'}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => void onExportBatchRow(b)}>
                            Export CSV
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

