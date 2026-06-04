/**
 * Public vendor self-upload portal â€” no login required.
 * URL: /vendor-upload (or /vendor-upload?company=<company_id>)
 *
 * Vendor fills in their name/email, picks a PDF/image, and submits.
 * File goes to Supabase Storage (invoices bucket), row created with source='vendor_portal'.
 * If VITE_N8N_WEBHOOK_URL is set, the invoice is also sent for AI extraction.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/ap-invoice/supabase';

type UploadState = 'idle' | 'uploading' | 'success' | 'error';

const ACCEPTED = '.pdf,.png,.jpg,.jpeg,.webp';

export function VendorUploadPortal() {
  const [params] = useSearchParams();
  const companyId = params.get('company') ?? null;

  const [vendorName, setVendorName] = useState('');
  const [vendorEmail, setVendorEmail] = useState('');
  const [vendorPhone, setVendorPhone] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !vendorName.trim()) return;
    setState('uploading');
    setMessage('');

    try {
      // 1. Upload file to Supabase Storage
      const ext = file.name.split('.').pop() ?? 'pdf';
      const storagePath = `vendor-portal/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: storageErr } = await supabase.storage.from('invoices').upload(storagePath, file, { upsert: false });
      if (storageErr) throw new Error(`Upload failed: ${storageErr.message}`);

      const { data: urlData } = supabase.storage.from('invoices').getPublicUrl(storagePath);
      const fileUrl = urlData?.publicUrl ?? null;

      // 2. Create invoice row
      const today = new Date().toISOString().slice(0, 10);
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 30);

      const invPayload: Record<string, unknown> = {
        invoice_number: invoiceNumber.trim() || `VP-${Date.now()}`,
        invoice_date: today,
        due_date: dueDate.toISOString().slice(0, 10),
        vendor_name: vendorName.trim(),
        vendor_email: vendorEmail.trim() || null,
        vendor_phone: vendorPhone.trim() || null,
        total_amount: 0,
        currency: 'INR',
        status: 'Processing',
        file_url: fileUrl,
        file_type: file.type || ext,
        source: 'vendor_portal',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (companyId) invPayload.company_id = companyId;

      const { error: insErr } = await supabase.from('invoices').insert(invPayload);
      if (insErr) throw new Error(`Could not create invoice record: ${insErr.message}`);

      // 3. Optionally trigger n8n extraction webhook
      const webhookUrl = (import.meta.env.VITE_N8N_WEBHOOK_URL as string | undefined)?.trim();
      if (webhookUrl && fileUrl) {
        const fd = new FormData();
        fd.append('file', file, file.name);
        fd.append('source', 'vendor_portal');
        fd.append('vendor_name', vendorName.trim());
        void fetch(webhookUrl, { method: 'POST', body: fd }).catch(() => null);
      }

      setState('success');
      setMessage('Thank you! Your invoice has been submitted successfully. Our team will review it shortly.');
      setVendorName('');
      setVendorEmail('');
      setVendorPhone('');
      setInvoiceNumber('');
      setFile(null);
    } catch (e) {
      setState('error');
      setMessage(e instanceof Error ? e.message : 'Submission failed. Please try again.');
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-[#1a56db] rounded-lg p-2">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Submit Invoice</h1>
            <p className="text-sm text-gray-500">Vendor self-upload portal</p>
          </div>
        </div>

        {state === 'success' ? (
          <div className="text-center py-6">
            <div className="text-5xl mb-4">âœ…</div>
            <p className="text-green-800 font-medium">{message}</p>
            <button
              onClick={() => setState('idle')}
              className="mt-4 text-sm text-[#1a56db] underline"
            >
              Submit another invoice
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vendor / Company Name *</label>
              <input
                required
                type="text"
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Your company name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={vendorEmail}
                onChange={(e) => setVendorEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="your@email.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone (WhatsApp)</label>
              <input
                type="tel"
                value={vendorPhone}
                onChange={(e) => setVendorPhone(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="+91 98765 43210"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Number</label>
              <input
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="INV-2024-001 (optional)"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Invoice File *</label>
              <input
                required
                type="file"
                accept={ACCEPTED}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm file:mr-3 file:py-1 file:px-2 file:border-0 file:rounded file:bg-blue-50 file:text-blue-700 file:text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">PDF, PNG, JPG up to 10 MB</p>
            </div>

            {state === 'error' && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{message}</p>
            )}

            <button
              type="submit"
              disabled={state === 'uploading' || !file || !vendorName.trim()}
              className="w-full bg-[#1a56db] text-white font-medium rounded-lg py-2.5 text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {state === 'uploading' ? 'Submittingâ€¦' : 'Submit Invoice'}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-gray-400">Powered by InvoiceFlow AP Automation</p>
      </div>
    </div>
  );
}

