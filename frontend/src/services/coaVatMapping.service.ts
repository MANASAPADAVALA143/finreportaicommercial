/**
 * UAE VAT/IFRS treatment → default GL account mapping for AP InvoiceFlow.
 * Company overrides live in company_coa_mapping; defaults in default_coa_mapping (+ static fallback).
 */
import { supabase } from '../lib/ap-invoice/supabase';
import { requireCompanyId } from '../lib/ap-invoice/companyService';

export type CoaMappingRow = {
  category_key: string;
  category_label: string;
  gl_code: string;
  gl_name: string;
  sort_order: number;
  source: 'company' | 'default';
  company_override_id?: string | null;
};

/** Static fallback if DB seed not applied yet */
export const STATIC_DEFAULT_COA_MAPPING: Omit<CoaMappingRow, 'source' | 'company_override_id'>[] = [
  {
    category_key: 'standard_rated',
    category_label: 'Standard rated (5% VAT) — AP control',
    gl_code: '2100',
    gl_name: 'Accounts Payable',
    sort_order: 10,
  },
  {
    category_key: 'vat_input',
    category_label: 'VAT input recoverable (5%)',
    gl_code: '1810',
    gl_name: 'VAT Input Recoverable',
    sort_order: 20,
  },
  {
    category_key: 'zero_rated',
    category_label: 'Zero rated',
    gl_code: '2100',
    gl_name: 'Accounts Payable',
    sort_order: 30,
  },
  {
    category_key: 'exempt',
    category_label: 'Exempt',
    gl_code: '2100',
    gl_name: 'Accounts Payable',
    sort_order: 40,
  },
  {
    category_key: 'out_of_scope',
    category_label: 'Out of scope',
    gl_code: '2100',
    gl_name: 'Accounts Payable',
    sort_order: 50,
  },
  {
    category_key: 'blocked',
    category_label: 'Blocked / non-recoverable VAT (e.g. entertainment)',
    gl_code: '6500',
    gl_name: 'Non-Recoverable VAT Expense',
    sort_order: 60,
  },
];

const KEY_ALIASES: Record<string, string> = {
  standard: 'standard_rated',
  standardrated: 'standard_rated',
  'standard-rated': 'standard_rated',
  zerorated: 'zero_rated',
  'zero-rated': 'zero_rated',
  outofscope: 'out_of_scope',
  'out-of-scope': 'out_of_scope',
  non_recoverable: 'blocked',
  nonrecoverable: 'blocked',
  entertainment: 'blocked',
  vat_recoverable: 'vat_input',
  input_vat: 'vat_input',
};

export function normalizeCoaCategoryKey(raw: string | null | undefined): string | null {
  if (!raw || !String(raw).trim()) return null;
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, '_');
  if (KEY_ALIASES[s]) return KEY_ALIASES[s];
  const compact = s.replace(/[^a-z0-9_]/g, '');
  if (KEY_ALIASES[compact]) return KEY_ALIASES[compact];
  const known = STATIC_DEFAULT_COA_MAPPING.map((r) => r.category_key);
  if (known.includes(s)) return s;
  // ifrs_category sometimes embeds treatment words
  for (const k of known) {
    if (s.includes(k) || compact.includes(k.replace(/_/g, ''))) return k;
  }
  return null;
}

export async function loadEffectiveCoaMappings(companyId?: string | null): Promise<CoaMappingRow[]> {
  const cid = companyId ?? (await requireCompanyId().catch(() => null));

  let defaults = STATIC_DEFAULT_COA_MAPPING.map((r) => ({ ...r, source: 'default' as const }));
  try {
    const { data } = await supabase
      .from('default_coa_mapping')
      .select('category_key, category_label, gl_code, gl_name, sort_order, is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (data && data.length > 0) {
      defaults = data.map((r) => ({
        category_key: r.category_key,
        category_label: r.category_label || r.category_key,
        gl_code: r.gl_code,
        gl_name: r.gl_name,
        sort_order: r.sort_order ?? 0,
        source: 'default' as const,
      }));
    }
  } catch {
    /* use static */
  }

  if (!cid) return defaults;

  try {
    const { data: overrides } = await supabase
      .from('company_coa_mapping')
      .select('id, category_key, gl_code, gl_name, is_active')
      .eq('company_id', cid)
      .eq('is_active', true);

    const byKey = new Map((overrides || []).map((o) => [o.category_key, o]));
    return defaults.map((d) => {
      const o = byKey.get(d.category_key);
      if (!o) return { ...d, company_override_id: null };
      return {
        ...d,
        gl_code: o.gl_code,
        gl_name: o.gl_name,
        source: 'company' as const,
        company_override_id: o.id,
      };
    });
  } catch {
    return defaults;
  }
}

export function resolveGlFromMappings(
  mappings: CoaMappingRow[],
  categoryRaw: string | null | undefined,
): { gl_code: string; gl_name: string; category_key: string; source: 'company' | 'default' } | null {
  const key = normalizeCoaCategoryKey(categoryRaw);
  if (!key) return null;
  const row = mappings.find((m) => m.category_key === key);
  if (!row) return null;
  return {
    gl_code: row.gl_code,
    gl_name: row.gl_name,
    category_key: key,
    source: row.source,
  };
}

/** Prefer vat_treatment, then ifrs_category for COA map lookup. */
export function invoiceCoaCategoryKey(inv: {
  vat_treatment?: string | null;
  ifrs_category?: string | null;
}): string | null {
  return (
    normalizeCoaCategoryKey(inv.vat_treatment) ||
    normalizeCoaCategoryKey(inv.ifrs_category)
  );
}

export async function saveCompanyCoaOverride(input: {
  category_key: string;
  gl_code: string;
  gl_name: string;
}): Promise<void> {
  const companyId = await requireCompanyId();
  const { error } = await supabase.from('company_coa_mapping').upsert(
    {
      company_id: companyId,
      category_key: input.category_key,
      gl_code: input.gl_code.trim(),
      gl_name: input.gl_name.trim(),
      is_active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'company_id,category_key' },
  );
  if (error) throw new Error(error.message);
}

export async function resetCompanyCoaOverride(categoryKey: string): Promise<void> {
  const companyId = await requireCompanyId();
  const { error } = await supabase
    .from('company_coa_mapping')
    .delete()
    .eq('company_id', companyId)
    .eq('category_key', categoryKey);
  if (error) throw new Error(error.message);
}
