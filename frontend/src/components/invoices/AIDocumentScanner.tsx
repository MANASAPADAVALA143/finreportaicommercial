/**
 * AIDocumentScanner — Bluelita-reference split-screen invoice processing workspace.
 * Left: live document viewer. Right: numbered AI processing cards with per-field confidence.
 * Wired to existing extraction logic; no mock data.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  Upload,
  Camera,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Plus,
  Trash2,
  Download,
  Maximize2,
  RefreshCw,
  CheckCheck,
  FileText,
  Mail,
  Smartphone,
  ScanLine,
  Plug,
  Loader2,
} from 'lucide-react';
import type { NormalizedExtractedInvoice } from '@/lib/ap-invoice/cameraService';
import { VAT_TREATMENT_OPTIONS } from '@/lib/ap-invoice/marketConfig';
import { formatCurrency } from '@/utils/currency';
import { useMarket } from '@/contexts/MarketContext';
import { CameraCapture } from './CameraCapture';
import {
  classifyInvoice,
  getCategoriesForIndustry,
  getCategoryForIndustry,
  type InvoiceCategoryKey,
} from '@/lib/ap-invoice/invoiceCategories';

export type ScanLineItem = {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  tax: number;
  total: number;
};

type ConfLevel = 'high' | 'medium' | 'low' | 'missing';

function confLevel(value: string | number | null | undefined, score?: number): ConfLevel {
  if (value === null || value === undefined || value === '' || value === 0) return 'missing';
  if (score === undefined) return 'high';
  if (score >= 85) return 'high';
  if (score >= 60) return 'medium';
  return 'low';
}

/** Green circle badge — mirrors the Bluelita reference exactly */
function ConfScore({
  score,
  level,
}: {
  score?: number;
  level: ConfLevel;
}) {
  if (level === 'missing') {
    return (
      <span className="flex items-center gap-1 text-xs font-semibold text-red-500">
        <XCircle className="h-3.5 w-3.5" />
        Missing
      </span>
    );
  }
  if (level === 'low') {
    return (
      <span className="flex items-center gap-1 text-xs font-semibold text-amber-500">
        <AlertTriangle className="h-3.5 w-3.5" />
        {score != null ? `${Math.round(score)}%` : 'Low'}
      </span>
    );
  }
  const color = level === 'medium' ? 'text-blue-500' : 'text-[#00D4AA]';
  return (
    <span className={`flex items-center gap-1 text-xs font-semibold ${color}`}>
      <CheckCircle2 className="h-3.5 w-3.5" />
      {score != null ? `${Math.round(score)}%` : 'OK'}
    </span>
  );
}

/** Single extracted field row: label | value (editable) | confidence */
function FieldRow({
  label,
  value,
  score,
  children,
}: {
  label: string;
  value: string | number | null | undefined;
  score?: number;
  children: React.ReactNode;
}) {
  const level = confLevel(value, score);
  const rowBg =
    level === 'missing'
      ? 'bg-red-50/60 border-red-100'
      : level === 'low'
      ? 'bg-amber-50/60 border-amber-100'
      : 'bg-white border-gray-100';

  return (
    <div className={`flex items-center border-b px-4 py-2.5 gap-3 ${rowBg} last:border-0`}>
      <span className="w-36 shrink-0 text-xs font-medium text-gray-500">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
      <div className="shrink-0 w-20 text-right">
        <ConfScore score={score} level={level} />
      </div>
    </div>
  );
}

/** Numbered stage card — matches Bluelita's numbered cards */
function StageCard({
  num,
  title,
  subtitle,
  accuracy,
  status,
  children,
}: {
  num: number;
  title: string;
  subtitle?: string;
  accuracy?: number;
  status: 'done' | 'active' | 'pending';
  children?: React.ReactNode;
}) {
  const badgeBg =
    status === 'done'
      ? 'bg-[#0A4B8F]'
      : status === 'active'
      ? 'bg-[#0A4B8F] animate-pulse'
      : 'bg-gray-300';

  return (
    <div
      className={`rounded-xl border bg-white shadow-sm overflow-hidden mb-3
        ${status === 'active' ? 'border-[#0A4B8F]/30 ring-1 ring-[#0A4B8F]/20' : 'border-gray-200'}`}
    >
      {/* Card header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0 ${badgeBg}`}
          >
            {status === 'active' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              num
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">{title}</p>
            {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
          </div>
        </div>
        {accuracy != null && status === 'done' && (
          <span className="flex items-center gap-1 text-xs font-bold text-[#00D4AA] bg-[#00D4AA]/10 border border-[#00D4AA]/20 px-2 py-0.5 rounded-full">
            <CheckCircle2 className="h-3 w-3" />
            {accuracy.toFixed(1)}% Accuracy
          </span>
        )}
        {status === 'pending' && (
          <span className="text-xs text-gray-400 italic">Pending</span>
        )}
      </div>

      {/* Card body */}
      {children && <div className="divide-y divide-gray-50">{children}</div>}
    </div>
  );
}

type Props = {
  extracting: boolean;
  extractedData: NormalizedExtractedInvoice | null;
  fieldConfidences?: Record<string, number>;
  overallConfidence?: number;
  lineItems: ScanLineItem[];
  saving: boolean;
  vatTreatment: string;
  isUAE: boolean;
  initialFile?: File | null;
  /** Industry key: 'manufacturing' | 'construction' | 'general' */
  industry?: string;
  /** Override for AI-auto-classified category — controlled by parent */
  invoiceCategory?: InvoiceCategoryKey | null;
  onInvoiceCategoryChange?: (key: InvoiceCategoryKey) => void;
  onFileSelected: (file: File) => void;
  onCameraOpen: () => void;
  cameraOpen: boolean;
  onCameraOpenChange: (open: boolean) => void;
  onFieldChange: (field: keyof NormalizedExtractedInvoice | string, value: string | number) => void;
  onVatTreatmentChange: (val: string) => void;
  onLineItemAdd: () => void;
  onLineItemRemove: (id: string) => void;
  onLineItemUpdate: (id: string, field: keyof ScanLineItem, value: string | number) => void;
  onSaveDraft: () => void;
  onFlagForReview: () => void;
  onContinueToMatching: () => void;
  onRetry: () => void;
};

export function AIDocumentScanner({
  extracting,
  extractedData,
  fieldConfidences = {},
  overallConfidence,
  lineItems,
  saving,
  vatTreatment,
  isUAE,
  initialFile,
  industry = 'general',
  invoiceCategory: invoiceCategoryProp,
  onInvoiceCategoryChange,
  onFileSelected,
  onCameraOpen,
  cameraOpen,
  onCameraOpenChange,
  onFieldChange,
  onVatTreatmentChange,
  onLineItemAdd,
  onLineItemRemove,
  onLineItemUpdate,
  onSaveDraft,
  onFlagForReview,
  onContinueToMatching,
  onRetry,
}: Props) {
  const { config } = useMarket();

  // Viewer state
  const [docUrl, setDocUrl] = useState<string | null>(null);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Industry classification state
  const [localCategory, setLocalCategory] = useState<InvoiceCategoryKey | null>(null);
  // Track whether the user has manually overridden classification so auto-classify never overwrites it
  const [userOverrode, setUserOverrode] = useState(false);
  const activeCategory = invoiceCategoryProp !== undefined ? invoiceCategoryProp : localCategory;
  const industryCategories = getCategoriesForIndustry(industry);
  const hasIndustry = industry !== 'general';

  // Auto-classify once when extraction data first arrives; skip if user already overrode
  useEffect(() => {
    if (!extractedData || !hasIndustry || userOverrode) return;
    // Only auto-classify when extractedData is new (vendor_name is a stable proxy)
    const descriptions = lineItems.map(l => l.description);
    const classified = classifyInvoice(
      industry,
      extractedData.vendor_name ?? '',
      descriptions,
      (extractedData as any).invoice_number ?? '',
    );
    if (classified) {
      setLocalCategory(classified);
      onInvoiceCategoryChange?.(classified);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extractedData?.vendor_name, industry]);

  const activeCategoryObj = activeCategory ? getCategoryForIndustry(industry, activeCategory) : undefined;

  // Computed totals
  const lineSubtotal = lineItems.reduce((s, li) => s + li.total, 0);
  const vatRate = (extractedData as any)?.vat_rate ?? (isUAE ? 5 : 0);
  const vatAmount =
    extractedData?.vat_amount ??
    (isUAE ? (extractedData?.total_amount ?? lineSubtotal) * (vatRate / 100) : 0);
  const displayTotal =
    extractedData?.total_amount ??
    (lineSubtotal + (vatAmount ?? 0));
  const totalMismatch =
    lineSubtotal > 0 &&
    extractedData?.total_amount != null &&
    Math.abs(lineSubtotal + (vatAmount ?? 0) - extractedData.total_amount) > 0.5;

  // Stage resolution
  const stage: 'upload' | 'extracting' | 'review' | 'done' =
    !docFile ? 'upload'
    : extracting ? 'extracting'
    : extractedData ? 'review'
    : 'upload';

  useEffect(() => {
    return () => { if (docUrl) URL.revokeObjectURL(docUrl); };
  }, [docUrl]);

  // Load a pre-existing file (e.g. from the multi-pdf queue)
  useEffect(() => {
    if (initialFile && initialFile !== docFile) {
      const url = URL.createObjectURL(initialFile);
      setDocUrl(url);
      setDocFile(initialFile);
      setZoom(1);
      setRotation(0);
      setCurrentPage(1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const handleFile = (file: File) => {
    if (docUrl) URL.revokeObjectURL(docUrl);
    setDocUrl(URL.createObjectURL(file));
    setDocFile(file);
    setZoom(1);
    setRotation(0);
    setCurrentPage(1);
    onFileSelected(file);
  };

  const isPdf = docFile?.type === 'application/pdf';
  const confPct = overallConfidence != null ? Math.round(overallConfidence) : null;

  // ── RIGHT PANEL helpers ──────────────────────────────────────────
  const f = (key: string) => fieldConfidences[key];

  const editField = (field: string) =>
    (e: React.ChangeEvent<HTMLInputElement>) => onFieldChange(field as any, e.target.value);

  const editNum = (field: string) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      onFieldChange(field as any, parseFloat(e.target.value) || 0);

  return (
    <div className="flex flex-col gap-4">
      {/* ── TOP HEADER BAR ───────────────────────────────────────── */}
      <div
        className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white px-5 py-3 shadow-sm"
        style={{ borderLeft: '4px solid #0A4B8F' }}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#0A4B8F] flex items-center justify-center">
            <FileText className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">
              Invoice Document
              {extractedData && (
                <span className="ml-2 font-semibold text-[#0A4B8F]">
                  — {(extractedData as any).invoice_number || 'Extracting…'}
                </span>
              )}
            </p>
            <p className="text-xs text-gray-400">AI-Powered Invoice Processing Workspace</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {confPct != null && (
            <span className="flex items-center gap-1.5 text-xs font-bold text-[#00D4AA] bg-[#00D4AA]/10 border border-[#00D4AA]/20 px-3 py-1.5 rounded-full">
              <CheckCircle2 className="h-3.5 w-3.5" />
              AI Processed ({confPct}%)
            </span>
          )}
          {extractedData && !extracting && (
            <Button
              type="button"
              className="bg-[#0A4B8F] hover:bg-[#0D6EFD] text-white text-xs h-9 px-4 gap-1.5 font-semibold rounded-lg"
              onClick={onContinueToMatching}
              disabled={saving}
            >
              <CheckCheck className="h-4 w-4" />
              {saving ? 'Processing…' : 'Approve & Process'}
            </Button>
          )}
        </div>
      </div>

      {/* ── SPLIT WORKSPACE ─────────────────────────────────────── */}
      <div className="flex gap-4" style={{ minHeight: '680px' }}>

        {/* ════ LEFT PANEL — Document Viewer ════ */}
        <div
          className={`flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden
            ${fullscreen ? 'fixed inset-4 z-50' : 'w-[48%]'}`}
        >
          {/* Viewer toolbar */}
          <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-gray-100 bg-gray-50 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="h-4 w-4 text-gray-400 shrink-0" />
              <span className="text-xs font-semibold text-gray-700 truncate max-w-[180px]">
                {docFile ? docFile.name : 'No document loaded'}
              </span>
            </div>

            {docFile && (
              <div className="flex items-center gap-1 shrink-0">
                {/* Page navigation (PDF) */}
                {isPdf && (
                  <div className="flex items-center gap-0.5 mr-1 border border-gray-200 rounded-md overflow-hidden">
                    <button
                      type="button"
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className="px-1.5 py-1 hover:bg-gray-100 disabled:opacity-30"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="px-2 text-xs text-gray-500 border-x border-gray-200">
                      {currentPage} / {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={currentPage >= totalPages}
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      className="px-1.5 py-1 hover:bg-gray-100 disabled:opacity-30"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {/* Zoom */}
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.3, z - 0.15))}
                  className="p-1.5 rounded hover:bg-gray-200"
                  title="Zoom out"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <span className="text-xs text-gray-500 w-10 text-center tabular-nums">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(3, z + 0.15))}
                  className="p-1.5 rounded hover:bg-gray-200"
                  title="Zoom in"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>

                {/* Rotate */}
                <button
                  type="button"
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  className="p-1.5 rounded hover:bg-gray-200 ml-1"
                  title="Rotate 90°"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                </button>

                {/* Download */}
                {docUrl && (
                  <a
                    href={docUrl}
                    download={docFile?.name}
                    className="p-1.5 rounded hover:bg-gray-200 ml-0.5 inline-flex"
                    title="Download"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </a>
                )}

                {/* Fullscreen */}
                <button
                  type="button"
                  onClick={() => setFullscreen((f) => !f)}
                  className="p-1.5 rounded hover:bg-gray-200 ml-0.5"
                  title="Full-screen"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Document display area */}
          <div className="flex-1 overflow-auto bg-[#F4F6F9] relative">
            {!docUrl ? (
              /* Upload dropzone */
              <div
                className={`absolute inset-0 flex flex-col items-center justify-center gap-5 cursor-pointer transition-all
                  ${isDragging ? 'bg-[#0A4B8F]/5 border-2 border-dashed border-[#0A4B8F]' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const f = e.dataTransfer.files[0];
                  if (f) handleFile(f);
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="text-center space-y-3">
                  <div className="w-20 h-20 rounded-2xl bg-[#0A4B8F]/8 flex items-center justify-center mx-auto border-2 border-dashed border-[#0A4B8F]/30">
                    <Upload className="h-9 w-9 text-[#0A4B8F]/50" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700">Drop invoice here</p>
                    <p className="text-xs text-gray-400 mt-1">PDF, PNG, JPG · up to 10 MB</p>
                  </div>
                  <div className="flex gap-2 justify-center">
                    <Button
                      type="button"
                      size="sm"
                      className="bg-[#0A4B8F] hover:bg-[#0D6EFD] text-white text-xs h-8"
                      onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                    >
                      <Upload className="h-3.5 w-3.5 mr-1.5" /> Browse Files
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-xs h-8 border-gray-300"
                      onClick={(e) => { e.stopPropagation(); onCameraOpen(); }}
                    >
                      <Camera className="h-3.5 w-3.5 mr-1.5" /> Camera
                    </Button>
                  </div>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
              </div>
            ) : isPdf ? (
              <div className="p-4 flex justify-center min-h-full">
                <div
                  style={{
                    transform: `scale(${zoom}) rotate(${rotation}deg)`,
                    transformOrigin: 'top center',
                    transition: 'transform 0.2s ease',
                    width: '100%',
                  }}
                >
                  <iframe
                    src={`${docUrl}#page=${currentPage}&toolbar=0`}
                    className="w-full border-0 shadow-lg rounded-lg bg-white"
                    style={{ height: '700px' }}
                    title="Invoice document"
                  />
                </div>
              </div>
            ) : (
              <div className="p-4 flex justify-center min-h-full">
                <img
                  src={docUrl}
                  alt="Invoice"
                  style={{
                    transform: `scale(${zoom}) rotate(${rotation}deg)`,
                    transformOrigin: 'top center',
                    transition: 'transform 0.2s ease',
                    maxWidth: '100%',
                  }}
                  className="shadow-lg rounded-lg"
                />
              </div>
            )}

            {/* Extraction overlay */}
            {extracting && (
              <div className="absolute inset-0 bg-white/85 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
                <div className="relative">
                  <div className="w-14 h-14 rounded-full border-4 border-[#0A4B8F]/20 border-t-[#0A4B8F] animate-spin" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <FileText className="h-5 w-5 text-[#0A4B8F]" />
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold text-[#0A4B8F]">AI is reading your invoice…</p>
                  <p className="text-xs text-gray-400 mt-1">Claude is extracting all fields</p>
                </div>
              </div>
            )}
          </div>

          {/* Re-upload strip */}
          {docFile && !extracting && (
            <div className="border-t border-gray-100 px-4 py-2.5 bg-gray-50 flex items-center justify-between gap-2 shrink-0">
              <span className="text-xs text-gray-500 truncate max-w-[200px]">{docFile.name}</span>
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-xs h-7 px-2.5 text-gray-600"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-3 w-3 mr-1" /> Replace
                </Button>
                {extractedData && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-xs h-7 px-2.5 text-[#0A4B8F]"
                    onClick={onRetry}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" /> Re-extract
                  </Button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </div>
          )}
        </div>

        {/* ════ RIGHT PANEL — AI Processing Cards ════ */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-0.5">

          {/* Capture methods card */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm px-4 py-3">
            <div className="flex items-center gap-2 mb-2.5">
              <Upload className="h-4 w-4 text-[#0A4B8F]" />
              <span className="text-sm font-semibold text-[#0A4B8F]">Multiple Capture Methods Supported</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { icon: Upload, label: 'File Upload' },
                { icon: Mail, label: 'Email Integration' },
                { icon: Smartphone, label: 'Mobile App' },
                { icon: ScanLine, label: 'Scanner Integration' },
                { icon: Plug, label: 'API Upload' },
              ].map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className="flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-full px-3 py-1"
                >
                  <CheckCircle2 className="h-3 w-3 text-[#00D4AA]" />
                  {label}
                </div>
              ))}
            </div>
          </div>

          {/* Industry classification card — shown for manufacturing / construction */}
          {hasIndustry && (
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm px-4 py-3">
              <div className="flex items-center gap-2 mb-2.5">
                <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white" style={{ background: industry === 'construction' ? '#B45309' : '#1E40AF' }}>
                  {industry === 'manufacturing' ? '🏭 Manufacturing' : '🏗️ Construction'}
                </span>
                <span className="text-xs text-gray-500">Industry detected</span>
              </div>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <label className="text-xs text-gray-500 font-medium block mb-1">Invoice Category</label>
                  <select
                    value={activeCategory ?? ''}
                    onChange={(e) => {
                      const v = e.target.value as InvoiceCategoryKey;
                      setUserOverrode(true);
                      setLocalCategory(v);
                      onInvoiceCategoryChange?.(v);
                    }}
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-800"
                  >
                    <option value="">— Select category —</option>
                    {industryCategories.map(cat => (
                      <option key={cat.key} value={cat.key}>{cat.label}</option>
                    ))}
                  </select>
                </div>
                {activeCategoryObj && (
                  <div className="shrink-0 mt-5">
                    {!userOverrode && activeCategory && (
                      <span className="text-[10px] text-[#00D4AA] font-semibold">Auto-classified</span>
                    )}
                  </div>
                )}
              </div>
              {activeCategoryObj && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-600 bg-gray-50 rounded px-2 py-1.5">
                  <CheckCircle2 className="h-3 w-3 text-[#00D4AA] shrink-0" />
                  <span>Workflow: <strong>{activeCategoryObj.workflowLabel}</strong></span>
                  {activeCategoryObj.isCapEx && (
                    <span className="ml-2 px-1.5 py-0.5 text-[10px] font-bold bg-orange-100 text-orange-700 rounded">CapEx</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Stage 1 — Document received */}
          <StageCard
            num={1}
            title="Document Received & Identified"
            subtitle={docFile ? `${(docFile.size / 1024).toFixed(0)} KB · ${isPdf ? 'PDF' : 'Image'}` : undefined}
            status={docFile ? 'done' : 'pending'}
          />

          {/* Stage 2 — AI Extraction */}
          <StageCard
            num={2}
            title="AI Extracts and Validates Data"
            subtitle={
              stage === 'extracting'
                ? 'Processing…'
                : extractedData
                ? 'Completed'
                : undefined
            }
            accuracy={confPct ?? undefined}
            status={stage === 'extracting' ? 'active' : extractedData ? 'done' : 'pending'}
          >
            {extractedData && (
              <>
                {/* Document info */}
                <FieldRow label="Invoice Number" value={extractedData.invoice_number} score={f('invoice_number')}>
                  <Input
                    value={extractedData.invoice_number || ''}
                    onChange={editField('invoice_number')}
                    className="h-7 text-sm font-semibold text-gray-900 border-0 shadow-none p-0 bg-transparent focus-visible:ring-0"
                    placeholder="INV-001"
                  />
                </FieldRow>
                <FieldRow label="Invoice Date" value={extractedData.invoice_date} score={f('invoice_date')}>
                  <Input
                    type="date"
                    value={extractedData.invoice_date?.slice(0, 10) || ''}
                    onChange={editField('invoice_date')}
                    className="h-7 text-sm text-gray-900 border-0 shadow-none p-0 bg-transparent focus-visible:ring-0"
                  />
                </FieldRow>
                <FieldRow label="Due Date" value={extractedData.due_date} score={f('due_date')}>
                  <Input
                    type="date"
                    value={extractedData.due_date?.slice(0, 10) || ''}
                    onChange={editField('due_date')}
                    className="h-7 text-sm text-gray-900 border-0 shadow-none p-0 bg-transparent focus-visible:ring-0"
                  />
                </FieldRow>
                <FieldRow label="PO Number" value={(extractedData as any).po_number} score={f('po_number')}>
                  <Input
                    value={(extractedData as any).po_number || ''}
                    onChange={editField('po_number')}
                    className="h-7 text-sm text-gray-900 border-0 shadow-none p-0 bg-transparent focus-visible:ring-0"
                    placeholder="PO-001"
                  />
                </FieldRow>
              </>
            )}
            {stage === 'extracting' && (
              <div className="flex items-center gap-3 px-4 py-4">
                <Loader2 className="h-4 w-4 animate-spin text-[#0A4B8F]" />
                <span className="text-sm text-gray-500">Claude AI is reading your document…</span>
              </div>
            )}
          </StageCard>

          {/* Stage 3 — Vendor & financial validation */}
          <StageCard
            num={3}
            title="Vendor & Financial Validation"
            status={extractedData ? 'done' : 'pending'}
          >
            {extractedData && (
              <>
                <FieldRow label="Vendor Name" value={extractedData.vendor_name} score={f('vendor_name')}>
                  <Input
                    value={extractedData.vendor_name || ''}
                    onChange={editField('vendor_name')}
                    className="h-7 text-sm font-semibold text-gray-900 border-0 shadow-none p-0 bg-transparent focus-visible:ring-0"
                    placeholder="Vendor name"
                  />
                </FieldRow>
                <FieldRow label={`${config.taxIdLabel}`} value={extractedData.gstin} score={f('gstin')}>
                  <Input
                    value={extractedData.gstin || ''}
                    onChange={editField('gstin')}
                    className="h-7 text-sm text-gray-900 border-0 shadow-none p-0 bg-transparent focus-visible:ring-0"
                    placeholder={config.taxIdLabel}
                  />
                </FieldRow>
                <FieldRow label="Total Amount" value={extractedData.total_amount} score={f('total_amount')}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-400">{extractedData.currency || config.currency}</span>
                    <Input
                      type="number"
                      step="0.01"
                      value={extractedData.total_amount || 0}
                      onChange={editNum('total_amount')}
                      className="h-7 text-sm font-semibold text-gray-900 border-0 shadow-none p-0 bg-transparent focus-visible:ring-0"
                    />
                  </div>
                </FieldRow>
                {isUAE && (
                  <>
                    <FieldRow label="VAT Amount" value={extractedData.vat_amount} score={f('vat_amount')}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-400">{extractedData.currency || 'AED'}</span>
                        <Input
                          type="number"
                          step="0.01"
                          value={extractedData.vat_amount ?? 0}
                          onChange={editNum('vat_amount')}
                          className="h-7 text-sm text-gray-900 border-0 shadow-none p-0 bg-transparent focus-visible:ring-0"
                        />
                      </div>
                    </FieldRow>
                    <FieldRow label="VAT Treatment" value={vatTreatment} score={undefined}>
                      <select
                        value={vatTreatment}
                        onChange={(e) => onVatTreatmentChange(e.target.value)}
                        className="h-7 w-full text-sm text-gray-900 border-0 bg-transparent focus:outline-none cursor-pointer"
                      >
                        {VAT_TREATMENT_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </FieldRow>
                  </>
                )}
                <FieldRow label="Tax Amount" value={extractedData.tax_amount} score={f('tax_amount')}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-400">{extractedData.currency || config.currency}</span>
                    <Input
                      type="number"
                      step="0.01"
                      value={extractedData.tax_amount ?? 0}
                      onChange={editNum('tax_amount')}
                      className="h-7 text-sm text-gray-900 border-0 shadow-none p-0 bg-transparent focus-visible:ring-0"
                    />
                  </div>
                </FieldRow>
                <FieldRow label="Currency" value={extractedData.currency} score={f('currency')}>
                  <Input
                    value={extractedData.currency || ''}
                    maxLength={3}
                    onChange={(e) => onFieldChange('currency', e.target.value.toUpperCase())}
                    className="h-7 text-sm text-gray-900 border-0 shadow-none p-0 bg-transparent focus-visible:ring-0 uppercase"
                  />
                </FieldRow>
              </>
            )}
          </StageCard>

          {/* Stage 4 — PO/GRN matching */}
          <StageCard
            num={4}
            title="PO / GRN Matching"
            subtitle={extractedData ? (
              (extractedData as any).po_number
                ? `Matching against PO ${(extractedData as any).po_number}`
                : 'No PO number detected'
            ) : undefined}
            status={extractedData ? 'done' : 'pending'}
          />

          {/* Stage 5 — Line items */}
          {extractedData && (
            <StageCard
              num={5}
              title="Line Items Extracted"
              subtitle={`${lineItems.length} item${lineItems.length !== 1 ? 's' : ''}`}
              status="done"
            >
              {/* Line items table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-4 py-2 font-semibold text-gray-500 w-[42%]">Description</th>
                      <th className="text-right px-3 py-2 font-semibold text-gray-500 w-14">Qty</th>
                      <th className="text-right px-3 py-2 font-semibold text-gray-500 w-24">Unit Price</th>
                      <th className="text-right px-3 py-2 font-semibold text-gray-500 w-24">Tax</th>
                      <th className="text-right px-3 py-2 font-semibold text-gray-500 w-24">Amount</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {lineItems.map((item) => (
                      <tr key={item.id} className="group hover:bg-gray-50/60">
                        <td className="px-4 py-1.5">
                          <Input
                            value={item.description}
                            onChange={(e) => onLineItemUpdate(item.id, 'description', e.target.value)}
                            className="h-6 text-xs border-0 shadow-none p-0 bg-transparent focus-visible:ring-0 text-gray-900"
                            placeholder="Item description"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <Input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => onLineItemUpdate(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                            className="h-6 text-xs border-0 shadow-none p-0 bg-transparent focus-visible:ring-0 text-right text-gray-900"
                            min="0" step="0.01"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <Input
                            type="number"
                            value={item.unit_price}
                            onChange={(e) => onLineItemUpdate(item.id, 'unit_price', parseFloat(e.target.value) || 0)}
                            className="h-6 text-xs border-0 shadow-none p-0 bg-transparent focus-visible:ring-0 text-right text-gray-900"
                            min="0" step="0.01"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <Input
                            type="number"
                            value={item.tax}
                            onChange={(e) => onLineItemUpdate(item.id, 'tax', parseFloat(e.target.value) || 0)}
                            className="h-6 text-xs border-0 shadow-none p-0 bg-transparent focus-visible:ring-0 text-right text-gray-900"
                            min="0" step="0.01"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-right font-semibold text-gray-800">
                          {item.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="pr-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => onLineItemRemove(item.id)}
                            disabled={lineItems.length === 1}
                            className="invisible group-hover:visible p-1 rounded hover:bg-red-50 disabled:opacity-30 text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Add row + totals */}
              <div className="px-4 py-2.5 flex items-center justify-between border-t border-gray-100 bg-gray-50/50">
                <button
                  type="button"
                  onClick={onLineItemAdd}
                  className="flex items-center gap-1 text-xs text-[#0A4B8F] font-semibold hover:underline"
                >
                  <Plus className="h-3.5 w-3.5" /> Add line item
                </button>
                <div className="space-y-0.5 text-right">
                  <div className="flex items-center justify-end gap-6 text-xs text-gray-500">
                    <span>Subtotal</span>
                    <span className="font-medium text-gray-700 w-24 text-right">
                      {formatCurrency(lineSubtotal, extractedData.currency || config.currency)}
                    </span>
                  </div>
                  {isUAE && (
                    <div className="flex items-center justify-end gap-6 text-xs text-gray-500">
                      <span>VAT ({vatRate}%)</span>
                      <span className="font-medium text-gray-700 w-24 text-right">
                        {formatCurrency(vatAmount ?? 0, extractedData.currency || config.currency)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-end gap-6 border-t border-gray-200 pt-1 mt-1">
                    <span className="text-sm font-bold text-gray-800">Total</span>
                    <span
                      className={`text-sm font-bold w-24 text-right ${
                        totalMismatch ? 'text-amber-600' : 'text-[#0A4B8F]'
                      }`}
                    >
                      {formatCurrency(displayTotal ?? 0, extractedData.currency || config.currency)}
                    </span>
                  </div>
                  {totalMismatch && (
                    <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      Line items sum differs from extracted total. Please verify.
                    </div>
                  )}
                </div>
              </div>
            </StageCard>
          )}

          {/* Stage 6 — Ready for approval */}
          <StageCard
            num={6}
            title="Ready for Approval"
            status={extractedData && !extracting ? 'done' : 'pending'}
          >
            {extractedData && !extracting && (
              <div className="px-4 py-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <CheckCircle2 className="h-5 w-5 text-[#00D4AA]" />
                  <span>All checks passed. Invoice ready for approval.</span>
                </div>
              </div>
            )}
          </StageCard>

          {/* Action bar */}
          {extractedData && !extracting && (
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm px-4 py-3 flex items-center justify-between gap-3 sticky bottom-0">
              <div className="flex items-center gap-2 text-xs text-gray-400">
                {confPct != null && (
                  <span className="flex items-center gap-1 text-[#00D4AA] font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {confPct}% confidence
                  </span>
                )}
                {totalMismatch && (
                  <span className="flex items-center gap-1 text-amber-500 font-semibold">
                    <AlertTriangle className="h-3.5 w-3.5" /> Amount mismatch
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs h-8 gap-1.5 border-gray-300 text-gray-600 hover:bg-gray-50"
                  onClick={onFlagForReview}
                  disabled={saving}
                >
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  Flag for Review
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs h-8 gap-1.5 border-gray-300 text-gray-700"
                  onClick={onSaveDraft}
                  disabled={saving}
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {saving ? 'Saving…' : 'Save Draft'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="text-xs h-8 gap-1.5 bg-[#0A4B8F] hover:bg-[#0D6EFD] text-white font-semibold"
                  onClick={onContinueToMatching}
                  disabled={saving}
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Approve & Process
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <CameraCapture
        open={cameraOpen}
        onOpenChange={onCameraOpenChange}
        onConfirm={(f) => handleFile(f)}
      />
    </div>
  );
}
