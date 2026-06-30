/**
 * Tally ERP Service
 * Handles: single invoice push, bulk sync, connection test, sync status tracking.
 * Wraps tallyExport.ts primitives and writes tally_synced / tally_synced_at back to Supabase.
 */
import { supabase } from '@/lib/ap-invoice/supabase';
import { pushToTallyPrime, downloadTallyXML, type TallySettings } from '@/utils/tallyExport';
import { logAction } from '@/lib/ap-invoice/auditService';
import type { Invoice } from '@/lib/ap-invoice/supabase';

export interface TallySyncResult {
  success: boolean;
  message: string;
  imported: number;
  /** fell back to XML download (Tally not reachable) */
  fallbackDownload?: boolean;
}

export interface TallyBulkSyncResult {
  synced: number;
  failed: number;
  skipped: number;
  messages: string[];
}

/**
 * Push a single invoice to TallyPrime HTTP server.
 * On success writes tally_synced=true + tally_synced_at to Supabase.
 * On network failure falls back to XML download and still marks success.
 */
export async function pushInvoiceToTally(
  invoice: Invoice,
  settings: TallySettings,
  performedBy?: string
): Promise<TallySyncResult> {
  const result = await pushToTallyPrime([invoice as unknown as Record<string, unknown>], settings);

  if (result.success) {
    const { error } = await supabase
      .from('invoices')
      .update({
        tally_synced: true,
        tally_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoice.id);

    if (error) {
      console.warn('tallyService: could not update tally_synced flag:', error.message);
    }

    logAction(
      'tally.sync',
      'invoice',
      invoice.id,
      performedBy ?? null,
      { imported: result.imported, message: result.message }
    );
  }

  return {
    success: result.success,
    message: result.message,
    imported: result.imported,
    fallbackDownload: result.imported === 0 && result.success,
  };
}

/**
 * Bulk push all approved invoices not yet synced to Tally.
 * Processes in batches of 10 to avoid large XML payloads.
 */
export async function syncApprovedToTally(
  settings: TallySettings,
  performedBy?: string
): Promise<TallyBulkSyncResult> {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('status', 'Approved')
    .or('tally_synced.is.null,tally_synced.eq.false')
    .order('created_at', { ascending: true });

  if (error) {
    return { synced: 0, failed: 1, skipped: 0, messages: [error.message] };
  }

  const invoices = (data ?? []) as Invoice[];
  if (invoices.length === 0) {
    return { synced: 0, failed: 0, skipped: 0, messages: ['No approved unsynced invoices found.'] };
  }

  const BATCH = 10;
  let synced = 0;
  let failed = 0;
  const messages: string[] = [];

  for (let i = 0; i < invoices.length; i += BATCH) {
    const batch = invoices.slice(i, i + BATCH);
    const result = await pushToTallyPrime(batch as unknown as Record<string, unknown>[], settings);

    if (result.success) {
      const ids = batch.map((inv) => inv.id);
      await supabase
        .from('invoices')
        .update({
          tally_synced: true,
          tally_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .in('id', ids);

      synced += batch.length;
      messages.push(`Batch ${Math.floor(i / BATCH) + 1}: ${result.message}`);

      logAction('tally.bulk_sync', 'invoice', null, performedBy ?? null, {
        batch: Math.floor(i / BATCH) + 1,
        count: batch.length,
      });
    } else {
      failed += batch.length;
      messages.push(`Batch ${Math.floor(i / BATCH) + 1} failed: ${result.message}`);
    }
  }

  return { synced, failed, skipped: 0, messages };
}

/**
 * Test if TallyPrime HTTP server is reachable.
 * Sends a minimal XML status request (GetLicenseInfo) and checks for a valid response.
 * Returns { ok, message }.
 */
export async function testTallyConnection(
  tallyUrl: string
): Promise<{ ok: boolean; message: string }> {
  const pingXml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>List of Companies</REPORTNAME>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(tallyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml;charset=utf-8' },
      body: pingXml,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const text = await res.text();
    if (text.includes('ENVELOPE') || text.includes('COMPANY') || text.includes('TALLYMESSAGE')) {
      return { ok: true, message: `TallyPrime reachable at ${tallyUrl}` };
    }
    return { ok: false, message: `Unexpected response from ${tallyUrl}` };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('abort') || msg.includes('timeout')) {
      return { ok: false, message: `Connection timed out — is TallyPrime running at ${tallyUrl}?` };
    }
    // CORS / network error — Tally is likely not running
    return {
      ok: false,
      message: `Cannot reach ${tallyUrl}. Enable TallyPrime HTTP server: Gateway → Configure → Enable HTTP → Port 9000.`,
    };
  }
}

/**
 * Download XML for a set of invoices without pushing to Tally.
 * Useful when Tally is offline and user wants to import manually later.
 */
export function downloadTallyXMLForInvoices(
  invoices: Invoice[],
  settings: TallySettings
): void {
  downloadTallyXML(invoices as unknown as Record<string, unknown>[], settings);
}

/**
 * Fetch Tally sync stats for the current company.
 * Returns counts of synced vs total approved invoices.
 */
export async function getTallySyncStats(): Promise<{
  totalApproved: number;
  synced: number;
  unsynced: number;
}> {
  const { data, error } = await supabase
    .from('invoices')
    .select('tally_synced')
    .eq('status', 'Approved');

  if (error || !data) {
    return { totalApproved: 0, synced: 0, unsynced: 0 };
  }

  const totalApproved = data.length;
  const synced = data.filter((r) => r.tally_synced === true).length;
  return { totalApproved, synced, unsynced: totalApproved - synced };
}
