import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Input } from '../../../components/ui/input';
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
  approvePaymentRun,
  bankFileUrl,
  cancelPaymentRun,
  downloadAuthenticated,
  executePaymentRun,
  getPaymentRun,
  rejectPaymentRun,
  remittanceUrl,
  submitPaymentRun,
  type PaymentRun,
} from '../../../lib/ap-invoice/paymentRunService';

const statusBadge: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800 border-gray-200',
  pending_approval: 'bg-amber-100 text-amber-800 border-amber-200',
  approved: 'bg-blue-100 text-blue-800 border-blue-200',
  executed: 'bg-green-100 text-green-800 border-green-200',
  cancelled: 'bg-red-100 text-red-800 border-red-200',
  rejected: 'bg-red-100 text-red-800 border-red-200',
};

export default function PaymentRunDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [run, setRun] = useState<PaymentRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      setRun(await getPaymentRun(id));
    } catch (e) {
      toast({
        title: 'Could not load payment run',
        description: e instanceof Error ? e.message : 'Request failed',
        variant: 'destructive',
      });
      setRun(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const act = async (fn: () => Promise<PaymentRun>, ok: string) => {
    setBusy(true);
    try {
      const updated = await fn();
      setRun(updated);
      toast({ title: ok });
    } catch (e) {
      toast({
        title: 'Action failed',
        description: e instanceof Error ? e.message : 'Request failed',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-slate-500">Loading payment run…</div>;
  }
  if (!run) {
    return (
      <div className="p-6">
        <p className="text-slate-500 mb-3">Payment run not found.</p>
        <Button asChild variant="outline">
          <Link to="/ap-invoices/payment-run">Back</Link>
        </Button>
      </div>
    );
  }

  const status = String(run.status || 'draft').toLowerCase();

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/ap-invoices/payment-run')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h1 className="text-2xl font-bold text-slate-900 mt-2">{run.run_number}</h1>
          <p className="text-sm text-slate-500">Payment run detail</p>
        </div>
        <Badge variant="outline" className={statusBadge[status] || statusBadge.draft}>
          {status.toUpperCase()}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run summary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div>
            <p className="text-slate-500">Run #</p>
            <p className="font-medium">{run.run_number}</p>
          </div>
          <div>
            <p className="text-slate-500">Created by</p>
            <p className="font-medium">{run.created_by || '—'}</p>
          </div>
          <div>
            <p className="text-slate-500">Created date</p>
            <p className="font-medium">
              {run.created_at ? format(new Date(run.created_at), 'dd MMM yyyy HH:mm') : '—'}
            </p>
          </div>
          <div>
            <p className="text-slate-500">Status</p>
            <p className="font-medium">{status.toUpperCase()}</p>
          </div>
          <div>
            <p className="text-slate-500">Payment date</p>
            <p className="font-medium">{run.payment_date || '—'}</p>
          </div>
          <div>
            <p className="text-slate-500">Bank account</p>
            <p className="font-medium">{run.bank_account || '—'}</p>
          </div>
          <div>
            <p className="text-slate-500">Approved by</p>
            <p className="font-medium">{run.approved_by || '—'}</p>
          </div>
          <div>
            <p className="text-slate-500">Total invoices</p>
            <p className="font-medium">{run.total_invoices}</p>
          </div>
          <div>
            <p className="text-slate-500">Total amount AED</p>
            <p className="font-medium">{formatCurrency(Number(run.total_gross_aed || 0), 'AED')}</p>
          </div>
          <div>
            <p className="text-slate-500">Total VAT</p>
            <p className="font-medium">{formatCurrency(Number(run.total_vat_aed || 0), 'AED')}</p>
          </div>
          <div>
            <p className="text-slate-500">Journal</p>
            <p className="font-medium text-xs break-all">{run.journal_entry_id || '—'}</p>
          </div>
          {run.notes ? (
            <div className="sm:col-span-2 lg:col-span-4">
              <p className="text-slate-500">Notes</p>
              <p className="font-medium">{run.notes}</p>
            </div>
          ) : null}
          {run.rejection_reason ? (
            <div className="sm:col-span-2 lg:col-span-4 text-red-700">
              Rejection reason: {run.rejection_reason}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoices (locked)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>VAT</TableHead>
                <TableHead>Payment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(run.invoices || []).map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                  <TableCell>{inv.vendor_name}</TableCell>
                  <TableCell>{inv.due_date || '—'}</TableCell>
                  <TableCell>{formatCurrency(Number(inv.amount || 0), 'AED')}</TableCell>
                  <TableCell>{formatCurrency(Number(inv.vat_amount || 0), 'AED')}</TableCell>
                  <TableCell>{inv.payment_status || inv.status || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 items-end">
          {status === 'draft' && (
            <>
              <Button
                disabled={busy}
                onClick={() => void act(() => submitPaymentRun(run.id), 'Submitted for approval')}
              >
                Submit for Approval
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void act(() => cancelPaymentRun(run.id), 'Payment run cancelled')}
              >
                Cancel run
              </Button>
            </>
          )}

          {status === 'pending_approval' && (
            <>
              <p className="w-full text-xs text-slate-500">
                Maker-checker: approver must be a different user than {run.created_by || 'the creator'}.
              </p>
              <Button
                disabled={busy}
                onClick={() => void act(() => approvePaymentRun(run.id), 'Payment run approved')}
              >
                Approve
              </Button>
              <div className="flex gap-2 items-end">
                <div>
                  <label className="text-xs text-slate-500">Reject reason</label>
                  <Input
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Reason"
                    className="w-56"
                  />
                </div>
                <Button
                  variant="destructive"
                  disabled={busy || !rejectReason.trim()}
                  onClick={() =>
                    void act(
                      () => rejectPaymentRun(run.id, rejectReason.trim()),
                      'Payment run rejected',
                    )
                  }
                >
                  Reject
                </Button>
              </div>
            </>
          )}

          {status === 'approved' && (
            <>
              <Button
                disabled={busy}
                onClick={() =>
                  void act(() => executePaymentRun(run.id), 'Payment run executed')
                }
              >
                Execute Payment Run
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void downloadAuthenticated(
                    bankFileUrl(run.id),
                    `${run.run_number}_bank_file.csv`,
                  ).catch((e) =>
                    toast({
                      title: 'Download failed',
                      description: e instanceof Error ? e.message : 'Error',
                      variant: 'destructive',
                    }),
                  )
                }
              >
                <Download className="h-4 w-4 mr-1" /> Download Bank File
              </Button>
            </>
          )}

          {status === 'executed' && (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void downloadAuthenticated(
                    bankFileUrl(run.id),
                    `${run.run_number}_bank_file.csv`,
                  ).catch((e) =>
                    toast({
                      title: 'Download failed',
                      description: e instanceof Error ? e.message : 'Error',
                      variant: 'destructive',
                    }),
                  )
                }
              >
                <Download className="h-4 w-4 mr-1" /> Download Bank File
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void downloadAuthenticated(
                    remittanceUrl(run.id),
                    `${run.run_number}_remittance.csv`,
                  ).catch((e) =>
                    toast({
                      title: 'Download failed',
                      description: e instanceof Error ? e.message : 'Error',
                      variant: 'destructive',
                    }),
                  )
                }
              >
                <Download className="h-4 w-4 mr-1" /> Download Remittance
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
