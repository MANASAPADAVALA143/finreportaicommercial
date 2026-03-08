import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  Bot, 
  Shield, 
  BarChart3, 
  FileCheck,
  TrendingUp,
  Zap,
  Target,
  Upload,
  Brain
} from 'lucide-react';

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();

  const modules = [
    {
      icon: <FileCheck className="w-16 h-16 text-blue-400" />,
      title: 'R2R / Month-End Close',
      description: 'Streamlined record-to-report and month-end close processes',
      link: '/r2r',
      bgColor: 'bg-blue-500/10'
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
          <div className="flex items-center gap-4">
            <Link
              to="/upload-data"
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
            >
              <Upload className="w-4 h-4" />
              Upload Data
            </Link>
          </div>
        </div>
      </nav>

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
        <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
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
      </div>
    </div>
  );
};
