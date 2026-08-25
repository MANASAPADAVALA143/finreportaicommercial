import type { Invoice } from './supabase';

function flagCount(inv: Invoice): number {
  const c = (inv as { risk_flag_count?: number }).risk_flag_count;
  if (typeof c === 'number' && c > 0) return c;
  if (Array.isArray(inv.risk_flags)) return inv.risk_flags.length;
  if (typeof inv.risk_flags === 'string' && inv.risk_flags.trim()) {
    try {
      const p = JSON.parse(inv.risk_flags) as unknown;
      return Array.isArray(p) ? p.length : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

function normalizedRiskLevel(inv: Invoice): 'high' | 'medium' | 'low' {
  const rl = String(inv.risk_level ?? '').toLowerCase();
  const rs = typeof inv.risk_score === 'string' ? inv.risk_score.toLowerCase() : '';
  if (rl === 'high' || rs === 'high') return 'high';
  if (rl === 'medium' || rs === 'medium') return 'medium';
  if (typeof inv.risk_score === 'number') {
    if (inv.risk_score >= 60) return 'high';
    if (inv.risk_score >= 30) return 'medium';
  }
  return 'low';
}

/** Stable 0–100-style score for list/detail when numeric `risk_score` is missing or zero. */
export function deriveInvoiceRiskDisplayScore(inv: Invoice): number | null {
  if (typeof inv.risk_score === 'number' && inv.risk_score > 0) {
    return Math.round(inv.risk_score);
  }
  const lvl = normalizedRiskLevel(inv);
  const fc = flagCount(inv);
  if (lvl === 'high') {
    return Math.min(85, Math.max(65, 70 + Math.max(0, fc - 2) * 2));
  }
  if (lvl === 'medium') {
    if (fc > 0) return Math.min(58, Math.max(42, 45 + (fc - 1) * 3));
    return 46;
  }
  if (fc >= 3) return Math.min(90, 55 + fc * 3);
  if (fc >= 1) return Math.min(55, 30 + fc * 7);
  if (lvl === 'low' && fc === 0) return null;
  return 15;
}

export function invoiceHasRiskSignal(inv: Invoice): boolean {
  return (
    !!(inv.risk_level && String(inv.risk_level).trim()) ||
    (typeof inv.risk_score === 'string' && !!inv.risk_score) ||
    (typeof inv.risk_score === 'number' && inv.risk_score > 0) ||
    flagCount(inv) > 0 ||
    deriveInvoiceRiskDisplayScore(inv) != null
  );
}

/**
 * Invoice list "Anomaly" tab — match rows that have real anomaly evidence.
 * Numeric risk_score (new engine) and risk_flags / High|Medium tiers all count;
 * plain Low with no flags does not.
 */
export function invoiceMatchesAnomalyTab(inv: Invoice): boolean {
  if (flagCount(inv) > 0) return true;
  const tier = invoiceRiskTierForFilter(inv);
  if (tier === 'high' || tier === 'medium') return true;
  if (typeof inv.risk_score === 'number' && inv.risk_score >= 30) return true;
  const rs = String(inv.risk_score ?? '').toLowerCase();
  if (rs === 'high' || rs === 'medium' || rs === 'critical') return true;
  const rl = String(inv.risk_level ?? '').toLowerCase();
  if (rl === 'high' || rl === 'medium' || rl === 'critical') return true;
  return false;
}

/** Aligns list risk filter with `risk_level`, string `risk_score`, or numeric bands. */
export function invoiceRiskTierForFilter(inv: Invoice): 'high' | 'medium' | 'low' {
  const rl = String(inv.risk_level ?? '').toLowerCase();
  const rs = typeof inv.risk_score === 'string' ? inv.risk_score.toLowerCase() : '';
  if (rl === 'high' || rs === 'high') return 'high';
  if (rl === 'medium' || rs === 'medium') return 'medium';
  if (typeof inv.risk_score === 'number') {
    if (inv.risk_score >= 60) return 'high';
    if (inv.risk_score >= 30) return 'medium';
  }
  return 'low';
}
