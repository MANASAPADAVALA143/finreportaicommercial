import type { ComponentType } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import {
  LayoutDashboard, Mail, Percent, FileText, GitMerge, Building2,
  ScrollText, BarChart3, Factory, Receipt, Settings, Scale, Globe2, FileCheck,
  Calculator, MapPin, FileWarning,
} from 'lucide-react';

import { useWorkspace } from '../../context/WorkspaceContext';



type NavItem = {

  to: string;

  label: string;

  icon: ComponentType<{ className?: string }>;

  end?: boolean;

  badge?: string;

  section?: string;

};



const MAIN_NAV: NavItem[] = [

  { to: '/gulftax', label: 'Overview', icon: LayoutDashboard, end: true },

  { to: '/gulftax/e-invoicing', label: 'E-Invoicing', icon: Mail, badge: 'Jul 2026' },

  { to: '/gulftax/vat-classifier', label: 'VAT Classifier', icon: Percent },

  { to: '/gulftax/invoice-flow', label: 'Invoice Flow', icon: Receipt },

  { to: '/gulftax/vat-return', label: 'VAT Return', icon: FileText },

  { to: '/gulftax/reconciliation', label: 'Recon Bot', icon: GitMerge },

];



const VAT_ADVANCED_NAV: NavItem[] = [
  { to: '/gulftax/partial-exemption', label: 'Partial Exemption Calculator', icon: Calculator },
  { to: '/gulftax/designated-zones', label: 'Designated Zones', icon: MapPin },
  { to: '/gulftax/bad-debt-relief', label: 'Bad Debt Relief', icon: FileWarning },
];

const COMPLIANCE_NAV: NavItem[] = [
  { to: '/gulftax/corporate-tax', label: 'Corporate Tax', icon: Building2 },
  { to: '/gulftax/esr-filing', label: 'ESR Filing', icon: FileCheck },
  { to: '/gulftax/transfer-pricing', label: 'Transfer Pricing', icon: Scale },
  { to: '/gulftax/cbcr', label: 'CbCR Report', icon: Globe2 },
];



const REPORTS_NAV: NavItem[] = [

  { to: '/gulftax/tax-memo', label: 'Tax Memo', icon: ScrollText },

  { to: '/gulftax/fta-reports', label: 'FTA Reports', icon: BarChart3 },

  { to: '/gulftax/suppliers', label: 'Supplier Ledger', icon: Factory },

];



function NavSection({ title, items }: { title: string; items: NavItem[] }) {

  return (

    <>

      <div className="text-[10px] uppercase tracking-widest text-muted2 font-mono px-3 pt-3 pb-1">

        {title}

      </div>

      {items.map(({ to, label, icon: Icon, end, badge }) => (

        <NavLink

          key={to}

          to={to}

          end={end}

          className={({ isActive }) =>

            `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${

              isActive

                ? 'bg-gold-pale text-gold-lt border border-border-g'

                : 'text-muted hover:text-white hover:bg-white/5'

            }`

          }

        >

          <Icon className="w-4 h-4 shrink-0" />

          <span className="flex-1">{label}</span>

          {badge && (

            <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-900/50 text-red-300 border border-red-800/50">

              {badge}

            </span>

          )}

        </NavLink>

      ))}

    </>

  );

}



export default function GulfTaxLayout() {

  const { activeWorkspace } = useWorkspace();

  const mandateJan2027 = new Date('2027-01-01T00:00:00+04:00');

  const daysToMandate = Math.max(0, Math.ceil((mandateJan2027.getTime() - Date.now()) / 86400000));



  return (

    <div className="flex min-h-full w-full bg-deep text-gray-100">

      <aside className="w-60 shrink-0 border-r border-border bg-[rgba(4,12,30,0.97)] flex flex-col overflow-y-auto">

        <div className="px-4 py-5 border-b border-border">

          <div className="text-[10px] font-mono uppercase tracking-widest text-gold mb-1">

            GulfTax AI

          </div>

          <div className="text-sm font-semibold text-white truncate">

            {activeWorkspace?.name ?? 'Workspace'}

          </div>

          <div className="text-[10px] text-muted2 mt-1">{daysToMandate}d to e-invoicing mandate</div>

        </div>

        <nav className="flex-1 p-2 space-y-0.5">

          <NavSection title="Main" items={MAIN_NAV} />

          <NavSection title="VAT Advanced" items={VAT_ADVANCED_NAV} />

          <NavSection title="Compliance" items={COMPLIANCE_NAV} />

          <NavSection title="Reports" items={REPORTS_NAV} />

          <div className="text-[10px] uppercase tracking-widest text-muted2 font-mono px-3 pt-3 pb-1">

            Settings

          </div>

          <NavLink

            to="/gulftax/settings"

            className={({ isActive }) =>

              `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${

                isActive

                  ? 'bg-gold-pale text-gold-lt border border-border-g'

                  : 'text-muted hover:text-white hover:bg-white/5'

              }`

            }

          >

            <Settings className="w-4 h-4 shrink-0" />

            Settings

          </NavLink>

        </nav>

      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto p-6 md:p-8">

        <Outlet />

      </main>

    </div>

  );

}

