// Anomaly Detection System for Invoice Processing

export type RiskScore = 'low' | 'medium' | 'high';

// â”€â”€â”€ Training-based anomaly check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface TrainingCheckResult {
  profile_found: boolean;
  is_new_vendor: boolean;
  anomaly_flags: string[];
  risk_score_addition: number;
  explanations: string[];
  recommended_gl: string | null;
  recommended_ifrs: string | null;
  recommendation: string;
  vendor_profile?: {
    mean_amount: number;
    std_deviation: number;
    is_recurring: boolean;
    is_splitting_vendor: boolean;
    typical_gl: string;
    typical_ifrs: string;
    trained_on: number;
    auto_approve_range: { min: number; max: number };
  };
}

/**
 * Call the training-based check-anomaly endpoint.
 * Returns null if training data is unavailable or request fails.
 */
export async function checkTrainingAnomaly(params: {
  company_id: string;
  vendor_name: string;
  amount: number;
  invoice_date: string;
}): Promise<TrainingCheckResult | null> {
  try {
    const resp = await fetch('/api/training/check-anomaly', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as TrainingCheckResult;
  } catch {
    return null;
  }
}

export type RiskFlag = {
  type: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
  explanation: string;
};

export type AnomalyCheckResult = {
  risk_score: RiskScore;
  risk_flags: RiskFlag[];
};

/**
 * Detects anomalies in an invoice and calculates risk score.
 * When company_id is provided, also queries the trained vendor profile
 * for z-score, splitting, and price-drift flags.
 */
export async function detectAnomalies(
  invoiceData: {
    invoice_number: string;
    invoice_date: string;
    due_date: string;
    vendor_name: string;
    vendor_email: string | null;
    total_amount: number;
    company_id?: string;
  },
  existingInvoices: Array<{
    invoice_number: string;
    vendor_name: string;
    total_amount: number;
    invoice_date: string;
    due_date: string;
    vendor_email: string | null;
  }>
): Promise<AnomalyCheckResult> {
  const flags: RiskFlag[] = [];

  // 1. Check for duplicate invoice number (same vendor + same invoice number)
  const duplicate = existingInvoices.find(
    (inv) =>
      inv.invoice_number.toLowerCase() === invoiceData.invoice_number.toLowerCase() &&
      inv.vendor_name.toLowerCase() === invoiceData.vendor_name.toLowerCase()
  );
  if (duplicate) {
    flags.push({
      type: 'duplicate_invoice',
      severity: 'high',
      message: 'Duplicate Invoice Number',
      explanation: `An invoice with number "${invoiceData.invoice_number}" from "${invoiceData.vendor_name}" already exists. This may indicate a duplicate submission.`,
    });
  }

  // 2. Check for unusually high amount (more than 2x the average for that vendor)
  const vendorInvoices = existingInvoices.filter(
    (inv) => inv.vendor_name.toLowerCase() === invoiceData.vendor_name.toLowerCase()
  );
  if (vendorInvoices.length > 0) {
    const avgAmount =
      vendorInvoices.reduce((sum, inv) => sum + Number(inv.total_amount), 0) /
      vendorInvoices.length;
    const threshold = avgAmount * 2;
    if (invoiceData.total_amount > threshold) {
      flags.push({
        type: 'unusually_high_amount',
        severity: 'medium',
        message: 'Unusually High Amount',
        explanation: `This invoice amount (${invoiceData.total_amount.toLocaleString()}) is more than 2x the average amount (${avgAmount.toLocaleString()}) for this vendor. Please verify.`,
      });
    }
  }

  // 3. Check for missing critical fields
  if (!invoiceData.vendor_email) {
    flags.push({
      type: 'missing_vendor_email',
      severity: 'low',
      message: 'Missing Vendor Email',
      explanation: 'Vendor email is missing. This may delay communication and payment processing.',
    });
  }

  // 4. Check for future invoice date (more than 7 days in the future)
  const invoiceDate = new Date(invoiceData.invoice_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysDiff = Math.ceil((invoiceDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (daysDiff > 7) {
    flags.push({
      type: 'future_invoice_date',
      severity: 'medium',
      message: 'Future Invoice Date',
      explanation: `Invoice date is ${daysDiff} days in the future. This is unusual and may indicate a data entry error.`,
    });
  }

  // 5. Check for very short payment terms (due date is less than 7 days from invoice date)
  const dueDate = new Date(invoiceData.due_date);
  const paymentTermsDays = Math.ceil((dueDate.getTime() - invoiceDate.getTime()) / (1000 * 60 * 60 * 24));
  if (paymentTermsDays < 7 && paymentTermsDays >= 0) {
    flags.push({
      type: 'short_payment_terms',
      severity: 'medium',
      message: 'Very Short Payment Terms',
      explanation: `Payment terms are only ${paymentTermsDays} days. This may require immediate attention for payment processing.`,
    });
  }

  // 6. Check for overdue invoice (due date is in the past)
  if (dueDate < today) {
    flags.push({
      type: 'overdue_invoice',
      severity: 'high',
      message: 'Overdue Invoice',
      explanation: `This invoice is already past its due date. Immediate action may be required.`,
    });
  }

  // 7. Training-based vendor profile check (if company_id is provided)
  if (invoiceData.company_id) {
    const training = await checkTrainingAnomaly({
      company_id: invoiceData.company_id,
      vendor_name: invoiceData.vendor_name,
      amount: invoiceData.total_amount,
      invoice_date: invoiceData.invoice_date,
    });
    if (training) {
      for (const flag of training.anomaly_flags) {
        const severityMap: Record<string, 'low' | 'medium' | 'high'> = {
          new_vendor_no_history: 'low',
          high_amount_anomaly: 'medium',
          extreme_amount_anomaly: 'high',
          price_drift_detected: 'low',
          recurring_amount_deviation: 'medium',
          potential_invoice_splitting: 'high',
          high_historical_rejection_rate: 'medium',
        };
        const explanation = training.explanations[training.anomaly_flags.indexOf(flag)] || flag;
        flags.push({
          type: flag,
          severity: severityMap[flag] ?? 'medium',
          message: flag.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          explanation,
        });
      }
    }
  }

  // Calculate risk score based on flags
  let riskScore: RiskScore = 'low';
  const highSeverityCount = flags.filter((f) => f.severity === 'high').length;
  const mediumSeverityCount = flags.filter((f) => f.severity === 'medium').length;

  if (highSeverityCount > 0) {
    riskScore = 'high';
  } else if (mediumSeverityCount >= 2 || flags.length >= 3) {
    riskScore = 'medium';
  } else if (flags.length > 0) {
    riskScore = 'low';
  }

  return {
    risk_score: riskScore,
    risk_flags: flags,
  };
}

