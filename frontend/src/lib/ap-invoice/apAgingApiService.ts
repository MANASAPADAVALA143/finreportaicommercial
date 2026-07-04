/**
 * AP aging via the backend (GET /api/ap/aging), replacing the direct
 * browser-to-Supabase queries in agingService.ts's getAgingSummary/
 * getAgingInvoices. Bucket scheme now matches AR exactly: Current/1-30/
 * 31-60/61-90/90+ (see backend/app/services/ap_aging_service.py).
 *
 * getDpoMetrics/getAgingByVendor stay in agingService.ts and still query
 * Supabase directly — only the two bucket/invoice-list functions moved.
 */
import { getMyCompany } from './companyService';
import type { AgingBucket, AgingInvoice } from './agingService';

const API_BASE = (import.meta.env.VITE_API_URL || '').trim().replace(/\/$/, '');

// Same palette ARCollections.tsx / ARCollectionsLive.tsx already use for
// risk-tier colors, so AR and AP aging read consistently side by side.
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

async function fetchApAging(): Promise<ApAgingResponse> {
  const company = await getMyCompany();
  const companyId = company?.id ?? null;
  const qs = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
  const res = await fetch(`${API_BASE}/api/ap/aging${qs}`);
  if (!res.ok) {
    throw new Error(`AP aging request failed: ${res.status}`);
  }
  return res.json();
}

export async function getAgingSummary(): Promise<AgingBucket[]> {
  const data = await fetchApAging();
  return data.buckets.map((b) => ({
    label: b.label,
    key: b.key,
    invoice_count: b.invoice_count,
    total_amount: b.total_amount,
    color: RISK_COLORS[b.risk] ?? RISK_COLORS.medium,
  }));
}

export async function getAgingInvoices(bucket?: string): Promise<AgingInvoice[]> {
  const data = await fetchApAging();
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
