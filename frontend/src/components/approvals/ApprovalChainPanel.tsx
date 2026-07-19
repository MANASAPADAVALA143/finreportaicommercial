import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Invoice, InvoiceApprovalRow } from '@/lib/ap-invoice/supabase';
import { useToast } from '@/hooks/use-toast';
import { useWorkEmail } from '@/hooks/useWorkEmail';
import {
  fetchApprovalRules,
  fetchInvoiceApprovalRows,
  submitInvoiceForApproval,
  processApprovalAction,
  emailsMatch,
  pickApprovalRule,
} from '@/lib/ap-invoice/approvalService';
import { ApprovalStatusBadge } from '@/components/approvals/ApprovalStatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, Circle, Clock, XCircle, Send } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '@/utils/currency';
import { displayDate } from '@/utils/dateUtils';
import { useCompanySettings } from '@/hooks/useCompanySettings';

type Props = {
  invoice: Invoice;
  onRefresh: () => void;
};

export function ApprovalChainPanel({ invoice, onRefresh }: Props) {
  const { toast } = useToast();
  const { dateFormat } = useCompanySettings();
  const { email: workEmail, setEmail: setWorkEmail } = useWorkEmail();
  const [rows, setRows] = useState<InvoiceApprovalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [comment, setComment] = useState('');
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [hasMatchingRule, setHasMatchingRule] = useState(false);
  const [rulesError, setRulesError] = useState('');

  const chainStatus = invoice.approval_status ?? 'not_required';

  const loadRules = useCallback(async () => {
    setRulesLoaded(false);
    setRulesError('');
    try {
      const rules = await fetchApprovalRules();
      const match = pickApprovalRule(rules, Number(invoice.total_amount), invoice.department);
      setHasMatchingRule(!!match);
      if (rules.length === 0) {
        setRulesError('No approval rules configured. Add one in Settings → Approval rules.');
      } else if (!match) {
        setRulesError(
          `No rule matches ${formatCurrency(Number(invoice.total_amount), invoice.currency || 'AED')}${
            invoice.department ? ` / ${invoice.department}` : ''
          }. Adjust rules in Settings.`
        );
      }
    } catch (e) {
      console.error(e);
      setHasMatchingRule(false);
      setRulesError(e instanceof Error ? e.message : 'Could not load approval rules.');
    } finally {
      setRulesLoaded(true);
    }
  }, [invoice.total_amount, invoice.currency, invoice.department]);

  const loadRows = useCallback(async () => {
    try {
      const r = await fetchInvoiceApprovalRows(invoice.id);
      setRows(r);
    } catch (e) {
      console.error(e);
      setRows([]);
    }
  }, [invoice.id]);

  useEffect(() => {
    void loadRows();
  }, [loadRows, invoice.approval_status, invoice.updated_at]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const pendingRow = rows.find((r) => r.status === 'pending');
  const isCurrentApprover = pendingRow && workEmail.trim() && emailsMatch(pendingRow.approver_email, workEmail);

  const readyForSubmit =
    invoice.status === 'Processing' &&
    chainStatus === 'not_required' &&
    hasMatchingRule &&
    workEmail.trim().length > 0;

  const submitBlockedReason = useMemo(() => {
    if (invoice.status !== 'Processing') return 'Invoice must be in Processing status.';
    if (chainStatus !== 'not_required') return 'Already in an approval workflow.';
    if (!workEmail.trim()) return 'Enter your work email below.';
    if (!rulesLoaded) return 'Checking approval rules…';
    if (!hasMatchingRule) return rulesError || 'No matching approval rule.';
    return '';
  }, [invoice.status, chainStatus, workEmail, rulesLoaded, hasMatchingRule, rulesError]);

  async function handleSubmitChain() {
    if (!workEmail.trim()) {
      toast({ title: 'Work email required', description: 'Enter your email to submit for approval.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const res = await submitInvoiceForApproval(invoice, workEmail.trim());
      if (!res.ok) {
        toast({ title: 'Cannot submit', description: res.message, variant: 'destructive' });
        return;
      }
      toast({ title: 'Submitted', description: 'Approvers have been notified (if webhook configured).' });
      await loadRows();
      onRefresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(action: 'approved' | 'rejected') {
    if (!pendingRow) return;
    if (!workEmail.trim()) {
      toast({ title: 'Work email required', variant: 'destructive' });
      return;
    }
    if (action === 'rejected' && !comment.trim()) {
      toast({ title: 'Comment required', description: 'Add a short reason for rejection.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const res = await processApprovalAction(pendingRow.id, workEmail.trim(), action, comment || null);
      if (!res.ok) {
        toast({ title: 'Action failed', description: res.message, variant: 'destructive' });
        return;
      }
      if (action === 'approved' && res.fully_approved) {
        const gl = res.gl_post;
        if ((gl?.ok && gl?.je_posted && gl?.je_id) || (gl?.skipped && gl?.je_posted)) {
          toast({
            title: gl.skipped ? 'Approved — already in GL' : 'Approved — posted to GL',
            description: gl.je_reference ? `JE ${gl.je_reference}` : 'Recorded.',
          });
        } else {
          toast({
            title: 'Approved — GL post failed',
            description:
              gl?.message ||
              gl?.error ||
              'No journal row was written. Invoice may show a stale je_reference — do not trust it.',
            variant: 'destructive',
          });
        }
      } else {
        toast({ title: action === 'approved' ? 'Approved' : 'Rejected', description: 'Recorded.' });
      }
      setComment('');
      await loadRows();
      onRefresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Approval chain</h3>
          <p className="text-xs text-gray-500">Multi-step rules from Settings → Approval rules</p>
        </div>
        <ApprovalStatusBadge status={chainStatus} />
      </div>

      {invoice.submitted_for_approval_at && (
        <p className="text-xs text-gray-600">
          Submitted {format(new Date(invoice.submitted_for_approval_at), 'PPp')}
          {invoice.approval_submitted_by ? ` · by ${invoice.approval_submitted_by}` : ''}
        </p>
      )}

      <div className="space-y-3">
        {rows.length === 0 && chainStatus === 'not_required' && (
          <p className="text-sm text-gray-500">No approval steps yet. Submit to start the chain.</p>
        )}
        {rows.map((r) => (
          <div
            key={r.id}
            className="flex gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm"
          >
            <div className="mt-0.5">
              {r.status === 'approved' && <CheckCircle2 className="h-5 w-5 text-green-600" />}
              {r.status === 'rejected' && <XCircle className="h-5 w-5 text-red-600" />}
              {r.status === 'pending' && <Clock className="h-5 w-5 text-amber-600" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-gray-900">
                Step {r.step_index + 1} · {r.approver_email}
              </div>
              <div className="text-xs text-gray-500 capitalize">{r.status}</div>
              {r.actioned_at && (
                <div className="text-xs text-gray-500">{format(new Date(r.actioned_at), 'PPp')}</div>
              )}
              {r.comment && <p className="mt-1 text-xs text-gray-700">{r.comment}</p>}
            </div>
          </div>
        ))}
        {rows.length > 0 && chainStatus === 'pending' && !pendingRow && (
          <p className="text-xs text-amber-800">Waiting for next approver row to be created… refresh if stuck.</p>
        )}
      </div>

      <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-2">
        <Label className="text-xs">Your work email (submitter / approver)</Label>
        <Input
          type="email"
          placeholder="you@company.com"
          value={workEmail}
          onChange={(e) => setWorkEmail(e.target.value)}
          className="bg-white"
        />
        <p className="text-[11px] text-gray-500">Stored in this browser. Used to match pending steps and open My Approvals.</p>
      </div>

      {chainStatus === 'not_required' && (
        <div className="space-y-2">
          {rulesError && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              {rulesError}{' '}
              <Link to="/ap-invoices/settings" className="font-medium text-blue-700 underline">
                Open Settings
              </Link>
            </div>
          )}
          {!readyForSubmit && submitBlockedReason && !rulesError && (
            <p className="text-xs text-gray-600">{submitBlockedReason}</p>
          )}
          <Button
            type="button"
            className="w-full bg-[#0A4B8F] hover:bg-[#083d75] text-white"
            disabled={loading || !readyForSubmit}
            onClick={() => void handleSubmitChain()}
          >
            <Send className="mr-2 h-4 w-4" />
            Submit for approval
          </Button>
        </div>
      )}

      {chainStatus === 'pending' && isCurrentApprover && pendingRow && (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-4">
          <p className="text-sm font-medium text-amber-950">Your action required</p>
          <Textarea
            placeholder="Optional comment (required if rejecting)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            className="bg-white"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              className="flex-1 bg-green-600 hover:bg-green-700"
              disabled={loading}
              onClick={() => void handleAction('approved')}
            >
              Approve
            </Button>
            <Button type="button" variant="destructive" className="flex-1" disabled={loading} onClick={() => void handleAction('rejected')}>
              Reject
            </Button>
          </div>
        </div>
      )}

      {chainStatus === 'pending' && pendingRow && workEmail.trim() && !isCurrentApprover && (
        <p className="text-xs text-gray-600">
          Pending step is assigned to <strong>{pendingRow.approver_email}</strong>. Switch work email or use My Approvals when it is your turn.
        </p>
      )}

      <div className="flex items-center gap-2 text-xs text-gray-500 border-t pt-3">
        <Circle className="h-3 w-3" />
        <span>
          {invoice.vendor_name} · {formatCurrency(Number(invoice.total_amount), invoice.currency || 'USD')} · due{' '}
          {displayDate(invoice.due_date, dateFormat)}
        </span>
      </div>
    </div>
  );
}

