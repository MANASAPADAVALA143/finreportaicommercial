import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Banknote, Plus, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Input } from '../../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { useToast } from '../../../hooks/use-toast';
import { formatCurrency } from '../../../utils/currency';
import {
  listPaymentRuns,
  type PaymentRun,
  type PaymentRunStatus,
} from '../../../lib/ap-invoice/paymentRunService';

const statusBadge: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800 border-gray-200',
  pending_approval: 'bg-amber-100 text-amber-800 border-amber-200',
  approved: 'bg-blue-100 text-blue-800 border-blue-200',
  executed: 'bg-green-100 text-green-800 border-green-200',
  cancelled: 'bg-red-100 text-red-800 border-red-200',
  rejected: 'bg-red-100 text-red-800 border-red-200',
};

function statusLabel(s: PaymentRunStatus): string {
  const map: Record<string, string> = {
    draft: 'Draft',
    pending_approval: 'Pending Approval',
    approved: 'Approved',
    executed: 'Executed',
    cancelled: 'Cancelled',
    rejected: 'Cancelled',
  };
  return map[String(s || '').toLowerCase()] || String(s || '');
}

export default function PaymentRunDashboard() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [runs, setRuns] = useState<PaymentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await listPaymentRuns({
        status: status === 'all' ? undefined : status,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      setRuns(res.runs || []);
    } catch (e) {
      toast({
        title: 'Could not load payment runs',
        description: e instanceof Error ? e.message : 'Request failed',
        variant: 'destructive',
      });
      setRuns([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, dateFrom, dateTo]);

  const totals = useMemo(() => {
    return {
      count: runs.length,
      gross: runs.reduce((s, r) => s + Number(r.total_gross_aed || r.total_amount_aed || 0), 0),
    };
  }, [runs]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Banknote className="h-6 w-6 text-blue-700" /> Payment Run Center
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Create and execute payment batches for approved unpaid invoices (AED)
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button onClick={() => navigate('/ap-invoices/payment-run/new')}>
            <Plus className="h-4 w-4 mr-1" /> Create New Payment Run
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-slate-500">Status</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="pending_approval">Pending Approval</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="executed">Executed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-slate-500">From</label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-slate-500">To</label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="text-sm text-slate-600 ml-auto">
            {totals.count} runs · {formatCurrency(totals.gross, 'AED')}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run ID</TableHead>
                <TableHead>Created date</TableHead>
                <TableHead>Total amount AED</TableHead>
                <TableHead>Number of invoices</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created by</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-slate-500 py-8">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!loading && runs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-slate-500 py-8">
                    No payment runs yet. Create one to get started.
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.run_number}</TableCell>
                    <TableCell>
                      {r.created_at ? format(new Date(r.created_at), 'dd MMM yyyy') : '—'}
                    </TableCell>
                    <TableCell>
                      {formatCurrency(Number(r.total_gross_aed || r.total_amount_aed || 0), 'AED')}
                    </TableCell>
                    <TableCell>{r.total_invoices ?? r.invoice_count ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusBadge[r.status] || statusBadge.draft}>
                        {statusLabel(r.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">{r.created_by || '—'}</TableCell>
                    <TableCell>
                      <Button asChild variant="ghost" size="sm">
                        <Link to={`/ap-invoices/payment-run/${r.id}`}>Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
