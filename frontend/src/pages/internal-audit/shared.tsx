import type React from 'react';
import { X } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';

export const inputCls =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export const RISK_BADGE: Record<string, string> = {
  Critical: 'bg-red-100 text-red-700 border border-red-200',
  High: 'bg-orange-100 text-orange-700 border border-orange-200',
  Medium: 'bg-amber-100 text-amber-700 border border-amber-200',
  Low: 'bg-green-100 text-green-700 border border-green-200',
};

export const FINDING_STATUS_BADGE: Record<string, string> = {
  Open: 'bg-red-50 text-red-600',
  'In Progress': 'bg-blue-50 text-blue-600',
  Overdue: 'bg-red-100 text-red-700 font-semibold',
  Implemented: 'bg-green-50 text-green-600',
  Verified: 'bg-emerald-50 text-emerald-700',
};

export const ENGAGEMENT_STATUS_BADGE: Record<string, string> = {
  Planning: 'bg-slate-100 text-slate-700',
  Fieldwork: 'bg-blue-50 text-blue-700',
  Reporting: 'bg-amber-50 text-amber-700',
  Closed: 'bg-green-50 text-green-700',
};

/** Active company id; InternalAuditLayout only renders pages once one is selected. */
export function useAuditCompanyId(): string {
  return useCompany().activeCompanyId ?? '';
}

export function Badge({ value, styles }: { value: string | null | undefined; styles: Record<string, string> }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${styles[value] || 'bg-muted text-muted-foreground'}`}>
      {value}
    </span>
  );
}

export function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'md:col-span-2' : undefined}>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto">{children}</div>
        <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-3">{message}</div>;
}

export function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
