import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FileText, Plus, Trash2, Upload, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import * as arSvc from '../../services/arService';
import type { ARExtractedData, ARExtractedLineItem, ARExtractPdfResult } from '../../services/arService';

type Step = 'upload' | 'review' | 'done';

type QueueItem = {
  id: string;
  file: File;
  previewUrl: string;
  status: 'pending' | 'extracting' | 'ready' | 'failed';
  result: ARExtractPdfResult | null;
  error?: string;
};

const emptyLine = (): ARExtractedLineItem => ({
  description: '',
  quantity: 1,
  unit_price: 0,
  vat_rate: 5,
  line_total: 0,
});

function recalcLine(li: ARExtractedLineItem): ARExtractedLineItem {
  const qty = Number(li.quantity) || 0;
  const unit = Number(li.unit_price) || 0;
  const vat = Number(li.vat_rate) || 0;
  return {
    ...li,
    quantity: qty,
    unit_price: unit,
    vat_rate: vat,
    line_total: Math.round(qty * unit * (1 + vat / 100) * 100) / 100,
  };
}

function toFormData(extracted: ARExtractedData, vatTreatment: string) {
  const lines = (extracted.line_items?.length ? extracted.line_items : [emptyLine()]).map(recalcLine);
  return {
    customer_name: extracted.customer_name || '',
    customer_trn: extracted.customer_trn || '',
    invoice_number: extracted.invoice_number || '',
    invoice_date: (extracted.invoice_date || '').slice(0, 10),
    due_date: (extracted.due_date || '').slice(0, 10),
    vat_treatment: vatTreatment || 'standard_rated',
    document_type: extracted.document_type || 'invoice',
    line_items: lines,
    currency: extracted.currency || 'AED',
    payment_terms: extracted.payment_terms || '',
    notes: extracted.notes || '',
    seller_name: extracted.seller_name || '',
    seller_trn: extracted.seller_trn || '',
  };
}

type FormState = ReturnType<typeof toFormData>;

export default function ARInvoiceExtract() {
  const { activeCompany } = useCompany();
  const { workspaceId } = useWorkspace();
  const companyId = activeCompany?.id || localStorage.getItem('active_company_id') || '';

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('upload');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [extracting, setExtracting] = useState(false);
  const [progressLabel, setProgressLabel] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [statusBanner, setStatusBanner] = useState<{
    status: string;
    notes: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirm, setConfirm] = useState<{
    invoice_number?: string | null;
    status: string;
    journal_entry_id?: string | null;
  } | null>(null);

  const activeItem = queue[activeIdx] || null;

  const totals = useMemo(() => {
    if (!form) return { subtotal: 0, vat: 0, total: 0 };
    const subtotal = form.line_items.reduce((s, li) => s + li.quantity * li.unit_price, 0);
    const vat = form.line_items.reduce((s, li) => s + li.quantity * li.unit_price * (li.vat_rate / 100), 0);
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      vat: Math.round(vat * 100) / 100,
      total: Math.round((subtotal + vat) * 100) / 100,
    };
  }, [form]);

  const resetToUpload = () => {
    queue.forEach((q) => URL.revokeObjectURL(q.previewUrl));
    setQueue([]);
    setActiveIdx(0);
    setForm(null);
    setStatusBanner(null);
    setConfirm(null);
    setStep('upload');
    setProgressLabel('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onFilesSelected = (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, 10);
    const allowed = list.filter((f) => {
      const n = f.name.toLowerCase();
      return n.endsWith('.pdf') || n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.png');
    });
    if (!allowed.length) {
      toast.error('Only PDF, JPG, and PNG files are accepted (max 10MB each)');
      return;
    }
    for (const f of allowed) {
      if (f.size > 10 * 1024 * 1024) {
        toast.error(`${f.name} exceeds 10MB`);
        return;
      }
    }
    queue.forEach((q) => URL.revokeObjectURL(q.previewUrl));
    setQueue(
      allowed.map((file, i) => ({
        id: `${Date.now()}-${i}`,
        file,
        previewUrl: URL.createObjectURL(file),
        status: 'pending',
        result: null,
      })),
    );
    setActiveIdx(0);
    setForm(null);
    setStatusBanner(null);
    setConfirm(null);
    setStep('upload');
  };

  const loadReviewFromResult = useCallback((result: ARExtractPdfResult) => {
    setForm(toFormData(result.extracted_data || { line_items: [] }, result.vat_treatment));
    setStatusBanner({
      status: result.extraction_status || 'failed',
      notes: result.confidence_notes || '',
    });
    setStep('review');
  }, []);

  const runExtraction = async () => {
    if (!companyId) {
      toast.error('Select a company first');
      return;
    }
    if (!queue.length) {
      toast.error('Upload at least one PDF or image');
      return;
    }
    setExtracting(true);
    try {
      for (let i = 0; i < queue.length; i++) {
        setActiveIdx(i);
        setProgressLabel(`Processing ${i + 1} of ${queue.length}…`);
        setQueue((prev) =>
          prev.map((q, idx) => (idx === i ? { ...q, status: 'extracting', error: undefined } : q)),
        );
        try {
          const result = await arSvc.extractARPdf(queue[i].file, companyId, workspaceId ?? undefined);
          setQueue((prev) =>
            prev.map((q, idx) =>
              idx === i ? { ...q, status: 'ready', result, error: undefined } : q,
            ),
          );
          if (i === 0) loadReviewFromResult(result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Extraction failed';
          setQueue((prev) =>
            prev.map((q, idx) =>
              idx === i
                ? {
                    ...q,
                    status: 'failed',
                    error: msg,
                    result: {
                      extraction_status: 'failed',
                      extracted_data: { line_items: [] },
                      vat_treatment: 'standard_rated',
                      confidence_notes: msg,
                      raw_text: '',
                    },
                  }
                : q,
            ),
          );
          if (i === 0) {
            loadReviewFromResult({
              extraction_status: 'failed',
              extracted_data: { line_items: [emptyLine()] },
              vat_treatment: 'standard_rated',
              confidence_notes: msg,
            });
          }
        }
      }
      toast.success(queue.length > 1 ? `Extracted ${queue.length} document(s)` : 'Extraction complete');
    } finally {
      setExtracting(false);
      setProgressLabel('');
    }
  };

  const showQueueItem = (idx: number) => {
    const item = queue[idx];
    if (!item?.result) return;
    setActiveIdx(idx);
    loadReviewFromResult(item.result);
  };

  const updateLine = (idx: number, patch: Partial<ARExtractedLineItem>) => {
    if (!form) return;
    const next = form.line_items.map((li, i) => (i === idx ? recalcLine({ ...li, ...patch }) : li));
    setForm({ ...form, line_items: next });
  };

  const submit = async (autoApprove: boolean) => {
    if (!form || !companyId || !workspaceId) {
      toast.error('Company and workspace are required');
      return;
    }
    if (!form.customer_name.trim()) {
      toast.error('Customer name is required');
      return;
    }
    if (!form.line_items.length) {
      toast.error('Add at least one line item');
      return;
    }
    setSubmitting(true);
    try {
      const res = await arSvc.createARFromExtraction({
        workspace_id: workspaceId,
        company_id: companyId,
        vat_treatment: form.vat_treatment,
        auto_approve: autoApprove,
        extracted_data: {
          document_type: form.document_type,
          invoice_number: form.invoice_number || null,
          invoice_date: form.invoice_date || null,
          due_date: form.due_date || null,
          customer_name: form.customer_name,
          customer_trn: form.customer_trn || null,
          seller_name: form.seller_name || null,
          seller_trn: form.seller_trn || null,
          line_items: form.line_items,
          subtotal: totals.subtotal,
          vat_amount: totals.vat,
          total_amount: totals.total,
          currency: form.currency,
          payment_terms: form.payment_terms || null,
          notes: form.notes || null,
        },
      });
      setConfirm({
        invoice_number: res.invoice_number,
        status: res.status,
        journal_entry_id: res.journal_entry_id,
      });
      setStep('done');
      toast.success(autoApprove ? 'Invoice posted to GL' : 'Invoice saved as draft');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (!companyId) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 p-6 flex items-center justify-center">
        <p className="text-gray-400">Select a company to extract sales invoices.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Scan PDF Invoice</h1>
          <p className="text-gray-400 text-sm mt-1">AI extraction for UAE AR sales documents</p>
        </div>
        <Link to="/uae-full/ar" className="text-sm text-teal-400 hover:text-teal-300">
          ← Back to AR Invoices
        </Link>
      </div>

      {step === 'upload' && (
        <div className="max-w-3xl space-y-4">
          <div
            className="border-2 border-dashed border-gray-700 hover:border-teal-600 rounded-xl p-10 text-center cursor-pointer bg-gray-900/50"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files?.length) onFilesSelected(e.dataTransfer.files);
            }}
          >
            <Upload className="mx-auto mb-3 text-teal-400" size={32} />
            <p className="text-white font-medium">Drag & drop PDF / JPG / PNG</p>
            <p className="text-gray-400 text-sm mt-1">Up to 10 files · max 10MB each</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && onFilesSelected(e.target.files)}
            />
          </div>

          {queue.length > 0 && (
            <div className="space-y-3">
              {queue.map((q) => (
                <div key={q.id} className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-lg p-3">
                  <FileText size={18} className="text-teal-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">{q.file.name}</p>
                    <p className="text-xs text-gray-500">{(q.file.size / 1024).toFixed(0)} KB</p>
                  </div>
                  {q.file.type.startsWith('image/') ? (
                    <img src={q.previewUrl} alt="" className="h-14 w-14 object-cover rounded" />
                  ) : (
                    <iframe src={q.previewUrl} title={q.file.name} className="h-14 w-20 rounded bg-white" />
                  )}
                </div>
              ))}
              <button
                type="button"
                disabled={extracting}
                onClick={() => void runExtraction()}
                className="w-full bg-teal-700 hover:bg-teal-600 disabled:opacity-50 px-4 py-3 rounded-lg font-medium"
              >
                {extracting ? progressLabel || 'Reading document with AI…' : 'Extract Invoice Data'}
              </button>
            </div>
          )}
        </div>
      )}

      {step === 'review' && form && (
        <div className="max-w-4xl space-y-4">
          {queue.length > 1 && (
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="text-gray-400">Batch:</span>
              {queue.map((q, i) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => showQueueItem(i)}
                  className={`px-2 py-1 rounded ${
                    i === activeIdx ? 'bg-teal-700 text-white' : 'bg-gray-800 text-gray-300'
                  }`}
                >
                  {i + 1}/{queue.length} · {q.status}
                </button>
              ))}
            </div>
          )}

          {statusBanner && (
            <div
              className={`rounded-lg px-4 py-3 text-sm ${
                statusBanner.status === 'success'
                  ? 'bg-emerald-950/50 border border-emerald-700 text-emerald-200'
                  : statusBanner.status === 'partial'
                    ? 'bg-amber-950/50 border border-amber-700 text-amber-200'
                    : 'bg-red-950/50 border border-red-700 text-red-200'
              }`}
            >
              <div className="flex items-center gap-2 font-medium">
                {statusBanner.status === 'success' ? (
                  <CheckCircle2 size={16} />
                ) : statusBanner.status === 'partial' ? (
                  <AlertTriangle size={16} />
                ) : (
                  <XCircle size={16} />
                )}
                {statusBanner.status === 'success'
                  ? 'Fields extracted successfully'
                  : statusBanner.status === 'partial'
                    ? 'Some fields need review'
                    : 'Could not extract — please fill manually'}
              </div>
              {statusBanner.notes ? <p className="mt-1 text-xs opacity-90">{statusBanner.notes}</p> : null}
              {activeItem?.result?.extracted_data?.document_type ? (
                <p className="mt-1 text-xs">
                  Detected document type:{' '}
                  <span className="font-semibold">{activeItem.result.extracted_data.document_type}</span>
                </p>
              ) : null}
            </div>
          )}

          {activeItem && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
              <p className="text-xs text-gray-400 mb-2">Preview — {activeItem.file.name}</p>
              {activeItem.file.type.startsWith('image/') ? (
                <img src={activeItem.previewUrl} alt="" className="max-h-56 rounded mx-auto" />
              ) : (
                <iframe src={activeItem.previewUrl} title="preview" className="w-full h-56 rounded bg-white" />
              )}
            </div>
          )}

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-gray-400">
              Customer Name
              <input
                className="mt-1 w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                value={form.customer_name}
                onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
              />
            </label>
            <label className="text-xs text-gray-400">
              Customer TRN
              <input
                className="mt-1 w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                value={form.customer_trn}
                onChange={(e) => setForm({ ...form, customer_trn: e.target.value })}
              />
            </label>
            <label className="text-xs text-gray-400">
              Invoice Number
              <input
                className="mt-1 w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                value={form.invoice_number}
                onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
              />
            </label>
            <label className="text-xs text-gray-400">
              VAT Treatment
              <select
                className="mt-1 w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                value={form.vat_treatment}
                onChange={(e) => setForm({ ...form, vat_treatment: e.target.value })}
              >
                <option value="standard_rated">standard_rated</option>
                <option value="zero_rated">zero_rated</option>
                <option value="exempt">exempt</option>
              </select>
            </label>
            <label className="text-xs text-gray-400">
              Invoice Date
              <input
                type="date"
                className="mt-1 w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                value={form.invoice_date}
                onChange={(e) => setForm({ ...form, invoice_date: e.target.value })}
              />
            </label>
            <label className="text-xs text-gray-400">
              Due Date
              <input
                type="date"
                className="mt-1 w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              />
            </label>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 overflow-x-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">Line Items</h3>
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-teal-400 hover:text-teal-300"
                onClick={() =>
                  setForm({ ...form, line_items: [...form.line_items, recalcLine(emptyLine())] })
                }
              >
                <Plus size={14} /> Add row
              </button>
            </div>
            <table className="w-full text-xs text-left">
              <thead className="text-gray-400 border-b border-gray-700">
                <tr>
                  <th className="py-2 pr-2">Description</th>
                  <th className="py-2 pr-2 w-20">Qty</th>
                  <th className="py-2 pr-2 w-28">Unit Price</th>
                  <th className="py-2 pr-2 w-20">VAT%</th>
                  <th className="py-2 pr-2 w-28">Total</th>
                  <th className="py-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {form.line_items.map((li, idx) => (
                  <tr key={idx} className="border-b border-gray-800">
                    <td className="py-2 pr-2">
                      <input
                        className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1 text-white"
                        value={li.description}
                        onChange={(e) => updateLine(idx, { description: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="number"
                        className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1 text-white"
                        value={li.quantity}
                        onChange={(e) => updateLine(idx, { quantity: Number(e.target.value) })}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="number"
                        className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1 text-white"
                        value={li.unit_price}
                        onChange={(e) => updateLine(idx, { unit_price: Number(e.target.value) })}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="number"
                        className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1 text-white"
                        value={li.vat_rate}
                        onChange={(e) => updateLine(idx, { vat_rate: Number(e.target.value) })}
                      />
                    </td>
                    <td className="py-2 pr-2 text-gray-300">{li.line_total.toFixed(2)}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        className="text-red-400 hover:text-red-300"
                        onClick={() =>
                          setForm({
                            ...form,
                            line_items: form.line_items.filter((_, i) => i !== idx),
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 flex justify-end gap-6 text-sm">
              <div>
                <span className="text-gray-400">Subtotal </span>
                <span className="text-white font-medium">{totals.subtotal.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-gray-400">VAT </span>
                <span className="text-white font-medium">{totals.vat.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-gray-400">Total </span>
                <span className="text-teal-300 font-semibold">{totals.total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void submit(false)}
              className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium"
            >
              {submitting ? 'Saving…' : 'Save as Draft'}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void submit(true)}
              className="bg-green-700 hover:bg-green-600 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium"
            >
              {submitting ? 'Posting…' : 'Approve & Post to GL'}
            </button>
            {queue.length > 1 && activeIdx < queue.length - 1 ? (
              <button
                type="button"
                onClick={() => showQueueItem(activeIdx + 1)}
                className="bg-teal-800 hover:bg-teal-700 px-4 py-2 rounded-lg text-sm"
              >
                Next invoice →
              </button>
            ) : null}
          </div>
        </div>
      )}

      {step === 'done' && confirm && (
        <div className="max-w-xl bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 text-emerald-300">
            <CheckCircle2 size={20} />
            <h2 className="text-lg font-semibold">
              Invoice {confirm.invoice_number || ''} created
            </h2>
          </div>
          <p className="text-sm text-gray-300">
            {confirm.status === 'posted'
              ? 'GL entry created + VAT recorded in GulfTax'
              : 'Saved as draft — approve when ready'}
          </p>
          {confirm.journal_entry_id ? (
            <p className="text-xs text-gray-500">JE: {confirm.journal_entry_id}</p>
          ) : null}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={resetToUpload}
              className="bg-teal-700 hover:bg-teal-600 px-4 py-2 rounded-lg text-sm font-medium"
            >
              Extract Another Invoice
            </button>
            <Link
              to="/uae-full/ar"
              className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm font-medium"
            >
              View in AR Invoices
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
