import type { Invoice } from '@/lib/ap-invoice/supabase';
import { getCategoryForIndustry } from '@/lib/ap-invoice/invoiceCategories';

function fmt(n: number | null | undefined, currency = 'INR'): string {
  if (n == null || isNaN(Number(n))) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(n));
}

function VarianceRow({ label, value, pct, warn }: { label: string; value: string; pct?: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-xs font-semibold ${warn ? 'text-red-600' : 'text-slate-700'}`}>
        {value}{pct ? <span className="ml-1 text-[11px] font-normal text-slate-400">({pct})</span> : null}
      </span>
    </div>
  );
}

function AmountBox({ label, amount, currency, highlight }: { label: string; amount: number | null | undefined; currency?: string; highlight?: 'green' | 'amber' | 'red' }) {
  const bg = highlight === 'green' ? 'bg-emerald-50 border-emerald-200' :
             highlight === 'amber' ? 'bg-amber-50 border-amber-200' :
             highlight === 'red' ? 'bg-red-50 border-red-200' :
             'bg-slate-50 border-slate-200';
  const text = highlight === 'green' ? 'text-emerald-700' :
               highlight === 'amber' ? 'text-amber-700' :
               highlight === 'red' ? 'text-red-700' :
               'text-slate-700';
  return (
    <div className={`rounded-lg border px-3 py-2.5 flex-1 min-w-0 ${bg}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{label}</div>
      <div className={`text-sm font-bold ${text}`}>{fmt(amount, currency)}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = String(status || 'no_po').toLowerCase();
  const cfg: Record<string, { label: string; className: string }> = {
    three_way_matched: { label: '3-Way Matched', className: 'bg-emerald-100 text-emerald-800' },
    matched:           { label: 'PO Matched',    className: 'bg-blue-100 text-blue-800' },
    partial:           { label: 'Partial',        className: 'bg-amber-100 text-amber-800' },
    mismatch:          { label: 'Variance',       className: 'bg-red-100 text-red-800' },
    no_po:             { label: 'No PO',          className: 'bg-slate-100 text-slate-600' },
    no_grn:            { label: 'Awaiting GRN',   className: 'bg-amber-100 text-amber-700' },
    amount_variance:   { label: 'Amount Variance','className': 'bg-red-100 text-red-800' },
    qty_variance:      { label: 'Qty Variance',   className: 'bg-orange-100 text-orange-800' },
    failed:            { label: 'Review Required','className': 'bg-red-100 text-red-800' },
  };
  const { label, className } = cfg[s] ?? cfg['no_po'];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${className}`}>
      {label}
    </span>
  );
}

function ApprovalRoutingBox({ status, autoApproved }: { status: string | null | undefined; autoApproved?: boolean | null }) {
  const s = String(status || '').toLowerCase();
  const matched = s === 'three_way_matched' || s === 'matched';
  if (autoApproved) {
    return (
      <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2.5 flex items-center gap-2">
        <span className="text-emerald-600 text-base">✓</span>
        <div>
          <div className="text-xs font-semibold text-emerald-800">Auto-approved</div>
          <div className="text-[11px] text-emerald-600">Within tolerance — no manual review required</div>
        </div>
      </div>
    );
  }
  if (matched) {
    return (
      <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5 flex items-center gap-2">
        <span className="text-blue-600 text-base">→</span>
        <div>
          <div className="text-xs font-semibold text-blue-800">Ready for approval</div>
          <div className="text-[11px] text-blue-600">PO/GRN match within tolerance — route to approver</div>
        </div>
      </div>
    );
  }
  if (s === 'no_po') {
    return (
      <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 flex items-center gap-2">
        <span className="text-slate-400 text-base">⚠</span>
        <div>
          <div className="text-xs font-semibold text-slate-700">PO required</div>
          <div className="text-[11px] text-slate-500">Link a purchase order to enable 3-way matching</div>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 flex items-center gap-2">
      <span className="text-amber-600 text-base">!</span>
      <div>
        <div className="text-xs font-semibold text-amber-800">Exception review required</div>
        <div className="text-[11px] text-amber-600">Variance or missing receipt — route to reviewer</div>
      </div>
    </div>
  );
}

// ─── Raw Material: PO / GRN / Invoice 3-way match ───────────────────────────

function RawMaterialWorkflow({ invoice }: { invoice: Invoice }) {
  const currency = invoice.currency || 'INR';
  const invoiceAmt = Number(invoice.total_amount ?? 0);
  const poAmt = Number(invoice.po_amount ?? 0);
  const grnAmt = Number(invoice.grn_amount ?? 0);
  const varianceAmt = poAmt > 0 ? Math.abs(invoiceAmt - poAmt) : 0;
  const variancePct = poAmt > 0 ? ((varianceAmt / poAmt) * 100).toFixed(1) : null;
  const matchStatus = invoice.match_status;
  const hasVariance = variancePct != null && parseFloat(variancePct) > 3;
  const exceptions = invoice.match_notes
    ? invoice.match_notes.split('\n').filter((l) => l.trim() && !l.startsWith('Full') && !l.startsWith('2-way') && !l.startsWith('Auto'))
    : [];

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Workflow</div>
          <div className="text-sm font-bold text-slate-800">PO → GRN → Invoice Match</div>
        </div>
        <StatusBadge status={matchStatus} />
      </div>

      {/* Amount comparison */}
      <div className="flex gap-2">
        <AmountBox label="Invoice" amount={invoiceAmt} currency={currency} />
        <AmountBox label="PO" amount={poAmt > 0 ? poAmt : null} currency={currency} highlight={poAmt > 0 ? 'green' : undefined} />
        <AmountBox label="GRN" amount={grnAmt > 0 ? grnAmt : null} currency={currency} highlight={grnAmt > 0 ? 'green' : undefined} />
      </div>

      {/* Variance table */}
      <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Variance Analysis</div>
        <VarianceRow label="Invoice vs PO" value={poAmt > 0 ? fmt(varianceAmt, currency) : '—'} pct={variancePct ? `${variancePct}%` : undefined} warn={hasVariance} />
        {grnAmt > 0 && poAmt > 0 && (
          <VarianceRow
            label="GRN vs PO"
            value={fmt(Math.abs(grnAmt - poAmt), currency)}
            pct={`${((Math.abs(grnAmt - poAmt) / poAmt) * 100).toFixed(1)}%`}
            warn={Math.abs(grnAmt - poAmt) / poAmt > 0.03}
          />
        )}
        {grnAmt > 0 && (
          <VarianceRow
            label="Invoice vs GRN"
            value={fmt(Math.abs(invoiceAmt - grnAmt), currency)}
            pct={`${((Math.abs(invoiceAmt - grnAmt) / Math.max(invoiceAmt, grnAmt)) * 100).toFixed(1)}%`}
            warn={Math.abs(invoiceAmt - grnAmt) / Math.max(invoiceAmt, grnAmt) > 0.02}
          />
        )}
        {invoice.match_score != null && (
          <VarianceRow label="Match score" value={`${Math.round(Number(invoice.match_score))}/100`} />
        )}
      </div>

      {/* Match notes / exceptions */}
      {invoice.match_notes && (
        <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Match notes</div>
          {invoice.match_notes.split('\n').filter(Boolean).map((line, i) => (
            <div key={i} className="text-[11px] text-slate-600">{line}</div>
          ))}
        </div>
      )}

      {/* Approval routing */}
      <ApprovalRoutingBox status={matchStatus} autoApproved={invoice.auto_matched && (matchStatus === 'three_way_matched' || matchStatus === 'matched')} />
    </div>
  );
}

// ─── Machinery / CapEx ───────────────────────────────────────────────────────

function MachineryCapexWorkflow({ invoice }: { invoice: Invoice }) {
  const currency = invoice.currency || 'INR';
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Workflow</div>
          <div className="text-sm font-bold text-slate-800">CapEx Classification → Asset Register</div>
        </div>
        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-purple-100 text-purple-800">
          CapEx
        </span>
      </div>
      <div className="rounded-lg border border-purple-100 bg-purple-50 px-3 py-3 space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-slate-500">Invoice amount</span>
          <span className="font-semibold text-slate-800">{fmt(invoice.total_amount, currency)}</span>
        </div>
        {invoice.po_number && (
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">PO reference</span>
            <span className="font-mono text-slate-800">{invoice.po_number}</span>
          </div>
        )}
        <div className="flex justify-between text-xs">
          <span className="text-slate-500">Vendor</span>
          <span className="text-slate-800 truncate max-w-[180px]">{invoice.vendor_name || '—'}</span>
        </div>
      </div>
      <div className="rounded-lg bg-white border border-slate-100 px-3 py-2.5 space-y-1.5 text-xs">
        <div className="font-semibold text-slate-700 text-[11px] uppercase tracking-wide mb-1">CapEx checklist</div>
        <div className="flex gap-2 text-slate-600">
          <span>{invoice.po_id || invoice.po_number ? '✓' : '○'}</span>
          <span>PO raised and approved</span>
        </div>
        <div className="flex gap-2 text-slate-600">
          <span>{(invoice.grn_amount ?? 0) > 0 ? '✓' : '○'}</span>
          <span>Goods/equipment received (GRN)</span>
        </div>
        <div className="flex gap-2 text-slate-600">
          <span>○</span>
          <span>Suggested asset category — pending review</span>
        </div>
        <div className="flex gap-2 text-slate-600">
          <span>○</span>
          <span>Asset register handoff — pending approval</span>
        </div>
      </div>
      <div className="rounded-lg bg-purple-50 border border-purple-200 px-3 py-2.5 flex items-center gap-2">
        <span className="text-purple-600 text-base">→</span>
        <div>
          <div className="text-xs font-semibold text-purple-800">Route to CapEx approver</div>
          <div className="text-[11px] text-purple-600">Requires finance/CFO approval before asset capitalisation</div>
        </div>
      </div>
    </div>
  );
}

// ─── Spare Parts ─────────────────────────────────────────────────────────────

function SparePartsWorkflow({ invoice }: { invoice: Invoice }) {
  const currency = invoice.currency || 'INR';
  const matchStatus = invoice.match_status;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Workflow</div>
          <div className="text-sm font-bold text-slate-800">Inventory / Maintenance Classification</div>
        </div>
        <StatusBadge status={matchStatus} />
      </div>
      <div className="flex gap-2">
        <AmountBox label="Invoice" amount={invoice.total_amount} currency={currency} />
        <AmountBox label="PO" amount={invoice.po_amount} currency={currency} highlight={(invoice.po_amount ?? 0) > 0 ? 'green' : undefined} />
      </div>
      <div className="rounded-lg border border-slate-100 bg-white px-3 py-2.5 space-y-1.5 text-xs">
        <div className="font-semibold text-slate-700 text-[11px] uppercase tracking-wide mb-1">Classification</div>
        <div className="flex gap-2 text-slate-600">
          <span>{(invoice.po_id || invoice.po_number) ? '✓' : '○'}</span>
          <span>PO / work order reference</span>
        </div>
        <div className="flex gap-2 text-slate-600">
          <span>○</span>
          <span>Inventory vs maintenance expense — pending review</span>
        </div>
        <div className="flex gap-2 text-slate-600">
          <span>○</span>
          <span>Spare parts issue / consumption recorded</span>
        </div>
      </div>
      <ApprovalRoutingBox status={matchStatus} />
    </div>
  );
}

// ─── Freight ─────────────────────────────────────────────────────────────────

function FreightWorkflow({ invoice }: { invoice: Invoice }) {
  const currency = invoice.currency || 'INR';
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Workflow</div>
          <div className="text-sm font-bold text-slate-800">Freight Cost Allocation</div>
        </div>
        <StatusBadge status={invoice.match_status} />
      </div>
      <div className="flex gap-2">
        <AmountBox label="Invoice" amount={invoice.total_amount} currency={currency} />
        <AmountBox label="PO / LR Ref" amount={invoice.po_amount} currency={currency} highlight={(invoice.po_amount ?? 0) > 0 ? 'green' : undefined} />
      </div>
      <div className="rounded-lg border border-slate-100 bg-white px-3 py-2.5 space-y-1.5 text-xs">
        <div className="font-semibold text-slate-700 text-[11px] uppercase tracking-wide mb-1">Freight checklist</div>
        <div className="flex gap-2 text-slate-600">
          <span>{invoice.po_number ? '✓' : '○'}</span>
          <span>Lorry receipt / transport reference linked</span>
        </div>
        <div className="flex gap-2 text-slate-600">
          <span>○</span>
          <span>Freight cost allocation to cost centre — pending</span>
        </div>
        <div className="flex gap-2 text-slate-600">
          <span>○</span>
          <span>Inward / outward freight classification</span>
        </div>
      </div>
      <ApprovalRoutingBox status={invoice.match_status} />
    </div>
  );
}

// ─── Electricity / Utility ───────────────────────────────────────────────────

function UtilityWorkflow({ invoice }: { invoice: Invoice }) {
  const currency = invoice.currency || 'INR';
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Workflow</div>
          <div className="text-sm font-bold text-slate-800">Utility Expense Classification</div>
        </div>
        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-yellow-100 text-yellow-800">
          Utility
        </span>
      </div>
      <div className="flex gap-2">
        <AmountBox label="Invoice" amount={invoice.total_amount} currency={currency} />
      </div>
      <div className="rounded-lg border border-slate-100 bg-white px-3 py-2.5 space-y-1.5 text-xs">
        <div className="font-semibold text-slate-700 text-[11px] uppercase tracking-wide mb-1">Utility checklist</div>
        <div className="flex gap-2 text-slate-600">
          <span>{invoice.vendor_name ? '✓' : '○'}</span>
          <span>Utility provider identified: {invoice.vendor_name || '—'}</span>
        </div>
        <div className="flex gap-2 text-slate-600">
          <span>○</span>
          <span>Billing period extraction — pending review</span>
        </div>
        <div className="flex gap-2 text-slate-600">
          <span>○</span>
          <span>Department / cost-centre allocation — pending</span>
        </div>
      </div>
      <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5 flex items-center gap-2">
        <span className="text-blue-600 text-base">→</span>
        <div>
          <div className="text-xs font-semibold text-blue-800">Route to department head</div>
          <div className="text-[11px] text-blue-600">Cost-centre allocation required before approval</div>
        </div>
      </div>
    </div>
  );
}

// ─── Construction: Contractor RA Bill ────────────────────────────────────────

function ContractorRABillWorkflow({ invoice }: { invoice: Invoice }) {
  const currency = invoice.currency || 'INR';
  const matchStatus = invoice.match_status;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Workflow</div>
          <div className="text-sm font-bold text-slate-800">Running Account Bill Verification</div>
        </div>
        <StatusBadge status={matchStatus} />
      </div>
      <div className="flex gap-2">
        <AmountBox label="Invoice" amount={invoice.total_amount} currency={currency} />
        <AmountBox label="Contract Ref" amount={invoice.po_amount} currency={currency} highlight={(invoice.po_amount ?? 0) > 0 ? 'green' : undefined} />
        <AmountBox label="Certified" amount={invoice.grn_amount} currency={currency} highlight={(invoice.grn_amount ?? 0) > 0 ? 'green' : undefined} />
      </div>
      <div className="rounded-lg border border-slate-100 bg-white px-3 py-2.5 space-y-1.5 text-xs">
        <div className="font-semibold text-slate-700 text-[11px] uppercase tracking-wide mb-1">RA Bill checklist</div>
        <div className="flex gap-2 text-slate-600">
          <span>{invoice.po_number ? '✓' : '○'}</span>
          <span>Contract / work order reference</span>
        </div>
        <div className="flex gap-2 text-slate-600">
          <span>{(invoice.grn_amount ?? 0) > 0 ? '✓' : '○'}</span>
          <span>Work done certificate / progress certificate</span>
        </div>
        <div className="flex gap-2 text-slate-600">
          <span>○</span>
          <span>Retention amount deduction check</span>
        </div>
      </div>
      <ApprovalRoutingBox status={matchStatus} />
    </div>
  );
}

// ─── Generic construction / unknown category fallback ─────────────────────────

function GenericWorkflow({ invoice, categoryLabel, workflowLabel }: { invoice: Invoice; categoryLabel: string; workflowLabel: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Workflow</div>
          <div className="text-sm font-bold text-slate-800">{workflowLabel}</div>
        </div>
        <StatusBadge status={invoice.match_status} />
      </div>
      <div className="flex gap-2">
        <AmountBox label="Invoice" amount={invoice.total_amount} currency={invoice.currency || 'INR'} />
        {(invoice.po_amount ?? 0) > 0 && <AmountBox label="PO" amount={invoice.po_amount} currency={invoice.currency || 'INR'} highlight="green" />}
      </div>
      {invoice.match_notes && (
        <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-[11px] text-slate-600">
          {invoice.match_notes}
        </div>
      )}
      <ApprovalRoutingBox status={invoice.match_status} />
    </div>
  );
}

// ─── Main exported component ──────────────────────────────────────────────────

const MFG_CATEGORIES = new Set(['raw_material', 'machinery_capex', 'spare_parts', 'freight', 'electricity_utility', 'packaging', 'subcontracting']);
const CONS_CATEGORIES = new Set(['contractor_ra_bill', 'cement', 'steel', 'equipment_rental', 'subcontractor', 'labour', 'consultant', 'transport']);

export function ManufacturingWorkflowPanel({ invoice }: { invoice: Invoice }) {
  const cat = invoice.expense_category?.trim();
  if (!cat) return null;

  const isMfg = MFG_CATEGORIES.has(cat);
  const isCons = CONS_CATEGORIES.has(cat);
  if (!isMfg && !isCons) return null;

  const industryKey = isMfg ? 'manufacturing' : 'construction';
  const categoryConfig = getCategoryForIndustry(industryKey, cat);
  const categoryLabel = categoryConfig?.label ?? cat;
  const workflowLabel = categoryConfig?.workflowLabel ?? 'Standard AP Processing';

  const themeColor = isMfg ? '#1E40AF' : '#B45309';
  const industryLabel = isMfg ? '🏭 Manufacturing AP' : '🏗️ Construction AP';

  function renderBody() {
    switch (cat) {
      case 'raw_material':     return <RawMaterialWorkflow invoice={invoice} />;
      case 'machinery_capex':  return <MachineryCapexWorkflow invoice={invoice} />;
      case 'spare_parts':      return <SparePartsWorkflow invoice={invoice} />;
      case 'freight':          return <FreightWorkflow invoice={invoice} />;
      case 'electricity_utility': return <UtilityWorkflow invoice={invoice} />;
      case 'contractor_ra_bill':  return <ContractorRABillWorkflow invoice={invoice} />;
      default:                 return <GenericWorkflow invoice={invoice} categoryLabel={categoryLabel} workflowLabel={workflowLabel} />;
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      {/* Panel header */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between" style={{ background: `${themeColor}08` }}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: themeColor }} />
          <span className="text-xs font-semibold text-slate-600">{industryLabel}</span>
          <span className="text-slate-300 text-xs">·</span>
          <span className="text-xs font-medium text-slate-700">{categoryLabel}</span>
        </div>
        <span className="text-[10px] text-slate-400">{workflowLabel}</span>
      </div>
      {/* Panel body */}
      <div className="px-4 py-4">
        {renderBody()}
      </div>
    </div>
  );
}
