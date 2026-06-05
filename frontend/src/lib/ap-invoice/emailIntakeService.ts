import { supabase } from './supabase';
import { logAction } from './auditService';
import { requireCompanyId } from './companyService';
import { runAutoMatch } from './threeWayMatchService';

/**
 * Payload shape when n8n POSTs to the email intake endpoint (Edge Function URL in .env).
 * Manual uploads continue to use VITE_N8N_WEBHOOK_URL; email flow POSTs here after OCR per attachment.
 */
export interface EmailIntakePayload {
  from: string;
  subject: string;
  received_at: string;
  attachments: Array<{
    filename: string;
    extracted: {
      vendor_name?: string;
      vendor_id?: string;
      amount?: number;
      total_amount?: number;
      invoice_number?: string;
      po_number?: string;
      invoice_date?: string;
      due_date?: string;
      line_items?: unknown[];
      confidence?: number;
      currency?: string;
      ifrs_category?: string;
      ifrs_confidence?: number;
      vendor_phone?: string;
      vendor_address?: string;
    };
  }>;
}

function defaultDueDate(invoiceDate: string | undefined): string {
  const base = invoiceDate ? new Date(invoiceDate) : new Date();
  if (Number.isNaN(base.getTime())) {
    const t = new Date();
    t.setDate(t.getDate() + 30);
    return t.toISOString().split('T')[0];
  }
  const d = new Date(base);
  d.setDate(d.getDate() + 30);
  return d.toISOString().split('T')[0];
}

export async function processEmailIntake(payload: EmailIntakePayload): Promise<{
  invoices_created: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let invoices_created = 0;
  let idx = 0;

  const company_id = await requireCompanyId();

  for (const attachment of payload.attachments) {
    idx += 1;
    try {
      const ext = attachment.extracted;
      const amount =
        typeof ext.amount === 'number'
          ? ext.amount
          : typeof ext.total_amount === 'number'
            ? ext.total_amount
            : Number(ext.amount ?? ext.total_amount ?? 0);
      const invDate = ext.invoice_date || new Date().toISOString().split('T')[0];
      const due_date = ext.due_date && ext.due_date.length > 0 ? ext.due_date : defaultDueDate(invDate);
      const vendorName =
        ext.vendor_name ||
        (payload.from.includes('@') ? payload.from.split('@')[0] : payload.from) ||
        'Unknown vendor';

      const { data: invoice, error } = await supabase
        .from('invoices')
        .insert({
          company_id,
          invoice_number: ext.invoice_number || `EMAIL-${Date.now()}-${idx}`,
          invoice_date: invDate,
          due_date,
          vendor_name: vendorName,
          vendor_email: payload.from || null,
          vendor_phone: ext.vendor_phone ?? null,
          vendor_address: ext.vendor_address ?? null,
          total_amount: amount,
          subtotal_amount: amount,
          tax_type: 'None',
          tax_rate: 0,
          tax_amount: 0,
          currency: ext.currency || 'USD',
          status: 'Processing',
          file_url: `email-${attachment.filename}`,
          file_type: 'application/pdf',
          ifrs_category: ext.ifrs_category ?? '',
          ifrs_confidence:
            ext.ifrs_confidence != null
              ? Number(ext.ifrs_confidence)
              : ext.confidence != null
                ? Number(ext.confidence)
                : 0,
          ifrs_explanation: '',
          ocr_confidence: ext.confidence ?? null,
          source: 'email',
          source_email_from: payload.from,
          source_email_subject: payload.subject,
          source_email_received_at: payload.received_at,
          po_number: ext.po_number?.trim() || null,
        })
        .select()
        .single();

      if (error) throw error;

      invoices_created++;

      try {
        await runAutoMatch(invoice.id);
      } catch (matchErr) {
        console.warn('[emailIntake] auto match:', matchErr);
      }

      logAction('invoice.created', 'invoice', invoice.id, payload.from, {
        source: 'email',
        subject: payload.subject,
        confidence: ext.confidence,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${attachment.filename}: ${msg}`);
    }
  }

  const logStatus =
    errors.length === 0 ? 'processed' : invoices_created > 0 ? 'processed' : 'failed';

  await supabase.from('email_intake_log').insert({
    company_id,
    from_address: payload.from,
    subject: payload.subject,
    received_at: payload.received_at,
    attachment_count: payload.attachments.length,
    invoices_created,
    status: logStatus,
    error_message: errors.length > 0 ? errors.join('; ') : null,
    raw_payload: payload as unknown as Record<string, unknown>,
  });

  return { invoices_created, errors };
}

