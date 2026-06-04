import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, type PurchaseOrder } from '../../lib/ap-invoice/supabase';
import { requireCompanyId } from '../../lib/ap-invoice/companyService';
import {
  createGRN,
  listGoodsReceiptsForCompany,
  rerunAutoMatchForPo,
  autoMatchToastMessage,
  bulkImportGRNs,
  parseGRNImportExcelFile,
  mergeGRNImportCSVs,
  downloadGRNImportCSVTemplates,
  downloadGRNImportExcelTemplate,
  readFileAsText,
  type GRNImportRow,
  type GRNLineImportRow,
  type BulkImportGRNResult,
} from '../../lib/ap-invoice/threeWayMatchService';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Badge } from '../../components/ui/badge';
import { useToast } from '../../hooks/use-toast';
import { format } from 'date-fns';
import { ClipboardList, Plus, Trash2, Upload, FileSpreadsheet, ScanLine } from 'lucide-react';
import { invoiceFlowAgentUrl } from '../../lib/ap-invoice/apiBase';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Progress } from '../../components/ui/progress';
import { ScrollArea } from '../../components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';

type GrnRow = {
  id: string;
  grn_number: string;
  po_id: string | null;
  vendor_name: string;
  received_amount: number;
  received_date: string;
  status?: string | null;
  grn_line_items?: Array<{ total_value?: number }>;
};

type LineRow = {
  id: string;
  description: string;
  ordered_qty: number;
  received_qty: number;
  unit_price: number;
  condition: string;
};

type ImportPhase = 'pick' | 'preview' | 'running' | 'done';

export function GoodsReceipts() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prePoId = searchParams.get('poId') || '';

  const [loading, setLoading] = useState(true);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [grns, setGrns] = useState<GrnRow[]>([]);
  const [selectedPoId, setSelectedPoId] = useState('');
  const [receiptDate, setReceiptDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [receivedBy, setReceivedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineRow[]>([
    { id: '1', description: '', ordered_qty: 1, received_qty: 1, unit_price: 0, condition: 'good' },
  ]);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('all');
  const [deleteAllGrnOpen, setDeleteAllGrnOpen] = useState(false);
  const [deletingAllGrns, setDeletingAllGrns] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<'excel' | 'csv'>('excel');
  const [importPhase, setImportPhase] = useState<ImportPhase>('pick');
  const [importPreview, setImportPreview] = useState<{ master: GRNImportRow[]; lineItems: GRNLineImportRow[] } | null>(
    null
  );
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, detail: '' });
  const [importLog, setImportLog] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<BulkImportGRNResult | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [scanningGrn, setScanningGrn] = useState(false);
  const [bulkGrnProgress, setBulkGrnProgress] = useState<{ done: number; total: number } | null>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const csvMasterRef = useRef<HTMLInputElement>(null);
  const csvLinesRef = useRef<HTMLInputElement>(null);
  const grnScanRef = useRef<HTMLInputElement>(null);
  const grnBulkScanRef = useRef<HTMLInputElement>(null);
  const [csvMasterText, setCsvMasterText] = useState('');
  const [csvLinesText, setCsvLinesText] = useState('');

  const selectedPo = useMemo(
    () => purchaseOrders.find((p) => p.id === selectedPoId) ?? null,
    [purchaseOrders, selectedPoId]
  );

  async function load() {
    setLoading(true);
    try {
      const companyId = await requireCompanyId();
      const [poRes, grnList] = await Promise.all([
        supabase
          .from('purchase_orders')
          .select('*')
          .eq('company_id', companyId)
          .order('created_at', { ascending: false }),
        listGoodsReceiptsForCompany(),
      ]);
      if (!poRes.error && poRes.data) setPurchaseOrders(poRes.data as PurchaseOrder[]);
      else {
        setPurchaseOrders([]);
        if (poRes.error?.message && !poRes.error.message.includes('schema cache')) {
          console.warn('PO load:', poRes.error.message);
        }
      }
      setGrns((grnList as GrnRow[]) ?? []);
    } catch (e) {
      console.warn('Goods receipts load:', e);
      setPurchaseOrders([]);
      setGrns([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (prePoId && purchaseOrders.some((p) => p.id === prePoId)) {
      setSelectedPoId(prePoId);
      setTab('create');
    }
  }, [prePoId, purchaseOrders]);

  useEffect(() => {
    if (!selectedPo) return;
    const poLines = selectedPo.line_items;
    if (Array.isArray(poLines) && poLines.length > 0) {
      setLines(
        poLines.map((item: { description?: string; quantity?: number; unit_price?: number; total?: number }, i: number) => ({
          id: String(i + 1),
          description: String(item.description ?? ''),
          ordered_qty: Number(item.quantity ?? 0),
          received_qty: Number(item.quantity ?? 0),
          unit_price: Number(item.unit_price ?? 0),
          condition: 'good',
        }))
      );
    } else {
      setLines([
        {
          id: '1',
          description: selectedPo.description || 'Line 1',
          ordered_qty: 1,
          received_qty: 1,
          unit_price: Number(selectedPo.po_amount) || 0,
          condition: 'good',
        },
      ]);
    }
  }, [selectedPo?.id]);

  function addLine() {
    setLines((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        description: '',
        ordered_qty: 1,
        received_qty: 1,
        unit_price: 0,
        condition: 'good',
      },
    ]);
  }

  function updateLine(id: string, patch: Partial<LineRow>) {
    setLines((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function handleConfirmGrn(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPo) {
      toast({ title: 'Select a PO', variant: 'destructive' });
      return;
    }
    if (!receivedBy.trim()) {
      toast({ title: 'Received by required', description: 'Enter who confirmed receipt.', variant: 'destructive' });
      return;
    }
    const validLines = lines.filter((l) => l.description.trim());
    if (validLines.length === 0) {
      toast({ title: 'Add line items', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      await createGRN({
        po_id: selectedPo.id,
        vendor_name: selectedPo.vendor_name,
        receipt_date: receiptDate,
        received_by: receivedBy.trim(),
        notes: notes.trim(),
        line_items: validLines.map((l) => ({
          description: l.description.trim(),
          ordered_qty: l.ordered_qty,
          received_qty: l.received_qty,
          unit_price: l.unit_price,
          condition: l.condition,
        })),
      });

      const poNum = selectedPo.po_number;
      const rematch = await rerunAutoMatchForPo(selectedPo.id, poNum);
      await load();

      if (rematch.length === 0) {
        toast({ title: 'GRN confirmed', description: 'No invoice linked to this PO yet.' });
      } else {
        const first = rematch[0];
        const msg = autoMatchToastMessage(first.result);
        toast({
          title: 'GRN confirmed',
          description:
            rematch.length === 1
              ? `Invoice ${first.invoice_number ?? first.invoiceId.slice(0, 8)}: ${msg}`
              : `${rematch.length} invoice(s) re-matched. ${msg}`,
        });
      }

      setNotes('');
      setTab('all');
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : 'Could not save GRN';
      toast({ title: 'Error', description: m, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  function lineTotal(l: LineRow) {
    return Number(l.received_qty) * Number(l.unit_price);
  }

  function resetImportModal() {
    setImportPhase('pick');
    setImportPreview(null);
    setImportResult(null);
    setImportLog([]);
    setImportProgress({ current: 0, total: 0, detail: '' });
    setCsvMasterText('');
    setCsvLinesText('');
    setImportMode('excel');
    if (excelInputRef.current) excelInputRef.current.value = '';
    if (csvMasterRef.current) csvMasterRef.current.value = '';
    if (csvLinesRef.current) csvLinesRef.current.value = '';
  }

  async function handleGrnPdfScan(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanningGrn(true);
    try {
      const payload = new FormData();
      payload.append('file', file, file.name);
      const res = await fetch(invoiceFlowAgentUrl('/api/agent/extract-image'), { method: 'POST', body: payload });
      if (!res.ok) throw new Error(`Extraction failed (${res.status})`);
      const raw = await res.json();
      const d: any = Array.isArray(raw) ? (raw[0]?.invoice ?? raw[0]) : (raw?.invoice ?? raw);

      // Pre-fill GRN create form fields
      const total = Number(d.total_amount ?? d.subtotal_amount ?? 0);
      const recvDate = d.invoice_date || format(new Date(), 'yyyy-MM-dd');

      // Try to match vendor to a PO
      const matchedPo = purchaseOrders.find((po) =>
        po.vendor_name?.toLowerCase().includes((d.vendor_name || '').toLowerCase()) ||
        (d.vendor_name || '').toLowerCase().includes(po.vendor_name?.toLowerCase() || '')
      );
      if (matchedPo) setSelectedPoId(matchedPo.id);
      setReceiptDate(recvDate);
      setNotes(`Scanned from: ${file.name}${d.invoice_number ? ` | Ref: ${d.invoice_number}` : ''}`);

      // Pre-fill line items if extracted
      if (Array.isArray(d.line_items) && d.line_items.length > 0) {
        setLines(d.line_items.map((li: any, idx: number) => ({
          id: String(idx + 1),
          description: li.description || '',
          ordered_qty: Number(li.quantity) || 1,
          received_qty: Number(li.quantity) || 1,
          unit_price: Number(li.unit_price) || 0,
          condition: '',
        })));
      } else if (total > 0) {
        setLines([{ id: '1', description: d.description || 'Goods received', ordered_qty: 1, received_qty: 1, unit_price: total, condition: '' }]);
      }

      setTab('create');
      toast({ title: 'âœ… GRN extracted', description: `${d.vendor_name || 'Vendor'} â€” â‚¹${total.toLocaleString()}. Review and save.` });
    } catch (err) {
      toast({ title: 'PDF extraction failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setScanningGrn(false);
      if (grnScanRef.current) grnScanRef.current.value = '';
    }
  }

  async function handleGrnBulkScan(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setScanningGrn(true);
    setBulkGrnProgress({ done: 0, total: files.length });
    let saved = 0; let failed = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const payload = new FormData();
        payload.append('file', file, file.name);
        const res = await fetch(invoiceFlowAgentUrl('/api/agent/extract-image'), { method: 'POST', body: payload });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json();
        const d: any = Array.isArray(raw) ? (raw[0]?.invoice ?? raw[0]) : (raw?.invoice ?? raw);

        const total = Number(d.total_amount ?? d.subtotal_amount ?? 0);
        const recvDate = d.invoice_date || format(new Date(), 'yyyy-MM-dd');
        const matchedPo = purchaseOrders.find((po) =>
          po.vendor_name?.toLowerCase().includes((d.vendor_name || '').toLowerCase())
        );
        // GRN number is auto-generated by createGRN via next_grn_number RPC

        const lineItems = Array.isArray(d.line_items) && d.line_items.length > 0
          ? d.line_items.map((li: any) => ({
              description: li.description || '',
              ordered_qty: Number(li.quantity) || 1,
              received_qty: Number(li.quantity) || 1,
              unit_price: Number(li.unit_price) || 0,
            }))
          : [{ description: d.description || 'Goods received', ordered_qty: 1, received_qty: 1, unit_price: total }];

        await createGRN({
          po_id: matchedPo?.id ?? null,
          vendor_name: d.vendor_name || 'Unknown Vendor',
          receipt_date: recvDate,
          received_by: 'Bulk PDF Scan',
          notes: `Bulk scanned from: ${file.name}`,
          line_items: lineItems,
        });
        saved++;
      } catch (err) {
        failed++;
        console.error(`Bulk GRN scan failed for ${file.name}:`, err);
      }
      setBulkGrnProgress({ done: i + 1, total: files.length });
    }

    await load();
    setScanningGrn(false);
    setBulkGrnProgress(null);
    if (grnBulkScanRef.current) grnBulkScanRef.current.value = '';
    toast({
      title: 'Bulk GRN scan complete',
      description: `${saved} GRNs created${failed > 0 ? `, ${failed} failed` : ''}`,
      variant: failed > 0 ? 'destructive' : 'default',
    });
  }

  function openImportModal() {
    resetImportModal();
    setImportOpen(true);
  }

  async function handleExcelImportPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const low = file.name.toLowerCase();
    if (!low.endsWith('.xlsx') && !low.endsWith('.xls')) {
      toast({ title: 'Use Excel', description: 'Choose a .xlsx or .xls file.', variant: 'destructive' });
      return;
    }
    setImportBusy(true);
    try {
      const parsed = await parseGRNImportExcelFile(file);
      setImportPreview(parsed);
      if (parsed.master.length === 0) {
        toast({
          title: 'No GRN rows found',
          description: 'Expected columns include grn_number, po_number, vendor_name. Add a sheet named GRN Master or Line Items.',
          variant: 'destructive',
        });
        setImportPhase('pick');
      } else {
        setImportPhase('preview');
      }
    } catch (err) {
      toast({
        title: 'Could not read file',
        description: err instanceof Error ? err.message : 'Invalid spreadsheet',
        variant: 'destructive',
      });
    } finally {
      setImportBusy(false);
    }
  }

  function applyCsvMerge(masterText: string, linesText: string) {
    const merged = mergeGRNImportCSVs(masterText, linesText);
    setImportPreview(merged);
    if (merged.master.length === 0) {
      toast({
        title: 'No GRN rows in CSV',
        description: 'Upload GRN_Master_Template.csv (or equivalent) with grn_number and po_number columns.',
        variant: 'destructive',
      });
      setImportPhase('pick');
    } else {
      setImportPhase('preview');
    }
  }

  async function handleCsvMasterPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const t = await readFileAsText(file);
    setCsvMasterText(t);
    applyCsvMerge(t, csvLinesText);
  }

  async function handleCsvLinesPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const t = await readFileAsText(file);
    setCsvLinesText(t);
    applyCsvMerge(csvMasterText, t);
  }

  async function runBulkGrnImport() {
    if (!importPreview?.master.length) return;
    setImportPhase('running');
    setImportLog([]);
    setImportResult(null);
    setImportProgress({ current: 0, total: importPreview.master.length, detail: 'Startingâ€¦' });
    setImportBusy(true);
    try {
      const res = await bulkImportGRNs(importPreview.master, importPreview.lineItems, (cur, tot, detail) => {
        setImportProgress({ current: cur, total: tot, detail });
        setImportLog((prev) => [...prev, detail].slice(-30));
      });
      setImportResult(res);
      setImportPhase('done');
      await load();
      toast({
        title: 'Import finished',
        description: `${res.success} created, ${res.skipped} skipped, ${res.failed} failed. ${res.matched} match(es) within tolerance.`,
      });
    } catch (err) {
      toast({
        title: 'Import failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
      setImportPhase('preview');
    } finally {
      setImportBusy(false);
    }
  }

  async function handleDeleteAllGrns() {
    if (grns.length === 0) return;
    const n = grns.length;
    setDeletingAllGrns(true);
    try {
      const companyId = await requireCompanyId();
      const { error } = await supabase
        .from('goods_receipts')
        .delete()
        .eq('company_id', companyId)
        .gte('created_at', '1970-01-01T00:00:00.000Z');
      if (error) throw error;

      setGrns([]);
      setDeleteAllGrnOpen(false);
      toast({
        title: 'All GRNs removed',
        description: `Deleted ${n} goods receipt${n === 1 ? '' : 's'}. Line items are removed with each GRN if your database uses cascade.`,
      });
    } catch (err) {
      console.error('Delete all GRNs failed:', err);
      toast({
        title: 'Could not delete all GRNs',
        description: err instanceof Error ? err.message : 'Check company setup and Supabase delete permissions.',
        variant: 'destructive',
      });
    } finally {
      setDeletingAllGrns(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-gray-500">
        Loading goods receiptsâ€¦
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Goods Receipts</h1>
          <p className="mt-1 text-sm text-gray-500">Confirm receipts against POs; linked invoices auto re-match.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Single PDF scan */}
          <input ref={grnScanRef} type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={handleGrnPdfScan} />
          {/* Bulk PDF scan */}
          <input ref={grnBulkScanRef} type="file" accept=".pdf,.png,.jpg,.jpeg" multiple className="hidden" onChange={handleGrnBulkScan} />

          <Button type="button" variant="outline" disabled={scanningGrn} onClick={() => grnScanRef.current?.click()}
            className="border-purple-300 text-purple-700 hover:bg-purple-50">
            <ScanLine className="mr-2 h-4 w-4" />
            {scanningGrn && !bulkGrnProgress ? 'Extractingâ€¦' : 'Scan GRN PDF'}
          </Button>

          <Button type="button" variant="outline" disabled={scanningGrn} onClick={() => grnBulkScanRef.current?.click()}
            className="border-indigo-300 text-indigo-700 hover:bg-indigo-50">
            <ScanLine className="mr-2 h-4 w-4" />
            {bulkGrnProgress ? `Scanning ${bulkGrnProgress.done}/${bulkGrnProgress.total}â€¦` : 'Bulk Scan GRNs'}
          </Button>

          <Button type="button" variant="outline" onClick={openImportModal}>
            <Upload className="mr-2 h-4 w-4" />
            Import GRNs (Excel)
          </Button>
          <Button className="bg-[#0A4B8F]" type="button" onClick={() => setTab('create')}>
            <Plus className="mr-2 h-4 w-4" />
            New GRN
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">All GRNs</TabsTrigger>
          <TabsTrigger value="create">Create GRN</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <Card>
            <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <ClipboardList className="h-5 w-5" />
                Receipt history
              </CardTitle>
              {grns.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                  onClick={() => setDeleteAllGrnOpen(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete all GRNs
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {grns.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">
                  No goods receipts yet. Create a GRN when stock or services are received.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>GRN #</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>PO</TableHead>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Items</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {grns.map((g) => {
                        const fromLines = (g.grn_line_items ?? []).reduce(
                          (s, li) => s + Number(li.total_value ?? 0),
                          0
                        );
                        const total = fromLines > 0 ? fromLines : Number(g.received_amount);
                        const po = purchaseOrders.find((p) => p.id === g.po_id);
                        return (
                          <TableRow key={g.id}>
                            <TableCell className="font-medium">{g.grn_number}</TableCell>
                            <TableCell>
                              {g.received_date ? format(new Date(g.received_date), 'dd MMM yyyy') : 'â€”'}
                            </TableCell>
                            <TableCell>{po?.po_number ?? (g.po_id ? 'â€”' : 'â€”')}</TableCell>
                            <TableCell>{g.vendor_name}</TableCell>
                            <TableCell>{total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                            <TableCell>{g.grn_line_items?.length ?? 0}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{g.status || 'confirmed'}</Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="create" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>New Goods Receipt Note</CardTitle>
            </CardHeader>
            <CardContent>
              {purchaseOrders.length === 0 ? (
                <p className="text-sm text-gray-600">
                  No purchase orders for this company.{' '}
                  <Link to="/purchase-orders" className="text-blue-600 underline">
                    Create a PO first
                  </Link>
                  .
                </p>
              ) : (
                <form onSubmit={handleConfirmGrn} className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Link to PO</Label>
                      <Select value={selectedPoId} onValueChange={setSelectedPoId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select PO" />
                        </SelectTrigger>
                        <SelectContent>
                          {purchaseOrders.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.po_number} â€” {p.vendor_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Vendor</Label>
                      <Input readOnly value={selectedPo?.vendor_name ?? ''} className="bg-gray-50" />
                    </div>
                    <div className="space-y-2">
                      <Label>Receipt date</Label>
                      <Input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Received by</Label>
                      <Input
                        value={receivedBy}
                        onChange={(e) => setReceivedBy(e.target.value)}
                        placeholder="Your name"
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="mb-2 block">Items received</Label>
                    <div className="overflow-x-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Description</TableHead>
                            <TableHead className="w-24">Ordered</TableHead>
                            <TableHead className="w-24">Received</TableHead>
                            <TableHead className="w-28">Unit price</TableHead>
                            <TableHead className="w-24">Line total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {lines.map((row) => (
                            <TableRow key={row.id}>
                              <TableCell className="p-1">
                                <Input
                                  className="h-9"
                                  value={row.description}
                                  onChange={(e) => updateLine(row.id, { description: e.target.value })}
                                />
                              </TableCell>
                              <TableCell className="p-1">
                                <Input
                                  type="number"
                                  className="h-9"
                                  value={row.ordered_qty}
                                  onChange={(e) => updateLine(row.id, { ordered_qty: Number(e.target.value) || 0 })}
                                />
                              </TableCell>
                              <TableCell className="p-1">
                                <Input
                                  type="number"
                                  className="h-9"
                                  value={row.received_qty}
                                  onChange={(e) => updateLine(row.id, { received_qty: Number(e.target.value) || 0 })}
                                />
                              </TableCell>
                              <TableCell className="p-1">
                                <Input
                                  type="number"
                                  className="h-9"
                                  step="0.01"
                                  value={row.unit_price}
                                  onChange={(e) => updateLine(row.id, { unit_price: Number(e.target.value) || 0 })}
                                />
                              </TableCell>
                              <TableCell className="text-sm">{lineTotal(row).toFixed(2)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="mt-2" onClick={addLine}>
                      + Add line item
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
                  </div>

                  <Button type="submit" className="bg-[#0A4B8F]" disabled={saving}>
                    {saving ? 'Savingâ€¦' : 'Confirm GRN'}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open);
          if (!open) resetImportModal();
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {importPhase === 'running'
                ? 'Importing GRNsâ€¦'
                : importPhase === 'done'
                  ? 'Import complete'
                  : 'Bulk import GRNs'}
            </DialogTitle>
            <DialogDescription>
              {importPhase === 'pick' &&
                'Upload one Excel file (GRN Master + Line Items sheets) or two CSV files. Then confirm to create GRNs and run auto-match.'}
              {importPhase === 'preview' && 'Review the rows below, then import.'}
              {importPhase === 'running' && importProgress.detail}
              {importPhase === 'done' && importResult && (
                <span>
                  {importResult.success} imported Â· {importResult.skipped} skipped Â· {importResult.failed} failed Â·{' '}
                  {importResult.matched} within tolerance
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {importPhase === 'pick' && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={importMode === 'excel' ? 'default' : 'outline'} onClick={() => setImportMode('excel')}>
                  Excel
                </Button>
                <Button type="button" size="sm" variant={importMode === 'csv' ? 'default' : 'outline'} onClick={() => setImportMode('csv')}>
                  Two CSVs
                </Button>
              </div>

              {importMode === 'excel' ? (
                <div className="space-y-2">
                  <Label>Excel (.xlsx / .xls)</Label>
                  <Input
                    ref={excelInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    disabled={importBusy}
                    onChange={(e) => void handleExcelImportPick(e)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Sheets like &quot;GRN Master&quot; and &quot;Line Items&quot; are detected automatically. Line items are matched by{' '}
                    <code className="text-xs">grn_number</code>.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Master CSV</Label>
                    <Input ref={csvMasterRef} type="file" accept=".csv" disabled={importBusy} onChange={(e) => void handleCsvMasterPick(e)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Line items CSV</Label>
                    <Input ref={csvLinesRef} type="file" accept=".csv" disabled={importBusy} onChange={(e) => void handleCsvLinesPick(e)} />
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    You can upload master only (one line per GRN will be generated); line CSV adds detailed lines per{' '}
                    <code className="text-xs">grn_number</code>.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => downloadGRNImportExcelTemplate()}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Download Excel template
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => downloadGRNImportCSVTemplates()}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Download CSV templates
                </Button>
              </div>
            </div>
          )}

          {importPhase === 'preview' && importPreview && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground">
                {importPreview.master.length} GRN(s) Â· {importPreview.lineItems.length} line item row(s)
              </p>
              <ScrollArea className="h-[220px] rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>GRN #</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>PO</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importPreview.master.map((m) => (
                      <TableRow key={m.grn_number}>
                        <TableCell className="font-mono text-xs">{m.grn_number}</TableCell>
                        <TableCell className="max-w-[140px] truncate text-xs">{m.vendor_name}</TableCell>
                        <TableCell className="font-mono text-xs">{m.po_number || 'â€”'}</TableCell>
                        <TableCell className="font-mono text-xs">{m.invoice_number || 'â€”'}</TableCell>
                        <TableCell className="text-xs">{m.grn_date || 'â€”'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          )}

          {importPhase === 'running' && (
            <div className="space-y-3">
              <Progress
                value={
                  importProgress.total > 0 ? Math.round((importProgress.current / importProgress.total) * 100) : 0
                }
              />
              <p className="text-sm text-muted-foreground">
                {importProgress.current} / {importProgress.total}
              </p>
              <ScrollArea className="h-[160px] rounded-md border bg-muted/30 p-2">
                <ul className="space-y-1 text-xs font-mono">
                  {importLog.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </ScrollArea>
            </div>
          )}

          {importPhase === 'done' && importResult && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div className="rounded-md border p-2 text-center">
                  <div className="text-lg font-semibold text-green-700">{importResult.success}</div>
                  <div className="text-muted-foreground text-xs">Imported</div>
                </div>
                <div className="rounded-md border p-2 text-center">
                  <div className="text-lg font-semibold">{importResult.matched}</div>
                  <div className="text-muted-foreground text-xs">Within tolerance</div>
                </div>
                <div className="rounded-md border p-2 text-center">
                  <div className="text-lg font-semibold text-amber-700">{importResult.skipped}</div>
                  <div className="text-muted-foreground text-xs">Skipped</div>
                </div>
                <div className="rounded-md border p-2 text-center">
                  <div className="text-lg font-semibold text-red-700">{importResult.failed}</div>
                  <div className="text-muted-foreground text-xs">Failed</div>
                </div>
              </div>
              <ScrollArea className="h-[200px] rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>GRN</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Match</TableHead>
                      <TableHead>Auto-approved</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importResult.results.map((r, idx) => (
                      <TableRow key={`${idx}-${r.grn_number}`}>
                        <TableCell className="font-mono text-xs">{r.grn_number}</TableCell>
                        <TableCell className="font-mono text-xs">{r.invoice_number || 'â€”'}</TableCell>
                        <TableCell className="text-xs">{r.match_status}{r.warning ? ` Â· ${r.warning}` : ''}</TableCell>
                        <TableCell className="text-xs">{r.auto_approved ? 'Yes' : 'No'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
              {importResult.errors.length > 0 && (
                <ScrollArea className="max-h-[100px] rounded-md border border-red-200 bg-red-50/50 p-2">
                  <ul className="text-xs text-red-900">
                    {importResult.errors.map((e, i) => (
                      <li key={i}>
                        <strong>{e.grn_number}</strong>: {e.error}
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            {importPhase === 'pick' && (
              <Button type="button" variant="secondary" onClick={() => setImportOpen(false)}>
                Close
              </Button>
            )}
            {importPhase === 'preview' && (
              <>
                <Button type="button" variant="outline" onClick={() => setImportPhase('pick')}>
                  Back
                </Button>
                <Button type="button" className="bg-[#0A4B8F]" disabled={importBusy} onClick={() => void runBulkGrnImport()}>
                  Import {importPreview?.master.length ?? 0} GRN(s) + run match
                </Button>
              </>
            )}
            {importPhase === 'running' && (
              <Button type="button" variant="secondary" disabled>
                Workingâ€¦
              </Button>
            )}
            {importPhase === 'done' && (
              <>
                <Button type="button" variant="outline" onClick={() => navigate('/invoices')}>
                  View invoice list
                </Button>
                <Button type="button" onClick={() => setImportOpen(false)}>
                  Close
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteAllGrnOpen} onOpenChange={setDeleteAllGrnOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all goods receipts (GRNs)?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-left">
              <span className="block">
                This permanently removes <strong>all {grns.length} GRN record{grns.length === 1 ? '' : 's'}</strong> for your
                current company. This is <strong>not</strong> your chart of accounts or GL accountsâ€”only goods receipt notes
                in this list.
              </span>
              <span className="block text-red-700 font-medium">This cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingAllGrns}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingAllGrns}
              onClick={() => void handleDeleteAllGrns()}
            >
              {deletingAllGrns ? 'Deletingâ€¦' : 'Yes, delete all GRNs'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

