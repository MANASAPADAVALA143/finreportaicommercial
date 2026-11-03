import { BookOpen, Building2, FileSearch, FileText, MessageSquare, TrendingUp, type LucideIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

export const TA_ROOT = '/technical-accounting';
export const TA_OVERVIEW = `${TA_ROOT}/overview`;

export type TaModuleStatus = 'In Development' | 'Coming Soon';

export type TaModule = {
  key: string;
  label: string;
  path: string;
  icon: LucideIcon;
  description: string;
  /** Omitted once a module is live. */
  status?: TaModuleStatus;
  /** Modules elsewhere in FinReportAI that already cover part of this area. */
  related?: { label: string; path: string }[];
};

export const TA_MODULES: TaModule[] = [
  {
    key: 'assistant',
    label: 'AI Assistant',
    path: `${TA_ROOT}/assistant`,
    icon: MessageSquare,
    description: 'Ask accounting questions. Get cited answers from IFRS, Ind AS and US GAAP.',
    status: 'In Development',
  },
  {
    key: 'ifrs',
    label: 'IFRS / Ind AS',
    path: `${TA_ROOT}/ifrs`,
    icon: BookOpen,
    description: 'Browse standards, interpretations and implementation guidance.',
    status: 'Coming Soon',
  },
  {
    key: 'revenue',
    label: 'Revenue Recognition',
    path: `${TA_ROOT}/revenue`,
    icon: TrendingUp,
    description: 'IFRS 15 / ASC 606 analysis, five-step model, contract reviews.',
    status: 'Coming Soon',
    related: [
      { label: 'IFRS 15 Rev Rec Recon', path: '/r2r/rev-rec' },
      { label: 'IFRS 15 Contract Portfolio', path: '/r2r/rev-rec/contracts' },
    ],
  },
  {
    key: 'leases',
    label: 'Lease Accounting',
    path: `${TA_ROOT}/leases`,
    icon: Building2,
    description: 'IFRS 16 / ASC 842 schedules, ROU asset calculations, disclosures.',
    status: 'Coming Soon',
    related: [
      { label: 'IFRS 16 Lease Register', path: '/ifrs/16' },
      { label: 'IFRS 16 Audit Report', path: '/ifrs/16/audit' },
    ],
  },
  {
    key: 'disclosures',
    label: 'Disclosure Intelligence',
    path: `${TA_ROOT}/disclosures`,
    icon: FileSearch,
    description: 'Check financial statement disclosures against applicable standards.',
    status: 'Coming Soon',
    related: [{ label: 'IFRS Statement Generator', path: '/ifrs-statement' }],
  },
  {
    key: 'memos',
    label: 'Accounting Memos',
    path: `${TA_ROOT}/memos`,
    icon: FileText,
    description: 'Generate technical accounting position papers and memos.',
  },
];

export const TA_STATUS_BADGE: Record<TaModuleStatus, string> = {
  'In Development': 'bg-blue-50 text-blue-700 border border-blue-200',
  'Coming Soon': 'bg-amber-50 text-amber-700 border border-amber-200',
};

export function ModulePlaceholder({ moduleKey }: { moduleKey: string }) {
  const navigate = useNavigate();
  const mod = TA_MODULES.find((m) => m.key === moduleKey);
  if (!mod) return null;
  const Icon = mod.icon;

  return (
    <div className="rounded-xl border-2 border-dashed border-border py-16 px-6 text-center flex flex-col items-center gap-3">
      <Icon className="h-12 w-12 text-muted-foreground/40" aria-hidden />
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-semibold text-foreground">{mod.label}</h2>
        {mod.status && (
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${TA_STATUS_BADGE[mod.status]}`}>{mod.status}</span>
        )}
      </div>
      <p className="max-w-lg text-sm text-foreground">{mod.description}</p>
      <p className="text-sm text-muted-foreground">This module is under development. Check back soon.</p>
      {mod.related && (
        <p className="text-sm text-muted-foreground">
          Available in FinReportAI today:{' '}
          {mod.related.map((r, i) => (
            <span key={r.path}>
              {i > 0 && ' · '}
              <Link to={r.path} className="text-blue-600 hover:underline">{r.label}</Link>
            </span>
          ))}
        </p>
      )}
      <button
        onClick={() => navigate(TA_ROOT)}
        className="mt-2 px-4 py-2 text-sm text-muted-foreground border border-border rounded-md hover:bg-muted transition-colors"
      >
        Back to Overview
      </button>
    </div>
  );
}
