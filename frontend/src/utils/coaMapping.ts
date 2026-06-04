/**
 * Chart of Accounts (COA) mapping — Enterprise tier
 * Resolves GL: chart_of_accounts (IFRS mapping) → company gl_accounts + accounting standard engine
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveGLCodeSmart, type GLSuggestionSource } from '@/lib/accountingStandardService';
import { getMyCompany } from '@/lib/companyService';

/** @deprecated Import from `@/utils/ifrsStandardGL` for static maps */
export { IFRS_STANDARD_GL } from '@/utils/ifrsStandardGL';

export type GLResult = {
  gl_account: string | null;
  gl_account_name: string | null;
  gl_source: 'company_coa' | 'ifrs_auto' | 'company_chart' | 'standard_fallback' | 'ai_suggested';
  gl_suggestion_source?: GLSuggestionSource | null;
  gl_confirmed?: boolean;
  standard_ref?: string | null;
  gl_account_type?: string | null;
  department?: string | null;
  cost_center?: string | null;
};

export async function resolveGLAccount(
  supabaseClient: SupabaseClient,
  ifrsCategory: string | null | undefined,
  companyId?: string | null,
  context?: { description?: string | null; vendorName?: string | null }
): Promise<GLResult> {
  if (!ifrsCategory || !String(ifrsCategory).trim()) {
    return {
      gl_account: null,
      gl_account_name: null,
      gl_source: 'ifrs_auto',
    };
  }

  const cat = String(ifrsCategory).trim();
  const tenantCo = companyId ?? (await getMyCompany())?.id;

  let coaQuery = supabaseClient
    .from('chart_of_accounts')
    .select('gl_code, account_name, department, cost_center')
    .eq('ifrs_mapping', cat)
    .eq('is_active', true)
    .limit(1);
  if (tenantCo) coaQuery = coaQuery.eq('company_id', tenantCo);
  const { data: coa } = await coaQuery.maybeSingle();

  if (coa) {
    return {
      gl_account: coa.gl_code,
      gl_account_name: coa.account_name,
      gl_source: 'company_coa',
      gl_suggestion_source: 'company_chart',
      gl_confirmed: true,
      department: coa.department ?? null,
      cost_center: coa.cost_center ?? null,
    };
  }

  const smart = await resolveGLCodeSmart(supabaseClient, {
    ifrsCategory: cat,
    description: context?.description ?? '',
    vendorName: context?.vendorName ?? '',
  });

  const glSource: GLResult['gl_source'] =
    smart.source === 'company_chart'
      ? 'company_chart'
      : smart.source === 'standard_fallback'
        ? 'standard_fallback'
        : 'ai_suggested';

  return {
    gl_account: smart.code,
    gl_account_name: smart.name,
    gl_source: glSource,
    gl_suggestion_source: smart.source,
    gl_confirmed: !smart.needsConfirmation,
    standard_ref: smart.standardRef ?? null,
    gl_account_type: smart.accountType,
  };
}

/** Maps GL resolution result to invoice columns (Supabase). */
export function invoiceGlFieldsFromResult(glRes: GLResult): Record<string, unknown> {
  if (!glRes.gl_account) {
    return {
      gl_code: null,
      gl_account_code: null,
      gl_account_name: null,
      gl_name: null,
      gl_account_type: glRes.gl_account_type ?? null,
      gl_suggestion_source: glRes.gl_suggestion_source ?? null,
      gl_confirmed: false,
      gl_auto_suggested: false,
      gl_standard_ref: glRes.standard_ref ?? null,
    };
  }
  const confirmed = glRes.gl_confirmed ?? false;
  return {
    gl_code: glRes.gl_account,
    gl_account_code: glRes.gl_account,
    gl_account_name: glRes.gl_account_name,
    gl_name: glRes.gl_account_name,
    gl_source: glRes.gl_source,
    gl_account_type: glRes.gl_account_type ?? null,
    gl_suggestion_source: glRes.gl_suggestion_source ?? null,
    gl_confirmed: confirmed,
    gl_auto_suggested: !confirmed,
    gl_standard_ref: glRes.standard_ref ?? null,
  };
}
