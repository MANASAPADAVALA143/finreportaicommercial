import { Check } from 'lucide-react';
import type { PipelineStage, PipelineStageKey } from '../dashboard/metrics';
import type { StageFilter } from './listModel';

const SHORT_LABEL: Record<PipelineStageKey, string> = {
  uploaded: 'Uploaded',
  extracted: 'AI Extracted',
  classified: 'IFRS Classify',
  matched: '3-Way Match',
  risk: 'Risk Score',
  approved: 'Approval',
  gl: 'GL Coded',
  paid: 'Paid',
};

function stageTitle(s: PipelineStage): string {
  const parts = [`${s.label}: ${s.done} of ${s.applicable} done`];
  if (s.pending) parts.push(`${s.pending} ${s.pendingLabel || 'pending'}`);
  if (s.issue) parts.push(`${s.issue} ${s.issueLabel || 'need attention'}`);
  if (s.na) parts.push(`${s.na} ${s.naLabel || 'not applicable'}`);
  return `${parts.join(' · ')}\n${s.definition}`;
}

/**
 * Compact eight-step stepper. Counts are invoices that completed each step in the
 * current list view; steps are independent checks, so a later step can exceed an earlier one.
 */
export function ListPipeline({
  stages,
  selected,
  onSelect,
}: {
  stages: PipelineStage[];
  selected: StageFilter;
  onSelect: (stage: PipelineStage) => void;
}) {
  return (
    <section
      aria-label="Processing pipeline"
      className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <ol className="flex items-start overflow-x-auto">
        {stages.map((s, i) => {
          const open = s.pending + s.issue;
          const isSelected = selected?.stage === s.key;
          const complete = s.applicable > 0 && open === 0;
          const warn = !complete && s.issue > 0;
          const circle = isSelected
            ? 'border-[#1765F5] bg-[#1765F5] text-white'
            : complete
              ? 'border-[#00A884] bg-[#00A884]/10 text-[#047857]'
              : warn
                ? 'border-[#F59E0B] bg-[#FFFBEB] text-[#B45309]'
                : 'border-[#CBD5E1] bg-white text-[#64748B]';
          const next = stages[i + 1];
          const lineDone = complete && next && next.applicable > 0 && next.pending + next.issue === 0;
          return (
            <li key={s.key} className={`flex items-start ${i < stages.length - 1 ? 'flex-1' : ''}`}>
              <button
                type="button"
                onClick={() => onSelect(s)}
                aria-pressed={isSelected}
                title={stageTitle(s)}
                className="group flex w-[5.25rem] shrink-0 flex-col items-center rounded-lg px-1 py-0.5 hover:bg-[#F3F6FB] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1765F5]/40"
              >
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-[11px] font-bold transition-colors group-hover:border-[#1765F5] ${circle}`}
                >
                  {complete && !isSelected ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span
                  className={`mt-1 w-full truncate text-center text-[11px] leading-tight ${
                    isSelected ? 'font-semibold text-[#1765F5]' : 'text-[#64748B]'
                  }`}
                >
                  {SHORT_LABEL[s.key]}
                </span>
                <span
                  className={`text-[13px] font-semibold tabular-nums leading-tight ${
                    isSelected ? 'text-[#1765F5]' : 'text-[#152238]'
                  }`}
                >
                  {s.applicable ? s.done.toLocaleString() : 'n/a'}
                </span>
                {open > 0 && (
                  <span className={`text-[10px] leading-tight tabular-nums ${warn ? 'text-[#B45309]' : 'text-[#94A3B8]'}`}>
                    {open.toLocaleString()} open
                  </span>
                )}
              </button>
              {i < stages.length - 1 && (
                <span
                  aria-hidden
                  className={`mt-[16px] h-px min-w-[8px] flex-1 ${lineDone ? 'bg-[#00A884]' : 'bg-[#E2E8F0]'}`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
