import { useNavigate } from 'react-router-dom';
import { TA_MODULES, TA_STATUS_BADGE } from './modules';

export default function TechnicalAccountingOverviewPage() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Overview</h2>
        <p className="text-sm text-muted-foreground">
          Technical accounting modules for standards research, complex transactions and documentation
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {TA_MODULES.map(({ key, label, path, icon: Icon, description, status }) => (
          <button
            key={key}
            onClick={() => navigate(path)}
            className="text-left rounded-xl border border-border bg-card p-5 shadow-sm hover:shadow-md hover:border-blue-300 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="h-9 w-9 rounded-lg bg-blue-600/10 flex items-center justify-center">
                <Icon className="h-4 w-4 text-blue-600" />
              </div>
              <span className={`px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${TA_STATUS_BADGE[status]}`}>{status}</span>
            </div>
            <p className="font-semibold text-foreground">{label}</p>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
