/**
 * AP GL Accounts persistence.
 * Prefer `gl_accounts` (InvoiceFlow). If that table is missing in Supabase,
 * fall back to `uae_chart_of_accounts` which already exists on some projects.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GLAccount } from './supabase';

export type GlStoreTable = 'gl_accounts' | 'uae_chart_of_accounts';

let cachedTable: GlStoreTable | null = null;

function isMissingTableError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes('does not exist') ||
    m.includes('pgrst205') ||
    m.includes('could not find the table') ||
    m.includes('42p01') ||
    m.includes('relation') ||
    m.includes('schema cache')
  );
}

function mapUaeRow(row: Record<string, unknown>): GLAccount {
  return {
    id: String(row.id),
    company_id: (row.company_id as string | null) ?? null,
    gl_code: String(row.account_code ?? ''),
    gl_name: String(row.account_name ?? ''),
    account_type: (row.account_type as GLAccount['account_type']) || 'Expense',
    department: null,
    cost_center: null,
    is_active: row.is_active !== false,
    imported_from: (row.account_sub_type as string | null) ?? null,
    standard_reference: null,
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.created_at ?? new Date().toISOString()),
  };
}

export async function resolveGlStoreTable(client: SupabaseClient): Promise<GlStoreTable> {
  if (cachedTable) return cachedTable;
  const probe = await client.from('gl_accounts').select('id').limit(1);
  if (!probe.error) {
    cachedTable = 'gl_accounts';
    return cachedTable;
  }
  const msg = probe.error.message || '';
  if (isMissingTableError(msg)) {
    const fb = await client.from('uae_chart_of_accounts').select('id').limit(1);
    if (!fb.error) {
      cachedTable = 'uae_chart_of_accounts';
      return cachedTable;
    }
  }
  // Default preferred name — callers still get a clear error on insert/select
  cachedTable = 'gl_accounts';
  return cachedTable;
}

export function resetGlStoreCache(): void {
  cachedTable = null;
}

export async function listGlAccounts(
  client: SupabaseClient,
  companyId?: string | null,
): Promise<GLAccount[]> {
  const table = await resolveGlStoreTable(client);
  if (table === 'gl_accounts') {
    let q = client.from('gl_accounts').select('*').order('gl_code', { ascending: true });
    if (companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) {
      if (isMissingTableError(error.message || '')) {
        resetGlStoreCache();
        return listGlAccounts(client, companyId);
      }
      throw error;
    }
    return (data || []) as GLAccount[];
  }

  let q = client.from('uae_chart_of_accounts').select('*').order('account_code', { ascending: true });
  if (companyId) q = q.eq('company_id', companyId);
  const { data, error } = await q;
  if (error) throw error;
  return ((data || []) as Record<string, unknown>[]).map(mapUaeRow);
}

export async function insertGlAccount(
  client: SupabaseClient,
  row: {
    company_id: string;
    gl_code: string;
    gl_name: string;
    account_type: string;
    department?: string | null;
    cost_center?: string | null;
    is_active?: boolean;
    imported_from?: string | null;
    standard_reference?: string | null;
  },
): Promise<{ error: string | null }> {
  const table = await resolveGlStoreTable(client);
  if (table === 'gl_accounts') {
    const { error } = await client.from('gl_accounts').insert({
      company_id: row.company_id,
      gl_code: row.gl_code,
      gl_name: row.gl_name,
      account_type: row.account_type,
      department: row.department ?? null,
      cost_center: row.cost_center ?? null,
      is_active: row.is_active ?? true,
      imported_from: row.imported_from ?? null,
      standard_reference: row.standard_reference ?? null,
    });
    if (error && isMissingTableError(error.message || '')) {
      resetGlStoreCache();
      return insertGlAccount(client, row);
    }
    return { error: error?.message ?? null };
  }

  const { error } = await client.from('uae_chart_of_accounts').insert({
    company_id: row.company_id,
    account_code: row.gl_code,
    account_name: row.gl_name,
    account_type: row.account_type,
    account_sub_type: row.standard_reference ?? row.imported_from ?? null,
    is_active: row.is_active ?? true,
    currency: 'AED',
  });
  return { error: error?.message ?? null };
}

export async function updateGlAccount(
  client: SupabaseClient,
  id: string,
  patch: Partial<{
    gl_code: string;
    gl_name: string;
    account_type: string;
    department: string | null;
    cost_center: string | null;
    is_active: boolean;
  }>,
): Promise<{ error: string | null }> {
  const table = await resolveGlStoreTable(client);
  if (table === 'gl_accounts') {
    const { error } = await client.from('gl_accounts').update(patch).eq('id', id);
    return { error: error?.message ?? null };
  }
  const uaePatch: Record<string, unknown> = {};
  if (patch.gl_code != null) uaePatch.account_code = patch.gl_code;
  if (patch.gl_name != null) uaePatch.account_name = patch.gl_name;
  if (patch.account_type != null) uaePatch.account_type = patch.account_type;
  if (patch.is_active != null) uaePatch.is_active = patch.is_active;
  const { error } = await client.from('uae_chart_of_accounts').update(uaePatch).eq('id', id);
  return { error: error?.message ?? null };
}

export async function deleteGlAccount(
  client: SupabaseClient,
  id: string,
): Promise<{ error: string | null }> {
  const table = await resolveGlStoreTable(client);
  const { error } = await client.from(table).delete().eq('id', id);
  return { error: error?.message ?? null };
}

export async function listExistingGlCodes(
  client: SupabaseClient,
  companyId: string,
): Promise<Set<string>> {
  const table = await resolveGlStoreTable(client);
  if (table === 'gl_accounts') {
    const { data } = await client.from('gl_accounts').select('gl_code').eq('company_id', companyId);
    return new Set((data || []).map((r: { gl_code: string }) => r.gl_code));
  }
  const { data } = await client
    .from('uae_chart_of_accounts')
    .select('account_code')
    .eq('company_id', companyId);
  return new Set((data || []).map((r: { account_code: string }) => r.account_code));
}
