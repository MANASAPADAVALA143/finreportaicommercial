import { supabase } from './supabase';
import { ADVANCE_PAYMENT_DB_COLUMNS } from './invoices';

const API = import.meta.env.VITE_API_URL || '';

export type AdvanceVatResult = {
  vat_on_advance: number;
  remaining_amount: number;
  vat_at_delivery: number;
  total_vat: number;
  reporting_period: string;
  tax_invoice_required_by: string;
};

export async function calculateAdvanceVat(params: {
  invoice_amount: number;
  contract_value: number;
  invoice_date: string;
  delivery_date: string;
  vat_rate?: number;
}): Promise<AdvanceVatResult> {
  const res = await fetch(`${API}/api/gulftax/invoice/calculate-advance-vat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vat_rate: 5, ...params }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === 'string' ? err.detail : 'Advance VAT calculation failed');
  }
  return res.json();
}

export type PintAeRule = {
  id: string;
  label: string;
  passed: boolean;
  fix: string;
};

export type PintAeValidateResult = {
  compliant: boolean;
  rules_passed: number;
  rules_total: number;
  rules: PintAeRule[];
  issues_found: number;
};

export async function validatePintAeInvoice(invoice: {
  invoice_number: string;
  invoice_date: string;
  vendor_name: string;
  vendor_trn?: string | null;
  total_amount: number;
  subtotal_amount?: number | null;
  vat_amount?: number | null;
  vat_rate?: number | null;
  currency?: string | null;
  vat_treatment?: string | null;
}): Promise<PintAeValidateResult> {
  const res = await fetch(`${API}/api/gulftax/einvoicing/validate-pint-ae`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      invoice_number: invoice.invoice_number,
      invoice_date: invoice.invoice_date,
      vendor_name: invoice.vendor_name,
      vendor_trn: invoice.vendor_trn ?? '',
      total_amount: invoice.total_amount,
      subtotal_amount: invoice.subtotal_amount,
      vat_amount: invoice.vat_amount,
      vat_rate: invoice.vat_rate ?? 5,
      currency: invoice.currency ?? 'AED',
      vat_treatment: invoice.vat_treatment ?? 'standard',
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === 'string' ? err.detail : 'PINT AE validation failed');
  }
  return res.json();
}

export async function updateInvoiceUaeVatFields(
  invoiceId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const payload = { ...fields, updated_at: new Date().toISOString() };
  let current = { ...payload };

  for (let i = 0; i <= ADVANCE_PAYMENT_DB_COLUMNS.length; i++) {
    const { error } = await supabase.from('invoices').update(current).eq('id', invoiceId);
    if (!error) return;
    const match = error.message?.match(/Could not find the '([^']+)' column/);
    if (error.code === 'PGRST204' && match?.[1] && match[1] in current) {
      const { [match[1]]: _removed, ...rest } = current;
      current = rest;
      continue;
    }
    throw error;
  }
}

export function formatAed(amount: number): string {
  return `AED ${Number(amount || 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatUaeDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.slice(0, 10));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
