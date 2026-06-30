/** In-app notifications — /api/notifications */

import { backendOrigin } from '../utils/backendOrigin';

const BASE = `${backendOrigin()}/api/notifications`;

function hdrs(): Record<string, string> {
  const wsId = localStorage.getItem('gnanova_workspace_id') ?? localStorage.getItem('tenantId');
  return {
    'Content-Type': 'application/json',
    'X-Workspace-ID': wsId,
    'X-Tenant-ID': wsId,
  };
}

function companyQs(extra = ''): string {
  const cid = localStorage.getItem('active_company_id');
  const params = new URLSearchParams();
  if (cid) params.set('company_id', cid);
  if (extra) extra.split('&').forEach(p => { const [k, v] = p.split('='); if (k) params.set(k, v); });
  const q = params.toString();
  return q ? `?${q}` : '';
}

export interface AppNotification {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  link: string | null;
  is_read: boolean;
  company_id: string | null;
  created_at: string;
}

export async function fetchNotifications(unreadOnly = false): Promise<{ notifications: AppNotification[]; unread_count: number }> {
  const res = await fetch(`${BASE}${companyQs(unreadOnly ? 'unread_only=true' : '')}`, { headers: hdrs() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function markNotificationRead(id: string): Promise<void> {
  const res = await fetch(`${BASE}/${id}/read`, { method: 'PATCH', headers: hdrs() });
  if (!res.ok) throw new Error(await res.text());
}

export async function markAllNotificationsRead(): Promise<void> {
  const res = await fetch(`${BASE}/read-all`, { method: 'POST', headers: hdrs() });
  if (!res.ok) throw new Error(await res.text());
}

export async function notifyApInvoiceUploaded(payload: {
  vendor_name: string;
  total_amount: number;
  invoice_number: string;
  invoice_id: string;
  currency?: string;
}): Promise<void> {
  try {
    const res = await fetch(`${BASE}/ap-invoice-uploaded`, {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn('AP upload notification failed:', await res.text());
    }
  } catch (e) {
    console.warn('AP upload notification error:', e);
  }
}
