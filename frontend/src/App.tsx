import { lazy, Suspense, type ComponentType } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AgentActivityProvider } from './context/AgentActivityContext';
import { ClientProvider } from './context/ClientContext';
import { LandingPage } from './components/landing/LandingPage';
import Sidebar from './components/layout/Sidebar';

function chunkLoadErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function ChunkLoadErrorScreen({ message }: { message: string }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        padding: 24,
        background: '#0f172a',
        color: '#e2e8f0',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1 style={{ fontSize: 18, marginBottom: 12 }}>This page failed to load</h1>
      <p style={{ color: '#94a3b8', marginBottom: 16, maxWidth: 560, lineHeight: 1.5 }}>
        This usually means the browser cached an old build or the dev server moved ports. Try{' '}
        <strong>Ctrl+Shift+R</strong> (hard refresh). Use the exact URL from the terminal where you ran{' '}
        <code style={{ color: '#f8fafc' }}>npm run dev</code> (this app uses port{' '}
        <code style={{ color: '#f8fafc' }}>3006</code>). Do not open <code style={{ color: '#f8fafc' }}>dist/index.html</code>{' '}
        directly.
      </p>
      <pre
        style={{
          background: '#020617',
          padding: 16,
          borderRadius: 8,
          fontSize: 12,
          color: '#fca5a5',
          whiteSpace: 'pre-wrap',
        }}
      >
        {message}
      </pre>
    </div>
  );
}

/** Lazy route imports that reject (network, stale cache) bypass React Error Boundaries; recover with a visible screen. */
function safeLazy<T extends ComponentType<object>>(loader: () => Promise<{ default: T }>) {
  return lazy(() =>
    loader().catch((err: unknown) => {
      console.error('Route chunk failed to load:', err);
      const message = chunkLoadErrorMessage(err);
      const Fallback = () => <ChunkLoadErrorScreen message={message} />;
      return { default: Fallback as unknown as T };
    })
  );
}

// Home is eager so a failed lazy chunk can’t leave `/` blank (lazy rejections bypass Error Boundaries).
const Dashboard = safeLazy(() =>
  import('./components/dashboard/Dashboard').then((m) => ({ default: m.Dashboard }))
);
const R2RModule = safeLazy(() =>
  import('./components/r2r/R2RModule').then((m) => ({ default: m.R2RModule }))
);
const R2RPatternAnalysisPage = safeLazy(() => import('./pages/R2RPatternAnalysisPage'));
const RevRecReconciliationPage = safeLazy(() => import('./pages/r2r/RevRecReconciliationPage'));
const TBVariancePage = safeLazy(() =>
  import('./pages/TBVariancePage').then((m) => ({ default: m.TBVariancePage }))
);
const BankReconciliationPage = safeLazy(() =>
  import('./pages/BankReconciliationPage').then((m) => ({ default: m.BankReconciliationPage }))
);
const CloseTrackerPage = safeLazy(() =>
  import('./pages/CloseTrackerPage').then((m) => ({ default: m.CloseTrackerPage }))
);
const NovaAssistant = safeLazy(() =>
  import('./components/nova/NovaAssistant').then((m) => ({ default: m.NovaAssistant }))
);
const CFODashboard = safeLazy(() =>
  import('./pages/CFODashboard').then((m) => ({ default: m.CFODashboard }))
);
const IFRSStatementGenerator = safeLazy(() =>
  import('./pages/IFRSStatementGenerator').then((m) => ({ default: m.IFRSStatementGenerator }))
);
const IFRSStatementPage = safeLazy(() => import('./pages/ifrs-statement/IFRSStatementPage'));
const AgenticGenerator = safeLazy(() => import('./pages/ifrs/AgenticGenerator'));
const TallyIntegrationPage = safeLazy(() => import('./pages/erp/TallyIntegrationPage'));
const FPASuite = safeLazy(() =>
  import('./pages/fpa/FPASuite').then((m) => ({ default: m.FPASuite }))
);
const ExcelSuite = safeLazy(() =>
  import('./pages/excel/ExcelSuite').then((m) => ({ default: m.ExcelSuite }))
);
const ExcelSuiteToolPage = safeLazy(() =>
  import('./pages/excel/ExcelSuiteToolPage').then((m) => ({ default: m.ExcelSuiteToolPage }))
);
const VarianceAnalysis = safeLazy(() =>
  import('./pages/fpa/VarianceAnalysis').then((m) => ({ default: m.VarianceAnalysis }))
);
const VarianceAnalysisPage = safeLazy(() =>
  import('./pages/fpa/VarianceAnalysisPage').then((m) => ({ default: m.VarianceAnalysisPage }))
);
const BudgetManagement = safeLazy(() => import('./pages/fpa/BudgetManagement'));
const KPIDashboard = safeLazy(() => import('./pages/fpa/KPIDashboard'));
const ForecastingEngine = safeLazy(() => import('./pages/fpa/ForecastingEngine'));
const ScenarioEngine = safeLazy(() =>
  import('./pages/fpa/ScenarioEngine').then((m) => ({ default: m.ScenarioEngine }))
);
const ManagementReporting = safeLazy(() => import('./pages/fpa/ManagementReporting'));
const PVMAnalysis = safeLazy(() => import('./pages/fpa/PVMAnalysis'));
const ThreeStatement = safeLazy(() => import('./pages/fpa/ThreeStatement'));
const MonteCarlo = safeLazy(() => import('./pages/fpa/MonteCarlo'));
const ARRDashboard = safeLazy(() => import('./pages/fpa/ARRDashboard'));
const HeadcountPlanning = safeLazy(() => import('./pages/fpa/HeadcountPlanning'));
const SensitivityAnalysis = safeLazy(() => import('./pages/fpa/SensitivityAnalysis'));
const BoardPack = safeLazy(() => import('./pages/reports/BoardPack'));
const CFOServices = safeLazy(() => import('./pages/cfo/CFOServices.tsx'));
const CFODecisionIntelligence = safeLazy(() => import('./pages/CFODecisionIntelligence'));
const BookkeepingLayout = safeLazy(() =>
  import('./pages/bookkeeping/BookkeepingLayout').then((m) => ({ default: m.BookkeepingLayout }))
);
const BookkeepingUploadPage = safeLazy(() =>
  import('./pages/bookkeeping/BookkeepingUploadPage').then((m) => ({
    default: m.BookkeepingUploadPage,
  }))
);
const BookkeepingReviewPage = safeLazy(() =>
  import('./pages/bookkeeping/BookkeepingReviewPage').then((m) => ({
    default: m.BookkeepingReviewPage,
  }))
);
const BookkeepingAnomaliesPage = safeLazy(() =>
  import('./pages/bookkeeping/BookkeepingAnomaliesPage').then((m) => ({
    default: m.BookkeepingAnomaliesPage,
  }))
);
const BookkeepingMissingReceiptsPage = safeLazy(() =>
  import('./pages/bookkeeping/BookkeepingMissingReceiptsPage').then((m) => ({
    default: m.BookkeepingMissingReceiptsPage,
  }))
);
const BookkeepingReconPage = safeLazy(() =>
  import('./pages/bookkeeping/BookkeepingReconPage').then((m) => ({
    default: m.BookkeepingReconPage,
  }))
);
const BookkeepingMonthlyPage = safeLazy(() =>
  import('./pages/bookkeeping/BookkeepingMonthlyPage').then((m) => ({
    default: m.BookkeepingMonthlyPage,
  }))
);
const GetDemoPage = safeLazy(() => import('./pages/GetDemoPage'));
const CommandCenter = safeLazy(() => import('./pages/CommandCenter'));
const AgentStatus = safeLazy(() => import('./pages/AgentStatus'));

/** Matches Vite `base` (root vs GitHub Pages subpath). */
const normalizedBase = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '') || '/';
const routerBasename = normalizedBase === '/' ? undefined : normalizedBase;

function RouteFallback() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0f172a',
        color: '#e2e8f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 14,
      }}
    >
      Loading…
    </div>
  );
}

function R2rShell() {
  return (
    <div className="flex min-h-screen w-full">
      <Sidebar />
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}

function App() {
  return (
    <AgentActivityProvider>
      <ClientProvider>
        <BrowserRouter
          basename={routerBasename}
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/get-demo" element={<GetDemoPage />} />
              <Route path="/login" element={<Navigate to="/dashboard" replace />} />
              <Route path="/register" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/command-center" element={<CommandCenter />} />
              <Route path="/agent-status" element={<AgentStatus />} />
              <Route path="/cfo-dashboard" element={<CFODashboard />} />
              <Route path="/ifrs-generator" element={<IFRSStatementGenerator />} />
              <Route path="/ifrs-statement" element={<IFRSStatementPage />} />
              <Route path="/ifrs/agentic" element={<AgenticGenerator />} />
              <Route path="/board-pack" element={<IFRSStatementPage />} />
              <Route path="/erp/tally" element={<TallyIntegrationPage />} />
              <Route element={<R2rShell />}>
                <Route path="/r2r" element={<R2RModule />} />
                <Route path="/r2r-pattern" element={<R2RPatternAnalysisPage />} />
                <Route path="/r2r/pattern" element={<R2RPatternAnalysisPage />} />
                <Route path="/r2r/learning" element={<R2RPatternAnalysisPage />} />
                <Route path="/r2r/history" element={<R2RPatternAnalysisPage />} />
                <Route path="/r2r/rev-rec" element={<RevRecReconciliationPage />} />
              </Route>
              <Route path="/tb-variance" element={<TBVariancePage />} />
              <Route path="/bank-recon" element={<BankReconciliationPage />} />
              <Route path="/bank-recon/analytics" element={<BankReconciliationPage />} />
              <Route path="/bank-recon/workspace/:workspaceId" element={<BankReconciliationPage />} />
              <Route path="/close-tracker" element={<CloseTrackerPage />} />
              <Route path="/nova" element={<NovaAssistant />} />
              <Route path="/fpa" element={<FPASuite />} />
              <Route path="/excel-suite" element={<ExcelSuite />} />
              <Route path="/excel-suite/:slug" element={<ExcelSuiteToolPage />} />
              <Route path="/fpa/variance" element={<VarianceAnalysis />} />
              <Route path="/dashboard/fpa/variance-analysis" element={<VarianceAnalysisPage />} />
              <Route path="/fpa/variance-analysis" element={<VarianceAnalysisPage />} />
              <Route path="/fpa/budget" element={<BudgetManagement />} />
              <Route path="/fpa/kpi" element={<KPIDashboard />} />
              <Route path="/fpa/forecast" element={<ForecastingEngine />} />
              <Route path="/fpa/scenario" element={<ScenarioEngine />} />
              <Route path="/fpa/scenarios" element={<ScenarioEngine />} />
              <Route path="/fpa/reports" element={<ManagementReporting />} />
              <Route path="/fpa/pvm" element={<PVMAnalysis />} />
              <Route path="/fpa/three-statement" element={<ThreeStatement />} />
              <Route path="/fpa/monte-carlo" element={<MonteCarlo />} />
              <Route path="/fpa/arr-dashboard" element={<ARRDashboard />} />
              <Route path="/fpa/headcount" element={<HeadcountPlanning />} />
              <Route path="/fpa/sensitivity" element={<SensitivityAnalysis />} />
              <Route path="/reports/board-pack" element={<BoardPack />} />
              <Route path="/cfo" element={<CFOServices />} />
              <Route path="/cfo/assistant" element={<CFOServices defaultTab="assistant" />} />
              <Route path="/cfo/insights" element={<CFOServices defaultTab="insights" />} />
              <Route path="/cfo/monitor" element={<CFOServices defaultTab="monitor" />} />
              <Route path="/cfo/health" element={<CFOServices defaultTab="health" />} />
              <Route path="/cfo-decision" element={<CFODecisionIntelligence />} />
              <Route path="/bookkeeping" element={<BookkeepingLayout />}>
                <Route index element={<Navigate to="/bookkeeping/upload" replace />} />
                <Route path="upload" element={<BookkeepingUploadPage />} />
                <Route path="review" element={<BookkeepingReviewPage />} />
                <Route path="anomalies" element={<BookkeepingAnomaliesPage />} />
                <Route path="missing-receipts" element={<BookkeepingMissingReceiptsPage />} />
                <Route path="reconciliation" element={<BookkeepingReconPage />} />
                <Route path="monthly" element={<BookkeepingMonthlyPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster position="top-right" />
      </ClientProvider>
    </AgentActivityProvider>
  );
}

export default App;
