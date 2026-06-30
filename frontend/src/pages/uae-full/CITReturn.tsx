/**
 * UAE Corporate Tax Return — structured Q&A form, GL auto-fill, CIT voucher posting
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FileText, Printer, Receipt } from 'lucide-react';
import * as citSvc from '../../services/citReturn.service';
import type { CITReturnData } from '../../services/citReturn.service';
import { listAccounts } from '../../services/uaeFullAccounting.service';

const CT_RATE = 0.09;

function fmt(n: number) {
  return `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 0 })}`;
}

function periodDefaults() {
  const y = new Date().getFullYear();
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

type YesNo = 'Yes' | 'No';

function ynSelect(value: boolean, onChange: (v: boolean) => void) {
  return (
    <select
      value={value ? 'Yes' : 'No'}
      onChange={(e) => onChange(e.target.value === 'Yes')}
      className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm"
    >
      <option value="Yes">Yes</option>
      <option value="No">No</option>
    </select>
  );
}

export default function CITReturn() {
  const defaults = periodDefaults();
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);
  const [data, setData] = useState<CITReturnData | null>(null);
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<{ code: string; name: string }[]>([]);
  const [showVoucher, setShowVoucher] = useState(false);
  const [voucher, setVoucher] = useState<{ je_id: string; voucher_number: string } | null>(null);
  const [taxExpenseAcct, setTaxExpenseAcct] = useState('7180');
  const [taxPayableAcct, setTaxPayableAcct] = useState('3020');
  const [voucherDate, setVoucherDate] = useState(defaults.to);
  const [remarks, setRemarks] = useState('');

  useEffect(() => {
    void listAccounts().then((r: { accounts?: { code: string; name: string }[] }) => {
      setAccounts(r.accounts ?? []);
    }).catch(() => {});
  }, []);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const r = await citSvc.generateCITReturn(fromDate, toDate);
      setData(r);
      setRemarks(`Corporate tax provision ${fromDate} to ${toDate}`);
      setVoucherDate(toDate);
      toast.success('CIT return generated from GL');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Generate failed');
    } finally {
      setLoading(false);
    }
  };

  const taxableProfit = data?.session_3?.net_profit_loss ?? 0;
  const sbr = (data?.session_2?.small_business_relief as boolean) ?? false;
  const taxAmount = sbr ? 0 : Math.max(0, taxableProfit - 375_000) * CT_RATE;

  const handleRecordVoucher = async () => {
    try {
      const res = await citSvc.recordCITVoucher({
        period_from: fromDate,
        period_to: toDate,
        tax_amount_aed: taxAmount,
        tax_expense_account: taxExpenseAcct,
        tax_payable_account: taxPayableAcct,
        voucher_date: voucherDate,
        remarks,
      });
      setVoucher(res);
      toast.success(`Voucher ${res.voucher_number} posted`);
      setShowVoucher(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Voucher failed');
    }
  };

  const editableNum = (val: number, onChange: (n: number) => void) => (
    <input
      type="number"
      defaultValue={val}
      onBlur={(e) => onChange(parseFloat(e.target.value) || 0)}
      className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-right w-36 font-mono"
    />
  );

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <Link to="/gulftax/corporate-tax" className="text-sm text-teal-400 hover:underline">← Corporate Tax</Link>
          <h1 className="text-2xl font-bold text-white mt-2">Corporate Tax Return</h1>
          {data && (
            <div className="mt-2 text-sm text-gray-400 space-y-1">
              <p><span className="text-gray-500">Entity:</span> {data.entity_name} | TRN: {data.trn}</p>
              <p>{data.address}</p>
              <p>Period: {data.ct_return_period} | Due: {data.ct_return_due_date} | Filing: {data.filing_date}</p>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm" />
          <span className="text-gray-500">to</span>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm" />
          <button onClick={() => void handleGenerate()} disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {loading ? 'Generating…' : 'Generate Report'}
          </button>
          {data && (
            <button onClick={() => setShowVoucher(true)}
              className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 px-4 py-2 rounded-lg text-sm font-medium">
              <Receipt size={14} /> Record Tax Voucher
            </button>
          )}
        </div>
      </div>

      {!data && !loading && (
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-16 text-center">
          <FileText size={40} className="text-blue-400 mx-auto mb-4" />
          <p className="text-white font-semibold">Generate CIT Return from GL</p>
          <p className="text-gray-400 text-sm mt-2">Select period and click Generate Report</p>
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {/* Section 1 */}
          <section className="bg-gray-800/60 border border-gray-700 rounded-xl p-5">
            <h2 className="text-sm font-bold text-teal-400 uppercase mb-4">Section 1 — Taxpayer Details</h2>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-700/50">
                {[
                  ['Is information correct?', ynSelect(data.session_1.info_correct as boolean, () => {})],
                  ['Is Taxable Person a partner?', ynSelect(data.session_1.is_partnership as boolean, () => {})],
                  ['Revenue derived', editableNum(data.session_1.revenue_derived as number, () => {})],
                  ['Financial statements basis', <span key="fs" className="text-gray-300">Accrual / Cash</span>],
                  ['Member of MNE Group?', ynSelect(data.session_1.is_mne_group as boolean, () => {})],
                  ['UAE incorporated?', ynSelect(data.session_1.uae_incorporated as boolean, () => {})],
                  ['Tax resident in foreign jurisdiction?', ynSelect(data.session_1.tax_resident_foreign as boolean, () => {})],
                ].map(([label, ctrl]) => (
                  <tr key={String(label)}>
                    <td className="py-2 text-gray-400 w-1/2">{label}</td>
                    <td className="py-2">{ctrl}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Section 2 */}
          <section className="bg-gray-800/60 border border-gray-700 rounded-xl p-5">
            <h2 className="text-sm font-bold text-teal-400 uppercase mb-4">Section 2 — Elections</h2>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-700/50">
                {[
                  ['Small Business Relief election?', ynSelect(data.session_2.small_business_relief as boolean, () => {})],
                  ['Revenue in taxable period', fmt(data.session_2.sbr_revenue as number)],
                  ['Qualifies as QFZP (2A)?', ynSelect(data.session_2a.qualifies_as_qfzp as boolean, () => {})],
                ].map(([label, ctrl]) => (
                  <tr key={String(label)}>
                    <td className="py-2 text-gray-400">{label}</td>
                    <td className="py-2">{ctrl}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Section 3 */}
          <section className="bg-gray-800/60 border border-gray-700 rounded-xl p-5">
            <h2 className="text-sm font-bold text-teal-400 uppercase mb-4">Section 3 — Accounting Schedules</h2>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-700/50">
                {[
                  ['Operating Revenue', data.session_3.operating_revenue],
                  ['Expenditure (operating)', data.session_3.expenditure_operating],
                  ['Gross Profit', data.session_3.gross_profit],
                  ['Operating Expense', data.session_3.operating_expense],
                  ['Net Interest', data.session_3.net_interest],
                  ['Net Profit/Loss', data.session_3.net_profit_loss],
                  ['Estimated Tax (9%)', taxAmount],
                ].map(([label, val]) => (
                  <tr key={String(label)}>
                    <td className="py-2 text-gray-400">{label}</td>
                    <td className="py-2 text-right font-mono">{typeof val === 'number' ? fmt(val) : val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {/* Voucher modal */}
      {showVoucher && data && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-lg w-full">
            <h3 className="text-lg font-bold text-white mb-4">Record Tax Voucher</h3>
            <p className="text-emerald-400 font-semibold mb-4">Tax Amount: {fmt(taxAmount)}</p>
            <div className="space-y-3 text-sm">
              <label className="block">Voucher Date
                <input type="date" value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)}
                  className="mt-1 w-full bg-gray-800 border border-gray-600 rounded px-2 py-1" />
              </label>
              <label className="block">Tax Expense Account
                <select value={taxExpenseAcct} onChange={(e) => setTaxExpenseAcct(e.target.value)}
                  className="mt-1 w-full bg-gray-800 border border-gray-600 rounded px-2 py-1">
                  {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                </select>
              </label>
              <label className="block">Tax Payable Account
                <select value={taxPayableAcct} onChange={(e) => setTaxPayableAcct(e.target.value)}
                  className="mt-1 w-full bg-gray-800 border border-gray-600 rounded px-2 py-1">
                  {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                </select>
              </label>
              <label className="block">Remarks
                <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2}
                  className="mt-1 w-full bg-gray-800 border border-gray-600 rounded px-2 py-1" />
              </label>
            </div>
            <div className="flex gap-2 justify-end mt-6">
              <button onClick={() => setShowVoucher(false)} className="px-4 py-2 rounded-lg bg-gray-700 text-sm">Cancel</button>
              <button onClick={() => void handleRecordVoucher()} className="px-4 py-2 rounded-lg bg-emerald-600 text-sm font-medium">
                Record Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Printable voucher */}
      {voucher && data && (
        <div className="mt-8 bg-white text-gray-900 rounded-xl p-8 max-w-2xl mx-auto print:shadow-none" id="cit-voucher">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h3 className="text-xl font-bold">{data.entity_name}</h3>
              <p className="text-sm text-gray-600">Journal Voucher — {voucher.voucher_number}</p>
              <p className="text-sm text-gray-600">Date: {voucherDate}</p>
            </div>
            <button onClick={() => window.print()} className="flex items-center gap-2 bg-gray-200 px-3 py-2 rounded text-sm print:hidden">
              <Printer size={14} /> Print
            </button>
          </div>
          <table className="w-full text-sm border border-gray-300">
            <thead className="bg-gray-100">
              <tr>
                <th className="border border-gray-300 px-3 py-2 text-left">Account</th>
                <th className="border border-gray-300 px-3 py-2 text-left">Reference</th>
                <th className="border border-gray-300 px-3 py-2 text-right">Debit</th>
                <th className="border border-gray-300 px-3 py-2 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-gray-300 px-3 py-2">Current Tax Expense ({taxExpenseAcct})</td>
                <td className="border border-gray-300 px-3 py-2">CIT_PROVISION</td>
                <td className="border border-gray-300 px-3 py-2 text-right font-mono">{fmt(taxAmount)}</td>
                <td className="border border-gray-300 px-3 py-2 text-right">—</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-3 py-2">Corporate Tax Payable ({taxPayableAcct})</td>
                <td className="border border-gray-300 px-3 py-2">CIT_PROVISION</td>
                <td className="border border-gray-300 px-3 py-2 text-right">—</td>
                <td className="border border-gray-300 px-3 py-2 text-right font-mono">{fmt(taxAmount)}</td>
              </tr>
              <tr className="font-bold bg-gray-50">
                <td colSpan={2} className="border border-gray-300 px-3 py-2">Total</td>
                <td className="border border-gray-300 px-3 py-2 text-right font-mono">{fmt(taxAmount)}</td>
                <td className="border border-gray-300 px-3 py-2 text-right font-mono">{fmt(taxAmount)}</td>
              </tr>
            </tbody>
          </table>
          <div className="grid grid-cols-3 gap-8 mt-12 text-sm text-gray-600">
            <div><p className="border-t border-gray-400 pt-2 mt-8">Created By</p></div>
            <div><p className="border-t border-gray-400 pt-2 mt-8">Checked By</p></div>
            <div><p className="border-t border-gray-400 pt-2 mt-8">Verified By</p></div>
          </div>
        </div>
      )}
    </div>
  );
}
