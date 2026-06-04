import { supabase, type Invoice } from '@/lib/supabase';
import { logAction } from '@/lib/auditService';

/** Flagged duplicates (flat rows; load original via duplicate_of_id if needed). */
export async function getFlaggedDuplicates(): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('duplicate_flag', true)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as Invoice[];
}

export async function clearDuplicateFlag(invoiceId: string, performedBy: string): Promise<void> {
  const { error } = await supabase
    .from('invoices')
    .update({
      duplicate_flag: false,
      duplicate_of_id: null,
      duplicate_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId);

  if (error) throw error;

  const { error: logError } = await supabase.from('audit_logs').insert({
    invoice_id: invoiceId,
    action: 'duplicate_cleared',
    field_changed: 'duplicate_flag',
    old_value: 'true',
    new_value: 'false',
    user_name: performedBy || 'Unknown',
  });
  if (logError) {
    console.warn('audit_logs insert skipped:', logError.message);
  }

  logAction('duplicate.cleared', 'invoice', invoiceId, performedBy || null, {});
}

/**
 * Re-runs BEFORE trigger by touching invoice_date (noop assignment).
 * Postgres still evaluates the row and runs the duplicate trigger.
 */
export async function recheckInvoiceDuplicate(invoiceId: string): Promise<Pick<Invoice, 'duplicate_flag' | 'duplicate_of_id' | 'duplicate_reason' | 'invoice_date'>> {
  const { data: row, error: fetchErr } = await supabase.from('invoices').select('invoice_date').eq('id', invoiceId).single();
  if (fetchErr || !row) throw fetchErr ?? new Error('Invoice not found');

  const { data: updated, error: upErr } = await supabase
    .from('invoices')
    .update({
      invoice_date: row.invoice_date,
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)
    .select('duplicate_flag, duplicate_of_id, duplicate_reason, invoice_date')
    .single();

  if (upErr) throw upErr;
  return updated as Pick<Invoice, 'duplicate_flag' | 'duplicate_of_id' | 'duplicate_reason' | 'invoice_date'>;
}

export async function fetchInvoiceById(id: string): Promise<Invoice | null> {
  const { data, error } = await supabase.from('invoices').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as Invoice) ?? null;
}
