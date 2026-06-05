import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, type PurchaseOrder } from '../../lib/ap-invoice/supabase';
import { getMyCompany, requireCompanyId } from '../../lib/ap-invoice/companyService';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { ShoppingCart, Plus, Search, Trash2, Upload, FileDown, ScanLine, RefreshCw } from 'lucide-react';
import { rerunAutoMatchForPo } from '../../lib/ap-invoice/threeWayMatchService';
import { invoiceFlowAgentUrl } from '../../lib/ap-invoice/apiBase';
import { format } from 'date-fns';
import { useToast } from '../../hooks/use-toast';
import * as XLSX from 'xlsx';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';

const statusColors = {
  Open: 'bg-blue-100 text-blue-800 border-blue-200',
  'Partially Received': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  'Fully Received': 'bg-green-100 text-green-800 border-green-200',
  Closed: 'bg-gray-100 text-gray-800 border-gray-200',
  Cancelled: 'bg-red-100 text-red-800 border-red-200',
};

export function PurchaseOrders() {
  const { toast } = useToast();
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [filteredPOs, setFilteredPOs] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [vendorNames, setVendorNames] = useState<string[]>([]);
  const [formData, setFormData] = useState({
    po_number: '',
    vendor_name: '',
    po_amount: '',
    po_date: '',
    delivery_date: '',
    description: '',
    notes: '',
    status: 'Open' as 'Open' | 'Partially Received' | 'Fully Received' | 'Closed' | 'Cancelled',
  });
  type LineItem = { id: string; description: string; quantity: number; unit_price: number; total: number };
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { id: '1', description: '', quantity: 1, unit_price: 0, total: 0 },
  ]);
  const [uploading, setUploading] = useState(false);
  const [scanningPdf, setScanningPdf] = useState(false);
  const [bulkScanProgress, setBulkScanProgress] = useState<{ done: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfScanRef = useRef<HTMLInputElement>(null);
  const bulkScanRef = useRef<HTMLInputElement>(null);
  const [poMeta, setPoMeta] = useState<
    Record<string, { grn?: string; invLabel: string }>
  >({});
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [rematching, setRematching] = useState(false);

  useEffect(() => {
    fetchPurchaseOrders();
  }, []);

  useEffect(() => {
    if (dialogOpen) {
      fetchVendorNames();
      suggestPoNumber();
    }
  }, [dialogOpen]);

  async function fetchVendorNames() {
    try {
      const { data } = await supabase.from('invoices').select('vendor_name');
      const names = Array.from(new Set((data || []).map((r) => r.vendor_name).filter(Boolean))) as string[];
      names.sort();
      setVendorNames(names);
    } catch {
      setVendorNames([]);
    }
  }

  async function handlePdfScan(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanningPdf(true);
    try {
      const payload = new FormData();
      payload.append('file', file, file.name);
      const res = await fetch(invoiceFlowAgentUrl('/api/agent/extract-image'), { method: 'POST', body: payload });
      if (!res.ok) throw new Error(`Extraction failed (${res.status})`);
      const raw = await res.json();
      // Proxy returns array or single; normalise
      const d: any = Array.isArray(raw) ? (raw[0]?.invoice ?? raw[0]) : (raw?.invoice ?? raw);

      // Map extracted fields to PO form
      const poDate = d.invoice_date
        ? d.invoice_date.includes('-') ? d.invoice_date : d.invoice_date
        : new Date().toISOString().split('T')[0];
      const deliveryDate = d.due_date || d.delivery_date || '';
      const total = Number(d.total_amount ?? d.subtotal_amount ?? 0);

      setFormData((prev) => ({
        ...prev,
        vendor_name: d.vendor_name || prev.vendor_name,
        po_amount: total > 0 ? String(total) : prev.po_amount,
        po_date: poDate || prev.po_date,
        delivery_date: deliveryDate || prev.delivery_date,
        description: d.description || d.ifrs_category || prev.description,
        notes: d.invoice_number ? `Extracted from PO PDF: ${d.invoice_number}` : prev.notes,
      }));

      // Pre-fill line items if extracted
      if (Array.isArray(d.line_items) && d.line_items.length > 0) {
        setLineItems(d.line_items.map((li: any, idx: number) => ({
          id: String(idx + 1),
          description: li.description || '',
          quantity: Number(li.quantity) || 1,
          unit_price: Number(li.unit_price) || 0,
          total: Number(li.total) || Number(li.quantity) * Number(li.unit_price) || 0,
        })));
      }

      setDialogOpen(true);
      toast({ title: 'âœ… PO extracted', description: `${d.vendor_name || 'Vendor'} â€” â‚¹${total.toLocaleString()}. Review and save.` });
    } catch (err) {
      toast({ title: 'PDF extraction failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setScanningPdf(false);
      if (pdfScanRef.current) pdfScanRef.current.value = '';
    }
  }

  async function handleBulkPdfScan(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setScanningPdf(true);
    setBulkScanProgress({ done: 0, total: files.length });
    let saved = 0;
    let failed = 0;

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
        const poDate = d.invoice_date || new Date().toISOString().split('T')[0];
        const companyId = await requireCompanyId();
        const year = new Date().getFullYear();
        const { data: lastPO } = await supabase.from('purchase_orders').select('po_number').ilike('po_number', `PO-${year}-%`).order('po_number', { ascending: false }).limit(1);
        const lastNum = lastPO?.[0]?.po_number?.match(/PO-\d{4}-(\d+)/i)?.[1];
        const nextNum = lastNum ? parseInt(lastNum, 10) + 1 + i : i + 1;
        const poNumber = `PO-${year}-${String(nextNum).padStart(3, '0')}`;

        const { error } = await supabase.from('purchase_orders').insert({
          company_id: companyId,
          po_number: poNumber,
          vendor_name: d.vendor_name || 'Unknown Vendor',
          po_amount: total || null,
          po_date: poDate,
          delivery_date: d.due_date || null,
          description: d.description || d.ifrs_category || null,
          notes: `Bulk scanned from: ${file.name}`,
          status: 'Open',
          currency: d.currency || 'INR',
        });
        if (error) throw new Error(error.message);
        saved++;
      } catch (err) {
        failed++;
        console.error(`Bulk PO scan failed for ${file.name}:`, err);
      }
      setBulkScanProgress({ done: i + 1, total: files.length });
    }

    await fetchPurchaseOrders();
    setScanningPdf(false);
    setBulkScanProgress(null);
    if (bulkScanRef.current) bulkScanRef.current.value = '';
    toast({
      title: `Bulk scan complete`,
      description: `${saved} POs created${failed > 0 ? `, ${failed} failed` : ''}`,
      variant: failed > 0 ? 'destructive' : 'default',
    });
  }

  async function suggestPoNumber() {
    const year = new Date().getFullYear();
    const { data } = await supabase.from('purchase_orders').select('po_number').ilike('po_number', `PO-${year}-%`).order('po_number', { ascending: false }).limit(1);
    const last = (data && data[0]?.po_number) ? data[0].po_number : null;
    let next = 1;
    if (last) {
      const match = last.match(/PO-\d{4}-(\d+)/i);
      if (match) next = parseInt(match[1], 10) + 1;
    }
    setFormData((prev) => ({ ...prev, po_number: prev.po_number || `PO-${year}-${String(next).padStart(3, '0')}` }));
  }

  useEffect(() => {
    filterPOs();
  }, [purchaseOrders, searchTerm]);

  async function fetchPurchaseOrders() {
    try {
      const company = await getMyCompany();
      let q = supabase.from('purchase_orders').select('*').order('created_at', { ascending: false });
      if (company?.id) q = q.eq('company_id', company.id);
      const { data, error } = await q;

      if (error) throw error;
      const rows = data ?? [];
      setPurchaseOrders(rows);

      const meta: Record<string, { grn?: string; invLabel: string }> = {};
      if (company?.id && rows.length > 0) {
        const ids = rows.map((r) => r.id);
        const [grnRes, invRes] = await Promise.all([
          supabase
            .from('goods_receipts')
            .select('po_id, grn_number, received_date')
            .eq('company_id', company.id)
            .in('po_id', ids)
            .order('received_date', { ascending: false }),
          supabase.from('invoices').select('po_id, match_status').eq('company_id', company.id).in('po_id', ids),
        ]);
        const grnByPo: Record<string, string> = {};
        for (const g of grnRes.data ?? []) {
          const pid = g.po_id as string;
          if (pid && !grnByPo[pid]) grnByPo[pid] = String(g.grn_number);
        }
        const invByPo: Record<string, string[]> = {};
        for (const inv of invRes.data ?? []) {
          const pid = inv.po_id as string;
          if (!pid) continue;
          if (!invByPo[pid]) invByPo[pid] = [];
          invByPo[pid].push(String(inv.match_status || ''));
        }
        for (const po of rows) {
          const statuses = invByPo[po.id] ?? [];
          let invLabel = 'No Invoice';
          if (statuses.length > 0) {
            if (statuses.some((s) => s === 'mismatch')) invLabel = 'Variance';
            else if (statuses.some((s) => s === 'three_way_matched' || s === 'matched')) invLabel = 'Matched';
            else if (statuses.some((s) => s === 'partial')) invLabel = 'Partial';
            else if (statuses.some((s) => s === 'no_po')) invLabel = 'No PO on inv.';
            else invLabel = 'In progress';
          }
          meta[po.id] = { grn: grnByPo[po.id], invLabel };
        }
      }
      setPoMeta(meta);
    } catch (error: unknown) {
      console.error('PO fetch error:', error);
      setPurchaseOrders([]);
      setPoMeta({});
    } finally {
      setLoading(false);
    }
  }

  function filterPOs() {
    let filtered = purchaseOrders;

    if (searchTerm) {
      filtered = filtered.filter(
        (po) =>
          po.po_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
          po.vendor_name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    setFilteredPOs(filtered);
  }

  async function handleDeleteAllPurchaseOrders() {
    if (purchaseOrders.length === 0) return;
    const count = purchaseOrders.length;
    setDeletingAll(true);
    try {
      const company = await getMyCompany();
      let q = supabase
        .from('purchase_orders')
        .delete()
        .gte('created_at', '1970-01-01T00:00:00.000Z');
      if (company?.id) q = q.eq('company_id', company.id);
      const { error } = await q;
      if (error) throw error;

      setPurchaseOrders([]);
      setFilteredPOs([]);
      setPoMeta({});
      setDeleteAllDialogOpen(false);
      toast({
        title: 'Purchase orders removed',
        description: `Deleted ${count} purchase order${count === 1 ? '' : 's'}. Linked invoices keep their data; PO links may clear (database rules).`,
      });
    } catch (err) {
      console.error('Delete all POs failed:', err);
      toast({
        title: 'Could not delete all',
        description: err instanceof Error ? err.message : 'Check permissions and try again.',
        variant: 'destructive',
      });
    } finally {
      setDeletingAll(false);
    }
  }

  function getLineItemsTotal() {
    return lineItems.reduce((sum, row) => sum + (Number(row.quantity) * Number(row.unit_price)), 0);
  }

  function updateLineItem(id: string, field: keyof LineItem, value: string | number) {
    setLineItems((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, [field]: value };
        if (field === 'quantity' || field === 'unit_price') {
          next.total = Number(next.quantity) * Number(next.unit_price);
        }
        return next;
      })
    );
  }

  function addLineItem() {
    setLineItems((prev) => [
      ...prev,
      { id: String(Date.now()), description: '', quantity: 1, unit_price: 0, total: 0 },
    ]);
  }

  function removeLineItem(id: string) {
    if (lineItems.length <= 1) return;
    setLineItems((prev) => prev.filter((r) => r.id !== id));
  }

  function downloadPOTemplate() {
    const rows = [
      ['po_number', 'vendor_name', 'po_amount', 'po_date', 'delivery_date', 'description', 'notes', 'status'],
      ['PO-2025-001', 'Acme Corp', '15000.00', '2025-01-15', '2025-02-01', 'IT equipment', '', 'Open'],
      ['PO-2025-002', 'OfficeHub Supplies', '5000.00', '2025-01-20', '2025-01-30', 'Office supplies', '', 'Open'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Purchase Orders');
    XLSX.writeFile(wb, 'purchase_orders_template.xlsx');
    toast({ title: 'Template downloaded', description: 'Fill in your POs and upload the file.' });
  }

  type PORow = {
    po_number: string;
    vendor_name: string;
    po_amount: number;
    po_date: string;
    delivery_date?: string;
    description?: string;
    notes?: string;
    status: string;
  };

  function normalizeDate(val: unknown): string {
    if (!val) return '';
    const s = String(val).trim();
    if (!s) return '';
    // Already yyyy-mm-dd
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // dd/mm/yyyy or dd-mm-yyyy
    const d = s.split(/[/-]/);
    if (d.length === 3) {
      const day = d[0].padStart(2, '0');
      const month = d[1].padStart(2, '0');
      const year = d[2].length === 2 ? '20' + d[2] : d[2];
      return `${year}-${month}-${day}`;
    }
    return s;
  }

  function parsePOFile(file: File): Promise<PORow[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const raw = reader.result;
          if (!raw) return resolve([]);
          const rows: PORow[] = [];
          if (file.name.toLowerCase().endsWith('.csv')) {
            const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw as ArrayBuffer);
            const lines = text.split(/\r?\n/).filter((l) => l.trim());
            if (lines.length < 2) return resolve([]);
            const header = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
            const poNumIdx = header.findIndex((h) => h === 'po_number' || h === 'po number');
            const vendorIdx = header.findIndex((h) => h === 'vendor_name' || h === 'vendor name');
            const amountIdx = header.findIndex((h) => ['po_amount','po amount','amount','total_amount','total amount','po_value'].includes(h));
            const dateIdx = header.findIndex((h) => h === 'po_date' || h === 'po date' || h === 'date');
            const delivIdx = header.findIndex((h) => h === 'delivery_date' || h === 'delivery date');
            const descIdx = header.findIndex((h) => h === 'description');
            const notesIdx = header.findIndex((h) => h === 'notes');
            const statusIdx = header.findIndex((h) => h === 'status');
            for (let i = 1; i < lines.length; i++) {
              const cells = lines[i].split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''));
              const po_number = (poNumIdx >= 0 ? cells[poNumIdx] : cells[0]) || '';
              const vendor_name = (vendorIdx >= 0 ? cells[vendorIdx] : cells[1]) || '';
              const po_amount = amountIdx >= 0 ? parseFloat(cells[amountIdx]) || 0 : parseFloat(cells[2]) || 0;
              const po_date = normalizeDate(dateIdx >= 0 ? cells[dateIdx] : cells[3]);
              const delivery_date = delivIdx >= 0 ? normalizeDate(cells[delivIdx]) : undefined;
              const description = descIdx >= 0 ? cells[descIdx] : undefined;
              const notes = notesIdx >= 0 ? cells[notesIdx] : undefined;
              const status = (statusIdx >= 0 ? cells[statusIdx] : 'Open') || 'Open';
              if (po_number && vendor_name && po_date) {
                rows.push({
                  po_number,
                  vendor_name,
                  po_amount,
                  po_date,
                  delivery_date: delivery_date || undefined,
                  description: description || undefined,
                  notes: notes || undefined,
                  status: ['Open', 'Partially Received', 'Fully Received', 'Closed', 'Cancelled'].includes(status) ? status : 'Open',
                });
              }
            }
            return resolve(rows);
          }
          const data = new Uint8Array(raw as ArrayBuffer);
          const wb = XLSX.read(data, { type: 'array' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
          const rawKeys = Object.keys(json[0] || {});
          const norm = (k: string) => k.toLowerCase().replace(/\s+/g, '_');
          const poNumK = rawKeys.find((k) => norm(k) === 'po_number' || norm(k) === 'po number') || rawKeys[0];
          const vendorK = rawKeys.find((k) => norm(k) === 'vendor_name' || norm(k) === 'vendor name') || rawKeys[1];
          const amountK = rawKeys.find((k) => ['po_amount','po amount','amount','total_amount','total amount','po_value'].includes(norm(k))) || rawKeys[2];
          const dateK = rawKeys.find((k) => norm(k) === 'po_date' || norm(k) === 'po date' || norm(k) === 'date') || rawKeys[3];
          const delivK = rawKeys.find((k) => norm(k) === 'delivery_date' || norm(k) === 'delivery date');
          const descK = rawKeys.find((k) => norm(k) === 'description');
          const notesK = rawKeys.find((k) => norm(k) === 'notes');
          const statusK = rawKeys.find((k) => norm(k) === 'status');
          for (const row of json) {
            const get = (key: string | undefined, fallback: string) => {
              if (!key) return fallback;
              const v = row[key];
              return v != null && v !== '' ? String(v).trim() : fallback;
            };
            const po_number = get(poNumK, '');
            const vendor_name = get(vendorK, '');
            const po_amount = Number(row[amountK]) || 0;
            const po_date = normalizeDate(row[dateK]);
            const delivery_date = delivK ? normalizeDate(row[delivK]) : undefined;
            const description = descK ? get(descK, '') : undefined;
            const notes = notesK ? get(notesK, '') : undefined;
            const status = (statusK ? get(statusK, 'Open') : 'Open') || 'Open';
            if (po_number && vendor_name && po_date) {
              rows.push({
                po_number,
                vendor_name,
                po_amount,
                po_date,
                delivery_date: delivery_date || undefined,
                description: description || undefined,
                notes: notes || undefined,
                status: ['Open', 'Partially Received', 'Fully Received', 'Closed', 'Cancelled'].includes(status) ? status : 'Open',
              });
            }
          }
          resolve(rows);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(reader.error);
      if (file.name.toLowerCase().endsWith('.csv')) {
        reader.readAsText(file);
      } else {
        reader.readAsArrayBuffer(file);
      }
    });
  }

  async function handlePOFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const isCsv = file.name.toLowerCase().endsWith('.csv');
    const isExcel = file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls');
    if (!isCsv && !isExcel) {
      toast({
        title: 'Invalid file',
        description: 'Please upload a .csv or .xlsx file.',
        variant: 'destructive',
      });
      return;
    }
    setUploading(true);
    try {
      const companyId = await requireCompanyId();
      const rows = await parsePOFile(file);
      if (rows.length === 0) {
        toast({
          title: 'No valid rows',
          description: 'File must have headers: po_number, vendor_name, po_amount, po_date. At least one data row required.',
          variant: 'destructive',
        });
        setUploading(false);
        return;
      }
      let inserted = 0;
      let failed = 0;
      let firstError: string | null = null;
      for (const row of rows) {
        const payload: Record<string, unknown> = {
          company_id: companyId,
          po_number: row.po_number.trim(),
          vendor_name: row.vendor_name.trim(),
          po_amount: parseFloat(String(row.po_amount).replace(/,/g, '')) || 0,
          po_date: row.po_date || null,
          delivery_date: row.delivery_date || null,
          description: row.description || null,
          notes: row.notes || null,
          status: row.status || 'Open',
          updated_at: new Date().toISOString(),
        };
        const { error } = await supabase
          .from('purchase_orders')
          .upsert(payload, { onConflict: 'po_number' });
        if (error) {
          failed++;
          if (error.code === '23505') {
            firstError = firstError || 'Duplicate PO number (already exists).';
          } else {
            firstError = firstError || error.message;
          }
          console.error('PO insert error:', error.code, error.message, row.po_number);
        } else {
          inserted++;
        }
      }
      fetchPurchaseOrders();
      const desc = inserted
        ? `${inserted} purchase order(s) added.${failed > 0 ? ` ${failed} skipped.` : ''}`
        : failed > 0 && firstError
        ? `${failed} row(s) skipped: ${firstError}`
        : `${failed} row(s) skipped (duplicate or error).`;
      toast({
        title: inserted ? 'Upload complete' : 'Upload had issues',
        description: desc,
        variant: inserted ? 'default' : 'destructive',
      });

      // Auto re-run match for all uploaded POs against existing invoices
      if (inserted > 0) {
        toast({ title: 'ðŸ”„ Running 3-way matchâ€¦', description: 'Matching invoices to new POs and GRNs.' });
        void handleRematchAll(rows.map(r => r.po_number));
      }
    } catch (err) {
      console.error('PO upload error:', err);
      toast({
        title: 'Upload failed',
        description: err instanceof Error ? err.message : 'Could not parse file.',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleRematchAll(poNumbers?: string[]) {
    setRematching(true);
    try {
      // Get all POs to rematch (specific list or all open POs)
      const company = await import('../../lib/ap-invoice/companyService').then(m => m.getMyCompany());
      let q = supabase.from('purchase_orders').select('id,po_number');
      if (company?.id) q = q.eq('company_id', company.id);
      if (poNumbers?.length) q = q.in('po_number', poNumbers);
      const { data: pos } = await q;
      if (!pos?.length) return;

      let matched = 0;
      for (const po of pos) {
        try {
          const results = await rerunAutoMatchForPo(po.id, po.po_number);
          matched += results.filter(r =>
            r.result.engine_status === 'full_match' ||
            r.result.engine_status === 'partial_match' ||
            r.result.within_tolerance
          ).length;
        } catch { /* skip errors per PO */ }
      }
      toast({
        title: 'âœ… Match complete',
        description: `${matched} invoice(s) matched. Go to Invoice List to see results.`,
      });
    } catch (e) {
      console.error('Rematch error:', e);
    } finally {
      setRematching(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!formData.po_number || !formData.vendor_name || !formData.po_date) {
      toast({
        title: 'Error',
        description: 'Please fill in PO Number, Vendor Name, and PO Date',
        variant: 'destructive',
      });
      return;
    }

    const totalFromLines = getLineItemsTotal();
    const amount = formData.po_amount ? Number(formData.po_amount) : totalFromLines;

    try {
      const companyId = await requireCompanyId();
      const payload: Record<string, unknown> = {
        company_id: companyId,
        po_number: formData.po_number.trim(),
        vendor_name: formData.vendor_name.trim(),
        po_amount: amount,
        po_date: formData.po_date,
        description: formData.description || null,
        status: formData.status,
        updated_at: new Date().toISOString(),
      };
      if (formData.delivery_date) payload.delivery_date = formData.delivery_date;
      if (formData.notes) payload.notes = formData.notes;
      const lineItemsPayload = lineItems.map(({ description, quantity, unit_price, total }) => ({
        description,
        quantity,
        unit_price,
        total,
      }));
      if (lineItemsPayload.some((r) => r.description || r.quantity > 0)) payload.line_items = lineItemsPayload;

      const { error } = await supabase.from('purchase_orders').insert(payload);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Purchase order created successfully',
      });

      setDialogOpen(false);
      setFormData({
        po_number: '',
        vendor_name: '',
        po_amount: '',
        po_date: '',
        delivery_date: '',
        description: '',
        notes: '',
        status: 'Open',
      });
      setLineItems([{ id: '1', description: '', quantity: 1, unit_price: 0, total: 0 }]);
      fetchPurchaseOrders();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create purchase order';
      console.error('Error creating purchase order:', err);
      toast({
        title: 'Error',
        description: String(message),
        variant: 'destructive',
      });
    }
  }

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-12rem)] items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading purchase orders...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Purchase Orders</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage purchase orders for 3-way matching
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={handlePOFileSelect}
          />
          {/* Single PDF scan input */}
          <input
            ref={pdfScanRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            className="hidden"
            onChange={handlePdfScan}
          />
          {/* Bulk PDF scan input */}
          <input
            ref={bulkScanRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            multiple
            className="hidden"
            onChange={handleBulkPdfScan}
          />
          <Button
            type="button"
            variant="outline"
            disabled={scanningPdf}
            onClick={() => pdfScanRef.current?.click()}
            className="border-purple-300 text-purple-700 hover:bg-purple-50"
          >
            <ScanLine className="mr-2 h-4 w-4" />
            {scanningPdf && !bulkScanProgress ? 'Extractingâ€¦' : 'Scan PO PDF'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={scanningPdf}
            onClick={() => bulkScanRef.current?.click()}
            className="border-indigo-300 text-indigo-700 hover:bg-indigo-50"
          >
            <ScanLine className="mr-2 h-4 w-4" />
            {bulkScanProgress
              ? `Scanning ${bulkScanProgress.done}/${bulkScanProgress.total}â€¦`
              : 'Bulk Scan POs'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mr-2 h-4 w-4" />
            {uploading ? 'Uploadingâ€¦' : 'Upload CSV/Excel'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={downloadPOTemplate}
            className="text-gray-600"
          >
            <FileDown className="mr-2 h-4 w-4" />
            Download template
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={rematching}
            onClick={() => void handleRematchAll()}
            className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${rematching ? 'animate-spin' : ''}`} />
            {rematching ? 'Matchingâ€¦' : 'Re-run All Matches'}
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[#0A4B8F]">
                <Plus className="mr-2 h-4 w-4" />
                Add Purchase Order
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create Purchase Order</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="po_number">PO Number *</Label>
                  <Input
                    id="po_number"
                    required
                    value={formData.po_number}
                    onChange={(e) =>
                      setFormData({ ...formData, po_number: e.target.value })
                    }
                    placeholder="PO-2025-001"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vendor_name">Vendor Name *</Label>
                  <Select
                    value={vendorNames.includes(formData.vendor_name) ? formData.vendor_name : '_other'}
                    onValueChange={(v) =>
                      setFormData({ ...formData, vendor_name: v === '_other' ? '' : v })
                    }
                  >
                    <SelectTrigger id="vendor_name">
                      <SelectValue placeholder="Select or type below" />
                    </SelectTrigger>
                    <SelectContent>
                      {vendorNames.map((name) => (
                        <SelectItem key={name} value={name}>{name}</SelectItem>
                      ))}
                      <SelectItem value="_other">Other (type below)</SelectItem>
                    </SelectContent>
                  </Select>
                  {!vendorNames.includes(formData.vendor_name) && (
                    <Input
                      placeholder="Enter vendor name"
                      value={formData.vendor_name}
                      onChange={(e) =>
                        setFormData({ ...formData, vendor_name: e.target.value })
                      }
                    />
                  )}
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="po_amount">Total Amount</Label>
                  <Input
                    id="po_amount"
                    type="number"
                    step="0.01"
                    value={formData.po_amount}
                    onChange={(e) =>
                      setFormData({ ...formData, po_amount: e.target.value })
                    }
                    placeholder={getLineItemsTotal() > 0 ? getLineItemsTotal().toFixed(2) : '0.00'}
                  />
                  {getLineItemsTotal() > 0 && (
                    <p className="text-xs text-gray-500">From line items: {getLineItemsTotal().toFixed(2)}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="po_date">PO Date *</Label>
                  <Input
                    id="po_date"
                    type="date"
                    required
                    value={formData.po_date}
                    onChange={(e) =>
                      setFormData({ ...formData, po_date: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="delivery_date">Delivery Date</Label>
                <Input
                  id="delivery_date"
                  type="date"
                  value={formData.delivery_date}
                  onChange={(e) =>
                    setFormData({ ...formData, delivery_date: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value: typeof formData.status) =>
                    setFormData({ ...formData, status: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Open">Open</SelectItem>
                    <SelectItem value="Partially Received">Partially Received</SelectItem>
                    <SelectItem value="Fully Received">Fully Received</SelectItem>
                    <SelectItem value="Closed">Closed</SelectItem>
                    <SelectItem value="Cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Line Items</Label>
                <div className="rounded-md border border-gray-200 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead className="w-20">Qty</TableHead>
                        <TableHead className="w-24">Unit Price</TableHead>
                        <TableHead className="w-24">Total</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lineItems.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="p-1">
                            <Input
                              className="h-8"
                              value={row.description}
                              onChange={(e) => updateLineItem(row.id, 'description', e.target.value)}
                              placeholder="Item description"
                            />
                          </TableCell>
                          <TableCell className="p-1">
                            <Input
                              type="number"
                              min={0}
                              className="h-8 w-20"
                              value={row.quantity || ''}
                              onChange={(e) => updateLineItem(row.id, 'quantity', Number(e.target.value) || 0)}
                            />
                          </TableCell>
                          <TableCell className="p-1">
                            <Input
                              type="number"
                              step="0.01"
                              min={0}
                              className="h-8 w-24"
                              value={row.unit_price || ''}
                              onChange={(e) => updateLineItem(row.id, 'unit_price', Number(e.target.value) || 0)}
                            />
                          </TableCell>
                          <TableCell className="p-1 text-sm">{row.total.toFixed(2)}</TableCell>
                          <TableCell className="p-1">
                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeLineItem(row.id)} disabled={lineItems.length <= 1}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addLineItem}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add line
                </Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  placeholder="Purchase order description..."
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Input
                  id="notes"
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  placeholder="Optional notes"
                />
              </div>
              <div className="flex justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" className="bg-[#0A4B8F]">
                  Save
                </Button>
              </div>
            </form>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search by PO number or vendor name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Purchase Orders Table */}
      <Card>
        <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>All Purchase Orders</CardTitle>
          {purchaseOrders.length > 0 && (
            <Button
              type="button"
              variant="outline"
              className="shrink-0 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
              onClick={() => setDeleteAllDialogOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete all purchase orders
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {filteredPOs.length === 0 ? (
            <div className="py-12 text-center">
              <ShoppingCart className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-4 text-gray-600">No purchase orders found</p>
              <p className="mt-2 text-sm text-gray-500">
                Upload a CSV/Excel file or add a purchase order manually to get started
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PO Number</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>PO Date</TableHead>
                    <TableHead>Delivery</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>GRN</TableHead>
                    <TableHead>Invoice match</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-[120px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPOs.map((po) => (
                    <TableRow key={po.id}>
                      <TableCell className="font-medium">{po.po_number}</TableCell>
                      <TableCell>{po.vendor_name}</TableCell>
                      <TableCell>
                        ${Number(po.po_amount).toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell>
                        {po.po_date ? format(new Date(po.po_date), 'MMM dd, yyyy') : 'â€”'}
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {po.delivery_date ? format(new Date(po.delivery_date), 'MMM dd, yyyy') : 'â€”'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusColors[po.status]}>
                          {po.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {poMeta[po.id]?.grn ? (
                          <span className="font-medium text-green-800">{poMeta[po.id].grn}</span>
                        ) : (
                          <span className="text-amber-700">Pending</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            poMeta[po.id]?.invLabel === 'Matched'
                              ? 'bg-green-50 text-green-800 border-green-200'
                              : poMeta[po.id]?.invLabel === 'Variance'
                                ? 'bg-amber-50 text-amber-900 border-amber-200'
                                : 'bg-gray-50 text-gray-600 border-gray-200'
                          }
                        >
                          {poMeta[po.id]?.invLabel ?? 'â€”'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-gray-500">
                        {format(new Date(po.created_at), 'MMM dd, yyyy')}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" className="h-8 text-xs" asChild>
                          <Link to={`/goods-receipts?poId=${po.id}`}>Create GRN</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={deleteAllDialogOpen} onOpenChange={setDeleteAllDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all purchase orders?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-left">
              <span className="block">
                This permanently removes <strong>all {purchaseOrders.length} purchase order{purchaseOrders.length === 1 ? '' : 's'}</strong> in the
                same scope as this list (your company workspace when company is set). Goods receipt rows linked to those POs may have their PO link
                cleared by the database instead of being deleted.
              </span>
              <span className="block text-red-700 font-medium">This cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingAll}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingAll}
              onClick={() => void handleDeleteAllPurchaseOrders()}
            >
              {deletingAll ? 'Deletingâ€¦' : 'Yes, delete all'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}


