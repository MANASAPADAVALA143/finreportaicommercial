/**
 * WhatsApp one-tap approval notifications via n8n webhook.
 * Set VITE_WHATSAPP_WEBHOOK_URL in .env to your n8n WhatsApp workflow.
 * Set VITE_APP_URL to your production URL (e.g. https://apinvoice.vercel.app).
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

/**
 * Send a WhatsApp approval request via n8n.
 * Fire-and-forget â€” never throws so the approval workflow continues even if WhatsApp fails.
 */
export async function sendWhatsAppApprovalRequest(payload: WhatsAppApprovalPayload): Promise<void> {
  const webhookUrl = (import.meta.env.VITE_WHATSAPP_WEBHOOK_URL as string | undefined)?.trim();
  if (!webhookUrl) {
    console.info('[whatsapp] skipped â€” set VITE_WHATSAPP_WEBHOOK_URL to enable', payload.invoice_number);
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

