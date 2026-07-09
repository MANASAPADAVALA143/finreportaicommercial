/**
 * UAE Suite — module picker shown when switching to the UAE suite.
 * AP + GulfTax share one highlighted card; every other module has its own card.
 */
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Building2,
  CheckCircle2,
  FileText,
  Landmark,
  Receipt,
  Shield,
  Tags,
  TrendingUp,
} from 'lucide-react';

type ModuleCard = {
  label: string;
  path: string;
  icon: typeof BookOpen;
  desc: string;
  color: string;
  bg: string;
  border: string;
  featured?: boolean;
};

const MODULES: ModuleCard[] = [
  {
    label: 'UAE Taxation (AP + GulfTax)',
    path: '/uae-suite',
    icon: Shield,
    desc: 'Combined AP, VAT/CT compliance, and Peppol e-invoicing — unified operations dashboard',
    color: 'text-indigo-300',
    bg: 'bg-indigo-900/30',
    border: 'border-indigo-500/50',
    featured: true,
  },
  {
    label: 'AR',
    path: '/uae-full/ar',
    icon: Receipt,
    desc: 'Invoices, aging, dunning, recurring billing & customer risk',
    color: 'text-teal-400',
    bg: 'bg-teal-900/20',
    border: 'border-teal-800/40',
  },
  {
    label: 'Chart of Accounts',
    path: '/uae-full/coa',
    icon: BookOpen,
    desc: 'View & manage the UAE chart of accounts',
    color: 'text-blue-400',
    bg: 'bg-blue-900/20',
    border: 'border-blue-800/40',
  },
  {
    label: 'Journal Entries',
    path: '/uae-full/journals',
    icon: FileText,
    desc: 'GL drill-down and double-entry ledger',
    color: 'text-emerald-400',
    bg: 'bg-emerald-900/20',
    border: 'border-emerald-800/40',
  },
  {
    label: 'Classify Accounts',
    path: '/uae-full/classify-accounts',
    icon: Tags,
    desc: 'AI BS/PL, cash flow & CIT classification',
    color: 'text-violet-400',
    bg: 'bg-violet-900/20',
    border: 'border-violet-800/40',
  },
  {
    label: 'Sales Invoices',
    path: '/uae-full/invoices',
    icon: FileText,
    desc: 'UAE VAT-compliant sales invoices',
    color: 'text-cyan-400',
    bg: 'bg-cyan-900/20',
    border: 'border-cyan-800/40',
  },
  {
    label: 'Bank Recon',
    path: '/uae-full/bank-recon',
    icon: Landmark,
    desc: 'AI-assisted 3-step bank matching',
    color: 'text-sky-400',
    bg: 'bg-sky-900/20',
    border: 'border-sky-800/40',
  },
  {
    label: 'Fixed Assets',
    path: '/uae-full/fixed-assets',
    icon: Building2,
    desc: 'IFRS depreciation + CT Ministerial Decision 134',
    color: 'text-amber-400',
    bg: 'bg-amber-900/20',
    border: 'border-amber-800/40',
  },
  {
    label: 'Accruals',
    path: '/uae-full/accruals',
    icon: AlertCircle,
    desc: 'AI accrual suggestions & EOSB provisions',
    color: 'text-orange-400',
    bg: 'bg-orange-900/20',
    border: 'border-orange-800/40',
  },
  {
    label: 'Period-End Close',
    path: '/uae-full/period-close',
    icon: CheckCircle2,
    desc: '13-item checklist and period lock',
    color: 'text-rose-400',
    bg: 'bg-rose-900/20',
    border: 'border-rose-800/40',
  },
  {
    label: 'Management Accounts (CFO)',
    path: '/uae-full/management',
    icon: TrendingUp,
    desc: 'AI-generated CFO narrative pack',
    color: 'text-purple-400',
    bg: 'bg-purple-900/20',
    border: 'border-purple-800/40',
  },
];

export default function UAESuiteSelector() {
  const navigate = useNavigate();
  const [featured, ...rest] = MODULES;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="bg-teal-900/20 border-b border-teal-800/30 px-6 py-3 flex items-center gap-3">
        <span className="text-lg">🇦🇪</span>
        <div>
          <span className="text-white font-medium text-sm">UAE Finance Suite</span>
          <span className="text-teal-400 text-xs ml-3">VAT 5% · Corporate Tax 9% · IFRS · EOSB</span>
        </div>
      </div>

      <div className="p-6 max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Choose a module</h1>
          <p className="text-gray-400 text-sm mt-1">
            Select AP &amp; tax operations or open a specific accounting module.
          </p>
        </div>

        {/* Featured combined card */}
        <button
          type="button"
          onClick={() => navigate(featured.path)}
          className={`w-full text-left ${featured.bg} border-2 ${featured.border} rounded-xl p-6 mb-8 hover:opacity-90 transition-opacity group`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-lg bg-indigo-950/60 border border-indigo-500/30">
                <featured.icon size={28} className={featured.color} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-indigo-300 mb-1">
                  Recommended
                </p>
                <h2 className="text-xl font-bold text-white">{featured.label}</h2>
                <p className="text-sm text-gray-400 mt-1 max-w-2xl">{featured.desc}</p>
              </div>
            </div>
            <span className="flex items-center gap-1 text-sm text-indigo-300 group-hover:gap-2 transition-all shrink-0">
              Open dashboard <ArrowRight size={16} />
            </span>
          </div>
        </button>

        {/* Module grid */}
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Accounting modules
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {rest.map((m) => (
            <button
              key={m.label}
              type="button"
              onClick={() => navigate(m.path)}
              className={`${m.bg} border ${m.border} rounded-xl p-4 text-left hover:opacity-80 transition-opacity`}
            >
              <m.icon size={20} className={`${m.color} mb-3`} />
              <p className="text-sm font-medium text-white">{m.label}</p>
              <p className="text-xs text-gray-500 mt-1 leading-snug">{m.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
