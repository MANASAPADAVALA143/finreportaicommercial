/**
 * UAE Corporate Tax Return — structured Q&A form, GL auto-fill, CIT voucher posting
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FileText, Printer, Receipt, CheckCircle, Send, History } from 'lucide-react';
import * as citSvc from '../../services/citReturn.service';
import type { CITReturnData, CtReturnRecord } from '../../services/citReturn.service';
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
  const [ctReturn, setCtReturn] = useState<CtReturnRecord | null>(null);
  const [ctHistory, setCtHistory] = useState<CtReturnRecord[]>([]);
  const [ctLoading, setCtLoading] = useState(false);
  const [electSbr, setElectSbr] = useState(false);
  const [showFileOverride, setShowFileOverride] = useState(false);
  const [fileOverrideReason, setFileOverrideReason] = useState('');
  const [fileMsg, setFileMsg] = useState<string | null>(null);

  const loadCtHistory = async () => {
    try {
      const items = await citSvc.listCtReturns();
      setCtHistory(items);
    } catch {
      /* optional */
    }
  };

  useEffect(() => {
    void loadCtHistory();
  }, []);

  useEffect(() => {
    void listAccounts().then((r: { accounts?: { code: string; name: string }[] }) => {
      setAccounts(r.accounts ?? []);
    }).catch(() => {});
  }, []);

  const handleGenerateCtReturn = async () => {
    setCtLoading(true);
    setFileMsg(null);
    try {
      const r = await citSvc.generateCtReturn(fromDate, toDate, electSbr);
      setCtReturn(r);
      await loadCtHistory();
      toast.success('CT return draft saved');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'CT return generate failed');
    } finally {
      setCtLoading(false);
    }
  };

  const handleApproveCt = async () => {
    if (!ctReturn) return;
    try {
      const r = await citSvc.approveCtReturn(ctReturn.id);
      setCtReturn(r);
      await loadCtHistory();
      toast.success('CT return approved');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Approve failed');
    }
  };

  const handleFileCt = async (overrideReason?: string) => {
    if (!ctReturn) return;
    try {
      const r = await citSvc.fileCtReturn(ctReturn.id, overrideReason);
      if (r.blocked) {
        setFileMsg(r.message ?? 'Approve return before filing');
        setShowFileOverride(true);
        return;
      }
      setCtReturn(r);
      setShowFileOverride(false);
      setFileOverrideReason('');
      setFileMsg(r.warning ? r.message ?? 'Filed with override' : null);
      await loadCtHistory();
      toast.success(r.message ?? 'CT return filed');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'File failed');
    }
  };

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
          <button onClick={() => void handleGenerateCtReturn()} disabled={ctLoading}
            className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {ctLoading ? 'Saving…' : 'Generate CT Return'}
          </button>
          <label className="flex items-center gap-2 text-sm text-gray-300 bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2">
            <input
              type="checkbox"
              checked={electSbr}
              onChange={(e) => setElectSbr(e.target.checked)}
              className="rounded"
            />
            Elect SBR (when eligible)
          </label>
          {data && (
            <button onClick={() => setShowVoucher(true)}
              className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 px-4 py-2 rounded-lg text-sm font-medium">
              <Receipt size={14} /> Record Tax Voucher
            </button>
          )}
        </div>
      </div>

      {!data && !loading && !ctReturn && (
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-16 text-center">
          <FileText size={40} className="text-blue-400 mx-auto mb-4" />
          <p className="text-white font-semibold">Generate CIT Return from GL</p>
          <p className="text-gray-400 text-sm mt-2">Select period — Generate Report for Q&A form, or Generate CT Return to persist draft on RDS</p>
        </div>
      )}

      {ctReturn && (
        <section className="bg-gray-800/60 border border-indigo-500/40 rounded-xl p-5 mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-sm font-bold text-indigo-400 uppercase">CT Return — {ctReturn.status}</h2>
              <p className="text-xs text-gray-400 mt-1">
                {ctReturn.period_start} → {ctReturn.period_end} · ID {ctReturn.id.slice(0, 8)}…
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {ctReturn.status === 'draft' && (
                <button onClick={() => void handleApproveCt()}
                  className="flex items-center gap-1 bg-teal-700 hover:bg-teal-600 px-3 py-1.5 rounded-lg text-sm">
                  <CheckCircle size={14} /> Approve
                </button>
              )}
              {ctReturn.status !== 'filed' && (
                <button onClick={() => void handleFileCt()}
                  className="flex items-center gap-1 bg-amber-700 hover:bg-amber-600 px-3 py-1.5 rounded-lg text-sm">
                  <Send size={14} /> File Return
                </button>
              )}
            </div>
          </div>
          {fileMsg && <p className="text-xs text-amber-300 mb-3">{fileMsg}</p>}
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div className="space-y-2">
              <p><span className="text-gray-500">Revenue:</span> <span className="font-mono">{fmt(ctReturn.revenue)}</span></p>
              <p><span className="text-gray-500">Accounting profit:</span> <span className="font-mono">{fmt(ctReturn.accounting_profit)}</span></p>
              <p><span className="text-gray-500">Taxable income:</span> <span className="font-mono">{fmt(ctReturn.taxable_income)}</span></p>
              <p><span className="text-gray-500">CT payable:</span> <span className="font-mono text-emerald-400">{fmt(ctReturn.ct_payable_aed)}</span></p>
              {ctReturn.non_deductible_expenses > 0 && (
                <p><span className="text-gray-500">Total add-backs:</span> <span className="font-mono">{fmt(ctReturn.non_deductible_expenses)}</span></p>
              )}
              {(ctReturn.exempt_income_deductions ?? 0) > 0 && (
                <p><span className="text-gray-500">Exempt income deductions:</span> <span className="font-mono text-blue-300">{fmt(ctReturn.exempt_income_deductions)}</span></p>
              )}
            </div>
            <div className="space-y-2">
              <p>
                <span className="text-gray-500">SBR eligible:</span>{' '}
                <span className={ctReturn.sbr_eligible ? 'text-green-400' : 'text-gray-300'}>{ctReturn.sbr_eligible ? 'Yes' : 'No'}</span>
                {ctReturn.sbr_eligible && (
                  <span className="ml-2 text-xs text-gray-400">
                    {ctReturn.sbr_elected ? '(elected — 0% CT)' : '(not elected)'}
                  </span>
                )}
              </p>
              <p>
                <span className="text-gray-500">QFZP:</span>{' '}
                <span className={ctReturn.qfzp_eligible ? 'text-green-400' : 'text-gray-300'}>
                  {ctReturn.qfzp_eligible ? `Yes (${fmt(ctReturn.free_zone_income)} qualifying)` : 'No'}
                </span>
              </p>
              <p><span className="text-gray-500">Zone status:</span> {ctReturn.free_zone_status}</p>
            </div>
          </div>
          {(ctReturn.adjustments?.length ?? 0) > 0 && (
            <div className="mt-4 space-y-4">
              {ctReturn.adjustments.some((a) => a.type === 'add_back') && (
                <div>
                  <h3 className="text-xs font-bold text-amber-400 uppercase mb-2">Add-back adjustments</h3>
                  <table className="w-full text-sm border border-gray-700/50 rounded-lg overflow-hidden">
                    <thead className="bg-gray-900/80 text-gray-400 text-xs uppercase">
                      <tr>
                        <th className="text-left px-3 py-2">Account</th>
                        <th className="text-right px-3 py-2">Gross</th>
                        <th className="text-right px-3 py-2">%</th>
                        <th className="text-right px-3 py-2">Add-back</th>
                        <th className="text-left px-3 py-2">Law</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700/50">
                      {ctReturn.adjustments.filter((a) => a.type === 'add_back').map((a) => (
                        <tr key={`${a.account_code}-add`}>
                          <td className="px-3 py-2"><span className="font-mono text-teal-400">{a.account_code}</span> {a.account_name}</td>
                          <td className="px-3 py-2 text-right font-mono">{a.gross_amount.toLocaleString('en-AE', { minimumFractionDigits: 2 })}</td>
                          <td className="px-3 py-2 text-right font-mono">{a.add_back_pct != null ? `${(a.add_back_pct * 100).toFixed(0)}%` : '—'}</td>
                          <td className="px-3 py-2 text-right font-mono text-amber-300">{a.add_back_amount.toLocaleString('en-AE', { minimumFractionDigits: 2 })}</td>
                          <td className="px-3 py-2 text-xs text-gray-400">{a.law_reference}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {ctReturn.adjustments.some((a) => a.type === 'exempt_deduction') && (
                <div>
                  <h3 className="text-xs font-bold text-blue-400 uppercase mb-2">Exempt income deductions</h3>
                  <table className="w-full text-sm border border-gray-700/50 rounded-lg overflow-hidden">
                    <thead className="bg-gray-900/80 text-gray-400 text-xs uppercase">
                      <tr>
                        <th className="text-left px-3 py-2">Account</th>
                        <th className="text-right px-3 py-2">Amount</th>
                        <th className="text-left px-3 py-2">Law</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700/50">
                      {ctReturn.adjustments.filter((a) => a.type === 'exempt_deduction').map((a) => (
                        <tr key={`${a.account_code}-ex`}>
                          <td className="px-3 py-2"><span className="font-mono text-teal-400">{a.account_code}</span> {a.account_name}</td>
                          <td className="px-3 py-2 text-right font-mono text-blue-300">{a.add_back_amount.toLocaleString('en-AE', { minimumFractionDigits: 2 })}</td>
                          <td className="px-3 py-2 text-xs text-gray-400">{a.law_reference}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {ctReturn.breakdown?.computation?.breakdown && (
            <table className="w-full text-sm mt-4 border border-gray-700/50 rounded-lg overflow-hidden">
              <thead className="bg-gray-900/80 text-gray-400 text-xs uppercase">
                <tr><th className="text-left px-3 py-2">Rate breakdown</th><th className="text-right px-3 py-2">AED</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {ctReturn.breakdown.computation.breakdown.map((row) => (
                  <tr key={row.label}>
                    <td className="px-3 py-2 text-gray-300">{row.label}{row.note ? ` — ${row.note}` : ''}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.amount_aed.toLocaleString('en-AE', { minimumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {ctHistory.length > 0 && (
        <section className="bg-gray-800/40 border border-gray-700 rounded-xl p-5 mb-6">
          <h2 className="text-sm font-bold text-gray-400 uppercase mb-3 flex items-center gap-2">
            <History size={14} /> CT Returns History
          </h2>
          <table className="w-full text-sm">
            <thead className="text-gray-500 text-xs">
              <tr>
                <th className="text-left py-2">Period</th>
                <th className="text-right py-2">CT payable</th>
                <th className="text-center py-2">Status</th>
                <th className="text-right py-2">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {ctHistory.map((h) => (
                <tr key={h.id} className="cursor-pointer hover:bg-gray-700/30" onClick={() => setCtReturn(h)}>
                  <td className="py-2">{h.period_start} → {h.period_end}</td>
                  <td className="py-2 text-right font-mono">{fmt(h.ct_payable_aed)}</td>
                  <td className="py-2 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      h.status === 'filed' ? 'bg-green-900/50 text-green-300' :
                      h.status === 'approved' ? 'bg-teal-900/50 text-teal-300' : 'bg-gray-700 text-gray-300'
                    }`}>{h.status}</span>
                  </td>
                  <td className="py-2 text-right text-gray-500 text-xs">
                    {h.created_at ? new Date(h.created_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {!data && !loading && ctReturn && (
        <div className="text-center text-gray-500 text-sm mb-4">Generate Report above for the full FTA Q&A form</div>
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

      {/* File override modal (soft gate) */}
      {showFileOverride && ctReturn && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-amber-500/30 rounded-xl p-6 max-w-md w-full space-y-3">
            <h3 className="text-lg font-semibold text-white">File without approval?</h3>
            <p className="text-sm text-gray-400">
              This return is still in draft. Approve first, or enter a reason to file with override (logged for audit).
            </p>
            <textarea
              value={fileOverrideReason}
              onChange={(e) => setFileOverrideReason(e.target.value)}
              rows={4}
              placeholder="e.g. CFO approved expedited filing"
              className="w-full bg-gray-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            />
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => void handleFileCt(fileOverrideReason.trim())}
                disabled={fileOverrideReason.trim().length < 3}
                className="flex-1 py-2 rounded-lg bg-amber-500 text-gray-900 font-semibold text-sm disabled:opacity-50"
              >
                Confirm override &amp; file
              </button>
              <button type="button" onClick={() => setShowFileOverride(false)}
                className="flex-1 py-2 rounded-lg border border-white/10 text-sm text-gray-300">
                Cancel
              </button>
            </div>
          </div>
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
