import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { FileSpreadsheet, Landmark, Receipt, FileBarChart, Clock, Users, TrendingUp, Zap } from 'lucide-react';

const STAT_CARDS = [
  { label: 'Clients Processed This Month', value: '24', icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
  { label: 'Journal Entries Auto-Posted', value: '1,842', icon: Zap, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { label: 'Reports Generated', value: '18', icon: FileBarChart, color: 'text-violet-600', bg: 'bg-violet-50' },
  { label: 'Hours Saved', value: '94 hrs', icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
];

const MODULES = [
  {
    title: 'Bank Statement Processor',
    desc: 'Upload any Indian bank statement â€” auto-generates journal entries with Tally-ready export.',
    href: '/ca-firm/bank-processor',
    icon: Landmark,
    color: 'bg-blue-600',
    badge: 'HDFC Â· ICICI Â· SBI Â· Axis',
  },
  {
    title: 'Tally Auto-Posting',
    desc: 'Convert journal entries to Tally XML. Validate, map ledgers, and download import-ready files.',
    href: '/ca-firm/tally-posting',
    icon: Zap,
    color: 'bg-violet-600',
    badge: 'TallyPrime Â· ERP 9',
  },
  {
    title: 'TB â†’ Financial Statements',
    desc: 'Upload a trial balance and instantly get P&L, Balance Sheet, ratios, and AI commentary.',
    href: '/ca-firm/tb-financials',
    icon: FileSpreadsheet,
    color: 'bg-emerald-600',
    badge: 'IFRS Â· Ind AS',
  },
  {
    title: 'Client Report Generator',
    desc: 'One-click branded PDF report with financials, ratios, and AI recommendations for any client.',
    href: '/ca-firm/client-reports',
    icon: Receipt,
    color: 'bg-amber-600',
    badge: 'PDF Â· WhatsApp Â· Email',
  },
];

export function CAFirmDashboard() {
  const navigate = useNavigate();

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
            <TrendingUp className="w-4 h-4" />
            CA Firm Tools
          </div>
          <h1 className="text-2xl font-bold text-slate-900">CA Firm Automation Hub</h1>
          <p className="text-sm text-slate-500 mt-1">
            Bank statements â†’ Journal entries â†’ Tally â†’ Financial statements. Fully automated.
          </p>
        </div>
        <Button
          variant="outline"
          className="text-xs gap-2 border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100"
          onClick={() => navigate('/ca-firm/bank-processor?demo=1')}
        >
          ðŸŽ¬ Run Demo
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STAT_CARDS.map((s) => (
          <Card key={s.label} className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`p-2 rounded-lg ${s.bg}`}>
                <s.icon className={`w-5 h-5 ${s.color}`} />
              </div>
              <div>
                <p className="text-xl font-bold text-slate-900">{s.value}</p>
                <p className="text-xs text-slate-500 leading-tight">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Module tiles */}
      <div className="grid md:grid-cols-2 gap-5">
        {MODULES.map((m) => (
          <Card
            key={m.href}
            className="border border-slate-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer group"
            onClick={() => navigate(m.href)}
          >
            <CardContent className="p-6 flex gap-4 items-start">
              <div className={`p-3 rounded-xl ${m.color} text-white shrink-0 group-hover:scale-105 transition-transform`}>
                <m.icon className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h3 className="font-semibold text-slate-900">{m.title}</h3>
                  <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">
                    {m.badge}
                  </span>
                </div>
                <p className="text-sm text-slate-500">{m.desc}</p>
              </div>
              <span className="text-slate-400 group-hover:text-slate-600 text-lg">â†’</span>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick guide */}
      <Card className="border-0 bg-slate-50">
        <CardContent className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Recommended Workflow</p>
          <div className="flex flex-wrap gap-2 items-center text-sm text-slate-700">
            {['1. Upload bank statement', 'â†’', '2. Auto journal entries', 'â†’', '3. Export Tally XML', 'â†’', '4. TB â†’ Statements', 'â†’', '5. Generate client PDF'].map((s) => (
              <span key={s} className={s === 'â†’' ? 'text-slate-400' : 'px-3 py-1 bg-white rounded-full border border-slate-200 font-medium text-xs'}>
                {s}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

