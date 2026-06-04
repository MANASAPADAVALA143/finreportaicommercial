import { invoiceFlowAgentUrl } from '@/lib/apiBase';

export type NormalizedExtractedInvoice = {
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  vendor_name: string;
  customer_name: string;
  customer_gstin: string;
  total_amount: number;
  currency: string;
  gstin: string;
  tax_amount: number | null;
  /** DB + UI: purchase = AP, sales = AR */
  invoice_kind: 'purchase' | 'sales';
};

export type ExtractImageResponse = {
  invoice: Record<string, unknown>;
  confidence?: number;
};

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const v = obj[k];
    if (v == null) continue;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

/** Maps FastAPI / agent JSON into row-shaped fields for preview + Supabase insert. */
export function normalizeExtractedInvoice(raw: Record<string, unknown>): NormalizedExtractedInvoice {
  const inv = (raw.invoice as Record<string, unknown> | undefined) ?? raw;
  const today = new Date().toISOString().slice(0, 10);
  const invNo = pickString(inv, ['invoice_number', 'invoice_no', 'document_number', 'bill_number']) || `CAM-${Date.now()}`;
  const invDate = pickString(inv, ['invoice_date', 'bill_date', 'date']) || today;
  let due = pickString(inv, ['due_date', 'payment_due_date']);
  if (!due) {
    const d = new Date(invDate);
    d.setDate(d.getDate() + 30);
    due = d.toISOString().slice(0, 10);
  }
  const vendor = pickString(inv, ['vendor_name', 'supplier_name', 'seller_name', 'vendor']);
  const customer = pickString(inv, ['customer_name', 'buyer_name', 'customer', 'ship_to_name']);
  const custGst = pickString(inv, ['customer_gstin', 'buyer_gstin', 'customer_gst']);
  const sellerGst = pickString(inv, ['vendor_gstin', 'supplier_gstin', 'gstin', 'seller_gstin']);
  const total = pickNumber(inv, ['total_amount', 'total', 'grand_total', 'amount']);
  const cur = (pickString(inv, ['currency']) || 'INR').toUpperCase().slice(0, 3);
  const tax = pickNumber(inv, ['tax_amount', 'total_tax', 'gst_amount']);
  const rawKind = pickString(inv, ['invoice_kind', 'invoice_type', 'kind']).toLowerCase();
  let invoice_kind: 'purchase' | 'sales' = 'purchase';
  if (rawKind === 'sales' || rawKind === 'ar' || rawKind === 'receivable') invoice_kind = 'sales';
  if (rawKind === 'purchase' || rawKind === 'ap' || rawKind === 'payable') invoice_kind = 'purchase';

  return {
    invoice_number: invNo,
    invoice_date: invDate,
    due_date: due,
    vendor_name: vendor || (customer ? 'Unknown vendor' : 'Unknown'),
    customer_name: customer,
    customer_gstin: custGst,
    total_amount: total || 0,
    currency: cur || 'INR',
    gstin: sellerGst,
    tax_amount: tax || null,
    invoice_kind,
  };
}

function formatFastApiDetail(detail: unknown): string {
  if (detail == null) return '';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((x) => {
        if (x && typeof x === 'object' && 'msg' in x) return String((x as { msg: string }).msg);
        return JSON.stringify(x);
      })
      .join('; ');
  }
  return String(detail);
}

function describeFailedResponse(status: number, text: string, parsed: Record<string, unknown> | null): string {
  const detail =
    formatFastApiDetail(parsed?.detail) ||
    (typeof parsed?.message === 'string' ? parsed.message : '') ||
    (typeof parsed?.error === 'string' ? parsed.error : '');
  const trimmed = text.trim();
  if (detail) return `HTTP ${status}: ${detail}`;
  if (trimmed.startsWith('<!') || trimmed.toLowerCase().includes('<html')) {
    return (
      `HTTP ${status}: The server returned a web page instead of JSON. ` +
      `On Vercel, set VITE_API_URL to your FastAPI base URL (e.g. https://your-agent.railway.app) so extraction hits the agent, not static hosting.`
    );
  }
  const snippet = trimmed.slice(0, 280);
  const base = snippet ? `HTTP ${status}: ${snippet}` : `HTTP ${status}`;
  if (status === 450) {
    return `${base} (Some networks/parental filters use status 450 — try another connection or disable filtering.)`;
  }
  if (status === 405) {
    return (
      `${base} ` +
      `HTTP 405 here often means the POST hit the web app (e.g. Vercel SPA) instead of FastAPI. ` +
      `On Vercel: set INVOICEFLOW_AGENT_URL to your agent base URL, leave VITE_API_URL empty so scan uses the built-in proxy, and redeploy — ` +
      `or set VITE_API_URL to your FastAPI URL only (not your Vercel site URL).`
    );
  }
  return base;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read image (try JPEG or PNG).'));
    img.src = src;
  });
}

/**
 * Phone cameras often output HEIC (unsupported by many APIs). Large photos can hit limits — shrink to JPEG.
 */
async function prepareImageForExtract(file: File): Promise<File> {
  const nameLower = file.name.toLowerCase();
  const typeLower = (file.type || '').toLowerCase();
  if (typeLower.includes('heic') || typeLower.includes('heif') || nameLower.endsWith('.heic') || nameLower.endsWith('.heif')) {
    throw new Error(
      'This photo is HEIC/HEIF. Please use Upload file and choose a JPEG/PNG, or change the phone camera to “Most Compatible” (JPEG).'
    );
  }
  if (!typeLower.startsWith('image/')) return file;

  const maxSide = 2048;
  const maxBytes = 4 * 1024 * 1024;
  if (file.size <= maxBytes && typeLower === 'image/jpeg') return file;

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(url);
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (!w || !h) return file;
    if (w > maxSide || h > maxSide) {
      const scale = maxSide / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    if (!blob) return file;
    const base = file.name.replace(/\.[^.]+$/, '') || 'invoice';
    return new File([blob], `${base}-upload.jpg`, { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * POST multipart to FastAPI `POST /api/agent/extract-image` (same-origin proxy in dev).
 * Expects JSON: `{ invoice: { ... }, confidence?: number }`.
 */
export async function extractInvoiceFromImageFile(file: File): Promise<ExtractImageResponse> {
  const uploadFile = await prepareImageForExtract(file);

  const fd = new FormData();
  fd.append('file', uploadFile, uploadFile.name || 'capture.jpg');
  const url = invoiceFlowAgentUrl('/api/agent/extract-image');
  const res = await fetch(url, { method: 'POST', body: fd });
  const text = await res.text();

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    throw new Error(describeFailedResponse(res.status, text, parsed));
  }

  if (!parsed) {
    throw new Error(text ? `Invalid JSON: ${text.slice(0, 200)}` : `Empty response (HTTP ${res.status})`);
  }

  const o = parsed;
  const invoice = (o.invoice as Record<string, unknown>) ?? o;
  const confidence = typeof o.confidence === 'number' ? o.confidence : undefined;
  return { invoice, confidence };
}
