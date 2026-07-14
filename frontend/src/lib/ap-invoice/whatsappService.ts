/**
 * WhatsApp one-tap approval notifications via n8n webhook.
 * Set VITE_WHATSAPP_WEBHOOK_URL in .env to your n8n WhatsApp workflow.
 * Set VITE_APP_URL to your production URL (e.g. https://apinvoice.vercel.app).
 *
 * Vendor status updates (Approved / Paid) use the same webhook with payload.type = vendor_status.
 * Optional: VITE_VENDOR_WHATSAPP_WEBHOOK_URL for a dedicated n8n Twilio flow.
 *
 * The one-tap URL pattern:  <VITE_APP_URL>/approve?id=<approvalRowId>&action=approved|rejected&email=<approverEmail>
 * The /approve page calls processApprovalAction and shows a confirmation screen.
 */

export interface WhatsAppApprovalPayload {
  /** Approver's WhatsApp-enabled phone number in E.164 format: +91XXXXXXXXXX */
  to: string;
  approver_name: string;
  invoice_number: string;
  vendor_name: string;
  amount: string;
  currency: string;
  approve_url: string;
  reject_url: string;
}

export interface WhatsAppVendorStatusPayload {
  type: 'vendor_status';
  to: string;
  vendor_name: string;
  invoice_number: string;
  amount: string;
  currency: string;
  status: 'Approved' | 'Paid';
  due_date: string | null;
  /** Full message ready for Twilio Content / body */
  message: string;
}

function appBaseUrl(): string {
  const fromEnv = (import.meta.env.VITE_APP_URL as string | undefined)?.trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  return `${window.location.protocol}//${window.location.host}`;
}

/** Build one-tap approve / reject URLs for a given invoice_approvals row. */
export function buildApprovalUrls(approvalRowId: string, approverEmail: string) {
  const base = appBaseUrl();
  const params = new URLSearchParams({ id: approvalRowId, email: approverEmail });
  return {
    approve_url: `${base}/approve?${params}&action=approved`,
    reject_url: `${base}/approve?${params}&action=rejected`,
  };
}

function vendorWebhookUrl(): string | undefined {
  const dedicated = (import.meta.env.VITE_VENDOR_WHATSAPP_WEBHOOK_URL as string | undefined)?.trim();
  if (dedicated) return dedicated;
  // Prefer FastAPI Twilio endpoint when VITE_API_URL is set
  const api = (import.meta.env.VITE_API_URL as string | undefined)?.trim().replace(/\/$/, '');
  if (api) return `${api}/api/ap/vendor-whatsapp-notify`;
  return (import.meta.env.VITE_WHATSAPP_WEBHOOK_URL as string | undefined)?.trim();
}

/**
 * Send a WhatsApp approval request via n8n.
 * Fire-and-forget — never throws so the approval workflow continues even if WhatsApp fails.
 */
export async function sendWhatsAppApprovalRequest(payload: WhatsAppApprovalPayload): Promise<void> {
  const webhookUrl = (import.meta.env.VITE_WHATSAPP_WEBHOOK_URL as string | undefined)?.trim();
  if (!webhookUrl) {
    console.info('[whatsapp] skipped — set VITE_WHATSAPP_WEBHOOK_URL to enable', payload.invoice_number);
    return;
  }
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn('[whatsapp] webhook failed:', e);
  }
}

/**
 * Convenience wrapper: given an approval row id + invoice details, build URLs and fire the WhatsApp message.
 * approverPhone must be E.164 (e.g. +919876543210). If blank, skips silently.
 */
export async function notifyApproverViaWhatsApp(
  approvalRowId: string,
  approverEmail: string,
  approverPhone: string | null | undefined,
  invoiceNumber: string,
  vendorName: string,
  amount: number,
  currency: string
): Promise<void> {
  if (!approverPhone?.trim()) return;
  const { approve_url, reject_url } = buildApprovalUrls(approvalRowId, approverEmail);
  await sendWhatsAppApprovalRequest({
    to: approverPhone.trim(),
    approver_name: approverEmail,
    invoice_number: invoiceNumber,
    vendor_name: vendorName,
    amount: amount.toLocaleString('en-IN', { maximumFractionDigits: 2 }),
    currency,
    approve_url,
    reject_url,
  });
}

/** Build vendor status WhatsApp body (Twilio-ready). */
export function buildVendorStatusMessage(params: {
  vendorName: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  status: 'Approved' | 'Paid';
  dueDate?: string | null;
}): string {
  const amount = Number(params.amount || 0).toLocaleString('en-AE', {
    maximumFractionDigits: 2,
  });
  const currency = params.currency || 'AED';
  const due = params.dueDate?.slice(0, 10) || 'N/A';
  return (
    `Dear ${params.vendorName || 'Vendor'}, invoice ${params.invoiceNumber} for ${currency} ` +
    `${amount} has been ${params.status}. Payment due ${due}. ` +
    `Ref: Gnanova Finance OS`
  );
}

/**
 * Notify vendor on WhatsApp when invoice becomes Approved or Paid.
 * Fire-and-forget — requires vendor_phone (E.164) on the invoice.
 */
export async function notifyVendorStatusWhatsApp(
  invoice: {
    vendor_phone?: string | null;
    vendor_name?: string | null;
    invoice_number?: string | null;
    total_amount?: number | null;
    currency?: string | null;
    due_date?: string | null;
  },
  status: 'Approved' | 'Paid',
): Promise<void> {
  const to = invoice.vendor_phone?.trim();
  if (!to) {
    console.info('[whatsapp] vendor notify skipped — no vendor_phone', invoice.invoice_number);
    return;
  }
  const webhookUrl = vendorWebhookUrl();
  if (!webhookUrl) {
    console.info('[whatsapp] vendor notify skipped — set VITE_WHATSAPP_WEBHOOK_URL', invoice.invoice_number);
    return;
  }
  const vendorName = invoice.vendor_name || 'Vendor';
  const invoiceNumber = invoice.invoice_number || '—';
  const amountNum = Number(invoice.total_amount || 0);
  const currency = invoice.currency || 'AED';
  const payload: WhatsAppVendorStatusPayload = {
    type: 'vendor_status',
    to,
    vendor_name: vendorName,
    invoice_number: invoiceNumber,
    amount: amountNum.toLocaleString('en-AE', { maximumFractionDigits: 2 }),
    currency,
    status,
    due_date: invoice.due_date?.slice(0, 10) ?? null,
    message: buildVendorStatusMessage({
      vendorName,
      invoiceNumber,
      amount: amountNum,
      currency,
      status,
      dueDate: invoice.due_date,
    }),
  };
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn('[whatsapp] vendor status webhook failed:', e);
  }
}
