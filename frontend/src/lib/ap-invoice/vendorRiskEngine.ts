/**
 * Vendor risk scoring (Module 1C) — recalculated on vendor update and invoice sync.
 */

export type VendorRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type VendorRiskInput = {
  bank_last_changed_at?: string | null;
  bank_change_count?: number | null;
  created_at?: string | null;
  vendor_since?: string | null;
  duplicate_invoice_count?: number | null;
  trn_verified?: boolean | null;
  gstin?: string | null;
  /** Latest invoice amount for new-vendor high-value rule */
  latest_invoice_amount?: number | null;
  /** Invoice amounts for round-number heuristic */
  recent_invoice_amounts?: number[];
  /** High-value threshold (AED 50_000 UAE, INR equivalent for India) */
  high_value_threshold?: number;
};

export type VendorRiskResult = {
  risk_score: number;
  risk_level: VendorRiskLevel;
  risk_flags: string[];
};

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function isRoundAmount(n: number): boolean {
  if (!Number.isFinite(n) || n <= 0) return false;
  return n % 1000 === 0 || n % 500 === 0;
}

/** Human-readable labels for risk_flags stored on vendors. */
export const RISK_FLAG_LABELS: Record<string, string> = {
  bank_changed_last_30_days: 'Bank account changed in last 30 days (+30)',
  bank_changed_more_than_2x_12mo: 'Bank changed more than 2× in 12 months (+20)',
  new_vendor_high_value_invoice: 'New vendor with high-value invoice (+25)',
  duplicate_invoices_elevated: 'Duplicate invoice count elevated (+15)',
  tax_id_not_verified: 'TRN / tax ID not verified (+10)',
  amounts_always_round_numbers: 'Invoice amounts always round numbers (+10)',
};

export function scoreToLevel(score: number): VendorRiskLevel {
  if (score >= 81) return 'critical';
  if (score >= 51) return 'high';
  if (score >= 21) return 'medium';
  return 'low';
}

/** Rules 1–6 implemented; 7–8 need employee master (skipped unless data provided later). */
export function calculateVendorRisk(input: VendorRiskInput): VendorRiskResult {
  let score = 0;
  const flags: string[] = [];
  const threshold = input.high_value_threshold ?? 50_000;

  const bankDays = daysSince(input.bank_last_changed_at);
  if (bankDays != null && bankDays <= 30) {
    score += 30;
    flags.push('bank_changed_last_30_days');
  }

  const bankChanges = Number(input.bank_change_count ?? 0);
  if (bankChanges > 2) {
    score += 20;
    flags.push('bank_changed_more_than_2x_12mo');
  }

  const vendorAgeDays = daysSince(input.vendor_since ?? input.created_at ?? null);
  const latestAmt = Number(input.latest_invoice_amount ?? 0);
  if (vendorAgeDays != null && vendorAgeDays < 30 && latestAmt > threshold) {
    score += 25;
    flags.push('new_vendor_high_value_invoice');
  }

  const dupCount = Number(input.duplicate_invoice_count ?? 0);
  if (dupCount > 2) {
    score += 15;
    flags.push('duplicate_invoices_elevated');
  }

  const trnOk = input.trn_verified === true || Boolean(input.gstin?.trim());
  if (!trnOk) {
    score += 10;
    flags.push('tax_id_not_verified');
  }

  const amounts = input.recent_invoice_amounts ?? [];
  if (amounts.length >= 3 && amounts.every(isRoundAmount)) {
    score += 10;
    flags.push('amounts_always_round_numbers');
  }

  score = Math.min(100, Math.max(0, score));
  return {
    risk_score: score,
    risk_level: scoreToLevel(score),
    risk_flags: flags,
  };
}
