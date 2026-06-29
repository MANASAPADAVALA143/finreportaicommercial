import { supabase, type Invoice } from '@/lib/ap-invoice/supabase';
import { logAction } from '@/lib/ap-invoice/auditService';

/** UAE advance-payment columns — may be absent until migration 003 is applied. */
export const ADVANCE_PAYMENT_DB_COLUMNS = [
  'is_advance_payment',
  'contract_value',
  'delivery_date',
  'advance_vat_amount',
  'remaining_vat_amount',
] as const;

type PostgrestError = { message?: string; code?: string; details?: string; hint?: string };

function stripMissingColumn(
  payload: Record<string, unknown>,
  error: PostgrestError,
): Record<string, unknown> | null {
  const match = error.message?.match(/Could not find the '([^']+)' column/);
  if (error.code === 'PGRST204' && match?.[1] && match[1] in payload) {
    const { [match[1]]: _removed, ...rest } = payload;
    return rest;
  }
  return null;
}

export function logSupabaseInvoiceError(
  label: string,
  error: PostgrestError,
  payload?: Record<string, unknown>,
): void {
  console.error(`[invoices] ${label}`, {
    message: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint,
    payloadKeys: payload ? Object.keys(payload) : undefined,
  });
}

/** Insert or update by invoice_number; strips unknown columns when schema lags behind app. */
export async function upsertInvoiceRow(
  payload: Record<string, unknown>,
): Promise<{ data: Invoice | null; error: PostgrestError | null }> {
  let current = { ...payload };
  const maxAttempts = Object.keys(current).length + 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data, error } = await supabase
      .from('invoices')
      .upsert(current, { onConflict: 'invoice_number' })
      .select()
      .single();

    if (!error) {
      return { data: data as Invoice, error: null };
    }

    const stripped = stripMissingColumn(current, error);
    if (stripped) {
      current = stripped;
      continue;
    }

    return { data: null, error };
  }

  return {
    data: null,
    error: { message: 'Exceeded retry limit stripping unknown invoice columns' },
  };
}

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
