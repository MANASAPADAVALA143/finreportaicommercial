import { Link } from 'react-router-dom';
import {
  BookOpen,
  ExternalLink,
  FileSpreadsheet,
  LineChart,
  Scale,
} from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';

const LINKS = [
  {
    title: 'IFRS Financial Statements',
    desc: 'Generate full IFRS statement pack with UAE FS validation and Excel export.',
    to: '/ifrs-statement',
    icon: FileSpreadsheet,
    tone: 'amber',
  },
  {
    title: 'UAE Management Accounts',
    desc: 'P&L, balance sheet and management reporting from the UAE ledger.',
    to: '/uae-full/management',
    icon: BookOpen,
    tone: 'teal',
  },
  {
    title: 'Journal entries & COA',
    desc: 'Drill into posted journals and chart of accounts feeding the statements.',
    to: '/uae-full/journals',
    icon: Scale,
    tone: 'blue',
  },
  {
    title: 'FpA Three-Statement Model',
    desc: 'Integrated income statement, balance sheet and cash flow forecast.',
    to: '/fpa/three-statement',
    icon: LineChart,
    tone: 'purple',
  },
] as const;

const TONE: Record<string, string> = {
  amber: 'border-amber-500/30 bg-amber-500/5 text-amber-300',
  teal: 'border-teal-500/30 bg-teal-500/5 text-teal-300',
  blue: 'border-blue-500/30 bg-blue-500/5 text-blue-300',
  purple: 'border-purple-500/30 bg-purple-500/5 text-purple-300',
};

export default function FinancialStatementsPage() {
  const { activeCompany } = useCompany();

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-amber-400" />
          Financial Statements
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Statement generation lives in IFRS / UAE Accounting — open the pack for{' '}
          <span className="text-gray-300">{activeCompany?.name || 'this company'}</span>, then return
          here for tax filing links.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-8">
        {LINKS.map(({ title, desc, to, icon: Icon, tone }) => (
          <Link
            key={to}
            to={to}
            className={`rounded-xl border p-5 transition-colors hover:bg-white/[0.04] ${TONE[tone]}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Icon className="w-5 h-5 shrink-0" />
                <h2 className="text-sm font-semibold text-white">{title}</h2>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-gray-500 shrink-0" />
            </div>
            <p className="text-xs text-gray-400 mt-3 leading-relaxed">{desc}</p>
          </Link>
        ))}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-sm font-semibold text-white mb-2">Tax period companions</h2>
        <p className="text-xs text-gray-500 mb-4">
          After statements are ready, verify VAT boxes and download the FTA audit pack for the same period.
        </p>
        <div className="flex flex-wrap gap-3 text-xs">
          <Link to="/gulftax/vat-return" className="text-teal-400 underline">
            VAT Return →
          </Link>
          <Link to="/gulftax/tax-compliance" className="text-teal-400 underline">
            Tax Compliance Report →
          </Link>
          <Link to="/gulftax/audit-exports" className="text-amber-400 underline">
            Audit Exports →
          </Link>
        </div>
      </div>
    </div>
  );
}
