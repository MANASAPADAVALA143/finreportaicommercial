import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import { getMyCompany, getCompanyConfig } from './companyService';
import { getAgentAutonomyConfig } from './agentConfigService';
import { logAction, getInvoiceflowWorkEmail } from './auditService';
import { deriveInvoiceRiskDisplayScore } from './invoiceRiskDisplay';
import type { Invoice } from './supabase';

export interface MatchTolerance {
  price_variance_pct: number;
  qty_variance_pct: number;
  tax_variance_inr: number;
  auto_approve_on_full_match: boolean;
  require_grn_for_match: boolean;
  auto_match_on_upload: boolean;
}

export type EngineMatchStatus =
  | 'full_match'
  | 'partial_match'
  | 'amount_variance'
  | 'qty_variance'
  | 'no_po'
  | 'no_grn'
  | 'failed'
  | 'skipped';

export interface MatchChecks {
  vendor_match: boolean;
  po_exists: boolean;
  grn_exists: boolean;
  amount_match: boolean;
  within_price_tolerance: boolean;
  within_qty_tolerance: boolean;
  grn_matches_po: boolean;
}

export interface AutoMatchRunResult {
  engine_status: EngineMatchStatus;
  /** Invoice row `match_status` after persistence */
  invoice_match_status: Invoice['match_status'];
  score: number;
  within_tolerance: boolean;
  auto_approved: boolean;
  checks: MatchChecks;
  invoice_amount: number;
  po_amount: number;
  grn_amount: number;
  amount_variance_pct: number;
  summary: string;
  exceptions: string[];
  skipped?: boolean;
  skip_reason?: string;
}

function escapeIlike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/[%_]/g, '\\$&');
}

/** POs invoices can still match to (Closed/Cancelled excluded). Vendor fallback used to require Open only, which broke after GRNs moved POs to Partially/Fully Received. */
const MATCHABLE_PO_STATUSES: string[] = ['Open', 'Partially Received', 'Fully Received'];

function getDefaultTolerance(): MatchTolerance {
  return {
    price_variance_pct: 3,
    qty_variance_pct: 2,
    tax_variance_inr: 250,
    auto_approve_on_full_match: true,
    require_grn_for_match: false,
    auto_match_on_upload: true,
  };
}

function coerceTolerance(raw: unknown): MatchTolerance {
  const d = getDefaultTolerance();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;
  return {
    price_variance_pct: Number(o.price_variance_pct ?? d.price_variance_pct),
    qty_variance_pct: Number(o.qty_variance_pct ?? d.qty_variance_pct),
    tax_variance_inr: Number(o.tax_variance_inr ?? d.tax_variance_inr),
    auto_approve_on_full_match: Boolean(o.auto_approve_on_full_match ?? d.auto_approve_on_full_match),
    require_grn_for_match: Boolean(o.require_grn_for_match ?? d.require_grn_for_match),
    auto_match_on_upload: Boolean(o.auto_match_on_upload ?? d.auto_match_on_upload),
  };
}

export async function getMatchTolerance(): Promise<MatchTolerance> {
  const cfg = await getCompanyConfig();
  return coerceTolerance(cfg?.match_tolerance);
}

async function getCompanyBaseCurrency(companyId: string): Promise<string> {
  const { data } = await supabase
    .from('company_settings')
    .select('base_currency')
    .eq('company_id', companyId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const c = data?.base_currency;
  return typeof c === 'string' && c.trim() ? c.trim().toUpperCase() : 'INR';
}

/** Approximate invoice amount in INR for agent threshold checks. */
function invoiceAmountInInr(
  inv: Pick<Invoice, 'total_amount' | 'currency' | 'exchange_rate_to_base'>,
  baseCurrency: string
): number | null {
  const amt = Number(inv.total_amount);
  const cur = (inv.currency || 'USD').toUpperCase();
  if (cur === 'INR') return amt;
  if (baseCurrency.toUpperCase() === 'INR' && inv.exchange_rate_to_base != null) {
    return amt * Number(inv.exchange_rate_to_base);
  }
  return null;
}

/** Net amount for PO match — invoice total_amount is gross; PO po_amount is ex-VAT. */
function netInvoiceAmountForMatch(inv: Invoice): number {
  const gross = Number(inv.total_amount ?? 0);
  const vat = Number((inv as Record<string, unknown>).vat_amount ?? inv.tax_amount ?? 0);
  if (vat > 0 && gross > vat) return gross - vat;
  const rate = Number(inv.tax_rate ?? (inv as Record<string, unknown>).vat_rate ?? 0);
  if (rate > 0) return gross / (1 + rate / 100);
  const sub = Number(inv.subtotal_amount ?? 0);
  if (sub > 0 && sub < gross * 0.99) return sub;
  return gross;
}

function vendorTokensMatch(a: string, b: string): boolean {
  const av = a.trim().toLowerCase();
  const bv = b.trim().toLowerCase();
  if (!av || !bv) return false;
  const aw = av.split(/\s+/)[0] || '';
  const bw = bv.split(/\s+/)[0] || '';
  return av.includes(bv) || bv.includes(av) || (aw.length > 2 && bv.includes(aw)) || (bw.length > 2 && av.includes(bw));
}

/** Numeric 0–100 risk for agent threshold checks (GulfTax score preferred). */
function resolveNumericRiskScore(invoice: Invoice): number | null {
  if (typeof invoice.gulftax_risk_score === 'number' && Number.isFinite(invoice.gulftax_risk_score)) {
    return Math.round(invoice.gulftax_risk_score);
  }
  return deriveInvoiceRiskDisplayScore(invoice);
}

async function vendorHasPriorApprovedInvoice(
  companyId: string,
  vendorName: string,
  excludeInvoiceId: string,
): Promise<boolean> {
  const vn = vendorName?.trim();
  if (!vn) return false;
  const { count, error } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('vendor_name', vn)
    .eq('status', 'Approved')
    .neq('id', excludeInvoiceId);
  if (error) {
    console.warn('[threeWayMatchService] prior vendor history check failed:', error.message);
    return true;
  }
  return (count ?? 0) > 0;
}

/** Duplicate signals already on the row or a matching approved invoice for same vendor+number. */
async function invoiceHasDuplicateSignal(invoice: Invoice, companyId: string): Promise<boolean> {
  if (invoice.duplicate_flag === true) return true;
  if (invoice.duplicate_of_id) return true;

  const invNum = (invoice.invoice_number || '').trim();
  const vendor = (invoice.vendor_name || '').trim();
  if (!invNum || !vendor) return false;

  const { data, error } = await supabase
    .from('invoices')
    .select('id')
    .eq('company_id', companyId)
    .eq('invoice_number', invNum)
    .eq('vendor_name', vendor)
    .neq('id', invoice.id)
    .in('status', ['Approved', 'Paid', 'Processing', 'On Hold', 'Queried'])
    .limit(1);
  if (error) {
    console.warn('[threeWayMatchService] duplicate check failed:', error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

const GATE_REASON_MESSAGES: Record<string, string> = {
  high_value_threshold: 'Invoice exceeds high-value auto-approve threshold',
  risk_score_exceeds_threshold: 'Risk score exceeds threshold',
  risk_score_high: 'Risk score is high',
  new_vendor_requires_human: 'New vendor — first invoice requires human approval',
  potential_duplicate_detected: 'Potential duplicate detected',
  duplicate_flag: 'Potential duplicate detected',
  critical_risk_flag: 'Critical risk flag present',
  ocr_below_min_confidence: 'OCR confidence below minimum for auto-approve',
};

function gateReasonMessage(code: string | undefined): string {
  if (!code) return 'Agent rules blocked auto-approve';
  return GATE_REASON_MESSAGES[code] ?? code.replace(/_/g, ' ');
}

/**
 * Flag invoices pending longer than sla_hours_before_escalation (does not block approval).
 * Natural call sites: InvoiceList.fetchInvoices, ActionQueue.load, MyApprovals refresh.
 */
export async function markEscalationDueIfNeeded(
  invoices: Invoice[],
  _companyId?: string | null,
): Promise<void> {
  const agent = await getAgentAutonomyConfig();
  const slaHours = agent.sla_hours_before_escalation;
  if (!slaHours || slaHours <= 0) return;

  const now = Date.now();
  const due = invoices.filter((inv) => {
    if (inv.status !== 'Processing' && inv.status !== 'On Hold' && inv.status !== 'Queried') {
      return false;
    }
    if (inv.approval_status === 'approved' || inv.approval_status === 'rejected') return false;
    const anchor = inv.submitted_for_approval_at || inv.created_at;
    if (!anchor) return false;
    const hoursPending = (now - new Date(anchor).getTime()) / 3_600_000;
    return hoursPending >= slaHours;
  });

  for (const inv of due) {
    const existing = Array.isArray(inv.risk_flags) ? inv.risk_flags : [];
    if (
      existing.some(
        (f) => f && typeof f === 'object' && String((f as { type?: string }).type) === 'sla_escalation',
      )
    ) {
      continue;
    }
    const nextFlags = [
      ...existing,
      {
        type: 'sla_escalation',
        severity: 'high' as const,
        message: `Pending approval over ${slaHours}h — escalation review required`,
      },
    ];
    await supabase
      .from('invoices')
      .update({ risk_flags: nextFlags, updated_at: new Date().toISOString() })
      .eq('id', inv.id);
  }
}

async function canAgentAutoApprove(
  invoice: Invoice,
  companyId: string
): Promise<{ ok: boolean; reason?: string }> {
  const agent = await getAgentAutonomyConfig();
  const base = await getCompanyBaseCurrency(companyId);
  const inInr = invoiceAmountInInr(invoice, base);

  if (inInr != null && inInr > agent.high_value_threshold_inr) {
    return { ok: false, reason: 'high_value_threshold' };
  }

  const numericRisk = resolveNumericRiskScore(invoice);
  if (numericRisk != null && numericRisk > agent.auto_approve_max_risk_score) {
    return { ok: false, reason: 'risk_score_exceeds_threshold' };
  }
  // risk_score may be numeric (DB) or legacy tier string ('high'|'medium'|'low')
  const risk = String(invoice.risk_score ?? '').toLowerCase();
  const riskLevel = String(invoice.risk_level ?? '').toLowerCase();
  if (risk === 'high' || riskLevel === 'high') {
    return { ok: false, reason: 'risk_score_high' };
  }

  if (agent.require_human_duplicate) {
    if (invoice.duplicate_flag) {
      return { ok: false, reason: 'duplicate_flag' };
    }
    if (await invoiceHasDuplicateSignal(invoice, companyId)) {
      return { ok: false, reason: 'potential_duplicate_detected' };
    }
  }

  if (agent.require_human_new_vendor) {
    const hasPrior = await vendorHasPriorApprovedInvoice(
      companyId,
      invoice.vendor_name,
      invoice.id,
    );
    if (!hasPrior) {
      return { ok: false, reason: 'new_vendor_requires_human' };
    }
  }

  if (agent.require_human_critical_risk && Array.isArray(invoice.risk_flags)) {
    const critical = invoice.risk_flags.some(
      (f) => f && typeof f === 'object' && String(f.severity).toLowerCase() === 'critical'
    );
    if (critical) return { ok: false, reason: 'critical_risk_flag' };
  }
  const ocr = invoice.ocr_confidence != null ? Number(invoice.ocr_confidence) : 100;
  if (ocr < agent.auto_approve_min_confidence) {
    return { ok: false, reason: 'ocr_below_min_confidence' };
  }
  return { ok: true };
}

function mapEngineToInvoiceStatus(
  engine: EngineMatchStatus,
  grnExists: boolean
): Invoice['match_status'] {
  switch (engine) {
    case 'full_match':
      return grnExists ? 'three_way_matched' : 'matched';
    case 'partial_match':
      return 'matched';
    case 'no_po':
      return 'no_po';
    case 'no_grn':
      return 'partial';
    case 'amount_variance':
    case 'qty_variance':
    case 'failed':
      return 'mismatch';
    case 'skipped':
    default:
      return null;
  }
}

export type RunAutoMatchOptions = {
  /** When true (default), honour `auto_match_on_upload` = false and exit without DB writes. */
  respectUploadSetting?: boolean;
};

/**
 * Runs PO / GRN / invoice tolerance match, logs `match_results`, updates invoice.
 * Does not throw on missing tables — logs and rethrows only for unexpected errors.
 */
export async function runAutoMatch(
  invoiceId: string,
  options: RunAutoMatchOptions = {}
): Promise<AutoMatchRunResult> {
  const respectUploadSetting = options.respectUploadSetting !== false;
  const tolerance = await getMatchTolerance();
  const company = await getMyCompany();

  if (respectUploadSetting && !tolerance.auto_match_on_upload) {
    return {
      engine_status: 'skipped',
      invoice_match_status: null,
      score: 0,
      within_tolerance: false,
      auto_approved: false,
      checks: {
        vendor_match: false,
        po_exists: false,
        grn_exists: false,
        amount_match: false,
        within_price_tolerance: false,
        within_qty_tolerance: false,
        grn_matches_po: false,
      },
      invoice_amount: 0,
      po_amount: 0,
      grn_amount: 0,
      amount_variance_pct: 0,
      summary: 'Auto-match on upload is disabled for this company.',
      exceptions: [],
      skipped: true,
      skip_reason: 'auto_match_on_upload_disabled',
    };
  }

  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .single();

  if (invErr || !invoice) {
    throw new Error('Invoice not found');
  }

  const inv = invoice as Invoice;
  const exceptions: string[] = [];
  const checks: MatchChecks = {
    vendor_match: false,
    po_exists: false,
    grn_exists: false,
    amount_match: false,
    within_price_tolerance: false,
    within_qty_tolerance: false,
    grn_matches_po: true,
  };

  let po: Record<string, unknown> | null = null;
  let grn: Record<string, unknown> | null = null;
  let grnLineItems: Array<{ total_value?: number | null }> = [];
  let poAmount = 0;
  let grnAmount = 0;
  let invoiceAmount = netInvoiceAmountForMatch(inv);

  const companyId = company?.id ?? inv.company_id ?? null;

  const trimmedPo = String(inv.po_number || '').trim();
  if (trimmedPo && companyId) {
    const exact = await supabase
      .from('purchase_orders')
      .select('*')
      .eq('company_id', companyId)
      .eq('po_number', trimmedPo)
      .maybeSingle();
    if (exact.data) po = exact.data as Record<string, unknown>;
    if (!po) {
      const ci = await supabase
        .from('purchase_orders')
        .select('*')
        .eq('company_id', companyId)
        .ilike('po_number', trimmedPo)
        .limit(1);
      if (ci.data?.[0]) po = ci.data[0] as Record<string, unknown>;
    }
  }

  if (!po && inv.vendor_name && companyId) {
    const v = escapeIlike(String(inv.vendor_name).trim());
    const { data: vendorPOs } = await supabase
      .from('purchase_orders')
      .select('*')
      .eq('company_id', companyId)
      .ilike('vendor_name', `%${v}%`)
      .in('status', MATCHABLE_PO_STATUSES)
      .order('created_at', { ascending: false })
      .limit(12);

    if (vendorPOs?.length) {
      po = vendorPOs.reduce<(typeof vendorPOs)[0] | null>((best, curr) => {
        const cAmt = Number(curr.po_amount ?? 0);
        const bAmt = best ? Number(best.po_amount ?? 0) : NaN;
        const currDiff = Math.abs(cAmt - invoiceAmount);
        const bestDiff = best != null && !Number.isNaN(bAmt) ? Math.abs(bAmt - invoiceAmount) : Infinity;
        return currDiff < bestDiff ? curr : best;
      }, null) as Record<string, unknown> | null;
    }
  }

  if (po) {
    checks.po_exists = true;
    poAmount = Number(po.po_amount ?? 0);

    // UAE: when vat/tax not stored, gross is often exactly PO net + 5% VAT (e.g. 8190 vs 7800).
    if (poAmount > 0 && invoiceAmount > poAmount && Math.abs(invoiceAmount / poAmount - 1.05) < 0.01) {
      invoiceAmount = Math.round((invoiceAmount / 1.05) * 100) / 100;
    }

    const invoiceVendor = String(inv.vendor_name ?? '');
    const poVendor = String(po.vendor_name ?? '');
    checks.vendor_match = vendorTokensMatch(invoiceVendor, poVendor);
    if (!checks.vendor_match) {
      exceptions.push(`Vendor mismatch: Invoice "${invoiceVendor}" vs PO "${poVendor}"`);
    }

    const poId = String(po.id);

    let grnQ = supabase
      .from('goods_receipts')
      .select('*, grn_line_items(*)')
      .eq('po_id', poId)
      .order('received_date', { ascending: false })
      .limit(8);
    if (companyId) grnQ = grnQ.eq('company_id', companyId);
    let { data: grnRows, error: grnFetchErr } = await grnQ;
    if (grnFetchErr) {
      let q2 = supabase
        .from('goods_receipts')
        .select('*')
        .eq('po_id', poId)
        .order('received_date', { ascending: false })
        .limit(8);
      if (companyId) q2 = q2.eq('company_id', companyId);
      const r2 = await q2;
      grnRows = r2.data;
    }

    // Fallback: if no GRN found by po_id, try by vendor name
    // (handles case where GRN was imported before PO existed, so po_id is null)
    if ((!grnRows || grnRows.length === 0) && inv.vendor_name && companyId) {
      const vv = escapeIlike(String(inv.vendor_name).trim());
      let qVendor = supabase
        .from('goods_receipts')
        .select('*, grn_line_items(*)')
        .ilike('vendor_name', `%${vv}%`)
        .order('received_date', { ascending: false })
        .limit(4);
      qVendor = qVendor.eq('company_id', companyId);
      const { data: vendorGrns } = await qVendor;
      if (vendorGrns?.length) {
        grnRows = vendorGrns;
        // Backfill po_id on orphaned GRNs so future lookups work instantly
        for (const g of vendorGrns) {
          if (!(g as Record<string, unknown>).po_id && poId) {
            void supabase
              .from('goods_receipts')
              .update({ po_id: poId })
              .eq('id', (g as Record<string, unknown>).id as string)
              .then(() => null, () => null);
          }
        }
      }
    }

    const list = grnRows ?? [];
    const confirmed = list.find((g) => (g as { status?: string }).status === 'confirmed');
    const legacyOpen = list.find((g) => !(g as { status?: string }).status);
    grn = (confirmed || legacyOpen || list[0] || null) as Record<string, unknown> | null;

    if (grn) {
      const rawItems = (grn as { grn_line_items?: unknown }).grn_line_items;
      grnLineItems = Array.isArray(rawItems) ? (rawItems as typeof grnLineItems) : [];
      const fromLines = grnLineItems.reduce((s, li) => s + Number(li.total_value ?? 0), 0);
      const gRow = grn as Record<string, unknown>;
      const headerAmt = Number(gRow.received_amount ?? gRow.grn_amount ?? 0);
      /* Prefer header total when set (bulk import / ERP totals); line sum can be wrong if import mapped qty/price badly.
         UAE GRN imports often put gross in header `total_amount` and net in line items — use net for PO match. */
      if (headerAmt > 0) {
        grnAmount = fromLines > 0 && fromLines < headerAmt * 0.99 ? fromLines : headerAmt;
        if (fromLines > 0 && Math.abs(fromLines - headerAmt) > Math.max(1, 0.02 * headerAmt)) {
          exceptions.push(
            `GRN line sum (${fromLines}) differs from receipt header total (${headerAmt}); matching uses header total.`
          );
        }
      } else {
        grnAmount = fromLines;
      }
      checks.grn_exists = grnAmount > 0;
    }

    if (grn && poAmount > 0 && grnAmount > 0) {
      const grnVsPoPct = Math.abs((grnAmount - poAmount) / poAmount) * 100;
      checks.grn_matches_po = grnVsPoPct <= tolerance.price_variance_pct;
      if (!checks.grn_matches_po) {
        exceptions.push(
          `GRN total differs from PO by ${grnVsPoPct.toFixed(1)}% (limit ${tolerance.price_variance_pct}%)`
        );
      }
    } else {
      checks.grn_matches_po = true;
    }

    if (tolerance.require_grn_for_match && (!grn || grnAmount <= 0)) {
      exceptions.push('No confirmed GRN with value — goods receipt required before payment');
    }

    const priceDiffPct =
      poAmount > 0 ? (Math.abs((invoiceAmount - poAmount) / poAmount) * 100) : 100;
    checks.within_price_tolerance = priceDiffPct <= tolerance.price_variance_pct;
    checks.amount_match = priceDiffPct === 0;
    if (!checks.within_price_tolerance) {
      exceptions.push(
        `Price variance ${priceDiffPct.toFixed(1)}% exceeds ${tolerance.price_variance_pct}% (Invoice vs PO)`
      );
    }

    if (grn && grnAmount > 0) {
      const invGrnPct =
        Math.max(invoiceAmount, grnAmount) > 0
          ? (Math.abs(invoiceAmount - grnAmount) / Math.max(invoiceAmount, grnAmount)) * 100
          : 0;
      checks.within_qty_tolerance = invGrnPct <= tolerance.qty_variance_pct;
      if (!checks.within_qty_tolerance) {
        exceptions.push(
          `Invoice vs GRN variance ${invGrnPct.toFixed(1)}% exceeds ${tolerance.qty_variance_pct}%`
        );
      }
    } else {
      checks.within_qty_tolerance = true;
    }
  } else {
    exceptions.push(
      `No PO found for invoice ${inv.invoice_number ?? invoiceId} (${inv.vendor_name ?? 'unknown vendor'})`
    );
  }

  const passedChecks = Object.values(checks).filter(Boolean).length;
  const totalChecks = Object.keys(checks).length;
  const score = Math.round((passedChecks / totalChecks) * 100);

  const amount_variance_pct =
    poAmount > 0 ? Math.abs((invoiceAmount - poAmount) / poAmount) * 100 : 0;

  const withinTolerance =
    !!checks.po_exists &&
    checks.vendor_match &&
    checks.within_price_tolerance &&
    checks.grn_matches_po &&
    (checks.within_qty_tolerance || !checks.grn_exists) &&
    (!tolerance.require_grn_for_match || checks.grn_exists);

  let engine: EngineMatchStatus;
  let summary: string;

  if (!checks.po_exists) {
    engine = 'no_po';
    summary = 'No matching purchase order found. Link a PO or create one in Purchase Orders.';
  } else if (tolerance.require_grn_for_match && !checks.grn_exists) {
    engine = 'no_grn';
    summary = `PO ${String(po?.po_number ?? '')} found — waiting for a confirmed goods receipt.`;
  } else if (withinTolerance && checks.grn_exists) {
    engine = 'full_match';
    summary = `Full 3-way match: PO ${String(po?.po_number ?? '')} · GRN ${String((grn as { grn_number?: string })?.grn_number ?? '')} · within tolerance`;
  } else if (withinTolerance) {
    engine = 'partial_match';
    summary = `2-way match: PO ${String(po?.po_number ?? '')} · within tolerance · no GRN required`;
  } else if (!checks.within_price_tolerance) {
    engine = 'amount_variance';
    summary = 'Amount variance exceeds tolerance — manual review required.';
  } else if (!checks.within_qty_tolerance) {
    engine = 'qty_variance';
    summary = 'Invoice vs GRN variance exceeds tolerance — manual review required.';
  } else if (!checks.grn_matches_po) {
    engine = 'failed';
    summary = exceptions[0] ?? 'GRN does not match PO within tolerance.';
  } else {
    engine = 'failed';
    summary = exceptions[0] ?? 'Match failed — manual review required.';
  }

  const grnExists = !!checks.grn_exists;
  const invoiceMatchStatus = mapEngineToInvoiceStatus(engine, grnExists);

  let autoApproved =
    withinTolerance &&
    tolerance.auto_approve_on_full_match &&
    (engine === 'full_match' || engine === 'partial_match');

  if (autoApproved && companyId) {
    const gate = await canAgentAutoApprove(inv, companyId);
    if (!gate.ok) {
      autoApproved = false;
      exceptions.push(`Auto-approve blocked: ${gateReasonMessage(gate.reason)}`);
    }
  }

  const diff = Math.abs(invoiceAmount - poAmount);
  const qty_variance_pct =
    grnAmount > 0 ? (Math.abs(invoiceAmount - grnAmount) / Math.max(invoiceAmount, grnAmount)) * 100 : 0;

  const checksJson = { ...checks } as Record<string, unknown>;

  const { data: savedResult, error: saveErr } = await supabase
    .from('match_results')
    .insert({
      company_id: companyId,
      invoice_id: invoiceId,
      po_id: (po?.id as string) ?? null,
      grn_id: (grn?.id as string) ?? null,
      match_status: engine,
      match_score: score,
      invoice_amount: invoiceAmount,
      po_amount: poAmount,
      grn_amount: grnAmount,
      amount_variance_pct,
      qty_variance_pct,
      within_tolerance: withinTolerance,
      auto_approved: autoApproved,
      checks: checksJson,
    })
    .select('id')
    .single();

  if (saveErr) {
    console.warn('[threeWayMatchService] match_results insert:', saveErr.message);
  }

  const notesParts = [summary, ...exceptions.filter((e) => e && e !== summary)];
  const matchNotes = notesParts.filter(Boolean).join('\n');

  const updatePayload: Record<string, unknown> = {
    po_id: (po?.id as string) ?? inv.po_id ?? null,
    grn_id: (grn?.id as string) ?? null,
    match_status: invoiceMatchStatus,
    match_score: score,
    match_notes: matchNotes,
    match_result_id: savedResult?.id ?? null,
    auto_matched: true,
    match_attempted_at: new Date().toISOString(),
    grn_confirmed: invoiceMatchStatus === 'three_way_matched',
    match_difference: diff,
    match_percentage: Number(amount_variance_pct.toFixed(2)),
    po_amount: poAmount,
    grn_amount: grnAmount > 0 ? grnAmount : null,
    po_number: (po?.po_number as string) ?? inv.po_number,
    updated_at: new Date().toISOString(),
  };

  if (autoApproved) {
    updatePayload.approval_status = 'approved';
    updatePayload.status = 'Approved';
    updatePayload.approved_at = new Date().toISOString();
    /* invoices.approved_by is uuid in DB — never use a string label here */
    updatePayload.approved_by = null;
  }

  const { error: upErr } = await supabase.from('invoices').update(updatePayload).eq('id', invoiceId);

  if (upErr) {
    console.warn('[threeWayMatchService] invoice update:', upErr.message);
  }

  // invoiceId is always in scope here — no need for invRow fields for WhatsApp.
  if (autoApproved && !upErr) {
    void import('./whatsappService').then(({ notifyVendorStatusByInvoiceId }) => {
      void notifyVendorStatusByInvoiceId(invoiceId, 'Approved');
    });
  }

  if (autoApproved && companyId) {
    try {
      const { data: invRow } = await supabase.from('invoices').select('*').eq('id', invoiceId).single();
      if (invRow) {
        const { triggerGlPostForApprovedInvoice } = await import('./glPostService');
        triggerGlPostForApprovedInvoice(invRow as import('./supabase').Invoice, companyId);
      }
    } catch {
      /* GL post is best-effort */
    }
  }

  if (companyId) {
    logAction('invoice.matched', 'invoice', invoiceId, getInvoiceflowWorkEmail() || 'system-auto-match', {
      engine_status: engine,
      score,
      auto_approved: autoApproved,
      po_id: po?.id ?? null,
    });
  }

  return {
    engine_status: engine,
    invoice_match_status: invoiceMatchStatus,
    score,
    within_tolerance: withinTolerance,
    auto_approved: autoApproved,
    checks,
    invoice_amount: invoiceAmount,
    po_amount: poAmount,
    grn_amount: grnAmount,
    amount_variance_pct,
    summary,
    exceptions,
  };
}

/** Human-readable toast description after upload / GRN confirm */
export function autoMatchToastMessage(result: AutoMatchRunResult): string {
  if (result.skipped) return result.summary;
  if (result.engine_status === 'full_match' || result.engine_status === 'partial_match') {
    return result.engine_status === 'full_match'
      ? `Auto-matched ✓ ${result.summary}`
      : `Invoice 2-way matched ✓ ${result.summary}`;
  }
  if (result.engine_status === 'no_po') return 'No PO found — invoice in review queue';
  if (result.engine_status === 'amount_variance') {
    return `Amount variance ${result.amount_variance_pct.toFixed(1)}% — sent for review`;
  }
  if (result.engine_status === 'no_grn') return 'PO found — waiting for goods receipt (GRN)';
  return result.summary || 'Match complete — review recommended';
}

export async function runBulkAutoMatch(): Promise<{ matched: number; failed: number }> {
  const company = await getMyCompany();
  if (!company?.id) return { matched: 0, failed: 0 };

  const { data: invoices } = await supabase
    .from('invoices')
    .select('id')
    .eq('company_id', company.id)
    .or('auto_matched.eq.false,auto_matched.is.null')
    .neq('approval_status', 'approved');

  let matched = 0;
  let failed = 0;

  for (const row of invoices ?? []) {
    try {
      const r = await runAutoMatch(row.id, { respectUploadSetting: false });
      if (r.skipped) continue;
      if (r.within_tolerance) matched++;
      else failed++;
    } catch {
      failed++;
    }
  }

  return { matched, failed };
}

export async function createGRN(params: {
  po_id: string | null;
  vendor_name: string;
  receipt_date: string;
  received_by: string;
  line_items: Array<{
    description: string;
    ordered_qty: number;
    received_qty: number;
    unit_price: number;
    condition?: string;
  }>;
  notes?: string;
}): Promise<string> {
  const company = await getMyCompany();
  if (!company?.id) throw new Error('No company');

  let grnNum: string | null = null;
  const { data: rpcNum, error: rpcErr } = await supabase.rpc('next_grn_number');
  if (!rpcErr && rpcNum != null) grnNum = String(rpcNum);

  if (!grnNum) {
    grnNum = `GRN-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
  }

  const lineSum = params.line_items.reduce(
    (s, li) => s + Number(li.received_qty) * Number(li.unit_price),
    0
  );

  const { data: grn, error } = await supabase
    .from('goods_receipts')
    .insert({
      company_id: company.id,
      grn_number: grnNum,
      po_id: params.po_id,
      vendor_name: params.vendor_name,
      received_amount: lineSum,
      received_date: params.receipt_date,
      status: 'confirmed',
      received_by: params.received_by,
      notes: params.notes ?? '',
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) throw error;

  const grnId = grn.id as string;

  const rows = params.line_items.map((li) => ({
    grn_id: grnId,
    description: li.description,
    ordered_qty: li.ordered_qty,
    received_qty: li.received_qty,
    unit_price: li.unit_price,
    condition: li.condition && ['good', 'damaged', 'partial', 'rejected'].includes(li.condition) ? li.condition : 'good',
  }));

  if (rows.length > 0) {
    const { error: liErr } = await supabase.from('grn_line_items').insert(rows);
    if (liErr) console.warn('[createGRN] line items:', liErr.message);
  }

  return grnId;
}

/** Re-run auto-match for invoices tied to this PO (by `po_id` or `po_number`). */
export async function rerunAutoMatchForPo(poId: string, poNumber: string): Promise<
  { invoiceId: string; invoice_number: string | null; result: AutoMatchRunResult }[]
> {
  const company = await getMyCompany();
  if (!company?.id) return [];

  const { data: byId } = await supabase
    .from('invoices')
    .select('id, invoice_number')
    .eq('company_id', company.id)
    .eq('po_id', poId);

  const { data: byNum } = await supabase
    .from('invoices')
    .select('id, invoice_number')
    .eq('company_id', company.id)
    .eq('po_number', poNumber.trim());

  const map = new Map<string, { id: string; invoice_number: string | null }>();
  for (const r of [...(byId ?? []), ...(byNum ?? [])]) {
    map.set(r.id, { id: r.id, invoice_number: r.invoice_number });
  }

  const out: { invoiceId: string; invoice_number: string | null; result: AutoMatchRunResult }[] = [];
  for (const { id, invoice_number } of map.values()) {
    try {
      const result = await runAutoMatch(id, { respectUploadSetting: false });
      out.push({ invoiceId: id, invoice_number, result });
    } catch (e) {
      console.warn('[rerunAutoMatchForPo]', id, e);
    }
  }
  return out;
}

export async function getGRNsForPO(poId: string) {
  const { data } = await supabase
    .from('goods_receipts')
    .select('*, grn_line_items(*)')
    .eq('po_id', poId)
    .order('received_date', { ascending: false });
  return data ?? [];
}

export async function listGoodsReceiptsForCompany() {
  const company = await getMyCompany();
  if (!company?.id) return [];
  const nested = await supabase
    .from('goods_receipts')
    .select('*, grn_line_items(*)')
    .eq('company_id', company.id)
    .order('received_date', { ascending: false });
  if (!nested.error) return nested.data ?? [];
  const flat = await supabase
    .from('goods_receipts')
    .select('*')
    .eq('company_id', company.id)
    .order('received_date', { ascending: false });
  return flat.data ?? [];
}

// --- Bulk GRN import (CSV / Excel) ------------------------------------------

export interface GRNImportRow {
  grn_number: string;
  grn_date: string;
  po_number: string;
  invoice_number: string;
  vendor_name: string;
  received_by: string;
  status: string;
  notes: string;
  /**
   * Optional master-sheet receipt total (e.g. "Received Amount", "GRN Total").
   * When line items import with unit_price = 0, bulk import spreads this across lines by qty so 3-way match sees a non-zero GRN total.
   */
  received_total?: number;
}

export interface GRNLineImportRow {
  grn_number: string;
  description: string;
  ordered_qty: number;
  received_qty: number;
  unit_price: number;
  condition: string;
}

export interface BulkImportGRNResult {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  matched: number;
  errors: Array<{ grn_number: string; error: string }>;
  results: Array<{
    grn_number: string;
    invoice_number: string;
    match_status: string;
    auto_approved: boolean;
    warning?: string;
  }>;
}

function cellStr(v: unknown): string {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && !Number.isNaN(v)) return String(v);
  return String(v).trim();
}

/** Parse qty/price cells from CSV/Excel (commas, ₹/$/spaces). */
function parseImportNumber(raw: string): number {
  const t = raw.replace(/,/g, '').replace(/[\s$€£₹]/g, '').trim();
  if (!t) return NaN;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : NaN;
}

/** Normalize Excel/CSV header for matching (handles "Unit Price (INR)", "PO #", etc.). */
function normHeaderKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[\s#._\-/]/g, '');
}

function pickRow(r: Record<string, unknown>, ...aliases: string[]): string {
  const keys = Object.keys(r);
  for (const alias of aliases) {
    const target = normHeaderKey(alias);
    if (!target) continue;
    for (const k of keys) {
      if (normHeaderKey(k) === target) {
        const v = cellStr(r[k]);
        if (v) return v;
      }
    }
  }
  for (const alias of aliases) {
    const target = normHeaderKey(alias);
    /* Long aliases only — short ones (e.g. "invoice") would match invoice_date. */
    if (target.length >= 12) {
      for (const k of keys) {
        const nk = normHeaderKey(k);
        if (nk.includes(target) || target.includes(nk)) {
          const v = cellStr(r[k]);
          if (v) return v;
        }
      }
    }
  }
  for (const alias of aliases) {
    if (alias in r) {
      const v = cellStr(r[alias]);
      if (v) return v;
    }
  }
  return '';
}

/** When headers do not match known aliases, scan column names for price / line-total patterns. */
function pickLineNumericByHeaderScan(r: Record<string, unknown>, mode: 'unit_price' | 'line_total'): number {
  for (const k of Object.keys(r)) {
    const nk = normHeaderKey(k);
    const v = parseImportNumber(cellStr(r[k]));
    if (!Number.isFinite(v) || v <= 0) continue;
    if (mode === 'unit_price') {
      const looksPrice =
        nk.includes('unitprice') ||
        nk.includes('unitrate') ||
        nk === 'rate' ||
        nk === 'price' ||
        nk.includes('basicprice') ||
        nk.includes('netprice') ||
        (nk.includes('rate') && !nk.includes('tax') && !nk.includes('generate') && !nk.includes('corporate'));
      if (looksPrice) return v;
    } else {
      const looksLineTotal =
        nk.includes('linetotal') ||
        nk.includes('lineamount') ||
        nk.includes('netamount') ||
        nk.includes('extended') ||
        nk.includes('basicvalue') ||
        nk.includes('taxablevalue') ||
        nk.includes('itemvalue') ||
        (nk.includes('amount') && (nk.includes('line') || nk.includes('item')));
      if (looksLineTotal) return v;
    }
  }
  return NaN;
}

function rowToMaster(r: Record<string, unknown>): GRNImportRow | null {
  const grn_number = pickRow(r, 'grn_number', 'GRN Number', 'GRN #', 'grn');
  if (!grn_number) return null;
  const totalRaw = pickRow(
    r,
    'received_amount',
    'Received Amount',
    'Receipt Amount',
    'GRN Amount',
    'GRN Total',
    'Total Receipt',
    'Net Amount',
    'Grand Total',
    'Total Value',
    'Total (INR)',
    'Total(INR)',
    'Amount (INR)',
    'Invoice Amount',
    'total_amount',
    'Total Amount',
    'Total',
    'Amount'
  );
  let received_total = parseImportNumber(totalRaw);
  if (!Number.isFinite(received_total) || received_total <= 0) received_total = 0;
  return {
    grn_number,
    grn_date: pickRow(r, 'grn_date', 'GRN Date', 'received_date', 'Receipt Date', 'date'),
    po_number: pickRow(r, 'po_number', 'PO Number', 'PO #', 'po'),
    invoice_number: pickRow(r, 'invoice_number', 'Invoice Number', 'INV Number', 'invoice'),
    vendor_name: pickRow(r, 'vendor_name', 'Vendor Name', 'vendor'),
    received_by: pickRow(r, 'received_by', 'Received By', 'received by'),
    status: pickRow(r, 'status', 'Status') || 'Confirmed',
    notes: pickRow(r, 'notes', 'Notes', 'description'),
    received_total: received_total > 0 ? received_total : undefined,
  };
}

function rowToLine(r: Record<string, unknown>): GRNLineImportRow | null {
  const grn_number = pickRow(r, 'grn_number', 'GRN Number', 'GRN #');
  if (!grn_number) return null;
  const desc = pickRow(r, 'description', 'Description', 'item', 'Item', 'Item Description', 'Particulars');

  let oq = parseImportNumber(pickRow(r, 'ordered_qty', 'Ordered Qty', 'Ordered', 'ordered', 'Order Qty', 'Qty Ordered'));
  if (!Number.isFinite(oq) || oq <= 0) oq = 1;

  let rq = parseImportNumber(
    pickRow(
      r,
      'received_qty',
      'Received Qty',
      'Received',
      'received',
      'Qty Received',
      'Qty',
      'QTY',
      'qty',
      'Quantity',
      'Rec Qty',
      'Rec. Qty',
      'Bill Qty'
    )
  );
  if (!Number.isFinite(rq) || rq <= 0) rq = 1;

  let up = parseImportNumber(
    pickRow(
      r,
      'unit_price',
      'Unit Price',
      'unit price',
      'UnitPrice',
      'price',
      'Price',
      'Rate',
      'rate',
      'Unit Rate',
      'Net Price',
      'Net Rate',
      'Unit Cost',
      'unit_cost',
      'UnitCost',
      'Cost',
      'Basic Price',
      'Basic Rate',
      'Price (INR)',
      'Price(INR)',
      'Rate (INR)',
      'MRP'
    )
  );

  if (!Number.isFinite(up) || up === 0) {
    const lineTotal = parseImportNumber(
      pickRow(
        r,
        'line_total',
        'Line Total',
        'line amount',
        'Line Amount',
        'Net Amount',
        'Extended Price',
        'Amount (INR)',
        'Value (INR)',
        'Total Value',
        'Value',
        'amount',
        'Amount',
        'Total'
      )
    );
    if (Number.isFinite(lineTotal) && lineTotal > 0 && rq > 0) up = lineTotal / rq;
    else if (!Number.isFinite(up)) up = 0;
  }

  if (!Number.isFinite(up) || up === 0) {
    const scanned = pickLineNumericByHeaderScan(r, 'unit_price');
    if (Number.isFinite(scanned) && scanned > 0) up = scanned;
  }
  if (!Number.isFinite(up) || up === 0) {
    const lineTot = pickLineNumericByHeaderScan(r, 'line_total');
    if (Number.isFinite(lineTot) && lineTot > 0 && rq > 0) up = lineTot / rq;
  }

  const cond = pickRow(r, 'condition', 'Condition') || 'Good';
  return {
    grn_number,
    description: desc || 'Line item',
    ordered_qty: oq,
    received_qty: rq,
    unit_price: Number.isFinite(up) ? up : 0,
    condition: cond,
  };
}

function rowsFromSheet(sheet: XLSX.WorkSheet | undefined): Record<string, unknown>[] {
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
}

function classifySheetRows(rows: Record<string, unknown>[]): 'master' | 'lines' | 'empty' {
  if (rows.length === 0) return 'empty';
  const sample = rows[0];
  const keysNorm = Object.keys(sample).map((k) => normHeaderKey(k).replace(/\s+/g, '_'));
  const hasGrn = pickRow(sample, 'grn_number', 'GRN Number') !== '';
  if (!hasGrn) return 'empty';

  const hasLineQty =
    keysNorm.some((k) => /ordered_qty|orderedqty|qty_ordered|orderqty/.test(k)) ||
    keysNorm.some((k) => /received_qty|receivedqty|qty_received|^qty$|quantity/.test(k));
  const hasLinePrice = keysNorm.some((k) =>
    /unit_price|unitprice|basicprice|netprice|rate|netamount|line_total|lineamount|extended|taxablevalue|basicvalue/.test(k)
  );

  /*
   * Line sheets often repeat vendor (or PO) for readability. Previously any vendor column forced "master",
   * so real line rows never reached rowToLine() and bulk import fell back to unit_price = 0.
   */
  const hasMasterKeys =
    keysNorm.some((k) => /po_number|ponumber|po#/.test(k)) ||
    keysNorm.some((k) => /invoice_number|invoicenumber|inv_number/.test(k)) ||
    keysNorm.some((k) => /received_by|receivedby/.test(k));

  // If it has master-level keys (po_number, received_by) AND line data,
  // treat as master (flat one-GRN-per-row format, common in UAE/bulk uploads)
  if (hasLineQty && hasLinePrice && hasMasterKeys) return 'master';
  if (hasLineQty && hasLinePrice) return 'lines';
  const hasVendorCol = pickRow(sample, 'vendor_name', 'Vendor Name') !== '';
  const hasLooseLineHints =
    keysNorm.some((k) => /received_qty|receivedqty|qty_received|^qty$|quantity/.test(k)) ||
    keysNorm.some((k) => /unit_price|unitprice|rate|netamount|line_total|lineamount|extended/.test(k));

  if (hasGrn && hasLooseLineHints && !hasMasterKeys && !hasVendorCol) return 'lines';
  if (hasGrn && hasLooseLineHints && !hasMasterKeys) return 'lines';
  if (hasGrn && hasMasterKeys) return 'master';
  if (hasGrn && hasVendorCol && !hasLooseLineHints) return 'master';
  if (hasGrn && hasLooseLineHints) return 'lines';
  return 'master';
}

/** Parse workbook: detects GRN Master vs Line Items sheets by name or column shape. */
export function parseGRNImportWorkbook(wb: XLSX.WorkBook): { master: GRNImportRow[]; lineItems: GRNLineImportRow[] } {
  const names = wb.SheetNames;
  let masterSheetName: string | undefined;
  let lineSheetName: string | undefined;

  for (const n of names) {
    const l = n.toLowerCase();
    if ((l.includes('master') || (l.includes('grn') && !l.includes('line'))) && !l.includes('line item')) {
      masterSheetName = n;
    }
    if (l.includes('line') || l.includes('item')) {
      lineSheetName = n;
    }
  }

  if (!masterSheetName) {
    for (const n of names) {
      const rows = rowsFromSheet(wb.Sheets[n]);
      if (rows.length === 0) continue;
      if (classifySheetRows(rows) === 'master') {
        masterSheetName = n;
        break;
      }
    }
  }
  if (!masterSheetName && names.length > 0) masterSheetName = names[0];

  if (!lineSheetName) {
    for (const n of names) {
      if (n === masterSheetName) continue;
      const rows = rowsFromSheet(wb.Sheets[n]);
      if (rows.length === 0) continue;
      if (classifySheetRows(rows) === 'lines') {
        lineSheetName = n;
        break;
      }
    }
  }
  if (!lineSheetName && names.length > 1) {
    const alt = names.find((n) => n !== masterSheetName);
    if (alt) lineSheetName = alt;
  }

  const masterRows = masterSheetName ? rowsFromSheet(wb.Sheets[masterSheetName]) : [];
  const lineRows = lineSheetName ? rowsFromSheet(wb.Sheets[lineSheetName]) : [];

  const master: GRNImportRow[] = [];
  for (const r of masterRows) {
    const m = rowToMaster(r);
    if (m) master.push(m);
  }

  const lineItems: GRNLineImportRow[] = [];
  for (const r of lineRows) {
    const li = rowToLine(r);
    if (li) lineItems.push(li);
  }

  if (master.length === 0) {
    const seen = new Set<string>();
    for (const n of names) {
      if (n === lineSheetName) continue;
      for (const r of rowsFromSheet(wb.Sheets[n])) {
        const m = rowToMaster(r);
        if (m && !seen.has(m.grn_number)) {
          seen.add(m.grn_number);
          master.push(m);
        }
      }
    }
  }

  if (lineItems.length === 0 && names.length > 0) {
    for (const n of names) {
      if (n === masterSheetName) continue;
      for (const r of rowsFromSheet(wb.Sheets[n])) {
        const li = rowToLine(r);
        if (li) lineItems.push(li);
      }
    }
  }

  return { master, lineItems };
}

export async function parseGRNImportExcelFile(file: File): Promise<{ master: GRNImportRow[]; lineItems: GRNLineImportRow[] }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  return parseGRNImportWorkbook(wb);
}

/** Parse a single CSV (text) as master or line sheet from first worksheet. */
export function parseGRNImportCSVText(text: string): { master: GRNImportRow[]; lineItems: GRNLineImportRow[] } {
  const t = text.trim();
  if (!t) return { master: [], lineItems: [] };
  const wb = XLSX.read(t, { type: 'string' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = rowsFromSheet(sheet);
  if (rows.length === 0) return { master: [], lineItems: [] };
  const kind = classifySheetRows(rows);
  if (kind === 'lines') {
    const lineItems: GRNLineImportRow[] = [];
    for (const r of rows) {
      const li = rowToLine(r);
      if (li) lineItems.push(li);
    }
    return { master: [], lineItems };
  }
  const master: GRNImportRow[] = [];
  for (const r of rows) {
    const m = rowToMaster(r);
    if (m) master.push(m);
  }
  return { master, lineItems: [] };
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function toYyyyMmDd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeGrnDate(d: string): string {
  const s = d.trim();
  if (!s) return toYyyyMmDd(new Date());
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parts = s.split(/[/-]/);
  if (parts.length === 3) {
    const [a, b, c] = parts.map((x) => x.trim());
    if (c.length === 4 && a.length <= 2) {
      const day = a.padStart(2, '0');
      const month = b.padStart(2, '0');
      return `${c}-${month}-${day}`;
    }
  }
  return s.slice(0, 10);
}

function normalizeLineCondition(c: string): 'good' | 'damaged' | 'partial' | 'rejected' {
  const x = (c || 'good').toLowerCase().trim();
  if (x === 'damaged') return 'damaged';
  if (x === 'partial') return 'partial';
  if (x === 'rejected') return 'rejected';
  return 'good';
}

/**
 * Inserts GRNs + line items for the current company. Skips existing `grn_number`.
 * Runs `runAutoMatch` on `invoice_number` when present; otherwise `rerunAutoMatchForPo` when `po_id` resolves.
 */
export async function bulkImportGRNs(
  masterRows: GRNImportRow[],
  lineItemRows: GRNLineImportRow[],
  onProgress?: (current: number, total: number, detail: string) => void
): Promise<BulkImportGRNResult> {
  const company = await getMyCompany();
  const result: BulkImportGRNResult = {
    total: masterRows.length,
    success: 0,
    failed: 0,
    skipped: 0,
    matched: 0,
    errors: [],
    results: [],
  };

  if (!company?.id) {
    result.errors.push({ grn_number: '—', error: 'No company selected. Set your company in settings.' });
    result.failed = masterRows.length;
    return result;
  }

  const companyId = company.id;

  for (let i = 0; i < masterRows.length; i++) {
    const grn = masterRows[i];
    const label = `${grn.grn_number} — ${grn.vendor_name || 'GRN'}`;
    onProgress?.(i + 1, masterRows.length, `Processing ${label}…`);

    let warning: string | undefined;

    try {
      const grnNum = grn.grn_number.trim();
      if (!grnNum) {
        result.failed++;
        result.errors.push({ grn_number: '(empty)', error: 'Missing grn_number' });
        continue;
      }

      const { data: dup } = await supabase
        .from('goods_receipts')
        .select('id')
        .eq('company_id', companyId)
        .eq('grn_number', grnNum)
        .maybeSingle();

      if (dup) {
        result.skipped++;
        result.errors.push({ grn_number: grnNum, error: 'Skipped — GRN number already exists' });
        result.results.push({
          grn_number: grnNum,
          invoice_number: grn.invoice_number,
          match_status: 'skipped_duplicate',
          auto_approved: false,
          warning: 'GRN already in database',
        });
        continue;
      }

      let poId: string | null = null;
      let resolvedPoNumber = grn.po_number.trim();
      if (resolvedPoNumber) {
        const { data: poRows } = await supabase
          .from('purchase_orders')
          .select('id, po_number')
          .eq('company_id', companyId)
          .ilike('po_number', resolvedPoNumber)
          .limit(1);
        if (poRows?.[0]) {
          poId = poRows[0].id as string;
          resolvedPoNumber = String(poRows[0].po_number ?? resolvedPoNumber);
        } else {
          warning = `PO "${resolvedPoNumber}" not found — GRN saved without PO link`;
        }
      } else {
        warning = warning || 'No PO number — GRN saved without PO link';
      }

      let lines = lineItemRows
        .filter((l) => l.grn_number.trim() === grnNum)
        .map((l) => ({
          description: l.description.trim() || 'Line item',
          ordered_qty: Number(l.ordered_qty) || 1,
          received_qty: Number(l.received_qty) || 1,
          unit_price: Number(l.unit_price) || 0,
          condition: normalizeLineCondition(l.condition),
        }));

      if (lines.length === 0) {
        lines = [
          {
          description: grn.notes.trim() || `${grn.vendor_name || 'Vendor'} — receipt`,
          ordered_qty: 1,
          received_qty: 1,
          unit_price: 0,
          condition: 'good' as const,
          },
        ];
      }

      let lineSum = lines.reduce((s, li) => s + Number(li.received_qty) * Number(li.unit_price), 0);
      const headerTotal = Number(grn.received_total) || 0;
      if (lineSum === 0 && headerTotal > 0) {
        const qtySum = lines.reduce((s, li) => s + Number(li.received_qty), 0);
        if (qtySum > 0) {
          const up = headerTotal / qtySum;
          lines = lines.map((li) => ({ ...li, unit_price: up }));
          lineSum = headerTotal;
        }
      }

      const receivedBy = grn.received_by.trim() || 'Bulk import';
      const vendorName = grn.vendor_name.trim() || 'Unknown vendor';
      const statusLower = grn.status.trim().toLowerCase();
      const statusDb = statusLower === 'draft' ? 'draft' : 'confirmed';

      const invNumTrim = grn.invoice_number?.trim() ?? '';

      const { data: inserted, error: grnError } = await supabase
        .from('goods_receipts')
        .insert({
          company_id: companyId,
          grn_number: grnNum,
          po_id: poId,
          vendor_name: vendorName,
          received_amount: lineSum,
          received_date: normalizeGrnDate(grn.grn_date),
          status: statusDb,
          received_by: receivedBy,
          notes: grn.notes?.trim() ?? '',
          ...(invNumTrim ? { invoice_number: invNumTrim } : {}),
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (grnError) throw new Error(grnError.message);
      const grnId = inserted?.id as string;

      const liRows = lines.map((li) => ({
        grn_id: grnId,
        description: li.description,
        ordered_qty: li.ordered_qty,
        received_qty: li.received_qty,
        unit_price: li.unit_price,
        condition: li.condition,
      }));

      if (liRows.length > 0) {
        const { error: liErr } = await supabase.from('grn_line_items').insert(liRows);
        if (liErr) console.warn('[bulkImportGRNs] line items:', liErr.message);
      }

      result.success++;

      let matchStatus = 'no_invoice';
      let autoApproved = false;

      const invNum = grn.invoice_number.trim();
      if (invNum) {
        const { data: invRows } = await supabase
          .from('invoices')
          .select('id')
          .eq('company_id', companyId)
          .ilike('invoice_number', invNum)
          .limit(1);
        const invId = invRows?.[0]?.id as string | undefined;
        if (invId) {
          try {
            const matchResult = await runAutoMatch(invId, { respectUploadSetting: false });
            matchStatus = matchResult.engine_status;
            autoApproved = matchResult.auto_approved;
            if (matchResult.within_tolerance && !matchResult.skipped) result.matched++;
          } catch {
            matchStatus = 'match_error';
          }
        } else {
          matchStatus = 'invoice_not_found';
        }
      } else if (poId && resolvedPoNumber) {
        try {
          const rematch = await rerunAutoMatchForPo(poId, resolvedPoNumber);
          if (rematch.length > 0) {
            const first = rematch[0].result;
            matchStatus = first.engine_status;
            autoApproved = first.auto_approved;
            if (first.within_tolerance && !first.skipped) result.matched++;
          } else {
            matchStatus = 'no_invoice_on_po';
          }
        } catch {
          matchStatus = 'match_error';
        }
      }

      result.results.push({
        grn_number: grnNum,
        invoice_number: grn.invoice_number,
        match_status: matchStatus,
        auto_approved: autoApproved,
        warning,
      });
    } catch (e: unknown) {
      result.failed++;
      const msg = e instanceof Error ? e.message : 'Unknown error';
      result.errors.push({ grn_number: grn.grn_number, error: msg });
    }
  }

  return result;
}

/** Merge rows from two CSV texts (expected: master + line items; either file may contribute both if columns match). */
export function mergeGRNImportCSVs(
  masterText: string,
  linesText: string
): { master: GRNImportRow[]; lineItems: GRNLineImportRow[] } {
  const a = parseGRNImportCSVText(masterText);
  const b = parseGRNImportCSVText(linesText);
  return {
    master: [...a.master, ...b.master],
    lineItems: [...a.lineItems, ...b.lineItems],
  };
}

export function downloadGRNImportCSVTemplates(): void {
  const masterCSV = [
    'grn_number,grn_date,po_number,invoice_number,received_amount,vendor_name,received_by,status,notes',
    'GRN-2025-0001,2025-01-28,PO-2025-0901,INV-2025-00901,324500,TechConsult Solutions Pvt. Ltd.,Rajesh Kumar,Confirmed,Full delivery completed',
    'GRN-2025-0002,2025-02-10,PO-2025-0902,INV-2025-00902,410000,Dell Technologies India Pvt. Ltd.,Priya Sharma,Confirmed,All items received',
  ].join('\n');

  const lineCSV = [
    'grn_number,description,ordered_qty,received_qty,unit_price,condition',
    'GRN-2025-0001,Cloud consulting services,1,1,324500,Good',
    'GRN-2025-0002,Dell Latitude Laptop,5,5,60000,Good',
    'GRN-2025-0002,Dell Monitor 24inch,5,5,22000,Good',
  ].join('\n');

  const blob1 = new Blob([masterCSV], { type: 'text/csv;charset=utf-8' });
  const url1 = URL.createObjectURL(blob1);
  const a1 = document.createElement('a');
  a1.href = url1;
  a1.download = 'GRN_Master_Template.csv';
  a1.click();
  URL.revokeObjectURL(url1);

  window.setTimeout(() => {
    const blob2 = new Blob([lineCSV], { type: 'text/csv;charset=utf-8' });
    const url2 = URL.createObjectURL(blob2);
    const a2 = document.createElement('a');
    a2.href = url2;
    a2.download = 'GRN_LineItems_Template.csv';
    a2.click();
    URL.revokeObjectURL(url2);
  }, 400);
}

export function downloadGRNImportExcelTemplate(): void {
  const masterData = [
    {
      grn_number: 'GRN-2025-0001',
      grn_date: '2025-01-28',
      po_number: 'PO-2025-0901',
      invoice_number: 'INV-2025-00901',
      received_amount: 324500,
      vendor_name: 'TechConsult Solutions Pvt. Ltd.',
      received_by: 'Rajesh Kumar',
      status: 'Confirmed',
      notes: 'Full delivery completed',
    },
    {
      grn_number: 'GRN-2025-0002',
      grn_date: '2025-02-10',
      po_number: 'PO-2025-0902',
      invoice_number: 'INV-2025-00902',
      received_amount: 410000,
      vendor_name: 'Dell Technologies India Pvt. Ltd.',
      received_by: 'Priya Sharma',
      status: 'Confirmed',
      notes: 'All items received',
    },
  ];
  const lineData = [
    {
      grn_number: 'GRN-2025-0001',
      description: 'Cloud consulting services',
      ordered_qty: 1,
      received_qty: 1,
      unit_price: 324500,
      condition: 'Good',
    },
    {
      grn_number: 'GRN-2025-0002',
      description: 'Dell Latitude Laptop',
      ordered_qty: 5,
      received_qty: 5,
      unit_price: 60000,
      condition: 'Good',
    },
    {
      grn_number: 'GRN-2025-0002',
      description: 'Dell Monitor 24inch',
      ordered_qty: 5,
      received_qty: 5,
      unit_price: 22000,
      condition: 'Good',
    },
  ];

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(masterData);
  const ws2 = XLSX.utils.json_to_sheet(lineData);
  XLSX.utils.book_append_sheet(wb, ws1, 'GRN Master');
  XLSX.utils.book_append_sheet(wb, ws2, 'Line Items');
  XLSX.writeFile(wb, 'GRN_Import_Template.xlsx');
}
