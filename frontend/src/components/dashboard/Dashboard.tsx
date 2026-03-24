import React from 'react';
import { Link } from 'react-router-dom';
import { 
  BarChart3, 
  Zap,
  Target,
  Brain,
  LayoutGrid
} from 'lucide-react';
import { useAgentActivity } from '../../context/AgentActivityContext';
import type { AgentId } from '../../context/AgentActivityContext';

const AGENT_DEFS: { id: AgentId; name: string; route: string; description: string }[] = [
  { id: 'r2r', name: 'R2R Anomaly Agent', route: '/r2r-pattern', description: 'Analyses journal entries, detects fraud patterns, scores risk using Isolation Forest + Nova' },
  { id: 'ifrs', name: 'IFRS Reporting Agent', route: '/ifrs-generator', description: 'Maps trial balance to IFRS standards, generates 4 financial statements via Nova' },
  { id: 'fpa', name: 'FP&A Intelligence Agent', route: '/fpa', description: 'Runs variance analysis, forecasting, scenario planning powered by Nova' },
  { id: 'decision', name: 'CFO Decision Agent', route: '/cfo-decision', description: 'Analyses investment decisions, capital allocation, hire vs automate via Nova' },
  { id: 'voice', name: 'CFO Voice Agent', route: '/cfo', description: 'Answers financial questions by voice using Nova 2 Sonic speech-to-speech' },
];

export const Dashboard: React.FC = () => {
  const { actions, activeAgents, markActive } = useAgentActivity();

  const modules = [
    {
      icon: <LayoutGrid className="w-16 h-16 text-indigo-400" />,
      title: 'R2R Service 1',
      description: 'Close Tracker · TB Variance Analysis · Bank Reconciliation',
      link: '/r2r',
      bgColor: 'bg-indigo-500/10'
    },
    {
      icon: <LayoutGrid className="w-16 h-16 text-indigo-400" />,
      title: 'R2R Pattern Engine',
      description: 'Upload journal entries for 7-model anomaly detection (Amount, Duplicate, User, Timing, Account, Vendor, Benford)',
      link: '/r2r-pattern',
      bgColor: 'bg-indigo-500/10'
    },
    {
      icon: <BarChart3 className="w-16 h-16 text-green-400" />,
      title: 'FP&A Suite',
      description: 'Comprehensive planning, budgeting, and forecasting',
      link: '/fpa',
      bgColor: 'bg-green-500/10'
    },
    {
      icon: <Target className="w-16 h-16 text-purple-400" />,
      title: 'CFO Services',
      description: 'AI Assistant, Insights, Monitoring & Financial Health Dashboard',
      link: '/cfo',
      bgColor: 'bg-purple-500/10'
    },
    {
      icon: <Zap className="w-16 h-16 text-orange-400" />,
      title: 'IFRS',
      description: 'IFRS Statement Generator - Convert Trial Balance to Financial Statements',
      link: '/ifrs-generator',
      bgColor: 'bg-orange-500/10',
      badge: 'New'
    },
    {
      icon: <Brain className="w-16 h-16 text-amber-400" />,
      title: 'CFO Decision Intelligence',
      description: 'Investment ROI, Build vs Buy, Outsource vs Internal, Capital Allocation & Risk',
      link: '/cfo-decision',
      bgColor: 'bg-amber-500/10',
      badge: 'NEW'
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
      {/* Top Navigation Bar */}
      <nav className="bg-slate-900/50 backdrop-blur-sm border-b border-slate-700">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-white">FinReport AI</h1>
        </div>
        <p className="container mx-auto px-6 pb-2 text-sm text-slate-400">
          Open a section below and upload data there to use it. Each section uses only its own uploads.
        </p>
      </nav>

      {/* Agent Network Header */}
      <div className="border-b border-slate-700 bg-slate-800/30">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg font-semibold text-white">🤖 FinReportAI Agent Network</span>
            <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-sm font-medium rounded-full">
              ● {activeAgents.size} Agents Active
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {AGENT_DEFS.map((a) => (
              <Link
                key={a.id}
                to={a.route}
                onClick={() => markActive(a.id)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeAgents.has(a.id)
                    ? 'bg-green-500/20 text-green-400 border border-green-500/40 hover:bg-green-500/30'
                    : 'bg-slate-700/50 text-slate-400 border border-slate-600 hover:bg-slate-700'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${activeAgents.has(a.id) ? 'bg-green-500' : 'bg-slate-500'}`} />
                {a.name.replace(' Agent', '')} ✓
              </Link>
            ))}
          </div>
          {actions.length > 0 && (
            actions[0]?.agentId === 'r2r' ? (
              <Link to="/r2r-pattern" className="mt-2 block text-xs text-slate-400 hover:text-slate-300 hover:underline">
                Last action: &quot;{actions[0]?.message}&quot;
              </Link>
            ) : (
              <p className="mt-2 text-xs text-slate-400">
                Last action: &quot;{actions[0]?.message}&quot;
              </p>
            )
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-6 py-16">
        {/* Header Section */}
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold text-white mb-4">
            FinReport AI
          </h1>
          <p className="text-xl text-gray-300">
            Enterprise Financial Intelligence Platform powered by Amazon Nova
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto relative">
          {modules.map((module, index) => (
            <Link
              key={index}
              to={module.link}
              className="bg-slate-800/40 backdrop-blur-sm rounded-2xl p-8 hover:bg-slate-800/60 transition-all duration-300 border border-slate-700 hover:border-slate-600 group relative"
            >
              {module.badge && (
                <span className="absolute top-4 right-4 px-3 py-1 bg-amber-500 text-white text-xs font-bold rounded-full">
                  {module.badge} ⭐
                </span>
              )}
              <div className={`${module.bgColor} w-20 h-20 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
                {module.icon}
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">{module.title}</h3>
              <p className="text-gray-300 leading-relaxed">{module.description}</p>
            </Link>
          ))}
        </div>

        {/* Agent Handoff Log */}
        <div className="mt-12 max-w-5xl mx-auto">
          <h3 className="text-lg font-semibold text-white mb-3">Agent Activity</h3>
          <div className="bg-slate-800/40 rounded-xl border border-slate-700 p-4 space-y-2">
            {actions.slice(0, 5).map((a, i) => (
              <div key={a.id || `action-${i}`} className="flex items-start gap-2 text-sm">
                <span className="text-slate-500">🤖</span>
                <span className="font-medium text-slate-300">{a.agentName}</span>
                <span className="text-slate-400">—</span>
                <span className="text-slate-300">&quot;{a.message}&quot;</span>
              </div>
            ))}
          </div>
        </div>

        {/* #AmazonNova Badge */}
        <div className="fixed bottom-4 right-4">
          <a
            href="https://aws.amazon.com/bedrock/nova/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block px-3 py-1.5 bg-slate-700/80 hover:bg-slate-600 text-slate-300 text-xs font-medium rounded-lg border border-slate-600 transition-colors"
          >
            #AmazonNova
          </a>
        </div>
      </div>
    </div>
  );
};
