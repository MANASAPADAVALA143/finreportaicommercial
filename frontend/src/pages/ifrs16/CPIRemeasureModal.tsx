import { useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { remeasureLease, type LeaseRecord } from '../../services/ifrs16.service';

interface Props {
  lease: LeaseRecord;
  companyId: string;
  onClose: () => void;
  onDone: () => void;
}

export function CPIRemeasureModal({ lease, companyId, onClose, onDone }: Props) {
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [annualPay, setAnnualPay] = useState((lease.lease_payments_aed ?? 0) * 12);
  const [cpiRate, setCpiRate] = useState(3);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleRecalculate() {
    setLoading(true);
    try {
      const res = await remeasureLease({
        lease_id: lease.id,
        remeasurement_date: date,
        new_cpi_rate: cpiRate,
        new_annual_payment_aed: annualPay,
      }, companyId);
      setResult(res);
      toast.success('Remeasurement calculated — JE posted');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Remeasurement failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-bold text-lg">CPI Remeasurement — {lease.lease_name}</h2>
        <label className="block text-sm">
          <span className="text-gray-400 text-xs">Remeasurement date</span>
          <input type="date" className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="text-gray-400 text-xs">New annual payment (AED)</span>
          <input type="number" className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" value={annualPay} onChange={(e) => setAnnualPay(Number(e.target.value))} />
        </label>
        <label className="block text-sm">
          <span className="text-gray-400 text-xs">CPI rate change (%)</span>
          <input type="number" step="0.1" className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" value={cpiRate} onChange={(e) => setCpiRate(Number(e.target.value))} />
        </label>

        {result && (
          <div className="bg-gray-800/60 rounded-lg p-3 text-sm space-y-1">
            <p>Old liability: AED {Number(result.old_liability).toLocaleString()}</p>
            <p>New liability: AED {Number(result.new_liability).toLocaleString()}</p>
            <p className={Number(result.difference) >= 0 ? 'text-amber-400' : 'text-teal-400'}>
              Difference: AED {Number(result.difference).toLocaleString()}
            </p>
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="text-sm text-gray-400 px-4 py-2">Cancel</button>
          <button
            disabled={loading}
            onClick={() => void handleRecalculate()}
            className="bg-amber-700 hover:bg-amber-600 px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {loading ? 'Processing…' : 'Recalculate & Post JE'}
          </button>
        </div>
      </div>
    </div>
  );
}
