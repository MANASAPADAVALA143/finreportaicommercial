/**
 * QuickBooks Online integration — push approved invoices as Bills.
 *
 * Setup (Settings → QuickBooks):
 *   1. Create an Intuit developer app at https://developer.intuit.com → sandbox or production
 *   2. OAuth 2.0 scopes: com.intuit.quickbooks.accounting
 *   3. Use the OAuth Playground or one-time flow to exchange code for refresh_token
 *   4. Paste client_id, client_secret, refresh_token, realm_id into Settings → QuickBooks
 *
 * Credentials and tokens live on the backend only (it also stores the refresh token Intuit rotates).
 * Intuit tokens: access_token expires in 1 hour, refresh_token expires in 101 days.
 */

import type { Invoice } from '@/lib/ap-invoice/supabase';
import { apiJson, saveSharedSettings } from '@/lib/ap-invoice/sharedSettingsService';

export interface QBSettings {
  client_id: string;
  /** Write-only: blank keeps the stored secret. */
  client_secret: string;
  /** Write-only: blank keeps the stored token. */
  refresh_token: string;
  realm_id: string;
  /** 'sandbox' for testing, 'production' for live */
  environment: 'sandbox' | 'production';
  has_client_secret?: boolean;
  has_refresh_token?: boolean;
}

export interface QBPushResult {
  success: boolean;
  message: string;
  bill_id?: string;
}

type Credentials = {
  quickbooks: {
    client_id: string;
    realm_id: string;
    environment: QBSettings['environment'];
    has_client_secret: boolean;
    has_refresh_token: boolean;
  };
};

export async function pushInvoiceToQB(invoice: Invoice): Promise<QBPushResult> {
  try {
    return await apiJson<QBPushResult>('/api/ap/integrations/quickbooks/push-bill', {
      method: 'POST',
      body: JSON.stringify({ invoice_id: invoice.id }),
    });
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Platform admins only — other users get an error (callers treat that as "not configured"). */
export async function loadQBSettings(): Promise<Partial<QBSettings>> {
  const { quickbooks } = await apiJson<Credentials>('/api/ap/integrations/credentials');
  return { ...quickbooks, client_secret: '', refresh_token: '' };
}

export async function saveQBSettings(s: QBSettings): Promise<void> {
  await saveSharedSettings({
    qb_client_id: s.client_id,
    qb_client_secret: s.client_secret,
    qb_refresh_token: s.refresh_token,
    qb_realm_id: s.realm_id,
    qb_environment: s.environment,
  });
}

export async function testQBConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const result = await apiJson<{ ok: boolean; message: string }>('/api/ap/integrations/quickbooks/sync', {
      method: 'POST',
    });
    return { ok: result.ok, message: result.message };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
