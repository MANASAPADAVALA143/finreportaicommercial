import type { Invoice } from '@/lib/ap-invoice/supabase';

export function normalizeFieldConfidenceMap(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v);
    if (!Number.isNaN(n)) out[k] = Math.min(100, Math.max(0, n));
  }
  return out;
}

/** Read explicit OCR / extraction score from n8n-style payload (not IFRS-specific). */
export function pickOcrConfidenceFromExtraction(data: Record<string, unknown>): number | null {
  const candidates = [
    data.ocr_confidence,
    data.extraction_confidence,
    data.extractionConfidence,
    data.ocrScore,
    data.score,
  ];
  for (const c of candidates) {
    if (c == null || c === '') continue;
    const n = Number(c);
    if (!Number.isNaN(n)) return Math.min(100, Math.max(0, n));
  }
  return null;
}

export function buildOcrColumnsFromWebhook(
  data: Record<string, unknown>,
  ifrsConfidence: number | null | undefined
): { ocr_confidence: number | null; ocr_confidence_fields: Record<string, number> } {
  const fieldsRaw =
    data.field_confidences ??
    data.ocr_confidence_fields ??
    data.fields ??
    data.per_field_confidence;
  const ocr_confidence_fields = normalizeFieldConfidenceMap(fieldsRaw);
  let ocr = pickOcrConfidenceFromExtraction(data);
  const i = ifrsConfidence != null ? Number(ifrsConfidence) : 0;
  if (ocr == null && i > 0) ocr = Math.min(100, Math.max(0, i));
  return { ocr_confidence: ocr, ocr_confidence_fields };
}

export function computeFieldCompletenessScore(
  inv: Pick<Invoice, 'vendor_name' | 'total_amount' | 'invoice_date' | 'invoice_number' | 'due_date'>
): number {
  let pts = 0;
  if (inv.vendor_name?.trim()) pts += 20;
  if (inv.total_amount != null && Number(inv.total_amount) > 0) pts += 20;
  if (inv.invoice_date?.trim()) pts += 20;
  if (inv.invoice_number?.trim()) pts += 20;
  if (inv.due_date?.trim()) pts += 20;
  return pts;
}

export function getEffectiveExtractionScore(inv: Invoice): number {
  if (inv.ocr_confidence != null && !Number.isNaN(Number(inv.ocr_confidence))) {
    return Math.min(100, Math.max(0, Number(inv.ocr_confidence)));
  }
  if (inv.ifrs_confidence != null && Number(inv.ifrs_confidence) > 0) {
    return Math.min(100, Math.max(0, Number(inv.ifrs_confidence)));
  }
  return computeFieldCompletenessScore(inv);
}

export function getParsedFieldConfidences(inv: Invoice): Record<string, number> {
  const f = inv.ocr_confidence_fields;
  if (f == null) return {};
  if (typeof f === 'string') {
    try {
      return normalizeFieldConfidenceMap(JSON.parse(f));
    } catch {
      return {};
    }
  }
  return normalizeFieldConfidenceMap(f);
}

export function getExtractionScoreSource(inv: Invoice): 'ocr' | 'ifrs' | 'completeness' {
  const perField = getParsedFieldConfidences(inv);
  if (Object.keys(perField).length > 0) return 'ocr';
  if (inv.ocr_confidence != null && !Number.isNaN(Number(inv.ocr_confidence))) {
    if (
      inv.ifrs_confidence != null &&
      Number(inv.ifrs_confidence) > 0 &&
      Math.abs(Number(inv.ocr_confidence) - Number(inv.ifrs_confidence)) < 0.01
    ) {
      return 'ifrs';
    }
    return 'ocr';
  }
  if (inv.ifrs_confidence != null && Number(inv.ifrs_confidence) > 0) return 'ifrs';
  return 'completeness';
}

export function invoiceNeedsExtractionReview(inv: Invoice): boolean {
  return getEffectiveExtractionScore(inv) < 70;
}

