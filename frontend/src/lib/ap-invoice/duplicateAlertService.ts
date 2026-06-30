/**
 * Duplicate alert before payment.
 * Checks if an invoice is flagged as a duplicate OR if there are potential
 * duplicates (same vendor + similar amount) in the recent window.
 */
import { supabase } from '@/lib/ap-invoice/supabase';
import type { Invoice } from '@/lib/ap-invoice/supabase';

export interface DuplicateAlert {
  /** Invoice is already DB-flagged as duplicate */
  flagged: boolean;
  /** Potential matches found by on-demand query */
  potentialMatches: Array<{
    id: string;
    invoice_number: string;
    vendor_name: string;
    total_amount: number;
    currency: string;
    invoice_date: string;
    status: string;
  }>;
}

/**
 * Before allowing payment, check:
 * 1. Is the invoice already DB-flagged as a duplicate?
 * 2. Are there other invoices with the same vendor_name and amount within `withinDays`?
 *
 * Returns DuplicateAlert. If flagged=false and potentialMatches=[], safe to pay.
 */
export async function checkDuplicateBeforePayment(
  invoice: Invoice,
  withinDays = 90
): Promise<DuplicateAlert> {
  const flagged = invoice.duplicate_flag === true;

  // Query for potential duplicates: same vendor_name, same amount, within date window, not this invoice
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - withinDays);

  const { data } = await supabase
    .from('invoices')
    .select('id, invoice_number, vendor_name, total_amount, currency, invoice_date, status')
    .eq('vendor_name', invoice.vendor_name)
    .eq('total_amount', invoice.total_amount)
    .neq('id', invoice.id)
    .gte('invoice_date', cutoff.toISOString().slice(0, 10))
    .order('invoice_date', { ascending: false })
    .limit(5);

  const potentialMatches = (data ?? []) as DuplicateAlert['potentialMatches'];

  return { flagged, potentialMatches };
}
