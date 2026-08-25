import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Shield, BarChart3, Building2, Play, Receipt, LineChart, Percent, ShieldCheck, type LucideIcon } from 'lucide-react';

/**
 * Public, unauthenticated landing page for real estate developers.
 * Purely additive marketing surface — does not touch the authenticated app shell.
 */

const NAV_LINKS = [
  { label: 'Platform', href: '/' },
  { label: 'IFRS', href: '/' },
  { label: 'Real Estate', href: '/real-estate' },
  { label: 'GulfTax', href: '/' },
  { label: 'Pricing', href: '/' },
];

const FEATURE_CARDS: { icon: LucideIcon; title: string; subtitle: string }[] = [
  { icon: Receipt, title: 'AP InvoiceFlow', subtitle: 'Property · Tower · Unit tracking' },
  { icon: LineChart, title: 'IFRS 15/16 Engine', subtitle: 'Off-plan revenue recognition' },
  { icon: Percent, title: 'GulfTax VAT', subtitle: 'FTA box mapping automated' },
  { icon: BarChart3, title: 'IAS 1 Statements', subtitle: 'TB → financial statements in minutes' },
  { icon: ShieldCheck, title: 'Audit Trail', subtitle: 'Every action logged' },
];

const STAT_PILLS = ['47 Leases Automated', 'AED 2.3M Processed', '31 Backend Tests Passing'];

const KPI_TILES = [
  { label: 'Total Assets', value: 'AED 4.68B', accent: 'text-white', trend: true },
  { label: 'Net Income', value: 'AED 312.6M', accent: 'text-white', trend: false },
  { label: 'Cash Position', value: 'AED 586.7M', accent: 'text-white', trend: false },
  { label: 'Gross IRR', value: '18.4%', accent: 'text-[#FFD700]', trend: false },
];

const BAR_HEIGHTS = [40, 65, 50, 80, 60, 95, 70, 55];

function MiniBarChart() {
  const barWidth = 18;
  const gap = 10;
  const width = BAR_HEIGHTS.length * (barWidth + gap);
  const height = 100;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-20" aria-hidden="true">
      {BAR_HEIGHTS.map((h, i) => (
        <rect
          key={i}
          x={i * (barWidth + gap)}
          y={height - h}
          width={barWidth}
          height={h}
          rx={3}
          fill={i % 2 === 0 ? '#FFD700' : '#00D4AA'}
        />
      ))}
    </svg>
  );
}

function PrimaryButton({ to, children, className = '' }: { to: string; children: React.ReactNode; className?: string }) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center justify-center gap-2 h-12 px-6 rounded-lg bg-[#FFD700] text-[#0A1628] font-semibold hover:brightness-95 transition ${className}`}
    >
      {children}
    </Link>
  );
}

function SecondaryButton({ to, children, className = '' }: { to: string; children: React.ReactNode; className?: string }) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center justify-center gap-2 h-12 px-6 rounded-lg bg-transparent border border-[#FFD700] text-[#FFD700] font-semibold hover:bg-[#FFD700]/10 transition ${className}`}
    >
      {children}
    </Link>
  );
}

export default function RealEstateLanding() {
  // Belt-and-suspenders: GnanovaBanner already returns null on this route (see
  // App.tsx), but if that ever regresses, forcibly hide any stray top banner
  // rather than let it bleed through this public page.
  useEffect(() => {
    const banner = document.querySelector<HTMLElement>('[data-gnanova-banner]');
    if (banner) banner.style.display = 'none';
    return () => {
      if (banner) banner.style.display = '';
    };
  }, []);

  return (
    <div
      className="min-h-screen bg-[#0A1628] text-white"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* Section 1 — Navigation */}
      <header className="sticky top-0 z-40 bg-[#0A1628] border-b border-[#1A2D45]">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="text-lg font-bold">
            <span className="text-white">FinReport</span>
            <span className="text-[#FFD700]">AI</span>
          </Link>

          <nav className="hidden md:flex items-center gap-8">
            {NAV_LINKS.map((link) => (
              <Link key={link.label} to={link.href} className="text-sm text-white hover:text-[#FFD700] transition">
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-4">
            <Link to="/login" className="text-sm text-white hover:text-[#FFD700] transition">
              Sign in
            </Link>
            <Link
              to="/login"
              className="inline-flex items-center h-9 px-4 rounded-md bg-[#FFD700] text-[#0A1628] text-sm font-semibold hover:brightness-95 transition"
            >
              Book Demo
            </Link>
          </div>
        </div>
      </header>

      {/* Section 2 — Hero */}
      <section className="max-w-7xl mx-auto px-6 py-16 lg:min-h-[90vh] grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div>
          <span className="inline-block text-xs font-semibold tracking-wide text-[#FFD700] border border-[#FFD700] rounded-full px-3 py-1 mb-6">
            Built for Global Real Estate Finance
          </span>

          <h1 className="text-4xl md:text-[48px] leading-tight font-bold text-white mb-6">
            The Finance OS built for{' '}
            <span className="border-b-[3px] border-[#FFD700]">real estate</span> developers
          </h1>

          <p className="text-lg text-[#8899AA] mb-8 max-w-xl">
            IFRS 15/16 revenue recognition, AP automation, UAE VAT compliance, and IAS 1 financial
            statements — unified in one institutional-grade platform.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 mb-10">
            <PrimaryButton to="/login">Start free trial →</PrimaryButton>
            <SecondaryButton to="/login">
              <Play size={16} /> Watch demo
            </SecondaryButton>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-sm text-[#8899AA]">
            <span className="flex items-center gap-2">
              <Shield size={16} className="text-[#8899AA]" /> CMA Certified
            </span>
            <span className="flex items-center gap-2">
              <BarChart3 size={16} className="text-[#8899AA]" /> DipIFRS Accredited
            </span>
            <span className="flex items-center gap-2">
              <Building2 size={16} className="text-[#8899AA]" /> 47-Lease UAE Portfolio Tested
            </span>
          </div>
        </div>

        {/* Dashboard mockup card — hidden below 768px per spec */}
        <div className="hidden md:block">
          <div
            className="bg-[#0F2035] border border-[#FFD700] rounded-2xl p-6"
            style={{ boxShadow: '0 0 40px rgba(255, 215, 0, 0.15)' }}
          >
            <div className="flex items-center justify-between mb-6">
              <span className="text-white font-semibold text-sm">FinReportAI Dashboard</span>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#FFD700]" />
                <span className="w-2 h-2 rounded-full bg-[#00D4AA]" />
                <span className="w-2 h-2 rounded-full bg-[#8899AA]" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6">
              {KPI_TILES.map((tile) => (
                <div key={tile.label} className="bg-[#1A2D45] rounded-lg p-4">
                  <p className="text-xs text-[#8899AA] mb-1">{tile.label}</p>
                  <p className={`text-lg font-bold ${tile.accent}`}>
                    {tile.value}
                    {tile.trend && <span className="text-[#00D4AA] text-xs ml-1">↑</span>}
                  </p>
                </div>
              ))}
            </div>

            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-white">Revenue Recognition (IFRS 15)</span>
                <span className="text-xs text-[#FFD700] font-semibold">25% recognised</span>
              </div>
              <div className="h-2 rounded-full bg-[#1A2D45] overflow-hidden">
                <div className="h-full bg-[#FFD700] rounded-full" style={{ width: '25%' }} />
              </div>
            </div>

            <MiniBarChart />
          </div>
        </div>
      </section>

      {/* Section 3 — Feature cards */}
      <section className="bg-[#0F2035] py-16">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
            {FEATURE_CARDS.map((card) => (
              <div
                key={card.title}
                className="bg-[#0F2035] border border-[#1A2D45] rounded-xl p-6 hover:border-[#FFD700]/50 transition"
              >
                <card.icon width={32} height={32} color="#FFD700" strokeWidth={1.75} className="mb-4" />
                <h3 className="text-white font-semibold mb-1">{card.title}</h3>
                <p className="text-sm text-[#8899AA]">{card.subtitle}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Section 4 — Social proof strip */}
      <section className="bg-[#0A1628] py-16 text-center">
        <div className="max-w-4xl mx-auto px-6">
          <p className="text-[#8899AA] mb-6">
            Trusted by UAE real estate developers and CA firms managing AED 4.68B+ in assets
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            {STAT_PILLS.map((stat) => (
              <span
                key={stat}
                className="text-sm text-white bg-[#0F2035] border border-[#1A2D45] rounded-full px-4 py-2"
              >
                {stat}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Section 5 — CTA band */}
      <section className="bg-[#0F2035] border-t border-b border-[#FFD700] py-16 text-center">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-white mb-4">Ready to automate your real estate finance?</h2>
          <p className="text-[#8899AA] mb-8">
            Book a 10-minute demo. See AP InvoiceFlow, IFRS 15/16, and GulfTax working on your data.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <PrimaryButton to="/login">Book Demo →</PrimaryButton>
            <SecondaryButton to="/login">Start Free Trial</SecondaryButton>
          </div>
        </div>
      </section>

      {/* Section 6 — Footer */}
      <footer className="bg-[#050E1A] py-10">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
            <span className="text-white text-sm">FinReportAI by Gnanova Pro AI Technologies</span>
            <a href="https://finreportai.com" className="text-[#FFD700] text-sm hover:underline">
              finreportai.com
            </a>
            <span className="text-white text-sm">Built for UAE · India · Global 🌐</span>
          </div>
          <div className="text-center text-xs text-[#8899AA] border-t border-[#1A2D45] pt-6">
            Claude API · FastAPI · PostgreSQL · Supabase · React
          </div>
        </div>
      </footer>
    </div>
  );
}
