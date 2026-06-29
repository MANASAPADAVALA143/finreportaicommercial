/**
 * Wire VITE_APPROVAL_NOTIFY_WEBHOOK_URL to n8n or a Supabase Edge Function that sends Resend email.
 * Payload is JSON; your receiver can branch on `type`.
 */
export type ApprovalNotifyPayload =
  | {
      type: 'approver_assigned';
      invoice_id: string;
      invoice_number: string;
      approver_email: string;
      step_index: number;
      total_steps: number;
    }
  | {
      type: 'submitter_notified';
      invoice_id: string;
      invoice_number: string;
      submitter_email: string;
      outcome: 'approved' | 'rejected';
      comment?: string;
    };

export async function notifyApprovalEvent(payload: ApprovalNotifyPayload): Promise<void> {
  const url = import.meta.env.VITE_APPROVAL_NOTIFY_WEBHOOK_URL as string | undefined;
  if (!url) {
    console.info('[approval notify] skipped (set VITE_APPROVAL_NOTIFY_WEBHOOK_URL for email)', payload.type);
    return;
  }
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn('[approval notify] webhook failed', e);
  }
}
