import React from 'react';
import { Link } from 'react-router-dom';

/** Mirrors R2R hub (`/r2r`) top link row — adds Rev Rec without modifying `R2RModule.tsx`. */
export function R2RServiceNav({ current }: { current: 'hub' | 'pattern' | 'rev-rec' }) {
  const linkBase =
    'flex items-center gap-1.5 px-3 py-2 rounded-lg transition text-sm font-medium border border-transparent';
  const idle = 'bg-slate-100 hover:bg-slate-200 text-gray-800';
  const activePattern = 'bg-blue-600 text-white shadow-sm border-blue-700';
  const activeRev = 'text-white shadow-sm border-[#0c2347]';
  const activeRevStyle = { backgroundColor: '#0F2D5E' } as const;

  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      <span className="text-sm font-medium text-gray-500 mr-1 hidden sm:inline">R2R:</span>
      <Link to="/close-tracker" className={`${linkBase} ${idle}`}>
        Close Tracker
      </Link>
      <Link to="/tb-variance" className={`${linkBase} ${idle}`}>
        TB Variance
      </Link>
      <Link to="/bank-recon" className={`${linkBase} ${idle}`}>
        Bank Recon
      </Link>
      <Link
        to="/r2r"
        className={`${linkBase} ${current === 'hub' ? activePattern : idle}`}
      >
        R2R hub
      </Link>
      <Link
        to="/r2r-pattern"
        className={`${linkBase} ${current === 'pattern' ? activePattern : idle}`}
      >
        R2R Pattern Engine
      </Link>
      <Link
        to="/r2r/rev-rec"
        className={`${linkBase} ${current === 'rev-rec' ? activeRev : idle}`}
        style={current === 'rev-rec' ? activeRevStyle : undefined}
      >
        Rev Rec Reconciliation
      </Link>
    </div>
  );
}
