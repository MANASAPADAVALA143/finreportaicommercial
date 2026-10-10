import type React from 'react';
import { useEffect, useState } from 'react';
import { FileText, Loader2, Maximize2, Paperclip, ZoomIn, ZoomOut } from 'lucide-react';
import type { Invoice } from '@/lib/ap-invoice/supabase';
import { resolveInvoiceFileUrl } from '@/lib/ap-invoice/invoiceStorageService';
import { COLORS, type Tone, TONE_HEX } from '@/pages/ap-invoices/dashboard/ui';

export const INVOICE_STATUS_TONE: Record<string, Tone> = {
  Processing: 'amber',
  Approved: 'primary',
  Paid: 'teal',
  'On Hold': 'gold',
  Queried: 'purple',
  Rejected: 'red',
};

export const INVOICE_STATUS_LABEL: Record<string, string> = {
  Processing: 'Pending approval',
};

export const MATCH_LABEL: Record<string, string> = {
  three_way_matched: '3-Way Matched',
  matched: 'PO Matched',
  partial: 'Partial match',
  mismatch: 'Variance',
  no_po: 'No PO',
};

export const MATCH_TONE: Record<string, Tone> = {
  three_way_matched: 'teal',
  matched: 'teal',
  partial: 'amber',
  mismatch: 'amber',
  no_po: 'slate',
};

/** `null` score and no level means the invoice was never scored — shown neutral, never as Low. */
export function riskTone(score: number | null, level: string | null | undefined): Tone {
  const l = String(level ?? '').toLowerCase();
  if ((score ?? -1) >= 60 || l === 'high' || l === 'critical') return 'red';
  if ((score ?? -1) >= 30 || l === 'medium') return 'amber';
  if (score == null && !l) return 'slate';
  return 'teal';
}

export function riskLabel(inv: Pick<Invoice, 'risk_level' | 'risk_score'>): string {
  if (inv.risk_level) return inv.risk_level;
  const raw = inv.risk_score as unknown;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw >= 60 ? 'High' : raw >= 30 ? 'Medium' : 'Low';
  }
  const s = String(raw ?? '').toLowerCase();
  if (s === 'critical' || s === 'high') return 'High';
  if (s === 'medium') return 'Medium';
  if (s === 'low') return 'Low';
  return 'Not scored';
}

/** Viewable URL for a stored file reference; intake placeholders (e.g. "email-…") resolve to null. */
export function useStoredFileUrl(ref: string | null | undefined): { url: string | null; loading: boolean } {
  const [state, setState] = useState<{ url: string | null; loading: boolean }>({ url: null, loading: !!ref });
  useEffect(() => {
    if (!ref) {
      setState({ url: null, loading: false });
      return;
    }
    let cancelled = false;
    setState({ url: null, loading: true });
    resolveInvoiceFileUrl(ref)
      .catch(() => null)
      .then((url) => {
        if (!cancelled) setState({ url, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [ref]);
  return state;
}

export function DetailCard({
  title,
  icon,
  action,
  children,
  className = '',
  bodyClassName = 'p-4',
  id,
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`rounded-xl border border-[#E3E8EF] bg-white shadow-sm ${className}`}>
      <header className="flex items-center justify-between gap-2 border-b border-[#EEF2F7] px-4 py-3">
        <h3 className="flex min-w-0 items-center gap-2 text-[14px] font-semibold text-slate-900">
          {icon}
          <span className="truncate">{title}</span>
        </h3>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(110px,40%)_1fr] items-start gap-3 py-1.5 text-[13px]">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-slate-900">{children}</dd>
    </div>
  );
}

export function SummaryTile({
  icon,
  label,
  value,
  sub,
  tone = 'primary',
  highlight = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
  highlight?: boolean;
}) {
  const hex = TONE_HEX[tone];
  return (
    <div
      className="flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5"
      style={{
        borderColor: highlight ? `${hex}55` : COLORS.border,
        background: highlight ? `${hex}0F` : '#FFFFFF',
      }}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ background: `${hex}1A`, color: hex }}
        aria-hidden
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold leading-tight text-slate-900">{value}</p>
        <p className="truncate text-[11px] text-slate-500">{label}</p>
        {sub ? <p className="truncate text-[11px] text-slate-500">{sub}</p> : null}
      </div>
    </div>
  );
}

/** Circular progress ring for 0–100 values. */
export function Ring({
  value,
  size = 112,
  stroke = 10,
  color,
  children,
  label,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color: string;
  children?: React.ReactNode;
  label: string;
}) {
  const v = Math.min(100, Math.max(0, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={COLORS.grid} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(v / 100) * c} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

export function DocumentPreview({
  url,
  loading = false,
  fileType,
  fileRef,
  zoom,
  onZoom,
  onAttach,
  attaching = false,
  compact = false,
}: {
  url: string | null;
  loading?: boolean;
  fileType: string | null;
  fileRef: string | null;
  zoom: number;
  onZoom: (next: number) => void;
  /** Shown in the empty state so a document can be added to invoices imported without one. */
  onAttach?: () => void;
  attaching?: boolean;
  compact?: boolean;
}) {
  const isImage =
    !!url && (/^image\//i.test(fileType ?? '') || /\.(png|jpe?g|gif|webp|bmp)(\?|$)/i.test(url));
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-[#EEF2F7] bg-slate-50 px-3 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded-md p-1.5 text-slate-600 hover:bg-white disabled:opacity-40"
            onClick={() => onZoom(Math.max(50, zoom - 25))}
            disabled={!url || zoom <= 50}
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="min-w-[3rem] text-center text-xs tabular-nums text-slate-600">{zoom}%</span>
          <button
            type="button"
            className="rounded-md p-1.5 text-slate-600 hover:bg-white disabled:opacity-40"
            onClick={() => onZoom(Math.min(200, zoom + 25))}
            disabled={!url || zoom >= 200}
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[#246BFD] hover:bg-white"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Open
          </a>
        ) : null}
      </div>
      <div className={`${compact ? 'min-h-[220px]' : 'min-h-[420px]'} flex-1 overflow-auto bg-slate-100 p-3`}>
        {url ? (
          isImage ? (
            <img
              src={url}
              alt="Invoice document"
              className="mx-auto rounded-md bg-white shadow"
              style={{ width: `${zoom}%`, maxWidth: 'none' }}
            />
          ) : (
            <div style={{ width: `${zoom}%`, minWidth: '100%' }} className="h-full">
              <iframe
                src={url}
                title="Invoice document"
                className={`${compact ? 'h-[480px]' : 'h-[620px]'} w-full rounded-md border-0 bg-white shadow`}
              />
            </div>
          )
        ) : loading ? (
          <div className={`flex h-full ${compact ? 'min-h-[200px]' : 'min-h-[400px]'} flex-col items-center justify-center text-center`}>
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            <p className="mt-3 text-sm text-slate-500">Loading document…</p>
          </div>
        ) : (
          <div className={`flex h-full ${compact ? 'min-h-[200px]' : 'min-h-[400px]'} flex-col items-center justify-center text-center`}>
            <FileText className={`${compact ? 'h-9 w-9' : 'h-12 w-12'} text-slate-300`} />
            <p className="mt-3 text-sm font-medium text-slate-600">No document attached</p>
            <p className="mt-1 max-w-[260px] text-xs text-slate-500">
              {fileRef
                ? 'The original file was not stored when this invoice was captured.'
                : 'No original file was uploaded with this invoice.'}
            </p>
            {onAttach && (
              <button
                type="button"
                onClick={onAttach}
                disabled={attaching}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[#1765F5] bg-white px-3 py-1.5 text-xs font-semibold text-[#1765F5] hover:bg-[#EEF4FF] disabled:opacity-50"
              >
                {attaching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                {attaching ? 'Attaching…' : 'Attach document'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
