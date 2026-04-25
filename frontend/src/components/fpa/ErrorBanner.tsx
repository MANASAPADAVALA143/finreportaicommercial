import { AlertCircle } from 'lucide-react';

export function ErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-100"
      role="alert"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
      <div className="whitespace-pre-wrap">{message}</div>
    </div>
  );
}
