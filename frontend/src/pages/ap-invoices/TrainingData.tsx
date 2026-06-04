/**
 * Training Data Onboarding â€” /training
 * Upload 3-5 years of historical invoices â†’ build vendor profiles â†’ power anomaly detection
 */

import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useToast } from '../../hooks/use-toast';
import { getMyCompany } from '../../lib/ap-invoice/companyService';
import { supabase } from '../../lib/ap-invoice/supabase';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Progress } from '../../components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import {
  AlertTriangle,
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  HelpCircle,
  Loader2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Upload,
  XCircle,
} from 'lucide-react';

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface VendorProfile {
  id: string;
  vendor_name: string;
  mean_amount: number;
  std_deviation: number;
  min_amount: number;
  max_amount: number;
  median_amount: number;
  avg_invoices_per_month: number;
  typical_gl_code: string;
  typical_gl_confidence: number;
  typical_ifrs_category: string;
  historical_rejection_rate: number;
  is_recurring: boolean;
  is_splitting_vendor: boolean;
  price_trend: 'stable' | 'increasing' | 'decreasing';
  price_trend_pct: number;
  training_invoice_count: number;
  training_date_from: string | null;
  training_date_to: string | null;
}

interface ApIntelligence {
  avg_invoice_amount: number;
  median_invoice_amount: number;
  avg_invoices_per_month: number;
  is_trained: boolean;
  training_invoice_count: number;
  training_date_from: string | null;
  training_date_to: string | null;
  last_trained_at: string | null;
}

interface TrainingUpload {
  id: string;
  file_name: string;
  uploaded_at: string;
  status: 'processing' | 'completed' | 'failed';
  rows_processed: number;
  vendors_profiled: number;
  gl_mappings_created: number;
}

interface ParsedInvoiceRow {
  vendor_name?: string;
  invoice_number?: string;
  invoice_date?: string;
  due_date?: string;
  total_amount?: number | string;
  currency?: string;
  description?: string;
  gl_code?: string;
  ifrs_category?: string;
  approval_status?: string;
  department?: string;
  po_number?: string;
  [key: string]: unknown;
}

// â”€â”€â”€ Required columns spec â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const REQUIRED_COLS = [
  { key: 'vendor_name',      label: 'Vendor Name',       required: true },
  { key: 'invoice_number',   label: 'Invoice Number',    required: true },
  { key: 'invoice_date',     label: 'Invoice Date',      required: true },
  { key: 'due_date',         label: 'Due Date',          required: false },
  { key: 'total_amount',     label: 'Total Amount',      required: true },
  { key: 'currency',         label: 'Currency',          required: false },
  { key: 'description',      label: 'Description',       required: false },
  { key: 'gl_code',          label: 'GL Code',           required: false },
  { key: 'ifrs_category',    label: 'IFRS Category',     required: false },
  { key: 'approval_status',  label: 'Approval Status',   required: false },
  { key: 'department',       label: 'Department',        required: false },
  { key: 'po_number',        label: 'PO Number',         required: false },
];

// â”€â”€â”€ Column normaliser â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Flexible mapping: handles Tally exports, custom headers, Indian naming conventions */
function normaliseRow(raw: Record<string, unknown>): ParsedInvoiceRow {
  const keys = Object.keys(raw);
  const find = (...variants: string[]) => {
    for (const v of variants) {
      const hit = keys.find(
        (k) => k.toLowerCase().replace(/[\s_\-./]/g, '') === v.toLowerCase().replace(/[\s_\-./]/g, '')
      );
      if (hit !== undefined && raw[hit] !== '' && raw[hit] !== null && raw[hit] !== undefined) {
        return String(raw[hit]);
      }
    }
    return '';
  };

  // Normalise Excel date serial â†’ string
  const parseDate = (v: string) => {
    if (!v) return '';
    // Excel serial number (e.g. 44927)
    if (/^\d{5}$/.test(v.trim())) {
      const d = XLSX.SSF.parse_date_code(parseInt(v, 10));
      return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
    }
    // DD/MM/YYYY â†’ YYYY-MM-DD
    const ddmm = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (ddmm) {
      const yr = ddmm[3].length === 2 ? `20${ddmm[3]}` : ddmm[3];
      return `${yr}-${ddmm[2].padStart(2,'0')}-${ddmm[1].padStart(2,'0')}`;
    }
    return v.slice(0, 10);
  };

  return {
    vendor_name:     find('vendorname','vendor','suppliername','supplier','partyname','party'),
    invoice_number:  find('invoicenumber','invoiceno','invoicenum','billnumber','billno','vouchernumber'),
    invoice_date:    parseDate(find('invoicedate','billdate','date','voucherdate','invdate')),
    due_date:        parseDate(find('duedate','paymentduedate','paydue')),
    total_amount:    find('totalamount','amount','total','netamount','invoiceamount','billamount','grossamount').replace(/[,â‚¹\s]/g,''),
    currency:        find('currency','curr','cur') || 'INR',
    description:     find('description','narration','particulars','itemdescription','desc'),
    gl_code:         find('glcode','gl','accountcode','ledgercode','accountno'),
    ifrs_category:   find('ifrscategory','ifrs','category','expensetype','expensecategory'),
    approval_status: find('approvalstatus','status','outcome','approved','approvedrejected'),
    department:      find('department','dept','costcentre','costcenter','division'),
    po_number:       find('ponumber','pono','purchaseorder','po'),
  };
}

// â”€â”€â”€ Excel template (3 sheets) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function downloadExcelTemplate() {
  const wb = XLSX.utils.book_new();

  // Sheet 1 â€” Instructions
  const instructions = [
    ['InvoiceFlow â€” Training Data Template'],
    [''],
    ['INSTRUCTIONS'],
    ['1. Use Sheet 2 (Invoice Template) to paste your historical invoice data'],
    ['2. Required columns: vendor_name, invoice_number, invoice_date, total_amount'],
    ['3. Recommended: 3-5 years of data (minimum 10 invoices)'],
    ['4. More data = smarter anomaly detection'],
    [''],
    ['EXPORTING FROM TALLY'],
    ['Gateway of Tally â†’ Display More Reports â†’ Account Books â†’ Purchase Register'],
    ['Set date range (last 3-5 years)'],
    ['Press Alt+E â†’ Export â†’ Excel'],
    ['Upload that file directly â€” InvoiceFlow maps Tally columns automatically'],
    [''],
    ['DATE FORMAT'],
    ['Accepted formats: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY'],
    [''],
    ['APPROVAL STATUS'],
    ['Use: approved / rejected / pending'],
    [''],
    ['GL CODES (optional â€” system will learn if not provided)'],
    ['6100 = Professional Services'],
    ['6200 = Office Supplies'],
    ['6300 = Marketing & Advertising'],
    ['6400 = Rent & Utilities'],
    ['6500 = Travel Expenses'],
    ['6600 = Cloud Services / Software'],
    ['7000 = Research & Development'],
    ['1500 = Fixed Assets'],
    ['6000 = General Operating Expense'],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(instructions);
  ws1['!cols'] = [{ wch: 60 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Instructions');

  // Sheet 2 â€” Template
  const templateHeaders = [
    'invoice_number', 'invoice_date', 'due_date', 'vendor_name',
    'total_amount', 'currency', 'description', 'gl_code',
    'ifrs_category', 'approval_status', 'department', 'po_number',
  ];
  const ws2 = XLSX.utils.aoa_to_sheet([templateHeaders]);
  ws2['!cols'] = templateHeaders.map(() => ({ wch: 20 }));
  XLSX.utils.book_append_sheet(wb, ws2, 'Invoice Template');

  // Sheet 3 â€” Sample data
  const sample = [
    ['invoice_number','invoice_date','due_date','vendor_name','total_amount','currency','description','gl_code','ifrs_category','approval_status','department','po_number'],
    ['INV-2022-001','2022-04-05','2022-05-05','Tata Consultancy Services','220000','INR','IT Consulting Q1','6100','Operating Expense','approved','IT','PO-101'],
    ['INV-2022-002','2022-04-20','2022-05-20','Amazon Web Services','45000','INR','Cloud hosting April','6600','Operating Expense','approved','IT',''],
    ['INV-2022-003','2022-04-22','2022-05-22','Office Depot','8500','INR','Stationery & supplies','6200','Operating Expense','approved','Admin',''],
    ['INV-2022-004','2022-05-05','2022-06-05','Tata Consultancy Services','215000','INR','IT Consulting Q1 May','6100','Operating Expense','approved','IT','PO-102'],
    ['INV-2022-005','2022-05-15','2022-06-15','DHL Express','12000','INR','Courier charges','6500','Operating Expense','rejected','Logistics',''],
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(sample);
  ws3['!cols'] = sample[0].map(() => ({ wch: 22 }));
  XLSX.utils.book_append_sheet(wb, ws3, 'Sample Data');

  XLSX.writeFile(wb, 'InvoiceFlow_Training_Template.xlsx');
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const fmt = (n: number) =>
  n >= 10000000
    ? `â‚¹${(n / 10000000).toFixed(2)}Cr`
    : n >= 100000
    ? `â‚¹${(n / 100000).toFixed(1)}L`
    : n >= 1000
    ? `â‚¹${(n / 1000).toFixed(1)}K`
    : `â‚¹${n.toLocaleString('en-IN')}`;

function getRisk(p: VendorProfile): 'high' | 'watch' | 'normal' {
  let score = 0;
  if (p.historical_rejection_rate > 0.1) score += 2;
  if (p.is_splitting_vendor) score += 2;
  if (p.price_trend === 'increasing') score += 1;
  return score >= 3 ? 'high' : score >= 1 ? 'watch' : 'normal';
}

function RiskBadge({ profile }: { profile: VendorProfile }) {
  const risk = getRisk(profile);
  if (risk === 'high') return <Badge variant="destructive">High Risk</Badge>;
  if (risk === 'watch') return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">Watch</Badge>;
  return <Badge className="bg-green-100 text-green-800 border-green-300">Normal</Badge>;
}

// â”€â”€â”€ Main Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function TrainingData() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [parsedRows, setParsedRows] = useState<ParsedInvoiceRow[]>([]);
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [showColumnMap, setShowColumnMap] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [intelligence, setIntelligence] = useState<ApIntelligence | null>(null);
  const [vendors, setVendors] = useState<VendorProfile[]>([]);
  const [uploadHistory, setUploadHistory] = useState<TrainingUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<keyof VendorProfile>('mean_amount');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filterRisk, setFilterRisk] = useState<'all' | 'high' | 'watch' | 'normal'>('all');
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null);
  const [showTallyHelp, setShowTallyHelp] = useState(false);

  // Tally direct read state
  const [tallyUrl, setTallyUrl] = useState('http://localhost:9000');
  const [tallyCompany, setTallyCompany] = useState('');
  const [tallyFromDate, setTallyFromDate] = useState('2020-04-01');
  const [tallyToDate, setTallyToDate] = useState(new Date().toISOString().slice(0, 10));
  const [tallyReading, setTallyReading] = useState(false);

  useEffect(() => {
    void (async () => {
      const company = await getMyCompany();
      if (!company) return;
      setCompanyId(company.id);
      await refreshData(company.id);
    })();
  }, []);

  async function refreshData(cid: string) {
    setLoading(true);
    try {
      const [intRes, vpRes, upRes] = await Promise.all([
        supabase.from('ap_intelligence').select('*').eq('company_id', cid).maybeSingle(),
        supabase.from('vendor_profiles').select('*').eq('company_id', cid).order('mean_amount', { ascending: false }),
        supabase.from('training_uploads').select('*').eq('company_id', cid).order('uploaded_at', { ascending: false }).limit(10),
      ]);
      setIntelligence(intRes.data ?? null);
      setVendors((vpRes.data ?? []) as VendorProfile[]);
      setUploadHistory((upRes.data ?? []) as TrainingUpload[]);
    } finally {
      setLoading(false);
    }
  }

  // â”€â”€â”€ File handling â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function parseFile(file: File) {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: false });
        // Use first sheet
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
          defval: '',
          raw: false,
        });
        if (json.length === 0) {
          toast({ title: 'No data found', description: 'The file appears empty or uses unsupported format.', variant: 'destructive' });
          return;
        }
        const headers = Object.keys(json[0] ?? {});
        setRawHeaders(headers);
        const normalised = json.map(normaliseRow).filter((r) => r.vendor_name);
        setParsedRows(normalised);
        // Detect if any required cols might be missing (vendor_name already filtered)
        const missingCrit = normalised.length > 0
          ? REQUIRED_COLS.filter((c) => c.required && !normalised[0][c.key])
          : [];
        if (missingCrit.length > 0) {
          setShowColumnMap(true);
          toast({
            title: `${normalised.length} rows loaded â€” check column mapping`,
            description: `Could not auto-map: ${missingCrit.map((c) => c.label).join(', ')}`,
          });
        } else {
          setShowColumnMap(false);
          toast({ title: `âœ… ${normalised.length} invoices loaded`, description: `${new Set(normalised.map((r) => r.vendor_name)).size} vendors detected. Click "Start Training".` });
        }
      } catch (err) {
        toast({ title: 'Parse error', description: String(err), variant: 'destructive' });
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  }

  async function handleTallyRead() {
    if (!companyId) return;
    setTallyReading(true);
    try {
      const resp = await fetch('/api/tally/read-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          tally_url: tallyUrl,
          tally_company: tallyCompany,
          from_date: tallyFromDate,
          to_date: tallyToDate,
        }),
      });
      const result = await resp.json() as { success?: boolean; error?: string; total_invoices?: number; vendors_profiled?: number; message?: string };
      if (!resp.ok || !result.success) {
        toast({ title: 'Tally read failed', description: result.error || result.message || 'Unknown error', variant: 'destructive' });
      } else {
        toast({
          title: 'ðŸ§  Tally history imported!',
          description: `${result.vendors_profiled} vendor profiles built from ${result.total_invoices} vouchers.`,
        });
        await refreshData(companyId);
      }
    } catch (err) {
      toast({ title: 'Connection error', description: String(err), variant: 'destructive' });
    } finally {
      setTallyReading(false);
    }
  }

  async function handleTrain() {
    if (!companyId || parsedRows.length < 5) {
      toast({ title: 'Need at least 5 invoices', variant: 'destructive' });
      return;
    }
    setUploading(true);
    setUploadProgress(15);
    try {
      const timer = setInterval(() => setUploadProgress((p) => Math.min(p + 5, 75)), 400);
      const resp = await fetch('/api/training/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, invoices: parsedRows, file_name: fileName }),
      });
      clearInterval(timer);
      setUploadProgress(90);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText })) as { error?: string };
        throw new Error(err.error || 'Training failed');
      }
      const result = await resp.json() as {
        vendors_profiled: number;
        gl_mappings_created: number;
        total_invoices: number;
        recurring_vendors?: number;
        splitting_vendors?: number;
        high_rejection?: string[];
      };
      setUploadProgress(100);
      toast({
        title: 'ðŸ§  Model trained successfully!',
        description: `${result.vendors_profiled} vendor profiles built from ${result.total_invoices} invoices.`,
      });
      setParsedRows([]);
      setRawHeaders([]);
      setFileName('');
      setShowColumnMap(false);
      await refreshData(companyId);
    } catch (err) {
      toast({ title: 'Training failed', description: String(err), variant: 'destructive' });
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  // â”€â”€â”€ Vendor table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const sortedVendors = [...vendors]
    .filter((v) => filterRisk === 'all' || getRisk(v) === filterRisk)
    .sort((a, b) => {
      const av = a[sortField] as number | string;
      const bv = b[sortField] as number | string;
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });

  function toggleSort(field: keyof VendorProfile) {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('desc'); }
  }

  const SortIcon = ({ field }: { field: keyof VendorProfile }) =>
    sortField === field
      ? sortDir === 'desc'
        ? <ChevronDown className="h-3 w-3 inline ml-0.5" />
        : <ChevronUp className="h-3 w-3 inline ml-0.5" />
      : null;

  // â”€â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-16">

      {/* â”€â”€ Header â”€â”€ */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Brain className="h-6 w-6 text-indigo-600" />
            AI Training Data
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Upload 3â€“5 years of historical invoices Â· system learns your patterns Â· powers smart anomaly detection
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={downloadExcelTemplate}>
            <Download className="h-4 w-4 mr-1.5" />
            Excel Template
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowTallyHelp((v) => !v)}>
            <HelpCircle className="h-4 w-4 mr-1.5" />
            Export from Tally
          </Button>
          {companyId && (
            <Button variant="outline" size="sm" onClick={() => void refreshData(companyId)}>
              <RefreshCw className="h-4 w-4 mr-1.5" />
              Refresh
            </Button>
          )}
        </div>
      </div>

      {/* â”€â”€ Tally Help Panel â”€â”€ */}
      {showTallyHelp && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-amber-900">
              <BookOpen className="h-4 w-4" />
              How to Export from Tally for Training
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm text-amber-800">
              <li className="flex gap-2"><span className="font-bold shrink-0">Step 1.</span><span>Open Tally â†’ <strong>Gateway of Tally</strong></span></li>
              <li className="flex gap-2"><span className="font-bold shrink-0">Step 2.</span><span><strong>Display More Reports â†’ Account Books â†’ Purchase Register</strong></span></li>
              <li className="flex gap-2"><span className="font-bold shrink-0">Step 3.</span><span>Set date range: <strong>last 3â€“5 years</strong> (e.g. 01-Apr-2020 to 31-Mar-2025)</span></li>
              <li className="flex gap-2"><span className="font-bold shrink-0">Step 4.</span><span>Press <kbd className="bg-amber-200 px-1 rounded text-xs font-mono">Alt+E</kbd> â†’ <strong>Export</strong> â†’ choose <strong>Excel (.xlsx)</strong></span></li>
              <li className="flex gap-2"><span className="font-bold shrink-0">Step 5.</span><span>Upload that file here â€” InvoiceFlow automatically maps Tally column names</span></li>
            </ol>
            <div className="mt-3 rounded-md bg-amber-100 border border-amber-200 px-3 py-2 text-xs text-amber-700">
              ðŸ’¡ <strong>Tip:</strong> Tally exports use "Party Name" for vendor, "Voucher Date" for invoice date, and "Net Amount" for total â€” all are mapped automatically.
            </div>
          </CardContent>
        </Card>
      )}

      {/* â”€â”€ SECTION 1: Training Status Cards â”€â”€ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className={intelligence?.is_trained ? 'border-green-300 bg-green-50' : 'border-orange-200 bg-orange-50'}>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-1">
              {intelligence?.is_trained
                ? <CheckCircle2 className="h-5 w-5 text-green-600" />
                : <XCircle className="h-5 w-5 text-orange-400" />}
              <span className="text-sm font-semibold text-gray-700">Training Status</span>
            </div>
            <p className={`text-lg font-bold ${intelligence?.is_trained ? 'text-green-700' : 'text-orange-500'}`}>
              {intelligence?.is_trained ? 'Trained âœ“' : 'Not Trained'}
            </p>
            {intelligence?.last_trained_at
              ? <p className="text-xs text-gray-500 mt-0.5">Last: {new Date(intelligence.last_trained_at).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}</p>
              : <p className="text-xs text-gray-400 mt-0.5">Upload historical data to begin</p>}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-sm font-medium text-gray-500 mb-1">Invoices Trained</p>
            <p className="text-2xl font-bold text-gray-900">
              {(intelligence?.training_invoice_count ?? 0).toLocaleString('en-IN')}
            </p>
            {intelligence?.training_date_from && (
              <p className="text-xs text-gray-400 mt-0.5">
                {intelligence.training_date_from} â†’ {intelligence.training_date_to}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-sm font-medium text-gray-500 mb-1">Vendor Profiles</p>
            <p className="text-2xl font-bold text-gray-900">{vendors.length}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {vendors.filter((v) => v.is_recurring).length} recurring Â·{' '}
              {vendors.filter((v) => v.is_splitting_vendor).length} splitting risk Â·{' '}
              {vendors.filter((v) => getRisk(v) === 'high').length} high risk
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-sm font-medium text-gray-500 mb-1">Avg Invoice Amount</p>
            <p className="text-2xl font-bold text-gray-900">
              {intelligence ? fmt(intelligence.avg_invoice_amount) : 'â€”'}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {intelligence ? `${intelligence.avg_invoices_per_month?.toFixed(1) ?? 'â€”'}/month avg` : 'No data yet'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* â”€â”€ SECTION 1b: Read from Tally Directly â”€â”€ */}
      <Card className="border-blue-200 bg-blue-50/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="h-4 w-4 text-blue-600" />
            Read History Directly from TallyPrime
            <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs">Live ERP</Badge>
          </CardTitle>
          <CardDescription>
            No manual export needed â€” InvoiceFlow reads all purchase vouchers directly from TallyPrime via HTTP port 9000.
            Requires TallyPrime running with HTTP server enabled.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-600">TallyPrime URL</label>
              <input
                type="text"
                value={tallyUrl}
                onChange={(e) => setTallyUrl(e.target.value)}
                placeholder="http://localhost:9000"
                className="w-full text-sm border rounded-md px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-600">Company Name in Tally (exact)</label>
              <input
                type="text"
                value={tallyCompany}
                onChange={(e) => setTallyCompany(e.target.value)}
                placeholder="e.g. GnanovaPro Demo Pvt Ltd"
                className="w-full text-sm border rounded-md px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-600">From Date</label>
              <input
                type="date"
                value={tallyFromDate}
                onChange={(e) => setTallyFromDate(e.target.value)}
                className="w-full text-sm border rounded-md px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-600">To Date</label>
              <input
                type="date"
                value={tallyToDate}
                onChange={(e) => setTallyToDate(e.target.value)}
                className="w-full text-sm border rounded-md px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              onClick={() => void handleTallyRead()}
              disabled={tallyReading}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {tallyReading
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Reading from Tallyâ€¦</>
                : <><Brain className="h-4 w-4 mr-2" />Read from TallyPrime</>}
            </Button>
            <p className="text-xs text-gray-500">
              Reads all Purchase vouchers from the date range Â· auto-builds vendor profiles
            </p>
          </div>
          <div className="rounded-md bg-blue-100 border border-blue-200 px-3 py-2 text-xs text-blue-700">
            <strong>Enable in TallyPrime:</strong> Gateway of Tally â†’ F12 â†’ Configure â†’ Advanced Configuration â†’ Enable HTTP Server â†’ Port: 9000
          </div>
        </CardContent>
      </Card>

      {/* â”€â”€ SECTION 2: Upload â”€â”€ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-indigo-500" />
            Upload Historical Invoice Data
          </CardTitle>
          <CardDescription>
            Accepts Excel (.xlsx) and CSV Â· columns auto-mapped from Tally, QuickBooks, or any format Â·
            minimum 5 invoices, recommended 500+
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Expected columns */}
          <div className="rounded-lg bg-gray-50 border px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Expected columns</p>
            <div className="flex flex-wrap gap-1.5">
              {REQUIRED_COLS.map((c) => (
                <span
                  key={c.key}
                  className={`text-[11px] px-2 py-0.5 rounded-full font-medium border ${
                    c.required
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                      : 'bg-gray-100 text-gray-500 border-gray-200'
                  }`}
                >
                  {c.label}{c.required ? ' *' : ''}
                </span>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5">* required Â· all others optional but improve accuracy</p>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-all ${
              isDragging
                ? 'border-indigo-500 bg-indigo-50 scale-[1.01]'
                : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
            }`}
          >
            <Upload className="mx-auto h-9 w-9 text-gray-300 mb-2" />
            <p className="text-sm font-semibold text-gray-700">
              {fileName ? `ðŸ“„ ${fileName}` : 'Drop Excel or CSV here, or click to browse'}
            </p>
            <p className="text-xs text-gray-400 mt-1">Supports .xlsx Â· .xls Â· .csv Â· Tally export files</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFile(f); e.target.value = ''; }}
            />
          </div>

          {/* Column mapping hint */}
          {showColumnMap && rawHeaders.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-800 mb-2 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" />
                Column Mapping â€” Headers detected in your file:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {rawHeaders.map((h) => (
                  <span key={h} className="text-xs bg-white border border-amber-200 text-amber-700 px-2 py-0.5 rounded font-mono">{h}</span>
                ))}
              </div>
              <p className="text-xs text-amber-600 mt-2">
                InvoiceFlow has auto-mapped these columns. If the preview below looks wrong, check that your file
                has the vendor name, invoice date, and total amount columns.
              </p>
            </div>
          )}

          {/* Preview table */}
          {parsedRows.length > 0 && (
            <div className="rounded-lg border overflow-hidden">
              <div className="bg-indigo-50 px-4 py-2 border-b flex items-center justify-between">
                <span className="text-xs font-semibold text-indigo-700">
                  Preview â€” {parsedRows.length.toLocaleString('en-IN')} invoices Â·{' '}
                  {new Set(parsedRows.map((r) => r.vendor_name)).size} vendors
                </span>
                <Badge variant="outline" className="text-xs">
                  First 5 of {parsedRows.length}
                </Badge>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      {['vendor_name','invoice_number','invoice_date','total_amount','gl_code','approval_status'].map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, 5).map((row, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
                        <td className="px-3 py-1.5 font-medium text-gray-900 max-w-[160px] truncate">{String(row.vendor_name ?? '')}</td>
                        <td className="px-3 py-1.5 text-gray-500 font-mono text-[11px]">{String(row.invoice_number ?? '')}</td>
                        <td className="px-3 py-1.5 text-gray-600">{String(row.invoice_date ?? '')}</td>
                        <td className="px-3 py-1.5 text-gray-900 font-medium">
                          â‚¹{Number(String(row.total_amount || 0).replace(/[^0-9.]/g, '')).toLocaleString('en-IN')}
                        </td>
                        <td className="px-3 py-1.5 text-gray-500 font-mono text-[11px]">{String(row.gl_code ?? 'â€”')}</td>
                        <td className="px-3 py-1.5">
                          {row.approval_status ? (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              /reject/i.test(String(row.approval_status))
                                ? 'bg-red-100 text-red-700'
                                : 'bg-green-100 text-green-700'
                            }`}>
                              {String(row.approval_status)}
                            </span>
                          ) : <span className="text-gray-300">â€”</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Train button */}
          {parsedRows.length > 0 && (
            <div className="flex items-center gap-4 flex-wrap">
              <Button
                onClick={() => void handleTrain()}
                disabled={uploading || parsedRows.length < 5}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
                size="lg"
              >
                {uploading
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Trainingâ€¦</>
                  : <><Brain className="h-4 w-4 mr-2" /> Start Training ({parsedRows.length.toLocaleString('en-IN')} invoices)</>}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setParsedRows([]); setFileName(''); setRawHeaders([]); }}>
                Clear
              </Button>
              {parsedRows.length < 5 && (
                <p className="text-xs text-orange-600 font-medium">Minimum 5 invoices required</p>
              )}
            </div>
          )}

          {uploading && (
            <div className="space-y-1.5">
              <Progress value={uploadProgress} className="h-2.5" />
              <p className="text-xs text-gray-500">
                {uploadProgress < 30 ? 'Parsing invoicesâ€¦' :
                 uploadProgress < 60 ? 'Computing vendor statisticsâ€¦' :
                 uploadProgress < 85 ? 'Building anomaly baselinesâ€¦' :
                 'Saving profiles to databaseâ€¦'}
              </p>
            </div>
          )}

          {/* Upload history */}
          {uploadHistory.length > 0 && (
            <div className="pt-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Recent uploads</p>
              <div className="space-y-1.5">
                {uploadHistory.map((u) => (
                  <div key={u.id} className="flex items-center gap-3 text-xs rounded-lg border px-3 py-2 bg-gray-50">
                    {u.status === 'completed'
                      ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                      : u.status === 'failed'
                      ? <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                      : <Loader2 className="h-4 w-4 text-gray-400 animate-spin shrink-0" />}
                    <span className="flex-1 truncate font-medium text-gray-700">{u.file_name}</span>
                    <span className="text-gray-400">{u.rows_processed?.toLocaleString('en-IN')} rows</span>
                    <span className="text-gray-400">{u.vendors_profiled} vendors</span>
                    <span className="text-gray-400">{new Date(u.uploaded_at).toLocaleDateString('en-IN')}</span>
                    <Badge
                      variant={u.status === 'completed' ? 'outline' : 'destructive'}
                      className="text-[10px]"
                    >
                      {u.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* â”€â”€ SECTION 3: Vendor Profiles Table â”€â”€ */}
      {vendors.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <CardTitle className="text-base">Vendor Profiles</CardTitle>
                <CardDescription>What the system learned from your history Â· click row for anomaly thresholds</CardDescription>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {(['all', 'high', 'watch', 'normal'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setFilterRisk(r)}
                    className={`text-xs px-3 py-1 rounded-full border transition-colors font-medium ${
                      filterRisk === r
                        ? r === 'high' ? 'bg-red-600 text-white border-red-600'
                          : r === 'watch' ? 'bg-yellow-500 text-white border-yellow-500'
                          : r === 'normal' ? 'bg-green-600 text-white border-green-600'
                          : 'bg-gray-900 text-white border-gray-900'
                        : 'bg-white text-gray-600 hover:bg-gray-50 border-gray-200'
                    }`}
                  >
                    {r === 'all'    ? `All (${vendors.length})`
                     : r === 'high'   ? `High (${vendors.filter((v) => getRisk(v) === 'high').length})`
                     : r === 'watch'  ? `Watch (${vendors.filter((v) => getRisk(v) === 'watch').length})`
                     : `Normal (${vendors.filter((v) => getRisk(v) === 'normal').length})`}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50 hover:bg-gray-50">
                      <TableHead className="w-[200px]">Vendor</TableHead>
                      <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort('mean_amount')}>
                        Avg Amount <SortIcon field="mean_amount" />
                      </TableHead>
                      <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort('std_deviation')}>
                        Std Dev <SortIcon field="std_deviation" />
                      </TableHead>
                      <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort('avg_invoices_per_month')}>
                        /Month <SortIcon field="avg_invoices_per_month" />
                      </TableHead>
                      <TableHead>GL</TableHead>
                      <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort('historical_rejection_rate')}>
                        Rejection <SortIcon field="historical_rejection_rate" />
                      </TableHead>
                      <TableHead>Trend</TableHead>
                      <TableHead>Tags</TableHead>
                      <TableHead>Risk</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedVendors.map((v) => (
                      <>
                        <TableRow
                          key={v.id}
                          className={`cursor-pointer transition-colors ${
                            getRisk(v) === 'high' ? 'hover:bg-red-50'
                            : getRisk(v) === 'watch' ? 'hover:bg-yellow-50/50'
                            : 'hover:bg-indigo-50/40'
                          }`}
                          onClick={() => setExpandedVendor(expandedVendor === v.id ? null : v.id)}
                        >
                          <TableCell className="font-medium">
                            <div className="max-w-[190px] truncate text-gray-900" title={v.vendor_name}>{v.vendor_name}</div>
                            <div className="text-[10px] text-gray-400">{v.training_invoice_count} invoices</div>
                          </TableCell>
                          <TableCell className="font-semibold tabular-nums">{fmt(v.mean_amount)}</TableCell>
                          <TableCell className="text-gray-500 tabular-nums">{fmt(v.std_deviation)}</TableCell>
                          <TableCell className="text-gray-600 tabular-nums">{v.avg_invoices_per_month?.toFixed(1)}</TableCell>
                          <TableCell>
                            <span className="font-mono text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
                              {v.typical_gl_code || 'â€”'}
                            </span>
                          </TableCell>
                          <TableCell>
                            {v.historical_rejection_rate > 0 ? (
                              <span className={`text-xs font-semibold ${v.historical_rejection_rate > 0.1 ? 'text-red-600' : 'text-gray-600'}`}>
                                {(v.historical_rejection_rate * 100).toFixed(0)}%
                              </span>
                            ) : <span className="text-xs text-gray-300">0%</span>}
                          </TableCell>
                          <TableCell>
                            {v.price_trend === 'increasing'
                              ? <span className="flex items-center gap-0.5 text-red-500 text-xs font-medium"><TrendingUp className="h-3 w-3" />+{v.price_trend_pct?.toFixed(0)}%</span>
                              : v.price_trend === 'decreasing'
                              ? <span className="flex items-center gap-0.5 text-blue-500 text-xs font-medium"><TrendingDown className="h-3 w-3" />{v.price_trend_pct?.toFixed(0)}%</span>
                              : <span className="text-xs text-gray-400">stable</span>}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1 flex-wrap min-w-[80px]">
                              {v.is_recurring && (
                                <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full whitespace-nowrap">Recurring</span>
                              )}
                              {v.is_splitting_vendor && (
                                <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 whitespace-nowrap">
                                  <AlertTriangle className="h-2.5 w-2.5" />Splitting
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell><RiskBadge profile={v} /></TableCell>
                        </TableRow>

                        {/* â”€â”€ SECTION 4: Expanded Anomaly Rules â”€â”€ */}
                        {expandedVendor === v.id && (
                          <TableRow key={`${v.id}-exp`} className="bg-indigo-50/50">
                            <TableCell colSpan={9} className="py-4 px-6">
                              <p className="text-xs font-semibold text-indigo-700 mb-3 flex items-center gap-1.5">
                                <Brain className="h-3.5 w-3.5" />
                                Anomaly thresholds for <span className="font-bold">{v.vendor_name}</span> â€” trained on {v.training_invoice_count} invoices
                              </p>
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                                {/* Auto-approve */}
                                <div className="rounded-lg bg-green-50 border border-green-200 p-3">
                                  <p className="font-bold text-green-700 mb-1">âœ… Auto-approve range</p>
                                  <p className="text-green-900 font-semibold text-sm">
                                    {fmt(Math.max(0, v.mean_amount - 2 * v.std_deviation))} â€“ {fmt(v.mean_amount + 2 * v.std_deviation)}
                                  </p>
                                  <p className="text-green-600 mt-0.5">Within Â±2Ïƒ of avg {fmt(v.mean_amount)}</p>
                                </div>
                                {/* Review */}
                                <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-3">
                                  <p className="font-bold text-yellow-700 mb-1">âš ï¸ Review range</p>
                                  <p className="text-yellow-900 font-semibold text-sm">
                                    {fmt(Math.max(0, v.mean_amount - 3 * v.std_deviation))} â€“ {fmt(v.mean_amount + 3 * v.std_deviation)}
                                  </p>
                                  <p className="text-yellow-600 mt-0.5">Between 2Ïƒâ€“3Ïƒ (unusual)</p>
                                </div>
                                {/* Hold */}
                                <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                                  <p className="font-bold text-red-700 mb-1">ðŸš« Hold / Escalate</p>
                                  <p className="text-red-900 font-semibold text-sm">
                                    Below {fmt(Math.max(0, v.mean_amount - 3 * v.std_deviation))} or above {fmt(v.mean_amount + 3 * v.std_deviation)}
                                  </p>
                                  <p className="text-red-600 mt-0.5">Beyond 3Ïƒ â€” extreme anomaly</p>
                                </div>
                              </div>
                              {/* Additional stats */}
                              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-gray-600">
                                <div><span className="font-medium text-gray-700">Seen range:</span> {fmt(v.min_amount)} â€“ {fmt(v.max_amount)}</div>
                                <div><span className="font-medium text-gray-700">Median:</span> {fmt(v.median_amount)}</div>
                                <div><span className="font-medium text-gray-700">IFRS:</span> {v.typical_ifrs_category || 'â€”'}</div>
                                <div><span className="font-medium text-gray-700">Period:</span> {v.training_date_from} â†’ {v.training_date_to}</div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* â”€â”€ Anomaly Rules Active Summary â”€â”€ */}
      {vendors.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              Active Anomaly Detection Rules
            </CardTitle>
            <CardDescription>These rules run automatically on every new invoice submission</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                {
                  icon: 'ðŸ“Š', title: 'Z-Score Amount Check', active: true, color: 'blue',
                  desc: 'Flags invoices >3Ïƒ above vendor average. Extreme alert at >5Ïƒ. Client-specific, not generic.',
                },
                {
                  icon: 'ðŸ”', title: 'Recurring Vendor Deviation', active: vendors.some((v) => v.is_recurring), color: 'indigo',
                  desc: `${vendors.filter((v) => v.is_recurring).length} recurring vendors profiled. Any amount >10% deviation is flagged.`,
                },
                {
                  icon: 'âœ‚ï¸', title: 'Invoice Splitting Detection', active: vendors.some((v) => v.is_splitting_vendor), color: 'red',
                  desc: `${vendors.filter((v) => v.is_splitting_vendor).length} vendors historically split invoices. New submissions checked against this pattern.`,
                },
                {
                  icon: 'ðŸ“ˆ', title: 'Price Drift Alert', active: vendors.some((v) => v.price_trend === 'increasing'), color: 'orange',
                  desc: `${vendors.filter((v) => v.price_trend === 'increasing').length} vendors showing consistent price increases (Mann-Kendall test).`,
                },
                {
                  icon: 'ðŸš«', title: 'High Rejection Rate', active: vendors.some((v) => v.historical_rejection_rate > 0.1), color: 'red',
                  desc: `${vendors.filter((v) => v.historical_rejection_rate > 0.1).length} vendors with >10% historical rejections â€” auto-flagged on entry.`,
                },
                {
                  icon: 'ðŸ†•', title: 'New Vendor Detection', active: true, color: 'yellow',
                  desc: 'Any vendor not in training data is flagged as first-time. Risk score +10. KYC recommended.',
                },
              ].map((rule) => (
                <div
                  key={rule.title}
                  className={`rounded-lg border p-4 transition-opacity ${rule.active ? 'bg-white' : 'bg-gray-50 opacity-50'}`}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-xl mt-0.5">{rule.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <p className="text-sm font-semibold text-gray-800">{rule.title}</p>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          rule.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {rule.active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 leading-relaxed">{rule.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* â”€â”€ Empty state â”€â”€ */}
      {!loading && vendors.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <Brain className="h-14 w-14 mx-auto mb-3 text-gray-200" />
          <p className="font-semibold text-gray-500 text-lg">No training data yet</p>
          <p className="text-sm mt-1 text-gray-400">
            Upload historical invoices above to train the AI model.<br />
            Recommended: 3â€“5 years of data for best accuracy.
          </p>
          <div className="flex gap-3 justify-center mt-5">
            <Button variant="outline" onClick={downloadExcelTemplate}>
              <Download className="h-4 w-4 mr-2" />
              Download Excel Template
            </Button>
            <Button variant="outline" onClick={() => setShowTallyHelp(true)}>
              <HelpCircle className="h-4 w-4 mr-2" />
              Export from Tally
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

