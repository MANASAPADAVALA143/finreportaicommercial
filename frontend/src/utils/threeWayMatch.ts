// 3-Way Matching System for Invoice Processing
// Compares Purchase Order (PO), Goods Receipt Note (GRN), and Invoice amounts

import type { SupabaseClient } from '@supabase/supabase-js';

export type MatchStatus = 'matched' | 'partial' | 'mismatch' | 'no_po' | 'three_way_matched';

export type MatchResult = {
  match_status: MatchStatus;
  match_notes: string;
  po_amount?: number;
  grn_amount?: number;
  invoice_amount: number;
  variance?: number;
  variance_percentage?: number;
};

/**
 * Compares PO, GRN, and Invoice amounts to determine match status
 * 
 * Rules:
 * - If all match within 1%: status = "matched" âœ…
 * - If invoice > PO by more than 5%: status = "mismatch" âŒ
 * - If GRN < PO: status = "partial" âš ï¸
 * - If no PO found: status = "no_po"
 */
export function compareAmounts(
  poAmount: number | null,
  grnAmount: number | null,
  invoiceAmount: number
): MatchResult {
  // No PO found
  if (!poAmount || poAmount === 0) {
    return {
      match_status: 'no_po',
      match_notes: 'No Purchase Order found for this invoice. Please link a PO to enable 3-way matching.',
      invoice_amount: invoiceAmount,
    };
  }

  // Calculate variances
  const invoiceVariance = invoiceAmount - poAmount;
  const invoiceVariancePercent = (invoiceVariance / poAmount) * 100;

  // If GRN exists, compare it too
  if (grnAmount && grnAmount > 0) {
    const grnVariance = grnAmount - poAmount;
    const grnVariancePercent = (grnVariance / poAmount) * 100;
    const invoiceGrnVariance = Math.abs(invoiceAmount - grnAmount);
    const invoiceGrnVariancePercent = (invoiceGrnVariance / Math.max(invoiceAmount, grnAmount)) * 100;

    // All three match within 1%
    if (
      Math.abs(invoiceVariancePercent) <= 1 &&
      Math.abs(grnVariancePercent) <= 1 &&
      invoiceGrnVariancePercent <= 1
    ) {
      return {
        match_status: 'matched',
        match_notes: `âœ… Perfect match! PO (${poAmount.toLocaleString()}), GRN (${grnAmount.toLocaleString()}), and Invoice (${invoiceAmount.toLocaleString()}) all match within 1%.`,
        po_amount: poAmount,
        grn_amount: grnAmount,
        invoice_amount: invoiceAmount,
        variance: 0,
        variance_percentage: 0,
      };
    }

    // Invoice exceeds PO by more than 5%
    if (invoiceVariancePercent > 5) {
      return {
        match_status: 'mismatch',
        match_notes: `âŒ Mismatch detected! Invoice amount (${invoiceAmount.toLocaleString()}) exceeds PO amount (${poAmount.toLocaleString()}) by ${invoiceVariancePercent.toFixed(2)}%. This requires investigation.`,
        po_amount: poAmount,
        grn_amount: grnAmount,
        invoice_amount: invoiceAmount,
        variance: invoiceVariance,
        variance_percentage: invoiceVariancePercent,
      };
    }

    // GRN is less than PO (partial receipt)
    if (grnAmount < poAmount) {
      const grnShortfall = poAmount - grnAmount;
      const grnShortfallPercent = (grnShortfall / poAmount) * 100;
      
      return {
        match_status: 'partial',
        match_notes: `âš ï¸ Partial match. GRN (${grnAmount.toLocaleString()}) is ${grnShortfallPercent.toFixed(2)}% less than PO (${poAmount.toLocaleString()}). Invoice (${invoiceAmount.toLocaleString()}) may need adjustment.`,
        po_amount: poAmount,
        grn_amount: grnAmount,
        invoice_amount: invoiceAmount,
        variance: grnShortfall,
        variance_percentage: grnShortfallPercent,
      };
    }

    // Invoice matches GRN but not PO (within tolerance)
    if (invoiceGrnVariancePercent <= 1 && Math.abs(invoiceVariancePercent) <= 5) {
      return {
        match_status: 'matched',
        match_notes: `âœ… Match confirmed. Invoice (${invoiceAmount.toLocaleString()}) matches GRN (${grnAmount.toLocaleString()}). PO variance (${invoiceVariancePercent.toFixed(2)}%) is within acceptable tolerance.`,
        po_amount: poAmount,
        grn_amount: grnAmount,
        invoice_amount: invoiceAmount,
        variance: invoiceVariance,
        variance_percentage: invoiceVariancePercent,
      };
    }
  }

  // Only PO and Invoice (no GRN)
  // Perfect match within 1%
  if (Math.abs(invoiceVariancePercent) <= 1) {
    return {
      match_status: 'matched',
      match_notes: `âœ… Match confirmed. Invoice (${invoiceAmount.toLocaleString()}) matches PO (${poAmount.toLocaleString()}) within 1%. No GRN available for comparison.`,
      po_amount: poAmount,
      invoice_amount: invoiceAmount,
      variance: invoiceVariance,
      variance_percentage: invoiceVariancePercent,
    };
  }

  // Invoice exceeds PO by more than 5%
  if (invoiceVariancePercent > 5) {
    return {
      match_status: 'mismatch',
      match_notes: `âŒ Mismatch detected! Invoice amount (${invoiceAmount.toLocaleString()}) exceeds PO amount (${poAmount.toLocaleString()}) by ${invoiceVariancePercent.toFixed(2)}%. This requires investigation.`,
      po_amount: poAmount,
      invoice_amount: invoiceAmount,
      variance: invoiceVariance,
      variance_percentage: invoiceVariancePercent,
    };
  }

  // Within tolerance but not perfect match
  return {
    match_status: 'partial',
    match_notes: `âš ï¸ Partial match. Invoice (${invoiceAmount.toLocaleString()}) differs from PO (${poAmount.toLocaleString()}) by ${Math.abs(invoiceVariancePercent).toFixed(2)}%. No GRN available for comparison.`,
    po_amount: poAmount,
    invoice_amount: invoiceAmount,
    variance: invoiceVariance,
    variance_percentage: invoiceVariancePercent,
  };
}

export type RunThreeWayMatchResult = {
  status: MatchStatus;
  diff?: number;
  pct?: number;
  poAmt?: number;
  grnAmt?: number;
  invoiceAmt?: number;
};

/**
 * Runs 3-way match and updates the invoice record.
 * Fetches PO by po_number first; if no PO number, tries vendor+amount.
 */
export async function runThreeWayMatch(
  supabase: SupabaseClient,
  invoiceId: string,
  poNumber: string | null | undefined,
  vendorName?: string | null,
  invoiceAmountParam?: number | null
): Promise<RunThreeWayMatchResult> {
  const { data: invoice, error: invError } = await supabase
    .from('invoices')
    .select('total_amount, vendor_name')
    .eq('id', invoiceId)
    .single();

  if (invError || !invoice) {
    return { status: 'no_po' };
  }

  const invoiceAmt = invoiceAmountParam != null ? Number(invoiceAmountParam) : Number(invoice.total_amount);
  const vendor = vendorName ?? invoice.vendor_name ?? '';

  const trimmedPo = poNumber ? String(poNumber).trim() : '';

  if (!trimmedPo && !vendor) {
    await supabase
      .from('invoices')
      .update({
        match_status: 'no_po',
        match_difference: null,
        match_percentage: null,
        match_notes: 'No Purchase Order number or vendor provided.',
        po_amount: null,
        grn_amount: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId);
    return { status: 'no_po' };
  }

  let po: { id: string; po_amount: number; po_number: string } | null = null;
  let poError: { message: string } | null = null;

  if (trimmedPo) {
    const exact = await supabase
      .from('purchase_orders')
      .select('id, po_amount, po_number')
      .eq('po_number', trimmedPo)
      .maybeSingle();
    po = exact.data;
    poError = exact.error;
    if (!po && !exact.error) {
      const ci = await supabase
        .from('purchase_orders')
        .select('id, po_amount, po_number')
        .ilike('po_number', trimmedPo)
        .limit(1);
      if (ci.error) {
        poError = ci.error;
      } else if (ci.data?.length) {
        po = ci.data[0];
      }
    }
    // Explicit po_number not found → do not vendor-substitute (same as resolvePoIdForGrn).
  } else if (vendor) {
    const res = await supabase
      .from('purchase_orders')
      .select('id, po_amount, po_number')
      .ilike('vendor_name', vendor)
      .order('created_at', { ascending: false })
      .limit(1);
    if (res.data && res.data.length > 0) {
      po = res.data[0];
    }
  }

  if (!po || poError) {
    await supabase
      .from('invoices')
      .update({
        match_status: 'no_po',
        match_notes: trimmedPo
          ? `Purchase Order "${trimmedPo}" not found — left as-is for review (no vendor substitute).`
          : 'No matching PO found for vendor.',
        match_difference: null,
        match_percentage: null,
        po_amount: null,
        grn_amount: null,
        // Preserve explicit source po_number; never clear or replace it here.
        ...(trimmedPo ? { po_number: trimmedPo, po_id: null } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId);
    return { status: 'no_po' };
  }

  const { data: grnRows } = await supabase
    .from('goods_receipts')
    .select('received_amount')
    .eq('po_id', po.id)
    .order('received_date', { ascending: false })
    .limit(1);

  const grn = Array.isArray(grnRows) && grnRows.length > 0 ? grnRows[0] : null;
  const poAmt = Number(po.po_amount);
  const grnAmt = grn?.received_amount != null ? Number(grn.received_amount) : null;
  const result = compareAmounts(poAmt, grnAmt, invoiceAmt);
  const diff = result.variance ?? Math.abs(invoiceAmt - poAmt);
  const pctPercent = result.variance_percentage ?? (poAmt > 0 ? (diff / poAmt) * 100 : 0);
  const status = result.match_status;
  const matchNotes = result.match_notes;

  const { error: updateError } = await supabase
    .from('invoices')
    .update({
      match_status: status,
      match_difference: diff,
      match_percentage: Number(pctPercent.toFixed(2)),
      match_notes: matchNotes,
      po_amount: poAmt,
      grn_amount: grnAmt,
      // Keep explicit source po_number; only fill from PO when invoice had none.
      po_number: trimmedPo || po.po_number,
      po_id: po.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId);

  if (updateError) {
    console.error('3-way match update failed:', updateError);
    throw updateError;
  }

  return {
    status,
    diff,
    pct: poAmt > 0 ? diff / poAmt : 0,
    poAmt,
    grnAmt: grnAmt ?? undefined,
    invoiceAmt,
  };
}

/**
 * Gets the display name for match status
 */
export function getMatchStatusName(status: MatchStatus): string {
  switch (status) {
    case 'three_way_matched':
      return '3-Way Matched âœ…';
    case 'matched':
      return 'PO Matched';
    case 'partial':
      return 'Partial âš ï¸';
    case 'mismatch':
      return 'Mismatch âŒ';
    case 'no_po':
      return 'No PO';
    default:
      return 'Unknown';
  }
}

/**
 * Gets the color class for match status badge
 */
export function getMatchStatusColor(status: MatchStatus): string {
  switch (status) {
    case 'three_way_matched':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'matched':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'partial':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'mismatch':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'no_po':
      return 'bg-gray-100 text-gray-800 border-gray-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
}

