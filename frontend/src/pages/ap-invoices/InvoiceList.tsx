import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, type Invoice } from '../../lib/ap-invoice/supabase';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Search, Download, Eye, Calendar, FileSpreadsheet, Trash2 } from 'lucide-react';
import { Checkbox } from '../../components/ui/checkbox';
import { format } from 'date-fns';
import { InvoiceDetailModal } from '../../components/ap-invoice/InvoiceDetailModal';
import { detectAnomalies } from '../../utils/anomalyDetection';
import { formatCurrency } from '../../utils/currency';
import { displayDate } from '../../utils/dateUtils';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import { useErpSettings, toTallySettings } from '../../hooks/useErpSettings';
import { downloadTallyXML } from '../../utils/tallyExport';
import { downloadQBIIF } from '../../utils/quickbooksExport';
import { downloadXeroCSV } from '../../utils/xeroExport';
import * as XLSX from 'xlsx';
import { fetchInvoiceById } from '../../lib/ap-invoice/invoices';
import { ConfidenceBadge } from '@/components/invoices/ConfidenceBadge';
import { getEffectiveExtractionScore, invoiceNeedsExtractionReview } from '../../utils/extractionConfidence';
import { runAutoMatch } from '../../lib/ap-invoice/threeWayMatchService';
import {
  deriveInvoiceRiskDisplayScore,
  invoiceHasRiskSignal,
  invoiceRiskTierForFilter,
} from '../../lib/ap-invoice/invoiceRiskDisplay';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import { useToast } from '../../hooks/use-toast';
import { getMyCompany, clearCompanyCache } from '../../lib/ap-invoice/companyService';
import { uploadInvoiceFile } from '../../lib/ap-invoice/invoiceStorageService';
import { CameraCapture } from '@/components/invoices/CameraCapture';
import { InvoiceExtractionPreviewModal } from '@/components/invoices/InvoiceExtractionPreviewModal';
import {
  extractInvoiceFromImageFile,
  normalizeExtractedInvoice,
  type NormalizedExtractedInvoice,
} from '../../lib/ap-invoice/cameraService';

const statusColors: Record<string, string> = {
  Processing: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  Approved: 'bg-green-100 text-green-800 border-green-200',
  Rejected: 'bg-red-100 text-red-800 border-red-200',
  Paid: 'bg-blue-100 text-blue-800 border-blue-200',
  'On Hold': 'bg-orange-100 text-orange-800 border-orange-200',
  Queried: 'bg-purple-100 text-purple-800 border-purple-200',
};

function sourceIntakeBadge(source: Invoice['source']) {
  const s = source ?? 'upload';
  const styles: Record<string, string> = {
    email: 'bg-blue-100 text-blue-800 border-blue-200',
    email_n8n: 'bg-sky-100 text-sky-900 border-sky-200',
    whatsapp: 'bg-emerald-100 text-emerald-900 border-emerald-200',
    camera: 'bg-amber-100 text-amber-950 border-amber-200',
    excel: 'bg-violet-100 text-violet-900 border-violet-200',
    excel_vba: 'bg-indigo-100 text-indigo-900 border-indigo-200',
    vendor_portal: 'bg-purple-100 text-purple-800 border-purple-200',
    manual: 'border-slate-200 bg-slate-50 text-slate-800',
    upload: 'bg-slate-100 text-slate-800 border-slate-200',
  };
  const labels: Record<string, string> = {
    email: 'ðŸ“§ Email',
    email_n8n: 'ðŸ“§ n8n email',
    whatsapp: 'ðŸ’¬ WhatsApp',
    camera: 'ðŸ“· Camera',
    excel: 'ðŸ“Š Excel',
    excel_vba: 'ðŸ“Š Excel VBA',
    vendor_portal: 'Portal',
    manual: 'Manual',
    upload: 'ðŸ“¤ Upload',
  };
  return (
    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${styles[s] ?? styles.upload}`}>
      {labels[s] ?? labels.upload}
    </Badge>
  );
}

function invoicePaymentPill(inv: Invoice): { label: string; title?: string; variant: 'paid' | 'overdue' | 'pending' } {
  const paid = inv.status === 'Paid' || inv.payment_status === 'paid';
  if (paid) {
    const m = inv.payment_method?.trim();
    const utr = (inv.utr_number ?? inv.payment_reference)?.trim();
    return {
      label: m ? `Paid â€” ${m}` : 'Paid',
      title: utr ? `UTR / Ref: ${utr}` : undefined,
      variant: 'paid',
    };
  }
  if (inv.payment_status === 'overdue') return { label: 'Overdue', variant: 'overdue' };
  const raw = inv.due_date;
  if (raw) {
    const due = new Date(raw);
    if (!Number.isNaN(due.getTime())) {
      const t0 = new Date();
      t0.setHours(0, 0, 0, 0);
      due.setHours(0, 0, 0, 0);
      if (due < t0) return { label: 'Overdue', variant: 'overdue' };
    }
  }
  return { label: 'Pending', variant: 'pending' };
}

export function InvoiceList() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { dateFormat } = useCompanySettings();
  const tallySettings = useErpSettings();
  const [showExport, setShowExport] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [filteredInvoices, setFilteredInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'all' | 'approvals' | 'duplicates' | 'needs_review'>('all');
  const [confidenceSort, setConfidenceSort] = useState<'none' | 'high_first' | 'low_first'>('none');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [ifrsFilter, setIfrsFilter] = useState<string>('all');
  const [matchStatusFilter, setMatchStatusFilter] = useState<string>('all');
  const [riskFilter, setRiskFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [sourceReceivedAtFilter, setSourceReceivedAtFilter] = useState<string | null>(null);
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  /** Matches DB: `purchase` (AP) / `sales` (AR). UI labels stay AP / AR. */
  const [invoiceKindFilter, setInvoiceKindFilter] = useState<'all' | 'purchase' | 'sales'>('all');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewNorm, setPreviewNorm] = useState<NormalizedExtractedInvoice | null>(null);
  const [previewConfidence, setPreviewConfidence] = useState<number | undefined>();
  const [savingExtract, setSavingExtract] = useState(false);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const itemsPerPage = 20;

  const STEPPER_LABELS = [
    'Uploaded',
    'AI Extracted',
    'IFRS Classify',
    '3-Way Match',
    'Risk Score',
    'Approval',
    'GL Coded',
    'Paid',
  ];

  function getCurrentStepperStep(invList: Invoice[]): number {
    if (invList.length === 0) return 1;
    if (invList.some((i) => !i.ifrs_category?.trim())) return 3;
    if (
      invList.some((i) => {
        if (i.match_status === 'three_way_matched') return false;
        const s = i.match_status;
        return !s || s === 'no_po' || s === 'partial' || s === 'mismatch' || s === 'matched';
      })
    )
      return 4;
    if (invList.some((i) => i.risk_score == null)) return 5;
    if (invList.some((i) => i.status === 'Processing')) return 6;
    if (invList.some((i) => !(i.gl_account_code ?? i.gl_code)?.trim())) return 7;
    return 8;
  }

  useEffect(() => {
    fetchInvoices();
    
    // Check for vendor filter in URL
    const urlParams = new URLSearchParams(window.location.search);
    const vendorFilter = urlParams.get('vendor');
    if (vendorFilter) {
      setSearchTerm(vendorFilter);
    }
    if (urlParams.get('filter') === 'duplicates') {
      setViewMode('duplicates');
    }
    if (urlParams.get('filter') === 'unclassified') {
      setIfrsFilter('not_classified');
    }
    if (
      urlParams.get('filter') === 'needs-review' ||
      urlParams.get('tab') === 'needs-review'
    ) {
      setViewMode('needs_review');
    }
    const receivedAt = urlParams.get('receivedAt');
    if (receivedAt) {
      setSourceReceivedAtFilter(decodeURIComponent(receivedAt));
      setSourceFilter('email');
    }
  }, []);

  useEffect(() => {
    filterInvoices();
  }, [
    invoices,
    searchTerm,
    statusFilter,
    startDate,
    endDate,
    viewMode,
    ifrsFilter,
    matchStatusFilter,
    riskFilter,
    confidenceSort,
    sourceFilter,
    sourceReceivedAtFilter,
    invoiceKindFilter,
  ]);

  /** IFRS dropdown only lists categories present on loaded invoices; reset stale values (e.g. after data refresh). */
  useEffect(() => {
    if (ifrsFilter === 'all' || ifrsFilter === 'not_classified') return;
    const categories = new Set(
      invoices.map((inv) => (inv.ifrs_category || '').trim()).filter(Boolean)
    );
    if (!categories.has(ifrsFilter)) {
      setIfrsFilter('all');
    }
  }, [invoices, ifrsFilter]);

  function clearInvoiceListFilters() {
    setSearchTerm('');
    setStatusFilter('all');
    setViewMode('all');
    setIfrsFilter('all');
    setMatchStatusFilter('all');
    setRiskFilter('all');
    setSourceFilter('all');
    setSourceReceivedAtFilter(null);
    setStartDate('');
    setEndDate('');
    setConfidenceSort('none');
    setInvoiceKindFilter('all');
    navigate('/invoices', { replace: true });
  }

  async function fetchInvoices() {
    try {
      clearCompanyCache();
      const company = await getMyCompany();
      let q = supabase.from('invoices').select('*').order('created_at', { ascending: false });
      if (company?.id) q = q.eq('company_id', company.id);
      const { data, error } = await q;

      if (error) throw error;
      const invoiceList = data || [];
      setInvoices(invoiceList);
      setSelectedInvoice((prev) => {
        if (!prev) return null;
        const next = invoiceList.find((i: Invoice) => i.id === prev.id);
        return next ?? prev;
      });

      // Backfill risk_score for invoices that have null (existing invoices)
      // Stop after first 400 so missing/wrong schema doesn't cause hundreds of errors
      const needsRiskCheck = invoiceList.filter((inv: Invoice) => inv.risk_score == null);
      if (needsRiskCheck.length > 0) {
        const otherInvoices = invoiceList.map((inv: Invoice) => ({
          invoice_number: inv.invoice_number,
          vendor_name: inv.vendor_name,
          total_amount: Number(inv.total_amount),
          invoice_date: inv.invoice_date,
          due_date: inv.due_date,
          vendor_email: inv.vendor_email ?? null,
        }));

        let backfillAborted = false;
        for (const inv of needsRiskCheck) {
          if (backfillAborted) break;
          try {
            const existing = otherInvoices.filter((o: { invoice_number: string }) => o.invoice_number !== inv.invoice_number);
            const result = await detectAnomalies(
              {
                invoice_number: inv.invoice_number,
                invoice_date: inv.invoice_date,
                due_date: inv.due_date,
                vendor_name: inv.vendor_name,
                vendor_email: inv.vendor_email ?? null,
                total_amount: Number(inv.total_amount),
              },
              existing
            );
            const { error } = await supabase
              .from('invoices')
              .update({ risk_score: result.risk_score, risk_flags: Array.isArray(result.risk_flags) ? result.risk_flags : [], updated_at: new Date().toISOString() })
              .eq('id', inv.id);
            if (error) {
              if (error.code === 'PGRST301' || error.message?.includes('400') || (error as { status?: number }).status === 400) {
                console.warn('Risk backfill stopped: schema may be missing risk_score/risk_flags. Run FIX-IFRS-AND-RISK-SCHEMA.sql in Supabase SQL Editor.', error);
                backfillAborted = true;
              } else {
                console.warn('Failed to backfill risk for invoice', inv.invoice_number, error);
              }
              continue;
            }
            setInvoices((prev) =>
              prev.map((i) => (i.id === inv.id ? { ...i, risk_score: result.risk_score, risk_flags: result.risk_flags } : i))
            );
          } catch (e) {
            console.warn('Failed to backfill risk for invoice', inv.invoice_number, e);
            backfillAborted = true;
          }
        }
      }

      // Auto-link PO + run 3-way match when invoice already has a PO number but no po_id (e.g. OCR PO, email ingest, or case mismatch)
      const needPoAutoLink = invoiceList.filter(
        (inv: Invoice) => String(inv.po_number || '').trim() !== '' && !inv.po_id
      );
      if (needPoAutoLink.length > 0) {
        let anyUpdated = false;
        for (const inv of needPoAutoLink.slice(0, 60)) {
          try {
            await runAutoMatch(inv.id, { respectUploadSetting: false });
            anyUpdated = true;
          } catch (e) {
            console.warn('Auto PO link / 3-way match failed for', inv.invoice_number, e);
          }
        }
        if (anyUpdated) {
          const refreshCompany = await getMyCompany();
          let rq = supabase.from('invoices').select('*').order('created_at', { ascending: false });
          if (refreshCompany?.id) rq = rq.eq('company_id', refreshCompany.id);
          const { data: refreshed } = await rq;
          if (refreshed) {
            setInvoices(refreshed);
            setSelectedInvoice((prev) => {
              if (!prev) return null;
              const next = refreshed.find((i: Invoice) => i.id === prev.id);
              return next ?? prev;
            });
          }
        }
      }
    } catch (error) {
      console.error('Error fetching invoices:', error);
    } finally {
      setLoading(false);
    }
  }

  function filterInvoices() {
    let filtered = invoices;

    // Filter by view mode (All vs Approvals)
    if (viewMode === 'approvals') {
      filtered = filtered.filter(
        (inv) =>
          inv.approval_level &&
          inv.approval_level !== 'none' &&
          !inv.approved_by &&
          inv.status === 'Processing'
      );
    } else if (viewMode === 'duplicates') {
      filtered = filtered.filter((inv) => inv.duplicate_flag === true);
    } else if (viewMode === 'needs_review') {
      filtered = filtered.filter((inv) => invoiceNeedsExtractionReview(inv));
    }

    if (searchTerm) {
      filtered = filtered.filter(
        (inv) =>
          inv.invoice_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
          inv.vendor_name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter((inv) => inv.status === statusFilter);
    }

    if (startDate) {
      filtered = filtered.filter(
        (inv) => new Date(inv.invoice_date) >= new Date(startDate)
      );
    }

    if (endDate) {
      filtered = filtered.filter(
        (inv) => new Date(inv.invoice_date) <= new Date(endDate)
      );
    }

    if (ifrsFilter === 'not_classified') {
      filtered = filtered.filter((inv) => !inv.ifrs_category || String(inv.ifrs_category).trim() === '');
    } else if (ifrsFilter !== 'all') {
      filtered = filtered.filter((inv) => (inv.ifrs_category || '').trim() === ifrsFilter);
    }

    if (matchStatusFilter === 'match_issues') {
      filtered = filtered.filter(
        (inv) => inv.match_status === 'mismatch' || inv.match_status === 'no_po'
      );
    } else if (matchStatusFilter !== 'all') {
      filtered = filtered.filter((inv) => (inv.match_status || '') === matchStatusFilter);
    }

    if (riskFilter !== 'all') {
      filtered = filtered.filter((inv) => invoiceRiskTierForFilter(inv) === riskFilter);
    }

    if (sourceFilter !== 'all') {
      filtered = filtered.filter((inv) => (inv.source || 'upload') === sourceFilter);
    }

    if (sourceReceivedAtFilter) {
      const target = new Date(sourceReceivedAtFilter).getTime();
      filtered = filtered.filter((inv) => {
        if (!inv.source_email_received_at) return false;
        return new Date(inv.source_email_received_at).getTime() === target;
      });
    }

    if (invoiceKindFilter === 'purchase') {
      filtered = filtered.filter((inv) => inv.invoice_type !== 'sales');
    } else if (invoiceKindFilter === 'sales') {
      filtered = filtered.filter((inv) => inv.invoice_type === 'sales');
    }

    let out = filtered;
    if (confidenceSort === 'high_first') {
      out = [...out].sort(
        (a, b) => getEffectiveExtractionScore(b) - getEffectiveExtractionScore(a)
      );
    } else if (confidenceSort === 'low_first') {
      out = [...out].sort(
        (a, b) => getEffectiveExtractionScore(a) - getEffectiveExtractionScore(b)
      );
    }

    setFilteredInvoices(out);
    setCurrentPage(1);
  }

  function toggleSelectAll() {
    if (selectedIds.length === paginatedInvoices.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(paginatedInvoices.map((inv) => inv.id));
    }
  }

  function toggleSelectInvoice(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  }

  async function handleDeleteAllInvoices() {
    if (invoices.length === 0) return;
    setDeletingAll(true);
    try {
      const delCompany = await getMyCompany();
      let dq = supabase.from('invoices').delete();
      if (delCompany?.id) {
        dq = dq.eq('company_id', delCompany.id);
      } else {
        dq = dq.gte('created_at', '1970-01-01T00:00:00.000Z');
      }
      const { error } = await dq;

      if (error) throw error;

      setInvoices([]);
      setFilteredInvoices([]);
      setSelectedIds([]);
      setSelectedInvoice(null);
      setDeleteAllDialogOpen(false);
      toast({
        title: 'Invoices removed',
        description: `Deleted ${invoices.length} invoice${invoices.length === 1 ? '' : 's'}.`,
      });
    } catch (err) {
      console.error('Delete all invoices failed:', err);
      toast({
        title: 'Could not delete all',
        description: err instanceof Error ? err.message : 'Check permissions and try again.',
        variant: 'destructive',
      });
    } finally {
      setDeletingAll(false);
    }
  }

  async function handleCameraFileConfirmed(file: File) {
    setCapturedFile(file);
    try {
      const res = await extractInvoiceFromImageFile(file);
      const n = normalizeExtractedInvoice(res.invoice);
      setPreviewNorm({
        ...n,
        invoice_kind: invoiceKindFilter === 'sales' ? 'sales' : n.invoice_kind,
      });
      setPreviewConfidence(res.confidence);
      setPreviewOpen(true);
    } catch (err) {
      console.error(err);
      toast({
        title: 'Could not extract invoice',
        description:
          err instanceof Error
            ? err.message
            : 'Ensure the FastAPI agent is running (e.g. port 8000) and ANTHROPIC_API_KEY is set.',
        variant: 'destructive',
      });
    }
  }

  async function handleSaveExtractedPreview(values: NormalizedExtractedInvoice) {
    setSavingExtract(true);
    try {
      const company = await getMyCompany();
      const invKind: 'purchase' | 'sales' = values.invoice_kind;
      const row = {
        invoice_number: values.invoice_number.trim(),
        invoice_date: values.invoice_date.slice(0, 10),
        due_date: values.due_date.slice(0, 10),
        vendor_name: values.vendor_name.trim() || 'Unknown',
        vendor_email: null,
        vendor_phone: null,
        vendor_address: null,
        customer_name: values.customer_name.trim() || null,
        customer_gstin: values.customer_gstin.trim() || null,
        total_amount: values.total_amount,
        currency: values.currency || 'INR',
        gstin: values.gstin.trim() || null,
        tax_amount: values.tax_amount,
        status: 'Processing' as const,
        source: 'camera' as const,
        invoice_type: invKind,
        ar_due_date: invKind === 'sales' ? values.due_date.slice(0, 10) : null,
        payment_received: false,
        company_id: company?.id ?? null,
        file_type: capturedFile?.type || 'camera-capture',
        file_url: capturedFile ? await uploadInvoiceFile(capturedFile, 'camera').then((r) => r.url).catch(() => null) : null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('invoices').insert(row);
      if (error) throw error;
      toast({ title: 'Invoice saved', description: values.invoice_number });
      setPreviewOpen(false);
      setPreviewNorm(null);
      await fetchInvoices();
    } catch (err) {
      console.error(err);
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setSavingExtract(false);
    }
  }

  async function exportExcel(invList: Invoice[]) {
    // Sheet 1 â€” Invoices summary
    const headers = [
      'Invoice #', 'Vendor', 'Date', 'Due Date', 'Amount', 'Currency', 'Status',
      'GL Code', 'GL Name', 'IFRS Category', 'Tax Type', 'Tax Amount',
      'Department', 'Cost Center', 'Project Code', 'Match Status', 'Risk Score',
      'Approval Level', 'Approved By', 'Payment Status',
    ];
    const rows = invList.map((inv) => [
      inv.invoice_number,
      inv.vendor_name,
      displayDate(inv.invoice_date, dateFormat),
      displayDate(inv.due_date, dateFormat),
      inv.total_amount,
      inv.currency,
      inv.status,
      inv.gl_code || inv.gl_account_code || '',
      inv.gl_name || inv.gl_account_name || '',
      inv.ifrs_category || '',
      inv.tax_type || '',
      inv.tax_amount || 0,
      inv.department || '',
      inv.cost_center || '',
      inv.project_code || '',
      inv.match_status || '',
      inv.risk_score || '',
      inv.approval_level || '',
      inv.approved_by || '',
      inv.payment_status || '',
    ]);
    const ws1 = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    // Auto-width columns
    ws1['!cols'] = headers.map((h, i) => ({
      wch: Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length), 12),
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, 'Invoices');

    // Sheet 2 â€” Line Items (fetch from DB for selected invoices)
    try {
      const invIds = invList.map((i) => i.id);
      const { data: lineItemRows } = await supabase
        .from('invoice_line_items')
        .select('*')
        .in('invoice_id', invIds)
        .order('invoice_id')
        .order('sort_order');

      if (lineItemRows && lineItemRows.length > 0) {
        const invMap = new Map(invList.map((i) => [i.id, i]));
        const liHeaders = ['Invoice #', 'Vendor', 'Description', 'Quantity', 'Unit Price', 'Total', 'GL Code'];
        const liRows = lineItemRows.map((li) => {
          const inv = invMap.get(li.invoice_id);
          return [
            inv?.invoice_number ?? '',
            inv?.vendor_name ?? '',
            li.description ?? '',
            li.quantity ?? '',
            li.unit_price ?? '',
            li.total ?? '',
            li.gl_code ?? '',
          ];
        });
        const ws2 = XLSX.utils.aoa_to_sheet([liHeaders, ...liRows]);
        ws2['!cols'] = liHeaders.map((h, i) => ({
          wch: Math.max(h.length, ...liRows.map((r) => String(r[i] ?? '').length), 12),
        }));
        XLSX.utils.book_append_sheet(wb, ws2, 'Line Items');
      }
    } catch (e) {
      console.warn('Could not fetch line items for export:', e);
    }

    XLSX.writeFile(wb, `InvoiceFlow-Export-${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  }

  function exportZohoCSV(invList: Invoice[]) {
    const headers = 'Vendor Name,Invoice Number,Invoice Date,Due Date,Total,Currency,Status,GL Code,Description';
    const rows = invList.map((inv) =>
      [inv.vendor_name, inv.invoice_number, inv.invoice_date, inv.due_date, inv.total_amount, inv.currency, inv.status, inv.gl_code || '', (inv.ifrs_category as string) || '']
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    const blob = new Blob([headers + '\n' + rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zoho_invoices_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportSAPCSV(invList: Invoice[]) {
    const headers = 'Vendor,Document,Posting Date,Due Date,Amount,Currency,Cost Center,GL Account';
    const rows = invList.map((inv) =>
      [inv.vendor_name, inv.invoice_number, inv.invoice_date, inv.due_date, inv.total_amount, inv.currency, inv.cost_center || '', inv.gl_code || '']
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    const blob = new Blob([headers + '\n' + rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sap_invoices_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalPages = Math.ceil(filteredInvoices.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedInvoices = filteredInvoices.slice(
    startIndex,
    startIndex + itemsPerPage
  );

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-12rem)] items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading invoices...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Invoice List</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage and review all invoices
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedIds.length > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                const selected = filteredInvoices.filter((inv) => selectedIds.includes(inv.id));
                void exportExcel(selected);
              }}
            >
              <Download className="mr-2 h-4 w-4" />
              Export Selected ({selectedIds.length})
            </Button>
          )}
          <div className="relative">
            <Button
              onClick={() => setShowExport(!showExport)}
              className="bg-[#0A4B8F] hover:bg-[#0D6EFD]"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export â–¾
            </Button>
            {showExport && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowExport(false)} aria-hidden />
                <div className="absolute right-0 top-full mt-1 z-50 min-w-[220px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  {[
                    { icon: 'ðŸ“Š', label: 'Tally XML', fn: () => downloadTallyXML(filteredInvoices, toTallySettings(tallySettings)) },
                    { icon: 'ðŸŸ¢', label: 'QuickBooks IIF', fn: () => downloadQBIIF(filteredInvoices) },
                    { icon: 'âš«', label: 'Xero CSV', fn: () => downloadXeroCSV(filteredInvoices) },
                    { icon: 'ðŸ“˜', label: 'Zoho Books CSV', fn: () => exportZohoCSV(filteredInvoices) },
                    { icon: 'ðŸ”·', label: 'SAP CSV', fn: () => exportSAPCSV(filteredInvoices) },
                    { icon: 'ðŸ“¥', label: 'Excel (Generic)', fn: () => void exportExcel(filteredInvoices) },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => {
                        item.fn();
                        setShowExport(false);
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium hover:bg-gray-100"
                    >
                      {item.icon} {item.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* AP Process Stepper */}
      <Card className="border border-gray-200">
        <CardContent className="pt-6 pb-6">
          <div className="flex items-center justify-between gap-1 overflow-x-auto">
            {STEPPER_LABELS.map((label, index) => {
              const step = index + 1;
              const currentStep = getCurrentStepperStep(filteredInvoices);
              const isCompleted = step < currentStep;
              const isCurrent = step === currentStep;
              return (
                <div key={label} className="flex flex-1 min-w-0 items-center">
                  <div className="flex flex-col items-center flex-1 min-w-0">
                    <div
                      className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0 ${
                        isCompleted
                          ? 'bg-green-500 text-white'
                          : isCurrent
                            ? 'bg-[#1a56db] text-white'
                            : 'bg-gray-200 text-gray-500'
                      }`}
                    >
                      {step}
                    </div>
                    <span className={`mt-1 text-xs truncate w-full text-center ${isCurrent ? 'text-[#1a56db] font-medium' : 'text-gray-600'}`}>
                      {label}
                    </span>
                  </div>
                  {index < STEPPER_LABELS.length - 1 && (
                    <div
                      className={`flex-1 h-0.5 mx-0.5 min-w-[8px] ${
                        step < currentStep ? 'bg-green-500' : 'bg-gray-200'
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 border-b border-gray-100 pb-4">
              <Button
                type="button"
                size="sm"
                variant={viewMode === 'all' ? 'default' : 'outline'}
                className={viewMode === 'all' ? 'bg-[#0A4B8F]' : ''}
                onClick={() => {
                  setViewMode('all');
                  navigate('/invoices', { replace: true });
                }}
              >
                All
              </Button>
              <Button
                type="button"
                size="sm"
                variant={viewMode === 'approvals' ? 'default' : 'outline'}
                className={viewMode === 'approvals' ? 'bg-[#0A4B8F]' : ''}
                onClick={() => {
                  setViewMode('approvals');
                  navigate('/invoices', { replace: true });
                }}
              >
                Approval queue
              </Button>
              <Button
                type="button"
                size="sm"
                variant={viewMode === 'duplicates' ? 'default' : 'outline'}
                className={viewMode === 'duplicates' ? 'bg-amber-700 hover:bg-amber-800' : ''}
                onClick={() => {
                  setViewMode('duplicates');
                  navigate('/invoices?filter=duplicates', { replace: true });
                }}
              >
                Duplicates
              </Button>
              <Button
                type="button"
                size="sm"
                variant={viewMode === 'needs_review' ? 'default' : 'outline'}
                className={
                  viewMode === 'needs_review'
                    ? 'bg-amber-600 hover:bg-amber-700 text-white border-amber-600'
                    : ''
                }
                onClick={() => {
                  setViewMode('needs_review');
                  navigate('/invoices?tab=needs-review', { replace: true });
                }}
              >
                Needs review
              </Button>
              <span className="mx-1 hidden sm:inline text-gray-300">|</span>
              <Button
                type="button"
                size="sm"
                variant={invoiceKindFilter === 'all' ? 'default' : 'outline'}
                className={invoiceKindFilter === 'all' ? 'bg-slate-700' : ''}
                onClick={() => setInvoiceKindFilter('all')}
              >
                All types
              </Button>
              <Button
                type="button"
                size="sm"
                variant={invoiceKindFilter === 'purchase' ? 'default' : 'outline'}
                className={invoiceKindFilter === 'purchase' ? 'bg-[#0A4B8F]' : ''}
                title="Accounts payable (vendor bills)"
                onClick={() => setInvoiceKindFilter('purchase')}
              >
                AP
              </Button>
              <Button
                type="button"
                size="sm"
                variant={invoiceKindFilter === 'sales' ? 'default' : 'outline'}
                className={invoiceKindFilter === 'sales' ? 'bg-teal-700 hover:bg-teal-800' : ''}
                title="Accounts receivable (customer bills)"
                onClick={() => setInvoiceKindFilter('sales')}
              >
                AR
              </Button>
            </div>
            <div className="flex flex-col gap-4 md:flex-row flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  placeholder="Search by invoice # or vendor name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full md:w-[160px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="Processing">Processing</SelectItem>
                  <SelectItem value="Approved">Approved</SelectItem>
                  <SelectItem value="Rejected">Rejected</SelectItem>
                  <SelectItem value="Paid">Paid</SelectItem>
                </SelectContent>
              </Select>
              <Select value={ifrsFilter} onValueChange={setIfrsFilter}>
                <SelectTrigger className="w-full md:w-[200px]">
                  <SelectValue placeholder="IFRS Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All IFRS</SelectItem>
                  <SelectItem value="not_classified">Not Classified</SelectItem>
                  {Array.from(new Set(invoices.map((inv) => (inv.ifrs_category || '').trim()).filter(Boolean))).sort().map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={matchStatusFilter} onValueChange={setMatchStatusFilter}>
                <SelectTrigger className="w-full md:w-[160px]">
                  <SelectValue placeholder="Match" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Match Status</SelectItem>
                  <SelectItem value="three_way_matched">âœ… 3-Way Matched</SelectItem>
                  <SelectItem value="matched">âœ… PO Matched</SelectItem>
                  <SelectItem value="partial">âš ï¸ Partial</SelectItem>
                  <SelectItem value="mismatch">âŒ Mismatch</SelectItem>
                  <SelectItem value="no_po">â€” No PO</SelectItem>
                  <SelectItem value="match_issues">âš ï¸ Match exceptions</SelectItem>
                </SelectContent>
              </Select>
              <Select value={riskFilter} onValueChange={setRiskFilter}>
                <SelectTrigger className="w-full md:w-[120px]">
                  <SelectValue placeholder="Risk" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Risk</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={sourceFilter}
                onValueChange={(v) => {
                  setSourceFilter(v);
                  if (sourceReceivedAtFilter) {
                    setSourceReceivedAtFilter(null);
                    navigate('/invoices', { replace: true });
                  }
                }}
              >
                <SelectTrigger className="w-full md:w-[140px]">
                  <SelectValue placeholder="Source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  <SelectItem value="upload">Upload</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="email_n8n">Email (n8n)</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="camera">Camera</SelectItem>
                  <SelectItem value="excel">Excel</SelectItem>
                  <SelectItem value="excel_vba">Excel (VBA)</SelectItem>
                  <SelectItem value="vendor_portal">Portal</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {sourceReceivedAtFilter && (
              <p className="text-xs text-muted-foreground">
                Filtered by email intake time.{' '}
                <button
                  type="button"
                  className="text-[#0A4B8F] underline font-medium"
                  onClick={() => {
                    setSourceReceivedAtFilter(null);
                    setSourceFilter('all');
                    navigate('/invoices', { replace: true });
                  }}
                >
                  Clear
                </button>
              </p>
            )}
            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-gray-500" />
                <span className="text-sm text-gray-700 font-medium">Date Range:</span>
              </div>
              <div className="flex flex-1 gap-4">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-gray-600">From</Label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-gray-600">To</Label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
                {(startDate || endDate) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setStartDate('');
                      setEndDate('');
                    }}
                    className="self-end"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Invoice Table */}
      <Card>
        <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>
            {filteredInvoices.length} Invoice{filteredInvoices.length !== 1 ? 's' : ''}
          </CardTitle>
          {invoices.length > 0 && (
            <Button
              type="button"
              variant="outline"
              className="shrink-0 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
              onClick={() => setDeleteAllDialogOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete all invoices
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">
                    <Checkbox
                      checked={
                        paginatedInvoices.length > 0 &&
                        selectedIds.length === paginatedInvoices.length
                      }
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>IFRS Category</TableHead>
                  <TableHead className="hidden lg:table-cell">
                    <button
                      type="button"
                      className="flex items-center gap-1 text-left font-medium hover:text-primary"
                      onClick={() =>
                        setConfidenceSort((prev) =>
                          prev === 'none' ? 'high_first' : prev === 'high_first' ? 'low_first' : 'none'
                        )
                      }
                    >
                      Confidence
                      <span className="text-muted-foreground text-xs font-normal">
                        {confidenceSort === 'high_first'
                          ? 'â†“'
                          : confidenceSort === 'low_first'
                            ? 'â†‘'
                            : ''}
                      </span>
                    </button>
                  </TableHead>
                  <TableHead>3-Way Match</TableHead>
                  <TableHead>GL Account</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedInvoices.map((invoice) => (
                  <TableRow
                    key={invoice.id}
                    className="hover:bg-gray-50"
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.includes(invoice.id)}
                        onCheckedChange={() => toggleSelectInvoice(invoice.id)}
                      />
                    </TableCell>
                    <TableCell
                      className="font-medium cursor-pointer"
                      onClick={() => setSelectedInvoice(invoice)}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        {invoice.invoice_number}
                        {sourceIntakeBadge(invoice.source)}
                        {invoice.invoice_type === 'sales' && (
                          <Badge className="border-teal-200 bg-teal-50 text-teal-900 text-[10px] px-1.5 py-0">AR</Badge>
                        )}
                        {invoice.ifrs_category && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                            {invoice.ifrs_category}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell
                      className="cursor-pointer"
                      onClick={() => setSelectedInvoice(invoice)}
                    >
                      {invoice.vendor_name}
                    </TableCell>
                    <TableCell
                      className="cursor-pointer"
                      onClick={() => setSelectedInvoice(invoice)}
                    >
                      <span className="font-bold">
                        {formatCurrency(Number(invoice.total_amount), invoice.currency || 'INR')}
                      </span>
                      <br />
                      <span className="text-[11px] text-gray-500">{invoice.currency}</span>
                    </TableCell>
                    <TableCell
                      className="cursor-pointer"
                      onClick={() => setSelectedInvoice(invoice)}
                    >
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant="outline" className={statusColors[invoice.status]}>
                          {invoice.status}
                        </Badge>
                        {invoice.duplicate_flag === true && (
                          <Badge
                            variant="outline"
                            className="border-amber-300 bg-amber-50 text-amber-900 text-[10px] px-1.5 py-0 font-medium"
                          >
                            Possible duplicate
                          </Badge>
                        )}
                        {invoice.tally_synced === true && (
                          <Badge
                            variant="outline"
                            className="border-green-300 bg-green-50 text-green-800 text-[10px] px-1.5 py-0 font-medium"
                          >
                            Tally âœ“
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell
                      className="cursor-pointer"
                      onClick={() => setSelectedInvoice(invoice)}
                    >
                      {(() => {
                        const p = invoicePaymentPill(invoice);
                        const cls =
                          p.variant === 'paid'
                            ? 'bg-sky-50 text-sky-900 border-sky-200'
                            : p.variant === 'overdue'
                              ? 'bg-red-50 text-red-900 border-red-200'
                              : 'bg-slate-50 text-slate-700 border-slate-200';
                        return (
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-medium ${cls}`} title={p.title}>
                            {p.label}
                          </Badge>
                        );
                      })()}
                    </TableCell>
                    <TableCell
                      className="cursor-pointer"
                      onClick={() => setSelectedInvoice(invoice)}
                    >
                      {invoice.ifrs_category ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          <span style={{ fontSize: '12px', fontWeight: '600', color: '#1a56db' }}>
                            {invoice.ifrs_category}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <div
                              style={{
                                width: '50px',
                                height: '4px',
                                background: '#e5e7eb',
                                borderRadius: '2px',
                                overflow: 'hidden',
                              }}
                            >
                              <div
                                style={{
                                  width: `${Math.min(100, Math.max(0, Number(invoice.ifrs_confidence ?? 0)))}%`,
                                  height: '100%',
                                  background: '#1a56db',
                                  borderRadius: '2px',
                                }}
                              />
                            </div>
                            <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                              {Number(invoice.ifrs_confidence ?? 0)}%
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <span style={{ color: '#f97316', fontWeight: '600', fontSize: '12px' }}>
                            âš  Not Classified
                          </span>
                          <br />
                          <span style={{ color: '#9ca3af', fontSize: '11px' }}>Fix required</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell
                      className="hidden lg:table-cell cursor-pointer align-middle"
                      onClick={() => setSelectedInvoice(invoice)}
                    >
                      <ConfidenceBadge score={getEffectiveExtractionScore(invoice)} size="sm" />
                    </TableCell>
                    <TableCell
                      className="cursor-pointer"
                      onClick={() => setSelectedInvoice(invoice)}
                    >
                      {invoice.match_status === 'three_way_matched' && (
                        <span style={{ color: '#0e9f6e', fontWeight: '700', fontSize: '12px' }}>âœ… 3-Way Matched</span>
                      )}
                      {invoice.match_status === 'matched' && (
                        <span style={{ color: '#1d4ed8', fontWeight: '700', fontSize: '12px' }}>âœ… PO Matched</span>
                      )}
                      {invoice.match_status === 'partial' && (
                        <div>
                          <span style={{ color: '#d97706', fontWeight: '700', fontSize: '12px' }}>âš ï¸ Partial</span>
                          <br />
                          <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                            {formatCurrency(Number(invoice.match_difference ?? 0), invoice.currency || 'INR')} diff
                          </span>
                        </div>
                      )}
                      {invoice.match_status === 'mismatch' && (
                        <span style={{ color: '#e02424', fontWeight: '700', fontSize: '12px' }}>âŒ Mismatch</span>
                      )}
                      {(!invoice.match_status || invoice.match_status === 'no_po') && (
                        <span style={{ color: '#9ca3af', fontSize: '12px' }}>â€” No PO</span>
                      )}
                    </TableCell>
                    <TableCell
                      className="cursor-pointer"
                      onClick={() => setSelectedInvoice(invoice)}
                    >
                      {(invoice.gl_account_code ?? invoice.gl_code) ? (
                        <div>
                          <span
                            style={{
                              fontFamily: 'monospace',
                              fontWeight: '700',
                              color: '#1a56db',
                              fontSize: '13px',
                            }}
                          >
                            {invoice.gl_account_code ?? invoice.gl_code}
                          </span>
                          <br />
                          <span style={{ fontSize: '11px', color: '#6b7280' }}>
                            {invoice.gl_account_name ?? invoice.gl_name ?? ''}
                          </span>
                          <br />
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 600,
                              color: invoice.gl_source === 'company_coa' ? '#0e9f6e' : '#6b7280',
                            }}
                          >
                            {invoice.gl_source === 'company_coa' ? 'ðŸ¢ Your COA' : 'ðŸ¤– IFRS Auto'}
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>â€”</span>
                      )}
                    </TableCell>
                    <TableCell
                      className="cursor-pointer"
                      onClick={() => setSelectedInvoice(invoice)}
                    >
                      {!invoiceHasRiskSignal(invoice) ? (
                        <span className="text-sm text-gray-400">â€”</span>
                      ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            fontSize: '12px',
                            fontWeight: 700,
                            padding: '3px 10px',
                            borderRadius: '6px',
                            width: 'fit-content',
                            background:
                              (invoice.risk_level ?? invoice.risk_score) === 'High' || invoice.risk_score === 'high'
                                ? '#fee2e2'
                                : (invoice.risk_level ?? invoice.risk_score) === 'Medium' || invoice.risk_score === 'medium'
                                ? '#fef3c7'
                                : '#f0fdf4',
                            color:
                              (invoice.risk_level ?? invoice.risk_score) === 'High' || invoice.risk_score === 'high'
                                ? '#991b1b'
                                : (invoice.risk_level ?? invoice.risk_score) === 'Medium' || invoice.risk_score === 'medium'
                                ? '#92400e'
                                : '#166534',
                            border:
                              (invoice.risk_level ?? invoice.risk_score) === 'High' || invoice.risk_score === 'high'
                                ? '1px solid #fca5a5'
                                : (invoice.risk_level ?? invoice.risk_score) === 'Medium' || invoice.risk_score === 'medium'
                                ? '1px solid #fde68a'
                                : '1px solid #bbf7d0',
                          }}
                        >
                          {(invoice.risk_level ?? invoice.risk_score) === 'High' || invoice.risk_score === 'high'
                            ? 'ðŸ”´'
                            : (invoice.risk_level ?? invoice.risk_score) === 'Medium' || invoice.risk_score === 'medium'
                            ? 'ðŸŸ¡'
                            : 'ðŸŸ¢'}
                          {invoice.risk_level ??
                            (invoice.risk_score === 'high'
                              ? 'High'
                              : invoice.risk_score === 'medium'
                              ? 'Medium'
                              : invoice.risk_score === 'low'
                              ? 'Low'
                              : 'Low')}
                        </span>
                        {((invoice as { risk_flag_count?: number }).risk_flag_count ?? 0) > 0 ||
                        (typeof invoice.risk_score === 'number' && invoice.risk_score > 0) ||
                        deriveInvoiceRiskDisplayScore(invoice) != null ? (
                          <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                            {(invoice as { risk_flag_count?: number }).risk_flag_count
                              ? `${(invoice as { risk_flag_count?: number }).risk_flag_count} flag${((invoice as { risk_flag_count?: number }).risk_flag_count ?? 0) > 1 ? 's' : ''} Â· `
                              : ''}
                            Score:{' '}
                            {typeof invoice.risk_score === 'number' && invoice.risk_score > 0
                              ? invoice.risk_score
                              : (deriveInvoiceRiskDisplayScore(invoice) ?? 'â€”')}
                          </span>
                        ) : null}
                      </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedInvoice(invoice);
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {filteredInvoices.length === 0 && (
            <div className="py-12 text-center text-gray-600 space-y-3">
              <p className="font-medium text-gray-800">No invoices match the current filters.</p>
              {invoices.length > 0 && (
                <>
                  <p className="text-sm max-w-md mx-auto">
                    You have {invoices.length} invoice{invoices.length === 1 ? '' : 's'} loaded. Try setting IFRS filter to{' '}
                    <strong>All IFRS</strong> or <strong>Not Classified</strong>, clear the date range, and set Status to{' '}
                    <strong>All Statuses</strong> if the table looks empty.
                  </p>
                  <Button type="button" variant="secondary" size="sm" onClick={clearInvoiceListFilters}>
                    Clear all list filters
                  </Button>
                </>
              )}
              {invoices.length === 0 && <p className="text-sm">No invoices in the workspace yet.</p>}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between">
              <p className="text-sm text-gray-600">
                Showing {startIndex + 1} to{' '}
                {Math.min(startIndex + itemsPerPage, filteredInvoices.length)} of{' '}
                {filteredInvoices.length} invoices
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invoice Detail Modal */}
      {selectedInvoice && (
        <InvoiceDetailModal
          invoice={selectedInvoice}
          open={!!selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          onUpdate={fetchInvoices}
          onNavigateInvoice={async (id) => {
            const inv = await fetchInvoiceById(id);
            if (inv) setSelectedInvoice(inv);
          }}
        />
      )}

      <CameraCapture
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onConfirm={(file) => void handleCameraFileConfirmed(file)}
      />
      <InvoiceExtractionPreviewModal
        open={previewOpen}
        onOpenChange={(o) => {
          setPreviewOpen(o);
          if (!o) setPreviewNorm(null);
        }}
        initial={previewNorm}
        confidence={previewConfidence}
        saving={savingExtract}
        onSave={(vals) => void handleSaveExtractedPreview(vals)}
      />

      <AlertDialog open={deleteAllDialogOpen} onOpenChange={setDeleteAllDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all invoices?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-left">
              <span className="block">
                This permanently removes <strong>all {invoices.length} invoice{invoices.length === 1 ? '' : 's'}</strong>{' '}
                you can access in this workspace (not only the rows visible with current filters). Line items and other
                records tied with cascade rules in your database will be removed with them.
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
              onClick={() => void handleDeleteAllInvoices()}
            >
              {deletingAll ? 'Deletingâ€¦' : 'Yes, delete all'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

