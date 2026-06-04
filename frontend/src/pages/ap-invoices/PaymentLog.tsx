import { useEffect, useState } from 'react';
import { supabase } from '../../lib/ap-invoice/supabase';
import { getMyCompanyMemberRole, canViewPaymentLog } from '../../lib/ap-invoice/companyService';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { Download, Loader2 } from 'lucide-react';
import { formatCurrency } from '../../utils/currency';
import { displayDate } from '../../utils/dateUtils';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import { useToast } from '../../hooks/use-toast';

type LogRow = {
  id: string;
  created_at: string;
  invoice_id: string;
  invoice_number: string | null;
  vendor_name: string | null;
  amount: number | null;
  payment_method: string | null;
  utr_number: string | null;
  payment_date: string | null;
  payment_bank: string | null;
  paid_by: string | null;
};

type InvoicePayMeta = {
  bank_reconciled: boolean | null;
  bank_ref: string | null;
  currency: string | null;
};

export function PaymentLog() {
  const { dateFormat } = useCompanySettings();
  const { toast } = useToast();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [invoiceMeta, setInvoiceMeta] = useState<Record<string, InvoicePayMeta>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const role = await getMyCompanyMemberRole();
      setAllowed(canViewPaymentLog(role));
    })();
  }, []);

  useEffect(() => {
    if (allowed !== true) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      // Flat select avoids PostgREST embed/relationship errors; RLS still scopes by company_id.
      const { data, error } = await supabase
        .from('payment_log')
        .select(
          'id, created_at, invoice_id, invoice_number, vendor_name, amount, payment_method, utr_number, payment_date, payment_bank, paid_by'
        )
        .order('created_at', { ascending: false });
      if (!cancelled) {
        if (error) {
          console.warn(error.message);
          setRows([]);
          setInvoiceMeta({});
          setLoadError(
            `${error.message}${error.hint ? ` â€” ${error.hint}` : ''} If the payment_log table is missing, run migration 20260412120000_payment_utr_payment_log.sql in Supabase.`
          );
          toast({
            title: 'Could not load payment log',
            description: error.message,
            variant: 'destructive',
          });
        } else {
          const list = (data as LogRow[]) ?? [];
          setRows(list);
          const ids = [...new Set(list.map((r) => r.invoice_id).filter(Boolean))];
          if (ids.length > 0) {
            const { data: invs, error: invErr } = await supabase
              .from('invoices')
              .select('id, bank_reconciled, bank_ref, currency')
              .in('id', ids);
            if (!cancelled && !invErr && invs?.length) {
              const map: Record<string, InvoicePayMeta> = {};
              for (const row of invs as Array<{
                id: string;
                bank_reconciled: boolean | null;
                bank_ref: string | null;
                currency: string | null;
              }>) {
                map[row.id] = {
                  bank_reconciled: row.bank_reconciled,
                  bank_ref: row.bank_ref,
                  currency: row.currency,
                };
              }
              setInvoiceMeta(map);
            } else if (!cancelled) {
              setInvoiceMeta({});
            }
          } else {
            setInvoiceMeta({});
          }
        }
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  function exportCsv() {
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = [
      [
        'date',
        'invoice_number',
        'vendor',
        'amount',
        'method',
        'utr_ref',
        'payment_date',
        'bank',
        'paid_by',
        'reconciled',
      ].join(','),
    ];
    for (const r of rows) {
      const inv = invoiceMeta[r.invoice_id];
      const rec = inv?.bank_reconciled === true;
      lines.push(
        [
          esc(r.created_at?.slice(0, 10) ?? ''),
          esc(r.invoice_number ?? ''),
          esc(r.vendor_name ?? ''),
          r.amount != null ? String(r.amount) : '',
          esc(r.payment_method ?? ''),
          esc(r.utr_number ?? ''),
          esc(r.payment_date ?? ''),
          esc(r.payment_bank ?? ''),
          esc(r.paid_by ?? ''),
          rec ? 'yes' : 'no',
        ].join(',')
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payment-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Export started', description: `${rows.length} row(s).` });
  }

  if (allowed === false) {
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-amber-200 bg-amber-50 px-6 py-8 text-center text-sm text-amber-950">
        <p className="font-medium">Payment Log is restricted</p>
        <p className="mt-2 text-amber-900/90">Ask an admin to assign you the Finance Manager role (or above) to view payment history.</p>
      </div>
    );
  }

  if (allowed === null) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-500">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Payment log</h1>
          <p className="mt-1 text-sm text-gray-500">
            Payments recorded when invoices are marked paid (UTR, method, bank). Export for your CA or auditor.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-lg">Recorded payments</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadError ? (
            <div className="px-6 py-8 text-sm text-red-700 border-b border-red-100 bg-red-50/80">
              {loadError}
            </div>
          ) : null}
          {loading ? (
            <div className="flex justify-center py-16 text-gray-500">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-gray-500 space-y-2">
              <p>No payments yet. Mark an invoice as paid from the invoice detail screen (Confirm payment).</p>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Rows are written to the <code className="text-xs bg-muted px-1 rounded">payment_log</code> table only
                after a successful save. If marking paid shows an error, apply the payment_log migration and check the
                toast message.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>UTR / Ref</TableHead>
                    <TableHead>Paid by</TableHead>
                    <TableHead>Reconciled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const inv = invoiceMeta[r.invoice_id];
                    const cur = (inv?.currency ?? 'INR').toString().toUpperCase().slice(0, 3);
                    const rec = inv?.bank_reconciled === true;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-xs font-mono">
                          {displayDate(String(r.payment_date ?? r.created_at ?? '').slice(0, 10), dateFormat)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{r.invoice_number ?? 'â€”'}</TableCell>
                        <TableCell className="max-w-[160px] truncate">{r.vendor_name ?? 'â€”'}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {r.amount != null ? formatCurrency(Number(r.amount), cur) : 'â€”'}
                        </TableCell>
                        <TableCell>{r.payment_method ?? 'â€”'}</TableCell>
                        <TableCell className="max-w-[200px] truncate font-mono text-xs" title={r.utr_number ?? ''}>
                          {r.utr_number?.trim() ? r.utr_number : 'â€”'}
                        </TableCell>
                        <TableCell className="max-w-[140px] truncate text-xs">{r.paid_by ?? 'â€”'}</TableCell>
                        <TableCell>
                          {rec ? (
                            <Badge className="bg-emerald-100 text-emerald-900 text-[10px]">Yes</Badge>
                          ) : (
                            <Badge variant="outline" className="text-amber-800 border-amber-200 text-[10px]">
                              Pending
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

