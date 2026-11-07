import { Link } from 'react-router-dom';
import { Info } from 'lucide-react';

/** Marks screens whose figures are illustrative rather than read from the company's ledger. */
export function DemoDataBanner({ what = 'The figures on this page' }: { what?: string }) {
  return (
    <div
      role="note"
      className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p>
        <span className="font-semibold">Demo data.</span> {what} are illustrative samples, not your company&apos;s
        books. For analysis of your posted ledger, use the{' '}
        <Link to="/ai-cfo" className="font-medium underline underline-offset-2">AI CFO Command Centre</Link>.
      </p>
    </div>
  );
}
