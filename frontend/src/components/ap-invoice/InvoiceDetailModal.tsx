import { useEffect, useState, useMemo, useRef } from 'react';
import { useMarket } from '@/contexts/MarketContext';
import { CostCenterSelect } from '@/components/industry/CostCenterSelect';
import { PropertyCombobox } from '@/components/ap-invoice/PropertyCombobox';
import { validateTaxId, VAT_TREATMENT_OPTIONS } from '@/lib/ap-invoice/marketConfig';
import { classifyVATWithGulfTax } from '@/lib/ap-invoice/gulfTaxService';
import {
  supabase,
  type Invoice,
  type InvoiceLineItem,
  type AuditLog,
  type AuditLogEntry,
  type GLAccount,
  type PurchaseOrder,
  type Gstr2bEntry,
} from '@/lib/ap-invoice/supabase';
import { getAuditLog, logAction, getInvoiceflowWorkEmail } from '@/lib/ap-invoice/auditService';
import {
  getAnomaliesForInvoice,
  resolveAnomaly,
  escalateAnomalyToCFO,
} from '@/lib/ap-invoice/anomalyService';
import { recalcVendorRiskAsync } from '@/lib/ap-invoice/vendorMasterService';
import type { InvoiceAnomaly } from '@/lib/ap-invoice/supabase';
import {
  getEffectiveExtractionScore,
  getExtractionScoreSource,
  getParsedFieldConfidences,
} from '@/utils/extractionConfidence';
import { deriveInvoiceRiskDisplayScore } from '@/lib/ap-invoice/invoiceRiskDisplay';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApprovalChainPanel } from '@/components/approvals/ApprovalChainPanel';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formatApprovedByLabel(inv: Invoice): string {
  if (inv.auto_matched && !inv.approved_by) return 'System (auto-match)';
  if (!inv.approved_by) return '—';
  if (UUID_RE.test(inv.approved_by)) return 'Signed-in user';
  return inv.approved_by;
}
import { DuplicateWarningBanner } from '@/components/invoices/DuplicateWarningBanner';
import { checkDuplicateBeforePayment, type DuplicateAlert } from '@/lib/ap-invoice/duplicateAlertService';
import { pushInvoiceToZoho, loadZohoSettings, type ZohoSettings } from '@/lib/ap-invoice/zohoService';
import { pushInvoiceToQB, loadQBSettings, type QBSettings } from '@/lib/ap-invoice/quickbooksService';
import {
  CheckCircle,
  XCircle,
  Edit2,
  Save,
  FileText,
  Clock,
  Download,
  Trash2,
  UserCheck,
  AlertCircle,
  Copy,
  Calculator,
  Receipt,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { COLORS, Pill, TONE_HEX, type Tone } from '@/pages/ap-invoices/dashboard/ui';
import { INVOICE_SOURCE_LABEL } from '@/lib/ap-invoice/invoiceLabels';
import {
  DetailCard,
  DocumentPreview,
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_TONE,
  InfoRow,
  MATCH_LABEL,
  MATCH_TONE,
  Ring,
  SummaryTile,
  riskLabel,
  riskTone,
  viewableFileUrl,
} from '@/components/ap-invoice/invoice-detail/parts';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { getApprovalLevelName, isPendingApproval } from '@/utils/approvalWorkflow';
import { formatCurrency } from '@/utils/currency';
import { getTaxLabel } from '@/utils/taxConfig';
import { displayDate } from '@/utils/dateUtils';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { getMyCompany } from '@/lib/ap-invoice/companyService';
import { notifyVendorStatusByInvoiceId } from '@/lib/ap-invoice/whatsappService';
import { awaitGlPostAfterApproval } from '@/lib/ap-invoice/glPostService';
import { resolveGLAccount, invoiceGlFieldsFromResult } from '@/utils/coaMapping';
import {
  getAccountingStandard,
  logGlSuggestionAction,
} from '@/lib/ap-invoice/accountingStandardService';
import { getMatchStatusColor, resolveDisplayMatchStatus } from '@/utils/threeWayMatch';
import { runAutoMatch } from '@/lib/ap-invoice/threeWayMatchService';
import { pushToTallyPrime } from '@/utils/tallyExport';
import { useErpSettings, toTallySettings } from '@/hooks/useErpSettings';
import {
  applyVendorGstinToInvoicesForName,
  fetchGstr2bByMatchedInvoice,
  fetchGstr2bBySupplierAndInvoice,
  updateInvoiceGstFields,
  suggestTdsSection,
  calculateTds,
  updateInvoiceTdsSection,
  type TdsCalcResult,
} from '@/lib/ap-invoice/gstService';

const TDS_SECTION_OPTIONS = [
  { value: '', label: 'None' },
  { value: '194A', label: '194A — Interest' },
  { value: '194C', label: '194C — Contractor' },
  { value: '194D', label: '194D — Insurance commission' },
  { value: '194H', label: '194H — Commission/brokerage' },
  { value: '194I', label: '194I — Rent (land/building)' },
  { value: '194I(a)', label: '194I(a) — Rent (plant/machinery)' },
  { value: '194J', label: '194J — Professional/technical fees' },
  { value: '194Q', label: '194Q — Purchase of goods' },
];

/** Same key as GST Recon page (localStorage). */
const COMPANY_GSTIN_KEY = 'invoiceflow_company_gstin';

/** GST return period YYYY-MM from invoice date (e.g. for GSTR-2B lookup). */
function invoicePeriodFromDate(dateStr: string | null | undefined): string {
  if (!dateStr || !String(dateStr).trim()) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const LANGUAGE_LABELS: Record<string, string> = {
  en: '🇬🇧 English',
  hi: '🇮🇳 Hindi',
  ar: '🇦🇪 Arabic',
  de: '🇩🇪 German',
  fr: '🇫🇷 French',
  ja: '🇯🇵 Japanese',
  zh: '🇨🇳 Chinese',
  es: '🇪🇸 Spanish',
  pt: '🇧🇷 Portuguese',
  ko: '🇰🇷 Korean',
  it: '🇮🇹 Italian',
  nl: '🇳🇱 Dutch',
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
  const [editedInvoice, setEditedInvoice] = useState(invoice);
  const [loading, setLoading] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [approverName, setApproverName] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const [queryMessage, setQueryMessage] = useState('');
  const [showHoldDialog, setShowHoldDialog] = useState(false);
  const [showQueryDialog, setShowQueryDialog] = useState(false);
  // Suggested (not applied) from IFRS category — user must confirm/edit before it's saved.
  const [tdsSection, setTdsSection] = useState<string>('');
  const [tdsPreview, setTdsPreview] = useState<TdsCalcResult | null>(null);
  const [tdsCalculating, setTdsCalculating] = useState(false);
  const [tdsSuggested, setTdsSuggested] = useState(false);
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
  const [qbPushing, setQbPushing] = useState(false);
  const [qbSettings, setQbSettings] = useState<QBSettings | null>(null);
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
  const [persistedAnomalies, setPersistedAnomalies] = useState<InvoiceAnomaly[]>([]);
  const [anomalyActionLoading, setAnomalyActionLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('details');
  useEffect(() => {
    setActiveTab('details');
  }, [invoice.id]);
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
    critical: { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b', icon: '🚨', label: 'Critical' },
    high: { bg: '#fff7ed', border: '#fed7aa', text: '#9a3412', icon: '🔴', label: 'High' },
    medium: { bg: '#fefce8', border: '#fde68a', text: '#92400e', icon: '🟡', label: 'Medium' },
    low: { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534', icon: '🟢', label: 'Low' },
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
      void getAnomaliesForInvoice(invoice.id).then(setPersistedAnomalies).catch(() => setPersistedAnomalies([]));
      fetchGLAccounts();
      fetchPurchaseOrders();
      loadZohoSettings().then((s) => setZohoSettings(s as ZohoSettings)).catch(() => null);
      loadQBSettings().then((s) => setQbSettings(s as QBSettings)).catch(() => null);
      setEditedInvoice(invoice);
      setSelectedPoNumber(invoice.po_number?.trim() ?? '');
      // Auto-suggest GL account based on IFRS category
      if (invoice.ifrs_category && !invoice.gl_code) {
        autoSuggestGLAccount(invoice.ifrs_category);
      }
      // TDS Section: use what's already saved, otherwise suggest from IFRS
      // category — but never silently apply it. The dropdown shows the
      // suggestion pre-filled and editable; nothing is saved until the
      // approver clicks Save GST fields.
      const savedSection = (invoice.tds_section || '').trim();
      if (savedSection) {
        setTdsSection(savedSection);
        setTdsSuggested(false);
      } else {
        const suggestion = suggestTdsSection(invoice.ifrs_category);
        setTdsSection(suggestion || '');
        setTdsSuggested(!!suggestion);
      }
      setTdsPreview(null);
    } else {
      autoPoMatchAttemptedKeyRef.current = null;
    }
  }, [open, invoice]);

  useEffect(() => {
    if (!open || !tdsSection) {
      setTdsPreview(null);
      return;
    }
    const amount = Number(editedInvoice.taxable_amount ?? editedInvoice.subtotal_amount ?? editedInvoice.total_amount ?? 0);
    if (amount <= 0) {
      setTdsPreview(null);
      return;
    }
    let cancelled = false;
    setTdsCalculating(true);
    calculateTds(tdsSection, amount)
      .then((r) => { if (!cancelled) setTdsPreview(r); })
      .catch(() => { if (!cancelled) setTdsPreview({ ok: false, error: 'Calculation failed' }); })
      .finally(() => { if (!cancelled) setTdsCalculating(false); });
    return () => { cancelled = true; };
  }, [open, tdsSection, editedInvoice.taxable_amount, editedInvoice.subtotal_amount, editedInvoice.total_amount]);

  useEffect(() => {
    if (!open) return;
    const po = invoice.po_number?.trim();
    if (!po && !invoice.po_id) return;

    // Once po_id is set, match_status is a cached value written by the last
    // runAutoMatch — trust it when it looks resolved. Only auto re-run when the
    // cached status still looks unresolved (including null — seed may set po_id
    // without writing match_status).
    const status = String(invoice.match_status || '').toLowerCase() || 'no_po';
    const staleStatuses = ['mismatch', 'no_po', 'partial'];
    if (invoice.po_id && !staleStatuses.includes(status)) return;

    const attemptKey = `${invoice.id}|${po || invoice.po_id}`;
    if (autoPoMatchAttemptedKeyRef.current === attemptKey) return;
    autoPoMatchAttemptedKeyRef.current = attemptKey;

    let cancelled = false;
    setMatchLoading(true);
    void (async () => {
      try {
        await runAutoMatch(invoice.id, {
          respectUploadSetting: false,
          invoice,
          invoiceNumber: invoice.invoice_number,
        });
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
  }, [open, invoice.id, invoice.po_number, invoice.po_id, invoice.match_status, invoice.vendor_name, invoice.total_amount]);

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

  async function handleRerunMatch() {
    setMatchLoading(true);
    try {
      await runAutoMatch(invoice.id, { respectUploadSetting: false });
      toast({ title: 'Match re-run', description: 'Recomputed the 3-way match against current PO/GRN data.' });
      onUpdate();
    } catch (error) {
      console.error('Manual match re-run failed:', error);
      const err = error as { message?: string };
      toast({ title: 'Match re-run failed', description: err?.message || 'Check console.', variant: 'destructive' });
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
          property_ref: editedInvoice.property_ref?.trim() || null,
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
      // TDS only gets written when a section is actually set and the amount
      // clears the threshold — otherwise clear it, never leave a stale number.
      const tdsAmountToSave =
        tdsSection && tdsPreview?.ok && tdsPreview.threshold_met ? tdsPreview.applicable_tds ?? null : null;
      await updateInvoiceTdsSection(invoice.id, tdsSection || null, tdsAmountToSave ?? null);
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
      toast({ title: 'Added to chart', description: `${code} — ${name}` });
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

    const gulfDecision = String(invoice.gulftax_decision ?? '').toUpperCase();
    if (gulfDecision === 'HARD_BLOCK') {
      toast({
        title: 'Cannot approve',
        description: 'VAT classification blocked. Fix the invoice first.',
        variant: 'destructive',
      });
      return;
    }
    if (gulfDecision === 'REVIEW_QUEUE') {
      toast({
        title: 'VAT review recommended',
        description: 'GulfTax flagged this invoice for review. Proceeding with approval.',
      });
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

      void notifyVendorStatusByInvoiceId(invoice.id, 'Approved');

      try {
        const cid = invoice.company_id || (await getMyCompany())?.id || null;
        if (cid) {
          await awaitGlPostAfterApproval(invoice, cid, (opts) =>
            toast({ title: opts.title, description: opts.description, variant: opts.variant }),
          );
        }
      } catch (e) {
        console.warn('[AP] GL post after approval failed:', e);
      }

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
      toast({ title: 'Query sent', description: `Vendor notified: "${queryMessage.slice(0, 60)}…"` });
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

  async function handleAnomalyAction(
    anomalyId: string,
    status: 'investigating' | 'false_positive',
  ) {
    setAnomalyActionLoading(true);
    try {
      const actor = workEmail || 'AP User';
      await resolveAnomaly(anomalyId, status, actor);
      const updated = await getAnomaliesForInvoice(invoice.id);
      setPersistedAnomalies(updated);
      toast({
        title: status === 'false_positive' ? 'Marked false positive' : 'Under investigation',
      });
      onUpdate();
    } catch (e) {
      toast({ title: 'Action failed', variant: 'destructive' });
    } finally {
      setAnomalyActionLoading(false);
    }
  }

  async function handleAnomalyEscalate(anomaly: InvoiceAnomaly) {
    setAnomalyActionLoading(true);
    try {
      const co = await getMyCompany();
      if (!co?.id) throw new Error('No company');
      await escalateAnomalyToCFO({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        vendorName: invoice.vendor_name,
        flagReason: anomaly.flag_reason ?? anomaly.flag_code ?? 'Anomaly flagged',
        actor: workEmail || 'AP User',
        companyId: co.id,
      });
      toast({ title: 'Escalated to CFO', description: 'Added to Action Queue for CFO review.' });
    } catch {
      toast({ title: 'Escalation failed', variant: 'destructive' });
    } finally {
      setAnomalyActionLoading(false);
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
      recalcVendorRiskAsync(invoice.vendor_name);

      await supabase.from('audit_logs').insert({
        invoice_id: invoice.id,
        action: 'Paid',
        field_changed: 'status',
        old_value: invoice.status,
        new_value: 'Paid',
        user_name: email || 'System User',
      });

      void notifyVendorStatusByInvoiceId(invoice.id, 'Paid');

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
        parts.join(' — ') ||
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
      ['no_po', 'partial', 'mismatch'].includes(String(invoice.match_status || '').toLowerCase())
    ) {
      toast({
        title: 'Approval blocked',
        description: 'Resolve 3-way matching first (PO/GRN vs invoice) before approving.',
        variant: 'destructive',
      });
      return;
    }

    if (newStatus === 'Approved') {
      const gulfDecision = String(invoice.gulftax_decision ?? '').toUpperCase();
      if (gulfDecision === 'HARD_BLOCK') {
        toast({
          title: 'Cannot approve',
          description: 'VAT classification blocked. Fix the invoice first.',
          variant: 'destructive',
        });
        return;
      }
      if (gulfDecision === 'REVIEW_QUEUE') {
        toast({
          title: 'VAT review recommended',
          description: 'GulfTax flagged this invoice for review. Proceeding with approval.',
        });
      }
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

      if (newStatus === 'Approved') {
        void notifyVendorStatusByInvoiceId(invoice.id, 'Approved');
        try {
          const cid = invoice.company_id || (await getMyCompany())?.id || null;
          if (cid) {
            await awaitGlPostAfterApproval(invoice, cid, (opts) =>
              toast({ title: opts.title, description: opts.description, variant: opts.variant }),
            );
          }
        } catch (e) {
          console.warn('[AP] GL post after status change failed:', e);
        }
      }

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

  const childDialogOpen = duplicateAlertOpen || markPaidOpen;

  const currency = invoice.currency || 'USD';
  const money = (n: number | null | undefined) => formatCurrency(Number(n ?? 0), currency);
  const isPaid = invoice.status === 'Paid' || invoice.payment_status === 'paid';
  const taxAmount = Number(invoice.tax_amount ?? invoice.vat_amount ?? invoice.gst_amount ?? 0);
  const netAmount = invoice.subtotal_amount
    ? Number(invoice.subtotal_amount)
    : Number(invoice.total_amount) - taxAmount;
  const taxRate = invoice.tax_rate ?? invoice.vat_rate ?? null;
  const taxLabel =
    invoice.tax_code && invoice.tax_code !== 'NONE'
      ? getTaxLabel(invoice.tax_code)
      : isUAE
        ? 'VAT'
        : invoice.tax_type && invoice.tax_type !== 'None'
          ? invoice.tax_type
          : 'Tax';
  const displayMatch = resolveDisplayMatchStatus(invoice);
  const matchTone = MATCH_TONE[displayMatch] ?? 'slate';
  const fileUrl = viewableFileUrl(invoice.file_url);
  const statusTone = INVOICE_STATUS_TONE[invoice.status] ?? 'slate';
  const currentRiskTone = riskTone(riskDisplayScore, invoice.risk_level ?? invoice.risk_score);
  const openAnomalies = persistedAnomalies.filter((a) => a.status === 'open' || a.status === 'investigating').length;
  const extractionScore = getEffectiveExtractionScore(invoice);
  const extractionSource = getExtractionScoreSource(invoice);
  const fieldConfidences = getParsedFieldConfidences(invoice);
  const extractionHint =
    extractionSource === 'ocr'
      ? 'Includes per-field scores from your extraction workflow.'
      : extractionSource === 'ifrs'
        ? 'Aligned with IFRS / classification confidence from n8n.'
        : 'Estimated from how complete the main fields are (no score from AI yet).';
  const fieldLabels: Record<string, string> = {
    vendor_name: 'Vendor',
    total_amount: 'Amount',
    invoice_date: 'Invoice date',
    invoice_number: 'Invoice number',
    due_date: 'Due date',
    amount: 'Amount',
  };
  const dueState: { label: string; tone: Tone } = (() => {
    const raw = invoice.due_date;
    if (!raw) return { label: 'No due date', tone: 'slate' };
    const due = new Date(raw);
    if (Number.isNaN(due.getTime())) return { label: 'Invalid date', tone: 'slate' };
    if (isPaid) return { label: 'Paid', tone: 'slate' };
    const t0 = new Date();
    t0.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    const daysLate = Math.floor((t0.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
    if (daysLate > 0) return { label: `${daysLate} day${daysLate !== 1 ? 's' : ''} overdue`, tone: 'red' };
    if (daysLate === 0) return { label: 'Due today', tone: 'amber' };
    return { label: 'On time', tone: 'teal' };
  })();
  const severityTone = (s?: string): Tone =>
    s === 'critical' || s === 'high' ? 'red' : s === 'medium' ? 'amber' : 'teal';
  const tabTrigger =
    'rounded-none border-b-2 border-transparent bg-transparent px-3 pb-2.5 pt-2 text-[13px] font-medium text-slate-500 shadow-none hover:text-slate-800 data-[state=active]:border-[#246BFD] data-[state=active]:bg-transparent data-[state=active]:text-[#246BFD] data-[state=active]:shadow-none';
  const linkButton = 'text-xs font-medium text-[#246BFD] hover:underline';

  return (
    <>
    <Dialog
      open={open && !childDialogOpen}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex h-[94vh] w-[96vw] max-w-[1480px] flex-col gap-0 overflow-hidden bg-[#F3F6FA] p-0">
        <DuplicateWarningBanner
          invoice={invoice}
          performedByEmail={workEmail}
          onRefresh={onUpdate}
          onNavigateInvoice={onNavigateInvoice}
        />
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-[#E3E8EF] bg-white px-6 pt-4">
            <DialogHeader className="space-y-0 pr-8 text-left">
              <p className="text-xs text-slate-500">
                Invoices <span aria-hidden>›</span>{' '}
                <span className="font-medium text-[#246BFD]">{invoice.invoice_number}</span>
              </p>
              <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <DialogTitle className="text-2xl font-bold tracking-tight text-slate-900">
                      {invoice.invoice_number}
                    </DialogTitle>
                    <Pill tone={statusTone} className="text-xs">
                      {INVOICE_STATUS_LABEL[invoice.status] ?? invoice.status}
                    </Pill>
                    {invoice.invoice_language && invoice.invoice_language !== 'en' && (
                      <Pill tone="primary">
                        {LANGUAGE_LABELS[invoice.invoice_language] || invoice.invoice_language} · translated by AI
                      </Pill>
                    )}
                  </div>
                  <p className="mt-1 text-[15px] font-semibold text-slate-800">{invoice.vendor_name || '—'}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Created {displayDate(invoice.created_at.slice(0, 10), dateFormat)}
                    {invoice.due_date ? (
                      <>
                        {' '}
                        <span aria-hidden>|</span> Due {displayDate(invoice.due_date, dateFormat)}
                      </>
                    ) : null}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(invoice.ifrs_category || invoice.expense_category) && (
                      <Pill tone="gold">{invoice.ifrs_category || invoice.expense_category}</Pill>
                    )}
                    {invoice.po_number && <Pill tone="slate">{invoice.po_number}</Pill>}
                    {(invoice.grn_confirmed || invoice.grn_id) && (
                      <Pill tone="slate">{invoice.grn_confirmed ? 'GRN confirmed' : 'GRN linked'}</Pill>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {invoice.status === 'Processing' && activeTab !== 'approval' && (
                    <Button size="sm" className="bg-[#246BFD] hover:bg-[#1D5BE0]" onClick={() => setActiveTab('approval')}>
                      <UserCheck className="mr-1.5 h-4 w-4" />
                      Review approval
                    </Button>
                  )}
                  {invoice.status === 'Approved' && !isPaid && activeTab !== 'approval' && (
                    <Button size="sm" className="bg-[#246BFD] hover:bg-[#1D5BE0]" onClick={() => setActiveTab('approval')}>
                      <CheckCircle className="mr-1.5 h-4 w-4" />
                      Record payment
                    </Button>
                  )}
                  {fileUrl && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={fileUrl} target="_blank" rel="noreferrer" download title="Download original invoice file">
                        <Download className="mr-1.5 h-4 w-4" />
                        Download
                      </a>
                    </Button>
                  )}
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
                      <Button size="sm" onClick={handleSave} disabled={loading} className="bg-[#246BFD] hover:bg-[#1D5BE0]">
                        <Save className="mr-1.5 h-4 w-4" />
                        Save
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsEditing(true);
                        setActiveTab('details');
                      }}
                    >
                      <Edit2 className="mr-1.5 h-4 w-4" />
                      Edit
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDelete}
                    disabled={loading}
                    aria-label="Delete invoice"
                    title="Delete invoice"
                  >
                    <Trash2 className="h-4 w-4 text-[#DC2626]" />
                  </Button>
                </div>
              </div>
            </DialogHeader>

            <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
              <SummaryTile
                icon={<Wallet className="h-4 w-4" />}
                label={`Total amount (incl. ${taxLabel})`}
                value={money(invoice.total_amount)}
              />
              <SummaryTile
                icon={<Receipt className="h-4 w-4" />}
                label={`${taxLabel} amount${taxRate != null ? ` (${taxRate}%)` : ''}`}
                value={money(taxAmount)}
                tone="purple"
              />
              <SummaryTile
                icon={<Calculator className="h-4 w-4" />}
                label="Net amount"
                value={money(netAmount)}
                tone="slate"
              />
              <button
                type="button"
                className="rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#246BFD]"
                onClick={() => setActiveTab('matching')}
                aria-label="Open matching details"
              >
                <SummaryTile
                  icon={<ShieldCheck className="h-4 w-4" />}
                  label="3-way match"
                  value={MATCH_LABEL[displayMatch] ?? displayMatch}
                  sub={invoice.match_score != null ? `Score ${Math.round(Number(invoice.match_score))}/100` : undefined}
                  tone={matchTone}
                  highlight
                />
              </button>
            </div>

            <TabsList className="mt-3 h-auto w-full justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-0">
              <TabsTrigger value="details" className={tabTrigger}>
                <FileText className="mr-1.5 h-4 w-4" />
                Details
              </TabsTrigger>
              <TabsTrigger value="matching" className={tabTrigger}>
                <ShieldCheck className="mr-1.5 h-4 w-4" />
                Matching &amp; Accounting
              </TabsTrigger>
              <TabsTrigger value="risk" className={tabTrigger}>
                <AlertCircle className="mr-1.5 h-4 w-4" />
                Risk &amp; Compliance
                {parsedRiskFlags.length + openAnomalies > 0 && (
                  <span className="ml-1.5 rounded-full bg-[#FEF3C7] px-1.5 text-[10px] font-semibold text-[#92400E]">
                    {parsedRiskFlags.length + openAnomalies}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="approval" className={tabTrigger}>
                <UserCheck className="mr-1.5 h-4 w-4" />
                Approval &amp; Payment
              </TabsTrigger>
              <TabsTrigger value="activity" className={tabTrigger}>
                <Clock className="mr-1.5 h-4 w-4" />
                Activity &amp; Audit Trail
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <TabsContent value="details" className="mt-0 focus-visible:ring-0 focus-visible:ring-offset-0">
              <div className="grid gap-4 xl:grid-cols-12">
                <DetailCard
                  title="Invoice Document"
                  icon={<FileText className="h-4 w-4 text-[#DC2626]" />}
                  className="self-start overflow-hidden xl:sticky xl:top-0 xl:col-span-4"
                  bodyClassName=""
                >
                  <DocumentPreview
                    url={fileUrl}
                    fileType={invoice.file_type}
                    fileRef={invoice.file_url}
                    zoom={zoomLevel}
                    onZoom={setZoomLevel}
                  />
                </DetailCard>

                <div className="grid content-start gap-4 md:grid-cols-2 xl:col-span-8">
                  <div className="min-w-0 space-y-4">
                    <DetailCard
                      title="Invoice Information"
                      icon={<FileText className="h-4 w-4 text-[#246BFD]" />}
                      action={
                        !isEditing ? (
                          <button type="button" className={linkButton} onClick={() => setIsEditing(true)}>
                            Edit
                          </button>
                        ) : (
                          <Pill tone="primary">Editing</Pill>
                        )
                      }
                    >
                      <dl className="divide-y divide-[#F1F4F8]">
                        <InfoRow label="Invoice Number">
                          {isEditing ? (
                            <Input
                              className="h-8"
                              value={editedInvoice.invoice_number}
                              onChange={(e) => setEditedInvoice({ ...editedInvoice, invoice_number: e.target.value })}
                            />
                          ) : (
                            <span className="font-medium">{invoice.invoice_number}</span>
                          )}
                        </InfoRow>
                        <InfoRow label="Vendor">
                          {isEditing ? (
                            <Input
                              className="h-8"
                              value={editedInvoice.vendor_name}
                              onChange={(e) => setEditedInvoice({ ...editedInvoice, vendor_name: e.target.value })}
                            />
                          ) : (
                            invoice.vendor_name || '—'
                          )}
                        </InfoRow>
                        <InfoRow label="Invoice Date">{displayDate(invoice.invoice_date, dateFormat)}</InfoRow>
                        <InfoRow label="Due Date">
                          <span className="flex flex-wrap items-center gap-2">
                            {invoice.due_date && !Number.isNaN(new Date(invoice.due_date).getTime())
                              ? displayDate(invoice.due_date, dateFormat)
                              : '—'}
                            <Pill tone={dueState.tone}>{dueState.label}</Pill>
                          </span>
                        </InfoRow>
                        <InfoRow label="Currency">{currency}</InfoRow>
                        <InfoRow label="Total Amount">
                          {isEditing ? (
                            <Input
                              className="h-8"
                              type="number"
                              value={editedInvoice.total_amount}
                              onChange={(e) =>
                                setEditedInvoice({ ...editedInvoice, total_amount: parseFloat(e.target.value) })
                              }
                            />
                          ) : (
                            <span className="font-semibold">{money(invoice.total_amount)}</span>
                          )}
                        </InfoRow>
                        <InfoRow label="Net Amount">{money(netAmount)}</InfoRow>
                        {taxBreakdownLines.length > 0 ? (
                          taxBreakdownLines.map((t: { name?: string; rate?: number; amount?: number }, i: number) => (
                            <InfoRow key={`${t.name}-${i}`} label={`${t.name ?? taxLabel} @ ${t.rate ?? 0}%`}>
                              {money(t.amount)}
                            </InfoRow>
                          ))
                        ) : (
                          <InfoRow label={`${taxLabel} Amount`}>
                            {money(taxAmount)}
                            {taxRate != null ? <span className="text-slate-500"> ({taxRate}%)</span> : null}
                          </InfoRow>
                        )}
                        <InfoRow label="Status">
                          <Pill tone={statusTone}>{INVOICE_STATUS_LABEL[invoice.status] ?? invoice.status}</Pill>
                        </InfoRow>
                        {isPaid && (
                          <InfoRow label="Bank Recon">
                            {invoice.bank_reconciled ? (
                              <Pill tone="teal">Reconciled{invoice.bank_ref ? ` · ${invoice.bank_ref}` : ''}</Pill>
                            ) : (
                              <Pill tone="amber">Pending reconciliation</Pill>
                            )}
                          </InfoRow>
                        )}
                        {isPaid && (invoice.payment_date || invoice.paid_at) && (
                          <InfoRow label="Payment Date">
                            {displayDate(String(invoice.payment_date ?? invoice.paid_at ?? '').slice(0, 10), dateFormat)}
                          </InfoRow>
                        )}
                        {invoice.po_number && <InfoRow label="PO Number">{invoice.po_number}</InfoRow>}
                        {isUAE && invoice.vendor_trn && (
                          <InfoRow label="Vendor TRN">
                            <span className="font-mono text-xs">{invoice.vendor_trn}</span>
                          </InfoRow>
                        )}
                        {!isUAE && invoice.gstin && (
                          <InfoRow label="Supplier GSTIN">
                            <span className="font-mono text-xs">{invoice.gstin}</span>
                          </InfoRow>
                        )}
                        <InfoRow label="Source">
                          {invoice.source ? INVOICE_SOURCE_LABEL[invoice.source] ?? invoice.source : '—'}
                        </InfoRow>
                        {invoice.source_email_from && (
                          <InfoRow label="Received From">{invoice.source_email_from}</InfoRow>
                        )}
                        <InfoRow label="Created On">
                          {format(new Date(invoice.created_at), 'dd MMM yyyy, HH:mm')}
                        </InfoRow>
                      </dl>

                      <div className="mt-3 border-t border-[#EEF2F7] pt-3">
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Vendor contact
                        </p>
                        <dl>
                          <InfoRow label="Email">
                            {isEditing ? (
                              <Input
                                className="h-8"
                                type="email"
                                value={editedInvoice.vendor_email || ''}
                                onChange={(e) => setEditedInvoice({ ...editedInvoice, vendor_email: e.target.value })}
                              />
                            ) : (
                              invoice.vendor_email || '—'
                            )}
                          </InfoRow>
                          <InfoRow label="Phone">
                            {isEditing ? (
                              <Input
                                className="h-8"
                                value={editedInvoice.vendor_phone || ''}
                                onChange={(e) => setEditedInvoice({ ...editedInvoice, vendor_phone: e.target.value })}
                              />
                            ) : (
                              invoice.vendor_phone || '—'
                            )}
                          </InfoRow>
                          <InfoRow label="Address">
                            {isEditing ? (
                              <Textarea
                                rows={2}
                                value={editedInvoice.vendor_address || ''}
                                onChange={(e) => setEditedInvoice({ ...editedInvoice, vendor_address: e.target.value })}
                              />
                            ) : (
                              invoice.vendor_address || '—'
                            )}
                          </InfoRow>
                        </dl>
                      </div>
                    </DetailCard>

                    <DetailCard title="AI Extraction Confidence" icon={<Sparkles className="h-4 w-4 text-[#00A884]" />}>
                      <div className="flex items-center gap-4">
                        <Ring
                          value={extractionScore}
                          color={extractionScore >= 90 ? COLORS.teal : extractionScore >= 70 ? COLORS.amber : COLORS.red}
                          label={`Overall extraction confidence ${Math.round(extractionScore)}%`}
                        >
                          <span className="text-xl font-bold text-slate-900">{Math.round(extractionScore)}%</span>
                          <span className="text-[11px] text-slate-500">Overall</span>
                        </Ring>
                        {Object.keys(fieldConfidences).length > 0 ? (
                          <ul className="min-w-0 flex-1 space-y-1.5">
                            {Object.entries(fieldConfidences).map(([key, pct]) => {
                              const v = Math.min(100, Math.max(0, Number(pct)));
                              const tone: Tone = v >= 90 ? 'teal' : v >= 70 ? 'amber' : 'red';
                              return (
                                <li key={key} className="flex items-center justify-between gap-2 text-[12px]">
                                  <span className="flex min-w-0 items-center gap-2 text-slate-700">
                                    <span
                                      className="h-2 w-2 shrink-0 rounded-full"
                                      style={{ background: TONE_HEX[tone] }}
                                      aria-hidden
                                    />
                                    <span className="truncate">{fieldLabels[key] ?? key.replace(/_/g, ' ')}</span>
                                  </span>
                                  <span className={`tabular-nums ${v < 70 ? 'font-semibold text-[#B45309]' : 'text-slate-600'}`}>
                                    {Math.round(v)}%
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="min-w-0 flex-1 text-xs text-slate-500">
                            No per-field scores were returned by the extraction workflow.
                          </p>
                        )}
                      </div>
                      <p className="mt-3 text-[11px] text-slate-500">{extractionHint}</p>
                      {extractionScore < 90 && (
                        <p className="mt-2 rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-xs text-[#92400E]">
                          Review extracted values — confidence is below 90%. Check vendor name, amount and invoice date
                          before approving.
                        </p>
                      )}
                    </DetailCard>
                  </div>

                  <div className="min-w-0 space-y-4">
                    <DetailCard
                      title="IFRS Classification"
                      icon={<Sparkles className="h-4 w-4 text-[#7C3AED]" />}
                      action={
                        <Pill tone={invoice.ifrs_category?.trim() ? 'purple' : 'amber'}>
                          {invoice.ifrs_category?.trim() ? 'Classified' : 'Needs review'}
                        </Pill>
                      }
                    >
                      <dl className="divide-y divide-[#F1F4F8]">
                        {invoice.expense_category?.trim() && (
                          <InfoRow label="Business Category">
                            {invoice.expense_category} <span className="text-slate-500">(source)</span>
                          </InfoRow>
                        )}
                        <InfoRow label="IFRS Classification">
                          <span className="font-semibold text-[#6D28D9]">
                            {invoice.ifrs_category?.trim() || 'Not classified'}
                          </span>
                        </InfoRow>
                        {(invoice.gl_account_code ?? invoice.gl_code) && (
                          <InfoRow label="GL Account">
                            <span className="font-mono">{invoice.gl_account_code ?? invoice.gl_code}</span>
                            {invoice.gl_account_name ?? invoice.gl_name ? ` — ${invoice.gl_account_name ?? invoice.gl_name}` : ''}
                            {invoice.gl_source && (
                              <span
                                className="mt-0.5 block text-[11px] font-medium"
                                style={{ color: invoice.gl_source === 'company_coa' ? COLORS.teal : COLORS.slate }}
                              >
                                {invoice.gl_source === 'company_coa' ? 'From your chart of accounts' : 'IFRS auto-mapping'}
                              </span>
                            )}
                          </InfoRow>
                        )}
                        {invoice.gl_category?.trim() && <InfoRow label="Account Type">{invoice.gl_category}</InfoRow>}
                        <InfoRow label="Confidence">
                          <span className="flex items-center gap-2">
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#EEF2F7]">
                              <span
                                className="block h-full rounded-full bg-[#7C3AED]"
                                style={{ width: `${Math.min(100, Math.max(0, Number(invoice.ifrs_confidence) || 0))}%` }}
                              />
                            </span>
                            <span className="w-10 text-right tabular-nums">
                              {invoice.ifrs_confidence != null ? Number(invoice.ifrs_confidence) : 0}%
                            </span>
                          </span>
                        </InfoRow>
                        <InfoRow label="Explanation">
                          <span className="text-slate-600">{invoice.ifrs_explanation?.trim() || '—'}</span>
                        </InfoRow>
                      </dl>
                      {invoice.ifrs_manual_override && (
                        <p className="mt-2 rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-xs text-[#92400E]">
                          This classification has been manually overridden.
                        </p>
                      )}
                      <div className="mt-3 border-t border-[#EEF2F7] pt-3">
                        <Label htmlFor="ifrs-override" className="text-xs text-slate-500">
                          Manual override
                        </Label>
                        <div className="mt-1 flex gap-2">
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
                            <SelectTrigger id="ifrs-override" className="h-8 text-[13px]">
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
                            className="h-8 shrink-0 bg-[#246BFD] hover:bg-[#1D5BE0]"
                            disabled={
                              loading ||
                              !editedInvoice.ifrs_category ||
                              editedInvoice.ifrs_category === (invoice.ifrs_category || '')
                            }
                            onClick={handleSaveIfrsOverride}
                          >
                            <Save className="mr-1 h-4 w-4" />
                            Save
                          </Button>
                        </div>
                      </div>
                    </DetailCard>

                    <DetailCard
                      title="Risk Analysis"
                      icon={<AlertCircle className="h-4 w-4" style={{ color: TONE_HEX[currentRiskTone] }} />}
                      action={
                        <button type="button" className={linkButton} onClick={() => setActiveTab('risk')}>
                          View all{parsedRiskFlags.length + persistedAnomalies.length > 0
                            ? ` (${parsedRiskFlags.length + persistedAnomalies.length})`
                            : ''}
                        </button>
                      }
                    >
                      <div className="flex items-center gap-4">
                        <Ring
                          value={riskDisplayScore}
                          size={96}
                          stroke={9}
                          color={TONE_HEX[currentRiskTone]}
                          label={`Risk score ${riskDisplayScore} of 100`}
                        >
                          <span className="text-xl font-bold text-slate-900">{riskDisplayScore}</span>
                          <span className="text-[10px] text-slate-500">Risk score</span>
                        </Ring>
                        <div className="min-w-0 flex-1">
                          <Pill tone={riskTone(0, riskLabel(invoice))}>{riskLabel(invoice)} risk</Pill>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {parsedRiskFlags.length} flag{parsedRiskFlags.length !== 1 ? 's' : ''} detected
                          </p>
                          {parsedRiskFlags.length > 0 ? (
                            <ul className="mt-2 space-y-1.5">
                              {parsedRiskFlags
                                .slice(0, 3)
                                .map((flag: { severity?: string; message?: string }, i: number) => (
                                  <li key={i} className="flex items-center justify-between gap-2 text-[12px]">
                                    <span className="min-w-0 truncate text-slate-700" title={flag.message}>
                                      {flag.message}
                                    </span>
                                    <Pill tone={severityTone(flag.severity)}>
                                      {SEVERITY[(flag.severity as keyof typeof SEVERITY) || 'low']?.label ?? 'Low'}
                                    </Pill>
                                  </li>
                                ))}
                            </ul>
                          ) : (
                            <p className="mt-2 text-xs text-[#047857]">No risk flags detected for this invoice.</p>
                          )}
                        </div>
                      </div>
                    </DetailCard>

                    <DetailCard
                      title="Three-Way Match"
                      icon={<ShieldCheck className="h-4 w-4" style={{ color: TONE_HEX[matchTone] }} />}
                      action={
                        <>
                          <Pill tone={matchTone}>{MATCH_LABEL[displayMatch] ?? displayMatch}</Pill>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            disabled={matchLoading}
                            onClick={() => void handleRerunMatch()}
                          >
                            {matchLoading ? 'Matching…' : 'Re-run'}
                          </Button>
                        </>
                      }
                    >
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          {
                            label: 'Purchase Order',
                            value: invoice.po_amount != null ? money(invoice.po_amount) : '—',
                            sub: invoice.po_number || 'Not linked',
                            ok: !!(invoice.po_id || invoice.po_number),
                          },
                          {
                            label: 'Goods Receipt',
                            value: (invoice.grn_amount ?? 0) > 0 ? money(invoice.grn_amount) : '—',
                            sub: invoice.grn_confirmed ? 'Confirmed' : (invoice.grn_amount ?? 0) > 0 ? 'Recorded' : 'Not found',
                            ok: !!invoice.grn_confirmed || (invoice.grn_amount ?? 0) > 0,
                          },
                          {
                            label: 'Invoice Amount',
                            value: money(invoice.total_amount),
                            sub: invoice.invoice_number,
                            ok: true,
                          },
                        ].map((t) => (
                          <div key={t.label} className="min-w-0 rounded-lg border border-[#E3E8EF] bg-slate-50/60 p-2">
                            <p className="flex items-center gap-1 text-[11px] text-slate-500">
                              {t.ok ? (
                                <CheckCircle className="h-3.5 w-3.5 shrink-0 text-[#00A884]" />
                              ) : (
                                <XCircle className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                              )}
                              <span className="truncate">{t.label}</span>
                            </p>
                            <p className="mt-0.5 truncate text-[13px] font-semibold text-slate-900">{t.value}</p>
                            <p className="truncate text-[11px] text-slate-500">{t.sub}</p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-500">
                          {invoice.match_score != null
                            ? `Score ${Math.round(Number(invoice.match_score))}/100`
                            : 'No match score yet'}
                        </span>
                        <button type="button" className={linkButton} onClick={() => setActiveTab('matching')}>
                          Matching details →
                        </button>
                      </div>
                    </DetailCard>
                  </div>

                  <div className="min-w-0 space-y-4 md:col-span-2">
                    {/* GL Coding */}
                    <Card className="border-[#E3E8EF] shadow-sm">
                      <CardHeader>
                        <CardTitle className="text-[15px] font-semibold">GL Coding</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {needsGlConfirmationBanner && (
                          <div className="rounded-lg border border-[#FCD34D] bg-[#FFFBEB] p-4 text-sm text-[#451A03]">
                            <p className="font-medium">
                              &quot;{invoice.ifrs_category?.trim() || 'This invoice'}&quot; may not be in your chart of accounts yet.
                            </p>
                            <p className="mt-2 text-[#78350F]">
                              Suggested:{' '}
                              <span className="font-mono font-semibold">{invoice.gl_account_code ?? invoice.gl_code}</span>
                              {' — '}
                              <span className="font-medium">{invoice.gl_account_name ?? invoice.gl_name}</span>
                              {invoice.gl_suggestion_source === 'standard_fallback'
                                ? ' (aligned with your accounting standard)'
                                : ' (AI suggestion — please verify)'}
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
                              <Button type="button" size="sm" className="bg-[#B45309] hover:bg-[#92400E] text-white" disabled={loading} onClick={() => void handleGlBannerKeepAsIs()}>
                                Keep as is
                              </Button>
                            </div>
                          </div>
                        )}
                        {(invoice.gl_auto_suggested && (invoice.gl_account_code || invoice.gl_code)) ? (
                          <div className="rounded-lg border-2 border-[#BFDBFE] bg-[#EFF6FF] p-4">
                            <p className="text-xs font-medium text-[#1E40AF] mb-2">
                              {invoice.gl_source === 'company_coa' ? '🏢 From your COA' : '🤖 Auto-suggested from IFRS category'}
                            </p>
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">GL Code:</span>
                              <span className="font-mono font-semibold text-[#1E3A8A]">{invoice.gl_account_code ?? invoice.gl_code}</span>
                            </div>
                            <div className="flex justify-between text-sm mt-1">
                              <span className="text-gray-600">GL Name:</span>
                              <span className="font-medium text-[#1E3A8A]">{invoice.gl_account_name ?? invoice.gl_name ?? '—'}</span>
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
                                <span className="font-medium">{invoice.gl_account_name ?? invoice.gl_name ?? '—'}</span>
                              </div>
                              {invoice.gl_source && (
                                <p
                                  className="text-xs font-semibold mt-1"
                                  style={{ color: invoice.gl_source === 'company_coa' ? '#0e9f6e' : '#6b7280' }}
                                >
                                  {invoice.gl_source === 'company_coa' ? '🏢 From your COA' : '🤖 IFRS Auto'}
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
                          <Label htmlFor="property_ref">Property / Project</Label>
                          <PropertyCombobox
                            id="property_ref"
                            value={editedInvoice.property_ref || ''}
                            onChange={(propertyName) =>
                              setEditedInvoice({ ...editedInvoice, property_ref: propertyName || null })
                            }
                          />
                          <p className="text-xs text-muted-foreground">Optional — not required for approval.</p>
                        </div>
                        <div className="space-y-2">
                          <CostCenterSelect
                            value={editedInvoice.cost_center || ''}
                            onChange={(v) =>
                              setEditedInvoice({ ...editedInvoice, cost_center: v })
                            }
                          />
                        </div>
                        <div
                          id="gl-override-select-wrap"
                          className={`space-y-2 rounded-md p-1 transition-shadow ${highlightGlPicker ? 'ring-2 ring-[#3B82F6] ring-offset-2' : ''}`}
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
                                  {account.gl_code} — {account.gl_name}
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

                    {/* Line Items */}
                    {lineItems.length > 0 && (
                      <Card className="border-[#E3E8EF] shadow-sm">
                        <CardHeader>
                          <CardTitle className="text-[15px] font-semibold">Line Items</CardTitle>
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
                                    {money(item.unit_price)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {money(item.total)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="matching" className="mt-0 focus-visible:ring-0 focus-visible:ring-offset-0">
              <div className="grid gap-4 xl:grid-cols-3">
                <div className="min-w-0 space-y-4 xl:col-span-2">
                  {/* 3-Way Match */}
                  <Card
                    className={
                      resolveDisplayMatchStatus(invoice) === 'three_way_matched'
                        ? 'border-2 border-[#22C55E] bg-[#F0FDF4]'
                        : resolveDisplayMatchStatus(invoice) === 'matched'
                          ? 'border-2 border-teal-500 bg-teal-50'
                          : resolveDisplayMatchStatus(invoice) === 'mismatch'
                            ? 'border-2 border-[#F59E0B] bg-[#FFFBEB]'
                            : resolveDisplayMatchStatus(invoice) === 'partial'
                              ? 'border-2 border-[#FBBF24] bg-[#FFFBEB]'
                              : resolveDisplayMatchStatus(invoice) === 'no_po'
                                ? 'border-2 border-[#FCA5A5] bg-white'
                                : 'border border-gray-200 bg-white'
                    }
                  >
                    <CardHeader
                      className={
                        resolveDisplayMatchStatus(invoice) === 'three_way_matched'
                          ? 'bg-[#DCFCE7] border-b border-[#BBF7D0]'
                          : resolveDisplayMatchStatus(invoice) === 'matched'
                            ? 'bg-teal-100 border-b border-teal-200'
                            : resolveDisplayMatchStatus(invoice) === 'mismatch'
                              ? 'bg-[#FEF3C7] border-b border-[#FDE68A]'
                              : resolveDisplayMatchStatus(invoice) === 'partial'
                                ? 'bg-[#FFFBEB] border-b border-[#FDE68A]'
                                : resolveDisplayMatchStatus(invoice) === 'no_po'
                                  ? 'bg-[#FEF2F2] border-b border-[#FECACA]'
                                  : 'bg-white'
                      }
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="text-[15px] font-semibold">3-Way Match Result</CardTitle>
                        <div className="flex items-center gap-2">
                          {invoice.match_score != null && (
                            <span className="text-sm font-semibold text-gray-800">
                              Score: {Math.round(Number(invoice.match_score))}/100
                            </span>
                          )}
                          {(() => {
                            const ms = resolveDisplayMatchStatus(invoice);
                            return (
                              <Badge variant="outline" className={getMatchStatusColor(ms)}>
                                {ms === 'three_way_matched' && '3-Way Matched'}
                                {ms === 'matched' && 'PO Matched'}
                                {ms === 'partial' && 'Partial'}
                                {ms === 'mismatch' && 'Variance'}
                                {ms === 'no_po' && 'No PO'}
                              </Badge>
                            );
                          })()}
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={matchLoading}
                            onClick={() => void handleRerunMatch()}
                            title="Recompute this invoice's 3-way match against current PO/GRN data"
                          >
                            {matchLoading ? 'Matching…' : 'Re-run match'}
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-4">
                      <ul className="space-y-2 text-sm">
                        <li className="flex gap-2">
                          <span className="w-5 shrink-0">{invoice.po_id || invoice.po_number ? '✓' : '✗'}</span>
                          <span>
                            {invoice.po_id || invoice.po_number ? 'PO matched' : 'No PO found'}{' '}
                            {invoice.po_number && (
                              <span className="text-gray-700">
                                {invoice.po_number} · {formatCurrency(invoice.po_amount ?? 0, invoice.currency || 'USD')}
                              </span>
                            )}
                          </span>
                        </li>
                        <li className="flex gap-2">
                          <span className="w-5 shrink-0">
                            {invoice.match_status === 'three_way_matched' || (invoice.grn_amount ?? 0) > 0 ? '✓' : '—'}
                          </span>
                          <span>
                            {invoice.match_status === 'three_way_matched' || (invoice.grn_amount ?? 0) > 0
                              ? 'GRN confirmed / value recorded'
                              : 'GRN not found or empty'}
                            {(invoice.grn_amount ?? 0) > 0 && (
                              <span className="text-gray-700">
                                {' '}
                                · {formatCurrency(invoice.grn_amount ?? 0, invoice.currency || 'USD')}
                              </span>
                            )}
                          </span>
                        </li>
                        <li className="flex gap-2">
                          <span className="w-5 shrink-0">
                            {invoice.match_status === 'mismatch' &&
                            Number(invoice.match_percentage ?? 0) > 0
                              ? '✗'
                              : invoice.po_amount != null
                                ? '✓'
                                : '—'}
                          </span>
                          <span>
                            {invoice.match_status === 'mismatch' && Number(invoice.match_percentage ?? 0) > 0
                              ? 'Amount variance'
                              : 'Amount vs PO'}{' '}
                            <span className="text-gray-700">
                              Invoice {formatCurrency(Number(invoice.total_amount), invoice.currency || 'USD')}
                              {invoice.po_amount != null &&
                                ` vs PO ${formatCurrency(invoice.po_amount, invoice.currency || 'USD')}`}
                              {invoice.match_percentage != null &&
                                Number(invoice.match_percentage) > 0 &&
                                ` (${invoice.match_percentage.toFixed(1)}%)`}
                            </span>
                            {invoice.po_amount != null &&
                              Number(invoice.total_amount) > 0 &&
                              Math.abs(Number(invoice.total_amount) / Number(invoice.po_amount) - 1.05) < 0.01 && (
                                <span className="block text-xs text-gray-500 mt-0.5">
                                  Invoice looks VAT-inclusive (gross); PO stored ex-VAT — match engine normalizes 5% UAE VAT.
                                </span>
                              )}
                          </span>
                        </li>
                        <li className="flex gap-2">
                          <span className="w-5 shrink-0">•</span>
                          <span className="text-gray-700">Vendor: {invoice.vendor_name || '—'}</span>
                        </li>
                      </ul>

                      {invoice.match_notes && (
                        <p className="rounded-md bg-white/80 p-3 text-sm text-gray-700 border border-gray-100 whitespace-pre-wrap">
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
                        <p className="text-sm font-semibold text-[#166534]">
                          AUTO-APPROVED · system match
                          {invoice.match_attempted_at &&
                            ` · ${format(new Date(invoice.match_attempted_at), 'dd MMM yyyy HH:mm')}`}
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
                            className="border-[#D97706] text-[#78350F]"
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
                            <p className="text-xs text-[#166534]">
                              Confirmed by {invoice.grn_confirmed_by ?? '—'} on{' '}
                              {invoice.grn_confirmed_at ? format(new Date(invoice.grn_confirmed_at), 'PPp') : '—'}
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
                        <div className="rounded-md border border-[#FDE68A] bg-[#FFFBEB] p-3 text-sm text-[#451A03] space-y-2">
                          <p>PO linked — waiting for a confirmed goods receipt or further review.</p>
                          {invoice.po_id && (
                            <Button type="button" size="sm" variant="secondary" asChild>
                              <Link to={`/goods-receipts?poId=${invoice.po_id}`}>Create GRN</Link>
                            </Button>
                          )}
                        </div>
                      )}

                      {(resolveDisplayMatchStatus(invoice) === 'no_po') && (
                        <div className="rounded-md border border-[#FECACA] bg-[#FEF2F2] p-3 text-sm text-gray-900">
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
                                        {po.po_number} — {formatCurrency(Number(po.po_amount), invoice.currency || 'USD')}
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
                              {matchLoading ? 'Running…' : 'Link PO & Run Match'}
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
                <div className="min-w-0 space-y-4">
                  <DetailCard title="GL Coding Summary" icon={<Calculator className="h-4 w-4 text-[#246BFD]" />}>
                    <dl className="divide-y divide-[#F1F4F8]">
                      <InfoRow label="GL Account">
                        {invoice.gl_account_code ?? invoice.gl_code ? (
                          <>
                            <span className="font-mono">{invoice.gl_account_code ?? invoice.gl_code}</span>
                            {invoice.gl_account_name ?? invoice.gl_name ? ` — ${invoice.gl_account_name ?? invoice.gl_name}` : ''}
                          </>
                        ) : (
                          <Pill tone="amber">Not coded</Pill>
                        )}
                      </InfoRow>
                      <InfoRow label="Account Type">{invoice.gl_category || invoice.gl_account_type || '—'}</InfoRow>
                      <InfoRow label="Department">{invoice.department || '—'}</InfoRow>
                      <InfoRow label="Cost Center">{invoice.cost_center || '—'}</InfoRow>
                      <InfoRow label="Property / Project">{invoice.property_ref || '—'}</InfoRow>
                    </dl>
                    <button type="button" className={`mt-3 ${linkButton}`} onClick={() => setActiveTab('details')}>
                      Edit GL coding in Details →
                    </button>
                  </DetailCard>
                  <DetailCard title="Accounting Sync" icon={<Sparkles className="h-4 w-4 text-[#00A884]" />}>
                    <p className="text-[13px] text-slate-600">
                      {invoice.status === 'Approved'
                        ? 'Push this approved invoice to your accounting system.'
                        : isPaid
                          ? 'Pushing to TallyPrime, Zoho Books or QuickBooks is available while an invoice is in Approved status.'
                          : 'Pushing to TallyPrime, Zoho Books or QuickBooks becomes available once the invoice is approved.'}
                    </p>
                    {invoice.tally_synced && invoice.tally_synced_at && (
                      <p className="mt-2 text-xs text-[#047857]">
                        Synced to TallyPrime on {format(new Date(invoice.tally_synced_at), 'dd MMM yyyy, HH:mm')}
                      </p>
                    )}
                  </DetailCard>
                  {/* Push to Tally (for approved invoices) */}
                  {invoice.status === 'Approved' && (
                    <Card className="border-[#E3E8EF] shadow-sm">
                      <CardContent className="pt-6">
                        <Button
                          variant={invoice.tally_synced ? 'outline' : 'default'}
                          className={invoice.tally_synced ? 'bg-[#F0FDF4] text-[#166534] border-[#BBF7D0] hover:bg-[#DCFCE7]' : 'bg-[#1a56db] hover:bg-[#1d4ed8]'}
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
                          {invoice.tally_synced ? '✅ Synced to TallyPrime' : '📊 Push to TallyPrime'}
                        </Button>
                      </CardContent>
                    </Card>
                  )}

                  {/* Push to Zoho Books (for approved invoices when Zoho is configured) */}
                  {invoice.status === 'Approved' && zohoSettings?.client_id && (
                    <Card className="border-[#E3E8EF] shadow-sm">
                      <CardContent className="pt-6">
                        <Button
                          variant="outline"
                          disabled={zohoPushing}
                          className="border-[#E42527] text-[#E42527] hover:bg-[#FEF2F2]"
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
                          {zohoPushing ? '⏳ Pushing…' : '📗 Push to Zoho Books'}
                        </Button>
                      </CardContent>
                    </Card>
                  )}

                  {/* Push to QuickBooks Online (for approved invoices when QB is configured) */}
                  {invoice.status === 'Approved' && qbSettings?.client_id && (
                    <Card className="border-[#E3E8EF] shadow-sm">
                      <CardContent className="pt-6">
                        <Button
                          variant="outline"
                          disabled={qbPushing}
                          className="border-[#2CA01C] text-[#2CA01C] hover:bg-[#F0FDF4]"
                          onClick={async () => {
                            if (!qbSettings) return;
                            setQbPushing(true);
                            try {
                              const result = await pushInvoiceToQB(invoice, qbSettings);
                              if (result.success) {
                                toast({ title: 'QuickBooks Online', description: result.message });
                                onUpdate();
                              } else {
                                toast({ title: 'QuickBooks error', description: result.message, variant: 'destructive' });
                              }
                            } catch (e) {
                              toast({ title: 'Error', description: String(e), variant: 'destructive' });
                            } finally {
                              setQbPushing(false);
                            }
                          }}
                        >
                          {qbPushing ? '⏳ Pushing…' : '🟢 Push to QuickBooks'}
                        </Button>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="risk" className="mt-0 focus-visible:ring-0 focus-visible:ring-offset-0">
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="min-w-0 space-y-4">
                  {/* Risk Analysis */}
                  <Card className="border-[#E3E8EF] shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-[15px] font-semibold flex items-center gap-2">
                        <AlertCircle className="h-5 w-5 text-[#D97706]" />
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
                            ✅ No risk flags detected for this invoice
                          </div>
                        )}

                        {/* Persisted anomalies from invoice_anomalies table */}
                        {persistedAnomalies.length > 0 && (
                          <div style={{ marginTop: '16px' }}>
                            <p style={{ fontSize: '12px', fontWeight: 700, color: '#374151', marginBottom: '8px' }}>
                              Detected anomalies ({persistedAnomalies.length})
                            </p>
                            {persistedAnomalies.map((a) => {
                              const sev = a.severity ?? 'medium';
                              const cfg = SEVERITY[sev as keyof typeof SEVERITY] || SEVERITY.medium;
                              return (
                                <div
                                  key={a.id}
                                  style={{
                                    background: cfg.bg,
                                    border: `1px solid ${cfg.border}`,
                                    borderRadius: '8px',
                                    padding: '10px 12px',
                                    marginBottom: '8px',
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                                    <span style={{ fontSize: '12px', fontWeight: 700, color: cfg.text }}>
                                      {a.flag_code?.replace(/_/g, ' ')}
                                    </span>
                                    <span style={{ fontSize: '10px', color: cfg.text }}>{a.status}</span>
                                  </div>
                                  <p style={{ fontSize: '12px', color: cfg.text, margin: '4px 0 0' }}>{a.flag_reason}</p>
                                  {a.status === 'open' || a.status === 'investigating' ? (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={anomalyActionLoading}
                                        onClick={() => void handleAnomalyAction(a.id, 'investigating')}
                                      >
                                        Investigate
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={anomalyActionLoading}
                                        onClick={() => void handleAnomalyAction(a.id, 'false_positive')}
                                      >
                                        Mark False Positive
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        disabled={anomalyActionLoading}
                                        onClick={() => void handleAnomalyEscalate(a)}
                                      >
                                        Escalate to CFO
                                      </Button>
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>
                <div className="min-w-0 space-y-4">
                  <Card className="border-[#E3E8EF] shadow-sm">
                    <CardHeader>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="text-[15px] font-semibold">{isUAE ? 'VAT' : 'GST'}</CardTitle>
                        <Badge
                          variant="outline"
                          className={
                            invoice.gst_recon_status === 'matched'
                              ? 'bg-[#F0FDF4] text-[#166534] border-[#BBF7D0]'
                              : invoice.gst_recon_status === 'mismatch'
                                ? 'bg-[#FEF2F2] text-[#991B1B] border-[#FECACA]'
                                : invoice.gst_recon_status === 'ignored'
                                  ? 'bg-gray-100 text-gray-700 border-gray-200'
                                  : 'bg-[#FFFBEB] text-[#78350F] border-[#FDE68A]'
                          }
                        >
                          {invoice.gst_recon_status ?? 'unmatched'}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-500">
                        Recon period (from invoice date):{' '}
                        <span className="font-mono">{invoicePeriodFromDate(invoice.invoice_date) || '—'}</span>
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {isUAE ? (
                        <div className="space-y-4">
                          <p className="text-xs text-gray-600">UAE VAT fields — TRN validation per Federal Decree No. 8 of 2017.</p>
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
                                <p className={`text-xs font-medium ${validateTaxId((editedInvoice as Record<string, unknown>).vendor_trn as string, 'uae') ? 'text-[#15803D]' : 'text-[#DC2626]'}`}>
                                  {validateTaxId((editedInvoice as Record<string, unknown>).vendor_trn as string, 'uae') ? '✓ Valid TRN' : '✗ Must be 15 digits starting with 1'}
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
                              🔍 Validate in GulfTax AI
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
                                value={editedInvoice.gstin ?? (editedInvoice as unknown as { vendor_gstin?: string }).vendor_gstin ?? ''}
                                onChange={(e) => setEditedInvoice({ ...editedInvoice, gstin: e.target.value })}
                                placeholder="15-character GSTIN"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>CGST</Label>
                              <Input
                                type="number"
                                step="0.01"
                                value={editedInvoice.cgst ?? (editedInvoice as unknown as { cgst_amount?: number }).cgst_amount ?? ''}
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
                                value={editedInvoice.sgst ?? (editedInvoice as unknown as { sgst_amount?: number }).sgst_amount ?? ''}
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
                                value={editedInvoice.igst ?? (editedInvoice as unknown as { igst_amount?: number }).igst_amount ?? ''}
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
                                value={editedInvoice.gst_amount ?? editedInvoice.tax_amount ?? ''}
                                onChange={(e) =>
                                  setEditedInvoice({ ...editedInvoice, gst_amount: parseFloat(e.target.value) || 0 })
                                }
                              />
                            </div>
                          </div>

                          <div className="space-y-2 border-t pt-4 mt-2">
                            <Label>TDS Section (Sec 51 / Chapter XVII-B)</Label>
                            <select
                              className="w-full border rounded-md px-3 py-2 text-sm"
                              value={tdsSection}
                              onChange={(e) => { setTdsSection(e.target.value); setTdsSuggested(false); }}
                            >
                              {TDS_SECTION_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                            {tdsSuggested && tdsSection && (
                              <p className="text-xs text-[#2563EB]">
                                Suggested from IFRS category "{editedInvoice.ifrs_category}" — review before saving.
                              </p>
                            )}
                            {tdsSection && (
                              <div className="text-xs bg-gray-50 border rounded-lg p-3 space-y-1">
                                {tdsCalculating ? (
                                  <span className="text-gray-500">Calculating…</span>
                                ) : tdsPreview?.ok ? (
                                  tdsPreview.threshold_met ? (
                                    <>
                                      <div className="flex justify-between"><span className="text-gray-600">Rate</span><span className="font-mono">{tdsPreview.tds_rate}%</span></div>
                                      <div className="flex justify-between"><span className="text-gray-600">TDS (incl. cess)</span><span className="font-mono font-semibold">₹{tdsPreview.net_tds?.toFixed(2)}</span></div>
                                    </>
                                  ) : (
                                    <span className="text-[#B45309]">
                                      Below ₹{tdsPreview.threshold?.toLocaleString('en-IN')} threshold — no TDS applicable, nothing will be saved.
                                    </span>
                                  )
                                ) : (
                                  <span className="text-[#DC2626]">{tdsPreview?.error || 'Could not calculate'}</span>
                                )}
                              </div>
                            )}
                          </div>

                          <Button type="button" className="bg-[#0A4B8F]" disabled={loading} onClick={() => void handleSaveGst()}>
                            <Save className="h-4 w-4 mr-2" />
                            Save GST fields
                          </Button>
                        </div>
                      )}

                      {invoice.gst_recon_status === 'mismatch' && gstrPortalRow && (
                        <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2]/50 p-4 space-y-2">
                          <p className="text-sm font-semibold text-[#7F1D1D]">GSTR-2B vs invoice</p>
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
                </div>
              </div>
            </TabsContent>

            <TabsContent value="approval" className="mt-0 focus-visible:ring-0 focus-visible:ring-offset-0">
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="min-w-0 space-y-4">
                  {/* Action Buttons */}
                  {invoice.status === 'Processing' &&
                    !isEditing &&
                    (invoice.approval_status ?? 'not_required') !== 'pending' && (
                    <div className="flex gap-3">
                      <Button
                        className="flex-1 bg-[#16A34A] hover:bg-[#15803D]"
                        onClick={() => handleStatusChange('Approved')}
                        disabled={loading || ['no_po', 'partial', 'mismatch'].includes(String(invoice.match_status || '').toLowerCase())}
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

                  {/* Approval Workflow (legacy amount-based level) */}
                  {invoice.approval_level &&
                    (invoice.approval_status ?? 'not_required') === 'not_required' &&
                    isPendingApproval(invoice.status, invoice.approval_level, invoice.approved_by) && (
                    <Card className="border-[#E3E8EF] shadow-sm">
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-[15px] font-semibold flex items-center gap-2">
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
                              className="flex-1 bg-[#16A34A] hover:bg-[#15803D]"
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
                              ⏸ Hold
                            </Button>
                            <Button
                              variant="outline"
                              className="flex-1 border-purple-400 text-purple-700 hover:bg-purple-50"
                              onClick={() => setShowQueryDialog(true)}
                              disabled={loading}
                            >
                              ❓ Query Vendor
                            </Button>
                          </div>

                          {/* Hold dialog */}
                          {showHoldDialog && (
                            <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 space-y-3">
                              <p className="text-sm font-medium text-orange-800">Reason for placing on hold</p>
                              <Textarea
                                placeholder="e.g. Waiting for corrected PO from procurement team…"
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
                                placeholder="e.g. Invoice amount does not match PO-2025-0341. Please send revised invoice…"
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

                  <Card className="border-[#E3E8EF] shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-[15px] font-semibold">Approval</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ApprovalChainPanel invoice={invoice} onRefresh={onUpdate} />
                    </CardContent>
                  </Card>

                  {/* Approval Status (if already approved/rejected) */}
                  {invoice.status === 'Approved' && invoice.approved_at && (
                    <Card className="border-[#E3E8EF] shadow-sm">
                      <CardHeader>
                        <CardTitle className="text-[15px] font-semibold flex items-center gap-2">
                          <CheckCircle className="h-5 w-5 text-[#16A34A]" />
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

                  {invoice.rejection_reason && (
                    <Card className="border-[#E3E8EF] shadow-sm">
                      <CardHeader>
                        <CardTitle className="text-[15px] font-semibold flex items-center gap-2">
                          <AlertCircle className="h-5 w-5 text-[#DC2626]" />
                          Rejection Reason
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-gray-700">{invoice.rejection_reason}</p>
                      </CardContent>
                    </Card>
                  )}
                </div>
                <div className="min-w-0 space-y-4">
                  {(invoice.status === 'Approved' || invoice.status === 'Paid' || invoice.payment_status === 'paid') && (
                    <Card className="border-[#E3E8EF] shadow-sm">
                      <CardHeader>
                        <CardTitle className="text-[15px] font-semibold">Payment</CardTitle>
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
                                  Reconciled{invoice.bank_ref ? ` · ${invoice.bank_ref}` : ''}
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[#92400E] border-[#FDE68A] text-xs">
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
                  {!(invoice.status === 'Approved' || isPaid) && (
                    <DetailCard title="Payment" icon={<Wallet className="h-4 w-4 text-[#246BFD]" />}>
                      <p className="text-[13px] text-slate-600">
                        {invoice.status === 'Rejected'
                          ? 'This invoice was rejected, so no payment is due.'
                          : 'Payment can be recorded once the invoice is approved.'}
                      </p>
                      {invoice.scheduled_payment_date && (
                        <p className="mt-2 text-xs text-slate-500">
                          Scheduled for {displayDate(invoice.scheduled_payment_date, dateFormat)}
                        </p>
                      )}
                    </DetailCard>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="activity" className="mt-0 focus-visible:ring-0 focus-visible:ring-offset-0">
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="min-w-0 space-y-4">
                  <Card className="border-[#E3E8EF] shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-[15px] font-semibold">Activity</CardTitle>
                      <p className="text-xs text-muted-foreground">
                        Compliance audit entries for this invoice (newest first)
                      </p>
                    </CardHeader>
                    <CardContent>
                      {activityLoading ? (
                        <p className="text-sm text-gray-500">Loading…</p>
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
                                        ? 'bg-[#EFF6FF] text-[#1E40AF] border-[#BFDBFE]'
                                        : e.action.startsWith('gst.')
                                          ? 'bg-[#F0FDF4] text-[#166534] border-[#BBF7D0]'
                                          : e.action.startsWith('duplicate.')
                                            ? 'bg-[#FFFBEB] text-[#78350F] border-[#FDE68A]'
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
                                className="mt-2 text-xs text-[#2563EB] hover:underline"
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
                </div>
                <div className="min-w-0 space-y-4">
                  {/* Audit Trail */}
                  <Card className="border-[#E3E8EF] shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-[15px] font-semibold">Audit Trail</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {auditLogs.length > 0 ? (
                        <div className="space-y-3">
                          {auditLogs.map((log) => (
                            <div
                              key={log.id}
                              className="flex items-start gap-3 rounded-lg border border-gray-200 p-3"
                            >
                              <div className="mt-0.5 rounded-full bg-[#DBEAFE] p-2">
                                <Clock className="h-4 w-4 text-[#2563EB]" />
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-medium">{log.action}</p>
                                {log.field_changed && (
                                  <p className="text-xs text-gray-600">
                                    {log.field_changed}
                                    {log.old_value && log.new_value && (
                                      <span>
                                        : {log.old_value} → {log.new_value}
                                      </span>
                                    )}
                                  </p>
                                )}
                                <p className="mt-1 text-xs text-gray-500">
                                  {log.user_name} •{' '}
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
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>

    {/* Duplicate alert before payment — exclusive of main detail modal */}
    <Dialog open={duplicateAlertOpen} onOpenChange={setDuplicateAlertOpen}>
      <DialogContent className="sm:max-w-md z-[10020]" overlayClassName="z-[10010]">
        <DialogHeader>
          <DialogTitle>⚠️ Possible Duplicate Invoice</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {duplicateAlert?.flagged && (
            <p className="rounded-lg bg-[#FEF2F2] border border-[#FECACA] p-3 text-[#991B1B] font-medium">
              This invoice is flagged as a duplicate in the database.
            </p>
          )}
          {(duplicateAlert?.potentialMatches.length ?? 0) > 0 && (
            <div>
              <p className="text-gray-700 mb-2">Found {duplicateAlert!.potentialMatches.length} other invoice(s) with the same vendor and amount:</p>
              <div className="space-y-1.5">
                {duplicateAlert!.potentialMatches.map((m) => (
                  <div key={m.id} className="rounded border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-xs">
                    <span className="font-semibold">{m.invoice_number}</span> — {m.vendor_name} — {m.currency} {Number(m.total_amount).toLocaleString()} — {m.invoice_date} — <span className="italic">{m.status}</span>
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
            className="bg-[#DC2626] hover:bg-[#B91C1C] text-white"
            onClick={() => { setDuplicateAlertOpen(false); setMarkPaidOpen(true); }}
          >
            Pay Anyway
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={markPaidOpen} onOpenChange={setMarkPaidOpen}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto z-[10020]" overlayClassName="z-[10010]">
        <DialogHeader>
          <DialogTitle>Mark invoice as paid</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground border-b pb-3">
          <span className="font-mono font-medium">{invoice.invoice_number}</span>
          {' · '}
          {invoice.vendor_name}
          {' · '}
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
              Payment Proof <span className="text-muted-foreground font-normal">(screenshot / receipt — optional)</span>
            </Label>
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={(e) => setPaymentProofFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm border border-gray-200 rounded-lg px-3 py-2 file:mr-3 file:py-1 file:px-2 file:border-0 file:rounded file:bg-[#EFF6FF] file:text-[#1D4ED8] file:text-xs"
            />
            {paymentProofFile && (
              <p className="text-xs text-gray-500">Selected: {paymentProofFile.name}</p>
            )}
            {paymentProofUploading && <p className="text-xs text-[#2563EB]">Uploading proof…</p>}
          </div>
          {invoice.payment_proof_url && (
            <div className="text-sm">
              <span className="text-gray-600">Existing proof: </span>
              <a href={invoice.payment_proof_url} target="_blank" rel="noreferrer" className="text-[#2563EB] underline text-xs">View</a>
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
            {markPaidSaving ? 'Saving…' : 'Confirm payment'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
