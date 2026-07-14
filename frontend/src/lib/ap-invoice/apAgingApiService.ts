/**
 * AP aging via the backend (GET /api/ap/aging) with automatic fallback to
 * direct Supabase queries in agingService.ts. Production often has no
 * reachable VITE_API_URL (or points at a local URL), so the page must still
 * match Payment Calendar overdue totals from live invoice due_dates.
 */
import { getMyCompany } from './companyService';
import {
  getAgingInvoices as getAgingInvoicesLocal,
  getAgingSummary as getAgingSummaryLocal,
  type AgingBucket,
  type AgingInvoice,
} from './agingService';

const API_BASE = (import.meta.env.VITE_API_URL || '').trim().replace(/\/$/, '');

const RISK_COLORS: Record<string, string> = {
  low: '#22C55E',
  medium: '#F59E0B',
  high: '#FF4444',
  critical: '#9B1C1C',
};

interface ApAgingBucketDto {
  key: string;
  label: string;
  risk: string;
  invoice_count: number;
  total_amount: number;
}

interface ApAgingInvoiceDto {
  id: string;
  invoice_number: string | null;
  vendor_name: string | null;
  amount: number;
  invoice_date: string | null;
  due_date: string | null;
  payment_status: string | null;
  days_overdue: number;
  aging_bucket: string;
}

interface ApAgingResponse {
  as_of: string;
  total_outstanding: number;
  total_overdue: number;
  buckets: ApAgingBucketDto[];
  invoices: ApAgingInvoiceDto[];
}

async function fetchApAgingFromApi(): Promise<ApAgingResponse | null> {
  if (!API_BASE) return null;
  // Browser deployed on Vercel can't reach localhost backends
  if (/localhost|127\.0\.0\.1/i.test(API_BASE) && typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host && host !== 'localhost' && host !== '127.0.0.1') return null;
  }

  try {
    const company = await getMyCompany();
    const companyId = company?.id ?? null;
    const qs = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
    const res = await fetch(`${API_BASE}/api/ap/aging${qs}`);
    if (!res.ok) return null;
    return (await res.json()) as ApAgingResponse;
  } catch (e) {
    console.warn('[apAgingApi] backend unavailable, using Supabase fallback:', e);
    return null;
  }
}

export async function getAgingSummary(): Promise<AgingBucket[]> {
  const data = await fetchApAgingFromApi();
  if (data?.buckets?.length) {
    const total = data.buckets.reduce((s, b) => s + (b.invoice_count || 0), 0);
    if (total > 0 || data.total_outstanding > 0) {
      return data.buckets.map((b) => ({
        label: b.label,
        key: b.key,
        invoice_count: b.invoice_count,
        total_amount: b.total_amount,
        color: RISK_COLORS[b.risk] ?? RISK_COLORS.medium,
      }));
    }
  }
  return getAgingSummaryLocal();
}

export async function getAgingInvoices(bucket?: string): Promise<AgingInvoice[]> {
  const data = await fetchApAgingFromApi();
  if (data?.invoices?.length) {
    return data.invoices
      .filter((i) => !bucket || i.aging_bucket === bucket)
      .map((i) => ({
        id: i.id,
        invoice_number: i.invoice_number,
        vendor_name: i.vendor_name,
        amount: i.amount,
        invoice_date: i.invoice_date,
        due_date: i.due_date,
        payment_status: i.payment_status,
        days_overdue: i.days_overdue,
        aging_bucket: i.aging_bucket,
      }));
  }
  return getAgingInvoicesLocal(bucket);
}
