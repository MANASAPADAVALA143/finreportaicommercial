import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, FileSpreadsheet } from 'lucide-react';
import { EXCEL_MODULES } from './excelModules';

export function ExcelSuite() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-emerald-50/40 to-slate-50">
      <div className="bg-white border-b border-emerald-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center gap-4 mb-4">
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Excel AI Suite</h1>
              <p className="text-gray-600 mt-1">FP&amp;A + CFO workflows — native Excel in and out</p>
            </div>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-green-50 p-4 mb-4">
            <p className="text-sm text-emerald-950">
              <strong>Work in Excel. Powered by AI.</strong> Upload your spreadsheet — get it back with AI
              analysis, commentary, and new sheets. No manual re-keying.
            </p>
          </div>

          <div className="flex flex-wrap gap-4 text-sm text-gray-700">
            <span className="font-semibold text-emerald-700">{EXCEL_MODULES.length} modules</span>
            <span className="text-gray-400">|</span>
            <span>Endpoints: <code className="text-xs bg-emerald-50 px-1 rounded">/api/excel/*</code></span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {EXCEL_MODULES.map((module, index) => {
            const Icon = module.icon;
            return (
              <motion.div
                key={module.slug}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: index * 0.05 }}
                className="group cursor-pointer"
                onClick={() => navigate(`/excel-suite/${module.slug}`)}
              >
                <div className="bg-white rounded-xl border-2 border-emerald-100 overflow-hidden h-full hover:shadow-xl hover:border-emerald-300 transition-all duration-300 hover:-translate-y-0.5">
                  <div className="h-2 bg-gradient-to-r from-emerald-600 to-green-500" />
                  <div className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="p-3 rounded-lg bg-emerald-50 ring-1 ring-emerald-100">
                        <FileSpreadsheet className="w-8 h-8 text-emerald-600" />
                      </div>
                      <div className="p-2 rounded-lg bg-slate-50">
                        <Icon className="w-5 h-5 text-slate-500" />
                      </div>
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">{module.title}</h3>
                    <p className="text-sm text-gray-600 leading-relaxed mb-4">{module.description}</p>
                    <p className="text-xs text-emerald-700 font-medium mb-4">
                      Upload Excel → Get AI-enhanced Excel
                    </p>
                    <button
                      type="button"
                      className="w-full py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors"
                    >
                      Launch
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
