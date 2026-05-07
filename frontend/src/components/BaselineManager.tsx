type BaselineStatus = {
  company_id: string;
  has_baseline: boolean;
  months_loaded: number;
  total_entries: number;
  accounts_covered: number;
  quality: 'strong' | 'building' | 'weak' | 'none';
  month_breakdown?: { month: string; entries: number }[];
};

type Props = {
  companyId: string;
  status: BaselineStatus | null;
  onCompanyChange: (v: string) => void;
  onUploadClick: () => void;
  onResetClick: () => void;
  loading?: boolean;
};

const qualityColor: Record<string, string> = {
  strong: 'text-emerald-300 bg-emerald-500/20 border-emerald-400/40',
  building: 'text-amber-300 bg-amber-500/20 border-amber-400/40',
  weak: 'text-orange-300 bg-orange-500/20 border-orange-400/40',
  none: 'text-blue-300 bg-blue-500/20 border-blue-400/40',
};

export default function BaselineManager({ companyId, status, onCompanyChange, onUploadClick, onResetClick, loading }: Props) {
  return (
    <div className="rounded-xl border border-[#1e293b] bg-[#141B2D] p-5">
      <h2 className="mb-4 text-lg font-semibold text-white">🏛️ Historical Baseline Manager</h2>
      <label className="mb-1 block text-xs text-slate-400">Company</label>
      <input
        value={companyId}
        onChange={(e) => onCompanyChange(e.target.value)}
        className="mb-4 w-full rounded-lg border border-slate-600 bg-[#0A0F1E] px-3 py-2 text-sm text-slate-100"
      />

      {status && (
        <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${qualityColor[status.quality] || qualityColor.none}`}>
          <strong>{status.quality.toUpperCase()}</strong> — {status.months_loaded} months | {status.total_entries.toLocaleString()} entries | {status.accounts_covered} accounts
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <button onClick={onUploadClick} className="rounded-lg bg-[#F5A623] px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400">
          Upload Monthly Data
        </button>
        <button onClick={onResetClick} className="rounded-lg border border-red-500/50 px-4 py-2 text-sm text-red-300 hover:bg-red-500/10">
          Reset Baseline
        </button>
        {loading && <span className="self-center text-xs text-slate-400">Refreshing baseline...</span>}
      </div>

      {!!status?.month_breakdown?.length && (
        <div className="text-xs text-slate-400">
          <p className="mb-1 font-semibold">Month breakdown:</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {status.month_breakdown?.map((m) => (
              <span key={m.month} className="text-slate-300">
                {m.month}: {m.entries}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
