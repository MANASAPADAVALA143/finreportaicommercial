// FP&A Suite - Landing Page with Sub-Module Cards
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  Target, 
  Layers, 
  Activity, 
  FileText,
  ArrowLeft,
  CheckCircle,
  Clock,
  Upload,
  Brain
} from 'lucide-react';
import { MultiUploadModal } from '../../components/fpa/MultiUploadModal';

export const FPASuite = () => {
  const navigate = useNavigate();
  const [showUploadModal, setShowUploadModal] = useState(false);

  const modules = [
    {
      id: 'variance',
      title: 'Variance Analysis',
      description: 'Budget vs Actual performance with AI-powered commentary',
      icon: BarChart3,
      route: '/fpa/variance',
      available: true,
      color: 'from-blue-500 to-blue-600',
      bgColor: 'bg-blue-50',
      iconColor: 'text-blue-600'
    },
    {
      id: 'budget',
      title: 'Budget Management',
      description: 'Create, manage, and track annual budgets across departments',
      icon: Target,
      route: '/fpa/budget',
      available: true,
      color: 'from-green-500 to-green-600',
      bgColor: 'bg-green-50',
      iconColor: 'text-green-600'
    },
    {
      id: 'forecast',
      title: 'Forecasting',
      description: 'Rolling forecasts and predictive analytics powered by AI',
      icon: TrendingUp,
      route: '/fpa/forecast',
      available: true,
      color: 'from-purple-500 to-purple-600',
      bgColor: 'bg-purple-50',
      iconColor: 'text-purple-600'
    },
    {
      id: 'scenarios',
      title: 'Scenario Planning',
      description: 'What-if analysis and sensitivity modeling for strategic decisions',
      icon: Layers,
      route: '/fpa/scenarios',
      available: true,
      color: 'from-orange-500 to-orange-600',
      bgColor: 'bg-orange-50',
      iconColor: 'text-orange-600'
    },
    {
      id: 'kpi',
      title: 'KPI Dashboard',
      description: 'Real-time KPI tracking with automated alerts and insights',
      icon: Activity,
      route: '/fpa/kpi',
      available: true,
      color: 'from-cyan-500 to-cyan-600',
      bgColor: 'bg-cyan-50',
      iconColor: 'text-cyan-600'
    },
    {
      id: 'reports',
      title: 'Management Reports',
      description: 'Automated board packs and executive reports generation',
      icon: FileText,
      route: '/fpa/reports',
      available: true,
      color: 'from-indigo-500 to-indigo-600',
      bgColor: 'bg-indigo-50',
      iconColor: 'text-indigo-600'
    },
    {
      id: 'decision',
      title: 'CFO Decision Intelligence',
      description: 'Investment ROI, Build vs Buy, Outsource vs Internal, Capital Allocation & Risk',
      icon: Brain,
      route: '/cfo-decision',
      available: true,
      color: 'from-amber-500 to-orange-600',
      bgColor: 'bg-amber-50',
      iconColor: 'text-amber-600',
      badge: 'NEW ⭐'
    }
  ];

  const handleModuleClick = (module: typeof modules[0]) => {
    if (module.available) {
      navigate(module.route);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50">
      {/* Multi-Upload Modal */}
      <MultiUploadModal 
        isOpen={showUploadModal} 
        onClose={() => setShowUploadModal(false)} 
      />
      
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/dashboard')}
                className="p-2 hover:bg-gray-100 rounded-lg transition"
              >
                <ArrowLeft className="w-5 h-5 text-gray-600" />
              </button>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">FP&A Suite</h1>
                <p className="text-gray-600 mt-1">Financial Planning & Analysis Tools</p>
              </div>
            </div>
            
            {/* Upload Data - same as all sections (top right) */}
            <Link
              to="/upload-data"
              className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors shadow-sm bg-blue-600 text-white hover:bg-blue-700"
            >
              <Upload className="w-4 h-4" />
              <span>Upload Data</span>
            </Link>
          </div>
          
          {/* Info Banner */}
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-4 mt-4">
            <p className="text-sm text-blue-900">
              <strong>💡 Upload Once, Use Everywhere:</strong> Upload your trial balance here and all 7 modules below will automatically use your real data.
            </p>
          </div>
          
          {/* Stats */}
          <div className="flex items-center gap-6 text-sm mt-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span className="text-gray-700">
                <span className="font-semibold">7</span> modules active
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-400" />
              <span className="text-gray-700">
                <span className="font-semibold">FP&A Suite Complete!</span> 🎉
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Module Cards */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {modules.map((module, index) => {
            const Icon = module.icon;
            
            return (
              <motion.div
                key={module.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: index * 0.1 }}
                onClick={() => handleModuleClick(module)}
                className={`relative group ${
                  module.available 
                    ? 'cursor-pointer hover:shadow-xl hover:scale-105' 
                    : 'cursor-not-allowed opacity-75'
                } transition-all duration-300`}
              >
                {/* Card */}
                <div className="bg-white rounded-xl border-2 border-gray-200 overflow-hidden h-full">
                  {/* Gradient Header */}
                  <div className={`h-2 bg-gradient-to-r ${module.color}`}></div>
                  
                  {/* Content */}
                  <div className="p-6">
                    {/* Icon & Status */}
                    <div className="flex items-start justify-between mb-4">
                      <div className={`p-3 rounded-lg ${module.bgColor}`}>
                        <Icon className={`w-8 h-8 ${module.iconColor}`} />
                      </div>
                      
                      {module.available ? (
                        <div className="flex flex-col items-end gap-1">
                          <span className="px-3 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded-full">
                            ✓ Active
                          </span>
                          {module.badge && (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-bold rounded-full">
                              {module.badge}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="px-3 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full">
                          Coming Soon
                        </span>
                      )}
                    </div>

                    {/* Title & Description */}
                    <h3 className="text-xl font-bold text-gray-900 mb-2">
                      {module.title}
                    </h3>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      {module.description}
                    </p>

                    {/* Action Footer */}
                    {module.available && (
                      <div className="mt-6 pt-4 border-t border-gray-100">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-blue-600 group-hover:text-blue-700">
                            Open Module →
                          </span>
                          <div className="w-8 h-8 rounded-full bg-blue-100 group-hover:bg-blue-200 transition flex items-center justify-center">
                            <ArrowLeft className="w-4 h-4 text-blue-600 transform rotate-180" />
                          </div>
                        </div>
                      </div>
                    )}

                    {!module.available && (
                      <div className="mt-6 pt-4 border-t border-gray-100">
                        <div className="text-xs text-gray-500 italic">
                          Module under development
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Hover Effect Overlay */}
                {module.available && (
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-xl pointer-events-none"></div>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Footer Info */}
        <div className="mt-12 bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Activity className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 mb-2">About FP&A Suite</h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                The FP&A Suite is your comprehensive financial planning and analysis toolkit. 
                Active modules: <span className="font-semibold">Variance Analysis</span> (budget vs actual), 
                <span className="font-semibold"> Budget Management</span> (annual planning), 
                <span className="font-semibold"> KPI Dashboard</span> (CFO morning view), 
                <span className="font-semibold"> Forecasting Engine</span> (revenue/expense/cash), and 
                <span className="font-semibold"> Scenario Planning</span> (what-if analysis). 
                Management reporting coming soon.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
