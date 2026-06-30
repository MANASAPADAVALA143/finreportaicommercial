import { Link } from 'react-router-dom';
import { Clock } from 'lucide-react';

const COPY: Record<number, { title: string; subtitle: string }> = {
  15: {
    title: 'IFRS 15 Revenue Recognition',
    subtitle: 'Contract portfolio, performance obligations, and rev-rec reconciliation — coming soon.',
  },
  9: {
    title: 'IFRS 9 Financial Instruments',
    subtitle: 'Expected credit loss staging, ECL calculator, and impairment — coming soon.',
  },
};

export default function IFRSComingSoon({ standard }: { standard: 15 | 9 }) {
  const { title, subtitle } = COPY[standard];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-900/30 border border-amber-700/40">
          <Clock className="w-8 h-8 text-amber-400" />
        </div>
        <div>
          <p className="text-xs text-teal-400 uppercase tracking-widest mb-2">IFRS Suite</p>
          <h1 className="text-2xl font-bold text-white">{title}</h1>
          <p className="text-gray-400 text-sm mt-3 leading-relaxed">{subtitle}</p>
        </div>
        <span className="inline-block px-4 py-1.5 rounded-full text-sm font-medium bg-amber-900/40 text-amber-300 border border-amber-700/50">
          Coming Soon
        </span>
        <div className="pt-2 flex flex-col gap-2 text-sm">
          <Link to="/ifrs/16" className="text-teal-400 hover:text-teal-300">
            ← IFRS 16 Lease Accounting (available now)
          </Link>
          <Link to="/" className="text-gray-500 hover:text-gray-400">
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
