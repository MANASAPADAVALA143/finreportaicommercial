import { useEffect, useState } from 'react';
import type { Invoice } from '@/lib/ap-invoice/supabase';
import { Button } from '@/components/ui/button';
import { clearDuplicateFlag, fetchInvoiceById, recheckInvoiceDuplicate } from '@/lib/ap-invoice/invoices';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/utils/currency';
import { displayDate } from '@/utils/dateUtils';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { X, AlertTriangle } from 'lucide-react';

type Props = {
  invoice: Invoice;
  performedByEmail: string;
  onRefresh: () => void;
  onNavigateInvoice?: (invoiceId: string) => void | Promise<void>;
};

export function DuplicateWarningBanner({
  invoice,
  performedByEmail,
  onRefresh,
  onNavigateInvoice,
}: Props) {
  const { toast } = useToast();
  const { dateFormat } = useCompanySettings();
  const [dismissed, setDismissed] = useState(false);
  const [original, setOriginal] = useState<Invoice | null>(null);
  const [loadingOriginal, setLoadingOriginal] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDismissed(false);
  }, [invoice.id, invoice.duplicate_flag, invoice.duplicate_of_id]);

  useEffect(() => {
    if (!invoice.duplicate_of_id) {
      setOriginal(null);
      return;
    }
    let cancelled = false;
    setLoadingOriginal(true);
    void fetchInvoiceById(invoice.duplicate_of_id)
      .then((row) => {
        if (!cancelled) setOriginal(row);
      })
      .finally(() => {
        if (!cancelled) setLoadingOriginal(false);
      });
    return () => {
      cancelled = true;
    };
  }, [invoice.duplicate_of_id]);

  if (!invoice.duplicate_flag || dismissed) {
    return null;
  }

  const origLabel = original
    ? `${original.invoice_number} â€” ${original.vendor_name}, ${formatCurrency(Number(original.total_amount), original.currency || 'INR')}, ${displayDate(original.invoice_date, dateFormat)}`
    : loadingOriginal
      ? 'Loading originalâ€¦'
      : invoice.duplicate_of_id
        ? '(Original invoice not found or was removed)'
        : 'Unknown original';

  async function handleClear() {
    setBusy(true);
    try {
      await clearDuplicateFlag(invoice.id, performedByEmail.trim() || 'Unknown');
      toast({ title: 'Marked as not a duplicate' });
      setDismissed(true);
      onRefresh();
    } catch (e) {
      toast({
        title: 'Could not clear flag',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleRecheck() {
    setBusy(true);
    try {
      await recheckInvoiceDuplicate(invoice.id);
      toast({ title: 'Duplicate check re-run' });
      onRefresh();
    } catch (e) {
      toast({
        title: 'Re-check failed',
        description: e instanceof Error ? e.message : 'Run DUPLICATE-INVOICE-DETECTION.sql in Supabase.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-6 py-3">
      <div className="flex gap-3">
        <div className="mt-0.5 shrink-0 text-amber-600">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-amber-950">Possible duplicate detected</p>
            <button
              type="button"
              className="rounded p-1 text-amber-700 hover:bg-amber-100"
              aria-label="Dismiss banner"
              onClick={() => setDismissed(true)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-sm text-amber-900">
            {invoice.duplicate_reason ? `${invoice.duplicate_reason}. ` : ''}
            This invoice may match: {origLabel}
          </p>
          <div className="flex flex-wrap gap-2">
            {invoice.duplicate_of_id && onNavigateInvoice && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-amber-300 bg-white"
                disabled={!original}
                onClick={() => void onNavigateInvoice(invoice.duplicate_of_id!)}
              >
                View original invoice
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="bg-white"
              disabled={busy}
              onClick={() => void handleClear()}
            >
              Mark as not duplicate
            </Button>
            <Button type="button" size="sm" variant="ghost" className="text-amber-900" disabled={busy} onClick={() => void handleRecheck()}>
              Re-check
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

