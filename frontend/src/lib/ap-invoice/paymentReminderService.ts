/**
 * Payment reminder service â€” finds approved invoices due within N days and fires reminders.
 * Set VITE_PAYMENT_REMINDER_WEBHOOK_URL to an n8n workflow that sends email/WhatsApp.
 *
 * Payload per overdue / upcoming invoice:
 *   { type, invoice_id, invoice_number, vendor_name, due_date, days_until_due, total_amount, currency, vendor_email, vendor_phone }
 */
import { supabase } from './supabase';

export interface PaymentReminderPayload {
  type: 'overdue' | 'due_soon';
  invoice_id: string;
  invoice_number: string;
  vendor_name: string;
  due_date: string;
  days_until_due: number;
  total_amount: number;
  currency: string;
  vendor_email: string | null;
  vendor_phone: string | null;
}

export interface PaymentReminderResult {
  sent: number;
  skipped: number;
  overdue: number;
  due_soon: number;
  messages: string[];
}

async function fireWebhook(payload: PaymentReminderPayload): Promise<void> {
  const url = (import.meta.env.VITE_PAYMENT_REMINDER_WEBHOOK_URL as string | undefined)?.trim();
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn('[payment-reminder] webhook failed:', e);
  }
}

/**
 * Scan all Approved invoices and send reminders for those due within `dueSoonDays`.
 * Skips invoices that are already paid.
 */
export async function sendPaymentReminders(dueSoonDays = 7): Promise<PaymentReminderResult> {
  const { data, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, vendor_name, vendor_email, vendor_phone, due_date, total_amount, currency, payment_status')
    .eq('status', 'Approved')
    .neq('payment_status', 'paid');

  if (error) {
    return { sent: 0, skipped: 0, overdue: 0, due_soon: 0, messages: [error.message] };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + dueSoonDays);

  let sent = 0;
  let skipped = 0;
  let overdue = 0;
  let due_soon = 0;
  const messages: string[] = [];

  for (const inv of data ?? []) {
    if (!inv.due_date) { skipped++; continue; }
    const dueDate = new Date(inv.due_date);
    dueDate.setHours(0, 0, 0, 0);
    if (dueDate > cutoff) { skipped++; continue; }

    const diffMs = dueDate.getTime() - today.getTime();
    const daysUntilDue = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const type: 'overdue' | 'due_soon' = daysUntilDue < 0 ? 'overdue' : 'due_soon';

    if (type === 'overdue') overdue++;
    else due_soon++;

    const payload: PaymentReminderPayload = {
      type,
      invoice_id: inv.id,
      invoice_number: inv.invoice_number,
      vendor_name: inv.vendor_name,
      due_date: inv.due_date,
      days_until_due: daysUntilDue,
      total_amount: Number(inv.total_amount),
      currency: inv.currency || 'INR',
      vendor_email: inv.vendor_email ?? null,
      vendor_phone: inv.vendor_phone ?? null,
    };

    await fireWebhook(payload);
    sent++;
    const label = daysUntilDue < 0
      ? `${inv.invoice_number} â€” OVERDUE by ${Math.abs(daysUntilDue)}d`
      : `${inv.invoice_number} â€” due in ${daysUntilDue}d`;
    messages.push(label);
  }

  return { sent, skipped, overdue, due_soon, messages };
}

/**
 * Return invoices that are overdue or due within N days (for dashboard display).
 * Does NOT fire any webhook.
 */
export async function getUpcomingDueInvoices(dueSoonDays = 7) {
  const { data, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, vendor_name, due_date, total_amount, currency, payment_status')
    .eq('status', 'Approved')
    .neq('payment_status', 'paid')
    .order('due_date', { ascending: true });

  if (error || !data) return [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + dueSoonDays);

  return data.filter((inv) => {
    if (!inv.due_date) return false;
    const d = new Date(inv.due_date);
    d.setHours(0, 0, 0, 0);
    return d <= cutoff;
  });
}

