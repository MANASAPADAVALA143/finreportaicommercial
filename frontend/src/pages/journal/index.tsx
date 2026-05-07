import { useState } from 'react';
import R2RPatternAnalysisPage from '../R2RPatternAnalysisPage';
import HistoricalTab from './HistoricalTab';

export default function JournalPageWithHistoricalTabs() {
  const [tab, setTab] = useState<'quick' | 'historical'>('quick');

  return (
    <div className="min-h-screen bg-[#0A0F1E]">
      <div className="mx-auto max-w-7xl px-4 pt-4">
        <div className="mb-4 flex gap-2 border-b border-[#1e293b]">
          <button
            onClick={() => setTab('quick')}
            className={`rounded-t-lg px-4 py-2 text-sm font-semibold ${
              tab === 'quick' ? 'bg-[#141B2D] text-[#F5A623]' : 'text-slate-300 hover:text-[#F5A623]'
            }`}
          >
            Quick Analysis
          </button>
          <button
            onClick={() => setTab('historical')}
            className={`rounded-t-lg px-4 py-2 text-sm font-semibold ${
              tab === 'historical' ? 'bg-[#141B2D] text-[#F5A623]' : 'text-slate-300 hover:text-[#F5A623]'
            }`}
          >
            Historical Intelligence
          </button>
        </div>
      </div>
      {tab === 'quick' ? <R2RPatternAnalysisPage /> : <div className="mx-auto max-w-7xl px-4 pb-8"><HistoricalTab /></div>}
    </div>
  );
}
