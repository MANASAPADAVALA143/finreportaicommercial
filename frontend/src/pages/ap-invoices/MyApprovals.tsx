import { useCallback, useEffect, useState } from 'react';
import type { Invoice, InvoiceApprovalRow } from '../../lib/ap-invoice/supabase';
import { supabase } from '../../lib/ap-invoice/supabase';
import { useToast } from '../../hooks/use-toast';
import { useWorkEmail } from '../../hooks/useWorkEmail';
import {
  fetchPendingApprovalsForEmail,
  fetchMyApprovalHistory,
  processApprovalAction,
} from '../../lib/ap-invoice/approvalService';
import { useCompany } from '../../context/CompanyContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { formatCurrency } from '../../utils/currency';
import { displayDate } from '../../utils/dateUtils';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import { format } from 'date-fns';

type TabKey = 'pending' | 'approved' | 'rejected';

export function MyApprovals() {
  const { toast } = useToast();
  const { dateFormat } = useCompanySettings();
  const { activeCompanyId } = useCompany();
  const { email, setEmail } = useWorkEmail();
  const [tab, setTab] = useState<TabKey>('pending');
  const [pending, setPending] = useState<Array<{ approval: InvoiceApprovalRow; invoice: Invoice }>>([]);
  const [approved, setApproved] = useState<Array<{ approval: InvoiceApprovalRow; invoice: Invoice }>>([]);
  const [rejected, setRejected] = useState<Array<{ approval: InvoiceApprovalRow; invoice: Invoice }>>([]);
  const [loading, setLoading] = useState(false);
  const [inlineComment, setInlineComment] = useState<Record<string, string>>({});
  const [jePosted, setJePosted] = useState<Record<string, { reference: string }>>({});
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!email.trim()) {
      setPending([]);
      setApproved([]);
      setRejected([]);
      return;
    }
    setLoading(true);
    try {
      const [p, a, r] = await Promise.all([
        fetchPendingApprovalsForEmail(email.trim()),
        fetchMyApprovalHistory(email.trim(), 'approved'),
        fetchMyApprovalHistory(email.trim(), 'rejected'),
      ]);
      setPending(p);
      setApproved(a);
      setRejected(r);

      const jeMap: Record<string, { reference: string }> = {};
      for (const row of [...a]) {
        const inv = row.invoice;
        if (inv.je_posted && inv.je_reference) {
          jeMap[inv.id] = { reference: inv.je_reference };
        }
      }
      setJePosted(jeMap);
    } catch (e) {
      console.error(e);
      toast({
        title: 'Could not load approvals',
        description: e instanceof Error ? e.message : 'Run APPROVAL-WORKFLOW-MIGRATION.sql in Supabase.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [email, toast]);

  useEffect(() => {
    void load();
  }, [load, activeCompanyId]);

  async function act(approvalId: string, invoiceId: string, action: 'approved' | 'rejected') {
    const c = inlineComment[approvalId]?.trim() || '';
    if (action === 'rejected' && !c) {
      toast({ title: 'Add a rejection reason', variant: 'destructive' });
      return;
    }
    if (!email.trim()) return;
    if (action === 'approved') {
      if (approvingId) return; // prevent double-click race
      setApprovingId(approvalId);
    }
    try {
    const res = await processApprovalAction(approvalId, email.trim(), action, c || null);
    if (!res.ok) {
      toast({ title: 'Failed', description: res.message, variant: 'destructive' });
      return;
    }

    if (action === 'approved') {
      if (res.fully_approved) {
        const gl = res.gl_post;
        if ((gl?.ok && gl?.je_posted && gl?.je_id) || (gl?.skipped && gl?.je_posted)) {
          toast({
            title: gl.skipped ? 'Approved — already in GL' : 'Approved — journal entry posted to GL',
            description: gl.je_reference ? `JE ${gl.je_reference}` : undefined,
          });
          if (gl.je_reference) {
            setJePosted((prev) => ({ ...prev, [invoiceId]: { reference: gl.je_reference! } }));
          }
        } else {
          toast({
            title: 'Approved — GL post failed',
            description:
              gl?.message ||
              gl?.error ||
              'Approval saved but no journal entry was written to uae_journal_entries. Do not treat je_reference on the invoice as proof of posting.',
            variant: 'destructive',
          });
        }
      } else {
        toast({ title: 'Approved', description: 'Forwarded to next approver or saved.' });
      }
    } else {
      toast({ title: 'Rejected' });
    }

    setInlineComment((prev) => ({ ...prev, [approvalId]: '' }));
    void load();
    } finally {
      if (action === 'approved') setApprovingId(null);
    }
  }

  function renderJePill(invoiceId: string) {
    const je = jePosted[invoiceId];
    if (!je) return null;
    return (
      <span
        className="ml-2 inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-800 border border-green-200"
        title={je.reference ? `JE ${je.reference}` : 'Posted to GL'}
      >
        JE ✓
      </span>
    );
  }

  function renderRows(rows: Array<{ approval: InvoiceApprovalRow; invoice: Invoice }>, showActions: boolean) {
    if (!email.trim()) {
      return (
        <p className="text-sm text-gray-500 py-8 text-center">Enter your work email above to see items.</p>
      );
    }
    if (rows.length === 0) {
      return <p className="text-sm text-gray-500 py-8 text-center">No rows in this tab.</p>;
    }
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Vendor</TableHead>
            <TableHead>Invoice</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Submitted by</TableHead>
            <TableHead>Submitted</TableHead>
            <TableHead>Due</TableHead>
            {showActions && <TableHead className="w-[280px]">Action</TableHead>}
            {!showActions && <TableHead>When</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ approval, invoice }) => (
            <TableRow key={approval.id}>
              <TableCell className="font-medium">{invoice.vendor_name}</TableCell>
              <TableCell className="text-sm">
                {invoice.invoice_number}
                {renderJePill(invoice.id)}
              </TableCell>
              <TableCell>{formatCurrency(Number(invoice.total_amount), invoice.currency || 'USD')}</TableCell>
              <TableCell className="text-sm text-gray-600">{invoice.approval_submitted_by || '—'}</TableCell>
              <TableCell className="text-sm">
                {invoice.submitted_for_approval_at
                  ? format(new Date(invoice.submitted_for_approval_at), 'MMM d, yyyy')
                  : '—'}
              </TableCell>
              <TableCell className="text-sm">{displayDate(invoice.due_date, dateFormat)}</TableCell>
              {showActions && (
                <TableCell>
                  <div className="flex flex-col gap-2">
                    <Textarea
                      placeholder="Comment (required to reject)"
                      className="min-h-[52px] text-xs"
                      value={inlineComment[approval.id] ?? ''}
                      onChange={(e) =>
                        setInlineComment((prev) => ({ ...prev, [approval.id]: e.target.value }))
                      }
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="bg-green-600 text-white hover:bg-green-700"
                        disabled={approvingId === approval.id}
                        onClick={() => {
                          if (approvingId) return;
                          void act(approval.id, invoice.id, 'approved');
                        }}
                      >
                        {approvingId === approval.id ? 'Approving…' : 'Approve'}
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => void act(approval.id, invoice.id, 'rejected')}>
                        Reject
                      </Button>
                    </div>
                  </div>
                </TableCell>
              )}
              {!showActions && (
                <TableCell className="text-xs text-gray-600">
                  {approval.actioned_at ? format(new Date(approval.actioned_at), 'PPp') : '—'}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My approvals</h1>
        <p className="text-sm text-gray-500">Pending steps assigned to your work email</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Work email</CardTitle>
          <CardDescription>
            Auto-filled from your login when available. Must match the approver email on the rule.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 items-end">
          <div className="space-y-2 flex-1 min-w-[220px]">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Inbox</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
            <TabsList>
              <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
              <TabsTrigger value="approved">Approved ({approved.length})</TabsTrigger>
              <TabsTrigger value="rejected">Rejected ({rejected.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="pending" className="mt-4 overflow-x-auto">
              {renderRows(pending, true)}
            </TabsContent>
            <TabsContent value="approved" className="mt-4 overflow-x-auto">
              {renderRows(approved, false)}
            </TabsContent>
            <TabsContent value="rejected" className="mt-4 overflow-x-auto">
              {renderRows(rejected, false)}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
