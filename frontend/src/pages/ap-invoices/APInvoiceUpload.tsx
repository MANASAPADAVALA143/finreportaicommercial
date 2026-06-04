/**
 * APInvoiceUpload.tsx â€” Full InvoiceFlow Upload page with GulfTax AI integration.
 *
 * Tabs: Scan Invoice | Single Upload | Bulk Excel
 *
 * GulfTax 3-step flow (Scan + Single tabs):
 *   Step 1 â€” Upload & Extract (AI extraction from image/form)
 *   Step 2 â€” GulfTax Classify (UAE VAT treatment, risk score, decision)
 *   Step 3 â€” Review & Post (confirm â†’ save invoice + optional JE post)
 *
 * Decisions from GulfTax bridge:
 *   AUTO_APPROVE  (risk < 35)  â†’ green  â†’ straight to GL
 *   REVIEW_QUEUE  (35â€“69)      â†’ amber  â†’ CFO approval queue
 *   HARD_BLOCK    (â‰¥ 70 / bad TRN) â†’ red â†’ blocked, must resolve
 */
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Camera, Upload, FileSpreadsheet, Plus, Trash2, CheckCircle,
  AlertCircle, Loader2, ShieldCheck, ShieldAlert, ShieldX,
  ArrowLeft, BookOpen, Zap,
} from 'lucide-react';
import { apSupabase, apAgentUrl } from '../../lib/apSupabase';
import * as XLSX from 'xlsx';

// â”€â”€ Shared types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type Tab = 'scan' | 'single' | 'bulk';

const inputCls = 'w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm placeholder:text-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30';
const labelCls = 'block text-xs font-medium text-gray-400 mb-1';
const CURRENCIES = ['AED', 'USD', 'EUR', 'GBP', 'INR', 'SAR', 'QAR', 'KWD'];
const TAX_TYPES  = ['None', 'VAT', 'GST', 'Sales Tax', 'Withholding Tax'];

type LineItem = { description: string; quantity: number; unit_price: number; total: number };
const emptyLine = (): LineItem => ({ description: '', quantity: 1, unit_price: 0, total: 0 });

type ExtractionResult = {
  invoice_number?: string;
  vendor_name?: string;
  invoice_date?: string;
  due_date?: string;
  total_amount?: number;
  tax_amount?: number;
  currency?: string;
  line_items?: LineItem[];
  ifrs_category?: string;
  ifrs_confidence?: number;
};

// â”€â”€ GulfTax types & helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type GulfTaxDecision = 'AUTO_APPROVE' | 'REVIEW_QUEUE' | 'HARD_BLOCK';

type GulfTaxResult = {
  vat_treatment: string;
  vat_rate: number;
  vat_amount_aed: number;
  confidence_score: number;
  reasoning: string;
  flag_for_review: boolean;
  blocked_input_vat: boolean;
  blocked_reason: string;
  blocked_vat_amount: number;
  uae_law_sources: string[];
  risk_score: number;
  decision: GulfTaxDecision;
  trn_valid: boolean;
};

type JELine = { account: string; account_name: string; debit: number; credit: number; description: string };
type PostResult = { ok: boolean; je_reference: string; post_date: string; je_lines: JELine[]; message: string };

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8001';

async function classifyWithGulfTax(params: {
  invoice_number: string;
  vendor_name: string;
  total_amount: number;
  invoice_date: string;
  description?: string;
  trn_number?: string;
}): Promise<GulfTaxResult> {
  const res = await fetch(`${API}/api/uae/ap/classify-invoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      invoice_number: params.invoice_number,
      vendor_name:    params.vendor_name,
      total_amount:   params.total_amount,
      invoice_date:   params.invoice_date || new Date().toISOString().slice(0, 10),
      description:    params.description || '',
      trn_number:     params.trn_number || '',
      entity_type:    'mainland',
      company_id:     'default',
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `GulfTax returned ${res.status}`);
  }
  return res.json();
}

async function approveAndPost(params: {
  invoice_number: string;
  vendor_name: string;
  total_amount: number;
  vat_amount_aed: number;
  vat_treatment: string;
  decision: GulfTaxDecision;
  risk_score: number;
  invoice_date: string;
}): Promise<PostResult> {
  const res = await fetch(`${API}/api/uae/ap/approve-and-post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Post failed ${res.status}`);
  }
  return res.json();
}

// â”€â”€ GulfTax classification panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const DECISION_STYLE: Record<GulfTaxDecision, { bg: string; border: string; text: string; icon: typeof ShieldCheck; label: string }> = {
  AUTO_APPROVE: {
    bg: 'bg-green-900/20', border: 'border-green-700/40', text: 'text-green-400',
    icon: ShieldCheck, label: 'AUTO APPROVE',
  },
  REVIEW_QUEUE: {
    bg: 'bg-amber-900/20', border: 'border-amber-700/40', text: 'text-amber-400',
    icon: ShieldAlert, label: 'REVIEW QUEUE',
  },
  HARD_BLOCK: {
    bg: 'bg-red-900/20', border: 'border-red-700/40', text: 'text-red-400',
    icon: ShieldX, label: 'HARD BLOCK',
  },
};

function RiskMeter({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color = pct < 35 ? '#22c55e' : pct < 70 ? '#f59e0b' : '#ef4444';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">Risk Score</span>
        <span className="font-bold" style={{ color }}>{pct.toFixed(0)} / 100</span>
      </div>
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <div className="flex justify-between text-[10px] text-gray-600">
        <span>0 â€” Safe</span><span>35 â€” Review</span><span>70 â€” Block</span>
      </div>
    </div>
  );
}

function GulfTaxPanel({
  result,
  invoiceNumber,
  vendorName,
  totalAmount,
  invoiceDate,
  onConfirm,
  onBlock,
  onBack,
}: {
  result: GulfTaxResult;
  invoiceNumber: string;
  vendorName: string;
  totalAmount: number;
  invoiceDate: string;
  onConfirm: (postResult?: PostResult) => void;
  onBlock: () => void;
  onBack: () => void;
}) {
  const [acting, setActing] = useState(false);
  const [postErr, setPostErr] = useState('');
  const ds = DECISION_STYLE[result.decision];
  const DecIcon = ds.icon;

  const handleConfirm = async () => {
    setActing(true); setPostErr('');
    try {
      if (result.decision === 'AUTO_APPROVE') {
        const postResult = await approveAndPost({
          invoice_number: invoiceNumber,
          vendor_name:    vendorName,
          total_amount:   totalAmount,
          vat_amount_aed: result.vat_amount_aed,
          vat_treatment:  result.vat_treatment,
          decision:       result.decision,
          risk_score:     result.risk_score,
          invoice_date:   invoiceDate,
        });
        onConfirm(postResult);
      } else {
        // REVIEW_QUEUE â€” save without JE posting
        onConfirm(undefined);
      }
    } catch (e: any) {
      setPostErr(e.message);
    } finally {
      setActing(false);
    }
  };

  return (
    <div className={`${ds.bg} border ${ds.border} rounded-xl p-5 space-y-4`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <DecIcon size={20} className={ds.text} />
          <div>
            <p className="text-xs text-gray-400">GulfTax AI Decision</p>
            <p className={`font-bold text-sm ${ds.text}`}>{ds.label}</p>
          </div>
        </div>
        <button onClick={onBack} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300">
          <ArrowLeft size={12} /> Back
        </button>
      </div>

      {/* Risk meter */}
      <RiskMeter score={result.risk_score} />

      {/* VAT classification grid */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {[
          ['VAT Treatment',  result.vat_treatment.replace(/_/g, ' ')],
          ['VAT Rate',       `${result.vat_rate}%`],
          ['VAT Amount',     `AED ${result.vat_amount_aed.toLocaleString()}`],
          ['Confidence',     `${(result.confidence_score * 100).toFixed(0)}%`],
          ['TRN Valid',      result.trn_valid ? 'âœ“ Valid' : 'âœ— Missing / Invalid'],
          ['Art. 54 Block',  result.blocked_input_vat ? `AED ${result.blocked_vat_amount} blocked` : 'None'],
        ].map(([k, v]) => (
          <div key={k} className="bg-gray-900/50 rounded-lg px-3 py-2">
            <p className="text-gray-500 mb-0.5">{k}</p>
            <p className={`font-medium ${k === 'TRN Valid' && !result.trn_valid ? 'text-red-400' : k === 'Art. 54 Block' && result.blocked_input_vat ? 'text-amber-400' : 'text-white'}`}>{v}</p>
          </div>
        ))}
      </div>

      {/* Reasoning */}
      {result.reasoning && (
        <div className="bg-gray-900/50 rounded-lg p-3">
          <p className="text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Reasoning</p>
          <p className="text-xs text-gray-300 leading-relaxed">{result.reasoning}</p>
        </div>
      )}

      {/* Art 54 block detail */}
      {result.blocked_input_vat && result.blocked_reason && (
        <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-3">
          <p className="text-xs text-amber-300 font-medium mb-1">Art. 54 â€” Input VAT Blocked</p>
          <p className="text-xs text-gray-400">{result.blocked_reason}</p>
          <p className="text-xs text-gray-500 mt-1">AED {result.blocked_vat_amount.toLocaleString()} will be expensed (non-recoverable).</p>
        </div>
      )}

      {/* UAE Law Sources */}
      {result.uae_law_sources?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {result.uae_law_sources.map(s => (
            <span key={s} className="flex items-center gap-1 text-[10px] bg-gray-700/50 text-gray-400 px-2 py-0.5 rounded-full">
              <BookOpen size={9} /> {s}
            </span>
          ))}
        </div>
      )}

      {postErr && (
        <div className="bg-red-900/30 border border-red-700/40 rounded-lg p-3 text-xs text-red-300 flex items-start gap-2">
          <AlertCircle size={12} className="mt-0.5 shrink-0" /> {postErr}
        </div>
      )}

      {/* Action buttons */}
      {result.decision === 'AUTO_APPROVE' && (
        <button onClick={handleConfirm} disabled={acting}
          className="w-full flex items-center justify-center gap-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white py-3 rounded-xl text-sm font-medium">
          {acting ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
          {acting ? 'Posting to GLâ€¦' : 'Confirm & Post to UAE GL'}
        </button>
      )}

      {result.decision === 'REVIEW_QUEUE' && (
        <div className="space-y-2">
          <button onClick={handleConfirm} disabled={acting}
            className="w-full flex items-center justify-center gap-2 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white py-3 rounded-xl text-sm font-medium">
            {acting ? <Loader2 size={15} className="animate-spin" /> : <ShieldAlert size={15} />}
            {acting ? 'Sendingâ€¦' : 'Send to CFO Review Queue'}
          </button>
          <p className="text-center text-xs text-gray-500">Invoice will be saved with <strong className="text-amber-400">Pending Approval</strong> status</p>
        </div>
      )}

      {result.decision === 'HARD_BLOCK' && (
        <div className="space-y-3">
          <div className="bg-red-900/30 border border-red-700/40 rounded-xl p-4 text-center">
            <ShieldX size={24} className="text-red-400 mx-auto mb-2" />
            <p className="text-sm text-red-300 font-medium">Invoice Blocked</p>
            <p className="text-xs text-gray-400 mt-1">
              {!result.trn_valid ? 'Vendor TRN is missing or invalid.' : result.blocked_reason || 'Risk score too high for automatic processing.'}
            </p>
          </div>
          <button onClick={onBlock}
            className="w-full bg-gray-700 hover:bg-gray-600 text-gray-300 py-2.5 rounded-xl text-sm">
            Save to Review Queue Anyway
          </button>
        </div>
      )}
    </div>
  );
}

// â”€â”€ JE Posted confirmation panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function JEPostedPanel({ result, onDone }: { result: PostResult; onDone: () => void }) {
  return (
    <div className="bg-green-900/20 border border-green-700/40 rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-3">
        <CheckCircle size={22} className="text-green-400 shrink-0" />
        <div>
          <p className="text-green-400 font-semibold">{result.message}</p>
          <p className="text-xs text-gray-400 mt-0.5">JE Reference: <span className="text-white font-mono">{result.je_reference}</span> Â· Post date: {result.post_date}</p>
        </div>
      </div>

      {/* JE Lines */}
      <div className="bg-gray-900/60 rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-700 text-[10px] text-gray-500 uppercase tracking-wider font-medium">Journal Entry Lines</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-700 text-gray-500">
              <th className="px-3 py-2 text-left font-normal">Account</th>
              <th className="px-3 py-2 text-left font-normal">Name</th>
              <th className="px-3 py-2 text-right font-normal">DR</th>
              <th className="px-3 py-2 text-right font-normal">CR</th>
            </tr>
          </thead>
          <tbody>
            {result.je_lines.map((l, i) => (
              <tr key={i} className="border-b border-gray-700/50">
                <td className="px-3 py-2 font-mono text-gray-400">{l.account}</td>
                <td className="px-3 py-2 text-gray-300">{l.account_name}</td>
                <td className="px-3 py-2 text-right text-green-400">{l.debit > 0 ? l.debit.toLocaleString() : ''}</td>
                <td className="px-3 py-2 text-right text-red-400">{l.credit > 0 ? l.credit.toLocaleString() : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button onClick={onDone} className="w-full bg-green-700 hover:bg-green-600 text-white py-2.5 rounded-xl text-sm font-medium">
        Done â€” Go to Invoice List
      </button>
    </div>
  );
}

// â”€â”€ Step indicator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const STEPS = ['Upload & Extract', 'GulfTax Classify', 'Review & Post'];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-6">
      {STEPS.map((s, i) => {
        const done   = i < current;
        const active = i === current;
        return (
          <div key={s} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all
                ${done   ? 'bg-green-700 border-green-600 text-white'
                : active ? 'bg-blue-700 border-blue-500 text-white'
                :          'bg-gray-800 border-gray-700 text-gray-500'}`}>
                {done ? <CheckCircle size={14} /> : i + 1}
              </div>
              <span className={`text-[10px] mt-1 whitespace-nowrap ${active ? 'text-blue-400' : done ? 'text-green-400' : 'text-gray-600'}`}>{s}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 mb-4 transition-all ${done ? 'bg-green-700' : 'bg-gray-700'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// â”€â”€ Scan Invoice tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ScanTab() {
  const navigate = useNavigate();
  const fileRef  = useRef<HTMLInputElement>(null);

  const [step, setStep]           = useState<0 | 1 | 2>(0);
  const [file, setFile]           = useState<File | null>(null);
  const [preview, setPreview]     = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<ExtractionResult | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [gulfTax, setGulfTax]     = useState<GulfTaxResult | null>(null);
  const [postResult, setPostResult] = useState<PostResult | null>(null);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  const handleFile = (f: File) => {
    setFile(f); setExtracted(null); setGulfTax(null); setError(''); setStep(0);
    if (f.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = e => setPreview(e.target?.result as string);
      reader.readAsDataURL(f);
    } else setPreview(null);
  };

  const handleExtract = async () => {
    if (!file) return;
    setExtracting(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(apAgentUrl('/api/agent/extract-image'), { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`Extraction failed (${res.status})`);
      const data = await res.json();
      setExtracted(data?.result || data);
    } catch (e: any) { setError(e.message); }
    finally { setExtracting(false); }
  };

  const handleClassify = async () => {
    if (!extracted) return;
    setClassifying(true); setError('');
    try {
      const result = await classifyWithGulfTax({
        invoice_number: extracted.invoice_number || `SCAN-${Date.now()}`,
        vendor_name:    extracted.vendor_name || 'Unknown Vendor',
        total_amount:   extracted.total_amount || 0,
        invoice_date:   extracted.invoice_date || new Date().toISOString().slice(0, 10),
        description:    extracted.ifrs_category,
      });
      setGulfTax(result);
      setStep(1);
    } catch (e: any) { setError(e.message); }
    finally { setClassifying(false); }
  };

  const saveInvoice = async (approvalStatus: string) => {
    setSaving(true); setError('');
    try {
      const { error: err } = await apSupabase.from('invoices').insert({
        invoice_number:  extracted?.invoice_number || `SCAN-${Date.now()}`,
        vendor_name:     extracted?.vendor_name || 'Unknown Vendor',
        invoice_date:    extracted?.invoice_date || null,
        due_date:        extracted?.due_date || null,
        total_amount:    extracted?.total_amount || 0,
        tax_amount:      extracted?.tax_amount ?? gulfTax?.vat_amount_aed ?? null,
        currency:        extracted?.currency || 'AED',
        ifrs_category:   extracted?.ifrs_category || null,
        ifrs_confidence: extracted?.ifrs_confidence || null,
        status:          approvalStatus === 'approved' ? 'Approved' : 'Processing',
        approval_status: approvalStatus,
        source:          'scan',
        created_at:      new Date().toISOString(),
      });
      if (err) throw err;
    } catch (e: any) { throw e; }
    finally { setSaving(false); }
  };

  const handleGulfTaxConfirm = async (jeResult?: PostResult) => {
    try {
      const approvalStatus = gulfTax?.decision === 'AUTO_APPROVE' ? 'approved' : 'pending';
      await saveInvoice(approvalStatus);
      if (jeResult) { setPostResult(jeResult); setStep(2); }
      else { navigate('/ap-invoices/list'); }
    } catch (e: any) { setError(e.message); }
  };

  const handleForceQueue = async () => {
    try {
      await saveInvoice('pending');
      navigate('/ap-invoices/list');
    } catch (e: any) { setError(e.message); }
  };

  // Step 2 â€” JE posted
  if (step === 2 && postResult) {
    return (
      <div className="space-y-4">
        <StepIndicator current={2} />
        <JEPostedPanel result={postResult} onDone={() => navigate('/ap-invoices/list')} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <StepIndicator current={step} />

      {/* Step 0 â€” Upload & Extract */}
      {step === 0 && (
        <>
          <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-white mb-1">Step 1 â€” Upload Invoice</h3>
            <p className="text-xs text-gray-400 mb-4">Take a photo, upload an image, or select a PDF â€” Claude AI extracts all fields automatically.</p>

            <div
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-gray-600 hover:border-blue-500 rounded-xl p-10 text-center cursor-pointer transition-colors mb-4"
            >
              {preview ? (
                <img src={preview} alt="preview" className="max-h-48 mx-auto rounded-lg object-contain" />
              ) : file ? (
                <div className="flex flex-col items-center gap-2">
                  <FileSpreadsheet size={40} className="text-blue-400" />
                  <p className="text-white font-medium">{file.name}</p>
                  <p className="text-gray-500 text-xs">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <>
                  <Camera size={40} className="text-gray-500 mx-auto mb-3" />
                  <p className="text-gray-300 font-medium">Open Camera / Upload Image</p>
                  <p className="text-gray-500 text-xs mt-1">Supports JPG, PNG, PDF</p>
                </>
              )}
              <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </div>

            {file && !extracted && (
              <button onClick={handleExtract} disabled={extracting}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-3 rounded-xl font-medium text-sm">
                {extracting ? <><Loader2 size={15} className="animate-spin" /> Extracting with Claude AIâ€¦</> : <><Camera size={15} /> Extract Invoice Fields</>}
              </button>
            )}
          </div>

          {/* Extracted fields preview */}
          {extracted && (
            <div className="bg-gray-800/60 border border-green-700/40 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle size={15} className="text-green-400" />
                <h3 className="text-sm font-semibold text-white">Extracted Fields</h3>
                {extracted.ifrs_confidence && (
                  <span className="ml-auto text-xs text-emerald-400 font-medium">{extracted.ifrs_confidence}% confidence</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs mb-4">
                {([
                  ['Invoice #',  extracted.invoice_number],
                  ['Vendor',     extracted.vendor_name],
                  ['Date',       extracted.invoice_date],
                  ['Due Date',   extracted.due_date],
                  ['Amount',     extracted.total_amount ? `${extracted.currency || 'AED'} ${extracted.total_amount}` : null],
                  ['IFRS Cat.',  extracted.ifrs_category],
                ] as [string, string | null | undefined][]).filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} className="bg-gray-900/60 rounded-lg px-3 py-2">
                    <p className="text-gray-500 mb-0.5">{k}</p>
                    <p className="text-white font-medium">{v}</p>
                  </div>
                ))}
              </div>

              <button onClick={handleClassify} disabled={classifying}
                className="w-full flex items-center justify-center gap-2 bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white py-3 rounded-xl font-medium text-sm">
                {classifying
                  ? <><Loader2 size={15} className="animate-spin" /> Classifying with GulfTax AIâ€¦</>
                  : <><ShieldCheck size={15} /> Step 2 â€” Classify VAT with GulfTax</>}
              </button>
            </div>
          )}
        </>
      )}

      {/* Step 1 â€” GulfTax panel */}
      {step === 1 && gulfTax && extracted && (
        <div className="space-y-4">
          <div className="bg-gray-800/40 border border-gray-700/40 rounded-xl p-4 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Invoice</span>
              <span className="text-white font-medium">{extracted.invoice_number}</span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-gray-500">Vendor</span>
              <span className="text-white">{extracted.vendor_name}</span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-gray-500">Amount</span>
              <span className="text-white font-bold">AED {(extracted.total_amount || 0).toLocaleString()}</span>
            </div>
          </div>

          <GulfTaxPanel
            result={gulfTax}
            invoiceNumber={extracted.invoice_number || 'SCAN'}
            vendorName={extracted.vendor_name || 'Unknown'}
            totalAmount={extracted.total_amount || 0}
            invoiceDate={extracted.invoice_date || new Date().toISOString().slice(0, 10)}
            onConfirm={handleGulfTaxConfirm}
            onBlock={handleForceQueue}
            onBack={() => setStep(0)}
          />
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 bg-red-900/30 border border-red-700/50 rounded-xl p-4 text-sm text-red-300">
          <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}
    </div>
  );
}

// â”€â”€ Single Upload (manual entry) tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function SingleUploadTab() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    invoice_number: '', vendor_name: '', vendor_email: '',
    invoice_date: '', due_date: '', total_amount: '',
    currency: 'AED', tax_type: 'VAT', tax_amount: '',
    po_number: '', description: '', trn_number: '',
  });
  const [lines, setLines]           = useState<LineItem[]>([emptyLine()]);
  const [step, setStep]             = useState<0 | 1 | 2>(0);
  const [gulfTax, setGulfTax]       = useState<GulfTaxResult | null>(null);
  const [postResult, setPostResult] = useState<PostResult | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');

  const f = (key: keyof typeof form, val: string) => setForm(p => ({ ...p, [key]: val }));

  const updateLine = (i: number, key: keyof LineItem, val: string) => {
    setLines(prev => {
      const next = [...prev];
      const l = { ...next[i], [key]: key === 'description' ? val : parseFloat(val) || 0 };
      l.total = l.quantity * l.unit_price;
      next[i] = l;
      return next;
    });
  };

  const autoTotal = lines.reduce((s, l) => s + l.total, 0);

  const handleClassify = async () => {
    if (!form.vendor_name) { setError('Vendor name is required.'); return; }
    const total = parseFloat(form.total_amount) || autoTotal;
    if (!total) { setError('Total amount is required.'); return; }
    setClassifying(true); setError('');
    try {
      const result = await classifyWithGulfTax({
        invoice_number: form.invoice_number || `INV-${Date.now()}`,
        vendor_name:    form.vendor_name,
        total_amount:   total,
        invoice_date:   form.invoice_date || new Date().toISOString().slice(0, 10),
        description:    form.description,
        trn_number:     form.trn_number,
      });
      setGulfTax(result);
      setStep(1);
    } catch (e: any) { setError(e.message); }
    finally { setClassifying(false); }
  };

  const saveInvoice = async (approvalStatus: string) => {
    const total = parseFloat(form.total_amount) || autoTotal;
    setSaving(true); setError('');
    try {
      const { data: inv, error: err } = await apSupabase.from('invoices').insert({
        invoice_number:  form.invoice_number || `INV-${Date.now()}`,
        vendor_name:     form.vendor_name,
        vendor_email:    form.vendor_email || null,
        invoice_date:    form.invoice_date || null,
        due_date:        form.due_date || null,
        total_amount:    total,
        tax_type:        form.tax_type,
        tax_amount:      form.tax_amount ? parseFloat(form.tax_amount) : (gulfTax?.vat_amount_aed ?? null),
        currency:        form.currency,
        po_number:       form.po_number || null,
        status:          approvalStatus === 'approved' ? 'Approved' : 'Processing',
        approval_status: approvalStatus,
        source:          'manual',
        created_at:      new Date().toISOString(),
      }).select('id').single();
      if (err) throw err;
      const goodLines = lines.filter(l => l.description.trim());
      if (goodLines.length && inv?.id) {
        await apSupabase.from('invoice_line_items').insert(goodLines.map(l => ({ invoice_id: inv.id, ...l })));
      }
    } catch (e: any) { throw e; }
    finally { setSaving(false); }
  };

  const handleGulfTaxConfirm = async (jeResult?: PostResult) => {
    try {
      const approvalStatus = gulfTax?.decision === 'AUTO_APPROVE' ? 'approved' : 'pending';
      await saveInvoice(approvalStatus);
      if (jeResult) { setPostResult(jeResult); setStep(2); }
      else navigate('/ap-invoices/list');
    } catch (e: any) { setError(e.message); }
  };

  const handleForceQueue = async () => {
    try { await saveInvoice('pending'); navigate('/ap-invoices/list'); }
    catch (e: any) { setError(e.message); }
  };

  const saveDraft = async () => {
    if (!form.vendor_name) { setError('Vendor name is required.'); return; }
    try { await saveInvoice('not_required'); navigate('/ap-invoices/list'); }
    catch (e: any) { setError(e.message); }
  };

  // Step 2 â€” JE posted
  if (step === 2 && postResult) {
    return (
      <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-6 space-y-4">
        <StepIndicator current={2} />
        <JEPostedPanel result={postResult} onDone={() => navigate('/ap-invoices/list')} />
      </div>
    );
  }

  // Step 1 â€” GulfTax review
  if (step === 1 && gulfTax) {
    const total = parseFloat(form.total_amount) || autoTotal;
    return (
      <div className="space-y-4">
        <StepIndicator current={1} />
        <div className="bg-gray-800/40 border border-gray-700/40 rounded-xl p-4 text-xs">
          <div className="flex justify-between"><span className="text-gray-500">Invoice</span><span className="text-white font-medium">{form.invoice_number || 'Draft'}</span></div>
          <div className="flex justify-between mt-1"><span className="text-gray-500">Vendor</span><span className="text-white">{form.vendor_name}</span></div>
          <div className="flex justify-between mt-1"><span className="text-gray-500">Amount</span><span className="text-white font-bold">{form.currency} {total.toLocaleString()}</span></div>
        </div>
        <GulfTaxPanel
          result={gulfTax}
          invoiceNumber={form.invoice_number || 'Draft'}
          vendorName={form.vendor_name}
          totalAmount={total}
          invoiceDate={form.invoice_date || new Date().toISOString().slice(0, 10)}
          onConfirm={handleGulfTaxConfirm}
          onBlock={handleForceQueue}
          onBack={() => setStep(0)}
        />
        {error && <p className="text-sm text-red-300 bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}
      </div>
    );
  }

  // Step 0 â€” Form
  return (
    <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-6 space-y-5">
      <StepIndicator current={0} />

      <div className="grid grid-cols-2 gap-4">
        <div><label className={labelCls}>Invoice Number</label>
          <input value={form.invoice_number} onChange={e => f('invoice_number', e.target.value)} placeholder="INV-001" className={inputCls} /></div>
        <div><label className={labelCls}>Vendor Name *</label>
          <input value={form.vendor_name} onChange={e => f('vendor_name', e.target.value)} placeholder="Vendor Co." className={inputCls} /></div>
        <div><label className={labelCls}>Vendor Email</label>
          <input type="email" value={form.vendor_email} onChange={e => f('vendor_email', e.target.value)} placeholder="vendor@email.com" className={inputCls} /></div>
        <div><label className={labelCls}>Vendor TRN (UAE 15-digit)</label>
          <input value={form.trn_number} onChange={e => f('trn_number', e.target.value)} placeholder="100234567890003" maxLength={15} className={inputCls} /></div>
        <div><label className={labelCls}>PO Number</label>
          <input value={form.po_number} onChange={e => f('po_number', e.target.value)} placeholder="PO-123" className={inputCls} /></div>
        <div><label className={labelCls}>Description / Notes</label>
          <input value={form.description} onChange={e => f('description', e.target.value)} placeholder="Services renderedâ€¦" className={inputCls} /></div>
        <div><label className={labelCls}>Invoice Date</label>
          <input type="date" value={form.invoice_date} onChange={e => f('invoice_date', e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Due Date</label>
          <input type="date" value={form.due_date} onChange={e => f('due_date', e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Currency</label>
          <select value={form.currency} onChange={e => f('currency', e.target.value)} className={inputCls}>
            {CURRENCIES.map(c => <option key={c}>{c}</option>)}
          </select></div>
        <div><label className={labelCls}>Tax Type</label>
          <select value={form.tax_type} onChange={e => f('tax_type', e.target.value)} className={inputCls}>
            {TAX_TYPES.map(t => <option key={t}>{t}</option>)}
          </select></div>
        <div><label className={labelCls}>Tax Amount</label>
          <input type="number" step="0.01" value={form.tax_amount} onChange={e => f('tax_amount', e.target.value)} placeholder="0.00" className={inputCls} /></div>
        <div><label className={labelCls}>Total Amount (overrides lines)</label>
          <input type="number" step="0.01" value={form.total_amount} onChange={e => f('total_amount', e.target.value)} placeholder={autoTotal > 0 ? String(autoTotal) : '0.00'} className={inputCls} /></div>
      </div>

      {/* Line items */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Line Items</p>
          <button onClick={() => setLines(p => [...p, emptyLine()])} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
            <Plus size={11} /> Add Line
          </button>
        </div>
        <table className="w-full text-xs mb-2">
          <thead><tr className="text-gray-500 border-b border-gray-700">
            <th className="text-left py-1.5 pr-3 font-normal">Description</th>
            <th className="text-right py-1.5 pr-3 font-normal w-16">Qty</th>
            <th className="text-right py-1.5 pr-3 font-normal w-28">Unit Price</th>
            <th className="text-right py-1.5 pr-3 font-normal w-28">Total</th>
            <th className="w-6" />
          </tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-gray-800">
                <td className="py-1 pr-2">
                  <input value={l.description} onChange={e => updateLine(i, 'description', e.target.value)} placeholder="Item description" className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-xs" /></td>
                <td className="py-1 pr-2">
                  <input type="number" value={l.quantity} onChange={e => updateLine(i, 'quantity', e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-xs text-right" /></td>
                <td className="py-1 pr-2">
                  <input type="number" step="0.01" value={l.unit_price} onChange={e => updateLine(i, 'unit_price', e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-xs text-right" /></td>
                <td className="py-1 pr-2 text-right text-white font-medium">{l.total.toLocaleString()}</td>
                <td className="py-1">
                  <button onClick={() => setLines(p => p.filter((_, j) => j !== i))} className="text-gray-500 hover:text-red-400"><Trash2 size={11} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {autoTotal > 0 && (
          <p className="text-xs text-gray-400 text-right">Lines total: <span className="text-white font-medium">{form.currency} {autoTotal.toLocaleString()}</span></p>
        )}
      </div>

      {error && <p className="text-sm text-red-300 bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex gap-3 pt-1">
        <button onClick={saveDraft} disabled={saving}
          className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium">
          Save Draft
        </button>
        <button onClick={handleClassify} disabled={classifying || saving}
          className="flex-1 flex items-center justify-center gap-2 bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium">
          {classifying ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
          {classifying ? 'Classifyingâ€¦' : 'Classify with GulfTax â†’'}
        </button>
      </div>
    </div>
  );
}

// â”€â”€ Bulk Excel tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function BulkTab() {
  const navigate  = useNavigate();
  const fileRef   = useRef<HTMLInputElement>(null);
  const [rows, setRows]     = useState<Record<string, unknown>[]>([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError]   = useState('');

  const TEMPLATE_HEADERS = ['invoice_number', 'vendor_name', 'vendor_email', 'invoice_date', 'due_date', 'total_amount', 'tax_amount', 'currency', 'po_number', 'description'];

  const handleFile = (f: File) => {
    setError(''); setRows([]);
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        setRows(XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string, unknown>[]);
      } catch { setError('Could not parse file. Use the template format.'); }
    };
    reader.readAsBinaryString(f);
  };

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ['INV-001', 'Vendor Co.', 'vendor@email.com', '2025-01-15', '2025-02-15', '10000', '500', 'AED', 'PO-001', 'Services']]);
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'invoice_import_template.xlsx');
  };

  const handleImport = async () => {
    if (!rows.length) return;
    setSaving(true); setError('');
    try {
      const mapped = rows.map(r => ({
        invoice_number:  String(r.invoice_number || `IMP-${Date.now()}`),
        vendor_name:     String(r.vendor_name || 'Unknown'),
        vendor_email:    r.vendor_email ? String(r.vendor_email) : null,
        invoice_date:    r.invoice_date ? String(r.invoice_date) : null,
        due_date:        r.due_date ? String(r.due_date) : null,
        total_amount:    parseFloat(String(r.total_amount || 0)),
        tax_amount:      r.tax_amount ? parseFloat(String(r.tax_amount)) : null,
        currency:        String(r.currency || 'AED'),
        po_number:       r.po_number ? String(r.po_number) : null,
        status:          'Processing',
        approval_status: 'pending',
        source:          'excel_import',
        created_at:      new Date().toISOString(),
      }));
      const { error: err } = await apSupabase.from('invoices').insert(mapped);
      if (err) throw err;
      setResult(`âœ… ${mapped.length} invoices imported successfully.`);
      setTimeout(() => navigate('/ap-invoices/list'), 1500);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-900/20 border border-blue-700/40 rounded-xl p-4">
        <p className="text-xs text-blue-300 font-medium mb-2">Bulk import from Excel / CSV</p>
        <p className="text-xs text-gray-400 mb-3">Download the template, fill in your invoices, then upload.</p>
        <button onClick={downloadTemplate} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-600 text-white text-xs px-3 py-2 rounded-lg">
          <FileSpreadsheet size={13} /> Download Template
        </button>
      </div>
      <div className="bg-teal-900/20 border border-teal-700/30 rounded-xl p-3">
        <p className="text-xs text-teal-300">
          ðŸ’¡ Bulk imports skip GulfTax classification. Use the Scan or Single tab for UAE VAT-sensitive invoices.
        </p>
      </div>

      <div
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed border-gray-600 hover:border-blue-500 rounded-xl p-10 text-center cursor-pointer transition-colors"
      >
        <Upload size={32} className="text-gray-500 mx-auto mb-3" />
        <p className="text-gray-300 font-medium">{rows.length > 0 ? `${rows.length} rows loaded` : 'Drop Excel/CSV here or click to select'}</p>
        <p className="text-gray-500 text-xs mt-1">.xlsx, .xls, .csv accepted</p>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </div>

      {rows.length > 0 && (
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-700 text-xs text-gray-400 font-medium">Preview â€” first 5 rows</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-gray-500 border-b border-gray-700">
                {Object.keys(rows[0]).map(k => <th key={k} className="px-3 py-2 text-left font-normal">{k}</th>)}
              </tr></thead>
              <tbody>
                {rows.slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-b border-gray-700/50">
                    {Object.values(r).map((v, j) => <td key={j} className="px-3 py-2 text-gray-300 max-w-[100px] truncate">{String(v)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(error || result) && (
        <div className={`rounded-xl p-4 text-sm flex items-start gap-2 ${result ? 'bg-green-900/30 border border-green-700/50 text-green-300' : 'bg-red-900/30 border border-red-700/50 text-red-300'}`}>
          {result ? <CheckCircle size={14} className="mt-0.5 shrink-0" /> : <AlertCircle size={14} className="mt-0.5 shrink-0" />}
          {result || error}
        </div>
      )}

      {rows.length > 0 && !result && (
        <button onClick={handleImport} disabled={saving}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-3 rounded-xl font-medium">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          {saving ? 'Importingâ€¦' : `Import ${rows.length} Invoices`}
        </button>
      )}
    </div>
  );
}

// â”€â”€ Main component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function APInvoiceUpload() {
  const [tab, setTab] = useState<Tab>('scan');

  const tabs: { key: Tab; label: string; icon: string; badge?: string }[] = [
    { key: 'scan',   label: 'Scan Invoice',     icon: 'ðŸ“·', badge: 'GulfTax' },
    { key: 'single', label: 'Single Upload',    icon: 'ðŸ“„', badge: 'GulfTax' },
    { key: 'bulk',   label: 'Bulk (Excel/CSV)', icon: 'ðŸ“Š' },
  ];

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Upload Invoice</h1>
        <p className="text-gray-400 text-sm mt-1">
          UAE AP invoices are classified by GulfTax AI for VAT treatment, Art. 54 checks, and risk scoring before GL posting.
        </p>
      </div>

      {/* Tab strip */}
      <div className="flex gap-1 bg-gray-800/60 border border-gray-700 rounded-xl p-1 mb-6 w-fit">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.key ? 'bg-white/10 text-white shadow' : 'text-gray-400 hover:text-white'}`}>
            <span>{t.icon}</span>
            {t.label}
            {t.badge && tab === t.key && (
              <span className="text-[10px] bg-teal-800 text-teal-300 px-1.5 py-0.5 rounded font-semibold">{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'scan'   && <ScanTab />}
      {tab === 'single' && <SingleUploadTab />}
      {tab === 'bulk'   && <BulkTab />}
    </div>
  );
}

