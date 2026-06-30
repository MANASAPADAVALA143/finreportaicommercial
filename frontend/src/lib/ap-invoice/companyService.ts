import { supabase } from './supabase';

export type SubscriptionTier = 'starter' | 'growth' | 'enterprise';

export interface Company {
  id: string;
  name: string;
  slug: string;
  industry: string;
  accounting_standard: string;
  logo_url: string | null;
  primary_color: string;
  subscription_tier: SubscriptionTier;
  subscription_status: string;
  trial_ends_at: string;
  max_invoices_per_month: number;
  max_users: number;
  price_inr_monthly: number | null;
  created_at?: string;
  updated_at?: string;
}

export type VendorRuleAction = 'auto_approve' | 'manual_review' | 'reject';

export interface CompanyConfigRow {
  id: string;
  company_id: string;
  approval_flow: unknown;
  vendor_rules: Record<string, VendorRuleAction> | null;
  gl_mapping: Record<string, string> | null;
  compliance_rules: Record<string, unknown> | null;
  agent_config: Record<string, unknown> | null;
  erp_config: Record<string, unknown> | null;
  notification_config: Record<string, unknown> | null;
  match_tolerance?: unknown;
  created_at?: string;
  updated_at?: string;
}

export const TIER_PRESETS: Record<
  SubscriptionTier,
  { price_inr_monthly: number; max_invoices_per_month: number; max_users: number }
> = {
  starter: { price_inr_monthly: 2999, max_invoices_per_month: 100, max_users: 3 },
  growth: { price_inr_monthly: 7999, max_invoices_per_month: 500, max_users: 10 },
  enterprise: { price_inr_monthly: 19999, max_invoices_per_month: -1, max_users: -1 },
};

let _companyCache: Company | null = null;
let _configCache: CompanyConfigRow | null = null;

function parseApprovalFlow(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x)).filter(Boolean);
  }
  return ['Finance Manager', 'CFO'];
}

export function clearCompanyCache() {
  _companyCache = null;
  _configCache = null;
}

/** Effective tenant company for the session (membership, JWT active company, or default slug for anon). */
export async function getMyCompany(): Promise<Company | null> {
  if (_companyCache) return _companyCache;

  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;

  if (user?.id) {
    // 1. Try company_members (primary path)
    const { data: rows, error } = await supabase
      .from('company_members')
      .select('company_id, companies(*)')
      .eq('user_id', user.id)
      .eq('is_active', true);

    if (error) console.warn('company_members:', error.message);

    const list = (rows ?? []) as Array<{ company_id: string; companies: Company | Company[] | null }>;
    const companies = list
      .map((r) => (Array.isArray(r.companies) ? r.companies[0] : r.companies))
      .filter((c): c is Company => c != null && typeof (c as Company).id === 'string');

    const meta = user.user_metadata as Record<string, unknown> | undefined;
    const activeId = typeof meta?.active_company_id === 'string' ? meta.active_company_id : null;
    if (activeId) {
      const picked = companies.find((c) => c.id === activeId);
      if (picked) {
        _companyCache = picked;
        return picked;
      }
    }

    // Multiple workspaces — pick the one with the most invoices (avoids empty list / wrong tenant)
    if (companies.length > 1) {
      let best: Company | null = null;
      let bestCount = -1;
      for (const c of companies) {
        const { count, error: countErr } = await supabase
          .from('invoices')
          .select('*', { count: 'exact', head: true })
          .eq('company_id', c.id);
        if (countErr) continue;
        const n = count ?? 0;
        if (n > bestCount) {
          bestCount = n;
          best = c;
        }
      }
      if (best && bestCount > 0) {
        _companyCache = best;
        if (best.id !== activeId) {
          await supabase.auth
            .updateUser({ data: { active_company_id: best.id } })
            .then(() => null, () => null);
        }
        return best;
      }
    }

    const picked = companies[0] ?? null;
    _companyCache = picked;
    if (picked) return picked;

    // 2. Fallback: check company_settings for this user's email
    const { data: cs } = await supabase
      .from('company_settings')
      .select('company_id')
      .limit(1)
      .maybeSingle();
    if (cs?.company_id) {
      const { data: co } = await supabase
        .from('companies')
        .select('*')
        .eq('id', cs.company_id)
        .maybeSingle();
      if (co) {
        _companyCache = co as Company;
        // Auto-link this user so future lookups work
        await supabase.from('company_members').upsert({
          company_id: cs.company_id,
          user_id: user.id,
          email: user.email ?? null,
          role: 'owner',
          is_active: true,
          joined_at: new Date().toISOString(),
        }, { onConflict: 'company_id,user_id' }).then(() => null).then(() => null, () => null);
        return _companyCache;
      }
    }

    // 3. Fallback: any single company in the database (demo / single-tenant mode)
    const { data: anyCompany } = await supabase
      .from('companies')
      .select('*')
      .limit(1)
      .maybeSingle();
    if (anyCompany) {
      _companyCache = anyCompany as Company;
      // Auto-link user
      await supabase.from('company_members').upsert({
        company_id: (anyCompany as Company).id,
        user_id: user.id,
        email: user.email ?? null,
        role: 'owner',
        is_active: true,
        joined_at: new Date().toISOString(),
      }, { onConflict: 'company_id,user_id' }).then(() => null, () => null);
      return _companyCache;
    }
  }

  // 4. Last resort: slug='my-company'
  const { data: def, error: defErr } = await supabase
    .from('companies')
    .select('*')
    .eq('slug', 'my-company')
    .maybeSingle();

  if (defErr) console.warn('default company:', defErr.message);
  _companyCache = (def as Company) ?? null;
  return _companyCache;
}

export type CompanyWithStats = Company & { invoice_count?: number };

export async function listMyCompanies(): Promise<CompanyWithStats[]> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user?.id) {
    const one = await getMyCompany();
    return one ? [one] : [];
  }
  const { data: rows, error } = await supabase
    .from('company_members')
    .select('companies(*)')
    .eq('user_id', user.id)
    .eq('is_active', true);
  if (error) {
    console.warn('listMyCompanies:', error.message);
    return [];
  }
  const out: CompanyWithStats[] = [];
  for (const r of rows ?? []) {
    const c = (r as { companies: Company | Company[] | null }).companies;
    const row = Array.isArray(c) ? c[0] : c;
    if (row?.id) out.push(row as CompanyWithStats);
  }
  await Promise.all(
    out.map(async (co) => {
      const { count } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', co.id);
      co.invoice_count = count ?? 0;
    }),
  );
  return out.sort((a, b) => (b.invoice_count ?? 0) - (a.invoice_count ?? 0));
}

const PAYMENT_LOG_ROLES = ['finance_manager', 'admin', 'owner', 'super_admin'] as const;

/** Role for the active company membership, if any. */
export async function getMyCompanyMemberRole(): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user?.id) return null;
  const company = await getMyCompany();
  if (!company?.id) return null;
  const { data, error } = await supabase
    .from('company_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('company_id', company.id)
    .eq('is_active', true)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { role: string }).role ?? null;
}

/** Payment Log is limited to finance_manager and above; viewers/approvers do not see it. */
export function canViewPaymentLog(role: string | null): boolean {
  if (role == null) return true;
  return (PAYMENT_LOG_ROLES as readonly string[]).includes(role);
}

export async function switchActiveCompany(companyId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) {
    throw new Error('Sign in required to switch companies.');
  }
  const { error } = await supabase.auth.updateUser({
    data: { active_company_id: companyId },
  });
  if (error) throw error;
  clearCompanyCache();
}

export async function getCompanyConfig(): Promise<CompanyConfigRow | null> {
  if (_configCache) return _configCache;
  const company = await getMyCompany();
  if (!company) return null;
  const { data, error } = await supabase.from('company_config').select('*').eq('company_id', company.id).maybeSingle();
  if (error) {
    console.warn('company_config:', error.message);
    return null;
  }
  _configCache = data as CompanyConfigRow;
  return _configCache;
}

export async function updateCompanyConfigJson(updates: Partial<CompanyConfigRow>) {
  const company = await getMyCompany();
  if (!company) throw new Error('No company found');
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const keys = [
    'approval_flow',
    'vendor_rules',
    'gl_mapping',
    'compliance_rules',
    'agent_config',
    'erp_config',
    'notification_config',
    'match_tolerance',
  ] as const;
  for (const k of keys) {
    if (k in updates && updates[k] !== undefined) payload[k] = updates[k];
  }
  const { error } = await supabase.from('company_config').update(payload).eq('company_id', company.id);
  if (error) throw error;
  clearCompanyCache();
}

export async function getVendorRule(vendorName: string): Promise<VendorRuleAction | null> {
  const config = await getCompanyConfig();
  if (!config?.vendor_rules) return null;
  const rules = config.vendor_rules;
  if (rules[vendorName]) return rules[vendorName];
  const key = Object.keys(rules).find((k) => vendorName.toLowerCase().includes(k.toLowerCase()));
  return key ? rules[key] : null;
}

export async function isVendorBlocked(vendorName: string): Promise<boolean> {
  const config = await getCompanyConfig();
  const cr = config?.compliance_rules as { blocked_vendors?: string[] } | null;
  const blocked = cr?.blocked_vendors ?? [];
  return blocked.some((v) => vendorName.toLowerCase().includes(v.toLowerCase()));
}

export async function getGLFromCompanyMapping(category: string): Promise<string | null> {
  const config = await getCompanyConfig();
  if (!config?.gl_mapping) return null;
  return config.gl_mapping[category] ?? null;
}

export async function inviteUserToCompany(companyId: string, email: string, role: string) {
  const { error } = await supabase.from('company_members').insert({
    company_id: companyId,
    email,
    role,
    invited_at: new Date().toISOString(),
    is_active: true,
  });
  if (error) throw error;
}

export async function getCompanyMembers() {
  const company = await getMyCompany();
  if (!company) return [];
  const { data, error } = await supabase
    .from('company_members')
    .select('*')
    .eq('company_id', company.id)
    .order('role');
  if (error) throw error;
  return data ?? [];
}

export async function isSuperAdmin(): Promise<boolean> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return false;
  const { data, error } = await supabase
    .from('company_members')
    .select('id')
    .eq('user_id', uid)
    .eq('is_active', true)
    .eq('role', 'super_admin')
    .maybeSingle();
  if (error) return false;
  return !!data;
}

/** Use on every insert into tenant-scoped tables. */
export async function requireCompanyId(): Promise<string> {
  const c = await getMyCompany();
  if (!c?.id) throw new Error('No company context — run MULTI-TENANT-MIGRATION.sql and ensure companies row exists.');
  return c.id;
}

export async function checkInvoiceLimit(): Promise<{
  allowed: boolean;
  used: number;
  limit: number;
  message?: string;
}> {
  const company = await getMyCompany();
  if (!company) return { allowed: false, used: 0, limit: 0, message: 'No company found.' };

  const tier = company.subscription_tier;
  const max = company.max_invoices_per_month;
  if (tier === 'enterprise' || max < 0) {
    return { allowed: true, used: 0, limit: -1 };
  }

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', company.id)
    .gte('created_at', startOfMonth.toISOString());

  if (error) {
    console.warn('checkInvoiceLimit:', error.message);
    return { allowed: true, used: 0, limit: max, message: undefined };
  }

  const used = count ?? 0;
  const allowed = used < max;
  return {
    allowed,
    used,
    limit: max,
    message: allowed ? undefined : `Monthly limit reached (${used}/${max}). Upgrade your plan to process more invoices.`,
  };
}

export async function createCompanyForClient(params: {
  name: string;
  industry: string;
  accounting_standard: string;
  tier: SubscriptionTier;
  ownerEmail?: string;
}): Promise<Company> {
  const preset = TIER_PRESETS[params.tier];
  const baseSlug = params.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const slug = `${baseSlug || 'client'}-${Date.now().toString(36)}`;

  const { data: company, error } = await supabase
    .from('companies')
    .insert({
      name: params.name,
      slug,
      industry: params.industry || 'general',
      accounting_standard: params.accounting_standard || 'IFRS',
      subscription_tier: params.tier,
      max_invoices_per_month: preset.max_invoices_per_month,
      max_users: preset.max_users,
      price_inr_monthly: preset.price_inr_monthly,
    })
    .select()
    .single();

  if (error) throw error;

  const { error: cfgErr } = await supabase.from('company_config').insert({ company_id: company.id });
  if (cfgErr) console.warn('company_config insert:', cfgErr.message);

  if (params.ownerEmail?.trim()) {
    await supabase.from('company_members').insert({
      company_id: company.id,
      email: params.ownerEmail.trim(),
      role: 'owner',
      invited_at: new Date().toISOString(),
      is_active: true,
    });
  }

  clearCompanyCache();
  return company as Company;
}

export async function fetchAllCompaniesAdmin(): Promise<Company[]> {
  if (!(await isSuperAdmin())) return [];
  const { data, error } = await supabase.from('companies').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Company[];
}

export { parseApprovalFlow };
