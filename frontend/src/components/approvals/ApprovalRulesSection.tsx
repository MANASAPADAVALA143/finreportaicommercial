import { useCallback, useEffect, useState } from 'react';
import type { ApprovalRule } from '@/lib/ap-invoice/supabase';
import { fetchApprovalRules, saveApprovalRule, deleteApprovalRule } from '@/lib/ap-invoice/approvalService';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Plus, Pencil, Trash2 } from 'lucide-react';

const emptyForm = {
  id: '' as string | undefined,
  min_amount: '0',
  max_amount: '',
  required_approvers: '1',
  approver_emails: '',
  approver_phones: '',
  department: '',
};

export function ApprovalRulesSection() {
  const { toast } = useToast();
  const [rules, setRules] = useState<ApprovalRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchApprovalRules();
      setRules(r);
    } catch (e) {
      console.error(e);
      toast({
        title: 'Could not load approval rules',
        description: e instanceof Error ? e.message : 'Run APPROVAL-WORKFLOW-MIGRATION.sql',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  function openNew() {
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(r: ApprovalRule) {
    setForm({
      id: r.id,
      min_amount: String(r.min_amount),
      max_amount: r.max_amount != null ? String(r.max_amount) : '',
      required_approvers: String(r.required_approvers),
      approver_emails: (r.approver_emails || []).join(', '),
      approver_phones: (r.approver_phones || []).join(', '),
      department: r.department || '',
    });
    setOpen(true);
  }

  async function handleSave() {
    const emails = form.approver_emails
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const phones = form.approver_phones
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const req = Math.max(1, parseInt(form.required_approvers, 10) || 1);
    if (emails.length === 0) {
      toast({ title: 'Add at least one approver email', variant: 'destructive' });
      return;
    }
    if (req > emails.length) {
      toast({ title: 'Required approvers cannot exceed emails listed', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await saveApprovalRule({
        id: form.id,
        min_amount: parseFloat(form.min_amount) || 0,
        max_amount: form.max_amount.trim() === '' ? null : parseFloat(form.max_amount),
        required_approvers: req,
        approver_emails: emails,
        approver_phones: phones.length ? phones : null,
        department: form.department.trim() || null,
      });
      toast({ title: 'Saved' });
      setOpen(false);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      toast({
        title: 'Save failed',
        description: msg.includes('approver_phones')
          ? 'approver_phones column missing on Supabase — retrying without phones failed. Check RLS / company_id on approval_rules.'
          : msg,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this rule?')) return;
    try {
      await deleteApprovalRule(id);
      toast({ title: 'Deleted' });
      await load();
    } catch (e) {
      toast({
        title: 'Delete failed',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg">Approval rules</CardTitle>
            <CardDescription>
              Amount bands and approver emails for multi-step chains. First matching rule (highest min amount) wins.
            </CardDescription>
          </div>
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1" />
            Add rule
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-gray-500">Loadingâ€¦</p>
          ) : rules.length === 0 ? (
            <p className="text-sm text-gray-500">No rules yet. Add one to enable â€œSubmit for approvalâ€.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Min</TableHead>
                  <TableHead>Max</TableHead>
                  <TableHead>Steps</TableHead>
                  <TableHead>Approvers</TableHead>
                  <TableHead>Dept</TableHead>
                  <TableHead className="w-[100px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{Number(r.min_amount).toLocaleString()}</TableCell>
                    <TableCell>{r.max_amount != null ? Number(r.max_amount).toLocaleString() : 'âˆž'}</TableCell>
                    <TableCell>{r.required_approvers}</TableCell>
                    <TableCell className="max-w-[240px] truncate text-xs" title={r.approver_emails.join(', ')}>
                      {r.approver_emails.join(', ')}
                    </TableCell>
                    <TableCell>{r.department || 'â€”'}</TableCell>
                    <TableCell className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => void handleDelete(r.id)}>
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit rule' : 'New rule'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Min amount</Label>
                <Input
                  type="number"
                  value={form.min_amount}
                  onChange={(e) => setForm((f) => ({ ...f, min_amount: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Max amount (empty = no max)</Label>
                <Input
                  type="number"
                  value={form.max_amount}
                  onChange={(e) => setForm((f) => ({ ...f, max_amount: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Required approvers</Label>
              <Input
                type="number"
                min={1}
                value={form.required_approvers}
                onChange={(e) => setForm((f) => ({ ...f, required_approvers: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Approver emails (comma-separated, in order)</Label>
              <Input
                value={form.approver_emails}
                onChange={(e) => setForm((f) => ({ ...f, approver_emails: e.target.value }))}
                placeholder="manager@co.com, cfo@co.com"
              />
            </div>
            <div className="space-y-2">
              <Label>Approver WhatsApp phones (E.164, match email order)</Label>
              <Input
                value={form.approver_phones}
                onChange={(e) => setForm((f) => ({ ...f, approver_phones: e.target.value }))}
                placeholder="+971501234567, +971509876543"
              />
              <p className="text-xs text-gray-500">Include country code. Leave blank to skip WhatsApp notification.</p>
            </div>
            <div className="space-y-2">
              <Label>Department filter (optional)</Label>
              <Input
                value={form.department}
                onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                placeholder="Leave empty for all departments"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

