import { useEffect, useState, useMemo, useRef } from 'react';
import { useMarket } from '../../contexts/MarketContext';
import { validateTaxId, VAT_TREATMENT_OPTIONS } from '../../lib/ap-invoice/marketConfig';
import { classifyVATWithGulfTax } from '../../lib/ap-invoice/gulfTaxService';
import {
  supabase,
  type Invoice,
  type InvoiceLineItem,
  type AuditLog,
  type AuditLogEntry,
  type GLAccount,
  type PurchaseOrder,
  type Gstr2bEntry,
} from '../../lib/ap-invoice/supabase';
import { getAuditLog, logAction, getInvoiceflowWorkEmail } from '../../lib/ap-invoice/auditService';
import { ConfidenceBadge } from '@/components/invoices/ConfidenceBadge';
import {
  getEffectiveExtractionScore,
  getExtractionScoreSource,
  getParsedFieldConfidences,
} from '../../utils/extractionConfidence';
import { deriveInvoiceRiskDisplayScore } from '../../lib/ap-invoice/invoiceRiskDisplay';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Separator } from '../ui/separator';
import { ScrollArea } from '../ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { ApprovalChainPanel } from '@/components/approvals/ApprovalChainPanel';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formatApprovedByLabel(inv: Invoice): string {
  if (inv.auto_matched && !inv.approved_by) return 'System (auto-match)';
  if (!inv.approved_by) return 'â€”';
  if (UUID_RE.test(inv.approved_by)) return 'Signed-in user';
  return inv.approved_by;
}
import { DuplicateWarningBanner } from '@/components/invoices/DuplicateWarningBanner';
import { checkDuplicateBeforePayment, type DuplicateAlert } from '../../lib/ap-invoice/duplicateAlertService';
import { pushInvoiceToZoho, loadZohoSettings, type ZohoSettings } from '../../lib/ap-invoice/zohoService';
import {
  CheckCircle,
  XCircle,
  Edit2,
  Save,
  ChevronDown,
  FileText,
  Clock,
  ZoomIn,
  ZoomOut,
  Download,
  Trash2,
  UserCheck,
  AlertCircle,
  Copy,
} from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { useToast } from '../../hooks/use-toast';
import { getApprovalLevelName, isPendingApproval } from '../../utils/approvalWorkflow';
import { formatCurrency } from '../../utils/currency';
import { getTaxLabel } from '../../utils/taxConfig';
import { displayDate } from '../../utils/dateUtils';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import { getMyCompany } from '../../lib/ap-invoice/companyService';
import { resolveGLAccount, invoiceGlFieldsFromResult } from '../../utils/coaMapping';
import {
  getAccountingStandard,
  logGlSuggestionAction,
} from '../../lib/ap-invoice/accountingStandardService';
import { getMatchStatusColor } from '../../utils/threeWayMatch';
import { runAutoMatch } from '../../lib/ap-invoice/threeWayMatchService';
import { pushToTallyPrime } from '../../utils/tallyExport';
import { useErpSettings, toTallySettings } from '../../hooks/useErpSettings';
import {
  applyVendorGstinToInvoicesForName,
  fetchGstr2bByMatchedInvoice,
  fetchGstr2bBySupplierAndInvoice,
  updateInvoiceGstFields,
} from '../../lib/ap-invoice/gstService';

/** Same key as GST Recon page (localStorage). */
const COMPANY_GSTIN_KEY = 'invoiceflow_company_gstin';

/** GST return period YYYY-MM from invoice date (e.g. for GSTR-2B lookup). */
function invoicePeriodFromDate(dateStr: string | null | undefined): string {
  if (!dateStr || !String(dateStr).trim()) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const statusColors = {
  Processing: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  Approved: 'bg-green-100 text-green-800 border-green-200',
  Rejected: 'bg-red-100 text-red-800 border-red-200',
  Paid: 'bg-blue-100 text-blue-800 border-blue-200',
  'On Hold': 'bg-orange-100 text-orange-800 border-orange-200',
  Queried: 'bg-purple-100 text-purple-800 border-purple-200',
};

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'ðŸ‡¬ðŸ‡§ English',
  hi: 'ðŸ‡®ðŸ‡³ Hindi',
  ar: 'ðŸ‡¦ðŸ‡ª Arabic',
  de: 'ðŸ‡©ðŸ‡ª German',
  fr: 'ðŸ‡«ðŸ‡· French',
  ja: 'ðŸ‡¯ðŸ‡µ Japanese',
  zh: 'ðŸ‡¨ðŸ‡³ Chinese',
  es: 'ðŸ‡ªðŸ‡¸ Spanish',
  pt: 'ðŸ‡§ðŸ‡· Portuguese',
  ko: 'ðŸ‡°ðŸ‡· Korean',
  it: 'ðŸ‡®ðŸ‡¹ Italian',
  nl: 'ðŸ‡³ðŸ‡± Dutch',
};

const IFRS_OVERRIDE_OPTIONS = [
  'Professional Services',
  'IT Infrastructure',
  'Office Supplies',
  'Utilities',
  'Marketing',
  'Marketing & Advertising',
  'Rent & Lease',
  'Travel & Entertainment',
  'Industrial Supplies',
];

interface InvoiceDetailModalProps {
  invoice: Invoice;
  open: boolean;
  onClose: () => void;
  onUpdate: () => void;
  /** Open another invoice in this modal (e.g. duplicate original). */
  onNavigateInvoice?: (invoiceId: string) => void | Promise<void>;
}

export function InvoiceDetailModal({
  invoice,
  open,
  onClose,
  onUpdate,
  onNavigateInvoice,
}: InvoiceDetailModalProps) {
  const { toast } = useToast();
  const { dateFormat } = useCompanySettings();
  const { isUAE } = useMarket();
  const tallySettings = useErpSettings();
  const workEmail = getInvoiceflowWorkEmail() ?? '';
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [ifrsOpen, setIfrsOpen] = useState(true);
  const [editedInvoice, setEditedInvoice] = useState(invoice);
  const [loading, setLoading] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [approverName, setApproverName] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const [queryMessage, setQueryMessage] = useState('');
  const [showHoldDialog, setShowHoldDialog] = useState(false);
  const [showQueryDialog, setShowQueryDialog] = useState(false);
  const [glAccounts, setGlAccounts] = useState<GLAccount[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [selectedPoNumber, setSelectedPoNumber] = useState('');
  const [matchLoading, setMatchLoading] = useState(false);
  const [grnConfirmedBy, setGrnConfirmedBy] = useState('');
  const [gstrPortalRow, setGstrPortalRow] = useState<Gstr2bEntry | null>(null);
  const [activityEntries, setActivityEntries] = useState<AuditLogEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [expandedActivityId, setExpandedActivityId] = useState<string | null>(null);
  const [highlightGlPicker, setHighlightGlPicker] = useState(false);
  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [markPaidSaving, setMarkPaidSaving] = useState(false);
  const [duplicateAlert, setDuplicateAlert] = useState<DuplicateAlert | null>(null);
  const [duplicateAlertOpen, setDuplicateAlertOpen] = useState(false);
  const [zohoPushing, setZohoPushing] = useState(false);
  const [zohoSettings, setZohoSettings] = useState<ZohoSettings | null>(null);
  const [paymentMetaFromLog, setPaymentMetaFromLog] = useState<{ paid_by: string | null } | null>(null);
  const [markPaidForm, setMarkPaidForm] = useState({
    payment_method: 'NEFT',
    utr_number: '',
    payment_date: new Date().toISOString().slice(0, 10),
    payment_bank: '',
    payment_note: '',
  });
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
  const [paymentProofUploading, setPaymentProofUploading] = useState(false);
  const autoPoMatchAttemptedKeyRef = useRef<string | null>(null);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const taxBreakdownLines = useMemo(() => {
    try {
      const raw = invoice?.tax_breakdown;
      if (!raw || raw === '[]') return [];
      const arr = JSON.parse(typeof raw === 'string' ? raw : '[]');
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }, [invoice?.tax_breakdown]);

  const needsGlConfirmationBanner = useMemo(() => {
    const src = invoice.gl_suggestion_source;
    if (src !== 'standard_fallback' && src !== 'ai_suggested') return false;
    if (invoice.gl_confirmed === true) return false;
    return !!(invoice.gl_account_code ?? invoice.gl_code);
  }, [invoice]);

  const parsedRiskFlags = useMemo(() => {
    try {
      const raw = invoice?.risk_flags;
      if (!raw || raw === '[]' || raw === '') return [];
      if (Array.isArray(raw)) return raw;
      return JSON.parse(typeof raw === 'string' ? raw : '[]');
    } catch {
      return [];
    }
  }, [invoice?.risk_flags]);

  const riskDisplayScore = useMemo(() => {
    if (typeof invoice.risk_score === 'number' && invoice.risk_score > 0) {
      return Math.round(invoice.risk_score);
    }
    const derived = deriveInvoiceRiskDisplayScore(invoice);
    if (derived != null) return derived;
    return parsedRiskFlags.length > 0 ? 38 : 12;
  }, [invoice, parsedRiskFlags.length]);

  const SEVERITY = {
    critical: { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b', icon: 'ðŸš¨', label: 'Critical' },
    high: { bg: '#fff7ed', border: '#fed7aa', text: '#9a3412', icon: 'ðŸ”´', label: 'High' },
    medium: { bg: '#fefce8', border: '#fde68a', text: '#92400e', icon: 'ðŸŸ¡', label: 'Medium' },
    low: { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534', icon: 'ðŸŸ¢', label: 'Low' },
  };

  async function fetchComplianceActivity() {
    setActivityLoading(true);
    try {
      const { entries } = await getAuditLog({ entityId: invoice.id, pageSize: 20, page: 0 });
      setActivityEntries(entries);
    } catch {
      setActivityEntries([]);
    } finally {
      setActivityLoading(false);
    }
  }

  useEffect(() => {
    if (open) {
      fetchLineItems();
      fetchAuditLogs();
      void fetchComplianceActivity();
      fetchGLAccounts();
      fetchPurchaseOrders();
      loadZohoSettings().then((s) => setZohoSettings(s as ZohoSettings)).catch(() => null);
      setEditedInvoice(invoice);
      setSelectedPoNumber(invoice.po_number?.trim() ?? '');
      // Auto-suggest GL account based on IFRS category
      if (invoice.ifrs_category && !invoice.gl_code) {
        autoSuggestGLAccount(invoice.ifrs_category);
      }
    } else {
      autoPoMatchAttemptedKeyRef.current = null;
    }
  }, [open, invoice]);

  useEffect(() => {
    if (!open) return;
    const po = invoice.po_number?.trim();
    if (!po || invoice.po_id) return;

    const attemptKey = `${invoice.id}|${po}`;
    if (autoPoMatchAttemptedKeyRef.current === attemptKey) return;
    autoPoMatchAttemptedKeyRef.current = attemptKey;

    let cancelled = false;
    setMatchLoading(true);
    void (async () => {
      try {
        await runAutoMatch(invoice.id, { respectUploadSetting: false });
        if (!cancelled) onUpdateRef.current();
      } catch (e) {
        console.error('Auto 3-way match failed:', e);
      } finally {
        if (!cancelled) setMatchLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, invoice.id, invoice.po_number, invoice.po_id, invoice.vendor_name, invoice.total_amount]);

  useEffect(() => {
    if (!open || invoice.gst_recon_status !== 'mismatch') {
      setGstrPortalRow(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        let row = await fetchGstr2bByMatchedInvoice(invoice.id);
        if (!row) {
          let cg = '';
          try {
            cg = localStorage.getItem(COMPANY_GSTIN_KEY) || '';
          } catch {
            cg = '';
          }
          const p = invoicePeriodFromDate(invoice.invoice_date);
          if (cg && p) {
            row = await fetchGstr2bBySupplierAndInvoice(cg, p, invoice.gstin ?? undefined, invoice.invoice_number);
          }
        }
        if (!cancelled) setGstrPortalRow(row);
      } catch {
        if (!cancelled) setGstrPortalRow(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, invoice.id, invoice.gst_recon_status, invoice.invoice_date, invoice.gstin, invoice.invoice_number]);

  useEffect(() => {
    if (!open || !invoice.id) {
      setPaymentMetaFromLog(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('payment_log')
        .select('paid_by')
        .eq('invoice_id', invoice.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setPaymentMetaFromLog(data ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, invoice.id, invoice.status, invoice.payment_status]);

  async function fetchGLAccounts() {
    try {
      const { data, error } = await supabase
        .from('gl_accounts')
        .select('*')
        .eq('is_active', true)
        .order('gl_code', { ascending: true });

      if (error) throw error;
      setGlAccounts(data || []);
    } catch (error) {
      console.error('Error fetching GL accounts:', error);
    }
  }

  async function fetchPurchaseOrders() {
    try {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('*')
        .order('po_number', { ascending: true });
      if (error) {
        console.error('PO fetch error:', error.message);
        setPurchaseOrders([]);
        return;
      }
      setPurchaseOrders(data ?? []);
    } catch (error) {
      console.error('Error fetching purchase orders:', error);
      setPurchaseOrders([]);
    }
  }

  async function handleLinkPoAndRunMatch() {
    if (!selectedPoNumber.trim()) {
      toast({ title: 'Select a PO', description: 'Please select a purchase order to link.', variant: 'destructive' });
      return;
    }
    setMatchLoading(true);
    try {
      const { error: linkError } = await supabase
        .from('invoices')
        .update({
          po_number: selectedPoNumber.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', invoice.id);

      if (linkError) {
        console.error('PO link update failed:', linkError);
        throw linkError;
      }

      await runAutoMatch(invoice.id, { respectUploadSetting: false });
      toast({ title: 'Match complete', description: 'PO linked and auto match run.' });
      onUpdate();
    } catch (error) {
      console.error('Error linking PO / running match:', error);
      const err = error as { message?: string };
      toast({
        title: 'Failed to save',
        description: err?.message || 'PO link or 3-way match failed. Check console. If using Supabase, you may need to disable RLS on invoices.',
        variant: 'destructive',
      });
    } finally {
      setMatchLoading(false);
    }
  }

  function autoSuggestGLAccount(ifrsCategory: string) {
    // Map IFRS categories to GL accounts
    const ifrsToGLMap: Record<string, string> = {
      'Operating Expenses': '6100',
      'Professional Services': '6200',
      'Marketing & Advertising': '6300',
      'Cost of Goods Sold': '5000',
      'Capital Expenditure': '1600',
      'Financial Expenses': '7100',
    };

    const suggestedGLCode = ifrsToGLMap[ifrsCategory];
    if (suggestedGLCode) {
      const suggestedAccount = glAccounts.find((acc) => acc.gl_code === suggestedGLCode);
      if (suggestedAccount) {
        setEditedInvoice({
          ...editedInvoice,
          gl_code: suggestedAccount.gl_code,
          gl_name: suggestedAccount.gl_name,
        });
      }
    }
  }

  async function fetchLineItems() {
    try {
      const { data, error } = await supabase
        .from('invoice_line_items')
        .select('*')
        .eq('invoice_id', invoice.id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setLineItems(data || []);
    } catch (error) {
      console.error('Error fetching line items:', error);
    }
  }

  async function fetchAuditLogs() {
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('invoice_id', invoice.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAuditLogs(data || []);
    } catch (error) {
      console.error('Error fetching audit logs:', error);
    }
  }

  async function handleSave() {
    setLoading(true);
    try {
      const suggestedCode = invoice.gl_account_code ?? invoice.gl_code;
      const isOverride = editedInvoice.gl_code && editedInvoice.gl_code !== suggestedCode;
      const prevName = invoice.gl_account_name ?? invoice.gl_name;
      const glChanged =
        (editedInvoice.gl_code || '') !== (suggestedCode || '') ||
        (editedInvoice.gl_name || '') !== (prevName || '');

      const { error } = await supabase
        .from('invoices')
        .update({
          invoice_number: editedInvoice.invoice_number,
          vendor_name: editedInvoice.vendor_name,
          vendor_email: editedInvoice.vendor_email,
          vendor_phone: editedInvoice.vendor_phone,
          vendor_address: editedInvoice.vendor_address,
          total_amount: editedInvoice.total_amount,
          ifrs_category: editedInvoice.ifrs_category,
          ifrs_manual_override: editedInvoice.ifrs_manual_override,
          gl_code: editedInvoice.gl_code,
          gl_name: editedInvoice.gl_name,
          gl_account_code: editedInvoice.gl_code,
          gl_account_name: editedInvoice.gl_name,
          gl_auto_suggested: isOverride ? false : (editedInvoice.gl_auto_suggested ?? invoice.gl_auto_suggested),
          ...(glChanged
            ? { gl_confirmed: true, gl_suggestion_source: 'manual', gl_auto_suggested: false }
            : {}),
          department: editedInvoice.department,
          cost_center: editedInvoice.cost_center,
          project_code: editedInvoice.project_code,
          updated_at: new Date().toISOString(),
        })
        .eq('id', invoice.id);

      if (error) throw error;

      await applyVendorGstinToInvoicesForName(editedInvoice.vendor_name);

      await supabase.from('audit_logs').insert({
        invoice_id: invoice.id,
        action: 'Updated',
        field_changed: 'Invoice Details',
        user_name: 'System User',
      });

      logAction('invoice.updated', 'invoice', invoice.id, getInvoiceflowWorkEmail(), {
        tab: 'details',
        invoice_number: editedInvoice.invoice_number,
      });

      toast({
        title: 'Success',
        description: 'Invoice updated successfully',
      });

      setIsEditing(false);
      onUpdate();
      fetchAuditLogs();
      void fetchComplianceActivity();
    } catch (error) {
      console.error('Error updating invoice:', error);
      toast({
        title: 'Error',
        description: 'Failed to update invoice',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveGst() {
    setLoading(true);
    try {
      await updateInvoiceGstFields(invoice.id, {
        gstin: editedInvoice.gstin?.trim() || null,
        gst_amount: Number(editedInvoice.gst_amount ?? 0),
        cgst: Number(editedInvoice.cgst ?? 0),
        sgst: Number(editedInvoice.sgst ?? 0),
        igst: Number(editedInvoice.igst ?? 0),
      });
      toast({ title: 'GST details saved' });
      onUpdate();
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to save GST fields', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveIfrsOverride() {
    if (!editedInvoice.ifrs_category?.trim()) return;
    setLoading(true);
    try {
      const lineDesc = lineItems.map((i) => i.description).filter(Boolean).join(' ');
      const glRes = await resolveGLAccount(supabase, editedInvoice.ifrs_category, null, {
        description: lineDesc,
        vendorName: editedInvoice.vendor_name,
      });

      const { error } = await supabase
        .from('invoices')
        .update({
          ifrs_category: editedInvoice.ifrs_category,
          ifrs_manual_override: true,
          ...invoiceGlFieldsFromResult(glRes),
          updated_at: new Date().toISOString(),
        })
        .eq('id', invoice.id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'IFRS classification override saved',
      });

      onUpdate();
    } catch (error) {
      console.error('Error saving IFRS override:', error);
      toast({
        title: 'Error',
        description: 'Failed to save override',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleGlBannerAddToChart() {
    const code = invoice.gl_account_code ?? invoice.gl_code;
    const name = invoice.gl_account_name ?? invoice.gl_name;
    if (!code?.trim() || !name?.trim()) return;
    setLoading(true);
    try {
      const std = await getAccountingStandard(supabase);
      const { error: upErr } = await supabase.from('gl_accounts').upsert(
        {
          gl_code: code.trim(),
          gl_name: name.trim(),
          account_type: invoice.gl_account_type || 'Expense',
          is_active: true,
          imported_from: 'manual',
        },
        { onConflict: 'gl_code' }
      );
      if (upErr) throw upErr;

      const { error: invErr } = await supabase
        .from('invoices')
        .update({
          gl_confirmed: true,
          gl_suggestion_source: 'company_chart',
          updated_at: new Date().toISOString(),
        })
        .eq('id', invoice.id);
      if (invErr) throw invErr;

      try {
        await logGlSuggestionAction(supabase, {
          invoiceId: invoice.id,
          ifrsCategory: invoice.ifrs_category,
          suggestedCode: code,
          suggestedName: name,
          accountingStandard: std,
          action: 'confirmed',
          finalCode: code,
          finalName: name,
        });
      } catch {
        /* gl_suggestions_log optional until migration */
      }

      await fetchGLAccounts();
      toast({ title: 'Added to chart', description: `${code} â€” ${name}` });
      onUpdate();
    } catch (e) {
      console.error(e);
      toast({ title: 'Error', description: 'Could not add GL account', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  async function handleGlBannerKeepAsIs() {
    setLoading(true);
    try {
      const std = await getAccountingStandard(supabase);
      const code = invoice.gl_account_code ?? invoice.gl_code;
      const name = invoice.gl_account_name ?? invoice.gl_name;
      const { error } = await supabase
        .from('invoices')
        .update({
          gl_confirmed: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', invoice.id);
      if (error) throw error;
      try {
        await logGlSuggestionAction(supabase, {
          invoiceId: invoice.id,
          ifrsCategory: invoice.ifrs_category,
          suggestedCode: code,
          suggestedName: name,
          accountingStandard: std,
          action: 'skipped',
          finalCode: code,
          finalName: name,
        });
      } catch {
        /* optional table */
      }
      toast({ title: 'Marked confirmed', description: 'GL kept as suggested.' });
      onUpdate();
    } catch (e) {
      console.error(e);
      toast({ title: 'Error', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  function handleGlBannerPickDifferent() {
    setHighlightGlPicker(true);
    setTimeout(() => {
      document.getElementById('gl-override-select-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    setTimeout(() => setHighlightGlPicker(false), 4000);
  }

  async function handleApprove() {
    if (!approverName.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter your name',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const approverUserId = authData.user?.id ?? null;

      const { error } = await supabase
        .from('invoices')
        .update({
          status: 'Approved',
          approved_by: approverUserId,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', invoice.id);

      if (error) throw error;

      await supabase.from('audit_logs').insert({
        invoice_id: invoice.id,
        action: 'Approved',
        field_changed: 'status',
        old_value: invoice.status,
        new_value: 'Approved',
        user_name: approverName,
      });

      toast({
        title: 'Success',
        description: 'Invoice approved successfully',
      });

      setApproverName('');
      onUpdate();
      fetchAuditLogs();
    } catch (error) {
      console.error('Error approving invoice:', error);
      toast({
        title: 'Error',
        description: 'Failed to approve invoice',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleReject() {
    if (!approverName.trim() || !rejectionReason.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter your name and rejection reason',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('invoices')
        .update({
          status: 'Rejected',
          rejection_reason: rejectionReason,
          updated_at: new Date().toISOString(),
        })
        .eq('id', invoice.id);

      if (error) throw error;

      await supabase.from('audit_logs').insert({
        invoice_id: invoice.id,
        action: 'Rejected',
        field_changed: 'status',
        old_value: invoice.status,
        new_value: 'Rejected',
        user_name: approverName,
      });

      toast({
        title: 'Success',
        description: 'Invoice rejected successfully',
      });

      setApproverName('');
      setRejectionReason('');
      onUpdate();
      fetchAuditLogs();
    } catch (error) {
      console.error('Error rejecting invoice:', error);
      toast({
        title: 'Error',
        description: 'Failed to reject invoice',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleHold() {
    if (!holdReason.trim()) {
      toast({ title: 'Add a hold reason', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase
        .from('invoices')
        .update({ status: 'On Hold', rejection_reason: holdReason, updated_at: new Date().toISOString() })
        .eq('id', invoice.id);
      if (error) throw error;
      await supabase.from('audit_logs').insert({
        invoice_id: invoice.id,
        action: 'status_change',
        field_changed: 'status',
        old_value: invoice.status,
        new_value: 'On Hold',
        user_name: approverName || 'Finance',
        notes: holdReason,
      });
      toast({ title: 'Invoice placed on hold' });
      setShowHoldDialog(false);
      setHoldReason('');
      onUpdate();
      fetchAuditLogs();
    } catch (e) {
      toast({ title: 'Error', description: 'Failed to hold invoice', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  async function handleQuery() {
    if (!queryMessage.trim()) {
      toast({ title: 'Add a query message to send to vendor', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase
        .from('invoices')
        .update({ status: 'Queried', updated_at: new Date().toISOString() })
        .eq('id', invoice.id);
      if (error) throw error;
      await supabase.from('audit_logs').insert({
        invoice_id: invoice.id,
        action: 'status_change',
        field_changed: 'status',
        old_value: invoice.status,
        new_value: 'Queried',
        user_name: approverName || 'Finance',
        notes: `Query sent to vendor: ${queryMessage}`,
      });
      toast({ title: 'Query sent', description: `Vendor notified: "${queryMessage.slice(0, 60)}â€¦"` });
      setShowQueryDialog(false);
      setQueryMessage('');
      onUpdate();
      fetchAuditLogs();
    } catch (e) {
      toast({ title: 'Error', description: 'Failed to query invoice', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  async function confirmMarkPaid() {
    if (markPaidSaving) return;
    setMarkPaidSaving(true);
    try {
      const company = await getMyCompany();
      if (!company?.id) {
        toast({
          title: 'No company',
          description: 'Select a company workspace before recording payment.',
          variant: 'destructive',
        });
        return;
      }
      const { data: authData } = await supabase.auth.getUser();
      const email = (authData.user?.email ?? workEmail) || null;
      const now = new Date().toISOString();
      const payDate = markPaidForm.payment_date || new Date().toISOString().slice(0, 10);
      const utrTrim = markPaidForm.utr_number.trim();

      // Upload payment proof file if provided
      let proofUrl: string | null = null;
      if (paymentProofFile) {
        setPaymentProofUploading(true);
        const ext = paymentProofFile.name.split('.').pop() ?? 'jpg';
        const path = `payment-proofs/${invoice.id}-${Date.now()}.${ext}`;
        const { error: storErr } = await supabase.storage.from('invoices').upload(path, paymentProofFile, { upsert: true });
        if (!storErr) {
          const { data: urlData } = supabase.storage.from('invoices').getPublicUrl(path);
          proofUrl = urlData?.publicUrl ?? null;
        }
        setPaymentProofUploading(false);
      }

      const { error: upErr } = await supabase
        .from('invoices')
        .update({
          status: 'Paid',
          payment_status: 'paid',
          paid_at: now,
          utr_number: utrTrim || null,
          payment_method: markPaidForm.payment_method || null,
          payment_date: payDate,
          payment_bank: markPaidForm.payment_bank.trim() || null,
          payment_note: markPaidForm.payment_note.trim() || null,
          payment_reference: utrTrim || null,
          payment_proof_url: proofUrl,
          updated_at: now,
        })
        .eq('id', invoice.id);

      if (upErr) throw upErr;

      // Must match invoice tenant for payment_log RLS (company_id = get_effective_company_id()).
      const companyIdForLog = invoice.company_id ?? company.id;
      if (!companyIdForLog) {
        throw new Error('Missing company_id on invoice; cannot append payment_log.');
      }

      const { error: logErr } = await supabase.from('payment_log').insert({
        company_id: companyIdForLog,
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        vendor_name: invoice.vendor_name,
        amount: invoice.total_amount,
        payment_method: markPaidForm.payment_method || null,
        utr_number: utrTrim || null,
        payment_date: payDate,
        payment_bank: markPaidForm.payment_bank.trim() || null,
        payment_note: markPaidForm.payment_note.trim() || null,
        paid_by: email,
      });
      if (logErr) throw logErr;

      logAction('payment.marked_paid', 'invoice', invoice.id, email, {
        utr_number: utrTrim || null,
        payment_method: markPaidForm.payment_method,
        amount: invoice.total_amount,
      });

      await supabase.from('audit_logs').insert({
        invoice_id: invoice.id,
        action: 'Paid',
        field_changed: 'status',
        old_value: invoice.status,
        new_value: 'Paid',
        user_name: email || 'System User',
      });

      toast({
        title: 'Payment recorded',
        description: utrTrim ? `UTR / reference: ${utrTrim}` : 'Invoice marked as paid.',
      });
      setMarkPaidOpen(false);
      setPaymentMetaFromLog({ paid_by: email });
      onUpdate();
      fetchAuditLogs();
    } catch (e) {
      console.error(e);
      const parts: string[] = [];
      if (e && typeof e === 'object' && 'message' in e) {
        const o = e as { message?: string; details?: string; hint?: string; code?: string };
        if (o.message) parts.push(o.message);
        if (o.details) parts.push(o.details);
        if (o.hint) parts.push(o.hint);
        if (o.code) parts.push(`code: ${o.code}`);
      } else if (e instanceof Error) {
        parts.push(e.message);
      }
      const detail =
        parts.join(' â€” ') ||
        'Could not save payment. Apply pending Supabase migrations: payment columns on invoices, payment_log table + RLS (see supabase/migrations).';
      toast({
        title: 'Error',
        description: detail,
        variant: 'destructive',
      });
    } finally {
      setMarkPaidSaving(false);
    }
  }

  async function handleStatusChange(newStatus: 'Approved' | 'Rejected') {
    if (
      newStatus === 'Approved' &&
      ['no_po', 'partial', 'mismatch'].includes((invoice.match_status || '').toLowerCase())
    ) {
      toast({
        title: 'Approval blocked',
        description: 'Resolve 3-way matching first (PO/GRN vs invoice) before approving.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const updates: any = {
        status: newStatus,
        updated_at: new Date().toISOString(),
      };

      if (newStatus === 'Approved') {
        updates.approved_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('invoices')
        .update(updates)
        .eq('id', invoice.id);

      if (error) throw error;

      await supabase.from('audit_logs').insert({
        invoice_id: invoice.id,
        action: newStatus,
        field_changed: 'status',
        old_value: invoice.status,
        new_value: newStatus,
        user_name: 'System User',
      });

      toast({
        title: 'Success',
        description: `Invoice ${newStatus.toLowerCase()} successfully`,
      });

      onUpdate();
      fetchAuditLogs();
    } catch (error) {
      console.error('Error updating status:', error);
      toast({
        title: 'Error',
        description: 'Failed to update invoice status',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Are you sure you want to delete this invoice? This action cannot be undone.')) {
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('invoices')
        .delete()
        .eq('id', invoice.id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Invoice deleted successfully',
      });

      onUpdate();
      onClose();
    } catch (error) {
      console.error('Error deleting invoice:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete invoice',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-7xl max-h-[90vh] p-0">
        <DuplicateWarningBanner
          invoice={invoice}
          performedByEmail={workEmail}
          onRefresh={onUpdate}
          onNavigateInvoice={onNavigateInvoice}
        />
        <DialogHeader className="p-6 pb-4 border-b">
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="text-2xl">
                Invoice {invoice.invoice_number}
                {invoice.ifrs_category && (
                  <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700 align-middle">
                    {invoice.ifrs_category}
                  </span>
                )}
              </DialogTitle>
              <div className="mt-2 flex items-center gap-2">
                <Badge variant="outline" className={statusColors[invoice.status]}>
                  {invoice.status}
                </Badge>
                {invoice.invoice_language && invoice.invoice_language !== 'en' && (
                  <span
                    className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: '#eff6ff', color: '#1a56db' }}
                  >
                    {LANGUAGE_LABELS[invoice.invoice_language] || invoice.invoice_language}
                    {' Â· '}Extracted & translated by AI
                  </span>
                )}
                <span className="text-sm text-gray-500">
                  Created {displayDate(invoice.created_at.slice(0, 10), dateFormat)}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={handleDelete}>
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
              {isEditing ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsEditing(false);
                      setEditedInvoice(invoice);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={loading} className="bg-[#0A4B8F]">
                    <Save className="mr-2 h-4 w-4" />
                    Save
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                  <Edit2 className="mr-2 h-4 w-4" />
                  Edit
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 max-h-[calc(90vh-8rem)] overflow-hidden">
          {/* Left Side - PDF Preview */}
          <div className="space-y-4">
            <Card className="h-full">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Document Preview</CardTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setZoomLevel((z) => Math.max(50, z - 25))}
                      disabled={zoomLevel <= 50}
                    >
                      <ZoomOut className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-gray-600 min-w-[3rem] text-center">
                      {zoomLevel}%
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setZoomLevel((z) => Math.min(200, z + 25))}
                      disabled={zoomLevel >= 200}
                    >
                      <ZoomIn className="h-4 w-4" />
                    </Button>
                    {invoice.file_url && (
                      <a
                        href={invoice.file_url}
                        target="_blank"
                        rel="noreferrer"
                        download
                        title="Download original invoice file"
                      >
                        <Button variant="outline" size="sm">
                          <Download className="h-4 w-4" />
                        </Button>
                      </a>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[calc(90vh-20rem)]">
                  <div className="flex items-center justify-center bg-gray-100 min-h-[500px] p-6">
                    {invoice.file_url ? (
                      <div
                        className="bg-white shadow-lg rounded-lg overflow-hidden border border-gray-200"
                        style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'top center' }}
                      >
                        <div className="p-8 space-y-4">
                          <div className="text-center">
                            <FileText className="mx-auto h-16 w-16 text-gray-400" />
                            <p className="mt-4 text-lg font-semibold text-gray-700">
                              Invoice #{invoice.invoice_number}
                            </p>
                            <p className="text-sm text-gray-500">{invoice.file_type}</p>
                          </div>
                          <div className="border-t border-gray-200 pt-4 space-y-2">
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">Vendor:</span>
                              <span className="font-medium">{invoice.vendor_name}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">Amount:</span>
                              <span className="font-medium text-lg">
                                {formatCurrency(Number(invoice.total_amount), invoice.currency || 'USD')}
                              </span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">Date:</span>
                              <span className="font-medium">
                                {displayDate(invoice.invoice_date, dateFormat)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center">
                        <FileText className="mx-auto h-16 w-16 text-gray-400" />
                        <p className="mt-4 text-sm text-gray-600">No document attached</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {/* Right Side - Invoice Details */}
          <ScrollArea className="h-[calc(90vh-12rem)]">
            <div className="pr-2">
              <Tabs defaultValue="details" className="w-full">
                <TabsList className="mb-3 flex w-full flex-wrap justify-start gap-1">
                  <TabsTrigger value="details">Details</TabsTrigger>
                  <TabsTrigger value="approval">Approval</TabsTrigger>
                  <TabsTrigger value="gst">{isUAE ? 'VAT' : 'GST'}</TabsTrigger>
                  <TabsTrigger value="activity">Activity</TabsTrigger>
                </TabsList>
                <TabsContent value="details" className="mt-0 space-y-4 focus-visible:ring-0 focus-visible:ring-offset-0">
            {(() => {
              const effScore = getEffectiveExtractionScore(invoice);
              const src = getExtractionScoreSource(invoice);
              const perField = getParsedFieldConfidences(invoice);
              const srcHint =
                src === 'ocr'
                  ? 'Includes per-field scores from your extraction workflow when provided.'
                  : src === 'ifrs'
                    ? 'Aligned with IFRS / classification confidence from n8n.'
                    : 'Estimated from how complete the main fields are (no score from AI yet).';
              const fieldLabels: Record<string, string> = {
                vendor_name: 'Vendor name',
                total_amount: 'Amount',
                invoice_date: 'Invoice date',
                invoice_number: 'Invoice #',
                due_date: 'Due date',
                amount: 'Amount',
              };
              return (
                <Card className="border-border">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Extraction confidence</CardTitle>
                    <p className="text-xs text-muted-foreground font-normal">{srcHint}</p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-muted-foreground">Overall</span>
                      <ConfidenceBadge score={effScore} size="md" />
                    </div>
                    {effScore < 90 && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        Review extracted values â€” confidence is below 90%. Check vendor name, amount, and
                        invoice date carefully before approving.
                      </div>
                    )}
                    {Object.keys(perField).length > 0 && (
                      <div className="space-y-2 pt-1">
                        <p className="text-xs font-medium text-muted-foreground">Per-field</p>
                        <ul className="space-y-2">
                          {Object.entries(perField).map(([key, pct]) => {
                            const v = Math.min(100, Math.max(0, Number(pct)));
                            const low = v < 70;
                            return (
                              <li key={key} className="text-xs">
                                <div className="flex justify-between gap-2 mb-0.5">
                                  <span>{fieldLabels[key] ?? key.replace(/_/g, ' ')}</span>
                                  <span className={low ? 'text-amber-700 font-medium' : 'text-muted-foreground'}>
                                    {Math.round(v)}%
                                  </span>
                                </div>
                                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${low ? 'bg-amber-500' : 'bg-primary'}`}
                                    style={{ width: `${v}%` }}
                                  />
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })()}
            {/* Invoice Details */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Invoice Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Invoice Number</Label>
                    {isEditing ? (
                      <Input
                        value={editedInvoice.invoice_number}
                        onChange={(e) =>
                          setEditedInvoice({
                            ...editedInvoice,
                            invoice_number: e.target.value,
                          })
                        }
                      />
                    ) : (
                      <p className="text-sm font-medium">{invoice.invoice_number}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Total Amount</Label>
                    {isEditing ? (
                      <Input
                        type="number"
                        value={editedInvoice.total_amount}
                        onChange={(e) =>
                          setEditedInvoice({
                            ...editedInvoice,
                            total_amount: parseFloat(e.target.value),
                          })
                        }
                      />
                    ) : (
                      <p className="text-sm font-medium">
                        {formatCurrency(Number(invoice.total_amount), invoice.currency || 'USD')}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Invoice Date</Label>
                    <p className="text-sm">
                      {displayDate(invoice.invoice_date, dateFormat)}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label className="flex flex-wrap items-center gap-2">
                      Due Date
                      {(() => {
                        const raw = invoice.due_date;
                        if (!raw) {
                          return (
                            <Badge variant="secondary" className="text-xs font-normal">
                              No due date
                            </Badge>
                          );
                        }
                        const due = new Date(raw);
                        if (Number.isNaN(due.getTime())) {
                          return (
                            <Badge variant="secondary" className="text-xs font-normal">
                              Invalid date
                            </Badge>
                          );
                        }
                        const t0 = new Date();
                        t0.setHours(0, 0, 0, 0);
                        due.setHours(0, 0, 0, 0);
                        const paid =
                          invoice.status === 'Paid' || invoice.payment_status === 'paid';
                        const daysLate = Math.floor(
                          (t0.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)
                        );
                        if (paid) {
                          return (
                            <Badge className="bg-slate-100 text-slate-700 text-xs font-normal">
                              Paid
                            </Badge>
                          );
                        }
                        if (daysLate > 0) {
                          return (
                            <Badge className="bg-red-100 text-red-800 text-xs font-normal">
                              {daysLate} day{daysLate !== 1 ? 's' : ''} overdue
                            </Badge>
                          );
                        }
                        if (daysLate === 0) {
                          return (
                            <Badge className="bg-amber-50 text-amber-900 text-xs font-normal">
                              Due today
                            </Badge>
                          );
                        }
                        return (
                          <Badge className="bg-emerald-50 text-emerald-800 text-xs font-normal">
                            On time
                          </Badge>
                        );
                      })()}
                    </Label>
                    <p className="text-sm">
                      {invoice.due_date && !Number.isNaN(new Date(invoice.due_date).getTime())
                        ? format(new Date(invoice.due_date), 'MMMM dd, yyyy')
                        : 'â€”'}
                    </p>
                  </div>
                </div>

                {/* Tax Summary */}
                {(invoice.tax_type && invoice.tax_type !== 'None') ||
                (invoice.tax_code && invoice.tax_code !== 'NONE') ||
                taxBreakdownLines.length > 0 ? (
                  <>
                    <Separator />
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                      <h4 className="font-semibold mb-3">Tax Summary</h4>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Subtotal:</span>
                          <span className="font-medium">
                            {formatCurrency(
                              Number(invoice.subtotal_amount || invoice.total_amount - (invoice.tax_amount || 0)),
                              invoice.currency || 'USD'
                            )}
                          </span>
                        </div>
                        {taxBreakdownLines.length > 0
                          ? taxBreakdownLines.map((t: { name?: string; rate?: number; amount?: number }, i: number) => (
                              <div key={`${t.name}-${i}`} className="flex justify-between text-sm">
                                <span className="text-gray-600">
                                  {t.name} @ {t.rate}%
                                </span>
                                <span className="font-medium">
                                  {formatCurrency(Number(t.amount ?? 0), invoice.currency || 'USD')}
                                </span>
                              </div>
                            ))
                          : invoice.tax_type &&
                            invoice.tax_type !== 'None' && (
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-600">
                                  Tax ({invoice.tax_code ? getTaxLabel(invoice.tax_code) : invoice.tax_type}{' '}
                                  {invoice.tax_rate != null ? `${invoice.tax_rate}%` : ''}):
                                </span>
                                <span className="font-medium">
                                  {formatCurrency(Number(invoice.tax_amount || 0), invoice.currency || 'USD')}
                                </span>
                              </div>
                            )}
                        <div className="flex justify-between border-t border-gray-300 pt-2">
                          <span className="font-semibold text-gray-900">Total:</span>
                          <span className="text-lg font-bold text-gray-900">
                            {formatCurrency(Number(invoice.total_amount), invoice.currency || 'USD')}
                          </span>
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}

                <Separator />

                <div className="space-y-4">
                  <h4 className="font-semibold">Vendor Information</h4>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Vendor Name</Label>
                      {isEditing ? (
                        <Input
                          value={editedInvoice.vendor_name}
                          onChange={(e) =>
                            setEditedInvoice({
                              ...editedInvoice,
                              vendor_name: e.target.value,
                            })
                          }
                        />
                      ) : (
                        <p className="text-sm font-medium">{invoice.vendor_name}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Email</Label>
                      {isEditing ? (
                        <Input
                          type="email"
                          value={editedInvoice.vendor_email || ''}
                          onChange={(e) =>
                            setEditedInvoice({
                              ...editedInvoice,
                              vendor_email: e.target.value,
                            })
                          }
                        />
                      ) : (
                        <p className="text-sm">{invoice.vendor_email || 'N/A'}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Phone</Label>
                      {isEditing ? (
                        <Input
                          value={editedInvoice.vendor_phone || ''}
                          onChange={(e) =>
                            setEditedInvoice({
                              ...editedInvoice,
                              vendor_phone: e.target.value,
                            })
                          }
                        />
                      ) : (
                        <p className="text-sm">{invoice.vendor_phone || 'N/A'}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Address</Label>
                      {isEditing ? (
                        <Textarea
                          value={editedInvoice.vendor_address || ''}
                          onChange={(e) =>
                            setEditedInvoice({
                              ...editedInvoice,
                              vendor_address: e.target.value,
                            })
                          }
                          rows={2}
                        />
                      ) : (
                        <p className="text-sm">{invoice.vendor_address || 'N/A'}</p>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Line Items */}
            {lineItems.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Line Items</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Unit Price</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lineItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>{item.description}</TableCell>
                          <TableCell className="text-right">{item.quantity}</TableCell>
                          <TableCell className="text-right">
                            ${Number(item.unit_price).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            ${Number(item.total).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {/* IFRS Classification */}
            <Collapsible open={ifrsOpen} onOpenChange={setIfrsOpen}>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-gray-50">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">IFRS Classification</CardTitle>
                      <ChevronDown
                        className={`h-5 w-5 transition-transform ${
                          ifrsOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>IFRS Category</Label>
                      <p className="text-lg font-semibold text-[#1a56db]">
                        {invoice.ifrs_category?.trim() || 'Not classified'}
                      </p>
                    </div>

                    {(invoice.gl_account_code ?? invoice.gl_code) && (
                      <div className="space-y-2">
                        <Label>GL Account</Label>
                        <p className="font-mono text-sm font-medium text-gray-800">
                          {invoice.gl_account_code ?? invoice.gl_code}
                          {invoice.gl_account_name ?? invoice.gl_name ? ` â€” ${invoice.gl_account_name ?? invoice.gl_name}` : ''}
                        </p>
                        {invoice.gl_source && (
                          <span
                            className="text-xs font-semibold"
                            style={{ color: invoice.gl_source === 'company_coa' ? '#0e9f6e' : '#6b7280' }}
                          >
                            {invoice.gl_source === 'company_coa' ? 'ðŸ¢ From your COA' : 'ðŸ¤– IFRS Auto'}
                          </span>
                        )}
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>Confidence (0â€“100)</Label>
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 rounded-full bg-gray-200">
                          <div
                            className="h-full rounded-full bg-blue-600"
                            style={{ width: `${Math.min(100, Math.max(0, Number(invoice.ifrs_confidence) ?? 0))}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium w-10">
                          {invoice.ifrs_confidence != null ? Number(invoice.ifrs_confidence) : 0}%
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Explanation</Label>
                      <p className="text-sm text-gray-600">
                        {invoice.ifrs_explanation?.trim() || 'â€”'}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Manual override</Label>
                      <Select
                        value={editedInvoice.ifrs_category || ''}
                        onValueChange={(value) =>
                          setEditedInvoice({
                            ...editedInvoice,
                            ifrs_category: value,
                            ifrs_manual_override: true,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          {IFRS_OVERRIDE_OPTIONS.map((category) => (
                            <SelectItem key={category} value={category}>
                              {category}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        className="mt-2"
                        disabled={loading || !editedInvoice.ifrs_category || editedInvoice.ifrs_category === (invoice.ifrs_category || '')}
                        onClick={handleSaveIfrsOverride}
                      >
                        <Save className="h-4 w-4 mr-1" />
                        Save Override
                      </Button>
                    </div>

                    {invoice.ifrs_manual_override && (
                      <div className="rounded-md bg-yellow-50 p-3">
                        <p className="text-sm text-yellow-800">
                          This classification has been manually overridden
                        </p>
                      </div>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            {/* Approval Workflow (legacy amount-based level) */}
            {invoice.approval_level &&
              (invoice.approval_status ?? 'not_required') === 'not_required' &&
              isPendingApproval(invoice.status, invoice.approval_level, invoice.approved_by) && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <UserCheck className="h-5 w-5" />
                      Approval Required
                    </CardTitle>
                    <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200">
                      {getApprovalLevelName(invoice.approval_level)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                    <p className="text-sm text-yellow-800">
                      This invoice requires <strong>{getApprovalLevelName(invoice.approval_level)}</strong> before it can be processed.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="approver-name">Your Name *</Label>
                      <Input
                        id="approver-name"
                        placeholder="Enter your name"
                        value={approverName}
                        onChange={(e) => setApproverName(e.target.value)}
                        disabled={loading}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="rejection-reason">Rejection Reason (if rejecting)</Label>
                      <Textarea
                        id="rejection-reason"
                        placeholder="Enter reason for rejection..."
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                        disabled={loading}
                        rows={3}
                      />
                    </div>

                    <div className="flex gap-3 flex-wrap">
                      <Button
                        className="flex-1 bg-green-600 hover:bg-green-700"
                        onClick={handleApprove}
                        disabled={loading || !approverName.trim()}
                      >
                        <CheckCircle className="mr-2 h-4 w-4" />
                        Approve
                      </Button>
                      <Button
                        variant="destructive"
                        className="flex-1"
                        onClick={handleReject}
                        disabled={loading || !approverName.trim() || !rejectionReason.trim()}
                      >
                        <XCircle className="mr-2 h-4 w-4" />
                        Reject
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1 border-orange-400 text-orange-700 hover:bg-orange-50"
                        onClick={() => setShowHoldDialog(true)}
                        disabled={loading}
                      >
                        â¸ Hold
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1 border-purple-400 text-purple-700 hover:bg-purple-50"
                        onClick={() => setShowQueryDialog(true)}
                        disabled={loading}
                      >
                        â“ Query Vendor
                      </Button>
                    </div>

                    {/* Hold dialog */}
                    {showHoldDialog && (
                      <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 space-y-3">
                        <p className="text-sm font-medium text-orange-800">Reason for placing on hold</p>
                        <Textarea
                          placeholder="e.g. Waiting for corrected PO from procurement teamâ€¦"
                          value={holdReason}
                          onChange={(e) => setHoldReason(e.target.value)}
                          rows={2}
                        />
                        <div className="flex gap-2">
                          <Button size="sm" className="bg-orange-600 hover:bg-orange-700" onClick={handleHold} disabled={loading}>
                            Confirm Hold
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setShowHoldDialog(false)}>Cancel</Button>
                        </div>
                      </div>
                    )}

                    {/* Query dialog */}
                    {showQueryDialog && (
                      <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 space-y-3">
                        <p className="text-sm font-medium text-purple-800">Message to send to vendor</p>
                        <Textarea
                          placeholder="e.g. Invoice amount does not match PO-2025-0341. Please send revised invoiceâ€¦"
                          value={queryMessage}
                          onChange={(e) => setQueryMessage(e.target.value)}
                          rows={2}
                        />
                        <div className="flex gap-2">
                          <Button size="sm" className="bg-purple-600 hover:bg-purple-700" onClick={handleQuery} disabled={loading}>
                            Send Query
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setShowQueryDialog(false)}>Cancel</Button>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Approval Status (if already approved/rejected) */}
            {invoice.status === 'Approved' && invoice.approved_at && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    Approval Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Approved By:</span>
                    <span className="text-sm font-medium">{formatApprovedByLabel(invoice)}</span>
                  </div>
                  {invoice.approved_at && (
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Approved At:</span>
                      <span className="text-sm font-medium">
                        {format(new Date(invoice.approved_at), 'MMM dd, yyyy HH:mm')}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {(invoice.status === 'Approved' || invoice.status === 'Paid' || invoice.payment_status === 'paid') && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Payment</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {invoice.status === 'Paid' || invoice.payment_status === 'paid' ? (
                    <>
                      <div className="flex justify-between gap-2">
                        <span className="text-gray-600">Payment status</span>
                        <Badge className="bg-emerald-50 text-emerald-900 border border-emerald-200">Paid</Badge>
                      </div>
                      {invoice.payment_method ? (
                        <div className="flex justify-between">
                          <span className="text-gray-600">Method</span>
                          <span className="font-medium">{invoice.payment_method}</span>
                        </div>
                      ) : null}
                      {(invoice.utr_number ?? invoice.payment_reference)?.trim() ? (
                        <div className="flex justify-between items-start gap-2">
                          <span className="text-gray-600 shrink-0">UTR / Ref</span>
                          <div className="flex items-center gap-1 min-w-0 justify-end">
                            <span className="font-mono text-xs text-right break-all">
                              {invoice.utr_number ?? invoice.payment_reference}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              title="Copy"
                              onClick={() =>
                                void navigator.clipboard.writeText(
                                  String(invoice.utr_number ?? invoice.payment_reference ?? '')
                                )
                              }
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ) : null}
                      {(invoice.payment_date || invoice.paid_at) && (
                        <div className="flex justify-between gap-2">
                          <span className="text-gray-600">Paid on</span>
                          <span>
                            {displayDate(
                              String(invoice.payment_date ?? invoice.paid_at ?? '').slice(0, 10),
                              dateFormat
                            )}
                          </span>
                        </div>
                      )}
                      {invoice.payment_bank?.trim() ? (
                        <div className="flex justify-between gap-2">
                          <span className="text-gray-600">Bank</span>
                          <span className="text-right">{invoice.payment_bank}</span>
                        </div>
                      ) : null}
                      {paymentMetaFromLog?.paid_by ? (
                        <div className="flex justify-between gap-2">
                          <span className="text-gray-600">Paid by</span>
                          <span className="truncate text-right">{paymentMetaFromLog.paid_by}</span>
                        </div>
                      ) : null}
                      {invoice.payment_note?.trim() ? (
                        <div className="flex justify-between items-start gap-2">
                          <span className="text-gray-600">Note</span>
                          <span className="text-right text-gray-800">{invoice.payment_note}</span>
                        </div>
                      ) : null}
                      <div className="flex justify-between items-center gap-2 pt-2 border-t border-gray-100">
                        <span className="text-gray-600">Bank recon</span>
                        {invoice.bank_reconciled ? (
                          <Badge className="bg-emerald-100 text-emerald-900 text-xs max-w-[60%] truncate" title={invoice.bank_ref ?? ''}>
                            Reconciled{invoice.bank_ref ? ` Â· ${invoice.bank_ref}` : ''}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-amber-800 border-amber-200 text-xs">
                            Pending reconciliation
                          </Badge>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <p>
                        <span className="text-gray-600">Payment status:</span>{' '}
                        <strong>Pending</strong>
                      </p>
                      <Button
                        type="button"
                        className="w-full bg-[#0A4B8F] hover:bg-[#0D6EFD]"
                        disabled={loading}
                        onClick={async () => {
                          setMarkPaidForm({
                            payment_method: 'NEFT',
                            utr_number: '',
                            payment_date: new Date().toISOString().slice(0, 10),
                            payment_bank: '',
                            payment_note: '',
                          });
                          setPaymentProofFile(null);
                          const alert = await checkDuplicateBeforePayment(invoice);
                          if (alert.flagged || alert.potentialMatches.length > 0) {
                            setDuplicateAlert(alert);
                            setDuplicateAlertOpen(true);
                          } else {
                            setMarkPaidOpen(true);
                          }
                        }}
                      >
                        <CheckCircle className="mr-2 h-4 w-4" />
                        Mark as Paid
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Push to Tally (for approved invoices) */}
            {invoice.status === 'Approved' && (
              <Card>
                <CardContent className="pt-6">
                  <Button
                    variant={invoice.tally_synced ? 'outline' : 'default'}
                    className={invoice.tally_synced ? 'bg-green-50 text-green-800 border-green-200 hover:bg-green-100' : 'bg-[#1a56db] hover:bg-[#1d4ed8]'}
                    onClick={async () => {
                      try {
                        const tallyCfg = toTallySettings(tallySettings);
                        const result = await pushToTallyPrime([invoice], tallyCfg);
                        if (result.success) {
                          await supabase
                            .from('invoices')
                            .update({
                              tally_synced: true,
                              tally_synced_at: new Date().toISOString(),
                            })
                            .eq('id', invoice.id);
                          toast({ title: 'Success', description: result.message });
                          onUpdate();
                        } else {
                          toast({ title: 'Tally error', description: result.message, variant: 'destructive' });
                        }
                      } catch (e) {
                        toast({ title: 'Error', description: String(e), variant: 'destructive' });
                      }
                    }}
                  >
                    {invoice.tally_synced ? 'âœ… Synced to TallyPrime' : 'ðŸ“Š Push to TallyPrime'}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Push to Zoho Books (for approved invoices when Zoho is configured) */}
            {invoice.status === 'Approved' && zohoSettings?.client_id && (
              <Card>
                <CardContent className="pt-6">
                  <Button
                    variant="outline"
                    disabled={zohoPushing}
                    className="border-[#E42527] text-[#E42527] hover:bg-red-50"
                    onClick={async () => {
                      if (!zohoSettings) return;
                      setZohoPushing(true);
                      try {
                        const result = await pushInvoiceToZoho(invoice, zohoSettings);
                        if (result.success) {
                          toast({ title: 'Zoho Books', description: result.message });
                          onUpdate();
                        } else {
                          toast({ title: 'Zoho error', description: result.message, variant: 'destructive' });
                        }
                      } catch (e) {
                        toast({ title: 'Error', description: String(e), variant: 'destructive' });
                      } finally {
                        setZohoPushing(false);
                      }
                    }}
                  >
                    {zohoPushing ? 'â³ Pushingâ€¦' : 'ðŸ“— Push to Zoho Books'}
                  </Button>
                </CardContent>
              </Card>
            )}

            {invoice.rejection_reason && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-red-600" />
                    Rejection Reason
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-700">{invoice.rejection_reason}</p>
                </CardContent>
              </Card>
            )}

            {/* Risk Analysis */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-amber-600" />
                  Risk Analysis
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div>
                  {/* Score header */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '14px 16px',
                      background:
                        (invoice?.risk_level ?? invoice?.risk_score) === 'High' || invoice?.risk_score === 'high'
                          ? '#fee2e2'
                          : (invoice?.risk_level ?? invoice?.risk_score) === 'Medium' || invoice?.risk_score === 'medium'
                          ? '#fff7ed'
                          : '#f0fdf4',
                      borderRadius: '8px',
                      marginBottom: '14px',
                      border: `1px solid ${
                        (invoice?.risk_level ?? invoice?.risk_score) === 'High' || invoice?.risk_score === 'high'
                          ? '#fca5a5'
                          : (invoice?.risk_level ?? invoice?.risk_score) === 'Medium' || invoice?.risk_score === 'medium'
                          ? '#fed7aa'
                          : '#bbf7d0'
                      }`,
                    }}
                  >
                    <span
                      style={{
                        fontSize: '22px',
                        fontWeight: 800,
                        color:
                          riskDisplayScore >= 60 ||
                          (invoice?.risk_level ?? invoice?.risk_score) === 'High' ||
                          invoice?.risk_score === 'high'
                            ? '#ef4444'
                            : riskDisplayScore >= 30 ||
                                (invoice?.risk_level ?? invoice?.risk_score) === 'Medium' ||
                                invoice?.risk_score === 'medium'
                              ? '#f97316'
                              : '#22c55e',
                      }}
                    >
                      {riskDisplayScore}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: '4px',
                        }}
                      >
                        <span
                          style={{
                            fontSize: '13px',
                            fontWeight: 700,
                            color:
                              riskDisplayScore >= 60 ||
                              (invoice?.risk_level ?? invoice?.risk_score) === 'High' ||
                              invoice?.risk_score === 'high'
                                ? '#ef4444'
                                : riskDisplayScore >= 30 ||
                                    (invoice?.risk_level ?? invoice?.risk_score) === 'Medium' ||
                                    invoice?.risk_score === 'medium'
                                  ? '#f97316'
                                  : '#22c55e',
                          }}
                        >
                          {invoice?.risk_level ?? (invoice?.risk_score === 'high' ? 'High' : invoice?.risk_score === 'medium' ? 'Medium' : 'Low')} Risk
                        </span>
                        <span style={{ fontSize: '12px', color: '#6b7280' }}>
                          {parsedRiskFlags.length} flag{parsedRiskFlags.length !== 1 ? 's' : ''} detected
                        </span>
                      </div>
                      <div
                        style={{
                          height: '6px',
                          background: '#e5e7eb',
                          borderRadius: '3px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${Math.min(100, riskDisplayScore)}%`,
                            height: '100%',
                            background:
                              riskDisplayScore >= 60 ||
                              (invoice?.risk_level ?? invoice?.risk_score) === 'High' ||
                              invoice?.risk_score === 'high'
                                ? '#ef4444'
                                : riskDisplayScore >= 30 ||
                                    (invoice?.risk_level ?? invoice?.risk_score) === 'Medium' ||
                                    invoice?.risk_score === 'medium'
                                  ? '#f97316'
                                  : '#22c55e',
                            borderRadius: '3px',
                            transition: 'width 0.6s ease',
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Individual flag cards */}
                  {parsedRiskFlags.length > 0 ? (
                    parsedRiskFlags.map((flag: { severity?: string; message?: string; explanation?: string }, i: number) => {
                      const cfg = SEVERITY[(flag.severity as keyof typeof SEVERITY) || 'low'] || SEVERITY.low;
                      return (
                        <div
                          key={i}
                          style={{
                            background: cfg.bg,
                            border: `1px solid ${cfg.border}`,
                            borderRadius: '8px',
                            padding: '12px 14px',
                            marginBottom: '8px',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              marginBottom: flag.explanation ? '6px' : '0',
                            }}
                          >
                            <span style={{ fontSize: '15px' }}>{cfg.icon}</span>
                            <span
                              style={{
                                fontSize: '13px',
                                fontWeight: 700,
                                color: cfg.text,
                                flex: 1,
                              }}
                            >
                              {flag.message}
                            </span>
                            <span
                              style={{
                                fontSize: '10px',
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: '20px',
                                background: cfg.border,
                                color: cfg.text,
                                whiteSpace: 'nowrap' as const,
                              }}
                            >
                              {cfg.label}
                            </span>
                          </div>
                          {flag.explanation && (
                            <p
                              style={{
                                fontSize: '12px',
                                color: cfg.text,
                                opacity: 0.85,
                                lineHeight: '1.55',
                                margin: '0 0 0 23px',
                              }}
                            >
                              {flag.explanation}
                            </p>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div
                      style={{
                        background: '#f0fdf4',
                        border: '1px solid #bbf7d0',
                        borderRadius: '8px',
                        padding: '14px',
                        textAlign: 'center',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: '#166534',
                      }}
                    >
                      âœ… No risk flags detected for this invoice
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* 3-Way Match */}
            <Card
              className={
                invoice.match_status === 'three_way_matched'
                  ? 'border-2 border-green-500 bg-green-50/30'
                  : invoice.match_status === 'matched'
                    ? 'border-2 border-teal-500 bg-teal-50/20'
                    : invoice.match_status === 'mismatch'
                      ? 'border-2 border-amber-500 bg-amber-50/20'
                      : invoice.match_status === 'partial'
                        ? 'border-2 border-amber-400 bg-amber-50/15'
                        : invoice.match_status === 'no_po' || !invoice.match_status
                          ? 'border-2 border-red-300 bg-red-50/10'
                          : 'border border-gray-200'
              }
            >
              <CardHeader
                className={
                  invoice.match_status === 'three_way_matched'
                    ? 'bg-green-100/80 border-b border-green-200'
                    : invoice.match_status === 'matched'
                      ? 'bg-teal-100/60 border-b border-teal-200'
                      : invoice.match_status === 'mismatch'
                        ? 'bg-amber-100/60 border-b border-amber-200'
                        : invoice.match_status === 'partial'
                          ? 'bg-amber-50 border-b border-amber-200'
                          : invoice.match_status === 'no_po' || !invoice.match_status
                            ? 'bg-red-50 border-b border-red-200'
                            : ''
                }
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-lg">3-Way Match Result</CardTitle>
                  <div className="flex items-center gap-2">
                    {invoice.match_score != null && (
                      <span className="text-sm font-semibold text-gray-800">
                        Score: {Math.round(Number(invoice.match_score))}/100
                      </span>
                    )}
                    {invoice.match_status ? (
                      <Badge variant="outline" className={getMatchStatusColor(invoice.match_status)}>
                        {invoice.match_status === 'three_way_matched' && '3-Way Matched'}
                        {invoice.match_status === 'matched' && 'PO Matched'}
                        {invoice.match_status === 'partial' && 'Partial'}
                        {invoice.match_status === 'mismatch' && 'Variance'}
                        {invoice.match_status === 'no_po' && 'No PO'}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-gray-100 text-gray-800 border-gray-200">
                        No PO
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <ul className="space-y-2 text-sm">
                  <li className="flex gap-2">
                    <span className="w-5 shrink-0">{invoice.po_id || invoice.po_number ? 'âœ“' : 'âœ—'}</span>
                    <span>
                      {invoice.po_id || invoice.po_number ? 'PO matched' : 'No PO found'}{' '}
                      {invoice.po_number && (
                        <span className="text-gray-700">
                          {invoice.po_number} Â· {formatCurrency(invoice.po_amount ?? 0, invoice.currency || 'USD')}
                        </span>
                      )}
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="w-5 shrink-0">
                      {invoice.match_status === 'three_way_matched' || (invoice.grn_amount ?? 0) > 0 ? 'âœ“' : 'â€”'}
                    </span>
                    <span>
                      {invoice.match_status === 'three_way_matched' || (invoice.grn_amount ?? 0) > 0
                        ? 'GRN confirmed / value recorded'
                        : 'GRN not found or empty'}
                      {(invoice.grn_amount ?? 0) > 0 && (
                        <span className="text-gray-700">
                          {' '}
                          Â· {formatCurrency(invoice.grn_amount ?? 0, invoice.currency || 'USD')}
                        </span>
                      )}
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="w-5 shrink-0">
                      {invoice.match_status === 'mismatch' ? 'âœ—' : invoice.po_amount != null ? 'âœ“' : 'â€”'}
                    </span>
                    <span>
                      {invoice.match_status === 'mismatch' ? 'Amount variance' : 'Amount vs PO'}{' '}
                      <span className="text-gray-700">
                        Invoice {formatCurrency(Number(invoice.total_amount), invoice.currency || 'USD')}
                        {invoice.po_amount != null &&
                          ` vs PO ${formatCurrency(invoice.po_amount, invoice.currency || 'USD')}`}
                        {invoice.match_percentage != null && ` (${invoice.match_percentage.toFixed(1)}%)`}
                      </span>
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="w-5 shrink-0">â€¢</span>
                    <span className="text-gray-700">Vendor: {invoice.vendor_name || 'â€”'}</span>
                  </li>
                </ul>

                {invoice.match_notes && (
                  <p className="rounded-md bg-white/80 p-3 text-sm text-gray-700 border border-gray-100">
                    {invoice.match_notes}
                  </p>
                )}

                {(invoice.match_status === 'matched' || invoice.match_status === 'three_way_matched') && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
                      <p className="text-xs text-gray-500">PO</p>
                      <p className="font-semibold">{formatCurrency(invoice.po_amount ?? 0, invoice.currency || 'USD')}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
                      <p className="text-xs text-gray-500">GRN</p>
                      <p className="font-semibold">{formatCurrency(invoice.grn_amount ?? 0, invoice.currency || 'USD')}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
                      <p className="text-xs text-gray-500">Invoice</p>
                      <p className="font-semibold">{formatCurrency(Number(invoice.total_amount), invoice.currency || 'USD')}</p>
                    </div>
                  </div>
                )}

                {invoice.approval_status === 'approved' && invoice.auto_matched && (
                  <p className="text-sm font-semibold text-green-800">
                    AUTO-APPROVED Â· system match
                    {invoice.match_attempted_at &&
                      ` Â· ${format(new Date(invoice.match_attempted_at), 'dd MMM yyyy HH:mm')}`}
                  </p>
                )}

                {invoice.match_status === 'mismatch' && (
                  <div className="flex flex-wrap gap-2">
                    {(invoice.po_id || purchaseOrders.find((p) => p.po_number === invoice.po_number)?.id) && (
                      <Button type="button" size="sm" variant="secondary" asChild>
                        <Link
                          to={`/goods-receipts?poId=${invoice.po_id ?? purchaseOrders.find((p) => p.po_number === invoice.po_number)?.id}`}
                        >
                          Create GRN
                        </Link>
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-amber-600 text-amber-900"
                      disabled={loading || invoice.status !== 'Processing'}
                      onClick={() => void handleStatusChange('Approved')}
                    >
                      Override &amp; Approve
                    </Button>
                  </div>
                )}

                {(invoice.match_status === 'matched' || invoice.match_status === 'three_way_matched') && (
                  <div className="space-y-2 border-t border-gray-200 pt-3">
                    <p className="text-xs font-semibold text-gray-600">Manual receipt confirmation (optional)</p>
                    {invoice.grn_confirmed ? (
                      <p className="text-xs text-green-800">
                        Confirmed by {invoice.grn_confirmed_by ?? 'â€”'} on{' '}
                        {invoice.grn_confirmed_at ? format(new Date(invoice.grn_confirmed_at), 'PPp') : 'â€”'}
                      </p>
                    ) : (
                      <>
                        <Input
                          placeholder="Your name"
                          value={grnConfirmedBy}
                          onChange={(e) => setGrnConfirmedBy(e.target.value)}
                          className="max-w-xs"
                        />
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700"
                          onClick={async () => {
                            const { error } = await supabase
                              .from('invoices')
                              .update({
                                grn_confirmed: true,
                                grn_confirmed_by: grnConfirmedBy || 'Unknown',
                                grn_confirmed_at: new Date().toISOString(),
                                match_status: 'three_way_matched',
                              })
                              .eq('id', invoice.id);
                            if (error) {
                              toast({ title: 'Error', description: error.message, variant: 'destructive' });
                            } else {
                              toast({ title: 'Receipt confirmed', variant: 'default' });
                              onUpdate();
                            }
                          }}
                        >
                          Confirm goods/services received
                        </Button>
                      </>
                    )}
                  </div>
                )}

                {invoice.match_status === 'partial' && (
                  <div className="rounded-md border border-amber-100 bg-amber-50/40 p-3 text-sm text-amber-950 space-y-2">
                    <p>PO linked â€” waiting for a confirmed goods receipt or further review.</p>
                    {invoice.po_id && (
                      <Button type="button" size="sm" variant="secondary" asChild>
                        <Link to={`/goods-receipts?poId=${invoice.po_id}`}>Create GRN</Link>
                      </Button>
                    )}
                  </div>
                )}

                {(invoice.match_status === 'no_po' || !invoice.match_status) && (
                  <div className="rounded-md border border-red-100 bg-red-50/30 p-3 text-sm text-gray-900">
                    <p className="mb-2">No purchase order linked to this invoice.</p>
                    <div className="space-y-2">
                      <Label>Link a Purchase Order</Label>
                      <Select value={selectedPoNumber} onValueChange={setSelectedPoNumber}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select PO" />
                        </SelectTrigger>
                        <SelectContent>
                          {purchaseOrders.length === 0 ? (
                            <div className="px-2 py-4 text-sm text-gray-400 italic">No purchase orders yet.</div>
                          ) : (
                            (() => {
                              const forVendor = purchaseOrders.filter(
                                (po) => !invoice.vendor_name || po.vendor_name === invoice.vendor_name
                              );
                              const list = forVendor.length > 0 ? forVendor : purchaseOrders;
                              return list.map((po) => (
                                <SelectItem key={po.id} value={po.po_number}>
                                  {po.po_number} â€” {formatCurrency(Number(po.po_amount), invoice.currency || 'USD')}
                                </SelectItem>
                              ));
                            })()
                          )}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        disabled={matchLoading || !selectedPoNumber}
                        onClick={handleLinkPoAndRunMatch}
                      >
                        {matchLoading ? 'Runningâ€¦' : 'Link PO & Run Match'}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* GL Coding */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">GL Coding</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {needsGlConfirmationBanner && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                    <p className="font-medium">
                      &quot;{invoice.ifrs_category?.trim() || 'This invoice'}&quot; may not be in your chart of accounts yet.
                    </p>
                    <p className="mt-2 text-amber-900">
                      Suggested:{' '}
                      <span className="font-mono font-semibold">{invoice.gl_account_code ?? invoice.gl_code}</span>
                      {' â€” '}
                      <span className="font-medium">{invoice.gl_account_name ?? invoice.gl_name}</span>
                      {invoice.gl_suggestion_source === 'standard_fallback'
                        ? ' (aligned with your accounting standard)'
                        : ' (AI suggestion â€” please verify)'}
                      {invoice.gl_standard_ref ? (
                        <span className="block mt-1 text-xs">Standard reference: {invoice.gl_standard_ref}</span>
                      ) : null}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="secondary" disabled={loading} onClick={() => void handleGlBannerAddToChart()}>
                        Add to my chart
                      </Button>
                      <Button type="button" size="sm" variant="outline" disabled={loading} onClick={handleGlBannerPickDifferent}>
                        Pick different code
                      </Button>
                      <Button type="button" size="sm" className="bg-amber-700 hover:bg-amber-800 text-white" disabled={loading} onClick={() => void handleGlBannerKeepAsIs()}>
                        Keep as is
                      </Button>
                    </div>
                  </div>
                )}
                {(invoice.gl_auto_suggested && (invoice.gl_account_code || invoice.gl_code)) ? (
                  <div className="rounded-lg border-2 border-blue-200 bg-blue-50 p-4">
                    <p className="text-xs font-medium text-blue-800 mb-2">
                      {invoice.gl_source === 'company_coa' ? 'ðŸ¢ From your COA' : 'ðŸ¤– Auto-suggested from IFRS category'}
                    </p>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">GL Code:</span>
                      <span className="font-mono font-semibold text-blue-900">{invoice.gl_account_code ?? invoice.gl_code}</span>
                    </div>
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-gray-600">GL Name:</span>
                      <span className="font-medium text-blue-900">{invoice.gl_account_name ?? invoice.gl_name ?? 'â€”'}</span>
                    </div>
                  </div>
                ) : (invoice.gl_code || invoice.gl_account_code) ? (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">GL Code:</span>
                        <span className="font-mono font-medium">{invoice.gl_account_code ?? invoice.gl_code}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">GL Name:</span>
                        <span className="font-medium">{invoice.gl_account_name ?? invoice.gl_name ?? 'â€”'}</span>
                      </div>
                      {invoice.gl_source && (
                        <p
                          className="text-xs font-semibold mt-1"
                          style={{ color: invoice.gl_source === 'company_coa' ? '#0e9f6e' : '#6b7280' }}
                        >
                          {invoice.gl_source === 'company_coa' ? 'ðŸ¢ From your COA' : 'ðŸ¤– IFRS Auto'}
                        </p>
                      )}
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <Label>Department</Label>
                  <Select
                    value={editedInvoice.department || ''}
                    onValueChange={(value) =>
                      setEditedInvoice({ ...editedInvoice, department: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      {['Administration', 'Operations', 'IT', 'Marketing', 'Sales', 'Facilities', 'Procurement', 'Finance', 'Admin'].map((d) => (
                        <SelectItem key={d} value={d}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cost_center">Cost Center</Label>
                  <Input
                    id="cost_center"
                    value={editedInvoice.cost_center || ''}
                    onChange={(e) =>
                      setEditedInvoice({ ...editedInvoice, cost_center: e.target.value })
                    }
                    placeholder="e.g. ADM-001"
                  />
                </div>
                <div
                  id="gl-override-select-wrap"
                  className={`space-y-2 rounded-md p-1 transition-shadow ${highlightGlPicker ? 'ring-2 ring-blue-500 ring-offset-2' : ''}`}
                >
                  <Label>Override GL</Label>
                  <Select
                    value={editedInvoice.gl_code || ''}
                    onValueChange={(value) => {
                      const account = glAccounts.find((acc) => acc.gl_code === value);
                      setEditedInvoice({
                        ...editedInvoice,
                        gl_code: value,
                        gl_name: account?.gl_name ?? '',
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select GL account" />
                    </SelectTrigger>
                    <SelectContent>
                      {glAccounts.map((account) => (
                        <SelectItem key={account.id} value={account.gl_code}>
                          {account.gl_code} â€” {account.gl_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleSave}
                  disabled={loading}
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </Button>
              </CardContent>
            </Card>

            {/* Audit Trail */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Audit Trail</CardTitle>
              </CardHeader>
              <CardContent>
                {auditLogs.length > 0 ? (
                  <div className="space-y-3">
                    {auditLogs.map((log) => (
                      <div
                        key={log.id}
                        className="flex items-start gap-3 rounded-lg border border-gray-200 p-3"
                      >
                        <div className="mt-0.5 rounded-full bg-blue-100 p-2">
                          <Clock className="h-4 w-4 text-blue-600" />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium">{log.action}</p>
                          {log.field_changed && (
                            <p className="text-xs text-gray-600">
                              {log.field_changed}
                              {log.old_value && log.new_value && (
                                <span>
                                  : {log.old_value} â†’ {log.new_value}
                                </span>
                              )}
                            </p>
                          )}
                          <p className="mt-1 text-xs text-gray-500">
                            {log.user_name} â€¢{' '}
                            {format(new Date(log.created_at), 'MMM dd, yyyy HH:mm')}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-sm text-gray-500">No audit logs yet</p>
                )}
              </CardContent>
            </Card>

            {/* Action Buttons */}
            {invoice.status === 'Processing' &&
              !isEditing &&
              (invoice.approval_status ?? 'not_required') !== 'pending' && (
              <div className="flex gap-3">
                <Button
                  className="flex-1 bg-green-600 hover:bg-green-700"
                  onClick={() => handleStatusChange('Approved')}
                  disabled={loading || ['no_po', 'partial', 'mismatch'].includes((invoice.match_status || '').toLowerCase())}
                >
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Approve Invoice
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => handleStatusChange('Rejected')}
                  disabled={loading}
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Reject Invoice
                </Button>
              </div>
            )}
                </TabsContent>
                <TabsContent value="gst" className="mt-0 space-y-4 focus-visible:ring-0 focus-visible:ring-offset-0">
                  <Card>
                    <CardHeader>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="text-lg">{isUAE ? 'VAT' : 'GST'}</CardTitle>
                        <Badge
                          variant="outline"
                          className={
                            invoice.gst_recon_status === 'matched'
                              ? 'bg-green-50 text-green-800 border-green-200'
                              : invoice.gst_recon_status === 'mismatch'
                                ? 'bg-red-50 text-red-800 border-red-200'
                                : invoice.gst_recon_status === 'ignored'
                                  ? 'bg-gray-100 text-gray-700 border-gray-200'
                                  : 'bg-amber-50 text-amber-900 border-amber-200'
                          }
                        >
                          {invoice.gst_recon_status ?? 'unmatched'}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-500">
                        Recon period (from invoice date):{' '}
                        <span className="font-mono">{invoicePeriodFromDate(invoice.invoice_date) || 'â€”'}</span>
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {isUAE ? (
                        <div className="space-y-4">
                          <p className="text-xs text-gray-600">UAE VAT fields â€” TRN validation per Federal Decree No. 8 of 2017.</p>
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2 md:col-span-2">
                              <Label>Vendor TRN (on invoice)</Label>
                              <Input
                                className="font-mono text-sm"
                                value={(editedInvoice as Record<string, unknown>).vendor_trn as string ?? ''}
                                onChange={(e) => setEditedInvoice({ ...editedInvoice, vendor_trn: e.target.value } as typeof editedInvoice)}
                                placeholder="100234567890123"
                              />
                              {((editedInvoice as Record<string, unknown>).vendor_trn as string) && (
                                <p className={`text-xs font-medium ${validateTaxId((editedInvoice as Record<string, unknown>).vendor_trn as string, 'uae') ? 'text-green-700' : 'text-red-600'}`}>
                                  {validateTaxId((editedInvoice as Record<string, unknown>).vendor_trn as string, 'uae') ? 'âœ“ Valid TRN' : 'âœ— Must be 15 digits starting with 1'}
                                </p>
                              )}
                            </div>
                            <div className="space-y-2 md:col-span-2">
                              <Label>VAT Amount (AED)</Label>
                              <Input
                                type="number"
                                step="0.01"
                                value={(editedInvoice as Record<string, unknown>).vat_amount as number ?? ''}
                                onChange={(e) => setEditedInvoice({ ...editedInvoice, vat_amount: parseFloat(e.target.value) || 0 } as typeof editedInvoice)}
                              />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                              <Label>VAT Treatment</Label>
                              <select
                                value={(editedInvoice as Record<string, unknown>).vat_treatment as string ?? 'standard'}
                                onChange={(e) => setEditedInvoice({ ...editedInvoice, vat_treatment: e.target.value } as typeof editedInvoice)}
                                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                              >
                                {VAT_TREATMENT_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div className="flex gap-4">
                            <Button type="button" className="bg-[#0A4B8F]" disabled={loading} onClick={() => void handleSaveGst()}>
                              <Save className="h-4 w-4 mr-2" />
                              Save VAT fields
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={async () => {
                                const inv = invoice as Record<string, unknown>;
                                const result = await classifyVATWithGulfTax({
                                  vendor_name: invoice.vendor_name,
                                  description: inv.description as string | undefined,
                                  total_amount: invoice.total_amount,
                                  vendor_trn: inv.vendor_trn as string | undefined,
                                });
                                toast({ title: `GulfTax: ${result.treatment} (${result.applicable_rate}%)`, description: result.reason });
                              }}
                            >
                              ðŸ” Validate in GulfTax AI
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <p className="text-xs text-gray-600">
                            Company GSTIN is stored in the browser on the GST Recon page (
                            <span className="font-mono">invoiceflow_company_gstin</span>).
                          </p>
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2 md:col-span-2">
                              <Label>Supplier GSTIN (on invoice)</Label>
                              <Input
                                className="font-mono text-sm"
                                value={editedInvoice.gstin ?? ''}
                                onChange={(e) => setEditedInvoice({ ...editedInvoice, gstin: e.target.value })}
                                placeholder="15-character GSTIN"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>CGST</Label>
                              <Input
                                type="number"
                                step="0.01"
                                value={editedInvoice.cgst ?? ''}
                                onChange={(e) =>
                                  setEditedInvoice({ ...editedInvoice, cgst: parseFloat(e.target.value) || 0 })
                                }
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>SGST</Label>
                              <Input
                                type="number"
                                step="0.01"
                                value={editedInvoice.sgst ?? ''}
                                onChange={(e) =>
                                  setEditedInvoice({ ...editedInvoice, sgst: parseFloat(e.target.value) || 0 })
                                }
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>IGST</Label>
                              <Input
                                type="number"
                                step="0.01"
                                value={editedInvoice.igst ?? ''}
                                onChange={(e) =>
                                  setEditedInvoice({ ...editedInvoice, igst: parseFloat(e.target.value) || 0 })
                                }
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Total GST amount</Label>
                              <Input
                                type="number"
                                step="0.01"
                                value={editedInvoice.gst_amount ?? ''}
                                onChange={(e) =>
                                  setEditedInvoice({ ...editedInvoice, gst_amount: parseFloat(e.target.value) || 0 })
                                }
                              />
                            </div>
                          </div>
                          <Button type="button" className="bg-[#0A4B8F]" disabled={loading} onClick={() => void handleSaveGst()}>
                            <Save className="h-4 w-4 mr-2" />
                            Save GST fields
                          </Button>
                        </div>
                      )}

                      {invoice.gst_recon_status === 'mismatch' && gstrPortalRow && (
                        <div className="rounded-lg border border-red-200 bg-red-50/50 p-4 space-y-2">
                          <p className="text-sm font-semibold text-red-900">GSTR-2B vs invoice</p>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <span className="text-gray-600">Portal total GST</span>
                            <span className="font-mono">{Number(gstrPortalRow.total_gst).toFixed(2)}</span>
                            <span className="text-gray-600">Invoice GST</span>
                            <span className="font-mono">{Number(invoice.gst_amount ?? 0).toFixed(2)}</span>
                            <span className="text-gray-600">Portal IGST/CGST/SGST</span>
                            <span className="font-mono">
                              {Number(gstrPortalRow.igst).toFixed(2)} / {Number(gstrPortalRow.cgst).toFixed(2)} /{' '}
                              {Number(gstrPortalRow.sgst).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
                <TabsContent value="approval" className="mt-0 focus-visible:ring-0 focus-visible:ring-offset-0">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Approval</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ApprovalChainPanel invoice={invoice} onRefresh={onUpdate} />
                    </CardContent>
                  </Card>
                </TabsContent>
                <TabsContent value="activity" className="mt-0 focus-visible:ring-0 focus-visible:ring-offset-0">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Activity</CardTitle>
                      <p className="text-xs text-muted-foreground">
                        Compliance audit entries for this invoice (newest first)
                      </p>
                    </CardHeader>
                    <CardContent>
                      {activityLoading ? (
                        <p className="text-sm text-gray-500">Loadingâ€¦</p>
                      ) : activityEntries.length === 0 ? (
                        <p className="text-center text-sm text-gray-500 py-6">No activity recorded yet</p>
                      ) : (
                        <ul className="space-y-3">
                          {activityEntries.map((e) => (
                            <li
                              key={e.id}
                              className="rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2 text-sm"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className={
                                    e.action.startsWith('approval.')
                                      ? 'bg-purple-50 text-purple-800 border-purple-200'
                                      : e.action.startsWith('payment.')
                                        ? 'bg-blue-50 text-blue-800 border-blue-200'
                                        : e.action.startsWith('gst.')
                                          ? 'bg-green-50 text-green-800 border-green-200'
                                          : e.action.startsWith('duplicate.')
                                            ? 'bg-amber-50 text-amber-900 border-amber-200'
                                            : 'bg-gray-50 text-gray-800 border-gray-200'
                                  }
                                >
                                  {e.action}
                                </Badge>
                                <span className="text-xs text-gray-500">
                                  {format(new Date(e.created_at), 'dd MMM yyyy, HH:mm')}
                                </span>
                                {e.performed_by ? (
                                  <span className="text-xs text-gray-600 truncate max-w-[200px]">
                                    {e.performed_by}
                                  </span>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                className="mt-2 text-xs text-blue-600 hover:underline"
                                onClick={() =>
                                  setExpandedActivityId((prev) => (prev === e.id ? null : e.id))
                                }
                              >
                                {expandedActivityId === e.id ? 'Hide details' : 'Show details'}
                              </button>
                              {expandedActivityId === e.id ? (
                                <pre className="mt-2 max-h-32 overflow-auto rounded bg-white p-2 text-[11px] border">
                                  {JSON.stringify(e.metadata ?? {}, null, 2)}
                                </pre>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>

    {/* Duplicate alert before payment */}
    <Dialog open={duplicateAlertOpen} onOpenChange={setDuplicateAlertOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>âš ï¸ Possible Duplicate Invoice</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {duplicateAlert?.flagged && (
            <p className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-800 font-medium">
              This invoice is flagged as a duplicate in the database.
            </p>
          )}
          {(duplicateAlert?.potentialMatches.length ?? 0) > 0 && (
            <div>
              <p className="text-gray-700 mb-2">Found {duplicateAlert!.potentialMatches.length} other invoice(s) with the same vendor and amount:</p>
              <div className="space-y-1.5">
                {duplicateAlert!.potentialMatches.map((m) => (
                  <div key={m.id} className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                    <span className="font-semibold">{m.invoice_number}</span> â€” {m.vendor_name} â€” {m.currency} {Number(m.total_amount).toLocaleString()} â€” {m.invoice_date} â€” <span className="italic">{m.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="text-gray-600">Are you sure you want to proceed with payment?</p>
        </div>
        <div className="flex gap-2 mt-4 justify-end">
          <Button variant="outline" onClick={() => setDuplicateAlertOpen(false)}>Cancel</Button>
          <Button
            className="bg-red-600 hover:bg-red-700 text-white"
            onClick={() => { setDuplicateAlertOpen(false); setMarkPaidOpen(true); }}
          >
            Pay Anyway
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={markPaidOpen} onOpenChange={setMarkPaidOpen}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mark invoice as paid</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground border-b pb-3">
          <span className="font-mono font-medium">{invoice.invoice_number}</span>
          {' Â· '}
          {invoice.vendor_name}
          {' Â· '}
          {formatCurrency(Number(invoice.total_amount), invoice.currency || 'USD')}
        </p>
        <div className="space-y-3 py-3">
          <div className="space-y-2">
            <Label>Payment method</Label>
            <Select
              value={markPaidForm.payment_method}
              onValueChange={(v) => setMarkPaidForm((s) => ({ ...s, payment_method: v }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['NEFT', 'IMPS', 'RTGS', 'UPI', 'Cheque', 'Cash', 'Card', 'Other'].map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>
              UTR / reference{' '}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              placeholder="e.g. HDFC/UTR/042819384"
              value={markPaidForm.utr_number}
              onChange={(e) => setMarkPaidForm((s) => ({ ...s, utr_number: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">UPI ref, cheque no., or free-text reference is fine.</p>
          </div>
          <div className="space-y-2">
            <Label>Payment date</Label>
            <Input
              type="date"
              value={markPaidForm.payment_date}
              onChange={(e) => setMarkPaidForm((s) => ({ ...s, payment_date: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>
              Paying bank <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              placeholder="e.g. HDFC Bank"
              value={markPaidForm.payment_bank}
              onChange={(e) => setMarkPaidForm((s) => ({ ...s, payment_bank: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>
              Note <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              value={markPaidForm.payment_note}
              onChange={(e) => setMarkPaidForm((s) => ({ ...s, payment_note: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>
              Payment Proof <span className="text-muted-foreground font-normal">(screenshot / receipt â€” optional)</span>
            </Label>
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={(e) => setPaymentProofFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm border border-gray-200 rounded-lg px-3 py-2 file:mr-3 file:py-1 file:px-2 file:border-0 file:rounded file:bg-blue-50 file:text-blue-700 file:text-xs"
            />
            {paymentProofFile && (
              <p className="text-xs text-gray-500">Selected: {paymentProofFile.name}</p>
            )}
            {paymentProofUploading && <p className="text-xs text-blue-600">Uploading proofâ€¦</p>}
          </div>
          {invoice.payment_proof_url && (
            <div className="text-sm">
              <span className="text-gray-600">Existing proof: </span>
              <a href={invoice.payment_proof_url} target="_blank" rel="noreferrer" className="text-blue-600 underline text-xs">View</a>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button type="button" variant="outline" onClick={() => setMarkPaidOpen(false)} disabled={markPaidSaving}>
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-[#0A4B8F]"
            onClick={() => void confirmMarkPaid()}
            disabled={markPaidSaving}
          >
            {markPaidSaving ? 'Savingâ€¦' : 'Confirm payment'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}

