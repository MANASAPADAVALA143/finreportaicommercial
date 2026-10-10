import type { Invoice } from '@/lib/ap-invoice/supabase';
import { normalizedOpenPaymentStatus } from '@/lib/ap-invoice/paymentStatus';
import { hasRiskScore, invoiceSeverity } from '../metrics';
import { Pill, STATUS_LABEL, type Tone } from '../ui';
import { SEVERITY_TONE } from '../widgets';

const STATUS_TONE: Record<string, Tone> = {
  Processing: 'amber',
  Approved: 'teal',
  Paid: 'primary',
  'On Hold': 'gold',
  Queried: 'purple',
  Rejected: 'red',
};

export function StatusPill({ status }: { status: string | null | undefined }) {
  const s = status || 'Unknown';
  return <Pill tone={STATUS_TONE[s] ?? 'slate'}>{STATUS_LABEL[s] ?? s}</Pill>;
}

const APPROVAL_TONE: Record<string, Tone> = {
  pending: 'amber',
  approved: 'teal',
  rejected: 'red',
  not_required: 'slate',
};

export function approvalStatusOf(inv: Invoice): string {
  if (inv.approval_status) return inv.approval_status;
  if (inv.status === 'Processing') return 'pending';
  if (inv.status === 'Approved' || inv.status === 'Paid') return 'approved';
  if (inv.status === 'Rejected') return 'rejected';
  return 'not_required';
}

export function ApprovalPill({ invoice }: { invoice: Invoice }) {
  const s = approvalStatusOf(invoice);
  const level = invoice.approval_level && invoice.approval_level !== 'none' ? ` · ${invoice.approval_level.toUpperCase()}` : '';
  return (
    <Pill tone={APPROVAL_TONE[s] ?? 'slate'}>
      {s.replace('_', ' ')}
      {s === 'pending' ? level : ''}
    </Pill>
  );
}

export function RiskPill({ invoice }: { invoice: Invoice }) {
  const sev = invoiceSeverity(invoice);
  if (!sev) {
    return (
      <span className="text-[11px] text-slate-400">
        {hasRiskScore(invoice) ? `Score ${invoice.risk_score}` : 'Not scored'}
      </span>
    );
  }
  return (
    <Pill tone={SEVERITY_TONE[sev]}>
      <span className="capitalize">{sev}</span>
    </Pill>
  );
}

const PAYMENT_TONE: Record<string, Tone> = { paid: 'primary', scheduled: 'teal', overdue: 'red', unpaid: 'slate' };

export function PaymentPill({ invoice }: { invoice: Invoice }) {
  const s = normalizedOpenPaymentStatus(invoice);
  return (
    <Pill tone={PAYMENT_TONE[s]}>
      <span className="capitalize">{s}</span>
    </Pill>
  );
}

export function InvoiceLink({ invoice, onOpen }: { invoice: Invoice; onOpen: (inv: Invoice) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(invoice)}
      className="text-left font-medium text-slate-900 hover:text-[#246BFD] focus:outline-none focus-visible:underline"
    >
      {invoice.invoice_number}
    </button>
  );
}
