/** Current email invoice processing consent wording version — bump when terms change. */
export const EMAIL_INVOICE_CONSENT_VERSION = '2026-07-09-v1';

export const EMAIL_INVOICE_CONSENT_TYPE = 'email_invoice_processing';

export const PRIVACY_POLICY_URL =
  (import.meta.env.VITE_PRIVACY_POLICY_URL as string | undefined)?.trim() ||
  'https://finreportai.com/privacy';

export const DPA_URL =
  (import.meta.env.VITE_DPA_URL as string | undefined)?.trim() ||
  'https://finreportai.com/dpa';

export const EMAIL_INTAKE_CONSENT_SUMMARY = [
  'Gnanova (FinReportAI) will receive invoice emails and attachments you forward to your assigned intake address.',
  'We use automated extraction (including AI/OCR) to read vendor names, amounts, dates, and line items from those attachments.',
  'Extracted data and attachment metadata are stored in your company workspace for accounts payable processing.',
  'You can withdraw consent and request deletion of email intake data at any time from this page or by contacting support.',
];
