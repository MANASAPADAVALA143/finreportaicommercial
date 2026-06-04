import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, type Invoice, type AuditLog } from '../../lib/ap-invoice/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { FileText, Clock, DollarSign, CheckCircle, Eye, Building2, TrendingUp, Mail } from 'lucide-react';
import { InvoiceDetailModal } from '../../components/ap-invoice/InvoiceDetailModal';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from 'recharts';
import { format } from 'date-fns';
import { formatCurrency } from '../../utils/currency';
import { displayDate } from '../../utils/dateUtils';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import { DuplicateAlertsCard } from '@/components/dashboard/DuplicateAlertsCard';
import { ExtractionReviewCard } from '@/components/dashboard/ExtractionReviewCard';
import { GstReconSummaryCard } from '@/components/dashboard/GstReconSummaryCard';
import { fetchInvoiceById } from '../../lib/ap-invoice/invoices';
import { getMyCompany } from '../../lib/ap-invoice/companyService';
import { getCashFlowForecast } from '../../lib/ap-invoice/paymentService';

const statusColors: Record<string, string> = {
  Processing: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  Approved: 'bg-green-100 text-green-800 border-green-200',
  Rejected: 'bg-red-100 text-red-800 border-red-200',
  Paid: 'bg-blue-100 text-blue-800 border-blue-200',
  'On Hold': 'bg-orange-100 text-orange-800 border-orange-200',
  Queried: 'bg-purple-100 text-purple-800 border-purple-200',
};

const COLORS = ['#FCD34D', '#34D399', '#EF4444', '#3B82F6'];

function getAgentBadgeStyle(action: string): { bg: string; label: string } {
  const a = (action || '').toLowerCase();
  if (a.includes('classification') || a.includes('ifrs')) return { bg: 'bg-[#1a56db] text-white', label: 'Classification' };
  if (a.includes('risk')) return { bg: 'bg-amber-500 text-white', label: 'Risk' };
  if (a.includes('match')) return { bg: 'bg-emerald-600 text-white', label: 'Matching' };
  return { bg: 'bg-[#1a56db] text-white', label: action || 'Activity' };
}

export function Dashboard() {
  const navigate = useNavigate();
  const { baseCurrency, dateFormat } = useCompanySettings();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    monthTotal: 0,
    monthTaxTotal: 0,
    avgProcessingTime: 0,
  });
  const [loading, setLoading] = useState(true);
  const [cashFlowWeeks, setCashFlowWeeks] = useState<
    { label: string; unpaid: number; scheduled: number }[]
  >([]);
  const [matchMonth, setMatchMonth] = useState({
    full: 0,
    partial: 0,
    variance: 0,
    noPo: 0,
    total: 0,
  });

  const monthTotalsByCurrency = useMemo(() => {
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const acc: Record<string, { total: number; tax: number }> = {};
    invoices.forEach((inv) => {
      const invDate = new Date(inv.created_at);
      if (invDate.getMonth() === currentMonth && invDate.getFullYear() === currentYear) {
        const c = (inv.currency || baseCurrency).toUpperCase();
        if (!acc[c]) acc[c] = { total: 0, tax: 0 };
        acc[c].total += Number(inv.total_amount);
        acc[c].tax += Number(inv.tax_amount || 0);
      }
    });
    return acc;
  }, [invoices, baseCurrency]);

  const monthTotalInBase = monthTotalsByCurrency[baseCurrency]?.total ?? 0;
  const monthTaxInBase = monthTotalsByCurrency[baseCurrency]?.tax ?? 0;
  const otherCurrencyTotals = useMemo(
    () => Object.entries(monthTotalsByCurrency).filter(([c]) => c !== baseCurrency),
    [monthTotalsByCurrency, baseCurrency]
  );

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      const dashCompany = await getMyCompany();
      const invQuery = dashCompany?.id
        ? supabase.from('invoices').select('*').eq('company_id', dashCompany.id).order('created_at', { ascending: false })
        : supabase.from('invoices').select('*').order('created_at', { ascending: false });
      const [invoicesRes, auditRes] = await Promise.all([
        invQuery,
        supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(4),
      ]);

      if (invoicesRes.error) throw invoicesRes.error;
      const invoiceData = invoicesRes.data || [];
      setInvoices(invoiceData);
      setSelectedInvoice((prev) => {
        if (!prev) return null;
        const next = invoiceData.find((i: Invoice) => i.id === prev.id);
        return next ?? prev;
      });

      if (!auditRes.error) setAuditLogs(auditRes.data || []);

      try {
        const co = await getMyCompany();
        if (co?.id) {
          const now = new Date();
          const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
          const { data: mrRows } = await supabase
            .from('match_results')
            .select('match_status')
            .eq('company_id', co.id)
            .gte('created_at', start);
          const acc = { full: 0, partial: 0, variance: 0, noPo: 0, total: 0 };
          for (const r of mrRows ?? []) {
            acc.total += 1;
            const s = String((r as { match_status?: string }).match_status || '');
            if (s === 'full_match') acc.full += 1;
            else if (s === 'partial_match') acc.partial += 1;
            else if (s === 'amount_variance' || s === 'qty_variance' || s === 'failed') acc.variance += 1;
            else if (s === 'no_po') acc.noPo += 1;
          }
          setMatchMonth(acc);
        }
      } catch {
        setMatchMonth({ full: 0, partial: 0, variance: 0, noPo: 0, total: 0 });
      }

      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();

      const monthInvoices = invoiceData.filter((inv) => {
        const invDate = new Date(inv.created_at);
        return (
          invDate.getMonth() === currentMonth &&
          invDate.getFullYear() === currentYear
        );
      });

      const monthTotal = monthInvoices.reduce(
        (sum, inv) => sum + Number(inv.total_amount),
        0
      );

      const monthTaxTotal = monthInvoices.reduce(
        (sum, inv) => sum + Number(inv.tax_amount || 0),
        0
      );

      const processedInvoices = invoiceData.filter(
        (inv) => inv.processing_time_seconds
      );
      const avgTime =
        processedInvoices.length > 0
          ? processedInvoices.reduce(
              (sum, inv) => sum + (inv.processing_time_seconds || 0),
              0
            ) / processedInvoices.length
          : 0;

      setStats({
        total: invoiceData.length,
        pending: invoiceData.filter((inv) => inv.status === 'Processing')
          .length,
        monthTotal,
        monthTaxTotal,
        avgProcessingTime: Math.round(avgTime),
      });

      try {
        const weeks = await getCashFlowForecast();
        setCashFlowWeeks(weeks);
      } catch {
        setCashFlowWeeks([]);
      }
    } catch (error) {
      console.error('Error fetching invoices:', error);
    } finally {
      setLoading(false);
    }
  }

  const statusData = [
    {
      name: 'Processing',
      value: invoices.filter((inv) => inv.status === 'Processing').length,
    },
    {
      name: 'Approved',
      value: invoices.filter((inv) => inv.status === 'Approved').length,
    },
    {
      name: 'Rejected',
      value: invoices.filter((inv) => inv.status === 'Rejected').length,
    },
    {
      name: 'Paid',
      value: invoices.filter((inv) => inv.status === 'Paid').length,
    },
  ];

  const monthlyData = Array.from({ length: 6 }, (_, i) => {
    const month = new Date();
    month.setMonth(month.getMonth() - (5 - i));
    const monthInvoices = invoices.filter((inv) => {
      const invDate = new Date(inv.created_at);
      return (
        invDate.getMonth() === month.getMonth() &&
        invDate.getFullYear() === month.getFullYear()
      );
    });
    return {
      month: format(month, 'MMM'),
      amount: monthInvoices.reduce(
        (sum, inv) => sum + Number(inv.total_amount),
        0
      ),
    };
  });

  const hasAnyEmailInvoice = useMemo(
    () => invoices.some((inv) => inv.source === 'email'),
    [invoices]
  );

  const emailInvoicesThisMonth = useMemo(() => {
    const m = new Date().getMonth();
    const y = new Date().getFullYear();
    return invoices.filter((inv) => {
      if (inv.source !== 'email') return false;
      const d = new Date(inv.created_at);
      return d.getMonth() === m && d.getFullYear() === y;
    }).length;
  }, [invoices]);

  const apAgingWidget = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    let current = 0;
    let d1 = 0;
    let d2 = 0;
    let d60 = 0;
    for (const inv of invoices) {
      if (inv.status === 'Paid' || inv.payment_status === 'paid') continue;
      const amt = Number(inv.total_amount);
      if (!inv.due_date) {
        current += amt;
        continue;
      }
      const days = Math.floor(
        (new Date(today).getTime() - new Date(inv.due_date).getTime()) / 86400000
      );
      if (days <= 0) current += amt;
      else if (days <= 30) d1 += amt;
      else if (days <= 60) d2 += amt;
      else d60 += amt;
    }
    const totalOutstanding = current + d1 + d2 + d60;
    const overdueTotal = d1 + d2 + d60;
    return {
      current,
      d1,
      d2,
      d60,
      totalOutstanding,
      overdueTotal,
      maxBar: Math.max(current, d1, d2, d60, 1),
    };
  }, [invoices]);

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-12rem)] items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Invoice processing overview and statistics
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">
              Total Invoices
            </CardTitle>
            <FileText className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-gray-900">{stats.total}</div>
            <p className="text-xs text-gray-500 mt-1">All time processed</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">
              Pending Approvals
            </CardTitle>
            <Clock className="h-5 w-5 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-gray-900">
              {stats.pending}
            </div>
            <p className="text-xs text-gray-500 mt-1">Awaiting review</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">
              This Month's Total
            </CardTitle>
            <DollarSign className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-gray-900">
              {formatCurrency(monthTotalInBase, baseCurrency)}
            </div>
            <p className="text-xs text-gray-500 mt-1">Base currency: {baseCurrency}</p>
            {otherCurrencyTotals.length > 0 && (
              <p className="text-xs text-amber-700 mt-1">
                Also this month:{' '}
                {otherCurrencyTotals
                  .map(([c, v]) => `${formatCurrency(v.total, c)}`)
                  .join(' Â· ')}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">
              Total Tax This Month
            </CardTitle>
            <DollarSign className="h-5 w-5 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-gray-900">
              {formatCurrency(monthTaxInBase, baseCurrency)}
            </div>
            <p className="text-xs text-gray-500 mt-1">Tax in {baseCurrency} (same-currency invoices)</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">
              Avg Processing Time
            </CardTitle>
            <CheckCircle className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-gray-900">
              {stats.avgProcessingTime}s
            </div>
            <p className="text-xs text-gray-500 mt-1">Per invoice</p>
          </CardContent>
        </Card>

        <DuplicateAlertsCard invoices={invoices} />
        <ExtractionReviewCard invoices={invoices} />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">3-Way match â€” this month</CardTitle>
            <TrendingUp className="h-5 w-5 text-emerald-600" />
          </CardHeader>
          <CardContent className="text-xs text-gray-600 space-y-1.5">
            {matchMonth.total === 0 ? (
              <p className="text-gray-500">No match runs logged yet (run THREE-WAY-MATCH-MIGRATION.sql).</p>
            ) : (
              <>
                <div className="flex justify-between gap-2">
                  <span>Fully matched</span>
                  <span className="font-medium text-gray-900">
                    {matchMonth.full}{' '}
                    <span className="text-gray-500">
                      ({Math.round((matchMonth.full / matchMonth.total) * 100)}%)
                    </span>
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Partial match</span>
                  <span className="font-medium text-gray-900">
                    {matchMonth.partial}{' '}
                    <span className="text-gray-500">
                      ({Math.round((matchMonth.partial / matchMonth.total) * 100)}%)
                    </span>
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Variance flags</span>
                  <span className="font-medium text-gray-900">
                    {matchMonth.variance}{' '}
                    <span className="text-gray-500">
                      ({Math.round((matchMonth.variance / matchMonth.total) * 100)}%)
                    </span>
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>No PO</span>
                  <span className="font-medium text-gray-900">
                    {matchMonth.noPo}{' '}
                    <span className="text-gray-500">
                      ({Math.round((matchMonth.noPo / matchMonth.total) * 100)}%)
                    </span>
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* SECTION 1: AI Live Activity Strip */}
      <Card className="bg-white border shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-gray-900">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
            </span>
            Multi-Agent AI â€” Live Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-3">
            {auditLogs.length === 0 ? (
              <p className="text-sm text-gray-500 py-2">No recent activity</p>
            ) : (
              auditLogs.map((log) => {
                const { bg, label } = getAgentBadgeStyle(log.action);
                const message = log.field_changed
                  ? `${log.action}${log.old_value || log.new_value ? `: ${log.field_changed}` : ''}`
                  : log.action;
                return (
                  <div
                    key={log.id}
                    className="flex items-center justify-between gap-4 rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${bg}`}>
                        {label}
                      </span>
                      <span className="text-sm text-gray-700 truncate">{message}</span>
                    </div>
                    <span className="shrink-0 text-xs text-gray-500">
                      {format(new Date(log.created_at), 'MMM d, HH:mm')}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* SECTION 2: Action Required Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Card className="bg-white border shadow-sm border-l-4 border-l-orange-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-900">
              Pending IFRS Classification
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const unclassified = invoices.filter(
                (inv) => inv.ifrs_category == null || inv.ifrs_category === ''
              );
              return (
                <>
                  <div className="text-2xl font-bold text-gray-900">{unclassified.length}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-800">
                      {unclassified.length} unclassified
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 w-full border-[#1a56db] text-[#1a56db] hover:bg-[#1a56db]/10"
                    onClick={() => navigate('/invoices?filter=unclassified')}
                  >
                    Review in Invoice List
                  </Button>
                </>
              );
            })()}
          </CardContent>
        </Card>

        <Card className="bg-white border shadow-sm border-l-4 border-l-yellow-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-900">
              Awaiting Approval
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const pending = invoices.filter((inv) => inv.status === 'Processing');
              const cfoCount = pending.filter((inv) => inv.approval_level === 'cfo').length;
              const managerCount = pending.filter((inv) => inv.approval_level === 'manager').length;
              return (
                <>
                  <div className="text-2xl font-bold text-gray-900">{pending.length}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                      CFO: {cfoCount}
                    </span>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                      Manager: {managerCount}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 w-full border-[#1a56db] text-[#1a56db] hover:bg-[#1a56db]/10"
                    onClick={() => navigate('/invoices')}
                  >
                    Approve Queue
                  </Button>
                </>
              );
            })()}
          </CardContent>
        </Card>

        <Card className="bg-white border shadow-sm border-l-4 border-l-amber-600">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-900">
              Top Risk Flags
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const allFlags = invoices.flatMap((inv) => {
                try {
                  const f = (inv as { risk_flags?: unknown }).risk_flags;
                  if (!f || f === '[]') return [];
                  return Array.isArray(f) ? f : JSON.parse(typeof f === 'string' ? f : '[]');
                } catch {
                  return [];
                }
              });
              const flagCounts = allFlags.reduce((acc: Record<string, number>, flag: unknown) => {
                const f = flag as { message?: string };
                const msg = f?.message ?? 'Unknown';
                acc[msg] = (acc[msg] || 0) + 1;
                return acc;
              }, {});
              const topFlags = Object.entries(flagCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4);
              return topFlags.length > 0 ? (
                <>
                  <div className="space-y-1">
                    {topFlags.map(([msg, count]) => (
                      <div
                        key={msg}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '6px 0',
                          borderBottom: '1px solid #f3f4f6',
                          fontSize: '12.5px',
                        }}
                      >
                        <span style={{ color: '#374151' }}>{msg}</span>
                        <span
                          style={{
                            fontWeight: 700,
                            color: '#e02424',
                            background: '#fee2e2',
                            padding: '1px 8px',
                            borderRadius: '20px',
                            fontSize: '11px',
                          }}
                        >
                          {Number(count)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 w-full border-[#1a56db] text-[#1a56db] hover:bg-[#1a56db]/10"
                    onClick={() => navigate('/invoices')}
                  >
                    View Invoices
                  </Button>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold text-gray-900">0</div>
                  <p className="text-xs text-gray-500 mt-1">No risk flags detected yet</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 w-full border-[#1a56db] text-[#1a56db] hover:bg-[#1a56db]/10"
                    onClick={() => navigate('/invoices')}
                  >
                    View Invoices
                  </Button>
                </>
              );
            })()}
          </CardContent>
        </Card>

        <Card className="bg-white border shadow-sm border-l-4 border-l-red-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-900">
              3-Way Match Exceptions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const matchIssues = invoices.filter(
                (inv) => inv.match_status === 'mismatch' || inv.match_status === 'no_po'
              );
              const mismatchCount = matchIssues.filter((inv) => inv.match_status === 'mismatch').length;
              const noPoCount = matchIssues.filter((inv) => inv.match_status === 'no_po').length;
              return (
                <>
                  <div className="text-2xl font-bold text-gray-900">{matchIssues.length}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">
                      Mismatch: {mismatchCount}
                    </span>
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">
                      No PO: {noPoCount}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 w-full border-[#1a56db] text-[#1a56db] hover:bg-[#1a56db]/10"
                    onClick={() => navigate('/invoices?filter=match_issues')}
                  >
                    Resolve
                  </Button>
                </>
              );
            })()}
          </CardContent>
        </Card>

        <GstReconSummaryCard />
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Monthly Invoice Amounts</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="amount" fill="#3B82F6" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoice Status Distribution</CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center">
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) =>
                    value > 0 ? `${name}: ${value}` : ''
                  }
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {statusData.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="xl:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cash flow â€” next 30 days</CardTitle>
            <p className="text-xs text-muted-foreground font-normal">
              By due date, unpaid / overdue vs scheduled ({baseCurrency})
            </p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={cashFlowWeeks}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value: number) => formatCurrency(value, baseCurrency)}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="unpaid" stackId="pay" fill="#f59e0b" name="Unpaid / overdue" />
                <Bar dataKey="scheduled" stackId="pay" fill="#3b82f6" name="Scheduled" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Email intake + AP aging (reports) */}
      <div className={`grid gap-6 ${hasAnyEmailInvoice ? 'lg:grid-cols-2' : ''}`}>
        {hasAnyEmailInvoice && (
          <Card className="border-l-4 border-l-blue-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Mail className="h-4 w-4 text-blue-600" />
                Email intake
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-gray-900">{emailInvoicesThisMonth}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Invoices received by email this month
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full border-[#1a56db] text-[#1a56db] hover:bg-[#1a56db]/10"
                onClick={() => navigate('/email-invoices')}
              >
                Open email inbox
              </Button>
            </CardContent>
          </Card>
        )}

        <Card className="border-l-4 border-l-emerald-600 lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">AP aging</CardTitle>
            <p className="text-xs text-muted-foreground font-normal">
              Unpaid balances by days past due ({baseCurrency})
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: 'Current', amt: apAgingWidget.current, color: 'bg-emerald-500' },
                { label: '1â€“30', amt: apAgingWidget.d1, color: 'bg-amber-500' },
                { label: '31â€“60', amt: apAgingWidget.d2, color: 'bg-orange-600' },
                { label: '60+', amt: apAgingWidget.d60, color: 'bg-red-500' },
              ].map((b) => (
                <div key={b.label} className="space-y-1">
                  <div className="h-16 flex items-end justify-center rounded bg-muted/50 overflow-hidden">
                    <div
                      className={`w-full ${b.color} rounded-t transition-all`}
                      style={{
                        height: `${Math.max(8, (b.amt / apAgingWidget.maxBar) * 100)}%`,
                        minHeight: b.amt > 0 ? 12 : 4,
                      }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground">{b.label}</p>
                </div>
              ))}
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Total outstanding: </span>
              <span className="font-semibold">
                {formatCurrency(apAgingWidget.totalOutstanding, baseCurrency)}
              </span>
            </div>
            {apAgingWidget.d1 + apAgingWidget.d2 + apAgingWidget.d60 > 0 && (
              <p className="text-sm text-red-600 font-medium">
                {(() => {
                  const t0 = new Date();
                  t0.setHours(0, 0, 0, 0);
                  const overdueCount = invoices.filter((inv) => {
                    if (inv.status === 'Paid' || inv.payment_status === 'paid') return false;
                    if (!inv.due_date) return false;
                    const d = new Date(inv.due_date);
                    d.setHours(0, 0, 0, 0);
                    return t0.getTime() > d.getTime();
                  }).length;
                  return (
                    <>
                      {overdueCount} invoices overdue â€”{' '}
                      {formatCurrency(apAgingWidget.overdueTotal, baseCurrency)} at risk
                    </>
                  );
                })()}
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-full border-[#1a56db] text-[#1a56db] hover:bg-[#1a56db]/10"
              onClick={() => navigate('/reports/aging')}
            >
              View full report
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* SECTION 3: IFRS Category Breakdown */}
      {(() => {
        const total = invoices.length;
        const byCategory = invoices.reduce((acc, inv) => {
          const key = inv.ifrs_category && inv.ifrs_category.trim() ? inv.ifrs_category : 'Not Classified';
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        const ifrsChartData = Object.entries(byCategory).map(([name, count]) => ({
          name,
          value: total > 0 ? Math.round((count / total) * 100) : 0,
          count,
        }));
        return (
          <Card className="bg-white border shadow-sm">
            <CardHeader>
              <CardTitle>IFRS Category Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {ifrsChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={ifrsChartData} layout="vertical" margin={{ left: 12, right: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" domain={[0, 100]} unit="%" />
                    <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 12 }} />
                    <Tooltip
                      formatter={(value: number, _: unknown, props: unknown) => {
                        const arr = (props as { payload?: Array<{ payload?: { name: string; count: number } }> })?.payload;
                        const p = Array.isArray(arr) ? arr[0]?.payload : null;
                        return [p ? `${value}% (${p.count} invoices)` : `${value}%`, p?.name ?? ''];
                      }}
                    />
                    <Bar dataKey="value" name="%" radius={[0, 4, 4, 0]}>
                      {ifrsChartData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={entry.name === 'Not Classified' ? '#EF4444' : '#1a56db'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-gray-500 text-center py-8">No IFRS category data yet</p>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* Vendor Analytics */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Vendors by Spend */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Top Vendors by Spend
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const vendorSpend = invoices.reduce((acc, inv) => {
                const vendorName = inv.vendor_name;
                if (!acc[vendorName]) {
                  acc[vendorName] = {
                    name: vendorName,
                    totalSpend: 0,
                    invoiceCount: 0,
                  };
                }
                acc[vendorName].totalSpend += Number(inv.total_amount);
                acc[vendorName].invoiceCount += 1;
                return acc;
              }, {} as Record<string, { name: string; totalSpend: number; invoiceCount: number }>);

              const topVendors = Object.values(vendorSpend)
                .sort((a, b) => b.totalSpend - a.totalSpend)
                .slice(0, 5)
                .map((vendor, index) => ({
                  ...vendor,
                  rank: index + 1,
                }));

              return topVendors.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={topVendors} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="name" type="category" width={120} />
                      <Tooltip
                        formatter={(value: number) => formatCurrency(Number(value), baseCurrency)}
                      />
                      <Bar dataKey="totalSpend" fill="#0A4B8F" />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="mt-4 space-y-2">
                    {topVendors.map((vendor) => (
                      <div
                        key={vendor.name}
                        className="flex items-center justify-between rounded-lg border p-2 text-sm"
                      >
                        <div>
                          <span className="font-semibold">#{vendor.rank}</span>
                          <span className="ml-2">{vendor.name}</span>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold">
                            {formatCurrency(vendor.totalSpend, baseCurrency)}
                          </div>
                          <div className="text-xs text-gray-500">
                            {vendor.invoiceCount} invoice{vendor.invoiceCount !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-500 text-center py-8">
                  No vendor data available
                </p>
              );
            })()}
          </CardContent>
        </Card>

        {/* Vendor Spend Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Vendor Spend Trend (Last 6 Months)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const vendorSpend = invoices.reduce((acc, inv) => {
                const vendorName = inv.vendor_name;
                if (!acc[vendorName]) {
                  acc[vendorName] = {
                    name: vendorName,
                    totalSpend: 0,
                    invoiceCount: 0,
                  };
                }
                acc[vendorName].totalSpend += Number(inv.total_amount);
                acc[vendorName].invoiceCount += 1;
                return acc;
              }, {} as Record<string, { name: string; totalSpend: number; invoiceCount: number }>);

              const topVendors = Object.values(vendorSpend)
                .sort((a, b) => b.totalSpend - a.totalSpend)
                .slice(0, 3)
                .map((v) => v.name);

              const vendorTrendData = Array.from({ length: 6 }, (_, i) => {
                const month = new Date();
                month.setMonth(month.getMonth() - (5 - i));
                const monthKey = format(month, 'MMM yyyy');
                
                const trend: Record<string, number | string> = { month: monthKey };
                
                topVendors.forEach((vendorName) => {
                  const monthInvoices = invoices.filter((inv) => {
                    const invDate = new Date(inv.created_at);
                    return (
                      inv.vendor_name === vendorName &&
                      invDate.getMonth() === month.getMonth() &&
                      invDate.getFullYear() === month.getFullYear()
                    );
                  });
                  trend[vendorName] = monthInvoices.reduce(
                    (sum, inv) => sum + Number(inv.total_amount),
                    0
                  );
                });
                
                return trend;
              });

              return topVendors.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={vendorTrendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" angle={-45} textAnchor="end" height={80} />
                    <YAxis />
                    <Tooltip formatter={(value: number) => formatCurrency(Number(value), baseCurrency)} />
                    <Legend />
                    {topVendors.map((vendorName, index) => (
                      <Line
                        key={vendorName}
                        type="monotone"
                        dataKey={vendorName}
                        stroke={COLORS[index % COLORS.length]}
                        strokeWidth={2}
                        name={vendorName}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-gray-500 text-center py-8">
                  No vendor trend data available
                </p>
              );
            })()}
          </CardContent>
        </Card>

        {/* Spend by GL Account */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Spend by GL Account (Top 5)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const glSpend = invoices
                .filter((inv) => inv.gl_code && inv.gl_name)
                .reduce((acc, inv) => {
                  const glKey = `${inv.gl_code} - ${inv.gl_name}`;
                  if (!acc[glKey]) {
                    acc[glKey] = {
                      code: inv.gl_code!,
                      name: inv.gl_name!,
                      totalSpend: 0,
                      invoiceCount: 0,
                    };
                  }
                  acc[glKey].totalSpend += Number(inv.total_amount);
                  acc[glKey].invoiceCount += 1;
                  return acc;
                }, {} as Record<string, { code: string; name: string; totalSpend: number; invoiceCount: number }>);

              const topGLAccounts = Object.values(glSpend)
                .sort((a, b) => b.totalSpend - a.totalSpend)
                .slice(0, 5)
                .map((gl, index) => ({
                  ...gl,
                  label: `${gl.code} - ${gl.name}`,
                  rank: index + 1,
                }));

              return topGLAccounts.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={topGLAccounts} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="code" type="category" width={80} />
                      <Tooltip
                        formatter={(value: number) => formatCurrency(Number(value), baseCurrency)}
                      />
                      <Bar dataKey="totalSpend" fill="#0A4B8F" />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="mt-4 space-y-2">
                    {topGLAccounts.map((gl) => (
                      <div
                        key={gl.code}
                        className="flex items-center justify-between rounded-lg border p-2 text-sm"
                      >
                        <div>
                          <span className="font-semibold">#{gl.rank}</span>
                          <span className="ml-2">{gl.name}</span>
                          <span className="ml-2 text-gray-500">({gl.code})</span>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold">
                            {formatCurrency(gl.totalSpend, baseCurrency)}
                          </div>
                          <div className="text-xs text-gray-500">
                            {gl.invoiceCount} invoice{gl.invoiceCount !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-500 text-center py-8">
                  No GL account data available. Assign GL codes to invoices to see spending by account.
                </p>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      {/* Recent Invoices Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.slice(0, 10).map((invoice) => (
                <TableRow
                  key={invoice.id}
                  className="cursor-pointer hover:bg-gray-50"
                  onClick={() => setSelectedInvoice(invoice)}
                >
                  <TableCell className="font-medium">
                    {invoice.invoice_number}
                  </TableCell>
                  <TableCell>{invoice.vendor_name}</TableCell>
                  <TableCell>
                    {displayDate(invoice.invoice_date, dateFormat)}
                  </TableCell>
                  <TableCell>
                    <span className="font-semibold">
                      {formatCurrency(Number(invoice.total_amount), invoice.currency || baseCurrency)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={statusColors[invoice.status]}
                    >
                      {invoice.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedInvoice(invoice);
                      }}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {invoices.length === 0 && (
            <div className="py-12 text-center text-gray-500">
              No invoices found. Upload your first invoice to get started.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invoice Detail Modal */}
      {selectedInvoice && (
        <InvoiceDetailModal
          invoice={selectedInvoice}
          open={!!selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          onUpdate={fetchData}
          onNavigateInvoice={async (id) => {
            const inv = await fetchInvoiceById(id);
            if (inv) setSelectedInvoice(inv);
          }}
        />
      )}
    </div>
  );
}

