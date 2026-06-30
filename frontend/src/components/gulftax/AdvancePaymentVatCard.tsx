import type { Invoice } from '@/lib/ap-invoice/supabase';
import { formatAed, formatUaeDate } from '@/lib/ap-invoice/uaeVatService';

type Props = {
  invoice: Invoice;
};

export function AdvancePaymentVatCard({ invoice }: Props) {
  if (!invoice.is_advance_payment) return null;

  const vatOnAdvance = Number(invoice.advance_vat_amount ?? 0);
  const remainingContract = Number(invoice.contract_value ?? 0) - Number(invoice.total_amount ?? 0);
  const vatAtDelivery = Number(invoice.remaining_vat_amount ?? 0);
  const totalVat = vatOnAdvance + vatAtDelivery;

  const invDate = invoice.invoice_date;
  const quarter = invDate
    ? (() => {
        const d = new Date(invDate.slice(0, 10));
        const q = Math.floor(d.getMonth() / 3) + 1;
        return `${d.getFullYear()}-Q${q}`;
      })()
    : '—';

  return (
    <div
      className="rounded-xl border-2 p-5 space-y-3"
      style={{ borderColor: '#C8A951', background: 'linear-gradient(135deg, #f8f6ef 0%, #eef4fb 100%)' }}
    >
      <h3 className="font-semibold text-[#1E3A5F] flex items-center gap-2">
        ⚡ Advance Payment VAT — FTA Rule Applied
      </h3>
      <div className="grid gap-2 text-sm text-gray-800 font-mono">
        <div className="flex justify-between">
          <span>VAT triggered:</span>
          <span className="font-semibold">{formatUaeDate(invDate)}</span>
        </div>
        <div className="flex justify-between">
          <span>VAT on this advance:</span>
          <span className="font-semibold text-[#1E3A5F]">{formatAed(vatOnAdvance)}</span>
        </div>
        <div className="flex justify-between">
          <span>Remaining contract:</span>
          <span className="font-semibold">{formatAed(remainingContract)}</span>
        </div>
        <div className="flex justify-between">
          <span>VAT at delivery:</span>
          <span className="font-semibold">{formatAed(vatAtDelivery)}</span>
        </div>
        <div className="flex justify-between border-t border-[#C8A951]/40 pt-2">
          <span className="font-semibold">Total VAT payable:</span>
          <span className="font-bold text-[#1E3A5F]">{formatAed(totalVat)}</span>
        </div>
      </div>
      <div className="text-xs text-green-800 space-y-1 pt-1">
        <div>✅ Tax Invoice issued</div>
        <div>✅ Reported in period: {quarter}</div>
        {invoice.delivery_date && (
          <div>📅 Expected delivery: {formatUaeDate(invoice.delivery_date)}</div>
        )}
      </div>
    </div>
  );
}
