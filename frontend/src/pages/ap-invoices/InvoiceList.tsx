import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, type Invoice } from '@/lib/ap-invoice/supabase';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  Download,
  FileSpreadsheet,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  Upload,
  Zap,
} from 'lucide-react';
import { format } from 'date-fns';
import {
  COLUMNS_STORAGE_KEY,
  DEFAULT_SORT,
  EMPTY_FILTERS,
  invoiceProperty,
  matchesFilters,
  matchesStage,
  matchesView,
  OPTIONAL_COLUMNS,
  PAGE_SIZE_STORAGE_KEY,
  PAGE_SIZES,
  sortInvoices,
  type ListFilters,
  type OptionalColumn,
  type SortState,
  type StageFilter,
  type ViewMode,
} from './invoice-list/listModel';
import { ListPipeline } from './invoice-list/ListPipeline';
import { ListToolbar, type FilterOptions } from './invoice-list/ListToolbar';
import { InvoiceTable, statusLabel, type DetailTab, type GlDisplay } from './invoice-list/InvoiceTable';
import {
  PIPELINE_STAGE_KEYS,
  pipelineStages,
  type PipelineStage,
  type PipelineStageKey,
} from './dashboard/metrics';
import type { StageFilterState } from './dashboard/types';
import { InvoiceDetailModal } from '@/components/ap-invoice/InvoiceDetailModal';
import { listInvoiceAnomalies, scanInvoiceAnomalies } from '@/lib/ap-invoice/anomalyService';
import { bulkApproveApInvoices } from '@/lib/ap-invoice/bulkApproveService';
import { formatCurrency } from '@/utils/currency';
import { displayDate } from '@/utils/dateUtils';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { useAuth } from '@/context/AuthContext';
import { useCompany } from '@/context/CompanyContext';
import { resolveApSupabaseCompanyId } from '@/lib/ap-invoice/workspaceCompanySync';
import { getStoredWorkspaceId } from '@/services/workspaceService';
import { useErpSettings, toTallySettings } from '@/hooks/useErpSettings';
import { downloadTallyXML } from '@/utils/tallyExport';
import { downloadQBIIF } from '@/utils/quickbooksExport';
import { downloadXeroCSV } from '@/utils/xeroExport';
import * as XLSX from 'xlsx';
import {
  invoiceCoaCategoryKey,
  loadEffectiveCoaMappings,
  resolveGlFromMappings,
  type CoaMappingRow,
} from '@/services/coaVatMapping.service';

/** Keep the same object reference when refresh data is unchanged — prevents InvoiceDetailModal shake. */
function pickUpdatedInvoice(prev: Invoice | null, list: Invoice[]): Invoice | null {
  if (!prev) return null;
  const next = list.find((i) => i.id === prev.id);
  if (!next) return prev;
  const keys: (keyof Invoice)[] = [
    'status',
    'match_status',
    'po_id',
    'po_number',
    'gl_code',
    'gl_account_code',
    'risk_score',
    'payment_status',
    'ifrs_category',
    'vat_treatment',
    'property_ref',
    'gulftax_decision',
    'total_amount',
    'vendor_name',
    'updated_at',
  ];
  if (keys.every((k) => String(prev[k] ?? '') === String(next[k] ?? ''))) {
    return prev;
  }
  return next;
}
import { fetchInvoiceById } from '@/lib/ap-invoice/invoices';
import { ConfidenceBadge } from '@/components/invoices/ConfidenceBadge';
import { getEffectiveExtractionScore, invoiceNeedsExtractionReview } from '@/utils/extractionConfidence';
import { resolveDisplayMatchStatus } from '@/utils/threeWayMatch';
import { runAutoMatch, markEscalationDueIfNeeded } from '@/lib/ap-invoice/threeWayMatchService';
import { retryPendingGlPosts } from '@/lib/ap-invoice/glPostService';
import { resolveGLAccount, invoiceGlFieldsFromResult } from '@/utils/coaMapping';
import { IFRS_STANDARD_GL } from '@/utils/ifrsStandardGL';
import { glAccountDisplayName } from '@/utils/glAccountLabels';
import {
  deriveInvoiceRiskDisplayScore,
  deriveInvoiceRiskReason,
  invoiceHasRiskSignal,
  invoiceMatchesAnomalyTab,
  invoiceRiskTierForFilter,
} from '@/lib/ap-invoice/invoiceRiskDisplay';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { getMyCompany } from '@/lib/ap-invoice/companyService';
import { effectivePropertyRef } from '@/lib/ap-invoice/propertyFromGl';
import { listInvoicesViaApi } from '@/lib/ap-invoice/listInvoicesService';
import { deleteAllInvoicesViaApi } from '@/lib/ap-invoice/bulkUpsertService';
import { generateInvoicePdf } from '@/lib/ap-invoice/generateInvoicePdf';
import type { InvoiceLineItem } from '@/lib/ap-invoice/supabase';
import { storeInvoiceFile } from '@/lib/ap-invoice/invoiceStorageService';
import { CameraCapture } from '@/components/invoices/CameraCapture';
import { InvoiceExtractionPreviewModal } from '@/components/invoices/InvoiceExtractionPreviewModal';
import {
  extractInvoiceFromImageFile,
  normalizeExtractedInvoice,
  type NormalizedExtractedInvoice,
} from '@/lib/ap-invoice/cameraService';
import { useMarket } from '@/contexts/MarketContext';
import { seedDemoGstInvoices } from '@/lib/ap-invoice/gstService';
import { useIndustryConfig } from '@/context/IndustryConfigContext';
import { spendByTitle } from '@/services/industryConfig.service';
import { PintAeValidateModal } from '@/components/gulftax/PintAeValidateModal';

const DEBUG_INVOICE_NUMBERS = [
  'INV-FK-TEST',
  'INV-2026-DEBUG-400',
  'INV-2026-DEBUG-401',
  'INV-2026-DEBUG-402',
];

const statusColors: Record<string, string> = {
  Processing: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  Approved: 'bg-green-100 text-green-800 border-green-200',
  Rejected: 'bg-red-100 text-red-800 border-red-200',
  Paid: 'bg-blue-100 text-blue-800 border-blue-200',
  'On Hold': 'bg-orange-100 text-orange-800 border-orange-200',
  Queried: 'bg-purple-100 text-purple-800 border-purple-200',
  review_required: 'bg-amber-100 text-amber-800 border-amber-200',
  auto_approve: 'bg-green-100 text-green-800 border-green-200',
  blocked: 'bg-red-100 text-red-800 border-red-200',
};

/** Human-readable label for a status value. Handles known values plus any
 * raw snake_case value (e.g. "review_required") that leaks in from a sync path. */
function formatStatusLabel(status: string | null | undefined, source?: string | null): string {
  const s = String(status ?? '').trim();
  if (!s) return 'Unknown';
  if (s === 'review_required') return 'Needs Review';
  if (s === 'auto_approve') return 'Approved';
  if (s === 'blocked') return 'Blocked';
  if (s === 'Processing') return source === 'excel' ? 'Pending Approval' : 'AI Processing';
  if (/[A-Z\s]/.test(s) && !s.includes('_')) return s; // already human-formatted (e.g. "Approved", "On Hold")
  return s
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function invoicePaymentPill(inv: Invoice): { label: string; title?: string; variant: 'paid' | 'overdue' | 'pending' } {
  const paid = inv.status === 'Paid' || inv.payment_status === 'paid';
  if (paid) {
    const m = inv.payment_method?.trim();
    const utr = (inv.utr_number ?? inv.payment_reference)?.trim();
    return {
      label: m ? `Paid — ${m}` : 'Paid',
      title: utr ? `UTR / Ref: ${utr}` : undefined,
      variant: 'paid',
    };
  }
  if (inv.payment_status === 'overdue') return { label: 'Overdue', variant: 'overdue' };
  if (inv.payment_status === 'scheduled') return { label: 'Scheduled', variant: 'pending' };
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

function invoiceGlCode(inv: Invoice): string {
  return String(inv.gl_account_code ?? inv.gl_code ?? '').trim();
}

/** Prefer stored invoice GL; fall back to company/default COA map for any status. */
function displayGlFromCoaMap(
  inv: Invoice,
  mappings: CoaMappingRow[],
): { code: string; name: string; source: 'stored' | 'company' | 'default' } | null {
  const storedCode = invoiceGlCode(inv);
  const storedName = String(inv.gl_account_name ?? inv.gl_name ?? '').trim();
  if (storedCode) {
    return {
      code: storedCode,
      name: glAccountDisplayName(storedCode, storedName),
      source: 'stored',
    };
  }
  const key = invoiceCoaCategoryKey(inv);
  const hit = resolveGlFromMappings(mappings, key);
  if (!hit) return null;
  return {
    code: hit.gl_code,
    name: glAccountDisplayName(hit.gl_code, hit.gl_name),
    source: hit.source,
  };
}

/** Dirham unicode (د.إ) and Latin-1 mojibake (Ø¯.Ø¥) → ISO code for display */
function normalizeCurrencyCode(raw: string | null | undefined, market: string): string {
  const c = String(raw ?? '').trim();
  if (!c) return market === 'uae' ? 'AED' : 'INR';
  if (/^AED$/i.test(c)) return 'AED';
  if (c === 'د.إ' || c === 'Ø¯.Ø¥' || /[\u062F\u0625]/.test(c) || c.includes('Ø¯')) return 'AED';
  return c.toUpperCase();
}

/** INV-2026-001 → PO-2026-001 when that PO exists in the workspace. */
function inferPoNumberFromInvoiceNumber(invoiceNumber: string): string | null {
  const m = /^INV-(\d{4})-(\d+)$/i.exec(String(invoiceNumber || '').trim());
  if (!m) return null;
  return `PO-${m[1]}-${m[2]}`;
}

const DESCRIPTION_IFRS_KEYWORDS: Array<[RegExp, string]> = [
  [/construction|materials|civil|mep|electrical|installation/i, 'Industrial Supplies'],
  [/transport|delivery|logistics/i, 'Travel & Entertainment'],
  [/furniture|office|cleaning/i, 'Office Supplies'],
  [/utilit|electric|water/i, 'Utilities'],
  [/architect|design|consult|professional/i, 'Professional Services'],
  [/internet|telecom|software|\bit\b/i, 'IT Infrastructure'],
  [/marketing|advert/i, 'Marketing & Advertising'],
  [/rent|lease/i, 'Rent & Lease'],
];

/** DB `risk_score` is numeric — map anomaly tier strings to 0–100 scores. */
function normalizeRiskForDb(riskScore: unknown): { risk_score: number; risk_level: string } {
  if (typeof riskScore === 'number' && Number.isFinite(riskScore)) {
    const n = Math.round(riskScore);
    const level = n >= 60 ? 'High' : n >= 30 ? 'Medium' : 'Low';
    return { risk_score: n, risk_level: level };
  }
  const tier = String(riskScore ?? 'low').toLowerCase();
  if (tier === 'high') return { risk_score: 75, risk_level: 'High' };
  if (tier === 'medium') return { risk_score: 45, risk_level: 'Medium' };
  return { risk_score: 15, risk_level: 'Low' };
}

async function classifyInvoiceFromGl(
  inv: Invoice,
  companyId: string | null
): Promise<boolean> {
  if (inv.ifrs_category?.trim()) return true;

  const glCode = invoiceGlCode(inv);
  let category: string | null = null;
  let glRes = null;

  if (glCode) {
    let coaQuery = supabase
      .from('chart_of_accounts')
      .select('gl_code, account_name, ifrs_mapping')
      .eq('gl_code', glCode)
      .eq('is_active', true)
      .limit(1);
    if (companyId) coaQuery = coaQuery.eq('company_id', companyId);
    const { data: coa } = await coaQuery.maybeSingle();
    category = coa?.ifrs_mapping?.trim() || null;
    if (!category) {
      for (const [cat, { code }] of Object.entries(IFRS_STANDARD_GL)) {
        if (code === glCode) {
          category = cat;
          break;
        }
      }
    }
    if (category) {
      glRes = coa
        ? {
            gl_account: coa.gl_code,
            gl_account_name: coa.account_name,
            gl_source: 'company_coa' as const,
            gl_confirmed: true,
          }
        : await resolveGLAccount(supabase, category, companyId, {
            vendorName: inv.vendor_name,
            description: inv.description ?? '',
          });
    }
  }

  if (!category) {
    const text = `${inv.description ?? ''} ${inv.vendor_name ?? ''}`;
    for (const [re, cat] of DESCRIPTION_IFRS_KEYWORDS) {
      if (re.test(text)) {
        category = cat;
        glRes = await resolveGLAccount(supabase, cat, companyId, {
          vendorName: inv.vendor_name,
          description: inv.description ?? '',
        });
        break;
      }
    }
  }

  if (!category) {
    const text = `${inv.description ?? ''} ${inv.vendor_name ?? ''}`.toLowerCase();
    for (const cat of Object.keys(IFRS_STANDARD_GL)) {
      if (text.includes(cat.toLowerCase())) {
        category = cat;
        glRes = await resolveGLAccount(supabase, cat, companyId, {
          vendorName: inv.vendor_name,
          description: inv.description ?? '',
        });
        break;
      }
    }
  }

  if (!category) return false;

  const mergedGl = glRes ?? (await resolveGLAccount(supabase, category, companyId, {
    vendorName: inv.vendor_name,
    description: inv.description ?? '',
  }));

  const { error } = await supabase
    .from('invoices')
    .update({
      ifrs_category: category,
      ifrs_confidence: 85,
      ...invoiceGlFieldsFromResult(mergedGl),
      updated_at: new Date().toISOString(),
    })
    .eq('id', inv.id);

  return !error;
}

export function InvoiceList() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { accessToken } = useAuth();
  const workspaceId = getStoredWorkspaceId();
  const { market, isUAE } = useMarket();
  const { costCenterLabel } = useIndustryConfig();
  const { dateFormat } = useCompanySettings();
  const { activeCompanyId } = useCompany();
  const tallySettings = useErpSettings();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ListFilters>(EMPTY_FILTERS);
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [stageFilter, setStageFilter] = useState<StageFilter>(null);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [anomalyInvoiceIds, setAnomalyInvoiceIds] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(() => {
    const stored = Number(localStorage.getItem(PAGE_SIZE_STORAGE_KEY));
    return (PAGE_SIZES as readonly number[]).includes(stored) ? stored : 10;
  });
  const [columns, setColumns] = useState<Set<OptionalColumn>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(COLUMNS_STORAGE_KEY) || '[]');
      const known = new Set(OPTIONAL_COLUMNS.map((c) => c.key));
      return new Set((Array.isArray(raw) ? raw : []).filter((k): k is OptionalColumn => known.has(k)));
    } catch {
      return new Set();
    }
  });
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [drawerTab, setDrawerTab] = useState<DetailTab>('details');
  const [drawerExpanded, setDrawerExpanded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewNorm, setPreviewNorm] = useState<NormalizedExtractedInvoice | null>(null);
  const [previewConfidence, setPreviewConfidence] = useState<number | undefined>();
  const [coaMappings, setCoaMappings] = useState<CoaMappingRow[]>([]);
  const [savingExtract, setSavingExtract] = useState(false);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [seedingGst, setSeedingGst] = useState(false);
  const [pintAeInvoice, setPintAeInvoice] = useState<Invoice | null>(null);

  const patchFilters = useCallback((patch: Partial<ListFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  useEffect(() => {
    void retryPendingGlPosts();
    fetchInvoices();
    void deleteDebugInvoicesOnce();
    void loadEffectiveCoaMappings()
      .then(setCoaMappings)
      .catch(() => setCoaMappings([]));
    // Deep links from the dashboard, vendor pages and email intake.
    const urlParams = new URLSearchParams(window.location.search);
    const filterParam = urlParams.get('filter');
    const patch: Partial<ListFilters> = {};
    const vendorFilter = urlParams.get('vendor');
    if (vendorFilter) patch.search = vendorFilter;
    if (filterParam === 'unclassified') patch.ifrs = 'not_classified';
    if (filterParam === 'match_issues') patch.match = 'match_issues';
    const statusParam = urlParams.get('status');
    if (statusParam) patch.status = statusParam;
    if (urlParams.get('advance') === '1') patch.advanceOnly = true;
    const receivedAt = urlParams.get('receivedAt');
    if (receivedAt) {
      patch.receivedAt = decodeURIComponent(receivedAt);
      patch.source = 'email';
    }
    if (Object.keys(patch).length > 0) patchFilters(patch);
    if (filterParam === 'duplicates') setViewMode('duplicates');
    if (filterParam === 'approvals') setViewMode('approvals');
    if (filterParam === 'needs-review' || urlParams.get('tab') === 'needs-review') {
      setViewMode('needs_review');
    }
    if (urlParams.get('tab') === 'anomalies') setViewMode('anomalies');
    const stageParam = urlParams.get('stage') as PipelineStageKey | null;
    if (stageParam && PIPELINE_STAGE_KEYS.has(stageParam)) {
      const stateParam = urlParams.get('state');
      const state: StageFilterState =
        stateParam === 'done' || stateParam === 'pending' || stateParam === 'issue' || stateParam === 'na'
          ? stateParam
          : 'open';
      setStageFilter({ stage: stageParam, state });
    }
  }, [workspaceId, activeCompanyId]);

  /** Reload open anomaly invoice ids using the same company scope as the list. */
  async function refreshAnomalyInvoiceIds(companyId: string | null, invoiceList: Invoice[]) {
    try {
      let rows = await listInvoiceAnomalies({ status: 'open', companyId });
      // Company drift: if scoped query is empty but invoices exist, load all open flags and
      // keep only those that belong to invoices currently on screen.
      if (rows.length === 0 && invoiceList.length > 0) {
        rows = await listInvoiceAnomalies({ status: 'open', companyId: null });
        const visible = new Set(invoiceList.map((i) => i.id));
        rows = rows.filter((r) => r.invoice_id && visible.has(r.invoice_id));
      }
      setAnomalyInvoiceIds(new Set(rows.map((r) => r.invoice_id).filter(Boolean) as string[]));
    } catch {
      // Fall back to invoice-row signals (risk_score / risk_flags) in the Anomaly tab filter
      setAnomalyInvoiceIds(new Set());
    }
  }

  useEffect(() => {
    const onSynced = () => { void fetchInvoices({ quiet: true }); };
    window.addEventListener('ap-company-synced', onSynced);
    return () => window.removeEventListener('ap-company-synced', onSynced);
  }, [accessToken, workspaceId]);

  // Filtering is staged so each control counts against the right population:
  // view chips count the base set, the pipeline counts the active view, the table shows the stage slice.
  const baseFiltered = useMemo(() => {
    const today = new Date();
    return invoices.filter((inv) => matchesFilters(inv, filters, today));
  }, [invoices, filters]);

  const viewCounts = useMemo(() => {
    const counts = {} as Record<ViewMode, number>;
    for (const v of ['all', 'approvals', 'duplicates', 'needs_review', 'anomalies'] as ViewMode[]) {
      counts[v] = baseFiltered.filter((inv) => matchesView(inv, v, anomalyInvoiceIds)).length;
    }
    return counts;
  }, [baseFiltered, anomalyInvoiceIds]);

  const viewFiltered = useMemo(
    () => baseFiltered.filter((inv) => matchesView(inv, viewMode, anomalyInvoiceIds)),
    [baseFiltered, viewMode, anomalyInvoiceIds],
  );

  const listStages = useMemo(() => pipelineStages(viewFiltered), [viewFiltered]);

  const filteredInvoices = useMemo(
    () => sortInvoices(viewFiltered.filter((inv) => matchesStage(inv, stageFilter)), sort),
    [viewFiltered, stageFilter, sort],
  );

  const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / pageSize));
  const page = Math.min(currentPage, totalPages);
  const paginatedInvoices = filteredInvoices.slice((page - 1) * pageSize, page * pageSize);

  // Only an explicit change of the result definition sends the user back to page 1;
  // background refreshes (approve, save, sync) keep the current page.
  useEffect(() => {
    setCurrentPage(1);
  }, [filters, viewMode, stageFilter, sort, pageSize]);

  useEffect(() => {
    localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(pageSize));
  }, [pageSize]);

  useEffect(() => {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify([...columns]));
  }, [columns]);

  const filterOptions = useMemo<FilterOptions>(() => {
    const uniq = (values: (string | null | undefined)[]) =>
      Array.from(new Set(values.map((v) => (v || '').trim()).filter(Boolean))).sort();
    const gl = new Map<string, string>();
    for (const inv of invoices) {
      const d = displayGlFromCoaMap(inv, coaMappings);
      if (d?.source === 'stored' && !gl.has(d.code)) gl.set(d.code, d.name || '');
    }
    return {
      statuses: uniq(invoices.map((inv) => inv.status)),
      ifrs: uniq(invoices.map((inv) => inv.ifrs_category)),
      gl: [...gl.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, name]) => ({ code, name })),
      property: uniq(invoices.map(invoiceProperty)),
      costCenter: uniq(invoices.map((inv) => inv.cost_center)),
    };
  }, [invoices, coaMappings]);

  /** Dropdown options only list values present on loaded invoices; drop stale picks after a refresh. */
  useEffect(() => {
    if (loading) return;
    const stale: Partial<ListFilters> = {};
    if (filters.ifrs !== 'all' && filters.ifrs !== 'not_classified' && !filterOptions.ifrs.includes(filters.ifrs)) {
      stale.ifrs = 'all';
    }
    if (filters.gl !== 'all' && filters.gl !== 'uncoded' && !filterOptions.gl.some((g) => g.code === filters.gl)) {
      stale.gl = 'all';
    }
    if (Object.keys(stale).length > 0) patchFilters(stale);
  }, [loading, filterOptions, filters.ifrs, filters.gl, patchFilters]);

  const classifyTargets = useMemo(() => {
    const stale = new Set(['mismatch', 'no_po', 'partial', 'unmatched', '']);
    return invoices.filter((inv) => inv.status === 'Processing' || stale.has(inv.match_status || ''));
  }, [invoices]);

  const staleMatchTargets = useMemo(
    () => invoices.filter((inv) => ['mismatch', 'no_po', 'partial'].includes(inv.match_status || '')),
    [invoices],
  );

  function clearInvoiceListFilters() {
    setFilters(EMPTY_FILTERS);
    setViewMode('all');
    setStageFilter(null);
    setSort(DEFAULT_SORT);
    navigate('/ap-invoices/list', { replace: true });
  }

  function changeView(next: ViewMode) {
    setViewMode(next);
    if (window.location.search) navigate('/ap-invoices/list', { replace: true });
  }

  function openInvoice(inv: Invoice, tab: DetailTab = 'details') {
    setSelectedInvoice(inv);
    setDrawerTab(tab);
  }

  function closeInvoice() {
    setSelectedInvoice(null);
    setDrawerExpanded(false);
  }

  // Bulk actions operate on what is visible, so drop selections that a filter has hidden.
  useEffect(() => {
    const visible = new Set(filteredInvoices.map((inv) => inv.id));
    setSelectedIds((prev) => {
      const next = prev.filter((id) => visible.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [filteredInvoices]);

  const drawerOpen = !!selectedInvoice && !drawerExpanded;
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      closeInvoice();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  async function deleteDebugInvoicesOnce() {
    try {
      const { data, error } = await supabase
        .from('invoices')
        .delete()
        .in('invoice_number', DEBUG_INVOICE_NUMBERS)
        .select('invoice_number');
      if (error) {
        console.warn('[AP] Debug invoice cleanup skipped:', error.message);
        return;
      }
      if (data && data.length > 0) {
        setInvoices((prev) => prev.filter((i) => !DEBUG_INVOICE_NUMBERS.includes(i.invoice_number)));
        toast({
          title: 'Test invoices removed',
          description: `Deleted ${data.length} debug invoice${data.length === 1 ? '' : 's'}.`,
        });
      }
    } catch (e) {
      console.warn('[AP] Debug invoice cleanup failed:', e);
    }
  }

  async function handleBulkClassifyAndMatch() {
    const stale = new Set(['mismatch', 'no_po', 'partial', 'unmatched', '']);
    const seen = new Set<string>();
    const targets = invoices.filter((inv) => {
      if (seen.has(inv.id)) return false;
      const processing = inv.status === 'Processing';
      const needsMatch = stale.has(String(inv.match_status || '').toLowerCase());
      if (!processing && !needsMatch) return false;
      seen.add(inv.id);
      return true;
    });
    if (targets.length === 0) {
      toast({ title: 'Nothing to process', description: 'No invoices waiting for classify or 3-way match.' });
      return;
    }

    setBulkProcessing(true);
    let classified = 0;
    let matched = 0;
    let approved = 0;
    let failed = 0;

    try {
      let companyId: string | null = null;
      try {
        companyId = await resolveApSupabaseCompanyId(accessToken);
      } catch {
        companyId = (await getMyCompany())?.id ?? null;
      }

      if (companyId) {
        try {
          const { ensureWorkspaceMatchesViaApi } = await import('@/lib/ap-invoice/matchApiService');
          await ensureWorkspaceMatchesViaApi(companyId);
        } catch (e) {
          console.warn('[AP] ensure workspace POs/GRNs:', e);
        }
      }

      for (const invRaw of targets) {
        let inv = invRaw;
        try {
          const inferredPo = inferPoNumberFromInvoiceNumber(inv.invoice_number);
          if (!inv.po_number?.trim() && inferredPo) {
            await supabase
              .from('invoices')
              .update({ po_number: inferredPo, updated_at: new Date().toISOString() })
              .eq('id', inv.id);
            inv = { ...inv, po_number: inferredPo };
          }

          const didClassify = await classifyInvoiceFromGl(inv, companyId);
          if (didClassify) classified += 1;

          const matchResult = await runAutoMatch(inv.id, {
            respectUploadSetting: false,
            invoice: inv,
            invoiceNumber: inv.invoice_number,
          });
          if (
            matchResult.invoice_match_status === 'matched' ||
            matchResult.invoice_match_status === 'three_way_matched' ||
            matchResult.invoice_match_status === 'partial'
          ) {
            matched += 1;
          }
          if (matchResult.auto_approved) approved += 1;
        } catch (e) {
          failed += 1;
          console.warn('[AP] Bulk classify/match failed for', inv.invoice_number, e);
        }
      }

      await fetchInvoices();
      toast({
        title: 'Bulk processing complete',
        description: `${targets.length} invoice(s): ${classified} classified, ${matched} matched, ${approved} auto-approved${failed ? `, ${failed} failed` : ''}.`,
      });
    } catch (e) {
      console.error('[AP] Bulk classify/match error:', e);
      toast({
        title: 'Bulk processing failed',
        description: e instanceof Error ? e.message : 'Try again.',
        variant: 'destructive',
      });
    } finally {
      setBulkProcessing(false);
    }
  }

  async function handleSeedGstDemo() {
    setSeedingGst(true);
    try {
      const r = await seedDemoGstInvoices();
      toast({ title: r.seeded > 0 ? 'GST demo invoices seeded' : 'Already seeded', description: r.message });
      await fetchInvoices();
    } catch (e) {
      // Supabase errors are plain objects, not Error instances — String(e) on
      // those yields the useless literal "[object Object]". Pull the real
      // message/details out instead.
      const raw = e as { message?: string; details?: string; hint?: string; code?: string } | Error | undefined;
      const msg =
        e instanceof Error
          ? e.message
          : raw?.message || raw?.details || raw?.hint || JSON.stringify(raw) || 'Unknown error';
      console.error('Seed GST demo invoices failed:', e);
      toast({ title: 'Seed failed', description: msg, variant: 'destructive' });
    } finally {
      setSeedingGst(false);
    }
  }

  /**
   * Force-recompute match_status for invoices whose cached result still looks
   * unresolved. Unlike handleBulkClassifyAndMatch, this isn't gated by
   * status === 'Processing' — it targets by match_status instead, so invoices
   * that moved past "Processing" while carrying a stale mismatch (e.g. because
   * the underlying PO/GRN data was fixed after the last match run) can be
   * refreshed without waiting for a new upload.
   */
  async function handleBulkRerunStaleMatches() {
    const staleStatuses = ['mismatch', 'no_po', 'partial'];
    const targets = invoices.filter((inv) => staleStatuses.includes(String(inv.match_status || '').toLowerCase()));
    if (targets.length === 0) {
      toast({ title: 'Nothing to re-match', description: 'No invoices with a mismatch/partial/no-PO status.' });
      return;
    }

    setBulkProcessing(true);
    let resolved = 0;
    let failed = 0;

    try {
      try {
        const companyId = await resolveApSupabaseCompanyId().catch(async () => (await getMyCompany())?.id ?? null);
        if (companyId) {
          const { ensureWorkspaceMatchesViaApi } = await import('@/lib/ap-invoice/matchApiService');
          await ensureWorkspaceMatchesViaApi(companyId);
        }
      } catch (e) {
        console.warn('[AP] ensure workspace POs/GRNs:', e);
      }
      for (const inv of targets) {
        try {
          const matchResult = await runAutoMatch(inv.id, {
            respectUploadSetting: false,
            invoice: inv,
            invoiceNumber: inv.invoice_number,
          });
          if (
            matchResult.invoice_match_status === 'matched' ||
            matchResult.invoice_match_status === 'three_way_matched' ||
            matchResult.invoice_match_status === 'partial'
          ) {
            resolved += 1;
          }
        } catch (e) {
          failed += 1;
          console.warn('[AP] Re-run match failed for', inv.invoice_number, e);
        }
      }

      await fetchInvoices({ quiet: true });
      toast({
        title: 'Re-run match complete',
        description: `${targets.length} invoice(s) re-checked: ${resolved} now resolved${failed ? `, ${failed} failed` : ''}.`,
      });
    } catch (e) {
      console.error('[AP] Bulk re-run match error:', e);
      toast({
        title: 'Re-run match failed',
        description: e instanceof Error ? e.message : 'Try again.',
        variant: 'destructive',
      });
    } finally {
      setBulkProcessing(false);
    }
  }

  async function handleBulkApproveSelected() {
    const selected = filteredInvoices.filter(
      (inv) =>
        selectedIds.includes(inv.id) &&
        inv.status !== 'Approved' &&
        inv.status !== 'Paid' &&
        String(inv.gulftax_decision || '').toUpperCase() !== 'HARD_BLOCK',
    );
    if (selected.length === 0) {
      toast({
        title: 'Nothing to approve',
        description: 'Select Processing / On Hold invoices (not already approved or hard-blocked).',
      });
      return;
    }
    if (
      !window.confirm(
        isUAE
          ? `Approve ${selected.length} selected invoice(s) and sync to GulfTax / VAT Return?`
          : `Approve ${selected.length} selected invoice(s)?`,
      )
    ) {
      return;
    }

    setBulkProcessing(true);
    try {
      let companyId: string | null = null;
      try {
        companyId = await resolveApSupabaseCompanyId(accessToken);
      } catch {
        companyId = (await getMyCompany())?.id ?? null;
      }
      const result = await bulkApproveApInvoices(
        selected.map((i) => i.id),
        companyId || selected[0]?.company_id || null,
      );
      await fetchInvoices();
      setSelectedIds([]);
      toast({
        title: 'Bulk approve complete',
        description: `${result.approved_count} approved${
          isUAE ? ` · ${result.gulftax_synced} synced to GulfTax` : ''
        }${
          isUAE && result.gulftax_skipped ? ` · ${result.gulftax_skipped} already synced` : ''
        }${isUAE && result.gulftax_errors ? ` · ${result.gulftax_errors} sync errors` : ''}${
          result.failed?.length ? ` · ${result.failed.length} failed` : ''
        }.`,
        variant: result.failed?.length ? 'destructive' : 'default',
      });
    } catch (e) {
      toast({
        title: 'Bulk approve failed',
        description: e instanceof Error ? e.message : 'Try again.',
        variant: 'destructive',
      });
    } finally {
      setBulkProcessing(false);
    }
  }

  async function fetchInvoices(opts?: { quiet?: boolean }) {
    let invoiceList: Invoice[] = [];
    let companyId: string | null = null;
    try {
      if (!opts?.quiet) setLoading(true);
      // Prefer the banner company (Al Noor / Gnanova UAE Test FZE). Workspace-only
      // resolve can pick the wrong AP company when several share one workspace.
      if (activeCompanyId) {
        companyId = activeCompanyId;
      } else {
        try {
          companyId = await resolveApSupabaseCompanyId(accessToken);
        } catch {
          const company = await getMyCompany();
          companyId = company?.id ?? null;
        }
      }

      // Prefer service-role API — FinReport JWT sessions often have no Supabase auth,
      // so browser RLS returns 0 rows even after a successful Excel import.
      if (companyId) {
        try {
          invoiceList = await listInvoicesViaApi(companyId, 500);
        } catch (apiErr) {
          console.warn('[AP] list-invoices API failed, falling back to browser Supabase:', apiErr);
        }
      }

      if (invoiceList.length === 0) {
        let q = supabase.from('invoices').select('*').order('created_at', { ascending: false });
        if (companyId) q = q.eq('company_id', companyId);
        const { data, error } = await q;
        if (error) throw error;
        invoiceList = data || [];
        // Do NOT fall back to "all invoices in database" — that made empty
        // companies (e.g. Gnanova UAE Test FZE) look like they owned Al Noor's data.
      }

      setInvoices(invoiceList);
      setLoadError(null);
      setSelectedInvoice((prev) => pickUpdatedInvoice(prev, invoiceList));

      void refreshAnomalyInvoiceIds(companyId, invoiceList);
      void markEscalationDueIfNeeded(invoiceList, companyId);
    } catch (error) {
      console.error('Error fetching invoices:', error);
      setLoadError(error instanceof Error ? error.message : 'Invoices could not be loaded.');
    } finally {
      if (!opts?.quiet) setLoading(false);
    }

    if (invoiceList.length === 0) return;

    // Risk backfill + PO auto-match run in background so the list renders immediately
    void enrichInvoicesInBackground(invoiceList, companyId);
  }

  async function enrichInvoicesInBackground(invoiceList: Invoice[], companyId: string | null) {
    try {
      // Backfill risk_score for invoices that have null (existing invoices)
      // Stop after first 400 so missing/wrong schema doesn't cause hundreds of errors
      const needsRiskCheck = invoiceList.filter((inv: Invoice) => inv.risk_score == null);
      if (needsRiskCheck.length > 0) {
        let backfillAborted = false;
        for (const inv of needsRiskCheck) {
          if (backfillAborted) break;
          try {
            if (!inv.company_id) continue;
            const result = await scanInvoiceAnomalies(
              {
                id: inv.id,
                company_id: inv.company_id,
                invoice_number: inv.invoice_number,
                invoice_date: inv.invoice_date,
                due_date: inv.due_date,
                vendor_name: inv.vendor_name,
                vendor_email: inv.vendor_email ?? null,
                vendor_trn: inv.vendor_trn ?? null,
                gstin: inv.gstin ?? null,
                total_amount: Number(inv.total_amount),
                po_number: inv.po_number ?? null,
                po_id: inv.po_id ?? null,
                description: (inv as { description?: string | null }).description ?? null,
                created_at: inv.created_at ?? null,
                status: inv.status ?? null,
                payment_status: inv.payment_status ?? null,
              },
              'list-backfill',
            );
            setInvoices((prev) =>
              prev.map((i) =>
                i.id === inv.id
                  ? ({
                      ...i,
                      risk_score: result.overall_risk_score,
                      risk_level:
                        result.overall_risk_score >= 60
                          ? 'High'
                          : result.overall_risk_score >= 30
                            ? 'Medium'
                            : 'Low',
                      risk_flags: result.flags.map((f) => ({
                        type: f.flag_code,
                        severity: f.severity,
                        message: f.flag_reason,
                        explanation: JSON.stringify(f.flag_details ?? {}),
                      })),
                    } as unknown as Invoice)
                  : i
              )
            );
          } catch (e) {
            console.warn('Failed to backfill risk for invoice', inv.invoice_number, e);
            backfillAborted = true;
          }
        }
      }

      // Auto-link PO + run 3-way match when invoice already has a PO number but no po_id (e.g. OCR PO, email ingest, or case mismatch)
      // `!inv.match_status` also picks up Excel/bulk imports that landed without a match run —
      // they would otherwise sit on "— No PO" forever. Self-limiting: a run always writes a status.
      const needPoAutoLink = invoiceList.filter(
        (inv: Invoice) =>
          (String(inv.po_number || '').trim() !== '' && !inv.po_id) ||
          !inv.match_status ||
          (inv.po_id && ['no_po', ''].includes(String(inv.match_status || '').toLowerCase()))
      );
      if (needPoAutoLink.length > 0) {
        try {
          if (companyId) {
            const { ensureWorkspaceMatchesViaApi } = await import('@/lib/ap-invoice/matchApiService');
            await ensureWorkspaceMatchesViaApi(companyId);
          }
        } catch (e) {
          console.warn('[AP] ensure workspace POs before auto-link:', e);
        }
        let anyUpdated = false;
        for (const inv of needPoAutoLink.slice(0, 60)) {
          try {
            await runAutoMatch(inv.id, {
              respectUploadSetting: false,
              invoice: inv,
              invoiceNumber: inv.invoice_number,
            });
            anyUpdated = true;
          } catch (e) {
            console.warn('Auto PO link / 3-way match failed for', inv.invoice_number, e);
          }
        }
        if (anyUpdated) {
          let refreshCompanyId = companyId;
          if (!refreshCompanyId) {
            try {
              refreshCompanyId = await resolveApSupabaseCompanyId(accessToken);
            } catch {
              refreshCompanyId = (await getMyCompany())?.id ?? null;
            }
          }
          if (refreshCompanyId) {
            try {
              const refreshed = await listInvoicesViaApi(refreshCompanyId, 500);
              if (refreshed.length > 0) {
                setInvoices(refreshed);
                setSelectedInvoice((prev) => pickUpdatedInvoice(prev, refreshed));
              }
            } catch {
              let rq = supabase.from('invoices').select('*').order('created_at', { ascending: false });
              rq = rq.eq('company_id', refreshCompanyId);
              const { data: refreshed } = await rq;
              if (refreshed) {
                setInvoices(refreshed);
                setSelectedInvoice((prev) => pickUpdatedInvoice(prev, refreshed));
              }
            }
          }
        }
      }
    } catch (error) {
      console.warn('Invoice list background enrichment failed:', error);
    }
  }

  function toggleSelectAll() {
    const pageIds = paginatedInvoices.map((inv) => inv.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
    setSelectedIds((prev) =>
      allSelected ? prev.filter((id) => !pageIds.includes(id)) : Array.from(new Set([...prev, ...pageIds])),
    );
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
      let companyId: string | null = null;
      try {
        companyId = await resolveApSupabaseCompanyId(accessToken);
      } catch {
        companyId = (await getMyCompany())?.id ?? null;
      }
      if (!companyId) throw new Error('Could not determine company — please refresh and try again.');

      // Try backend service-role endpoint first (bypasses RLS)
      let deleted = 0;
      let apiOk = false;
      try {
        const result = await deleteAllInvoicesViaApi(companyId);
        if (result.ok) {
          deleted = result.deleted;
          apiOk = true;
        }
      } catch {
        apiOk = false;
      }

      // Fallback: direct Supabase delete (works when user has a valid Supabase session)
      if (!apiOk) {
        const { error } = await supabase
          .from('invoices')
          .delete()
          .eq('company_id', companyId);
        if (error) throw new Error(error.message);
        deleted = invoices.length;
      }

      setInvoices([]);
      setSelectedIds([]);
      setSelectedInvoice(null);
      setDeleteAllDialogOpen(false);
      toast({
        title: 'Invoices removed',
        description: `Deleted ${deleted} invoice${deleted === 1 ? '' : 's'}.`,
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
      const res = await extractInvoiceFromImageFile(file, market);
      const n = normalizeExtractedInvoice(res.invoice);
      setPreviewNorm({
        ...n,
        invoice_kind: filters.kind === 'sales' ? 'sales' : n.invoice_kind,
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
        file_url: await storeInvoiceFile(capturedFile, company?.id, 'camera'),
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
    // Sheet 1 — Invoices summary
    // Every field the OCR extraction/import can populate — not just the
    // summary columns — so the export reflects "whatever was on the PDF",
    // matching the client's raw-data requirement, not just the app's own
    // workflow-tracking fields.
    const headers = [
      'Invoice #', 'Vendor', 'Vendor TRN', 'Vendor Email', 'Vendor Phone', 'Vendor Address',
      'Vendor GSTIN', 'Buyer GSTIN', 'HSN/SAC', 'Place of Supply', 'Supply Type', 'Reverse Charge',
      'Date', 'Due Date', 'Subtotal (Net)', 'Taxable Amount', 'CGST', 'SGST', 'IGST',
      'VAT Amount', 'VAT Rate (%)', 'VAT Treatment',
      'Total Amount', 'Currency', 'Status',
      'GL Code', 'GL Name', 'IFRS Category', 'Tax Type', 'Tax Amount',
      'TDS Section', 'TDS Amount',
      'PO Number', 'Cost Center', 'Department', 'Property', 'Project Code',
      'Match Status', 'Risk Score',
      'Approval Level', 'Approved By', 'Payment Status', 'Description', 'Source',
    ];
    const rows = invList.map((inv) => [
      inv.invoice_number,
      inv.vendor_name,
      inv.vendor_trn || '',
      inv.vendor_email || '',
      inv.vendor_phone || '',
      inv.vendor_address || '',
      inv.vendor_gstin || inv.gstin || '',
      (inv as unknown as { buyer_gstin?: string }).buyer_gstin || '',
      inv.hsn_sac || (inv as unknown as { hsn_sac_code?: string }).hsn_sac_code || '',
      (inv as unknown as { place_of_supply?: string }).place_of_supply || '',
      (inv as unknown as { supply_type?: string }).supply_type || '',
      inv.reverse_charge ? 'Yes' : '',
      displayDate(inv.invoice_date, dateFormat),
      displayDate(inv.due_date, dateFormat),
      inv.subtotal_amount ?? '',
      (inv as unknown as { taxable_amount?: number }).taxable_amount ?? inv.subtotal_amount ?? '',
      inv.cgst ?? (inv as unknown as { cgst_amount?: number }).cgst_amount ?? '',
      inv.sgst ?? (inv as unknown as { sgst_amount?: number }).sgst_amount ?? '',
      inv.igst ?? (inv as unknown as { igst_amount?: number }).igst_amount ?? '',
      inv.vat_amount ?? '',
      inv.vat_rate ?? '',
      inv.vat_treatment || '',
      inv.total_amount,
      inv.currency,
      inv.status,
      inv.gl_code || inv.gl_account_code || '',
      inv.gl_name || inv.gl_account_name || '',
      inv.ifrs_category || '',
      inv.tax_type || '',
      inv.tax_amount || 0,
      inv.tds_section || '',
      inv.tds_amount ?? '',
      inv.po_number || '',
      inv.cost_center || '',
      inv.department || '',
      effectivePropertyRef(inv.property_ref, invoiceGlCode(inv)) || '',
      inv.project_code || '',
      inv.match_status || '',
      inv.risk_score || '',
      inv.approval_level || '',
      inv.approved_by || '',
      inv.payment_status || '',
      (inv as unknown as { description?: string }).description || '',
      inv.source || '',
    ]);
    const ws1 = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    // Auto-width columns
    ws1['!cols'] = headers.map((h, i) => ({
      wch: Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length), 12),
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, 'Invoices');

    // Sheet 2 — Line Items (fetch from DB for selected invoices)
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
    const headers = `Vendor,Document,Posting Date,Due Date,Amount,Currency,${costCenterLabel},GL Account`;
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

  async function downloadInvoicePdf(invoice: Invoice) {
    let lineItems: InvoiceLineItem[] = [];
    try {
      const { data } = await supabase
        .from('invoice_line_items')
        .select('*')
        .eq('invoice_id', invoice.id)
        .order('created_at');
      lineItems = (data ?? []) as InvoiceLineItem[];
    } catch { /* ignore — fallback to single row */ }
    generateInvoicePdf(invoice, '', lineItems);
  }

  function glDisplayFor(inv: Invoice): GlDisplay {
    const d = displayGlFromCoaMap(inv, coaMappings);
    return d ? { code: d.code, name: d.name, suggested: d.source !== 'stored' } : null;
  }

  function selectStage(stage: PipelineStage) {
    setStageFilter((prev) => {
      if (prev?.stage === stage.key) return null;
      return { stage: stage.key, state: stage.pending + stage.issue > 0 ? 'open' : 'done' };
    });
  }

  if (loading && invoices.length === 0) {
    return (
      <div className="flex h-[calc(100vh-12rem)] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-[#1765F5]"></div>
          <p className="mt-4 text-[13px] text-[#64748B]">Loading invoices…</p>
        </div>
      </div>
    );
  }

  const runDisabledReason = bulkProcessing
    ? 'A bulk run is already in progress'
    : classifyTargets.length === 0
      ? 'Nothing to run — no invoices are pending approval or carry an unresolved match result'
      : undefined;
  const exportItems: { label: string; run: () => void }[] = [
    { label: 'Invoice data (Excel)', run: () => void exportExcel(filteredInvoices) },
    { label: 'Tally XML', run: () => downloadTallyXML(filteredInvoices, toTallySettings(tallySettings)) },
    { label: 'QuickBooks IIF', run: () => downloadQBIIF(filteredInvoices) },
    { label: 'Xero CSV', run: () => downloadXeroCSV(filteredInvoices) },
    { label: 'Zoho Books CSV', run: () => exportZohoCSV(filteredInvoices) },
    { label: 'SAP CSV', run: () => exportSAPCSV(filteredInvoices) },
  ];
  const selectedRows = filteredInvoices.filter((inv) => selectedIds.includes(inv.id));

  const emptyState = loadError && invoices.length === 0 ? (
    <div className="space-y-3">
      <AlertTriangle className="mx-auto h-6 w-6 text-[#DC2626]" aria-hidden />
      <p className="font-semibold text-[#152238]">Invoices could not be loaded</p>
      <p className="mx-auto max-w-md text-[12px] text-[#64748B]">{loadError}</p>
      <Button size="sm" variant="outline" onClick={() => void fetchInvoices()}>
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
      </Button>
    </div>
  ) : invoices.length === 0 ? (
    <div className="space-y-3">
      <p className="font-semibold text-[#152238]">No invoices yet for this company</p>
      <p className="text-[12px] text-[#64748B]">Upload PDFs or images, import Excel, or forward invoices by email.</p>
      <Button size="sm" className="bg-[#1765F5] hover:bg-[#0F55D8]" onClick={() => navigate('/ap-invoices/upload')}>
        <Upload className="mr-1.5 h-3.5 w-3.5" /> Upload invoices
      </Button>
    </div>
  ) : (
    <div className="space-y-3">
      <p className="font-semibold text-[#152238]">No invoices match the current filters</p>
      <p className="text-[12px] text-[#64748B]">
        {invoices.length} invoice{invoices.length === 1 ? ' is' : 's are'} loaded — widen the search, stage or filters to see them.
      </p>
      <Button size="sm" variant="outline" onClick={clearInvoiceListFilters}>
        Reset filters
      </Button>
    </div>
  );

  return (
    <div className="flex items-start gap-4 text-[#152238]">
      <div className="min-w-0 flex-1 space-y-3">
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h1 className="text-[24px] font-bold leading-tight tracking-tight text-[#0B1D33]">Invoice List</h1>
            <p className="mt-0.5 text-[13px] text-[#64748B]">Manage and review all invoices</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span title={runDisabledReason ?? 'Classify IFRS categories and re-run 3-way match for invoices pending approval or with an unresolved match'}>
              <Button
                variant="outline"
                size="sm"
                disabled={!!runDisabledReason}
                onClick={() => void handleBulkClassifyAndMatch()}
                className="h-9 border-[#1765F5] bg-white text-[#1765F5] hover:bg-[#EEF4FF] hover:text-[#1765F5]"
              >
                <Zap className="mr-1.5 h-4 w-4" aria-hidden />
                {bulkProcessing ? 'Processing…' : `Run 3-Way Match & Classify (${classifyTargets.length})`}
              </Button>
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  disabled={filteredInvoices.length === 0}
                  title={filteredInvoices.length === 0 ? 'No invoices in the current view to export' : undefined}
                  className="h-9 bg-[#1765F5] text-white hover:bg-[#0F55D8]"
                >
                  <Download className="mr-1.5 h-4 w-4" aria-hidden />
                  Export
                  <ChevronDown className="ml-1 h-3.5 w-3.5" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-[11px] font-normal text-[#64748B]">
                  Exports the {filteredInvoices.length} invoice{filteredInvoices.length === 1 ? '' : 's'} in the current view
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {exportItems.map((item) => (
                  <DropdownMenuItem key={item.label} onSelect={item.run} className="text-[13px]">
                    <FileSpreadsheet className="mr-2 h-3.5 w-3.5 text-[#64748B]" aria-hidden />
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 w-9 bg-white p-0" aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem
                  disabled={bulkProcessing || staleMatchTargets.length === 0}
                  onSelect={() => void handleBulkRerunStaleMatches()}
                  className="text-[13px]"
                >
                  <RefreshCw className="mr-2 h-3.5 w-3.5 text-[#64748B]" aria-hidden />
                  Re-run stale matches ({staleMatchTargets.length})
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate('/ap-invoices/upload')} className="text-[13px]">
                  <Upload className="mr-2 h-3.5 w-3.5 text-[#64748B]" aria-hidden />
                  Upload invoices
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setCameraOpen(true)} className="text-[13px]">
                  <Camera className="mr-2 h-3.5 w-3.5 text-[#64748B]" aria-hidden />
                  Capture with camera
                </DropdownMenuItem>
                {!isUAE && (
                  <DropdownMenuItem disabled={seedingGst} onSelect={() => void handleSeedGstDemo()} className="text-[13px]">
                    <Zap className="mr-2 h-3.5 w-3.5 text-[#64748B]" aria-hidden />
                    {seedingGst ? 'Seeding…' : 'Seed GST demo invoices'}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={invoices.length === 0}
                  onSelect={() => setDeleteAllDialogOpen(true)}
                  className="text-[13px] text-[#DC2626] focus:text-[#DC2626]"
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden />
                  Delete all invoices…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {loadError && invoices.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-[12px] text-[#92400E]">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">Latest refresh failed — showing the last loaded data. {loadError}</span>
            <Button size="sm" variant="outline" className="h-7 bg-white" onClick={() => void fetchInvoices({ quiet: true })}>
              Retry
            </Button>
          </div>
        )}

        <ListPipeline stages={listStages} selected={stageFilter} onSelect={selectStage} />

        <ListToolbar
          filters={filters}
          onFiltersChange={setFilters}
          view={viewMode}
          onViewChange={changeView}
          viewCounts={viewCounts}
          stage={stageFilter}
          onStageChange={setStageFilter}
          options={filterOptions}
          costCenterLabel={costCenterLabel}
          statusLabel={statusLabel}
          showAdvanceFilter={filters.advanceOnly || invoices.some((inv) => inv.is_advance_payment === true)}
        />

        {selectedRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#C7D7FE] bg-[#EEF4FF] px-3 py-2 text-[13px]">
            <span className="font-semibold text-[#0B1D33]">
              {selectedRows.length} selected
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 bg-white"
                disabled={bulkProcessing}
                onClick={() => void handleBulkApproveSelected()}
              >
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-[#00A884]" aria-hidden />
                {bulkProcessing ? 'Approving…' : 'Approve selected'}
              </Button>
              <Button size="sm" variant="outline" className="h-8 bg-white" onClick={() => void exportExcel(selectedRows)}>
                <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Export selected
              </Button>
              <Button size="sm" variant="ghost" className="h-8" onClick={() => setSelectedIds([])}>
                Clear selection
              </Button>
            </div>
          </div>
        )}

        <InvoiceTable
          rows={paginatedInvoices}
          total={filteredInvoices.length}
          page={page}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
          sort={sort}
          onSortChange={setSort}
          columns={columns}
          onColumnsChange={setColumns}
          selectedIds={selectedIds}
          onToggleRow={toggleSelectInvoice}
          onTogglePage={toggleSelectAll}
          activeId={selectedInvoice?.id ?? null}
          onOpen={openInvoice}
          currencyOf={(inv) => normalizeCurrencyCode(inv.currency, market)}
          glDisplay={glDisplayFor}
          dateFormat={dateFormat}
          isUAE={isUAE}
          costCenterLabel={costCenterLabel}
          onDownloadPdf={(inv) => void downloadInvoicePdf(inv)}
          onValidatePint={setPintAeInvoice}
          empty={emptyState}
        />
      </div>

      {selectedInvoice && (
        <aside
          aria-label={`Invoice ${selectedInvoice.invoice_number}`}
          className={
            drawerExpanded
              ? 'contents'
              : 'idm-drawer-host fixed inset-0 z-50 flex flex-col overflow-hidden bg-white md:left-auto md:w-[min(560px,92vw)] md:border-l md:border-[#E2E8F0] md:shadow-[-12px_0_32px_rgba(11,29,51,0.12)] min-[1360px]:sticky min-[1360px]:inset-auto min-[1360px]:top-6 min-[1360px]:z-10 min-[1360px]:h-[calc(100vh-84px)] min-[1360px]:w-[clamp(400px,29vw,560px)] min-[1360px]:shrink-0 min-[1360px]:rounded-xl min-[1360px]:border min-[1360px]:shadow-[0_8px_24px_rgba(11,29,51,0.08)]'
          }
        >
          <InvoiceDetailModal
            invoice={selectedInvoice}
            open={!!selectedInvoice}
            variant={drawerExpanded ? 'dialog' : 'drawer'}
            tab={drawerTab}
            onTabChange={setDrawerTab}
            onToggleExpand={() => setDrawerExpanded((v) => !v)}
            onClose={closeInvoice}
            onUpdate={() => void fetchInvoices({ quiet: true })}
            onNavigateInvoice={async (id) => {
              const inv = await fetchInvoiceById(id);
              if (inv) openInvoice(inv);
            }}
          />
        </aside>
      )}

      <PintAeValidateModal
        invoice={pintAeInvoice}
        open={!!pintAeInvoice}
        onOpenChange={(o) => {
          if (!o) setPintAeInvoice(null);
        }}
      />

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
              {deletingAll ? 'Deleting…' : 'Yes, delete all'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
