import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/ap-invoice/supabase';
import { useMarket } from '../../contexts/MarketContext';
import { validateTaxId, VAT_TREATMENT_OPTIONS } from '../../lib/ap-invoice/marketConfig';
import { detectAnomalies } from '../../utils/anomalyDetection';
import { getRequiredApprovalLevel } from '../../utils/approvalWorkflow';
import { formatCurrency } from '../../utils/currency';
import { toStorageFormat } from '../../utils/dateUtils';
import { calculateTax, TAX_TYPES } from '../../utils/taxConfig';
import { CurrencyCombobox } from '../../components/ap-invoice/CurrencyCombobox';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import { resolveGLAccount, invoiceGlFieldsFromResult } from '../../utils/coaMapping';
import { runAutoMatch, autoMatchToastMessage } from '../../lib/ap-invoice/threeWayMatchService';
import { checkInvoiceLimit, requireCompanyId, getMyCompany, clearCompanyCache } from '../../lib/ap-invoice/companyService';
import { invoiceFlowAgentUrl } from '../../lib/ap-invoice/apiBase';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Textarea } from '../../components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { Upload, X, Plus, Trash2, FileText, CheckCircle, Download, FileSpreadsheet, Camera } from 'lucide-react';
import { CameraCapture } from '@/components/invoices/CameraCapture';
import { InvoiceExtractionPreviewModal, type PreviewLineItem } from '@/components/invoices/InvoiceExtractionPreviewModal';
import { uploadInvoiceFile } from '../../lib/ap-invoice/invoiceStorageService';
import { normalizeExtractedInvoice, type NormalizedExtractedInvoice } from '../../lib/ap-invoice/cameraService';
import { useToast } from '../../hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import * as XLSX from 'xlsx';
import type { Invoice } from '../../lib/ap-invoice/supabase';
import { logAction, getInvoiceflowWorkEmail } from '../../lib/ap-invoice/auditService';
import {
  buildOcrColumnsFromWebhook,
  computeFieldCompletenessScore,
  getEffectiveExtractionScore,
} from '../../utils/extractionConfidence';

type LineItem = {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
};

function descriptionFromBatchRow(invoiceData: Record<string, unknown>): string {
  const d = invoiceData.description;
  if (typeof d === 'string' && d.trim()) return d.trim();
  const li = invoiceData.line_items;
  if (Array.isArray(li)) {
    return li
      .map((x: { description?: string }) => x.description)
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

function mapTaxCodeToLegacyType(
  code: string
): 'None' | 'VAT' | 'GST' | 'Sales Tax' | 'Withholding Tax' {
  if (!code || code === 'NONE') return 'None';
  if (code.startsWith('GST')) return 'GST';
  if (code.startsWith('VAT')) return 'VAT';
  if (code === 'SALES_TAX') return 'Sales Tax';
  if (code === 'WITHHOLDING') return 'Withholding Tax';
  return 'None';
}

export function InvoiceUpload() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { baseCurrency } = useCompanySettings();
  const { isUAE, config } = useMarket();
  const [vatTreatment, setVatTreatment] = useState('standard');
  const [reverseCharge, setReverseCharge] = useState(false);
  const [designatedZone, setDesignatedZone] = useState(false);
  const [vendorTrn, setVendorTrn] = useState('');
  const [noCompany, setNoCompany] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [apiEndpoint, setApiEndpoint] = useState<string | null>(null);
  const [apiEndpointClassifyJson, setApiEndpointClassifyJson] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    invoice_number: '',
    invoice_date: '',
    due_date: '',
    vendor_name: '',
    vendor_email: '',
    vendor_phone: '',
    vendor_address: '',
    total_amount: '',
    currency: 'USD',
    taxCode: 'NONE',
    tax_type: 'None' as 'None' | 'VAT' | 'GST' | 'Sales Tax' | 'Withholding Tax',
    tax_rate: '',
    po_number: '',
  });

  const [lineItems, setLineItems] = useState<LineItem[]>([
    { id: '1', description: '', quantity: 1, unit_price: 0, total: 0 },
  ]);

  // IFRS Classification data from n8n extraction
  const [ifrsData, setIfrsData] = useState<{
    ifrs_category: string | null;
    ifrs_confidence: number | null;
    ifrs_explanation: string | null;
  }>({
    ifrs_category: null,
    ifrs_confidence: null,
    ifrs_explanation: null,
  });

  // Amounts extracted from n8n (subtotal, tax) for use on submit
  const [n8nExtractedAmounts, setN8nExtractedAmounts] = useState<{
    subtotal_amount?: number;
    tax_amount?: number;
  }>({});

  // Full n8n webhook response (IFRS + risk) for submit pipeline
  const [extractedData, setExtractedData] = useState<{
    invoice_number?: string;
    vendor_name?: string;
    total_amount?: number;
    tax_amount?: number;
    ifrs_category?: string | null;
    ifrs_confidence?: number | null;
    ocr_confidence?: number | null;
    ocr_confidence_fields?: Record<string, number>;
    ifrs_explanation?: string | null;
    gl_account?: string | null;
    gl_account_name?: string | null;
    risk_score?: number | string | null;
    risk_flags?: unknown[] | string | null;
    risk_level?: string | null;
    risk_flag_count?: number | null;
    invoice_language?: string | null;
  } | null>(null);

  // Scan preview modal state (shows after AI extraction so user can review before saving)
  const [scanPreviewOpen, setScanPreviewOpen] = useState(false);
  const [scanPreviewData, setScanPreviewData] = useState<NormalizedExtractedInvoice | null>(null);
  const [scanPreviewConfidence, setScanPreviewConfidence] = useState<number | undefined>();
  const [scanPreviewLineItems, setScanPreviewLineItems] = useState<PreviewLineItem[]>([]);
  const [scanPreviewFile, setScanPreviewFile] = useState<File | null>(null);
  const [savingFromScan, setSavingFromScan] = useState(false);

  // Bulk upload state
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkData, setBulkData] = useState<any[]>([]);
  const [bulkErrors, setBulkErrors] = useState<Record<number, string[]>>({});
  const [bulkPreviewRows, setBulkPreviewRows] = useState<Array<{ rowNum: number; data: any; errors: string[] }>>([]);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkResults, setBulkResults] = useState<{
    success: number;
    failed: number;
    errors: Array<{ row: number; invoice_number: string; error: string }>;
  } | null>(null);
  const classificationNonJsonToastShown = useRef(false);

  // Multiple PDFs queue state
  type QueueItemStatus = 'pending' | 'extracting' | 'ready' | 'failed';
  type QueueItem = {
    id: string;
    file: File;
    status: QueueItemStatus;
    extractedData: any | null;
    error: string | null;
  };
  const [pdfQueue, setPdfQueue] = useState<QueueItem[]>([]);
  const [processingQueue, setProcessingQueue] = useState(false);
  const [multiPdfResults, setMultiPdfResults] = useState<{
    success: number;
    failed: number;
    errors: Array<{ fileName: string; error: string }>;
  } | null>(null);

  // Ref to pass extracted data to submit (avoids React state timing issues)
  const extractedFormDataRef = useRef<{
    invoice_number: string;
    invoice_date: string;
    due_date: string;
    vendor_name: string;
    [key: string]: unknown;
  } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const resolveWebhookUrlForBrowser = (rawUrl: string): string => {
    if (!rawUrl) return rawUrl;
    if (typeof window === 'undefined') return rawUrl;
    const isLocalDev =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!isLocalDev) return rawUrl;
    try {
      const parsed = new URL(rawUrl);
      if (
        parsed.hostname.endsWith('.app.n8n.cloud') &&
        (parsed.pathname.startsWith('/webhook') || parsed.pathname.startsWith('/webhook-test'))
      ) {
        const proxiedPath = parsed.pathname.replace(/^\/webhook(?:-test)?/, '');
        return `/n8n-webhook${proxiedPath}${parsed.search}`;
      }
    } catch {
      // Keep original URL if parsing fails.
    }
    return rawUrl;
  };

  // Load the n8n (or other) API endpoint configured in Settings
  useEffect(() => {
    const loadApiEndpoint = async () => {
      try {
        const { data, error } = await supabase
          .from('app_settings')
          .select('setting_key, setting_value')
          .in('setting_key', ['api_endpoint', 'api_endpoint_classify_json']);

        if (error) {
          console.error('Error loading API endpoint:', error);
          return;
        }

        const apiRow = data?.find((r) => r.setting_key === 'api_endpoint');
        const classifyRow = data?.find((r) => r.setting_key === 'api_endpoint_classify_json');
        const envWebhook = import.meta.env.VITE_N8N_WEBHOOK_URL?.trim();
        if (apiRow?.setting_value) {
          console.log('âœ… API endpoint loaded from app_settings:', apiRow.setting_value);
          setApiEndpoint(apiRow.setting_value);
        } else if (envWebhook) {
          console.log('âœ… API endpoint from VITE_N8N_WEBHOOK_URL (app_settings empty):', envWebhook);
          setApiEndpoint(envWebhook);
        } else {
          console.warn(
            'âš ï¸ No extraction webhook: set app_settings.api_endpoint in Settings, or add VITE_N8N_WEBHOOK_URL to .env'
          );
        }
        if (classifyRow?.setting_value) {
          setApiEndpointClassifyJson(classifyRow.setting_value);
        } else {
          setApiEndpointClassifyJson(null);
        }
      } catch (error) {
        console.error('Error loading API endpoint from settings:', error);
      }
    };

    void loadApiEndpoint();

    // Check company exists â€” clear cache first to get a fresh result
    clearCompanyCache();
    void getMyCompany().then((c) => setNoCompany(!c?.id));

    // Reload when page becomes visible (in case settings were updated in another tab)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void loadApiEndpoint();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  /** Maps n8n webhook response to extractedData and auto-fills form. Reads flat structure from n8n. */
  function handleWebhookResponse(data: Record<string, unknown>) {
    const toNum = (v: unknown): number => {
      if (v == null || v === '') return 0;
      const s = String(v).replace(/[^\d.-]/g, '');
      const n = parseFloat(s);
      return Number.isNaN(n) ? 0 : n;
    };
    const totalAmount = toNum(data.total_amount ?? data.totalAmount ?? data.total);
    const taxAmount = toNum(data.tax_amount ?? data.taxAmount ?? data.tax);
    const subtotalAmount = toNum(data.subtotal_amount ?? data.subtotalAmount ?? data.subtotal);

    const raw = (data as Record<string, unknown>) ?? {};
    const nested = (raw.ifrs ?? raw.risk ?? raw) as Record<string, unknown>;
    const ifrsCategory = (data.ifrs_category ?? nested.ifrs_category ?? nested.ifrsCategory ?? raw.ifrs_category ?? raw.category ?? null) as string | null;
    const ifrsConf = (data.ifrs_confidence ?? nested.ifrs_confidence ?? nested.confidence ?? raw.ifrs_confidence ?? raw.confidence) as number | null | undefined;
    const ifrsExpl = (data.ifrs_explanation ?? nested.ifrs_explanation ?? nested.explanation ?? raw.ifrs_explanation ?? raw.explanation ?? null) as string | null;
    const glAccount = (data.gl_account ?? nested.gl_account ?? nested.glAccount ?? raw.gl_account ?? null) as string | null;
    const glAccountName = (data.gl_account_name ?? nested.gl_account_name ?? nested.glAccountName ?? raw.gl_account_name ?? null) as string | null;
    const riskLevel = (data.risk_level ?? nested.risk_level ?? nested.riskLevel ?? raw.risk_level ?? 'Low') as string;
    const riskScore = (data.risk_score ??
      nested.risk_score ??
      nested.riskScore ??
      raw.risk_score ??
      null) as number | string | null;
    const riskFlagsRaw = data.risk_flags ?? nested.risk_flags ?? nested.riskFlags ?? raw.risk_flags;
    const riskFlags = Array.isArray(riskFlagsRaw) ? riskFlagsRaw : (typeof riskFlagsRaw === 'string' ? riskFlagsRaw : []);

    const ocrFromWebhook = buildOcrColumnsFromWebhook(
      data as Record<string, unknown>,
      ifrsConf != null ? Number(ifrsConf) : null
    );

    console.log('N8N FULL RESPONSE:', data);
    const invoiceLang =
      (data.invoice_language as string) ??
      (data.invoiceLanguage as string) ??
      (nested.invoice_language as string) ??
      null;
    setExtractedData({
      invoice_number: (data.invoice_number as string) ?? undefined,
      vendor_name: (data.vendor_name as string) ?? undefined,
      total_amount: totalAmount > 0 ? totalAmount : undefined,
      tax_amount: taxAmount > 0 ? taxAmount : undefined,
      ifrs_category: ifrsCategory,
      ifrs_confidence: ifrsConf != null ? Number(ifrsConf) : 0,
      ocr_confidence: ocrFromWebhook.ocr_confidence,
      ocr_confidence_fields: ocrFromWebhook.ocr_confidence_fields,
      ifrs_explanation: ifrsExpl,
      gl_account: glAccount,
      gl_account_name: glAccountName,
      risk_score: riskScore,
      risk_flags: riskFlags,
      risk_level: riskLevel,
      invoice_language: invoiceLang,
    });
    const invRaw = (data.invoice_date as string) ?? '';
    const dueRaw = (data.due_date as string) ?? '';
    const invDate = invRaw ? toStorageFormat(invRaw) : '';
    const dueDate = dueRaw ? toStorageFormat(dueRaw) : '';

    const taxTypeStr = data.tax_type ? String(data.tax_type) : '';
    let inferredTaxCode = 'NONE';
    if (data.tax_code) inferredTaxCode = String(data.tax_code);
    else if (/GST|IGST/i.test(taxTypeStr)) inferredTaxCode = 'GST_IGST';
    else if (/CGST|SGST/i.test(taxTypeStr)) inferredTaxCode = 'GST_CGST_SGST';
    else if (/VAT/i.test(taxTypeStr)) inferredTaxCode = 'VAT_20';
    else if (/Sales/i.test(taxTypeStr)) inferredTaxCode = 'SALES_TAX';
    else if (/Withhold|TDS/i.test(taxTypeStr)) inferredTaxCode = 'WITHHOLDING';

    const tMeta = TAX_TYPES.find((x) => x.code === inferredTaxCode);
    const defaultRate =
      inferredTaxCode === 'GST_CGST_SGST'
        ? '18'
        : tMeta?.components?.length
          ? String(tMeta.components.reduce((s, c) => s + c.rate, 0))
          : '';

    const nextFormData = {
      invoice_number: (data.invoice_number as string) ?? '',
      vendor_name: (data.vendor_name as string) ?? '',
      total_amount: totalAmount > 0 ? String(totalAmount) : '',
      invoice_date: invDate,
      due_date: dueDate,
      vendor_email: (data.vendor_email as string) ?? '',
      vendor_phone: (data.vendor_phone as string) ?? '',
      vendor_address: (data.vendor_address as string) ?? '',
      currency: (data.currency as string) ?? 'USD',
      po_number: (data.po_number as string) ?? (data.po_Number as string) ?? '',
      taxCode: inferredTaxCode,
      tax_type: data.tax_type ? (String(data.tax_type) as 'None' | 'VAT' | 'GST' | 'Sales Tax' | 'Withholding Tax') : ('None' as const),
      tax_rate:
        subtotalAmount > 0 && taxAmount > 0
          ? String((taxAmount / subtotalAmount) * 100)
          : defaultRate || '',
    };
    extractedFormDataRef.current = { ...nextFormData } as typeof extractedFormDataRef.current;
    setFormData((prev) => ({ ...prev, ...nextFormData }));
    setIfrsData({
      ifrs_category: ifrsCategory,
      ifrs_confidence: ifrsConf != null ? Number(ifrsConf) : null,
      ifrs_explanation: ifrsExpl,
    });
    if (subtotalAmount > 0 || taxAmount > 0) {
      setN8nExtractedAmounts({
        subtotal_amount: subtotalAmount > 0 ? subtotalAmount : undefined,
        tax_amount: taxAmount > 0 ? taxAmount : undefined,
      });
    } else {
      setN8nExtractedAmounts({});
    }
  }

  const extractInvoiceFromFile = async (file: File) => {
    // Use Anthropic proxy directly (same as Multiple PDFs tab) â€” no n8n needed
    console.log('ðŸ”„ Starting extraction for file:', file.name);
    setExtracting(true);

    try {
      if (!file || file.size === 0) {
        throw new Error('File is empty or invalid. Please select a valid file.');
      }

      // Call the Anthropic proxy directly (no n8n dependency)
      const proxyUrl = invoiceFlowAgentUrl('/api/agent/extract-image');
      const formPayload = new FormData();
      formPayload.append('file', file, file.name);

      console.log('ðŸ“¤ Calling Anthropic proxy:', proxyUrl);
      const response = await fetch(proxyUrl, { method: 'POST', body: formPayload });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Extraction failed (${response.status}): ${errText.substring(0, 200)}`);
      }

      const rawData = await response.json();
      // Proxy returns array; normalise to single object for the scan flow
      const data: any = Array.isArray(rawData)
        ? (rawData[0]?.invoice ?? rawData[0])
        : (rawData?.invoice ?? rawData);

      console.log('âœ… Anthropic proxy extraction successful:', data?.invoice_number, data?.vendor_name, data?.total_amount);
      
      // Handle different response formats from n8n
      let invoices: any[] = [];
      
      // Case 1: Direct array
      if (Array.isArray(data)) {
        invoices = data;
        console.log('âœ… Response is direct array:', invoices.length, 'invoices');
      }
      // Case 2: Nested in 'invoices' key
      else if (data && typeof data === 'object' && Array.isArray(data.invoices)) {
        invoices = data.invoices;
        console.log('âœ… Response has nested invoices array:', invoices.length, 'invoices');
      }
      // Case 3: Nested in 'data' key
      else if (data && typeof data === 'object' && Array.isArray(data.data)) {
        invoices = data.data;
        console.log('âœ… Response has nested data array:', invoices.length, 'invoices');
      }
      // Case 4: Nested in 'results' key
      else if (data && typeof data === 'object' && Array.isArray(data.results)) {
        invoices = data.results;
        console.log('âœ… Response has nested results array:', invoices.length, 'invoices');
      }
      // Case 5: Single invoice object
      else if (data && typeof data === 'object' && data.invoice_number) {
        invoices = [data];
        console.log('âš ï¸ Response is single invoice object - n8n only extracted ONE invoice');
        console.log('ðŸ’¡ To process multiple invoices, your n8n workflow must return an ARRAY of invoices');
        console.log('ðŸ’¡ Expected format: [{invoice1}, {invoice2}, ...] or {invoices: [{invoice1}, {invoice2}]}');
      }
      // Case 6: Fallback - wrap in array
      else {
        invoices = [data];
        console.log('âš ï¸ Unknown response format, treating as single invoice');
      }
      
      console.log('ðŸ“„ Final invoices array length:', invoices.length);
      console.log('ðŸ“„ Invoice numbers:', invoices.map((inv: any) => inv?.invoice_number || 'N/A'));
      
      if (invoices.length > 1) {
        console.log(`ðŸ“„ Multiple invoices detected: ${invoices.length} invoices found in PDF`);
        toast({
          title: 'Multiple invoices detected',
          description: `Found ${invoices.length} invoices in this PDF. Processing each one...`,
        });
        
        // Process each invoice and save them
        await processMultipleInvoices(invoices, file);
        return;
      }
      
      // Single invoice - process normally
      let invoiceData = invoices[0];
      
      if (!invoiceData) {
        throw new Error('No invoice data found in response. Please check your n8n workflow configuration.');
      }
      
      // Handle nested OR flat response structure (Prompt 1 - robust n8n parser)
      const raw = data;
      const ifrsData = raw?.ifrs ?? raw?.risk ?? raw?.data ?? raw ?? {};

      const ifrs_category =
        ifrsData?.ifrs_category ??
        ifrsData?.ifrsCategory ??
        raw?.ifrs_category ??
        raw?.category ??
        null;
      const ifrs_confidence =
        ifrsData?.ifrs_confidence != null ? Number(ifrsData.ifrs_confidence) :
        ifrsData?.confidence != null ? Number(ifrsData.confidence) :
        raw?.ifrs_confidence != null ? Number(raw.ifrs_confidence) :
        0;
      const ifrs_explanation =
        ifrsData?.ifrs_explanation ?? ifrsData?.explanation ?? raw?.ifrs_explanation ?? null;
      const gl_account =
        ifrsData?.gl_account ?? ifrsData?.glAccount ?? raw?.gl_account ?? null;
      const risk_level =
        ifrsData?.risk_level ?? ifrsData?.riskLevel ?? raw?.risk_level ?? 'Low';
      const risk_score =
        ifrsData?.risk_score ?? ifrsData?.riskScore ?? raw?.risk_score ?? 0;

      console.log('N8N RAW RESPONSE:', JSON.stringify(raw, null, 2).substring(0, 1500));
      console.log('PARSED IFRS:', { ifrs_category, ifrs_confidence, gl_account, risk_level });

      // Merge extracted IFRS into invoiceData for handleWebhookResponse
      invoiceData = {
        ...invoiceData,
        ifrs_category: ifrs_category ?? invoiceData.ifrs_category,
        ifrs_confidence: ifrs_confidence ?? invoiceData.ifrs_confidence,
        ifrs_explanation: ifrs_explanation ?? invoiceData.ifrs_explanation,
        gl_account: gl_account ?? invoiceData.gl_account,
        risk_level,
        risk_score,
      };
      
      console.log('ðŸ“ Processing single invoice:', invoiceData.invoice_number || 'N/A');
      
      // Expected response shape (example):
      // {
      //   invoice_number: string;
      //   invoice_date: string; // yyyy-mm-dd
      //   due_date: string;     // yyyy-mm-dd
      //   vendor_name: string;
      //   vendor_email?: string;
      //   vendor_phone?: string;
      //   vendor_address?: string;
      //   currency?: string;
      //   total_amount?: number;
      //   line_items?: Array<{ description: string; quantity: number; unit_price: number; total?: number }>
      //   ifrs_category?: string;
      //   ifrs_confidence?: number; // 0-100
      //   ifrs_explanation?: string;
      // }

      // Map webhook response to extractedData and auto-fill form (ifrs_* and risk_* from n8n)
      handleWebhookResponse(invoiceData);

      // Tax type/rate from n8n for form
      const taxRateFromN8n = parseAmount(
        invoiceData.tax_rate ?? invoiceData.taxRate ?? invoiceData.Tax_Rate
      );
      const taxTypeRaw = invoiceData.tax_type ?? invoiceData.taxType ?? invoiceData.Tax_Type;
      const taxTypeFromN8n =
        taxTypeRaw
          ? (String(taxTypeRaw).trim() as 'None' | 'VAT' | 'GST' | 'Sales Tax' | 'Withholding Tax')
          : 'None';
      if (taxTypeFromN8n !== 'None' || taxRateFromN8n > 0) {
        setFormData((prev) => ({
          ...prev,
          tax_type: taxTypeFromN8n !== 'None' ? taxTypeFromN8n : prev.tax_type,
          tax_rate: taxRateFromN8n > 0 ? String(taxRateFromN8n) : prev.tax_rate,
        }));
      }

      if (Array.isArray(invoiceData.line_items) && invoiceData.line_items.length > 0) {
        setLineItems(
          invoiceData.line_items.map((item: any, index: number) => {
            const quantity = Number(item.quantity) || 0;
            const unitPrice = Number(item.unit_price) || 0;
            const total =
              item.total !== undefined && item.total !== null
                ? Number(item.total)
                : quantity * unitPrice;

            return {
              id: String(index + 1),
              description: item.description || '',
              quantity,
              unit_price: unitPrice,
              total,
            };
          })
        );
      }

      console.log('âœ… IFRS & risk from n8n:', {
        ifrs_category: invoiceData.ifrs_category,
        risk_level: invoiceData.risk_level,
      });

      // Show review modal so user can verify/edit before saving
      const normalized = normalizeExtractedInvoice(invoiceData as Record<string, unknown>);
      const rawConfidence = (rawData as any)?.[0]?.confidence ?? (rawData as any)?.confidence;

      // Extract line items for display + saving
      const extractedLines: PreviewLineItem[] = Array.isArray(invoiceData.line_items)
        ? (invoiceData.line_items as any[]).map((li) => ({
            description: String(li.description || ''),
            quantity: Number(li.quantity) || 1,
            unit_price: Number(li.unit_price) || 0,
            total: Number(li.total) || Number(li.quantity || 1) * Number(li.unit_price || 0),
          }))
        : [];

      setScanPreviewData(normalized);
      setScanPreviewConfidence(rawConfidence != null ? Number(rawConfidence) : undefined);
      setScanPreviewLineItems(extractedLines);
      setScanPreviewFile(file);   // keep file so we can upload it on save
      setScanPreviewOpen(true);
    } catch (error: any) {
      console.error('âŒ Error extracting invoice from file:', error);
      
      let errorMessage = 'We could not extract details from this file. You can still fill in the form manually.';
      
      if (error?.message?.includes('Failed to fetch')) {
        errorMessage = 'Failed to connect to the extraction API. Please check: 1) Your n8n workflow is active, 2) The webhook URL is correct, 3) CORS is enabled on your n8n instance.';
      } else if (error?.message) {
        errorMessage = `Extraction error: ${error.message}`;
      }
      
      toast({
        title: 'Could not read invoice automatically',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setExtracting(false);
    }
  };

  /** Called when user clicks "Save to invoice list" in the scan review modal */
  const handleSaveFromScanPreview = async (values: NormalizedExtractedInvoice) => {
    setSavingFromScan(true);
    try {
      const { getMyCompany } = await import('@/lib/companyService');
      const company = await getMyCompany();
      const invKind: 'purchase' | 'sales' = values.invoice_kind;
      const today = new Date().toISOString().slice(0, 10);
      const row = {
        invoice_number: values.invoice_number.trim() || `SCAN-${Date.now()}`,
        invoice_date: values.invoice_date.slice(0, 10) || today,
        due_date: values.due_date.slice(0, 10) || today,
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
        source: 'camera' as const,   // 'camera' is a valid enum value; 'scan' is not
        invoice_type: invKind,
        ar_due_date: invKind === 'sales' ? values.due_date.slice(0, 10) : null,
        payment_received: false,
        company_id: company?.id ?? null,
        file_url: scanPreviewFile
          ? await uploadInvoiceFile(scanPreviewFile, 'scan').then((r) => r.url).catch(() => null)
          : null,
        file_type: scanPreviewFile?.type || null,
        updated_at: new Date().toISOString(),
      };
      // Check for duplicate before inserting
      const invoiceNum = row.invoice_number;
      const { data: existing } = await supabase
        .from('invoices')
        .select('id, invoice_number')
        .eq('invoice_number', invoiceNum)
        .eq('company_id', company?.id ?? '')
        .maybeSingle();
      if (existing) {
        toast({
          title: 'âš ï¸ Duplicate invoice',
          description: `Invoice ${invoiceNum} already exists in your list. Go to Invoice List to view it.`,
          variant: 'destructive',
        });
        setScanPreviewOpen(false);
        return;
      }

      const { data: inserted, error } = await supabase
        .from('invoices')
        .insert(row)
        .select('id')
        .single();
      if (error) {
        if (error.code === '23505' || String(error).includes('409') || String(error.message).includes('duplicate')) {
          throw new Error(`Invoice ${invoiceNum} already exists. Check your Invoice List.`);
        }
        throw error;
      }

      // Save line items if any were extracted
      if (inserted?.id && scanPreviewLineItems.length > 0) {
        const lineRows = scanPreviewLineItems.map((li) => ({
          invoice_id: inserted.id,
          description: li.description,
          quantity: li.quantity,
          unit_price: li.unit_price,
          total: li.total,
        }));
        const { error: liErr } = await supabase.from('invoice_line_items').insert(lineRows);
        if (liErr) console.warn('Line items insert warning:', liErr.message);
      }

      toast({
        title: 'âœ… Invoice saved',
        description: `${values.invoice_number} saved with ${scanPreviewLineItems.length} line item(s)`,
      });
      setScanPreviewOpen(false);
      setScanPreviewData(null);
      setScanPreviewLineItems([]);
      setScanPreviewFile(null);
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setSavingFromScan(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleNewFiles = (incomingFiles: File[]) => {
    if (incomingFiles.length === 0) return;

    // Clear previous files and form data when new files are added
    setFiles(incomingFiles);
    
    // Reset form to ensure we're not using old data
    setFormData({
      invoice_number: '',
      invoice_date: '',
      due_date: '',
      vendor_name: '',
      vendor_email: '',
      vendor_phone: '',
      vendor_address: '',
      total_amount: '',
      currency: baseCurrency || 'USD',
      taxCode: 'NONE',
      tax_type: 'None',
      tax_rate: '',
      po_number: '',
    });
    setLineItems([{ id: '1', description: '', quantity: 1, unit_price: 0, total: 0 }]);
    setIfrsData({ ifrs_category: null, ifrs_confidence: null, ifrs_explanation: null });
    setN8nExtractedAmounts({});
    setExtractedData(null);

    // Try to auto-extract from the first newly added file
    const primaryFile = incomingFiles[0];
    console.log('ðŸ”„ Starting extraction for new file:', primaryFile.name, 'Size:', primaryFile.size, 'bytes');
    void extractInvoiceFromFile(primaryFile);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    handleNewFiles(droppedFiles);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      handleNewFiles(selectedFiles);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const addLineItem = () => {
    const newId = (lineItems.length + 1).toString();
    setLineItems([
      ...lineItems,
      { id: newId, description: '', quantity: 1, unit_price: 0, total: 0 },
    ]);
  };

  const removeLineItem = (id: string) => {
    if (lineItems.length > 1) {
      setLineItems(lineItems.filter((item) => item.id !== id));
    }
  };

  const updateLineItem = (
    id: string,
    field: keyof LineItem,
    value: string | number
  ) => {
    setLineItems(
      lineItems.map((item) => {
        if (item.id === id) {
          const updated = { ...item, [field]: value };
          if (field === 'quantity' || field === 'unit_price') {
            updated.total = Number(updated.quantity) * Number(updated.unit_price);
          }
          return updated;
        }
        return item;
      })
    );
  };

  const calculateTotal = () => {
    return lineItems.reduce((sum, item) => sum + item.total, 0);
  };

  // Calculate subtotal (sum of line items)
  const calculateSubtotal = () => {
    return calculateTotal();
  };

  // Calculate tax amount (global tax codes + legacy simple rate)
  const calculateTaxAmount = () => {
    const subtotal = n8nExtractedAmounts.subtotal_amount ?? calculateSubtotal();
    if (formData.taxCode && formData.taxCode !== 'NONE') {
      const { taxAmount } = calculateTax(
        subtotal,
        formData.taxCode,
        Number(formData.tax_rate) || undefined
      );
      return taxAmount;
    }
    const taxRate = Number(formData.tax_rate) || 0;
    if (formData.tax_type === 'None' || taxRate === 0) return 0;
    return (subtotal * taxRate) / 100;
  };

  // Calculate total amount (subtotal + tax)
  const calculateTotalWithTax = () => {
    const subtotal = n8nExtractedAmounts.subtotal_amount ?? calculateSubtotal();
    if (formData.taxCode && formData.taxCode !== 'NONE') {
      return calculateTax(subtotal, formData.taxCode, Number(formData.tax_rate) || undefined).total;
    }
    return calculateSubtotal() + calculateTaxAmount();
  };

  const currentTaxBreakdown = () => {
    const subtotal = n8nExtractedAmounts.subtotal_amount ?? calculateSubtotal();
    if (!formData.taxCode || formData.taxCode === 'NONE') return [];
    return calculateTax(subtotal, formData.taxCode, Number(formData.tax_rate) || undefined).breakdown;
  };

  // Total to display and save: prefer formData.total_amount (from n8n) when set
  const displayTotal = () => {
    const fromForm = cleanAmount(formData.total_amount);
    return fromForm > 0 ? fromForm : calculateTotalWithTax();
  };

  // Parse amount from n8n/bulk upload
  // Handles: "46,846.00", "â‚¹46,846", "$1,234.56", "AED 1,234.56", "AED1234",
  //          "1,23,456.00" (Indian lakhs), "â‚¬1.234,56" (EU format), plain numbers
  const parseAmount = (val: any): number => {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return isFinite(val) ? val : 0;
    // Remove currency symbols, codes (AED, INR, USD, EUR, GBP, SAR, QAR etc.), commas, spaces
    const cleaned = String(val)
      .replace(/[â‚¹$â‚¬Â£Â¥â‚©]/g, '')                   // currency symbols
      .replace(/\b[A-Z]{3}\b/g, '')                // 3-letter currency codes like AED, INR, USD
      .replace(/,/g, '')                            // thousands separators
      .replace(/\s+/g, '')                          // spaces
      .trim();
    const n = parseFloat(cleaned);
    return isFinite(n) ? n : 0;
  };
  const cleanAmount = parseAmount; // alias for existing usage

  // Helper function to convert dd-mm-yyyy to yyyy-mm-dd
  const convertDateFormat = (dateStr: string): string => {
    if (!dateStr) return '';
    // If already in yyyy-mm-dd format, return as is
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return dateStr;
    }
    // Convert dd-mm-yyyy to yyyy-mm-dd
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const [day, month, year] = parts;
      return `${year}-${month}-${day}`;
    }
    // If format is unknown, try to parse as-is
    return dateStr;
  };

  // Process multiple invoices from a single PDF
  async function processMultipleInvoices(invoices: any[], file: File) {
    setUploading(true);
    setUploadProgress(0);
    
    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];
    const batchConfScores: number[] = [];

    try {
      const companyId = await requireCompanyId();
      const lim0 = await checkInvoiceLimit();
      if (!lim0.allowed) {
        toast({ title: 'Monthly limit reached', description: lim0.message, variant: 'destructive' });
        setUploading(false);
        return;
      }
      if (lim0.limit >= 0 && lim0.used + invoices.length > lim0.limit) {
        toast({
          title: 'Monthly limit',
          description: `This batch would exceed your plan (${lim0.used}/${lim0.limit} used).`,
          variant: 'destructive',
        });
        setUploading(false);
        return;
      }

      for (let i = 0; i < invoices.length; i++) {
        const invoiceData = invoices[i];
        setUploadProgress(Math.round(((i + 1) / invoices.length) * 90));

        // Validate required fields
        if (!invoiceData.invoice_number || !invoiceData.invoice_date || !invoiceData.due_date || !invoiceData.vendor_name) {
          errors.push(`Invoice ${i + 1}: Missing required fields`);
          errorCount++;
          continue;
        }

        const startTime = Date.now();
        const _today = new Date().toISOString().split('T')[0];
        const invoiceDate = convertDateFormat(invoiceData.invoice_date || '') || _today;
        const dueDate = convertDateFormat(invoiceData.due_date || '') || null;

        // Calculate amounts
        const lineItemsTotal = Array.isArray(invoiceData.line_items)
          ? invoiceData.line_items.reduce((sum: number, item: any) => {
              const itemTotal = item.total !== undefined && item.total !== null
                ? Number(item.total)
                : (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
              return sum + itemTotal;
            }, 0)
          : Number(invoiceData.total_amount) || 0;

        const taxRate = invoiceData.tax_rate ? Number(invoiceData.tax_rate) : 0;
        const taxType = invoiceData.tax_type || 'None';
        const subtotalAmount = lineItemsTotal;
        const taxAmount = taxType !== 'None' && taxRate > 0 ? (subtotalAmount * taxRate) / 100 : 0;
        const totalAmount = subtotalAmount + taxAmount;

        // Determine approval level
        const approvalLevel = getRequiredApprovalLevel(totalAmount);
        const initialStatus = approvalLevel === 'none' ? 'Approved' : 'Processing';

        const ifrsBatch = Number(invoiceData.ifrs_confidence ?? invoiceData.confidence ?? 0) || 0;
        const ocrBatch = buildOcrColumnsFromWebhook(invoiceData as Record<string, unknown>, ifrsBatch || null);
        const ocrCompletenessBatch = computeFieldCompletenessScore({
          vendor_name: invoiceData.vendor_name,
          total_amount: totalAmount,
          invoice_date: invoiceDate,
          invoice_number: invoiceData.invoice_number,
          due_date: dueDate,
        } as Invoice);
        const ocrConfidenceBatch = ocrBatch.ocr_confidence ?? ocrCompletenessBatch;
        const ocrFieldsBatch =
          Object.keys(ocrBatch.ocr_confidence_fields).length > 0 ? ocrBatch.ocr_confidence_fields : {};

        // Save invoice
        const { data: invoice, error: invoiceError } = await supabase
          .from('invoices')
          .insert({
            company_id: companyId,
            invoice_number: invoiceData.invoice_number,
            invoice_date: invoiceDate,
            due_date: dueDate,
            vendor_name: invoiceData.vendor_name,
            vendor_email: invoiceData.vendor_email || null,
            vendor_phone: invoiceData.vendor_phone || null,
            vendor_address: invoiceData.vendor_address || null,
            subtotal_amount: subtotalAmount,
            tax_type: taxType,
            tax_rate: taxType !== 'None' ? taxRate : 0,
            tax_amount: taxAmount,
            total_amount: totalAmount,
            currency: invoiceData.currency || 'USD',
            status: initialStatus,
            file_url: `batch-${file.name}-${i + 1}`,
            file_type: file.type || 'application/pdf',
            processing_time_seconds: Math.floor((Date.now() - startTime) / 1000),
            ifrs_category: (invoiceData.ifrs_category ?? invoiceData.category) || '',
            ifrs_confidence: ifrsBatch,
            ocr_confidence: ocrConfidenceBatch,
            ocr_confidence_fields: ocrFieldsBatch,
            ifrs_explanation: (invoiceData.ifrs_explanation ?? invoiceData.explanation) || '',
            ifrs_manual_override: false,
            approval_level: approvalLevel,
            approved_by: null,
            approved_at: approvalLevel === 'none' ? new Date().toISOString() : null,
            po_number: invoiceData.po_number || null,
          })
          .select()
          .single();

        if (invoiceError) {
          errors.push(`Invoice ${i + 1} (${invoiceData.invoice_number}): ${invoiceError.message}`);
          errorCount++;
          continue;
        }

        // Save line items
        if (Array.isArray(invoiceData.line_items) && invoiceData.line_items.length > 0) {
          const lineItemsData = invoiceData.line_items.map((item: any) => ({
            invoice_id: invoice.id,
            description: item.description || '',
            quantity: Number(item.quantity) || 0,
            unit_price: Number(item.unit_price) || 0,
            total: item.total !== undefined && item.total !== null
              ? Number(item.total)
              : (Number(item.quantity) || 0) * (Number(item.unit_price) || 0),
          }));

          const { error: lineItemsError } = await supabase
            .from('invoice_line_items')
            .insert(lineItemsData);

          if (lineItemsError) {
            console.error(`Error saving line items for invoice ${i + 1}:`, lineItemsError);
          }
        }

        // Run anomaly detection
        try {
          const { data: existingInvoices } = await supabase
            .from('invoices')
            .select('invoice_number, vendor_name, total_amount, invoice_date, due_date, vendor_email')
            .neq('id', invoice.id);

          if (existingInvoices) {
            const anomalyResult = await detectAnomalies(
              {
                invoice_number: invoiceData.invoice_number,
                invoice_date: invoiceDate ?? '',
                due_date: dueDate ?? '',
                vendor_name: invoiceData.vendor_name,
                vendor_email: invoiceData.vendor_email || null,
                total_amount: totalAmount,
              },
              existingInvoices
            );

            await supabase
              .from('invoices')
              .update({
                risk_score: anomalyResult.risk_score,
                risk_flags: Array.isArray(anomalyResult.risk_flags) ? anomalyResult.risk_flags : [],
                updated_at: new Date().toISOString(),
              })
              .eq('id', invoice.id);
          }
        } catch (anomalyError) {
          console.error(`Anomaly detection failed for invoice ${i + 1}:`, anomalyError);
        }

        const ifrsCat = invoiceData.ifrs_category ?? invoiceData.category;
        if (ifrsCat) {
          const glBatch = await resolveGLAccount(supabase, String(ifrsCat), null, {
            description: descriptionFromBatchRow(invoiceData as Record<string, unknown>),
            vendorName: invoiceData.vendor_name,
          });
          await supabase
            .from('invoices')
            .update({
              ...invoiceGlFieldsFromResult(glBatch),
              updated_at: new Date().toISOString(),
            })
            .eq('id', invoice.id);
        }

        if (invoiceData.po_number?.trim() || invoiceData.vendor_name?.trim()) {
          try {
            await runAutoMatch(invoice.id);
          } catch (matchError) {
            console.error(`Auto match failed for invoice ${i + 1}:`, matchError);
          }
        }

        // Create audit log
        await supabase.from('audit_logs').insert({
          invoice_id: invoice.id,
          action: 'Created',
          user_name: 'System User',
        });

        const effBatch = getEffectiveExtractionScore(invoice as Invoice);
        batchConfScores.push(effBatch);
        logAction('invoice.created', 'invoice', invoice.id, getInvoiceflowWorkEmail() || 'System User', {
          source: 'batch_excel',
          ocr_confidence: effBatch,
          needs_review: effBatch < 70,
        });

        successCount++;
      }

      setUploadProgress(100);
      setUploadSuccess(true);

      if (successCount > 0) {
        const avg =
          batchConfScores.length > 0
            ? Math.round(batchConfScores.reduce((a, b) => a + b, 0) / batchConfScores.length)
            : 0;
        const needsN = batchConfScores.filter((s) => s < 70).length;
        const confPhrase =
          avg >= 90
            ? `Average confidence ${avg}% (strong).`
            : avg >= 70
              ? `Average confidence ${avg}%.`
              : `Average confidence ${avg}% â€” review recommended.`;
        toast({
          title: 'Batch Upload Successful!',
          description: `Successfully processed ${successCount} invoice${successCount > 1 ? 's' : ''}${errorCount > 0 ? `. ${errorCount} failed.` : '.'} ${confPhrase}${needsN > 0 ? ` ${needsN} need${needsN === 1 ? 's' : ''} review.` : ''}`,
        });
      }

      if (errorCount > 0 && errors.length > 0) {
        console.error('Errors during batch processing:', errors);
        toast({
          title: 'Some invoices failed',
          description: errors.slice(0, 3).join(', ') + (errors.length > 3 ? '...' : ''),
          variant: 'destructive',
        });
      }

      // Reset form after successful batch upload
      if (successCount === invoices.length) {
        setFormData({
          invoice_number: '',
          invoice_date: '',
          due_date: '',
          vendor_name: '',
          vendor_email: '',
          vendor_phone: '',
          vendor_address: '',
          total_amount: '',
          currency: baseCurrency || 'USD',
          taxCode: 'NONE',
          tax_type: 'None',
          tax_rate: '',
          po_number: '',
        });
        setLineItems([{ id: '1', description: '', quantity: 1, unit_price: 0, total: 0 }]);
        setIfrsData({ ifrs_category: null, ifrs_confidence: null, ifrs_explanation: null });
        setFiles([]);
      }

    } catch (error: any) {
      console.error('âŒ Error processing multiple invoices:', error);
      toast({
        title: 'Batch Processing Error',
        description: error.message || 'Failed to process multiple invoices',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      setExtracting(false);
    }
  }

  /** Call n8n JSON classification webhook for bulk-uploaded invoices (batches of 5). Runs in background. */
  const classifyBulkInvoices = async (
    savedInvoices: Array<{
      id: string;
      invoice_number: string;
      vendor_name: string;
      total_amount: number;
      description?: string | null;
      invoice_date: string;
      due_date: string;
      po_number?: string | null;
      currency?: string | null;
    }>,
    webhookUrl: string
  ) => {
    console.log('=== CLASSIFY START ===');
    console.log('URL:', webhookUrl);
    console.log('Invoice count:', savedInvoices.length);

    classificationNonJsonToastShown.current = false;
    const BATCH = 5;
    for (let i = 0; i < savedInvoices.length; i += BATCH) {
      const batch = savedInvoices.slice(i, i + BATCH);
      await Promise.allSettled(
        batch.map(async (invoice) => {
          try {
            console.log('Classifying:', invoice.invoice_number);

            const payload = {
              invoice_id: invoice.id,
              invoice_number: invoice.invoice_number,
              vendor_name: invoice.vendor_name,
              total_amount: invoice.total_amount,
              description: invoice.description ?? '',
              invoice_date: invoice.invoice_date,
              due_date: invoice.due_date,
              po_number: invoice.po_number ?? '',
              currency: invoice.currency ?? 'INR',
              text: `Vendor: ${invoice.vendor_name}. Description: ${invoice.description ?? ''}. Amount: ${invoice.total_amount} ${invoice.currency ?? 'INR'}.`,
            };
            const res = await fetch(webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });

            const rawBody = await res.text();
            console.log('Response status:', res.status, res.ok);
            console.log('Raw response:', rawBody?.substring(0, 200));

            if (!res.ok) {
              console.error('Webhook error:', res.status, invoice.invoice_number, rawBody?.slice(0, 200));
              return;
            }

            if (!rawBody || rawBody.trim() === '') {
              console.warn('EMPTY response for', invoice.invoice_number);
              if (!classificationNonJsonToastShown.current) {
                classificationNonJsonToastShown.current = true;
                toast({
                  title: 'IFRS classification: webhook returned empty',
                  description: 'Your n8n workflow returned an empty response. Add a "Respond to Webhook" node that returns JSON with ifrs_category.',
                  variant: 'destructive',
                });
              }
              return;
            }

            let n8nData: Record<string, unknown>;
            try {
              n8nData = JSON.parse(rawBody);
            } catch (e) {
              console.error('JSON parse failed for', invoice.invoice_number, ':', rawBody?.slice(0, 300));
              if (!classificationNonJsonToastShown.current) {
                classificationNonJsonToastShown.current = true;
                toast({
                  title: 'IFRS classification: webhook must return JSON',
                  description: 'Your n8n workflow returned a non-JSON response. Add a "Respond to Webhook" node that returns JSON with ifrs_category.',
                  variant: 'destructive',
                });
              }
              return;
            }
            const nestedIfrs = n8nData?.ifrs as Record<string, unknown> | undefined;
            const nestedData = n8nData?.data as Record<string, unknown> | undefined;
            const cat =
              (n8nData?.ifrs_category as string | undefined) ??
              (n8nData?.category as string | undefined) ??
              (nestedIfrs?.ifrs_category as string | undefined) ??
              (nestedData?.ifrs_category as string | undefined) ??
              null;

            const risk = n8nData?.risk_level ?? n8nData?.riskLevel ?? 'Low';
            console.log('Parsed:', invoice.invoice_number, 'â†’', cat, '| confidence:', n8nData?.ifrs_confidence, '| risk:', risk);

            if (!cat) {
              console.warn('No ifrs_category in response:', JSON.stringify(n8nData).substring(0, 300));
              return;
            }

            const n8nRiskFlags = n8nData?.risk_flags ?? n8nData?.riskFlags ?? null;
            const n8nRiskFlagCount = n8nData?.risk_flag_count ?? n8nData?.riskFlagCount ?? (Array.isArray(n8nRiskFlags) ? n8nRiskFlags.length : 0);
            const rawRiskScore = n8nData?.risk_score;
            const riskScoreText =
              rawRiskScore == null ? null
              : typeof rawRiskScore === 'string' && ['low', 'medium', 'high'].includes(String(rawRiskScore).toLowerCase())
                ? String(rawRiskScore).toLowerCase()
                : typeof rawRiskScore === 'number'
                  ? (rawRiskScore >= 60 ? 'high' : rawRiskScore >= 30 ? 'medium' : 'low')
                  : null;
            const glRes = await resolveGLAccount(supabase, cat, null, {
              vendorName: invoice.vendor_name,
              description: '',
            });
            const n8nGl = (n8nData?.gl_account ?? n8nData?.glAccount) as string | null | undefined;
            const n8nGlName = (n8nData?.gl_account_name ?? n8nData?.glAccountName) as string | null | undefined;
            const codeM = glRes.gl_account ?? n8nGl ?? null;
            const nameM = glRes.gl_account_name ?? n8nGlName ?? null;
            const filledFromN8n = !!n8nGl && !glRes.gl_account;
            const glMerged = {
              ...glRes,
              gl_account: codeM,
              gl_account_name: nameM,
              gl_confirmed: filledFromN8n ? true : glRes.gl_confirmed,
              gl_suggestion_source: filledFromN8n ? ('manual' as const) : glRes.gl_suggestion_source,
            };
            const { error } = await supabase
              .from('invoices')
              .update({
                ifrs_category: cat,
                ifrs_confidence: n8nData?.ifrs_confidence ?? 0,
                ifrs_explanation: n8nData?.ifrs_explanation ?? null,
                ...invoiceGlFieldsFromResult(glMerged),
                risk_level: risk,
                risk_score: riskScoreText,
                risk_flags: Array.isArray(n8nRiskFlags) ? n8nRiskFlags : (typeof n8nRiskFlags === 'string' ? (() => { try { const p = JSON.parse(n8nRiskFlags as string); return Array.isArray(p) ? p : []; } catch { return []; } })() : []),
                risk_flag_count: n8nRiskFlagCount,
                risk_details: typeof n8nRiskFlags === 'string' ? n8nRiskFlags : (Array.isArray(n8nRiskFlags) ? JSON.stringify(n8nRiskFlags) : null),
                updated_at: new Date().toISOString(),
              })
              .eq('id', invoice.id);

            if (error) {
              console.error('Supabase update error:', invoice.invoice_number, error.message);
            } else {
              console.log('âœ… Classified:', invoice.invoice_number, 'â†’', cat);
            }
          } catch (err) {
            console.error('Exception for', invoice.invoice_number, (err as Error)?.message);
          }
        })
      );
      if (i + BATCH < savedInvoices.length) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    console.log('=== CLASSIFY DONE ===');
  };

  // Bulk upload functions
  const downloadTemplate = () => {
    const templateData = [
      {
        invoice_number: 'INV-2025-001',
        invoice_date: '2025-01-15',
        due_date: '2025-02-15',
        vendor_name: 'Acme Corporation',
        vendor_email: 'billing@acme.com',
        vendor_phone: '+1-555-1234',
        vendor_address: '123 Main St, City, State 12345',
        total_amount: '1250.00',
        currency: 'USD',
        description: 'Office Supplies - Paper, Pens, Staplers',
      },
      {
        invoice_number: 'INV-2025-002',
        invoice_date: '2025-01-16',
        due_date: '2025-02-16',
        vendor_name: 'Tech Services Inc',
        vendor_email: 'invoice@techservices.com',
        vendor_phone: '+1-555-5678',
        vendor_address: '456 Tech Ave, City, State 54321',
        total_amount: '3500.00',
        currency: 'USD',
        description: 'Software License - Annual Subscription',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Invoices');
    XLSX.writeFile(wb, 'invoice_bulk_upload_template.xlsx');
  };

  // Map common column header variations to expected keys (case-insensitive)
  const normalizeBulkRow = (row: any): any => {
    const keyMap: Record<string, string> = {
      'invoice_number': 'invoice_number', 'invoice number': 'invoice_number', 'invoice #': 'invoice_number', 'inv no': 'invoice_number', 'invoice no': 'invoice_number',
      'invoice_date': 'invoice_date', 'invoice date': 'invoice_date', 'date': 'invoice_date', 'inv date': 'invoice_date',
      'due_date': 'due_date', 'due date': 'due_date', 'payment due': 'due_date',
      'vendor_name': 'vendor_name', 'vendor name': 'vendor_name', 'vendor': 'vendor_name', 'supplier': 'vendor_name',
      'vendor_email': 'vendor_email', 'vendor email': 'vendor_email', 'email': 'vendor_email',
      'vendor_phone': 'vendor_phone', 'vendor phone': 'vendor_phone', 'phone': 'vendor_phone',
      'vendor_address': 'vendor_address', 'vendor address': 'vendor_address', 'address': 'vendor_address',
      'total_amount': 'total_amount', 'total amount': 'total_amount', 'amount': 'total_amount', 'total': 'total_amount',
      'net_amount': 'total_amount', 'net amount': 'total_amount', 'invoice amount': 'total_amount',
      'currency': 'currency', 'curr': 'currency',
      'description': 'description', 'notes': 'description', 'remarks': 'description',
      'vat_amount': 'vat_amount', 'vat amount': 'vat_amount', 'tax amount': 'vat_amount', 'tax_amount': 'vat_amount',
      'vat_rate': 'vat_rate', 'vat rate': 'vat_rate', 'tax rate': 'vat_rate',
      'vendor_trn': 'vendor_trn', 'vendor trn': 'vendor_trn', 'trn': 'vendor_trn', 'supplier trn': 'vendor_trn',
      'vat_treatment': 'vat_treatment', 'vat treatment': 'vat_treatment', 'tax treatment': 'vat_treatment',
      'po_number': 'po_number', 'po number': 'po_number', 'purchase order': 'po_number', 'po #': 'po_number',
      'gstin': 'gstin', 'vendor gstin': 'gstin', 'supplier gstin': 'gstin',
    };
    const normalized: any = {};
    for (const [rawKey, value] of Object.entries(row)) {
      const key = String(rawKey || '').trim().toLowerCase();
      const mappedKey = keyMap[key] ?? key.replace(/\s+/g, '_');
      normalized[mappedKey] = value;
    }
    return normalized;
  };

  const parseBulkFile = async (file: File) => {
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(firstSheet);

      if (!jsonData || jsonData.length === 0) {
        throw new Error('File is empty or has no data');
      }

      // Validate and parse each row
      const parsedData: any[] = [];
      const errors: Record<number, string[]> = {};
      const allRowsForPreview: Array<{ rowNum: number; data: any; errors: string[] }> = [];

      jsonData.forEach((row: any, index: number) => {
        const rowNum = index + 2; // +2 because index is 0-based and Excel rows start at 2 (header is row 1)
        const rowNorm = normalizeBulkRow(row);
        const rowErrors: string[] = [];

        // Required fields validation
        if (!rowNorm.invoice_number || String(rowNorm.invoice_number).trim() === '') {
          rowErrors.push('Invoice number is required');
        }
        if (!rowNorm.invoice_date || String(rowNorm.invoice_date).trim() === '') {
          rowErrors.push('Invoice date is required');
        }
        if (!rowNorm.due_date || String(rowNorm.due_date).trim() === '') {
          rowErrors.push('Due date is required');
        }
        if (!rowNorm.vendor_name || String(rowNorm.vendor_name).trim() === '') {
          rowErrors.push('Vendor name is required');
        }

        // Date format validation
        const invoiceDate = rowNorm.invoice_date ? String(rowNorm.invoice_date) : '';
        const dueDate = rowNorm.due_date ? String(rowNorm.due_date) : '';
        
        // Try to parse dates (handle Excel date serial numbers)
        let parsedInvoiceDate = invoiceDate;
        let parsedDueDate = dueDate;
        
        if (typeof rowNorm.invoice_date === 'number') {
          // Excel date serial number (days since 1900-01-01)
          const excelEpoch = new Date(1899, 11, 30); // Excel epoch
          const date = new Date(excelEpoch.getTime() + rowNorm.invoice_date * 24 * 60 * 60 * 1000);
          if (!isNaN(date.getTime())) {
            parsedInvoiceDate = date.toISOString().split('T')[0];
          } else {
            rowErrors.push('Invalid invoice date format');
          }
        } else if (invoiceDate && !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) {
          // Try to parse other date formats
          const date = new Date(invoiceDate);
          if (!isNaN(date.getTime())) {
            parsedInvoiceDate = date.toISOString().split('T')[0];
          } else {
            rowErrors.push('Invalid invoice date format (use YYYY-MM-DD)');
          }
        }

        if (typeof rowNorm.due_date === 'number') {
          const excelEpoch = new Date(1899, 11, 30);
          const date = new Date(excelEpoch.getTime() + rowNorm.due_date * 24 * 60 * 60 * 1000);
          if (!isNaN(date.getTime())) {
            parsedDueDate = date.toISOString().split('T')[0];
          } else {
            rowErrors.push('Invalid due date format');
          }
        } else if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
          const date = new Date(dueDate);
          if (!isNaN(date.getTime())) {
            parsedDueDate = date.toISOString().split('T')[0];
          } else {
            rowErrors.push('Invalid due date format (use YYYY-MM-DD)');
          }
        }

        const nInv = toStorageFormat(String(parsedInvoiceDate || ''));
        const nDue = toStorageFormat(String(parsedDueDate || ''));
        if (/^\d{4}-\d{2}-\d{2}$/.test(nInv)) parsedInvoiceDate = nInv;
        if (/^\d{4}-\d{2}-\d{2}$/.test(nDue)) parsedDueDate = nDue;

        // Amount validation (parseAmount handles Indian format 3,24,500.00 and â‚¹46,846)
        const totalAmount = parseAmount(rowNorm.total_amount);
        if (isNaN(totalAmount) || totalAmount <= 0) {
          rowErrors.push('Total amount must be a positive number');
        }

        let parsedRow: any = null;
        if (rowErrors.length > 0) {
          errors[rowNum] = rowErrors;
        } else {
          parsedRow = {
            invoice_number: String(rowNorm.invoice_number).trim(),
            invoice_date: parsedInvoiceDate,
            due_date: parsedDueDate,
            vendor_name: String(rowNorm.vendor_name).trim(),
            vendor_email: rowNorm.vendor_email ? String(rowNorm.vendor_email).trim() : null,
            vendor_phone: rowNorm.vendor_phone ? String(rowNorm.vendor_phone).trim() : null,
            vendor_address: rowNorm.vendor_address ? String(rowNorm.vendor_address).trim() : null,
            total_amount: totalAmount,
            currency: rowNorm.currency ? String(rowNorm.currency).trim().toUpperCase() : 'INR',
            description: rowNorm.description ? String(rowNorm.description).trim() : '',
            // 3-way match fields
            po_number: rowNorm.po_number ? String(rowNorm.po_number).trim() : null,
            // UAE VAT fields
            vendor_trn: rowNorm.vendor_trn ? String(rowNorm.vendor_trn).trim() : null,
            vat_amount: rowNorm.vat_amount ? parseAmount(rowNorm.vat_amount) : null,
            vat_rate: rowNorm.vat_rate ? parseAmount(rowNorm.vat_rate) : null,
            vat_treatment: rowNorm.vat_treatment ? String(rowNorm.vat_treatment).trim() : null,
            // India GST fields
            gstin: rowNorm.gstin ? String(rowNorm.gstin).trim() : null,
          };
          parsedData.push(parsedRow);
        }
        // Always add to preview so user can see all rows including errors
        allRowsForPreview.push({
          rowNum,
          data: parsedRow || {
            invoice_number: rowNorm.invoice_number ? String(rowNorm.invoice_number).trim() : '-',
            invoice_date: parsedInvoiceDate || (rowNorm.invoice_date ? String(rowNorm.invoice_date) : '-'),
            due_date: parsedDueDate || (rowNorm.due_date ? String(rowNorm.due_date) : '-'),
            vendor_name: rowNorm.vendor_name ? String(rowNorm.vendor_name).trim() : '-',
            total_amount: !isNaN(totalAmount) && totalAmount > 0 ? totalAmount : (rowNorm.total_amount ?? '-'),
            currency: rowNorm.currency ? String(rowNorm.currency).trim().toUpperCase() : 'INR',
          },
          errors: rowErrors,
        });
      });

      setBulkData(parsedData);
      setBulkErrors(errors);
      setBulkPreviewRows(allRowsForPreview);

      if (Object.keys(errors).length > 0) {
        toast({
          title: 'Validation Errors Found',
          description: `Found errors in ${Object.keys(errors).length} row(s). Please review and fix them.`,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'File Parsed Successfully',
          description: `Found ${parsedData.length} valid invoice(s) ready to import.`,
        });
      }
    } catch (error: any) {
      console.error('Error parsing bulk file:', error);
      toast({
        title: 'Error Parsing File',
        description: error.message || 'Failed to parse the Excel/CSV file. Please check the format.',
        variant: 'destructive',
      });
    }
  };

  const handleBulkFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv')) {
        setBulkFile(file);
        void parseBulkFile(file);
      } else {
        toast({
          title: 'Invalid File Type',
          description: 'Please upload an Excel (.xlsx, .xls) or CSV file.',
          variant: 'destructive',
        });
      }
    }
  };

  const handleBulkSubmit = async () => {
    if (bulkData.length === 0) {
      toast({
        title: 'No Data to Import',
        description: 'Please upload and parse a file first.',
        variant: 'destructive',
      });
      return;
    }

    if (Object.keys(bulkErrors).length > 0) {
      toast({
        title: 'Validation Errors',
        description: 'Please fix all validation errors before submitting.',
        variant: 'destructive',
      });
      return;
    }

    setBulkUploading(true);
    const results = {
      success: 0,
      failed: 0,
      errors: [] as Array<{ row: number; invoice_number: string; error: string }>,
    };
    const savedInvoices: Array<{
      id: string;
      invoice_number: string;
      vendor_name: string;
      total_amount: number;
      description?: string | null;
      invoice_date: string;
      due_date: string;
      po_number?: string | null;
      currency?: string | null;
    }> = [];

    try {
      // Clear cache so we always get a fresh company lookup
      clearCompanyCache();
      const companyId = await requireCompanyId();
      const limBulk = await checkInvoiceLimit();
      if (!limBulk.allowed) {
        toast({ title: 'Monthly limit reached', description: limBulk.message, variant: 'destructive' });
        setBulkUploading(false);
        return;
      }
      if (limBulk.limit >= 0 && limBulk.used + bulkData.length > limBulk.limit) {
        toast({
          title: 'Monthly limit',
          description: `This import would exceed ${limBulk.limit} invoices (${limBulk.used} used this month).`,
          variant: 'destructive',
        });
        setBulkUploading(false);
        return;
      }

      // Fetch existing invoices for anomaly detection
      const { data: existingInvoices } = await supabase
        .from('invoices')
        .select('invoice_number, vendor_name, total_amount, invoice_date, due_date, vendor_email');

      for (let i = 0; i < bulkData.length; i++) {
        const invoiceData = bulkData[i];
        const rowNum = i + 2; // Excel row number

        try {
          const startTime = Date.now();
          const approvalLevel = getRequiredApprovalLevel(invoiceData.total_amount);
          const initialStatus = approvalLevel === 'none' ? 'Approved' : 'Processing';

          // Upsert invoice (re-upload same invoice_number updates instead of failing unique constraint)
          // jsonb columns need arrays, not strings â€” risk_flags: [] not '[]'
          const upsertPayload = {
            company_id: companyId,
            invoice_number: invoiceData.invoice_number,
            invoice_date: invoiceData.invoice_date,
            due_date: invoiceData.due_date,
            vendor_name: invoiceData.vendor_name,
            vendor_email: invoiceData.vendor_email || null,
            vendor_phone: invoiceData.vendor_phone || null,
            vendor_address: invoiceData.vendor_address || null,
            total_amount: invoiceData.total_amount,
            subtotal_amount: invoiceData.total_amount, // Assume no tax for bulk upload
            tax_code: 'NONE',
            tax_breakdown: '[]',
            invoice_language: 'en',
            exchange_rate_to_base: 1,
            tax_type: 'None',
            tax_rate: 0,
            tax_amount: 0,
            currency: invoiceData.currency || 'INR',
            status: initialStatus,
            processing_time_seconds: Math.floor((Date.now() - startTime) / 1000),
            approval_level: approvalLevel,
            approved_by: null,
            approved_at: approvalLevel === 'none' ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
            risk_flags: [] as unknown[],
            risk_score: null,
            risk_level: null,
            // UAE VAT fields (passed through if present in Excel)
            ...(invoiceData.vendor_trn ? { vendor_trn: String(invoiceData.vendor_trn) } : {}),
            ...(invoiceData.vat_amount ? { vat_amount: parseAmount(invoiceData.vat_amount), tax_amount: parseAmount(invoiceData.vat_amount) } : {}),
            ...(invoiceData.vat_rate ? { vat_rate: parseAmount(invoiceData.vat_rate) } : {}),
            ...(invoiceData.vat_treatment ? { vat_treatment: String(invoiceData.vat_treatment) } : {}),
            // India GST fields
            ...(invoiceData.gstin ? { gstin: String(invoiceData.gstin) } : {}),
            ...(invoiceData.description ? { description: String(invoiceData.description) } : {}),
            ...(invoiceData.po_number ? { po_number: String(invoiceData.po_number) } : {}),
          };

          console.log('Inserting row:', JSON.stringify(upsertPayload, null, 2));

          const { data: invoice, error: invoiceError } = await supabase
            .from('invoices')
            .upsert(upsertPayload, { onConflict: 'invoice_number' })
            .select()
            .single();

          if (invoiceError) {
            console.error(
              'ROW FAILED:',
              invoiceData.invoice_number,
              '| Error:',
              invoiceError.message,
              '| Code:',
              invoiceError.code,
              '| Details:',
              invoiceError.details,
              '| Hint:',
              invoiceError.hint
            );
            results.failed++;
            results.errors.push({
              row: rowNum,
              invoice_number: invoiceData.invoice_number,
              error: [invoiceError.message, invoiceError.details].filter(Boolean).join(' â€” '),
            });
            continue;
          }

          savedInvoices.push({
            id: invoice.id,
            invoice_number: invoice.invoice_number,
            vendor_name: invoice.vendor_name,
            total_amount: Number(invoice.total_amount),
            description: invoiceData.description ?? invoice.description ?? null,
            invoice_date: invoice.invoice_date,
            due_date: invoice.due_date,
            po_number: invoiceData.po_number ?? invoice.po_number ?? null,
            currency: invoice.currency ?? invoiceData.currency ?? null,
          });

          // Run anomaly detection
          if (existingInvoices) {
            try {
              const anomalyResult = await detectAnomalies(
                {
                  invoice_number: invoiceData.invoice_number,
                  invoice_date: invoiceData.invoice_date,
                  due_date: invoiceData.due_date,
                  vendor_name: invoiceData.vendor_name,
                  vendor_email: invoiceData.vendor_email || null,
                  total_amount: invoiceData.total_amount,
                },
                existingInvoices
              );

              await supabase
                .from('invoices')
                .update({
                  risk_score: anomalyResult.risk_score,
                  risk_flags: Array.isArray(anomalyResult.risk_flags) ? anomalyResult.risk_flags : [],
                  updated_at: new Date().toISOString(),
                })
                .eq('id', invoice.id);
            } catch (anomalyError) {
              console.error(`Anomaly detection failed for invoice ${invoiceData.invoice_number}:`, anomalyError);
            }
          }

          // Create audit log
          await supabase.from('audit_logs').insert({
            invoice_id: invoice.id,
            action: 'Created',
            user_name: 'System User',
          });

          results.success++;
        } catch (error: any) {
          results.failed++;
          results.errors.push({
            row: rowNum,
            invoice_number: invoiceData.invoice_number,
            error: error.message || 'Unknown error',
          });
          console.error('ROW FAILED (catch):', invoiceData.invoice_number, '|', error?.message);
        }
      }

      console.log('Succeeded:', results.success, 'Failed:', results.failed);
      results.errors.forEach((e, i) => console.error('Fail', i, e.invoice_number, e.error));

      setBulkResults(results);
      setBulkUploading(false);

      const classificationRunning = savedInvoices.length > 0 && apiEndpoint;
      toast({
        title: 'Bulk Upload Complete',
        description: classificationRunning
          ? `Successfully imported ${results.success} invoice(s). AI classification running in backgroundâ€¦`
          : `Successfully imported ${results.success} invoice(s). ${results.failed > 0 ? `${results.failed} failed.` : ''}`,
        variant: results.failed > 0 ? 'destructive' : 'default',
      });

      navigate('/invoices');

      if (classificationRunning) {
        const N8N_JSON_URL =
          import.meta.env.VITE_N8N_CLASSIFY_URL ||
          import.meta.env.VITE_N8N_WEBHOOK_URL?.replace('invoice-upload', 'invoice-classify-json') ||
          apiEndpointClassifyJson ||
          apiEndpoint?.replace(/webhook-test/g, 'webhook')?.replace(/invoice-upload/g, 'invoice-classify-json');
        const classifyUrlRaw = ((N8N_JSON_URL || apiEndpoint?.replace(/webhook-test/g, 'webhook')) ?? '').replace(/webhook-test/g, 'webhook');
        const classifyUrl = resolveWebhookUrlForBrowser(classifyUrlRaw);
        console.log('Classify URL being used:', classifyUrl);
        void classifyBulkInvoices(savedInvoices, classifyUrl);
      }
    } catch (error: any) {
      console.error('Bulk upload error:', error?.message, error?.details, error);
      const msg = error?.message || '';
      if (msg.includes('company') || msg.includes('MULTI-TENANT')) {
        toast({
          title: 'No workspace found',
          description: 'Complete onboarding first to link your account to a company.',
          variant: 'destructive',
        });
        navigate('/onboarding');
      } else {
        toast({
          title: 'Bulk Upload Error',
          description: [msg, error?.details].filter(Boolean).join(' â€” ') || 'Failed to process bulk upload',
          variant: 'destructive',
        });
      }
      setBulkUploading(false);
    }
  };

  // Multiple PDFs queue functions
  const addPdfsToQueue = (pdfFiles: File[]) => {
    const pdfOnly = pdfFiles.filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
    
    if (pdfOnly.length === 0) {
      toast({
        title: 'No PDF Files',
        description: 'Please select PDF files only.',
        variant: 'destructive',
      });
      return;
    }

    const newItems: QueueItem[] = pdfOnly.map(file => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      status: 'pending' as QueueItemStatus,
      extractedData: null,
      error: null,
    }));

    setPdfQueue(prev => {
      const updated = [...prev, ...newItems];
      // Start processing after state update
      setTimeout(() => {
        if (!processingQueue) {
          void processPdfQueue();
        }
      }, 100);
      return updated;
    });
    
    toast({
      title: `${newItems.length} PDF(s) added to queue`,
      description: 'Processing will start automatically...',
    });
  };

  const processPdfQueue = async () => {
    if (processingQueue) return;
    
    setProcessingQueue(true);
    
    // Get current queue state
    let currentQueue = [...pdfQueue];
    const pendingItems = currentQueue.filter(item => item.status === 'pending');
    
    if (pendingItems.length === 0) {
      setProcessingQueue(false);
      return;
    }

    for (const item of pendingItems) {
      setPdfQueue((prev) => {
        const updated = prev.map((q): QueueItem =>
          q.id === item.id ? { ...q, status: 'extracting' } : q
        );
        currentQueue = updated;
        return updated;
      });

      try {
        const results = await extractInvoiceFromFileForQueue(item.file);
        // results is always an array; first result replaces this item, extras are inserted after
        const [first, ...extras] = results;
        setPdfQueue((prev) => {
          const idx = prev.findIndex((q) => q.id === item.id);
          const updated = prev.map((q): QueueItem =>
            q.id === item.id ? { ...q, status: 'ready', extractedData: first, error: null } : q
          );
          if (extras.length > 0) {
            const newItems: QueueItem[] = extras.map((ex: any, i: number) => ({
              id: `${item.id}-p${i + 2}`,
              file: item.file,
              status: 'ready' as QueueItemStatus,
              extractedData: ex,
              error: null,
            }));
            updated.splice(idx + 1, 0, ...newItems);
          }
          return updated;
        });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Extraction failed';
        setPdfQueue((prev) =>
          prev.map((q): QueueItem =>
            q.id === item.id ? { ...q, status: 'failed', error: msg } : q
          )
        );
      }
    }

    setProcessingQueue(false);
  };

  const extractInvoiceFromFileForQueue = async (file: File): Promise<any[]> => {
    // Use the Anthropic proxy â€” it reads ALL pages and returns every invoice found as an array
    const url = invoiceFlowAgentUrl('/api/agent/extract-image');
    const payload = new FormData();
    payload.append('file', file, file.name);

    const response = await fetch(url, { method: 'POST', body: payload });

    if (!response.ok) {
      const errorText = await response.text();
      let detail = errorText;
      try { detail = JSON.parse(errorText)?.detail ?? errorText; } catch { /* ignore */ }
      throw new Error(`Extraction failed (${response.status}): ${detail.substring(0, 200)}`);
    }

    const data = await response.json();
    // Proxy always returns an array; normalise just in case
    const invoices: any[] = Array.isArray(data) ? data : [data];

    // Each element may be { invoice: {...}, confidence: N } or a raw invoice object
    return invoices.map((item) => {
      if (item && item.invoice) return { ...item.invoice, confidence: item.confidence ?? 70 };
      return item;
    });
  };

  const updateQueueItemData = (itemId: string, field: string, value: any) => {
    setPdfQueue(prev => prev.map(item => {
      if (item.id === itemId && item.extractedData) {
        return {
          ...item,
          extractedData: {
            ...item.extractedData,
            [field]: value,
          },
        };
      }
      return item;
    }));
  };

  const removeQueueItem = (itemId: string) => {
    setPdfQueue(prev => prev.filter(item => item.id !== itemId));
  };

  const retryQueueItem = (itemId: string) => {
    setPdfQueue(prev => prev.map(item => 
      item.id === itemId ? { ...item, status: 'pending', error: null, extractedData: null } : item
    ));
    // Trigger processing after state update
    setTimeout(() => {
      void processPdfQueue();
    }, 100);
  };

  const submitAllReadyInvoices = async () => {
    const readyItems = pdfQueue.filter(item => item.status === 'ready' && item.extractedData);
    
    if (readyItems.length === 0) {
      toast({
        title: 'No Ready Invoices',
        description: 'Please wait for extraction to complete or fix failed items.',
        variant: 'destructive',
      });
      return;
    }

    setUploading(true);
    const results = {
      success: 0,
      failed: 0,
      errors: [] as Array<{ fileName: string; error: string }>,
    };
    const queueConfScores: number[] = [];

    try {
      const companyIdQ = await requireCompanyId();
      const limQ = await checkInvoiceLimit();
      if (!limQ.allowed) {
        toast({ title: 'Monthly limit reached', description: limQ.message, variant: 'destructive' });
        setUploading(false);
        return;
      }
      if (limQ.limit >= 0 && limQ.used + readyItems.length > limQ.limit) {
        toast({
          title: 'Monthly limit',
          description: `Would exceed ${limQ.limit} invoices (${limQ.used} used). Reduce batch size.`,
          variant: 'destructive',
        });
        setUploading(false);
        return;
      }

      // Fetch existing invoices for anomaly detection
      const { data: existingInvoices } = await supabase
        .from('invoices')
        .select('invoice_number, vendor_name, total_amount, invoice_date, due_date, vendor_email');

      for (const item of readyItems) {
        const invoiceData = item.extractedData;
        
        try {
          const startTime = Date.now();
          
          // Calculate amounts
          const lineItemsTotal = Array.isArray(invoiceData.line_items) 
            ? invoiceData.line_items.reduce((sum: number, item: any) => {
                const itemTotal = item.total !== undefined && item.total !== null
                  ? Number(item.total)
                  : (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
                return sum + itemTotal;
              }, 0)
            : Number(invoiceData.total_amount) || 0;

          const taxRate = invoiceData.tax_rate ? Number(invoiceData.tax_rate) : 0;
          const taxType = invoiceData.tax_type || 'None';
          const subtotalAmount = lineItemsTotal;
          const taxAmount = taxType !== 'None' && taxRate > 0 ? (subtotalAmount * taxRate) / 100 : 0;
          const totalAmount = subtotalAmount + taxAmount;

          const approvalLevel = getRequiredApprovalLevel(totalAmount);
          const initialStatus = approvalLevel === 'none' ? 'Approved' : 'Processing';

          // Convert dates â€” fallback to today so NOT NULL constraint is always satisfied
          const _todayQ = new Date().toISOString().split('T')[0];
          const invoiceDate = convertDateFormat(invoiceData.invoice_date || '') || _todayQ;
          const dueDate = convertDateFormat(invoiceData.due_date || '') || null;

          const invNumber = invoiceData.invoice_number || `AUTO-${Date.now()}`;
          const ifrsQ = Number(invoiceData.ifrs_confidence ?? invoiceData.confidence ?? 0) || 0;
          const ocrQ = buildOcrColumnsFromWebhook(invoiceData as Record<string, unknown>, ifrsQ || null);
          const ocrComplQ = computeFieldCompletenessScore({
            vendor_name: invoiceData.vendor_name || 'Unknown',
            total_amount: totalAmount,
            invoice_date: invoiceDate,
            invoice_number: invNumber,
            due_date: dueDate,
          } as Invoice);
          const ocrConfQ = ocrQ.ocr_confidence ?? ocrComplQ;
          const ocrFieldsQ = Object.keys(ocrQ.ocr_confidence_fields).length > 0 ? ocrQ.ocr_confidence_fields : {};

          const queueUpsertPayload = {
            company_id: companyIdQ,
            invoice_number: invNumber,
            invoice_date: invoiceDate,
            due_date: dueDate,
            vendor_name: invoiceData.vendor_name || 'Unknown',
            vendor_email: invoiceData.vendor_email || null,
            vendor_phone: invoiceData.vendor_phone || null,
            vendor_address: invoiceData.vendor_address || null,
            subtotal_amount: subtotalAmount,
            tax_type: taxType,
            tax_rate: taxType !== 'None' ? taxRate : 0,
            tax_amount: taxAmount,
            total_amount: totalAmount,
            currency: invoiceData.currency || 'USD',
            status: initialStatus,
            file_url: `queue-${item.file.name}`,
            file_type: item.file.type,
            processing_time_seconds: Math.floor((Date.now() - startTime) / 1000),
            ifrs_category: (invoiceData.ifrs_category ?? invoiceData.category) || '',
            ifrs_confidence: ifrsQ,
            ocr_confidence: ocrConfQ,
            ocr_confidence_fields: ocrFieldsQ,
            ifrs_explanation: (invoiceData.ifrs_explanation ?? invoiceData.explanation) || '',
            ifrs_manual_override: false,
            approval_level: approvalLevel,
            approved_by: null,
            approved_at: approvalLevel === 'none' ? new Date().toISOString() : null,
            po_number: invoiceData.po_number || null,
            updated_at: new Date().toISOString(),
          };

          const { data: invoice, error: invoiceError } = await supabase
            .from('invoices')
            .upsert(queueUpsertPayload, { onConflict: 'invoice_number' })
            .select()
            .single();

          if (invoiceError) {
            console.error('Queue bulk upsert error:', invoiceError.message, invoiceError.details, invoiceError);
            results.failed++;
            results.errors.push({
              fileName: item.file.name,
              error: [invoiceError.message, invoiceError.details].filter(Boolean).join(' â€” '),
            });
            continue;
          }

          // Save line items
          if (Array.isArray(invoiceData.line_items) && invoiceData.line_items.length > 0) {
            const lineItemsData = invoiceData.line_items.map((lineItem: any) => ({
              invoice_id: invoice.id,
              description: lineItem.description || '',
              quantity: Number(lineItem.quantity) || 0,
              unit_price: Number(lineItem.unit_price) || 0,
              total: lineItem.total !== undefined && lineItem.total !== null
                ? Number(lineItem.total)
                : (Number(lineItem.quantity) || 0) * (Number(lineItem.unit_price) || 0),
            }));

            await supabase.from('invoice_line_items').insert(lineItemsData);
          }

          // Run anomaly detection
          if (existingInvoices) {
            try {
              const anomalyResult = await detectAnomalies(
                {
                  invoice_number: invoiceData.invoice_number || `AUTO-${Date.now()}`,
                  invoice_date: invoiceDate ?? '',
                  due_date: dueDate ?? '',
                  vendor_name: invoiceData.vendor_name || 'Unknown',
                  vendor_email: invoiceData.vendor_email || null,
                  total_amount: totalAmount,
                },
                existingInvoices
              );

              await supabase
                .from('invoices')
                .update({
                  risk_score: anomalyResult.risk_score,
                  risk_flags: Array.isArray(anomalyResult.risk_flags) ? anomalyResult.risk_flags : [],
                  updated_at: new Date().toISOString(),
                })
                .eq('id', invoice.id);
            } catch (anomalyError) {
              console.error(`Anomaly detection failed for ${item.file.name}:`, anomalyError);
            }
          }

          const ifrsCat = invoiceData.ifrs_category ?? invoiceData.category;
          if (ifrsCat) {
            const glQ = await resolveGLAccount(supabase, String(ifrsCat), null, {
              description: descriptionFromBatchRow(invoiceData as Record<string, unknown>),
              vendorName: invoiceData.vendor_name || 'Unknown',
            });
            await supabase
              .from('invoices')
              .update({
                ...invoiceGlFieldsFromResult(glQ),
                updated_at: new Date().toISOString(),
              })
              .eq('id', invoice.id);
          }

          if (invoiceData.po_number?.trim() || invoiceData.vendor_name?.trim()) {
            try {
              await runAutoMatch(invoice.id);
            } catch (matchError) {
              console.error(`Auto match failed for ${item.file.name}:`, matchError);
            }
          }

          // Create audit log
          await supabase.from('audit_logs').insert({
            invoice_id: invoice.id,
            action: 'Created',
            user_name: 'System User',
          });

          logAction('invoice.created', 'invoice', invoice.id, getInvoiceflowWorkEmail() || 'System User', {
            source: 'multi_pdf',
          });

          queueConfScores.push(getEffectiveExtractionScore(invoice as Invoice));

          results.success++;
          
          // Update queue item to show success
          setPdfQueue(prev => prev.map(q => 
            q.id === item.id ? { ...q, status: 'ready', extractedData: { ...invoiceData, _saved: true } } : q
          ));
        } catch (error: any) {
          results.failed++;
          results.errors.push({
            fileName: item.file.name,
            error: error.message || 'Unknown error',
          });
        }
      }

      setMultiPdfResults(results);
      setUploading(false);

      const avgQ =
        queueConfScores.length > 0
          ? Math.round(queueConfScores.reduce((a, b) => a + b, 0) / queueConfScores.length)
          : 0;
      const needsQ = queueConfScores.filter((s) => s < 70).length;
      const tailQ =
        results.success > 0 && queueConfScores.length > 0
          ? ` Avg confidence ${avgQ}%.${needsQ > 0 ? ` ${needsQ} need review.` : ''}`
          : '';

      toast({
        title: 'Bulk Upload Complete',
        description: `Successfully imported ${results.success} invoice(s). ${results.failed > 0 ? `${results.failed} failed.` : ''}${tailQ}`,
        variant: results.failed > 0 ? 'destructive' : 'default',
      });
    } catch (error: any) {
      console.error('Bulk submit error:', error);
      toast({
        title: 'Bulk Submit Error',
        description: error.message || 'Failed to submit invoices',
        variant: 'destructive',
      });
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Use extracted data from ref if available (fixes timing when auto-submitting after n8n)
    const dataToUse = extractedFormDataRef.current ?? formData;
    if (extractedFormDataRef.current) extractedFormDataRef.current = null;

    if (!dataToUse.invoice_number?.trim() || !dataToUse.invoice_date?.trim() || !dataToUse.due_date?.trim() || !dataToUse.vendor_name?.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please fill in all required fields (Invoice Number, Invoice Date, Due Date, Vendor Name)',
        variant: 'destructive',
      });
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      const lim = await checkInvoiceLimit();
      if (!lim.allowed) {
        toast({ title: 'Monthly limit reached', description: lim.message, variant: 'destructive' });
        setUploading(false);
        return;
      }
      const companyId = await requireCompanyId();

      const invoiceDate = toStorageFormat(dataToUse.invoice_date);
      const dueDate = toStorageFormat(dataToUse.due_date);
      const totalFromFormNum = cleanAmount(dataToUse.total_amount);
      const totalFromLineItems = calculateTotalWithTax();
      const totalAmount = totalFromFormNum > 0 ? totalFromFormNum : totalFromLineItems;
      const taxAmount =
        n8nExtractedAmounts.tax_amount != null ? n8nExtractedAmounts.tax_amount : calculateTaxAmount();
      const subtotalAmount =
        n8nExtractedAmounts.subtotal_amount != null
          ? n8nExtractedAmounts.subtotal_amount
          : totalFromFormNum > 0
            ? totalAmount - taxAmount
            : calculateSubtotal();

      setUploadProgress(15);

      const ifrsCategory = extractedData?.ifrs_category ?? ifrsData.ifrs_category ?? null;
      const lineDescGl = lineItems.map((i) => i.description).filter(Boolean).join(' ');
      const glResult = ifrsCategory
        ? await resolveGLAccount(supabase, ifrsCategory, null, {
            description: lineDescGl,
            vendorName: dataToUse.vendor_name,
          })
        : extractedData?.gl_account
          ? {
              gl_account: extractedData.gl_account,
              gl_account_name: extractedData.gl_account_name ?? null,
              gl_source: 'ifrs_auto' as const,
              gl_suggestion_source: 'manual' as const,
              gl_confirmed: true,
              gl_account_type: null,
            }
          : {
              gl_account: null,
              gl_account_name: null,
              gl_source: 'ifrs_auto' as const,
            };

      const riskLevel = extractedData?.risk_level ?? 'low';
      const riskScore = extractedData?.risk_score ?? null;
      const riskFlags = extractedData?.risk_flags ?? null;
      const riskFlagCount =
        extractedData?.risk_flag_count ?? (Array.isArray(riskFlags) ? riskFlags.length : 0);

      const taxBreakdownJson = JSON.stringify(currentTaxBreakdown());
      const ifrsForOcr = extractedData?.ifrs_confidence ?? ifrsData.ifrs_confidence ?? null;
      const ocrCols = buildOcrColumnsFromWebhook(
        (extractedData ?? {}) as Record<string, unknown>,
        ifrsForOcr
      );
      const ocrCompleteness = computeFieldCompletenessScore({
        vendor_name: dataToUse.vendor_name,
        total_amount: totalAmount,
        invoice_date: invoiceDate,
        invoice_number: dataToUse.invoice_number,
        due_date: dueDate,
      } as Invoice);
      const ocrConfidenceSaved = ocrCols.ocr_confidence ?? ocrCompleteness;
      const ocrFieldsSaved =
        Object.keys(ocrCols.ocr_confidence_fields).length > 0 ? ocrCols.ocr_confidence_fields : {};

      const insertPayload = {
          company_id: companyId,
          invoice_number: dataToUse.invoice_number,
          vendor_name: dataToUse.vendor_name,
          vendor_email: dataToUse.vendor_email || null,
          vendor_phone: dataToUse.vendor_phone || null,
          vendor_address: dataToUse.vendor_address || null,
          total_amount: totalAmount,
          tax_amount: taxAmount,
          subtotal_amount: subtotalAmount,
          invoice_date: invoiceDate,
          due_date: dueDate,
          po_number: String((dataToUse as Record<string, unknown>).po_number ?? '').trim() || null,
          currency: dataToUse.currency || 'INR',
          exchange_rate_to_base: 1,
          tax_code: (dataToUse as { taxCode?: string }).taxCode ?? formData.taxCode,
          tax_breakdown: taxBreakdownJson,
          invoice_language: extractedData?.invoice_language ?? 'en',
          tax_type: (() => {
            const tc = (dataToUse as { taxCode?: string }).taxCode ?? formData.taxCode;
            const fromCode = mapTaxCodeToLegacyType(tc);
            if (fromCode !== 'None') return fromCode;
            return ((dataToUse as Record<string, unknown>).tax_type as string) || formData.tax_type;
          })(),
          tax_rate: (() => {
            const tc = (dataToUse as { taxCode?: string }).taxCode ?? formData.taxCode;
            if (tc && tc !== 'NONE') {
              const t = TAX_TYPES.find((x) => x.code === tc);
              if (tc === 'GST_CGST_SGST') return Number(formData.tax_rate) || 18;
              const r = Number(formData.tax_rate);
              if (['SALES_TAX', 'CUSTOM', 'WITHHOLDING'].includes(tc) && r > 0) return r;
              const sum = t?.components?.reduce((s, c) => s + c.rate, 0);
              return sum ?? (Number(formData.tax_rate) || 0);
            }
            const tt = (dataToUse as Record<string, unknown>).tax_type as string;
            const tr = (dataToUse as Record<string, unknown>).tax_rate;
            if (tt && tt !== 'None') return Number(tr) || 0;
            return formData.tax_type !== 'None' ? Number(formData.tax_rate) || 0 : 0;
          })(),
          status: 'Processing',
          file_url: files.length > 0 ? `mock-url-${files[0].name}` : null,
          file_type: files.length > 0 ? files[0].type : null,
          ifrs_category: ifrsCategory ?? null,
          ifrs_confidence: extractedData?.ifrs_confidence ?? ifrsData.ifrs_confidence ?? 0,
          ifrs_explanation: extractedData?.ifrs_explanation ?? ifrsData.ifrs_explanation ?? null,
          ifrs_manual_override: false,
          ocr_confidence: ocrConfidenceSaved,
          ocr_confidence_fields: ocrFieldsSaved,
          ...invoiceGlFieldsFromResult(
            ifrsCategory
              ? glResult
              : extractedData?.gl_account
                ? {
                    gl_account: extractedData.gl_account,
                    gl_account_name: extractedData.gl_account_name ?? null,
                    gl_source: 'ifrs_auto',
                    gl_suggestion_source: 'manual',
                    gl_confirmed: true,
                  }
                : glResult
          ),
          risk_score: riskScore ?? null,
          risk_flags: Array.isArray(riskFlags) ? riskFlags : (typeof riskFlags === 'string' ? (() => { try { const p = JSON.parse(riskFlags as string); return Array.isArray(p) ? p : []; } catch { return []; } })() : []),
          risk_level: riskLevel ?? 'Low',
          risk_flag_count: riskFlagCount,
          risk_details: typeof riskFlags === 'string' ? riskFlags : (Array.isArray(riskFlags) ? JSON.stringify(riskFlags) : '[]'),
        };
      console.log('SUPABASE PAYLOAD:', JSON.stringify(insertPayload, null, 2));

      const { data: newInvoice, error } = await supabase
        .from('invoices')
        .insert(insertPayload)
        .select()
        .single();

      if (error) {
        console.error('SUPABASE INSERT ERROR:', error.message, error.details);
        throw error;
      }
      console.log('SAVED TO SUPABASE:', newInvoice);

      setUploadProgress(35);

      // STEP 2: Save line items
      if (lineItems.filter((item) => item.description).length > 0) {
        const lineItemsPayload = lineItems
          .filter((item) => item.description)
          .map((item) => ({
            invoice_id: newInvoice.id,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total: item.total,
          }));
        const { error: lineErr } = await supabase.from('invoice_line_items').insert(lineItemsPayload);
        if (lineErr) throw lineErr;
      }

      setUploadProgress(50);

      setUploadProgress(65);

      setUploadProgress(80);

      // STEP 5: Set approval level
      const approvalLevel =
        totalAmount < 500 ? 'none' : totalAmount < 5000 ? 'manager' : 'cfo';
      const approvedAt = totalAmount < 500 ? new Date().toISOString() : null;
      await supabase
        .from('invoices')
        .update({
          approval_level: approvalLevel,
          approved_by: null,
          approved_at: approvedAt,
          status: totalAmount < 500 ? 'Approved' : 'Processing',
          updated_at: new Date().toISOString(),
        })
        .eq('id', newInvoice.id);

      // STEP 6: Duplicate detection
      const { data: dupes } = await supabase
        .from('invoices')
        .select('id, invoice_number, total_amount')
        .eq('vendor_name', dataToUse.vendor_name)
        .eq('total_amount', totalAmount)
        .neq('id', newInvoice.id);

      if (dupes && dupes.length > 0) {
        await supabase
          .from('invoices')
          .update({
            duplicate_flag: true,
            duplicate_probability: 87,
            updated_at: new Date().toISOString(),
          })
          .eq('id', newInvoice.id);
      }

      // STEP 7: Create audit log
      await supabase.from('audit_logs').insert({
        invoice_id: newInvoice.id,
        action: 'invoice_created',
        field_changed: 'invoice_created',
        new_value: `Invoice ${dataToUse.invoice_number} created. IFRS: ${ifrsCategory ?? 'pending'}. Risk: ${riskLevel}. Approval: ${approvalLevel}`,
        user_name: 'System User',
      });

      const effAfterSave = getEffectiveExtractionScore(newInvoice as Invoice);
      logAction('invoice.created', 'invoice', newInvoice.id, getInvoiceflowWorkEmail() || 'System User', {
        source: 'manual_upload',
        invoice_number: dataToUse.invoice_number,
        ocr_confidence: effAfterSave,
        needs_review: effAfterSave < 70,
      });

      // STEP 8: Post-submit n8n call for IFRS if we don't have it yet
      if (!ifrsCategory && apiEndpoint) {
        try {
          const webhookUrl = apiEndpoint.replace(/webhook-test/g, 'webhook');
          const n8nPayload = {
            invoice_id: newInvoice.id,
            invoice_number: dataToUse.invoice_number,
            vendor_name: dataToUse.vendor_name,
            vendor_email: dataToUse.vendor_email || '',
            total_amount: totalAmount,
            tax_amount: taxAmount,
            invoice_date: invoiceDate,
            due_date: dueDate,
            po_number: dataToUse.po_number || '',
            currency: dataToUse.currency,
            file_url: newInvoice.file_url || '',
          };
          console.log('=== N8N POST-SUBMIT (IFRS) ===');
          console.log('URL:', webhookUrl);
          console.log('Payload:', JSON.stringify(n8nPayload, null, 2));
          const n8nRes = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(n8nPayload),
          });
          const n8nBody = await n8nRes.text();
          console.log('N8N POST-SUBMIT Status:', n8nRes.status, 'Body:', n8nBody);
          if (n8nRes.ok && n8nBody) {
            const n8nData = JSON.parse(n8nBody);
            const nestedIfrs = n8nData?.ifrs as Record<string, unknown> | undefined;
            const nestedData = n8nData?.data as Record<string, unknown> | undefined;
            const cat =
              (n8nData?.ifrs_category as string | undefined) ??
              (n8nData?.category as string | undefined) ??
              (nestedIfrs?.ifrs_category as string | undefined) ??
              (nestedData?.ifrs_category as string | undefined) ??
              null;
            const risk = n8nData?.risk_level ?? n8nData?.riskLevel ?? 'Low';
            if (cat) {
              const glRes = await resolveGLAccount(supabase, cat, null, {
                vendorName: dataToUse.vendor_name,
                description: lineDescGl,
              });
              const n8nRiskFlags = n8nData?.risk_flags ?? n8nData?.riskFlags ?? null;
              const n8nRiskFlagCount = n8nData?.risk_flag_count ?? n8nData?.riskFlagCount ?? (Array.isArray(n8nRiskFlags) ? n8nRiskFlags.length : 0);
              const postOcr = buildOcrColumnsFromWebhook(
                n8nData as Record<string, unknown>,
                n8nData?.ifrs_confidence != null ? Number(n8nData.ifrs_confidence) : null
              );
              const postFields =
                Object.keys(postOcr.ocr_confidence_fields).length > 0 ? postOcr.ocr_confidence_fields : {};
              const n8nGlP = (n8nData?.gl_account ?? n8nData?.glAccount) as string | null | undefined;
              const n8nGlNameP = (n8nData?.gl_account_name ?? n8nData?.glAccountName) as string | null | undefined;
              const codeP = glRes.gl_account ?? n8nGlP ?? null;
              const nameP = glRes.gl_account_name ?? n8nGlNameP ?? null;
              const fromN8nP = !!n8nGlP && !glRes.gl_account;
              const glPostMerged = {
                ...glRes,
                gl_account: codeP,
                gl_account_name: nameP,
                gl_confirmed: fromN8nP ? true : glRes.gl_confirmed,
                gl_suggestion_source: fromN8nP ? ('manual' as const) : glRes.gl_suggestion_source,
              };
              await supabase.from('invoices').update({
                ifrs_category: cat,
                ifrs_confidence: n8nData?.ifrs_confidence ?? 0,
                ocr_confidence:
                  postOcr.ocr_confidence ??
                  (n8nData?.ifrs_confidence != null ? Number(n8nData.ifrs_confidence) : null),
                ocr_confidence_fields: postFields,
                ifrs_explanation: n8nData?.ifrs_explanation ?? null,
                ...invoiceGlFieldsFromResult(glPostMerged),
                risk_level: risk,
                risk_score: n8nData?.risk_score ?? null,
                risk_flags: Array.isArray(n8nRiskFlags) ? n8nRiskFlags : (typeof n8nRiskFlags === 'string' ? (() => { try { const p = JSON.parse(n8nRiskFlags); return Array.isArray(p) ? p : []; } catch { return []; } })() : []),
                risk_flag_count: n8nRiskFlagCount,
                risk_details: typeof n8nRiskFlags === 'string' ? n8nRiskFlags : (Array.isArray(n8nRiskFlags) ? JSON.stringify(n8nRiskFlags) : null),
                updated_at: new Date().toISOString(),
              }).eq('id', newInvoice.id);
              console.log('IFRS SAVED TO SUPABASE:', cat);
            }
          }
        } catch (n8nErr) {
          console.warn('Post-submit n8n IFRS call failed (non-blocking):', n8nErr);
        }
      }

      let matchHint = '';
      if (
        String((dataToUse as Record<string, unknown>).po_number ?? '').trim() ||
        String((dataToUse as Record<string, unknown>).vendor_name ?? '').trim()
      ) {
        try {
          const mr = await runAutoMatch(newInvoice.id);
          if (!mr.skipped) matchHint = ` ${autoMatchToastMessage(mr)}`;
        } catch (matchErr) {
          console.error('Auto match error:', matchErr);
        }
      }

      setUploadProgress(100);
      setUploadSuccess(true);

      console.log('ðŸŽ‰ Invoice submission successful! Saved to Supabase:', newInvoice);

      const confMsg =
        effAfterSave >= 90
          ? `Extraction confidence ${Math.round(effAfterSave)}% (strong).`
          : effAfterSave >= 70
            ? `Extraction confidence ${Math.round(effAfterSave)}% â€” quick review recommended.`
            : `Extraction confidence ${Math.round(effAfterSave)}% â€” needs review.`;
      toast({
        title: 'Success',
        description: `Invoice uploaded successfully. ${confMsg}.${matchHint}`.trim(),
      });

      navigate(effAfterSave < 70 ? '/invoices?tab=needs-review' : '/invoices');
    } catch (error: any) {
      console.error('âŒ Error uploading invoice:', error);
      
      // Show detailed error message
      const errorMessage = error?.message || error?.details || 'Unknown error occurred';
      const errorHint = error?.hint || '';
      
      toast({
        title: 'Error',
        description: `Failed to upload invoice: ${errorMessage}${errorHint ? ` (${errorHint})` : ''}`,
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  if (uploadSuccess) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                <CheckCircle className="h-10 w-10 text-green-600" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-gray-900">Upload Successful!</h2>
                <p className="text-sm text-gray-600">
                  Your invoice has been uploaded and is now being processed.
                </p>
              </div>
              <div className="flex gap-3 pt-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setUploadSuccess(false);
                    setFiles([]);
                    setFormData({
                      invoice_number: '',
                      invoice_date: '',
                      due_date: '',
                      vendor_name: '',
                      vendor_email: '',
                      vendor_phone: '',
                      vendor_address: '',
                      total_amount: '',
                      currency: baseCurrency || 'USD',
                      taxCode: 'NONE',
                      tax_type: 'None',
                      tax_rate: '',
                      po_number: '',
                    });
                    setLineItems([
                      { id: '1', description: '', quantity: 1, unit_price: 0, total: 0 },
                    ]);
                    setIfrsData({
                      ifrs_category: null,
                      ifrs_confidence: null,
                      ifrs_explanation: null,
                    });
                    setN8nExtractedAmounts({});
                    setExtractedData(null);
                  }}
                >
                  Upload Another
                </Button>
                <Button
                  className="flex-1 bg-[#0A4B8F]"
                  onClick={() => {
                    navigate('/invoices');
                  }}
                >
                  View Invoices
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Upload Invoice</h1>
        <p className="mt-1 text-sm text-gray-500">
          Upload invoice files or enter invoice details manually
        </p>
      </div>

      {noCompany && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
          <div className="mt-0.5 h-5 w-5 shrink-0 text-amber-600">âš ï¸</div>
          <div>
            <p className="font-medium text-amber-900">No company set up yet</p>
            <p className="text-sm text-amber-700 mt-1">
              You need to complete onboarding before uploading invoices.{' '}
              <button
                onClick={() => navigate('/onboarding')}
                className="underline font-semibold hover:text-amber-900"
              >
                Complete onboarding â†’
              </button>
            </p>
          </div>
        </div>
      )}

      <Tabs defaultValue="scan" className="w-full">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
          <TabsTrigger value="scan" className="text-xs sm:text-sm">
            <span className="sm:hidden">ðŸ“· Scan</span>
            <span className="hidden sm:inline">ðŸ“· Scan Invoice</span>
          </TabsTrigger>
          <TabsTrigger value="single" className="text-xs sm:text-sm">
            <span className="sm:hidden">ðŸ“¤ Upload</span>
            <span className="hidden sm:inline">Single Upload</span>
          </TabsTrigger>
          <TabsTrigger value="bulk" className="text-xs sm:text-sm">
            <span className="sm:hidden">ðŸ“Š Excel</span>
            <span className="hidden sm:inline">Bulk (Excel/CSV)</span>
          </TabsTrigger>
          <TabsTrigger value="multi-pdf" className="text-xs sm:text-sm">
            <span className="sm:hidden">ðŸ“„ Multi PDF</span>
            <span className="hidden sm:inline">Multiple PDFs</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="scan" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Scan Invoice</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-600">
                Take a photo, upload an image, or select a PDF â€” Claude AI will extract all invoice fields automatically.
              </p>
              <div className="flex flex-col items-center gap-4 py-6">
                <Button
                  type="button"
                  size="lg"
                  className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white px-8 py-6 sm:py-4 text-base rounded-xl"
                  disabled={extracting}
                  onClick={() => setCameraOpen(true)}
                >
                  <Camera className="mr-2 h-6 w-6" />
                  {extracting ? 'Extracting invoiceâ€¦' : 'Open Camera / Upload Image'}
                </Button>
                <p className="text-xs text-gray-400 text-center max-w-sm">
                  Supports JPG, PNG, PDF â€” works from phone camera, desktop file picker, or webcam
                </p>
              </div>
              <CameraCapture
                open={cameraOpen}
                onOpenChange={setCameraOpen}
                onConfirm={(f) => handleNewFiles([f])}
              />
              {extracting && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                    <p className="text-sm font-medium text-blue-900">Reading invoiceâ€¦ Claude AI is extracting all fields</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Review dialog shown after successful extraction */}
          <InvoiceExtractionPreviewModal
            open={scanPreviewOpen}
            onOpenChange={setScanPreviewOpen}
            initial={scanPreviewData}
            confidence={scanPreviewConfidence}
            saving={savingFromScan}
            lineItems={scanPreviewLineItems}
            onSave={handleSaveFromScanPreview}
          />
        </TabsContent>

        <TabsContent value="single" className="space-y-6">
          <form ref={formRef} onSubmit={handleSubmit} className="space-y-6" noValidate>
        {/* File Upload */}
        <Card>
          <CardHeader>
            <CardTitle>Upload Files</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`relative rounded-lg border-2 border-dashed p-12 text-center transition-all ${
                isDragging
                  ? 'border-[#0A4B8F] bg-blue-50 scale-[1.02]'
                  : 'border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100'
              }`}
            >
              <Upload className={`mx-auto h-16 w-16 ${isDragging ? 'text-[#0A4B8F]' : 'text-gray-400'}`} />
              <p className="mt-4 text-lg font-medium text-gray-900">
                {isDragging ? 'Drop your files here' : 'Drag & drop invoice files here'}
              </p>
              <p className="mt-2 text-sm text-gray-500">or click to browse from your computer</p>
              <p className="mt-1 text-xs text-gray-400">
                Supports PDF, PNG, JPG, JPEG (Max 10MB per file)
              </p>
              <input
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={handleFileSelect}
                className="absolute inset-0 cursor-pointer opacity-0"
                disabled={uploading}
              />
            </div>

            {extracting && (
              <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
                <div className="flex items-center gap-3">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"></div>
                  <p className="text-sm font-medium text-blue-900">
                    Extracting invoice details from the uploaded file...
                  </p>
                </div>
              </div>
            )}

            {files.length > 0 && (
              <div className="mt-6 space-y-3">
                <p className="text-sm font-medium text-gray-700">
                  {files.length} file{files.length > 1 ? 's' : ''} selected
                </p>
                {files.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                  >
                    <FileText className="h-8 w-8 text-[#0A4B8F] flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                      <p className="text-xs text-gray-500">
                        {(file.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(index)}
                      disabled={uploading}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {extracting && (
              <div className="mt-4 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                Extracting invoice details from the uploaded file...
              </div>
            )}

            {uploading && (
              <div className="mt-6 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 font-medium">Uploading...</span>
                  <span className="text-gray-600">{uploadProgress}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-full rounded-full bg-[#0A4B8F] transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Invoice Details */}
        <Card>
          <CardHeader>
            <CardTitle>Invoice Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="invoice_number">Invoice Number *</Label>
                <Input
                  id="invoice_number"
                  required
                  value={formData.invoice_number}
                  onChange={(e) =>
                    setFormData({ ...formData, invoice_number: e.target.value })
                  }
                  placeholder="INV-001"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invoice_date">Invoice Date *</Label>
                <Input
                  id="invoice_date"
                  type="date"
                  required
                  value={formData.invoice_date}
                  onChange={(e) =>
                    setFormData({ ...formData, invoice_date: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="due_date">Due Date *</Label>
                <Input
                  id="due_date"
                  type="date"
                  required
                  value={formData.due_date}
                  onChange={(e) =>
                    setFormData({ ...formData, due_date: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="vendor_name">Vendor Name *</Label>
                <Input
                  id="vendor_name"
                  required
                  value={formData.vendor_name}
                  onChange={(e) =>
                    setFormData({ ...formData, vendor_name: e.target.value })
                  }
                  placeholder="Acme Corporation"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vendor_email">Vendor Email</Label>
                <Input
                  id="vendor_email"
                  type="email"
                  value={formData.vendor_email}
                  onChange={(e) =>
                    setFormData({ ...formData, vendor_email: e.target.value })
                  }
                  placeholder="vendor@example.com"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="vendor_phone">Vendor Phone</Label>
                <Input
                  id="vendor_phone"
                  value={formData.vendor_phone}
                  onChange={(e) =>
                    setFormData({ ...formData, vendor_phone: e.target.value })
                  }
                  placeholder="+1 (555) 123-4567"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="currency">Currency</Label>
                <CurrencyCombobox
                  id="currency"
                  value={formData.currency}
                  onChange={(code) => setFormData({ ...formData, currency: code })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="vendor_address">Vendor Address</Label>
              <Textarea
                id="vendor_address"
                value={formData.vendor_address}
                onChange={(e) =>
                  setFormData({ ...formData, vendor_address: e.target.value })
                }
                placeholder="123 Main St, Suite 100, City, State 12345"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="po_number">Purchase Order Number (Optional)</Label>
              <Input
                id="po_number"
                value={formData.po_number}
                onChange={(e) =>
                  setFormData({ ...formData, po_number: e.target.value })
                }
                placeholder="PO-2025-001"
              />
              <p style={{ fontSize: '12px', color: '#6b7280' }}>
                Enter PO number to enable 3-way matching
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Tax Information */}
        <Card>
          <CardHeader>
            <CardTitle>Tax Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="tax_code">Tax regime</Label>
                <Select
                  value={formData.taxCode}
                  onValueChange={(value) => {
                    const taxType = TAX_TYPES.find((t) => t.code === value);
                    const rateFromMeta =
                      value === 'GST_CGST_SGST'
                        ? '18'
                        : taxType?.components?.reduce((s, c) => s + c.rate, 0)?.toString() ?? '';
                    setFormData({
                      ...formData,
                      taxCode: value,
                      tax_type: mapTaxCodeToLegacyType(value),
                      tax_rate:
                        ['SALES_TAX', 'CUSTOM', 'WITHHOLDING'].includes(value) && formData.tax_rate
                          ? formData.tax_rate
                          : rateFromMeta || formData.tax_rate,
                    });
                  }}
                >
                  <SelectTrigger id="tax_code">
                    <SelectValue placeholder="Select tax" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {TAX_TYPES.map((t) => (
                      <SelectItem key={t.code} value={t.code}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {['SALES_TAX', 'CUSTOM', 'WITHHOLDING'].includes(formData.taxCode) && (
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="tax_rate">Tax Rate (%)</Label>
                  <Input
                    id="tax_rate"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={formData.tax_rate}
                    onChange={(e) => setFormData({ ...formData, tax_rate: e.target.value })}
                    placeholder="e.g. 8.5"
                  />
                </div>
              )}
              {formData.taxCode === 'GST_CGST_SGST' && (
                <>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="tax_rate_cgst">Combined CGST+SGST rate (%)</Label>
                    <Input
                      id="tax_rate_cgst"
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={formData.tax_rate}
                      onChange={(e) => setFormData({ ...formData, tax_rate: e.target.value })}
                      placeholder="18"
                    />
                  </div>
                  <div
                    className="md:col-span-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
                  >
                    CGST {Number(formData.tax_rate || 18) / 2}% + SGST {Number(formData.tax_rate || 18) / 2}% ={' '}
                    {Number(formData.tax_rate || 18)}% total
                  </div>
                </>
              )}
            </div>

            {/* Tax Summary */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Subtotal:</span>
                  <span className="font-medium">
                    {formatCurrency(
                      n8nExtractedAmounts.subtotal_amount ?? calculateSubtotal(),
                      formData.currency
                    )}
                  </span>
                </div>
                {formData.taxCode !== 'NONE' &&
                  currentTaxBreakdown().map((line, i) => (
                    <div key={`${line.name}-${i}`} className="flex justify-between text-sm">
                      <span className="text-gray-600">
                        {line.name} @ {line.rate}%:
                      </span>
                      <span className="font-medium">
                        {formatCurrency(line.amount, formData.currency)}
                      </span>
                    </div>
                  ))}
                {formData.taxCode === 'NONE' && formData.tax_type !== 'None' && Number(formData.tax_rate) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">
                      Tax ({formData.tax_type} {formData.tax_rate}%):
                    </span>
                    <span className="font-medium">
                      {formatCurrency(n8nExtractedAmounts.tax_amount ?? calculateTaxAmount(), formData.currency)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between border-t border-gray-300 pt-2">
                  <span className="font-semibold text-gray-900">Total:</span>
                  <span className="text-lg font-bold text-gray-900">
                    {formatCurrency(displayTotal(), formData.currency)}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* UAE VAT fields */}
        {isUAE && (
          <Card>
            <CardHeader>
              <CardTitle>UAE VAT Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Vendor TRN</Label>
                <Input
                  value={vendorTrn}
                  onChange={(e) => setVendorTrn(e.target.value)}
                  placeholder={config.taxIdPlaceholder}
                  className="font-mono"
                />
                {vendorTrn && (
                  <p className={`text-xs font-medium ${validateTaxId(vendorTrn, 'uae') ? 'text-green-700' : 'text-red-600'}`}>
                    {validateTaxId(vendorTrn, 'uae') ? 'âœ“ Valid TRN format' : 'âœ— TRN must be 15 digits starting with 1'}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>VAT Treatment</Label>
                <select
                  value={vatTreatment}
                  onChange={(e) => setVatTreatment(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                >
                  {VAT_TREATMENT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={reverseCharge}
                    onChange={(e) => setReverseCharge(e.target.checked)}
                    className="rounded"
                  />
                  Reverse Charge Mechanism applies
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={designatedZone}
                    onChange={(e) => setDesignatedZone(e.target.checked)}
                    className="rounded"
                  />
                  Designated Zone transaction
                </label>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Line Items */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Line Items</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={addLineItem}>
              <Plus className="mr-2 h-4 w-4" />
              Add Item
            </Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40%]">Description</TableHead>
                    <TableHead className="w-[15%]">Quantity</TableHead>
                    <TableHead className="w-[20%]">Unit Price</TableHead>
                    <TableHead className="w-[20%]">Total</TableHead>
                    <TableHead className="w-[5%]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Input
                          value={item.description}
                          onChange={(e) =>
                            updateLineItem(item.id, 'description', e.target.value)
                          }
                          placeholder="Item description"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={item.quantity}
                          onChange={(e) =>
                            updateLineItem(
                              item.id,
                              'quantity',
                              parseFloat(e.target.value) || 0
                            )
                          }
                          min="0"
                          step="0.01"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={item.unit_price}
                          onChange={(e) =>
                            updateLineItem(
                              item.id,
                              'unit_price',
                              parseFloat(e.target.value) || 0
                            )
                          }
                          min="0"
                          step="0.01"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          ${item.total.toFixed(2)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeLineItem(item.id)}
                          disabled={lineItems.length === 1}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="mt-4 flex justify-end">
              <div className="rounded-lg bg-blue-50 px-4 py-3">
                <div className="text-sm text-gray-600">Total Amount</div>
                <div className="text-2xl font-bold text-blue-600">
                  ${calculateTotal().toFixed(2)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* AI Classification Result Preview */}
        {(extractedData?.ifrs_category ?? ifrsData.ifrs_category) && (
          <div
            style={{
              background: '#eff6ff',
              border: '1px solid #93c5fd',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '16px',
            }}
          >
            <div
              style={{
                fontSize: '12px',
                fontWeight: '700',
                color: '#1a56db',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: '10px',
              }}
            >
              ðŸ¤– AI Classification Result
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <div style={{ fontSize: '11px', color: '#6b7280' }}>IFRS Category</div>
                <div style={{ fontSize: '14px', fontWeight: '700', color: '#1a56db' }}>
                  {extractedData?.ifrs_category ?? ifrsData.ifrs_category}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: '#6b7280' }}>Confidence</div>
                <div style={{ fontSize: '14px', fontWeight: '700', color: '#0e9f6e' }}>
                  {Number(extractedData?.ifrs_confidence ?? ifrsData.ifrs_confidence ?? 0)}%
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: '#6b7280' }}>GL Account</div>
                <div style={{ fontSize: '14px', fontWeight: '700', color: '#374151', fontFamily: 'monospace' }}>
                  {extractedData?.gl_account ?? 'â€”'} â€” {extractedData?.gl_account_name ?? 'â€”'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: '#6b7280' }}>Risk Level</div>
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: '700',
                    color:
                      (extractedData?.risk_level ?? 'Low') === 'High'
                        ? '#e02424'
                        : (extractedData?.risk_level ?? 'Low') === 'Medium'
                          ? '#d97706'
                          : '#0e9f6e',
                  }}
                >
                  {(extractedData?.risk_level ?? 'Low') === 'High'
                    ? 'ðŸ”´'
                    : (extractedData?.risk_level ?? 'Low') === 'Medium'
                      ? 'ðŸŸ¡'
                      : 'ðŸŸ¢'}{' '}
                  {extractedData?.risk_level ?? 'Low'}
                </div>
              </div>
            </div>
            {(extractedData?.ifrs_explanation ?? ifrsData.ifrs_explanation) && (
              <div
                style={{
                  marginTop: '10px',
                  fontSize: '12px',
                  color: '#6b7280',
                  background: 'white',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: '1px solid #e5e7eb',
                }}
              >
                {extractedData?.ifrs_explanation ?? ifrsData.ifrs_explanation}
              </div>
            )}
          </div>
        )}

        {/* Submit Button */}
        <div className="flex justify-end gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate('/invoices')}
            disabled={uploading}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={uploading} className="bg-[#0A4B8F] hover:bg-[#0D6EFD]">
            {uploading ? 'Processing...' : 'Upload Invoice'}
          </Button>
        </div>
      </form>
        </TabsContent>

        <TabsContent value="bulk" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Bulk Upload (Excel/CSV)</CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  onClick={downloadTemplate}
                  className="flex items-center gap-2"
                >
                  <Download className="h-4 w-4" />
                  Download Template
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* File Upload Area */}
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  bulkFile
                    ? 'border-green-300 bg-green-50'
                    : 'border-gray-300 bg-gray-50 hover:border-gray-400'
                }`}
              >
                <FileSpreadsheet className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700">
                    {bulkFile ? bulkFile.name : 'Upload Excel or CSV file'}
                  </p>
                  <p className="text-xs text-gray-500">
                    Supports .xlsx, .xls, and .csv formats
                  </p>
                </div>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleBulkFileSelect}
                  className="hidden"
                  id="bulk-file-input"
                />
                <label htmlFor="bulk-file-input">
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-4"
                    asChild
                  >
                    <span className="cursor-pointer">
                      {bulkFile ? 'Change File' : 'Select File'}
                    </span>
                  </Button>
                </label>
              </div>

              {/* Preview Table */}
              {bulkPreviewRows.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">
                      Preview ({bulkPreviewRows.length} row{bulkPreviewRows.length > 1 ? 's' : ''})
                    </h3>
                    <div className="text-sm text-gray-600">
                      {Object.keys(bulkErrors).length > 0 ? (
                        <span className="text-red-600">
                          {Object.keys(bulkErrors).length} row(s) with errors
                        </span>
                      ) : (
                        <span className="text-green-600">All rows valid</span>
                      )}
                    </div>
                  </div>

                  <div className="border rounded-lg overflow-hidden">
                    <div className="overflow-x-auto max-h-[500px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-12">Row</TableHead>
                            <TableHead>Invoice #</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Vendor</TableHead>
                            <TableHead>Amount</TableHead>
                            <TableHead>Currency</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {bulkPreviewRows.map(({ rowNum, data, errors }, index) => {
                            const hasErrors = errors.length > 0;
                            return (
                              <TableRow
                                key={index}
                                className={hasErrors ? 'bg-red-50' : ''}
                              >
                                <TableCell className="font-medium">{rowNum}</TableCell>
                                <TableCell>{data.invoice_number}</TableCell>
                                <TableCell>{data.invoice_date}</TableCell>
                                <TableCell>{data.vendor_name}</TableCell>
                                <TableCell>
                                  {data.currency} {typeof data.total_amount === 'number' ? Number(data.total_amount).toLocaleString() : data.total_amount}
                                </TableCell>
                                <TableCell>{data.currency}</TableCell>
                                <TableCell>
                                  {hasErrors ? (
                                    <div className="text-xs text-red-600">
                                      {errors.join(', ')}
                                    </div>
                                  ) : (
                                    <span className="text-xs text-green-600">âœ“ Valid</span>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>

                  {/* Results Summary */}
                  {bulkResults && (
                    <Card className="border-blue-200 bg-blue-50">
                      <CardHeader>
                        <CardTitle className="text-lg">Import Results</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-sm text-gray-600">Successfully Imported</p>
                            <p className="text-2xl font-bold text-green-600">{bulkResults.success}</p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-600">Failed</p>
                            <p className="text-2xl font-bold text-red-600">{bulkResults.failed}</p>
                          </div>
                        </div>
                        {bulkResults.errors.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-sm font-semibold text-gray-700">Errors:</p>
                            <div className="max-h-40 overflow-y-auto space-y-1">
                              {bulkResults.errors.map((error, idx) => (
                                <div key={idx} className="text-xs text-red-600 bg-red-50 p-2 rounded">
                                  Row {error.row} ({error.invoice_number}): {error.error}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Submit Button */}
                  <div className="flex justify-end gap-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setBulkFile(null);
                        setBulkData([]);
                        setBulkErrors({});
                        setBulkPreviewRows([]);
                        setBulkResults(null);
                      }}
                      disabled={bulkUploading}
                    >
                      Clear
                    </Button>
                    <Button
                      type="button"
                      onClick={handleBulkSubmit}
                      disabled={bulkUploading || Object.keys(bulkErrors).length > 0 || bulkData.length === 0}
                      className="bg-[#0A4B8F] hover:bg-[#0D6EFD]"
                    >
                      {bulkUploading ? 'Importing...' : `Submit All (${bulkData.length})`}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="multi-pdf" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Multiple PDFs Upload</CardTitle>
              <p className="text-sm text-gray-500 mt-2">
                Upload multiple PDF files (one invoice per PDF). Each will be processed sequentially.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* File Upload Area */}
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  pdfQueue.length > 0
                    ? 'border-blue-300 bg-blue-50'
                    : 'border-gray-300 bg-gray-50 hover:border-gray-400'
                }`}
              >
                <Upload className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700">
                    {pdfQueue.length > 0 
                      ? `${pdfQueue.length} PDF(s) in queue` 
                      : 'Upload multiple PDF files'}
                  </p>
                  <p className="text-xs text-gray-500">
                    Select multiple PDF files (one invoice per PDF)
                  </p>
                </div>
                <input
                  type="file"
                  accept=".pdf"
                  multiple
                  onChange={(e) => {
                    if (e.target.files) {
                      addPdfsToQueue(Array.from(e.target.files));
                    }
                  }}
                  className="hidden"
                  id="multi-pdf-input"
                />
                <label htmlFor="multi-pdf-input">
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-4"
                    asChild
                  >
                    <span className="cursor-pointer">
                      {pdfQueue.length > 0 ? 'Add More PDFs' : 'Select PDF Files'}
                    </span>
                  </Button>
                </label>
              </div>

              {/* Queue List */}
              {pdfQueue.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">
                      Processing Queue ({pdfQueue.length} file{pdfQueue.length > 1 ? 's' : ''})
                    </h3>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const pendingItems = pdfQueue.filter(item => item.status === 'pending');
                          if (pendingItems.length > 0) {
                            void processPdfQueue();
                          }
                        }}
                        disabled={processingQueue || pdfQueue.filter(item => item.status === 'pending').length === 0}
                      >
                        {processingQueue ? 'Processing...' : 'Start Processing'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setPdfQueue([]);
                          setMultiPdfResults(null);
                        }}
                      >
                        Clear All
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {pdfQueue.map((item) => (
                      <Card
                        key={item.id}
                        className={`${
                          item.status === 'ready' 
                            ? 'border-green-300 bg-green-50' 
                            : item.status === 'failed'
                            ? 'border-red-300 bg-red-50'
                            : item.status === 'extracting'
                            ? 'border-blue-300 bg-blue-50'
                            : 'border-gray-200'
                        }`}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 space-y-3">
                              {/* File Info */}
                              <div className="flex items-center gap-3">
                                <FileText className="h-5 w-5 text-gray-500" />
                                <div className="flex-1">
                                  <p className="text-sm font-medium text-gray-900">{item.file.name}</p>
                                  <p className="text-xs text-gray-500">
                                    {(item.file.size / 1024).toFixed(1)} KB
                                  </p>
                                </div>
                                <Badge
                                  variant={
                                    item.status === 'ready' 
                                      ? 'default' 
                                      : item.status === 'failed'
                                      ? 'destructive'
                                      : item.status === 'extracting'
                                      ? 'secondary'
                                      : 'outline'
                                  }
                                  className="capitalize"
                                >
                                  {item.status}
                                </Badge>
                              </div>

                              {/* Status Messages */}
                              {item.status === 'extracting' && (
                                <div className="flex items-center gap-2 text-sm text-blue-600">
                                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"></div>
                                  Extracting invoice data...
                                </div>
                              )}

                              {item.status === 'failed' && (
                                <div className="text-sm text-red-600">
                                  <p className="font-medium">Error:</p>
                                  <p>{item.error || 'Extraction failed'}</p>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="mt-2"
                                    onClick={() => retryQueueItem(item.id)}
                                  >
                                    Retry
                                  </Button>
                                </div>
                              )}

                              {/* Extracted Data Preview */}
                              {item.status === 'ready' && item.extractedData && (
                                <div className="mt-4 space-y-3 border-t pt-3">
                                  <div className="grid grid-cols-2 gap-3 text-sm">
                                    <div>
                                      <span className="text-gray-500">Invoice #:</span>
                                      <Input
                                        value={item.extractedData.invoice_number || ''}
                                        onChange={(e) => updateQueueItemData(item.id, 'invoice_number', e.target.value)}
                                        className="mt-1 h-8"
                                        placeholder="INV-001"
                                      />
                                    </div>
                                    <div>
                                      <span className="text-gray-500">Vendor:</span>
                                      <Input
                                        value={item.extractedData.vendor_name || ''}
                                        onChange={(e) => updateQueueItemData(item.id, 'vendor_name', e.target.value)}
                                        className="mt-1 h-8"
                                        placeholder="Vendor Name"
                                      />
                                    </div>
                                    <div>
                                      <span className="text-gray-500">Date:</span>
                                      <Input
                                        type="date"
                                        value={item.extractedData.invoice_date || ''}
                                        onChange={(e) => updateQueueItemData(item.id, 'invoice_date', e.target.value)}
                                        className="mt-1 h-8"
                                      />
                                    </div>
                                    <div>
                                      <span className="text-gray-500">Amount:</span>
                                      <Input
                                        type="number"
                                        value={item.extractedData.total_amount || ''}
                                        onChange={(e) => updateQueueItemData(item.id, 'total_amount', Number(e.target.value))}
                                        className="mt-1 h-8"
                                        placeholder="0.00"
                                      />
                                    </div>
                                  </div>
                                  {item.extractedData._saved && (
                                    <p className="text-xs text-green-600">âœ“ Saved successfully</p>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex flex-col gap-2">
                              {item.status !== 'extracting' && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeQueueItem(item.id)}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {/* Submit All Button */}
                  {pdfQueue.filter(item => item.status === 'ready').length > 0 && (
                    <div className="flex justify-end pt-4 border-t">
                      <Button
                        type="button"
                        onClick={submitAllReadyInvoices}
                        disabled={uploading || pdfQueue.filter(item => item.status === 'ready').length === 0}
                        className="bg-[#0A4B8F] hover:bg-[#0D6EFD]"
                      >
                        {uploading 
                          ? 'Submitting...' 
                          : `Submit All (${pdfQueue.filter(item => item.status === 'ready').length} ready)`}
                      </Button>
                    </div>
                  )}

                  {/* Results Summary */}
                  {multiPdfResults && (
                    <Card className="border-blue-200 bg-blue-50">
                      <CardHeader>
                        <CardTitle className="text-lg">Import Results</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-sm text-gray-600">Successfully Imported</p>
                            <p className="text-2xl font-bold text-green-600">{multiPdfResults.success}</p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-600">Failed</p>
                            <p className="text-2xl font-bold text-red-600">{multiPdfResults.failed}</p>
                          </div>
                        </div>
                        {multiPdfResults.errors.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-sm font-semibold text-gray-700">Errors:</p>
                            <div className="max-h-40 overflow-y-auto space-y-1">
                              {multiPdfResults.errors.map((error, idx) => (
                                <div key={idx} className="text-xs text-red-600 bg-red-50 p-2 rounded">
                                  {error.fileName}: {error.error}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

