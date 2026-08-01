import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDays, format } from 'date-fns';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { Checkbox } from '../../../components/ui/checkbox';
import { useToast } from '../../../hooks/use-toast';
import { formatCurrency } from '../../../utils/currency';
import {
  createPaymentRun,
  listEligibleInvoices,
  submitPaymentRun,
  type EligibleInvoice,
} from '../../../lib/ap-invoice/paymentRunService';

const STEPS = ['Select invoices', 'Review run', 'Approve & execute'] as const;

export default function PaymentRunNew() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const today = format(new Date(), 'yyyy-MM-dd');
  const week = format(addDays(new Date(), 7), 'yyyy-MM-dd');

  const [step, setStep] = useState(0);
  const [dueFrom, setDueFrom] = useState(today);
  const [dueTo, setDueTo] = useState(week);
  const [vendor, setVendor] = useState('');
  const [property, setProperty] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [category, setCategory] = useState('all');
  const [categories, setCategories] = useState<string[]>([]);
  const [invoices, setInvoices] = useState<EligibleInvoice[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [paymentDate, setPaymentDate] = useState(today);
  const [bankAccount, setBankAccount] = useState('Main Operating Account');
  const [notes, setNotes] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await listEligibleInvoices({
        due_from: dueFrom || undefined,
        due_to: dueTo || undefined,
        vendor: vendor || undefined,
        property_id: property || undefined,
        amount_min: amountMin ? Number(amountMin) : undefined,
        amount_max: amountMax ? Number(amountMax) : undefined,
        category: category === 'all' ? undefined : category,
      });
      setInvoices(res.invoices || []);
      setCategories(res.categories || []);
      setSelected(new Set());
    } catch (e) {
      toast({
        title: 'Could not load eligible invoices',
        description: e instanceof Error ? e.message : 'Request failed',
        variant: 'destructive',
      });
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedRows = useMemo(
    () => invoices.filter((i) => selected.has(i.id)),
    [invoices, selected],
  );

  const summary = useMemo(() => {
    const total = selectedRows.reduce((s, i) => s + Number(i.amount || 0), 0);
    const vat = selectedRows.reduce((s, i) => s + Number(i.vat_amount || 0), 0);
    return { count: selectedRows.length, total, vat };
  }, [selectedRows]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(invoices.map((i) => i.id)));
  const deselectAll = () => setSelected(new Set());

  const goReview = () => {
    if (!selected.size) {
      toast({ title: 'Select at least one invoice', variant: 'destructive' });
      return;
    }
    setStep(1);
  };

  const create = async (andSubmit: boolean) => {
    if (!selected.size) {
      toast({ title: 'Select at least one invoice', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      const run = await createPaymentRun(Array.from(selected), {
        payment_date: paymentDate,
        bank_account: bankAccount,
        notes,
      });
      if (andSubmit) {
        await submitPaymentRun(run.id);
        toast({ title: `Payment run ${run.run_number} submitted for approval` });
      } else {
        toast({ title: `Payment run ${run.run_number} created as Draft` });
      }
      navigate(`/ap-invoices/payment-run/${run.id}`);
    } catch (e) {
      toast({
        title: 'Create failed',
        description: e instanceof Error ? e.message : 'Request failed',
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/ap-invoices/payment-run')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h1 className="text-2xl font-bold text-slate-900 mt-2">Create Payment Run</h1>
          <p className="text-sm text-slate-500">
            Step {step + 1} of 3 — {STEPS[step]}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {STEPS.map((label, i) => (
          <div
            key={label}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
              i === step
                ? 'bg-blue-600 text-white border-blue-600'
                : i < step
                  ? 'bg-blue-50 text-blue-800 border-blue-200'
                  : 'bg-slate-50 text-slate-500 border-slate-200'
            }`}
          >
            {i < step ? <Check className="inline h-3 w-3 mr-1" /> : null}
            {i + 1}. {label}
          </div>
        ))}
      </div>

      {step === 0 && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Filters</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <div>
                <label className="text-xs text-slate-500">Due from</label>
                <Input type="date" value={dueFrom} onChange={(e) => setDueFrom(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-500">Due to</label>
                <Input type="date" value={dueTo} onChange={(e) => setDueTo(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-500">Vendor</label>
                <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Search vendor" />
              </div>
              <div>
                <label className="text-xs text-slate-500">Property</label>
                <Input
                  value={property}
                  onChange={(e) => setProperty(e.target.value)}
                  placeholder="Property name / id"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Amount min</label>
                <Input type="number" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-500">Amount max</label>
                <Input type="number" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-500">Category</label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Button variant="outline" onClick={() => void load()} disabled={loading}>
                  {loading ? 'Loading…' : 'Apply Filters'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base">Approved unpaid invoices</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={selectAll}>
                  Select all
                </Button>
                <Button variant="outline" size="sm" onClick={deselectAll}>
                  Deselect all
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Property</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Amount AED</TableHead>
                    <TableHead>Days Overdue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-slate-500 py-8">
                        Loading…
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading && invoices.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-slate-500 py-8">
                        No approved unpaid invoices match these filters.
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading &&
                    invoices.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell>
                          <Checkbox
                            checked={selected.has(inv.id)}
                            onCheckedChange={() => toggle(inv.id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                        <TableCell>{inv.vendor_name}</TableCell>
                        <TableCell>{inv.property_name || inv.property_id || '—'}</TableCell>
                        <TableCell>{inv.due_date || '—'}</TableCell>
                        <TableCell>{formatCurrency(Number(inv.amount || 0), 'AED')}</TableCell>
                        <TableCell>{inv.days_overdue}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="sticky bottom-0 bg-white border border-slate-200 rounded-lg px-4 py-3 shadow flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-700">
              Selected: <strong>{summary.count}</strong> · Running total:{' '}
              <strong>{formatCurrency(summary.total, 'AED')}</strong>
            </div>
            <Button onClick={goReview} disabled={!selected.size}>
              Continue to review <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Run summary</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-slate-500">Total invoices</p>
                <p className="text-lg font-semibold">{summary.count}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Total AED</p>
                <p className="text-lg font-semibold">{formatCurrency(summary.total, 'AED')}</p>
              </div>
              <div>
                <label className="text-xs text-slate-500">Payment date</label>
                <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-500">Bank account</label>
                <Input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} />
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <label className="text-xs text-slate-500">Notes</label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Selected invoices</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Amount AED</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedRows.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell>{inv.invoice_number}</TableCell>
                      <TableCell>{inv.vendor_name}</TableCell>
                      <TableCell>{formatCurrency(Number(inv.amount || 0), 'AED')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="flex justify-between gap-2">
            <Button variant="outline" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button onClick={() => setStep(2)}>
              Continue <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Approve and execute</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-slate-700">
            <p>
              Maker-checker: you create this run now. A <strong>different</strong> user must approve
              it before Execute can mark invoices paid and post the GL journal entry.
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                {summary.count} invoices · {formatCurrency(summary.total, 'AED')}
              </li>
              <li>Payment date: {paymentDate}</li>
              <li>Bank account: {bankAccount || '—'}</li>
            </ul>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep(1)} disabled={creating}>
                Back
              </Button>
              <Button variant="outline" onClick={() => void create(false)} disabled={creating}>
                {creating ? 'Saving…' : 'Save as Draft'}
              </Button>
              <Button onClick={() => void create(true)} disabled={creating}>
                {creating ? 'Submitting…' : 'Create & submit for approval'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
