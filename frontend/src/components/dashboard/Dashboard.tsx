import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  Bot, 
  Shield, 
  BarChart3, 
  FileCheck,
  TrendingUp,
  Zap,
  LogOut,
  User
} from 'lucide-react';
import { useAuthStore } from '../../services/auth';

export const Dashboard: React.FC = () => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const modules = [
    {
      icon: <Bot className="w-16 h-16 text-blue-400" />,
      title: 'Amazon Nova AI',
      description: 'Advanced AI-powered financial analysis and insights',
      link: '/nova',
      bgColor: 'bg-blue-500/10'
    },
    {
      icon: <Shield className="w-16 h-16 text-green-400" />,
      title: 'Fraud Detection',
      description: 'Real-time anomaly detection and risk assessment',
      link: '/fraud',
      bgColor: 'bg-green-500/10'
    },
    {
      icon: <BarChart3 className="w-16 h-16 text-purple-400" />,
      title: 'FP&A Suite',
      description: 'Comprehensive planning, budgeting, and forecasting',
      link: '/fpa',
      bgColor: 'bg-purple-500/10'
    },
    {
      icon: <FileCheck className="w-16 h-16 text-orange-400" />,
      title: 'IFRS Compliance',
      description: 'Automated compliance checking and reporting',
      link: '/ifrs',
      bgColor: 'bg-orange-500/10'
    },
    {
      icon: <TrendingUp className="w-16 h-16 text-red-400" />,
      title: 'R2R Automation',
      description: 'Streamlined record-to-report processes',
      link: '/r2r',
      bgColor: 'bg-red-500/10'
    },
    {
      icon: <Zap className="w-16 h-16 text-yellow-400" />,
      title: 'CFO Services',
      description: 'Strategic financial advisory and transformation',
      link: '/cfo',
      bgColor: 'bg-yellow-500/10'
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
      {/* Top Navigation Bar */}
      <nav className="bg-slate-900/50 backdrop-blur-sm border-b border-slate-700">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-white">FinReport AI</h1>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-gray-300">
              <User className="w-5 h-5" />
              <span>{user?.full_name || user?.email}</span>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg transition"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="container mx-auto px-6 py-16">
        {/* Header Section */}
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold text-white mb-4">
            FinReport AI Commercial
          </h1>
          <p className="text-xl text-gray-300">
            Enterprise Financial Intelligence Platform powered by Amazon Nova
          </p>
          <div className="flex gap-4 justify-center mt-8">
            <Link
              to="/r2r"
              className="px-8 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition"
            >
              Get Started
            </Link>
            <Link
              to="/nova"
              className="px-8 py-3 bg-white/10 backdrop-blur-sm text-white rounded-lg font-semibold hover:bg-white/20 transition border border-white/20"
            >
              Sign In
            </Link>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {modules.map((module, index) => (
            <Link
              key={index}
              to={module.link}
              className="bg-slate-800/40 backdrop-blur-sm rounded-2xl p-8 hover:bg-slate-800/60 transition-all duration-300 border border-slate-700 hover:border-slate-600 group"
            >
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
