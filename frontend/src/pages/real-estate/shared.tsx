import { useEffect, useState } from 'react';

export const NAVY = '#0A1628';
export const SURFACE = '#0F2035';
export const BORDER = '#1A2D45';
export const GOLD = '#FFD700';
export const TEAL = '#00D4AA';
export const MUTED = '#8899AA';

export const AED = (v: number | null | undefined) =>
  `AED ${(v ?? 0).toLocaleString('en-AE', { maximumFractionDigits: 0 })}`;

export const AED2 = (v: number | null | undefined) =>
  `AED ${(v ?? 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Fetch real data; on error or empty result, fall back to demo data silently.
 * Callers get back { data, loading, isDemo } — never an error state, per spec.
 */
export function useReraData<T>(
  fetcher: () => Promise<T>,
  demoData: T,
  isEmpty: (data: T) => boolean = () => false,
  deps: unknown[] = [],
): { data: T; loading: boolean; isDemo: boolean; reload: () => void } {
  const [data, setData] = useState<T>(demoData);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetcher()
      .then((result) => {
        if (cancelled) return;
        if (isEmpty(result)) {
          setData(demoData);
          setIsDemo(true);
        } else {
          setData(result);
          setIsDemo(false);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setData(demoData);
        setIsDemo(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  return { data, loading, isDemo, reload: () => setTick((t) => t + 1) };
}

export function DemoBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div
      className="fixed bottom-4 right-4 z-50 text-xs px-3 py-1.5 rounded-full border"
      style={{ background: SURFACE, borderColor: BORDER, color: MUTED }}
    >
      Demo data
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  active: 'border-[#00D4AA] text-[#00D4AA] bg-[#00D4AA1a]',
  completed: 'border-emerald-600 text-emerald-400 bg-emerald-900/20',
  on_hold: 'border-amber-600 text-amber-400 bg-amber-900/20',
  cancelled: 'border-red-600 text-red-400 bg-red-900/20',
  draft: 'border-gray-600 text-gray-400 bg-gray-800/40',
  filed: 'border-emerald-600 text-emerald-400 bg-emerald-900/20',
  received: 'border-[#00D4AA] text-[#00D4AA] bg-[#00D4AA1a]',
};

export function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status?.toLowerCase()] || 'border-gray-600 text-gray-400 bg-gray-800/40';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border capitalize ${cls}`}>
      {status?.replace(/_/g, ' ') || 'unknown'}
    </span>
  );
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'border-red-600 text-red-400 bg-red-900/20',
  high: 'border-red-600 text-red-400 bg-red-900/20',
  medium: 'border-amber-600 text-amber-400 bg-amber-900/20',
  low: 'border-yellow-600 text-yellow-400 bg-yellow-900/20',
};

export function SeverityBadge({ severity }: { severity: string }) {
  const cls = SEVERITY_COLORS[severity?.toLowerCase()] || 'border-gray-600 text-gray-400 bg-gray-800/40';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border capitalize ${cls}`}>
      {severity || 'unknown'}
    </span>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border p-5 ${className}`} style={{ background: SURFACE, borderColor: BORDER }}>
      {children}
    </div>
  );
}

export function KpiCard({ label, value, accent = false, sub }: { label: string; value: string; accent?: boolean; sub?: string }) {
  return (
    <Card>
      <p className="text-xs" style={{ color: MUTED }}>{label}</p>
      <p className="text-xl font-bold mt-1" style={{ color: accent ? GOLD : '#FFFFFF' }}>{value}</p>
      {sub && <p className="text-[11px] mt-1" style={{ color: MUTED }}>{sub}</p>}
    </Card>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        {subtitle && <p className="text-sm mt-1" style={{ color: MUTED }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function GoldButton({ onClick, children, disabled }: { onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
      style={{ background: GOLD, color: NAVY }}
    >
      {children}
    </button>
  );
}

export function OutlineButton({ onClick, children, disabled }: { onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-4 py-2 rounded-lg text-sm font-semibold border disabled:opacity-50"
      style={{ borderColor: GOLD, color: GOLD, background: 'transparent' }}
    >
      {children}
    </button>
  );
}

export function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border overflow-hidden overflow-x-auto" style={{ background: SURFACE, borderColor: BORDER }}>
      <table className="w-full text-sm min-w-[600px]">
        <thead>
          <tr className="border-b" style={{ borderColor: BORDER }}>
            {headers.map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold" style={{ color: MUTED }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center" style={{ color: MUTED }}>
        {text}
      </td>
    </tr>
  );
}
