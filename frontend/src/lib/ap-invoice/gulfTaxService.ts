const GULFTAX_API = import.meta.env.VITE_GULFTAX_API_URL || 'https://gulftax.vercel.app';

export interface TRNValidationResult {
  valid: boolean;
  trn?: string;
  business_name?: string;
  status?: string;
  error?: string;
}

export interface VATClassificationResult {
  treatment: 'standard' | 'zero' | 'exempt' | 'out_of_scope';
  confidence: number;
  reason: string;
  applicable_rate: number;
  error?: string;
}

export async function validateTRNWithGulfTax(trn: string): Promise<TRNValidationResult> {
  try {
    const response = await fetch(`${GULFTAX_API}/api/validate-trn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trn }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'GulfTax API unreachable' };
  }
}

export async function classifyVATWithGulfTax(invoice: {
  vendor_name?: string;
  description?: string;
  total_amount?: number;
  vendor_trn?: string;
}): Promise<VATClassificationResult> {
  try {
    const response = await fetch(`${GULFTAX_API}/api/vat-classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendor_name: invoice.vendor_name,
        description: invoice.description,
        amount: invoice.total_amount,
        vendor_trn: invoice.vendor_trn,
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } catch (err) {
    return {
      treatment: 'standard',
      confidence: 0,
      reason: 'GulfTax API unreachable — defaulting to standard rated',
      applicable_rate: 5,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
