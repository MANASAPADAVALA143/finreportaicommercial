/**
 * Zoho Books integration — push approved invoices as Bills.
 *
 * Setup (Settings → Zoho Books):
 *   1. Create a Zoho API client at https://api-console.zoho.com → Self Client → Server-based
 *   2. Scopes: ZohoBooks.bills.CREATE, ZohoBooks.bills.READ, ZohoBooks.contacts.READ
 *   3. Generate code → exchange for refresh_token (one-time, paste into Settings)
 *   4. Save client_id, client_secret, refresh_token, organization_id in Settings
 *
 * Credentials and tokens live on the backend only; the browser never receives the secrets.
 */

import { logAction } from '@/lib/ap-invoice/auditService';
import type { Invoice } from '@/lib/ap-invoice/supabase';
import { apiJson, saveSharedSettings } from '@/lib/ap-invoice/sharedSettingsService';

export interface ZohoSettings {
  client_id: string;
  /** Write-only: blank keeps the stored secret. */
  client_secret: string;
  /** Write-only: blank keeps the stored token. */
  refresh_token: string;
  organization_id: string;
  /** Zoho data center: com | in | eu | com.au | jp */
  domain: 'com' | 'in' | 'eu' | 'com.au' | 'jp';
  has_client_secret?: boolean;
  has_refresh_token?: boolean;
}

export interface ZohoPushResult {
  success: boolean;
  message: string;
  bill_id?: string;
  bill_number?: string;
}

type Credentials = {
  zoho: {
    client_id: string;
    organization_id: string;
    domain: ZohoSettings['domain'];
    has_client_secret: boolean;
    has_refresh_token: boolean;
  };
};

export async function pushInvoiceToZoho(invoice: Invoice, performedBy?: string): Promise<ZohoPushResult> {
  try {
    const result = await apiJson<ZohoPushResult>('/api/ap/integrations/zoho/push-bill', {
      method: 'POST',
      body: JSON.stringify({ invoice_id: invoice.id }),
    });
    if (result.success) {
      logAction('tally.sync', 'invoice', invoice.id, performedBy ?? null, {
        integration: 'zoho',
        bill_id: result.bill_id,
      });
    }
    return result;
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Platform admins only — other users get an error (callers treat that as "not configured"). */
export async function loadZohoSettings(): Promise<Partial<ZohoSettings>> {
  const { zoho } = await apiJson<Credentials>('/api/ap/integrations/credentials');
  return { ...zoho, client_secret: '', refresh_token: '' };
}

export async function saveZohoSettings(s: ZohoSettings): Promise<void> {
  await saveSharedSettings({
    zoho_client_id: s.client_id,
    zoho_client_secret: s.client_secret,
    zoho_refresh_token: s.refresh_token,
    zoho_organization_id: s.organization_id,
    zoho_domain: s.domain,
  });
}

export async function testZohoConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const result = await apiJson<{ ok: boolean; message: string }>('/api/ap/integrations/zoho/sync', { method: 'POST' });
    return { ok: result.ok, message: result.message };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
