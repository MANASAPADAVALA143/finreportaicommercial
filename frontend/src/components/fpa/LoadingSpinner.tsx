import { Loader2 } from 'lucide-react';

export function LoadingSpinner({ label = 'Running analysis…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-600 bg-slate-800/80 px-4 py-3 text-slate-100">
      <Loader2 className="h-5 w-5 animate-spin text-sky-400" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}
